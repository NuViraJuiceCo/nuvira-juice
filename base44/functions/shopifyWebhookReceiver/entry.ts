import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Shopify Webhook Receiver
 * Handles: orders/create, orders/updated, orders/cancelled, orders/paid,
 *          orders/fulfilled, orders/refunded, products/create, products/update
 *
 * Register this URL in Shopify Admin > Settings > Notifications > Webhooks
 * Set your SHOPIFY_WEBHOOK_SECRET in secrets for verification.
 */

const SHOPIFY_WEBHOOK_SECRET = Deno.env.get('SHOPIFY_WEBHOOK_SECRET') || '';
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || '';
const ENABLE_MAY30_NATIVE_ORDER_OPS = Deno.env.get('ENABLE_MAY30_NATIVE_ORDER_OPS') === 'true';
const MAY30_NATIVE_ORDER_TOPICS = new Set(['orders/create', 'orders/paid']);

async function verifyShopifyHmac(req, bodyText) {
  const hmacHeader = req.headers.get('x-shopify-hmac-sha256');
  if (!SHOPIFY_WEBHOOK_SECRET || !hmacHeader) return true; // skip if not configured
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SHOPIFY_WEBHOOK_SECRET),
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
    shopify_raw_payload: order,
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  }

  const bodyText = await req.text();

  // Verify HMAC
  const valid = await verifyShopifyHmac(req, bodyText);
  if (!valid) {
    console.error('Invalid Shopify HMAC signature');
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const topic = req.headers.get('x-shopify-topic') || 'unknown';
  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch (e) {
    console.error('Failed to parse webhook payload:', e.message);
    return Response.json({ error: 'Bad JSON' }, { status: 400 });
  }

  const base44 = createClientFromRequest(req);
  const shopifyOrderId = payload.id ? String(payload.id) : null;
  const orderNumber = String(payload.order_number || payload.name || payload.id || '');

  // Log the webhook
  const webhookLog = await base44.asServiceRole.entities.ShopifyWebhookLog.create({
    topic,
    shopify_order_id: shopifyOrderId,
    shopify_order_number: orderNumber,
    status: 'received',
    payload_preview: bodyText.substring(0, 500),
  });

  console.log(`Webhook received: ${topic} | Order: ${orderNumber}`);

  // Handle product sync topics
  if (topic.startsWith('products/')) {
    await handleProductSync(base44, topic, payload);
    await updateWebhookLog(base44, webhookLog, {
      status: 'processed',
      description: 'Product webhook processed. May 30 order ops not applicable.',
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

  // Idempotency: check for existing record
  const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_id: shopifyOrderId });
  let nativeOpsResult = null;
  let nativeOpsAttempted = false;

  if (topic === 'orders/create' || topic === 'orders/paid') {
    let record;
    let action = 'created';
    if (existing.length > 0) {
      const updates = mapToShopifyOrder(payload);
      record = await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, {
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
      console.log(`Updated existing ShopifyOrder for ${topic} #${orderNumber}`);
    } else {
      record = mapToShopifyOrder(payload);
      record = await base44.asServiceRole.entities.ShopifyOrder.create(record);
      console.log(`Created ShopifyOrder for #${orderNumber}`);
    }

    // Create operational alert
    if (action === 'created') {
      await createAlert(base44, 'new_order', `New Order #${orderNumber}`, `${record.customer_name} · $${record.total_price?.toFixed(2)}`, shopifyOrderId, orderNumber, 'info');

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
    nativeOpsAttempted = shouldAttemptMay30NativeOrderOps(record, topic);
    nativeOpsResult = await maybeRunMay30NativeOrderOps(base44, record, topic);

  } else if (topic === 'orders/updated') {
    if (existing.length > 0) {
      const updates = mapToShopifyOrder(payload);
      await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, {
        shopify_fulfillment_status: updates.shopify_fulfillment_status,
        financial_status: updates.financial_status,
        customer_notes: updates.customer_notes,
        line_items: updates.line_items,
        total_price: updates.total_price,
        total_discounts: updates.total_discounts,
        shopify_synced_at: new Date().toISOString(),
      });
      console.log(`Updated ShopifyOrder #${orderNumber}`);
    } else {
      // Order not in Base44 yet — create it
      const created = await base44.asServiceRole.entities.ShopifyOrder.create(mapToShopifyOrder(payload));
      nativeOpsAttempted = shouldAttemptMay30NativeOrderOps(created, topic);
      nativeOpsResult = await maybeRunMay30NativeOrderOps(base44, created, topic);
      console.log(`Created missing ShopifyOrder #${orderNumber} from update event`);
    }

  } else if (topic === 'orders/cancelled') {
    if (existing.length > 0) {
      await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, {
        production_status: 'canceled',
        shopify_fulfillment_status: 'cancelled',
        shopify_synced_at: new Date().toISOString(),
      });
      await createAlert(base44, 'cancellation', `Order Canceled #${orderNumber}`, `${payload.customer?.first_name || ''} ${payload.customer?.last_name || ''} canceled their order`, shopifyOrderId, orderNumber, 'warning');
    }

  } else if (topic === 'orders/refunded') {
    if (existing.length > 0) {
      await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, {
        production_status: 'refunded',
        financial_status: 'refunded',
        shopify_synced_at: new Date().toISOString(),
      });
      await createAlert(base44, 'refund', `Refund #${orderNumber}`, `Refund processed for ${payload.customer?.first_name || ''} — $${payload.total_price || '?'}`, shopifyOrderId, orderNumber, 'info');
    }

  } else if (topic === 'orders/fulfilled') {
    if (existing.length > 0) {
      await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, {
        shopify_fulfillment_status: 'fulfilled',
        shopify_synced_at: new Date().toISOString(),
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
  await base44.asServiceRole.entities.OperationalAlert.create({
    alert_type: alertType, title, message,
    shopify_order_id: shopifyOrderId,
    order_number: orderNumber,
    severity, is_read: false, resolved: false,
  });
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
    issue_description: `May 30 native order ops fallback queued order for review: ${reason}`,
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
    notes: `May 30 native fallback task from ${topic}; idempotency=${idempotencyKey}`,
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
    sync_source: 'may30_shopify_webhook_fallback',
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
    console.warn(`[May30 native ops fallback] OrderSyncLog write failed safely: ${error?.message || 'unknown'}`);
  });

  await base44.asServiceRole.entities.CommandLog.create({
    command_type: 'may30_native_order_ops_fallback',
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
    console.warn(`[May30 native ops fallback] CommandLog write failed safely: ${error?.message || 'unknown'}`);
  });
}

async function runMay30NativeOpsFallback(base44, { record, topic, source, reason }) {
  const orderKey = record.shopify_order_number || record.shopify_order_id || 'unknown';
  const idempotencyKey = `may30_native_order_ops:${source}:${orderKey}`;
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

function shouldAttemptMay30NativeOrderOps(record, topic) {
  return Boolean(may30NativeSourceForOrder(record, topic));
}

function webhookDescription({ topic, nativeOpsAttempted, nativeOpsResult }) {
  if (!MAY30_NATIVE_ORDER_TOPICS.has(topic)) {
    return 'Webhook processed. May 30 native order ops not applicable for this topic.';
  }

  if (!ENABLE_MAY30_NATIVE_ORDER_OPS) {
    return 'Webhook processed. May 30 native order ops is disabled; Hub bridge/fallback remains available.';
  }

  if (!nativeOpsAttempted) {
    return 'Webhook processed. May 30 native order ops skipped because order source/status is out of launch scope.';
  }

  if (!nativeOpsResult) {
    return 'Webhook processed. May 30 native order ops attempted but returned no result; check function console logs.';
  }

  const action = nativeOpsResult.action || 'unknown';
  const success = nativeOpsResult.success === true ? 'success' : 'not accepted';
  const source = nativeOpsResult.source || 'unknown';
  const errorCode = nativeOpsResult.error_code ? ` error=${nativeOpsResult.error_code}` : '';
  return `Webhook processed. May 30 native order ops ${success}: source=${source} action=${action}.${errorCode}`;
}

function may30NativeSourceForOrder(record, topic) {
  if (!ENABLE_MAY30_NATIVE_ORDER_OPS) return null;
  if (!MAY30_NATIVE_ORDER_TOPICS.has(topic)) return null;
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

async function maybeRunMay30NativeOrderOps(base44, record, topic) {
  const source = may30NativeSourceForOrder(record, topic);
  if (!source) return null;

  const orderKey = record.shopify_order_number || record.shopify_order_id || 'unknown';

  try {
    const response = await base44.asServiceRole.functions.invoke('processMay30NativeOrderOps', {
      mode: 'live',
      source,
      event_type: 'order.created',
      order: record,
      request_id: `shopifyWebhookReceiver:${topic}:${orderKey}`,
      idempotency_key: `may30_native_order_ops:${source}:${orderKey}`,
      internal_secret: CUSTOMER_APP_SYNC_SECRET,
    });
    const result = response?.data || response;
    console.log(`[May30 native order ops] source=${source} order=${orderKey} action=${result?.action || 'unknown'} success=${result?.success === true}`);
    if (!result) {
      return runMay30NativeOpsFallback(base44, {
        record,
        topic,
        source,
        reason: 'empty_native_ops_result',
      });
    }
    return result;
  } catch (error) {
    console.warn(`[May30 native order ops] failed safely for order=${orderKey}: ${error?.message || 'unknown error'}`);
    return runMay30NativeOpsFallback(base44, {
      record,
      topic,
      source,
      reason: 'native_ops_invoke_failed',
    });
  }
}
