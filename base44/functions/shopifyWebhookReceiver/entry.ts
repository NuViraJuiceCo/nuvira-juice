import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Shopify Webhook Receiver
 * Handles: orders/create, orders/updated, orders/cancelled, orders/paid,
 *          orders/fulfilled, orders/refunded, products/create, products/update
 *
 * Register this URL in Shopify Admin > Settings > Notifications > Webhooks
 * Set your SHOPIFY_WEBHOOK_SECRET in secrets for verification.
 */

const NATIVE_ORDER_TOPICS = new Set(['orders/create', 'orders/paid']);
const SHOPIFY_WEBHOOK_SECRET_ENV_NAMES = [
  'SHOPIFY_WEBHOOK_SECRET',
  'SHOPIFY_WEBHOOK_SIGNING_SECRET',
  'SHOPIFY_CLIENT_SECRET',
  'SHOPIFY_API_SECRET',
  'SHOPIFY_API_SECRET_KEY',
  'SHOPIFY_SHARED_SECRET',
  'SHOPIFY_APP_SECRET',
];

function getCustomerAppSyncSecret() {
  return Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || '';
}

function internalIngestionAuthorized(req, envelope) {
  const presented = (req.headers.get('x-internal-secret') || '').trim();
  const allowed = [
    Deno.env.get('CUSTOMER_APP_SYNC_SECRET'),
    Deno.env.get('HUB_SYNC_SECRET'),
  ].map(value => (value || '').trim()).filter(Boolean);
  return Boolean(envelope?.internal_topic && presented && allowed.includes(presented));
}

function isNativeOrderOpsEnabled() {
  return Deno.env.get('ENABLE_NATIVE_ORDER_OPS') === 'true';
}

function getShopifyNativeSafeSyncBridgeConfig() {
  // Read bridge gates per request. This avoids stale Base44 runtime snapshots
  // when exact order allowlists or kill switches are changed for a pilot.
  return {
    enabled: Deno.env.get('ENABLE_SHOPIFY_WEBHOOK_NATIVE_SAFE_SYNC_WRITER') === 'true',
    topics: Deno.env.get('SHOPIFY_WEBHOOK_NATIVE_SAFE_SYNC_TOPICS') || 'orders/create,orders/paid',
    orderAllowlist: Deno.env.get('SHOPIFY_WEBHOOK_NATIVE_SAFE_SYNC_ORDER_ALLOWLIST') || '',
    customerAppSyncSecret: getCustomerAppSyncSecret(),
  };
}

function shopifyWebhookSecretCandidates() {
  // Keep literal env reads so Base44 can attach referenced secrets, while still
  // reading per request instead of using a stale module-level snapshot.
  // Incident rebuild note: this comment-only revision forces a fresh function artifact.
  return [
    ['SHOPIFY_WEBHOOK_SECRET', Deno.env.get('SHOPIFY_WEBHOOK_SECRET')],
    ['SHOPIFY_WEBHOOK_SIGNING_SECRET', Deno.env.get('SHOPIFY_WEBHOOK_SIGNING_SECRET')],
    ['SHOPIFY_CLIENT_SECRET', Deno.env.get('SHOPIFY_CLIENT_SECRET')],
    ['SHOPIFY_API_SECRET', Deno.env.get('SHOPIFY_API_SECRET')],
    ['SHOPIFY_API_SECRET_KEY', Deno.env.get('SHOPIFY_API_SECRET_KEY')],
    ['SHOPIFY_SHARED_SECRET', Deno.env.get('SHOPIFY_SHARED_SECRET')],
    ['SHOPIFY_APP_SECRET', Deno.env.get('SHOPIFY_APP_SECRET')],
  ];
}

function getShopifyWebhookSecret() {
  for (const [, rawValue] of shopifyWebhookSecretCandidates()) {
    const value = (rawValue || '').trim();
    if (value) return value;
  }
  return '';
}

function shopifyWebhookSecretDiagnostic() {
  return Object.fromEntries(shopifyWebhookSecretCandidates().map(([name, rawValue]) => [
    name,
    Boolean((rawValue || '').trim()),
  ]));
}

function shopifyWebhookSecretDiagnosticLog() {
  const presence = shopifyWebhookSecretDiagnostic();
  return SHOPIFY_WEBHOOK_SECRET_ENV_NAMES
    .map(name => `${name}:${presence[name] ? 'present' : 'missing'}`)
    .join(',');
}

async function verifyShopifyHmac(req, bodyText) {
  const hmacHeader = req.headers.get('x-shopify-hmac-sha256');
  const webhookSecret = getShopifyWebhookSecret();
  if (!webhookSecret) {
    throw new Error('SHOPIFY_WEBHOOK_SECRET not configured');
  }
  if (!hmacHeader) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(bodyText));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return computed === hmacHeader;
}

function detectSourceChannel(order) {
  const tags = (order.tags || '').toLowerCase();
  const source = (order.source_name || '').toLowerCase();
  if (order.source_name === 'pos' || source === 'pos') return 'pos';
  if (tags.includes('subscription') || tags.includes('recurring')) return 'subscription';
  if (tags.includes('wholesale')) return 'wholesale';
  if (tags.includes('event')) return 'event';
  if (order.source_name === 'draft_order') return 'draft';
  if (source === 'admin') return 'admin';
  return 'online';
}

function mapFulfillmentMethod(order) {
  const shippingLines = order.shipping_lines || [];
  const noteAttr = (order.note_attributes || []).reduce((acc, a) => { acc[a.name] = a.value; return acc; }, {});
  if (order.source_name === 'pos') return 'pos';
  if (noteAttr['fulfillment_type'] === 'pickup') return 'pickup';
  if (shippingLines.some(l => (l.title || '').toLowerCase().includes('pickup'))) return 'pickup';
  return 'delivery';
}

function extractAddress(order) {
  const addr = order.shipping_address || order.billing_address;
  if (!addr) return '';
  return [addr.address1, addr.city, addr.province_code, addr.zip].filter(Boolean).join(', ');
}

function extractAddressFields(order) {
  const addr = order.shipping_address || order.billing_address || {};
  return {
    address_line1: addr.address1 || '',
    address_line2: addr.address2 || '',
    address_city: addr.city || '',
    address_state: addr.province_code || addr.province || '',
    address_postal_code: addr.zip || '',
    address_country: addr.country_code || addr.country || 'US',
  };
}

function extractRequestedDate(order) {
  const attrs = (order.note_attributes || []).reduce((acc, a) => { acc[a.name] = a.value; return acc; }, {});
  return attrs['delivery_date'] || attrs['pickup_date'] || attrs['requested_date'] || '';
}

function noteAttributes(order) {
  return (order.note_attributes || []).reduce((acc, attr) => {
    if (attr?.name) acc[attr.name] = attr.value;
    return acc;
  }, {});
}

function hasTag(order, expectedTag) {
  return String(order.tags || '')
    .split(',')
    .map(tag => tag.trim().toLowerCase())
    .includes(expectedTag);
}

function isAppOriginatedShopifyMirror(order) {
  const source = String(order.source_name || '').toLowerCase();
  const note = String(order.note || '').toLowerCase();
  if (source === 'pos') return false;
  return (
    hasTag(order, 'base44-app') ||
    note.includes('base44 order #')
  );
}

function mapToShopifyOrder(order) {
  const channel = detectSourceChannel(order);
  const isPosOrder = order.source_name === 'pos' || channel === 'pos';
  const attrs = noteAttributes(order);
  const addressFields = extractAddressFields(order);
  return {
    shopify_order_id: String(order.id),
    shopify_order_number: String(order.order_number || order.name || order.id),
    source_channel: channel,
    ...(isPosOrder ? {
      source_type: 'shopify_pos',
      order_type: 'pos',
      fulfillment_mode: 'single_delivery',
      fulfillment_status: 'fulfilled',
      production_status: 'not_required',
      order_lock_status: 'fulfilled',
      data_quality_status: 'complete',
      sync_status: 'native_pos_ready',
    } : {}),
    customer_name: [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') || 'Guest',
    customer_email: order.email || order.customer?.email || '',
    customer_phone: order.phone || order.customer?.phone || order.billing_address?.phone || '',
    line_items: (order.line_items || []).map(li => ({
      shopify_line_item_id: String(li.id),
      title: li.title,
      variant_title: li.variant_title || '',
      sku: li.sku || '',
      quantity: li.quantity,
      price: parseFloat(li.price || 0),
      total_discount: parseFloat(li.total_discount || 0),
    })),
    fulfillment_method: mapFulfillmentMethod(order),
    delivery_address: extractAddress(order),
    ...addressFields,
    requested_delivery_date: extractRequestedDate(order),
    requested_time_window: (order.note_attributes || []).find(a => a.name === 'time_window')?.value || '',
    payment_status: order.financial_status || '',
    shopify_fulfillment_status: order.fulfillment_status || 'unfulfilled',
    financial_status: order.financial_status || '',
    subtotal: parseFloat(order.subtotal_price || 0),
    total_tax: parseFloat(order.total_tax || 0),
    total_discounts: parseFloat(order.total_discounts || 0),
    tip_received: parseFloat(order.total_tip_received || 0),
    total_price: parseFloat(order.total_price || 0),
    discount_codes: (order.discount_codes || []).map(d => d.code),
    customer_notes: order.note || '',
    tags: (order.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    is_pos_order: order.source_name === 'pos',
    event_name: attrs.event_name || attrs.event || '',
    event_date: attrs.event_date || attrs.pickup_date || '',
    event_location: attrs.event_location || attrs.location || attrs.location_name || '',
    customer_order_date: order.created_at || new Date().toISOString(),
    is_subscription: (order.tags || '').toLowerCase().includes('subscription'),
    subscription_cadence: '',
    shopify_synced_at: new Date().toISOString(),
  };
}

function normalizeKey(value) {
  return (value ?? '').toString().trim().replace(/^#/, '').toLowerCase();
}

function parseCsvSet(value) {
  return new Set(String(value || '').split(',').map(normalizeKey).filter(Boolean));
}

function safeLogText(value, maxLength = 180) {
  const text = (value ?? '').toString()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function topicKey(topic) {
  return normalizeKey(topic).replace(/[^a-z0-9]+/g, '_');
}

function nativeSafeSyncIdentifiers(record) {
  return [
    record?.id,
    record?.shopify_order_id,
    record?.shopify_order_number,
    record?.order_number,
    record?.stripe_checkout_session_id,
    record?.stripe_payment_intent_id,
  ].map(normalizeKey).filter(Boolean);
}

function isNativeSafeSyncTopicAllowed(topic, config) {
  const allowed = parseCsvSet(config?.topics);
  return allowed.size > 0 && allowed.has(normalizeKey(topic));
}

function isNativeSafeSyncOrderAllowlisted(record, config) {
  const allowed = parseCsvSet(config?.orderAllowlist);
  if (allowed.size === 0) return false;
  return nativeSafeSyncIdentifiers(record).some(identifier => allowed.has(identifier));
}

function nativeSafeSyncSourceFor(record) {
  if (record?.source_channel === 'pos' || record?.source_type === 'shopify_pos' || record?.fulfillment_method === 'pos') {
    return 'admin';
  }
  return 'customer_app';
}

function nativeSafeSyncPayload(record) {
  const payload = { ...(record || {}) };
  delete payload.id;
  delete payload.created_date;
  delete payload.updated_date;
  delete payload.created_by;
  delete payload.updated_by;
  delete payload.shopify_raw_payload;
  return payload;
}

function webhookPayloadPreview({ topic, payload, shopifyOrderId, orderNumber }) {
  const fieldsPresent = Object.keys(payload || {}).sort().slice(0, 50);
  return JSON.stringify({
    payload_type: 'shopify_webhook_redacted_summary',
    topic,
    shopify_order_id: shopifyOrderId || null,
    shopify_order_number: orderNumber || null,
    source_name: safeLogText(payload?.source_name, 80) || null,
    financial_status: safeLogText(payload?.financial_status, 80) || null,
    fulfillment_status: safeLogText(payload?.fulfillment_status, 80) || null,
    fields_present: fieldsPresent,
  }).substring(0, 500);
}

function nativeSafeSyncHandled(result) {
  if (!result || result.success !== true) return false;
  if (result.native_writer_enabled === true && ['created', 'updated', 'skipped'].includes(result.action)) return true;
  return result.action === 'idempotent_skip';
}

async function refetchShopifyOrder(base44, record) {
  const shopifyOrderId = record?.shopify_order_id;
  if (shopifyOrderId) {
    const byShopifyId = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_id: shopifyOrderId }, '-created_date', 2).catch(() => []);
    if (Array.isArray(byShopifyId) && byShopifyId.length > 0) return byShopifyId[0];
  }

  const orderNumber = record?.shopify_order_number || record?.order_number;
  if (orderNumber) {
    const byNumber = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_number: orderNumber }, '-created_date', 2).catch(() => []);
    if (Array.isArray(byNumber) && byNumber.length > 0) return byNumber[0];
  }

  return null;
}

async function maybeRunNativeSafeSyncWriter(base44, { record, topic }) {
  const config = getShopifyNativeSafeSyncBridgeConfig();
  if (!config.enabled) {
    return { attempted: false, handled: false, reason: 'bridge_disabled' };
  }
  if (!isNativeSafeSyncTopicAllowed(topic, config)) {
    return { attempted: false, handled: false, reason: 'topic_not_allowed' };
  }
  if (!isNativeSafeSyncOrderAllowlisted(record, config)) {
    return { attempted: false, handled: false, reason: 'order_not_allowlisted' };
  }

  const source = nativeSafeSyncSourceFor(record);
  const orderKey = safeLogText(record?.shopify_order_number || record?.shopify_order_id || 'unknown', 120);
  const eventType = `shopify.webhook.${topicKey(topic)}`;
  const requestId = `shopifyWebhookReceiver:native_safe_sync:${topicKey(topic)}:${orderKey}`;
  const idempotencyKey = `native_safe_sync:shopify_webhook:${topicKey(topic)}:${orderKey}`;

  try {
    const response = await base44.asServiceRole.functions.invoke('getAdminOperationsDashboardSummary', {
      gateway_action: 'executeNativeSafeSyncOrderUpdate',
      payload: {
        mode: 'live',
        source,
        event_type: eventType,
        request_id: requestId,
        idempotency_key: idempotencyKey,
        internal_secret: config.customerAppSyncSecret,
        incoming_payload: nativeSafeSyncPayload(record),
      },
    });
    const result = response?.data || response || {};
    const handled = nativeSafeSyncHandled(result);
    console.log(`[Shopify native safeSync bridge] topic=${topic} order=${orderKey} source=${source} action=${result?.action || 'unknown'} handled=${handled}`);
    return {
      attempted: true,
      handled,
      result,
      source,
      action: result?.action || null,
      order: handled ? await refetchShopifyOrder(base44, record) : null,
    };
  } catch (error) {
    console.warn(`[Shopify native safeSync bridge] failed safely for ${orderKey}: ${error?.message || 'unknown error'}`);
    return {
      attempted: true,
      handled: false,
      error_code: 'native_safe_sync_bridge_failed',
    };
  }
}

function safeFieldList(fields, limit = 40) {
  return Array.from(new Set((Array.isArray(fields) ? fields : [])
    .map(field => safeLogText(field, 100))
    .filter(Boolean)))
    .slice(0, limit);
}

async function createOrderWriteAuditLog(base44, { record, topic, action, reason, fieldsUpdated, status = 'success' }) {
  const orderNumber = safeLogText(record?.shopify_order_number || record?.order_number || 'unknown', 120) || 'unknown';
  const shopifyOrderId = safeLogText(record?.shopify_order_id, 120);
  const now = new Date().toISOString();

  await base44.asServiceRole.entities.OrderSyncLog.create({
    order_number: orderNumber,
    status,
    sync_timestamp: now,
    sync_source: 'shopify_webhook_receiver',
    event_type: safeLogText(topic, 80),
    order_id: safeLogText(record?.id, 120),
    action: safeLogText(action, 80),
    reason: safeLogText(reason || `Shopify webhook ${topic} ${action}`, 300),
    fields_updated: safeFieldList(fieldsUpdated),
    fields_rejected: [],
    success: status === 'success' || status === 'deduped',
    error: null,
    error_code: null,
    idempotency_key: `shopify_webhook:${safeLogText(topic, 80)}:${shopifyOrderId || orderNumber}:${safeLogText(action, 80)}`,
    request_id: `shopifyWebhookReceiver:${safeLogText(topic, 80)}:${shopifyOrderId || orderNumber}:${safeLogText(action, 80)}`,
    correlation_id: `shopify:${shopifyOrderId || orderNumber}`,
    description: safeLogText(`Audited ShopifyOrder ${action} from Shopify webhook ${topic}. No raw Shopify payload stored in this audit log.`, 500),
    started_at: now,
    completed_at: now,
  }).catch(error => {
    console.warn(`[shopifyWebhookReceiver] OrderSyncLog audit write failed safely: ${error?.message || 'unknown error'}`);
  });
}

async function syncIngestedOrderToHub(base44, record, topic) {
  if (!record?.id || !['orders/create', 'orders/paid'].includes(topic)) return { skipped: true };
  return {
    success: true,
    skipped: true,
    retired: true,
    source: 'customer_app_native_authoritative',
    hub_operational_dependency: false,
    external_calls_performed: false,
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  }

  const bodyText = await req.text();

  let envelope;
  try {
    envelope = JSON.parse(bodyText);
  } catch (e) {
    console.error('Failed to parse Shopify ingestion payload:', e.message);
    return Response.json({ error: 'Bad JSON' }, { status: 400 });
  }
  const internalIngestion = internalIngestionAuthorized(req, envelope);

  // Shopify webhooks use HMAC. The scheduled poller uses the same canonical
  // ingestion path with a server-only internal secret.
  let valid = false;
  if (internalIngestion) {
    valid = true;
  } else {
    try {
      valid = await verifyShopifyHmac(req, bodyText);
    } catch (error) {
      console.error('Shopify HMAC verification unavailable:', error.message, {
        env_present: shopifyWebhookSecretDiagnostic(),
      });
      console.error(`Shopify HMAC verification env presence: ${shopifyWebhookSecretDiagnosticLog()}`);
      return Response.json({ error: 'shopify_webhook_verification_unavailable' }, { status: 500 });
    }
  }
  if (!valid) {
    console.error('Invalid Shopify HMAC signature');
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const topic = internalIngestion
    ? String(envelope.internal_topic || 'unknown')
    : req.headers.get('x-shopify-topic') || 'unknown';
  const payload = internalIngestion ? envelope.data : envelope;
  if (!payload || typeof payload !== 'object') return Response.json({ error: 'missing_order_payload' }, { status: 400 });

  const base44 = createClientFromRequest(req);
  const shopifyOrderId = payload.id ? String(payload.id) : null;
  const orderNumber = String(payload.order_number || payload.name || payload.id || '');

  // Log the webhook
  const webhookLog = await base44.asServiceRole.entities.ShopifyWebhookLog.create({
    topic,
    shopify_order_id: shopifyOrderId,
    shopify_order_number: orderNumber,
    status: 'received',
    payload_preview: webhookPayloadPreview({ topic, payload, shopifyOrderId, orderNumber }),
  });

  console.log(`Webhook received: ${topic} | Order: ${orderNumber}`);

  // Handle product sync topics
  if (topic.startsWith('products/')) {
    await handleProductSync(base44, topic, payload);
    await updateWebhookLog(base44, webhookLog, {
      status: 'processed',
      description: 'Product webhook processed. Native order processing is not applicable.',
    });
    return Response.json({ ok: true });
  }

  // Order topics
  if (!shopifyOrderId) {
    console.warn('No order ID in payload for topic:', topic);
    await updateWebhookLog(base44, webhookLog, {
      status: 'failed',
      description: 'Webhook payload had no Shopify order id.',
      error_message: 'missing_shopify_order_id',
    });
    return Response.json({ ok: true });
  }

  if (topic.startsWith('orders/') && isAppOriginatedShopifyMirror(payload)) {
    await updateWebhookLog(base44, webhookLog, {
      status: 'processed',
      description: 'App-originated Shopify mirror skipped. Customer App Order plus syncOrderToHub remain the operational path.',
      payload_preview: 'app_originated_shopify_mirror_suppressed',
    });
    console.log(`Skipped app-originated Shopify mirror for #${orderNumber}`);
    return Response.json({ ok: true, skipped: true, reason: 'app_originated_shopify_mirror' });
  }

  // Idempotency: check for existing record
  const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_id: shopifyOrderId });
  let nativeOpsResult = null;
  let nativeOpsAttempted = false;
  let nativeSafeSyncBridge: any = { attempted: false, handled: false };

  if (topic === 'orders/create' || topic === 'orders/paid') {
    let record;
    let action = 'created';
    const mappedForNativeSafeSync = mapToShopifyOrder(payload);
    nativeSafeSyncBridge = await maybeRunNativeSafeSyncWriter(base44, {
      record: existing.length > 0 ? { ...mappedForNativeSafeSync, id: existing[0].id } : mappedForNativeSafeSync,
      topic,
    });

    if (nativeSafeSyncBridge.handled) {
      record = nativeSafeSyncBridge.order || existing[0] || mappedForNativeSafeSync;
      action = nativeSafeSyncBridge.action === 'created' ? 'created' : 'updated';
      console.log(`Native safeSync handled Shopify webhook ${topic} #${orderNumber}`);
    } else if (existing.length > 0) {
      const updates = mapToShopifyOrder(payload);
      record = await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, {
        source_channel: updates.source_channel,
        customer_name: updates.customer_name,
        customer_email: updates.customer_email,
        customer_phone: updates.customer_phone,
        fulfillment_method: updates.fulfillment_method,
        delivery_address: updates.delivery_address,
        address_line1: updates.address_line1,
        address_line2: updates.address_line2,
        address_city: updates.address_city,
        address_state: updates.address_state,
        address_postal_code: updates.address_postal_code,
        address_country: updates.address_country,
        requested_delivery_date: updates.requested_delivery_date,
        requested_time_window: updates.requested_time_window,
        shopify_fulfillment_status: updates.shopify_fulfillment_status,
        financial_status: updates.financial_status,
        payment_status: updates.payment_status,
        customer_notes: updates.customer_notes,
        line_items: updates.line_items,
        total_price: updates.total_price,
        total_discounts: updates.total_discounts,
        shopify_synced_at: new Date().toISOString(),
      });
      action = 'updated';
      await createOrderWriteAuditLog(base44, {
        record,
        topic,
        action,
        reason: 'shopify_order_create_or_paid_existing_order_update',
        fieldsUpdated: [
          'source_channel',
          'customer_name',
          'customer_email',
          'customer_phone',
          'fulfillment_method',
          'delivery_address',
          'address_line1',
          'address_line2',
          'address_city',
          'address_state',
          'address_postal_code',
          'address_country',
          'requested_delivery_date',
          'requested_time_window',
          'shopify_fulfillment_status',
          'financial_status',
          'payment_status',
          'customer_notes',
          'line_items',
          'total_price',
          'total_discounts',
          'shopify_synced_at',
        ],
      });
      console.log(`Updated existing ShopifyOrder for ${topic} #${orderNumber}`);
    } else {
      record = mapToShopifyOrder(payload);
      record = await base44.asServiceRole.entities.ShopifyOrder.create(record);
      await createOrderWriteAuditLog(base44, {
        record,
        topic,
        action,
        reason: 'shopify_order_create_or_paid_new_order',
        fieldsUpdated: Object.keys(record || {}),
      });
      console.log(`Created ShopifyOrder for #${orderNumber}`);
    }

    // Only actionable exceptions become alerts. Successful orders belong in
    // the operations dashboard, not an indefinitely unresolved notice queue.
    if (action === 'created') {
      // Same-day pickup check
      const requestedDate = record.requested_delivery_date;
      if (requestedDate) {
        const today = new Date().toISOString().slice(0, 10);
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        if (requestedDate === today && record.fulfillment_method === 'pickup') {
          await createAlert(base44, 'same_day_pickup', `Same-Day Pickup! #${orderNumber}`, `${record.customer_name} needs pickup today`, shopifyOrderId, orderNumber, 'critical');
        } else if (requestedDate === tomorrow && record.fulfillment_method === 'delivery') {
          await createAlert(base44, 'next_day_delivery', `Next-Day Delivery #${orderNumber}`, `${record.customer_name} — deliver tomorrow`, shopifyOrderId, orderNumber, 'warning');
        }
      }

      // High-volume order check
      const totalItems = record.line_items?.reduce((s, li) => s + li.quantity, 0) || 0;
      if (totalItems >= 12) {
        await createAlert(base44, 'high_volume', `High Volume Order #${orderNumber}`, `${totalItems} items — plan production capacity`, shopifyOrderId, orderNumber, 'warning');
      }

      // Missing info check
      if (!record.customer_phone && record.fulfillment_method === 'delivery') {
        await createAlert(base44, 'missing_info', `Missing Phone #${orderNumber}`, `No phone number for delivery order`, shopifyOrderId, orderNumber, 'warning');
      }
    }

    await logSync(base44, 'webhook', 'success', 1, 0);
    nativeOpsAttempted = shouldAttemptNativeOrderOps(record, topic);
    nativeOpsResult = await maybeRunNativeOrderOps(base44, record, topic);
    await syncIngestedOrderToHub(base44, record, topic);

  } else if (topic === 'orders/updated') {
    const mappedForNativeSafeSync = mapToShopifyOrder(payload);
    nativeSafeSyncBridge = await maybeRunNativeSafeSyncWriter(base44, {
      record: existing.length > 0 ? { ...mappedForNativeSafeSync, id: existing[0].id } : mappedForNativeSafeSync,
      topic,
    });

    if (nativeSafeSyncBridge.handled) {
      console.log(`Native safeSync handled Shopify update webhook #${orderNumber}`);
    } else if (existing.length > 0) {
      const updates = mapToShopifyOrder(payload);
      const updatedRecord = await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, {
        source_channel: updates.source_channel,
        customer_name: updates.customer_name,
        customer_email: updates.customer_email,
        customer_phone: updates.customer_phone,
        fulfillment_method: updates.fulfillment_method,
        delivery_address: updates.delivery_address,
        address_line1: updates.address_line1,
        address_line2: updates.address_line2,
        address_city: updates.address_city,
        address_state: updates.address_state,
        address_postal_code: updates.address_postal_code,
        address_country: updates.address_country,
        requested_delivery_date: updates.requested_delivery_date,
        requested_time_window: updates.requested_time_window,
        shopify_fulfillment_status: updates.shopify_fulfillment_status,
        payment_status: updates.payment_status,
        financial_status: updates.financial_status,
        customer_notes: updates.customer_notes,
        line_items: updates.line_items,
        total_price: updates.total_price,
        total_discounts: updates.total_discounts,
        shopify_synced_at: new Date().toISOString(),
      });
      await createOrderWriteAuditLog(base44, {
        record: updatedRecord,
        topic,
        action: 'updated',
        reason: 'shopify_order_updated_existing_order_update',
        fieldsUpdated: [
          'shopify_fulfillment_status',
          'payment_status',
          'financial_status',
          'customer_notes',
          'line_items',
          'total_price',
          'total_discounts',
          'shopify_synced_at',
        ],
      });
      console.log(`Updated ShopifyOrder #${orderNumber}`);
    } else {
      // Order not in Base44 yet — create it
      const created = await base44.asServiceRole.entities.ShopifyOrder.create(mapToShopifyOrder(payload));
      await createOrderWriteAuditLog(base44, {
        record: created,
        topic,
        action: 'created',
        reason: 'shopify_order_updated_missing_order_create',
        fieldsUpdated: Object.keys(created || {}),
      });
      nativeOpsAttempted = shouldAttemptNativeOrderOps(created, topic);
      nativeOpsResult = await maybeRunNativeOrderOps(base44, created, topic);
      console.log(`Created missing ShopifyOrder #${orderNumber} from update event`);
    }

  } else if (topic === 'orders/cancelled') {
    if (existing.length > 0) {
      const updatedRecord = await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, {
        production_status: 'canceled',
        shopify_fulfillment_status: 'cancelled',
        shopify_synced_at: new Date().toISOString(),
      });
      await createOrderWriteAuditLog(base44, {
        record: updatedRecord,
        topic,
        action: 'updated',
        reason: 'shopify_order_cancelled_status_update',
        fieldsUpdated: ['production_status', 'shopify_fulfillment_status', 'shopify_synced_at'],
      });
      await createAlert(base44, 'cancellation', `Order Canceled #${orderNumber}`, `${payload.customer?.first_name || ''} ${payload.customer?.last_name || ''} canceled their order`, shopifyOrderId, orderNumber, 'warning');
    }

  } else if (topic === 'orders/refunded') {
    if (existing.length > 0) {
      const now = new Date().toISOString();
      const tags = uniqueTags([...(existing[0].tags || []), 'refunded', 'excluded']);
      const updatedOrder = await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, {
        payment_status: 'refunded',
        financial_status: 'refunded',
        production_status: 'canceled',
        fulfillment_status: 'cancelled',
        order_status: 'refunded',
        operational_visibility: 'archived',
        sync_status: 'native_refunded',
        excluded_from_production: true,
        refunded_at: now,
        cancel_type: 'shopify_refund',
        tags,
        shopify_synced_at: now,
        last_sync_at: now,
        internal_notes: `${existing[0].internal_notes || ''}\n[Shopify refund webhook] ${topic} marked order refunded on ${now}`.trim(),
        audit_trail: [
          ...(existing[0].audit_trail || []),
          {
            timestamp: now,
            action: 'ShopifyRefundWebhook',
            performed_by: 'shopifyWebhookReceiver',
            before: {
              payment_status: existing[0].payment_status || null,
              production_status: existing[0].production_status || null,
            },
            after: { payment_status: 'refunded', production_status: 'canceled' },
            reason: `Shopify ${topic} webhook`,
          },
        ],
      });
      await createOrderWriteAuditLog(base44, {
        record: updatedOrder,
        topic,
        action: 'updated',
        reason: 'shopify_order_refunded_status_update',
        fieldsUpdated: [
          'payment_status',
          'financial_status',
          'production_status',
          'fulfillment_status',
          'order_status',
          'operational_visibility',
          'sync_status',
          'excluded_from_production',
          'refunded_at',
          'cancel_type',
          'tags',
          'shopify_synced_at',
          'last_sync_at',
          'internal_notes',
          'audit_trail',
        ],
      });
      nativeOpsAttempted = Boolean(nativeRefundSourceForOrder(updatedOrder));
      nativeOpsResult = await maybeRunNativeRefundMirror(base44, updatedOrder, topic, payload);
      await createAlert(base44, 'refund', `Refund #${orderNumber}`, `Refund processed for ${payload.customer?.first_name || ''} — $${payload.total_price || '?'}`, shopifyOrderId, orderNumber, 'info');
    }

  } else if (topic === 'orders/fulfilled') {
    if (existing.length > 0) {
      const updatedRecord = await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, {
        shopify_fulfillment_status: 'fulfilled',
        shopify_synced_at: new Date().toISOString(),
      });
      await createOrderWriteAuditLog(base44, {
        record: updatedRecord,
        topic,
        action: 'updated',
        reason: 'shopify_order_fulfilled_status_update',
        fieldsUpdated: ['shopify_fulfillment_status', 'shopify_synced_at'],
      });
    }
  }

  // Update webhook log status
  await updateWebhookLog(base44, webhookLog, {
    status: 'processed',
    description: webhookDescription({ topic, nativeOpsAttempted, nativeOpsResult }),
  });

  return Response.json({ ok: true });
});

async function handleProductSync(base44, topic, payload) {
  const shopifyProductId = String(payload.id);
  const existing = await base44.asServiceRole.entities.ShopifyProduct.filter({ shopify_product_id: shopifyProductId });
  const record = {
    shopify_product_id: shopifyProductId,
    title: payload.title,
    handle: payload.handle,
    product_type: payload.product_type || '',
    status: payload.status || 'active',
    vendor: payload.vendor || '',
    tags: (payload.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    image_url: payload.image?.src || payload.images?.[0]?.src || '',
    variants: (payload.variants || []).map(v => ({
      shopify_variant_id: String(v.id),
      title: v.title,
      sku: v.sku || '',
      price: parseFloat(v.price || 0),
      compare_at_price: parseFloat(v.compare_at_price || 0),
      inventory_quantity: v.inventory_quantity || 0,
      inventory_policy: v.inventory_policy || 'deny',
    })),
    synced_at: new Date().toISOString(),
  };
  if (existing.length > 0) {
    await base44.asServiceRole.entities.ShopifyProduct.update(existing[0].id, record);
    console.log(`Updated product: ${payload.title}`);
  } else {
    await base44.asServiceRole.entities.ShopifyProduct.create(record);
    console.log(`Created product: ${payload.title}`);
  }
}

async function createAlert(base44, alertType, title, message, shopifyOrderId, orderNumber, severity) {
  const existing = await base44.asServiceRole.entities.OperationalAlert.filter({
    alert_type: alertType,
    shopify_order_id: shopifyOrderId,
    resolved: false,
  }, '-created_date', 3).catch(() => []);
  const payload = {
    alert_type: alertType, title, message,
    shopify_order_id: shopifyOrderId,
    order_number: orderNumber,
    severity, is_read: false, resolved: false,
  };
  if (existing[0]) await base44.asServiceRole.entities.OperationalAlert.update(existing[0].id, payload);
  else await base44.asServiceRole.entities.OperationalAlert.create(payload);
}

async function logSync(base44, syncType, status, synced, failed) {
  await base44.asServiceRole.entities.ShopifySyncLog.create({
    sync_type: syncType, status,
    records_synced: synced, records_failed: failed,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    triggered_by: 'webhook',
  });
}

async function updateWebhookLog(base44, webhookLog, updates) {
  if (!webhookLog?.id) return;

  await base44.asServiceRole.entities.ShopifyWebhookLog.update(webhookLog.id, {
    ...updates,
    processed_at: new Date().toISOString(),
  }).catch(error => {
    console.warn(`[shopifyWebhookReceiver] failed to update webhook log safely: ${error?.message || 'unknown error'}`);
  });
}

function uniqueTags(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map(value => (value || '').toString().trim())
    .filter(Boolean)));
}

function nativeRefundSourceForOrder(record) {
  if (!isNativeOrderOpsEnabled()) return null;
  if (record?.is_subscription || record?.source_channel === 'subscription' || record?.order_type === 'subscription') {
    return null;
  }
  if (record?.source_channel === 'pos' || record?.source_type === 'shopify_pos' || record?.fulfillment_method === 'pos') {
    return 'shopify_pos';
  }
  if (record?.source_channel === 'online' || record?.source_channel === 'event' || record?.order_type === 'one_time') {
    return 'website_one_time';
  }
  return null;
}

async function maybeRunNativeRefundMirror(base44, record, topic, payload) {
  const source = nativeRefundSourceForOrder(record);
  if (!source) return null;

  const orderKey = record.shopify_order_number || record.shopify_order_id || 'unknown';
  try {
    const response = await base44.asServiceRole.functions.invoke('syncOrderToHub', {
      native_only: true,
      native_source: source,
      event_type: 'order.refunded',
      data: {
        ...record,
        payment_status: 'refunded',
        financial_status: 'refunded',
        refund_id: payload?.refunds?.[0]?.id || `shopify_refund_${record.shopify_order_id || orderKey}`,
        refund_amount: Number(payload?.total_price || record.total_price || 0),
        refunded_at: new Date().toISOString(),
      },
      request_id: `shopifyWebhookReceiver:${topic}:${orderKey}`,
      idempotency_key: `native_order_ops:${source}:refund:${orderKey}`,
    });
    const envelope = response?.data || response;
    const result = envelope?.native_order_ops || envelope;
    console.log(`[Native refund mirror] source=${source} order=${orderKey} action=${result?.action || 'unknown'} success=${result?.success === true}`);
    return result;
  } catch (error) {
    console.warn(`[Native refund mirror] failed safely for order=${orderKey}: ${error?.message || 'unknown error'}`);
    return { success: false, error_code: 'native_refund_mirror_failed' };
  }
}

function hasDeliveryAddress(record) {
  if (record.fulfillment_method !== 'delivery') return true;
  return Boolean(
    record.address_line1 &&
    record.address_city &&
    record.address_state &&
    record.address_postal_code
  ) || Boolean(record.delivery_address);
}

function productionDemandFor(record) {
  const productsByTitle = new Map();
  for (const item of record.line_items || []) {
    const title = item.title || 'Unknown product';
    const current = productsByTitle.get(title) || { product_name: title, quantity: 0 };
    current.quantity += Number(item.quantity || 0);
    productsByTitle.set(title, current);
  }
  const products = Array.from(productsByTitle.values());
  return {
    product_count: products.length,
    total_units: products.reduce((sum, item) => sum + item.quantity, 0),
    products,
  };
}

async function createOrUpdateNativeOpsReview(base44, { record, source, topic, reason, idempotencyKey }) {
  const now = new Date().toISOString();
  const existing = await base44.asServiceRole.entities.OrderReviewQueue.filter({
    idempotency_key: `${idempotencyKey}:review:${reason}`,
  }, '-created_date', 1).catch(() => []);

  const payload = {
    incident_type: reason,
    customer_email: record.customer_email || '',
    customer_name: record.customer_name || '',
    existing_order_id: record.id || '',
    existing_order_number: record.shopify_order_number || '',
    existing_order_type: record.order_type || 'one_time',
    incoming_source: source,
    incoming_payload: {
      source,
      event_type: topic,
      order_id: record.id || '',
      order_number: record.shopify_order_number || '',
      fulfillment_method: record.fulfillment_method || '',
      payment_status: record.payment_status || record.financial_status || '',
      line_item_count: Array.isArray(record.line_items) ? record.line_items.length : 0,
      has_delivery_address: hasDeliveryAddress(record),
      requested_delivery_date_present: Boolean(record.requested_delivery_date),
    },
    issue_description: `Native order ops fallback queued order for review: ${reason}`,
    recommended_action: 'Review fulfillment date/details before production or delivery task scheduling.',
    status: 'pending',
    idempotency_key: `${idempotencyKey}:review:${reason}`,
    first_seen_at: now,
    last_seen_at: now,
  };

  if (Array.isArray(existing) && existing.length > 0) {
    const occurrenceCount = Number(existing[0].occurrence_count || 1) + 1;
    await base44.asServiceRole.entities.OrderReviewQueue.update(existing[0].id, {
      occurrence_count: occurrenceCount,
      last_seen_at: now,
      issue_description: payload.issue_description,
    });
    return 'updated';
  }

  await base44.asServiceRole.entities.OrderReviewQueue.create({
    ...payload,
    occurrence_count: 1,
  });
  return 'created';
}

async function createOrUpdateFallbackFulfillmentTask(base44, { record, idempotencyKey, topic }) {
  if (record.fulfillment_method !== 'delivery') {
    return { action: 'not_required' };
  }
  if (!record.requested_delivery_date) {
    return { action: 'skipped', reason: 'missing_delivery_date' };
  }

  const existing = await base44.asServiceRole.entities.FulfillmentTask.filter({
    order_id: record.id,
    fulfillment_number: 1,
  }, '-created_date', 1).catch(() => []);

  const task = {
    order_id: record.id,
    customer_email: record.customer_email || '',
    fulfillment_number: 1,
    delivery_date: record.requested_delivery_date,
    items: (record.line_items || []).map(item => ({
      product_id: item.shopify_line_item_id || item.sku || '',
      title: item.title || 'Item',
      price: Number(item.price || 0),
      quantity: Number(item.quantity || 0),
    })),
    status: 'pending',
    notes: `Native fallback task from ${topic}; idempotency=${idempotencyKey}`,
  };

  if (Array.isArray(existing) && existing.length > 0) {
    await base44.asServiceRole.entities.FulfillmentTask.update(existing[0].id, {
      customer_email: task.customer_email,
      delivery_date: task.delivery_date,
      items: task.items,
      notes: task.notes,
    });
    return { action: 'updated' };
  }

  await base44.asServiceRole.entities.FulfillmentTask.create(task);
  return { action: 'created' };
}

async function createNativeOpsAuditLogs(base44, { record, source, topic, idempotencyKey, requestId, action, status, reason, demand }) {
  await base44.asServiceRole.entities.OrderSyncLog.create({
    order_number: record.shopify_order_number || 'unknown',
    status,
    sync_timestamp: new Date().toISOString(),
    sync_source: 'native_shopify_webhook_fallback',
    event_type: topic,
    order_id: record.id || '',
    action,
    reason,
    fields_updated: ['shopify_order', 'native_ops_visibility'],
    fields_rejected: status === 'queued_for_review' ? [reason] : [],
    success: status === 'success' || status === 'deduped',
    error_code: status === 'queued_for_review' ? reason : null,
    idempotency_key: idempotencyKey,
    request_id: requestId,
    correlation_id: `${source}:${record.shopify_order_number || 'unknown'}`,
  }).catch(error => {
    console.warn(`[Native ops fallback] OrderSyncLog write failed safely: ${error?.message || 'unknown'}`);
  });

  await base44.asServiceRole.entities.CommandLog.create({
    command_type: 'native_order_ops_fallback',
    command_source: source,
    status: status === 'queued_for_review' ? 'skipped' : 'success',
    target_entity: 'ShopifyOrder',
    target_id: record.id || '',
    target_display_id: record.shopify_order_number || '',
    actor_email: 'system',
    actor_role: 'service',
    actor_type: 'system',
    result: {
      action,
      reason,
      production_product_count: demand.product_count,
      production_total_units: demand.total_units,
      inventory_deduction_deferred: true,
      purchase_order_deferred: true,
      notifications_deferred: true,
    },
    idempotency_key: idempotencyKey,
    request_id: requestId,
    function_name: 'shopifyWebhookReceiver',
    completed_at: new Date().toISOString(),
  }).catch(error => {
    console.warn(`[Native ops fallback] CommandLog write failed safely: ${error?.message || 'unknown'}`);
  });
}

async function runNativeOpsFallback(base44, { record, topic, source, reason }) {
  const orderKey = record.shopify_order_number || record.shopify_order_id || 'unknown';
  const idempotencyKey = `native_order_ops:${source}:${orderKey}`;
  const requestId = `shopifyWebhookReceiver:fallback:${topic}:${orderKey}`;
  const demand = productionDemandFor(record);

  if (record.fulfillment_method === 'delivery' && !hasDeliveryAddress(record)) {
    const reviewAction = await createOrUpdateNativeOpsReview(base44, {
      record,
      source,
      topic,
      reason: 'delivery_order_missing_address',
      idempotencyKey,
    });
    await createNativeOpsAuditLogs(base44, {
      record,
      source,
      topic,
      idempotencyKey,
      requestId,
      action: 'queued_for_review',
      status: 'queued_for_review',
      reason: 'delivery_order_missing_address',
      demand,
    });
    return {
      success: false,
      action: 'queued_for_review',
      source,
      error_code: 'delivery_order_missing_address',
      review_queue_action: reviewAction,
      fallback_reason: reason,
    };
  }

  if (record.fulfillment_method === 'delivery' && !record.requested_delivery_date) {
    const reviewAction = await createOrUpdateNativeOpsReview(base44, {
      record,
      source,
      topic,
      reason: 'delivery_order_missing_date',
      idempotencyKey,
    });
    await createNativeOpsAuditLogs(base44, {
      record,
      source,
      topic,
      idempotencyKey,
      requestId,
      action: 'queued_for_review',
      status: 'queued_for_review',
      reason: 'delivery_order_missing_date',
      demand,
    });
    return {
      success: false,
      action: 'queued_for_review',
      source,
      error_code: 'delivery_order_missing_date',
      review_queue_action: reviewAction,
      fallback_reason: reason,
    };
  }

  const fulfillmentTask = await createOrUpdateFallbackFulfillmentTask(base44, { record, idempotencyKey, topic });
  await createNativeOpsAuditLogs(base44, {
    record,
    source,
    topic,
    idempotencyKey,
    requestId,
    action: fulfillmentTask.action === 'not_required' ? 'native_visibility_ready' : `fulfillment_task_${fulfillmentTask.action}`,
    status: 'success',
    reason: `fallback_after_${reason}`,
    demand,
  });

  return {
    success: true,
    action: fulfillmentTask.action === 'not_required' ? 'native_visibility_ready' : `fulfillment_task_${fulfillmentTask.action}`,
    source,
    fallback_reason: reason,
    production_demand: demand,
    native_fulfillment_task: fulfillmentTask,
  };
}

function shouldAttemptNativeOrderOps(record, topic) {
  return Boolean(nativeSourceForOrder(record, topic));
}

function webhookDescription({ topic, nativeOpsAttempted, nativeOpsResult }) {
  if (!NATIVE_ORDER_TOPICS.has(topic) && topic !== 'orders/refunded') {
    return 'Webhook processed. Native order processing is not applicable for this topic.';
  }

  if (!isNativeOrderOpsEnabled()) {
    return 'Webhook processed. Native order processing is disabled; Hub bridge/fallback remains available.';
  }

  if (!nativeOpsAttempted) {
    return 'Webhook processed. Native order processing skipped because the order source or status is outside the supported scope.';
  }

  if (!nativeOpsResult) {
    return 'Webhook processed. Native order processing returned no result; check function logs.';
  }

  const action = nativeOpsResult.action || 'unknown';
  const success = nativeOpsResult.success === true ? 'success' : 'not accepted';
  const source = nativeOpsResult.source || 'unknown';
  const errorCode = nativeOpsResult.error_code ? ` error=${nativeOpsResult.error_code}` : '';
  return `Webhook processed. Native order processing ${success}: source=${source} action=${action}.${errorCode}`;
}

function nativeSourceForOrder(record, topic) {
  if (!isNativeOrderOpsEnabled()) return null;
  if (!NATIVE_ORDER_TOPICS.has(topic)) return null;
  if (record?.is_subscription || record?.source_channel === 'subscription' || record?.order_type === 'subscription') {
    return null;
  }
  if (['refunded', 'partially_refunded'].includes(String(record?.financial_status || record?.payment_status || '').toLowerCase())) {
    return null;
  }
  if (record?.source_channel === 'pos' || record?.source_type === 'shopify_pos' || record?.fulfillment_method === 'pos') {
    return 'shopify_pos';
  }
  if (record?.source_channel === 'online' || record?.source_channel === 'event') {
    return 'website_one_time';
  }
  return null;
}

async function maybeRunNativeOrderOps(base44, record, topic) {
  const source = nativeSourceForOrder(record, topic);
  if (!source) return null;

  const orderKey = record.shopify_order_number || record.shopify_order_id || 'unknown';

  try {
    const response = await base44.asServiceRole.functions.invoke('syncOrderToHub', {
      native_only: true,
      native_source: source,
      event_type: 'order.created',
      data: record,
      request_id: `shopifyWebhookReceiver:${topic}:${orderKey}`,
      idempotency_key: `native_order_ops:${source}:${orderKey}`,
    });
    const envelope = response?.data || response;
    const result = envelope?.native_order_ops || envelope;
    console.log(`[Native order ops] source=${source} order=${orderKey} action=${result?.action || 'unknown'} success=${result?.success === true}`);
    if (!result) {
      return runNativeOpsFallback(base44, {
        record,
        topic,
        source,
        reason: 'empty_native_ops_result',
      });
    }
    return result;
  } catch (error) {
    console.warn(`[Native order ops] failed safely for order=${orderKey}: ${error?.message || 'unknown error'}`);
    return runNativeOpsFallback(base44, {
      record,
      topic,
      source,
      reason: 'native_ops_invoke_failed',
    });
  }
}
