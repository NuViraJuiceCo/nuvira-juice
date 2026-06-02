import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ENABLE_MAY30_NATIVE_ORDER_OPS = Deno.env.get('ENABLE_MAY30_NATIVE_ORDER_OPS') === 'true';
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || '';
const MAY30_NATIVE_ORDER_OPS_SECRET = Deno.env.get('MAY30_NATIVE_ORDER_OPS_SECRET') || CUSTOMER_APP_SYNC_SECRET;

const SUPPORTED_SOURCES = new Set(['customer_app_one_time', 'website_one_time', 'shopify_pos']);
const MAX_LINE_ITEMS = 60;

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function sanitizeText(value, maxLength = 180) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeStringArray(values, limit = 20) {
  if (!Array.isArray(values)) return [];
  return values.map(value => sanitizeText(value, 80)).filter(Boolean).slice(0, limit);
}

async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function uniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(value => sanitizeText(value, 80)).filter(Boolean)));
}

function normalizeOrderNumber(order) {
  return normalizeText(order?.shopify_order_number || order?.order_number || order?.name).replace(/^#/, '');
}

function normalizePaymentStatus(order, source) {
  const status = normalizeLower(order?.payment_status || order?.financial_status);
  if (status === 'paid' || status === 'succeeded' || order?.payment_captured === true) return 'paid';
  if (source === 'shopify_pos' && !status) return 'paid';
  if (status === 'refunded') return 'refunded';
  if (status === 'partially_refunded') return 'partially_refunded';
  return status || 'pending';
}

function sanitizeLineItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, MAX_LINE_ITEMS).map(item => {
    const title = sanitizeText(item?.title || item?.name || item?.product_title, 160);
    const quantity = safeNumber(item?.quantity, 0);
    const price = item?.price === undefined || item?.price === null ? null : safeNumber(item.price, 0);
    return {
      shopify_line_item_id: sanitizeText(item?.shopify_line_item_id || item?.id, 120),
      title,
      variant_title: sanitizeText(item?.variant_title, 120),
      sku: sanitizeText(item?.sku, 80),
      quantity,
      price,
      total_discount: item?.total_discount === undefined || item?.total_discount === null ? null : safeNumber(item.total_discount, 0),
    };
  }).filter(item => item.title && item.quantity > 0);
}

function compactObject(value) {
  const out = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (item !== undefined && item !== null && item !== '') out[key] = item;
  }
  return out;
}

function hasCompleteDeliveryAddress(order) {
  return Boolean(
    normalizeText(order?.address_line1 || order?.delivery_address?.address_line1 || order?.delivery_address?.address1) &&
    normalizeText(order?.address_city || order?.delivery_address?.city) &&
    normalizeText(order?.address_state || order?.delivery_address?.state || order?.delivery_address?.province) &&
    normalizeText(order?.address_postal_code || order?.delivery_address?.postal_code || order?.delivery_address?.zip)
  );
}

function addressFromOrder(order) {
  const deliveryAddress = typeof order?.delivery_address === 'object' && order.delivery_address !== null
    ? order.delivery_address
    : {};

  return {
    address_line1: sanitizeText(order?.address_line1 || deliveryAddress.address_line1 || deliveryAddress.address1, 180),
    address_line2: sanitizeText(order?.address_line2 || deliveryAddress.address_line2 || deliveryAddress.address2, 120),
    address_city: sanitizeText(order?.address_city || deliveryAddress.city, 100),
    address_state: sanitizeText(order?.address_state || deliveryAddress.state || deliveryAddress.province, 80),
    address_postal_code: sanitizeText(order?.address_postal_code || deliveryAddress.postal_code || deliveryAddress.zip, 40),
    address_country: sanitizeText(order?.address_country || deliveryAddress.country || deliveryAddress.country_code || 'US', 40),
    delivery_address: typeof order?.delivery_address === 'string'
      ? sanitizeText(order.delivery_address, 280)
      : sanitizeText(order?.address_line1 || deliveryAddress.address1 || deliveryAddress.address_line1, 280),
  };
}

function firstFulfillmentDate(order) {
  const firstFulfillment = Array.isArray(order?.fulfillments)
    ? order.fulfillments.find(fulfillment => (
        fulfillment?.delivery_date ||
        fulfillment?.assigned_delivery_date ||
        fulfillment?.selected_delivery_date ||
        fulfillment?.requested_delivery_date ||
        fulfillment?.scheduled_date
      ))
    : null;
  return firstFulfillment?.delivery_date ||
    firstFulfillment?.assigned_delivery_date ||
    firstFulfillment?.selected_delivery_date ||
    firstFulfillment?.requested_delivery_date ||
    firstFulfillment?.scheduled_date ||
    order?.first_fulfillment?.delivery_date ||
    order?.first_fulfillment?.assigned_delivery_date ||
    order?.first_fulfillment?.selected_delivery_date ||
    order?.first_fulfillment?.requested_delivery_date ||
    null;
}

function deliveryDateForOrder(order) {
  return sanitizeText(
    order?.assigned_delivery_date ||
    order?.estimated_delivery_date ||
    order?.requested_delivery_date ||
    order?.delivery_date ||
    order?.selected_delivery_date ||
    order?.first_delivery_date ||
    firstFulfillmentDate(order),
    40,
  );
}

function isSubscriptionLike(order) {
  return normalizeLower(order?.order_type) === 'subscription' ||
    normalizeLower(order?.source_channel) === 'subscription' ||
    Boolean(order?.stripe_subscription_id);
}

function isRefundLike(order, eventType) {
  return normalizeLower(eventType).includes('refund') ||
    ['refunded', 'partially_refunded'].includes(normalizePaymentStatus(order, ''));
}

function isRefundEvent(eventType) {
  return normalizeLower(eventType) === 'order.refunded';
}

function buildProductionDemand(lineItems) {
  const byTitle = new Map();
  for (const item of lineItems) {
    const title = item.title || 'Unknown product';
    const current = byTitle.get(title) || { product_name: title, quantity: 0 };
    current.quantity += safeNumber(item.quantity, 0);
    byTitle.set(title, current);
  }
  const products = Array.from(byTitle.values());
  return {
    product_count: products.length,
    total_units: products.reduce((sum, item) => sum + item.quantity, 0),
    products,
  };
}

function buildSafeReviewPayload({ source, eventType, order, lineItems, paymentStatus, fulfillmentMethod }) {
  return {
    source,
    event_type: eventType,
    order_id: sanitizeText(order?.id || order?.shopify_order_id, 120),
    order_number: sanitizeText(normalizeOrderNumber(order), 120),
    payment_status: sanitizeText(paymentStatus, 60),
    fulfillment_method: sanitizeText(fulfillmentMethod, 60),
    line_item_count: lineItems.length,
    total_price: safeNumber(order?.total_price ?? order?.total, 0),
    has_complete_delivery_address: hasCompleteDeliveryAddress(order),
    production_date_present: Boolean(order?.production_date),
    assigned_delivery_date_present: Boolean(deliveryDateForOrder(order)),
  };
}

async function resolveAuth({ base44, req, body, mode }) {
  const authHeader = req.headers.get('authorization') || '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const bodySecret = normalizeText(body?.internal_secret || body?._internal_secret);
  if (MAY30_NATIVE_ORDER_OPS_SECRET && (bearer === MAY30_NATIVE_ORDER_OPS_SECRET || bodySecret === MAY30_NATIVE_ORDER_OPS_SECRET)) {
    return { ok: true, actor_type: 'system', actor_role: 'service', actor_email: 'system' };
  }

  try {
    const user = await base44.auth.me();
    if (user?.role === 'admin' && mode === 'dry_run') {
      return { ok: true, actor_type: 'admin', actor_role: 'admin', actor_email: user.email || 'admin' };
    }
  } catch {
    // Fall through to unauthorized.
  }

  return { ok: false };
}

async function findExistingOrder(base44, record) {
  const candidates = [];
  if (record.base44_order_id) candidates.push({ base44_order_id: record.base44_order_id });
  if (record.shopify_order_id) candidates.push({ shopify_order_id: record.shopify_order_id });
  if (record.shopify_order_number) candidates.push({ shopify_order_number: record.shopify_order_number });

  for (const filter of candidates) {
    const matches = await base44.asServiceRole.entities.ShopifyOrder.filter(filter, '-created_date', 5).catch(() => []);
    if (Array.isArray(matches) && matches.length > 0) return matches[0];
  }

  return null;
}

async function findExistingOrderForIncoming(base44, order) {
  const record = {
    base44_order_id: sanitizeText(order?.id, 120),
    shopify_order_id: sanitizeText(order?.shopify_order_id, 140),
    shopify_order_number: sanitizeText(normalizeOrderNumber(order), 120),
  };
  return findExistingOrder(base44, record);
}

function buildOneTimeRecord({ order, source, eventType, lineItems, paymentStatus }) {
  const orderNumber = normalizeOrderNumber(order);
  const fulfillmentMethod = normalizeLower(order?.fulfillment_method || order?.fulfillment_type) || 'delivery';
  const address = addressFromOrder(order);
  const now = new Date().toISOString();
  const productionDemand = buildProductionDemand(lineItems);
  const fulfillment = {
    fulfillment_number: 1,
    status: 'pending',
    fulfillment_method: fulfillmentMethod,
    delivery_date: deliveryDateForOrder(order),
    production_date: sanitizeText(order?.production_date, 40),
    delivery_window_label: sanitizeText(order?.delivery_window_label, 120),
    line_items: lineItems,
  };

  return {
    record: compactObject({
      shopify_order_id: sanitizeText(order?.shopify_order_id || `customer_app:${order?.id || orderNumber}`, 140),
      shopify_order_number: sanitizeText(orderNumber, 120),
      base44_order_id: sanitizeText(order?.id, 120),
      source_channel: 'online',
      source_type: source,
      order_type: 'one_time',
      fulfillment_method: fulfillmentMethod,
      fulfillment_mode: 'single_delivery',
      customer_name: sanitizeText(order?.customer_name, 160),
      customer_email: sanitizeText(order?.customer_email, 180),
      customer_phone: sanitizeText(order?.customer_phone || order?.contact_phone, 80),
      line_items: lineItems,
      subtotal: safeNumber(order?.subtotal, 0),
      total_price: safeNumber(order?.total_price ?? order?.total, 0),
      delivery_fee: safeNumber(order?.delivery_fee, 0),
      payment_status: paymentStatus,
      fulfillment_status: fulfillmentMethod === 'delivery' ? 'pending' : 'pending_pickup',
      production_status: 'awaiting_production',
      order_lock_status: 'verified',
      data_quality_status: 'complete',
      sync_status: 'native_may30_ready',
      last_sync_at: now,
      customer_order_date: sanitizeText(order?.created_date || order?.customer_order_date || now, 80),
      requested_delivery_date: sanitizeText(order?.requested_delivery_date || order?.estimated_delivery_date, 40),
      selected_delivery_date: sanitizeText(order?.selected_delivery_date || order?.assigned_delivery_date || order?.estimated_delivery_date, 40),
      assigned_delivery_date: deliveryDateForOrder(order),
      production_date: sanitizeText(order?.production_date, 40),
      delivery_window_label: sanitizeText(order?.delivery_window_label, 120),
      delivery_window_start: sanitizeText(order?.delivery_window_start, 80),
      delivery_window_end: sanitizeText(order?.delivery_window_end, 80),
      customer_notes: sanitizeText(order?.customer_notes || order?.notes, 300),
      stripe_checkout_session_id: sanitizeText(order?.stripe_checkout_session_id, 160),
      stripe_payment_intent_id: sanitizeText(order?.stripe_payment_intent_id, 160),
      tags: ['may30_native_ops', source, fulfillmentMethod].filter(Boolean),
      fulfillments: [fulfillment],
      audit_trail: [{
        at: now,
        source: 'processMay30NativeOrderOps',
        action: 'native_operational_mirror_prepared',
        event_type: eventType,
        production_units: productionDemand.total_units,
      }],
      ...address,
    }),
    fulfillment_need: {
      requires_delivery: fulfillmentMethod === 'delivery',
      requires_fulfillment_task: fulfillmentMethod === 'delivery',
      status: fulfillmentMethod === 'delivery' ? 'delivery_fulfillment_needed' : 'pickup_visibility_needed',
      fulfillment_count: 1,
    },
    production_demand: productionDemand,
    ingredient_procurement_need: {
      status: 'hub_backed_planning_required',
      procurement_needed: true,
      stock_deduction_deferred: true,
      purchase_order_deferred: true,
      note: 'Native order mirror records product demand; detailed recipe and ingredient procurement remain Hub-backed for May 30.',
    },
  };
}

function buildPosRecord({ order, source, eventType, lineItems, paymentStatus }) {
  const orderNumber = normalizeOrderNumber(order);
  const now = new Date().toISOString();
  const productionDemand = buildProductionDemand(lineItems);
  const locationLabel = sanitizeText(order?.event_location || order?.location_name || order?.location_label, 160);

  return {
    record: compactObject({
      shopify_order_id: sanitizeText(order?.shopify_order_id || order?.id || `pos:${orderNumber}`, 140),
      shopify_order_number: sanitizeText(orderNumber, 120),
      source_channel: 'pos',
      source_type: 'shopify_pos',
      order_type: 'pos',
      fulfillment_method: 'pos',
      fulfillment_mode: 'single_delivery',
      customer_name: sanitizeText(order?.customer_name || 'POS Customer', 160),
      customer_email: sanitizeText(order?.customer_email || `pos-${orderNumber || 'order'}@nuvira.local`, 180),
      customer_phone: sanitizeText(order?.customer_phone, 80),
      line_items: lineItems,
      subtotal: safeNumber(order?.subtotal ?? order?.total_price ?? order?.total, 0),
      total_price: safeNumber(order?.total_price ?? order?.total, 0),
      payment_status: paymentStatus || 'paid',
      fulfillment_status: 'fulfilled',
      production_status: 'not_required',
      order_lock_status: 'fulfilled',
      data_quality_status: 'complete',
      sync_status: 'native_may30_ready',
      last_sync_at: now,
      customer_order_date: sanitizeText(order?.created_at || order?.order_date || order?.customer_order_date || now, 80),
      event_name: sanitizeText(order?.event_name, 120),
      event_date: sanitizeText(order?.event_date, 40),
      event_location: locationLabel,
      internal_notes: sanitizeText(`POS/event order mirrored for May 30 operations${locationLabel ? ` - ${locationLabel}` : ''}`, 300),
      tags: ['may30_native_ops', 'pos_sale', 'event_sale', 'no_delivery', 'no_production'],
      fulfillments: [],
      audit_trail: [{
        at: now,
        source: 'processMay30NativeOrderOps',
        action: 'native_pos_operational_mirror_prepared',
        event_type: eventType,
        item_units: productionDemand.total_units,
      }],
      address_country: 'US',
    }),
    fulfillment_need: {
      requires_delivery: false,
      requires_fulfillment_task: false,
      status: 'pos_fulfilled_no_delivery',
      fulfillment_count: 0,
    },
    production_demand: {
      ...productionDemand,
      status: 'not_required_for_pos_sale',
    },
    ingredient_procurement_need: {
      status: 'not_required_for_pos_sale',
      procurement_needed: false,
      stock_deduction_deferred: true,
      purchase_order_deferred: true,
    },
  };
}

function validationError({ source, eventType, order, lineItems, paymentStatus, fulfillmentMethod }) {
  if (!SUPPORTED_SOURCES.has(source)) return { code: 'unsupported_source', incident_type: 'unsupported_source' };
  if (isRefundLike(order, eventType)) return { code: 'refund_out_of_scope', incident_type: 'refund_out_of_scope' };
  if (isSubscriptionLike(order)) return { code: 'subscription_out_of_scope', incident_type: 'subscription_out_of_scope' };
  if (!normalizeOrderNumber(order)) return { code: 'missing_order_number', incident_type: 'missing_order_identifier' };
  if (paymentStatus !== 'paid') return { code: 'payment_not_paid', incident_type: 'payment_not_paid' };
  if (lineItems.length === 0) return { code: 'missing_line_items', incident_type: 'missing_line_items' };
  if (source !== 'shopify_pos' && fulfillmentMethod === 'delivery' && !hasCompleteDeliveryAddress(order)) {
    return { code: 'delivery_order_missing_address', incident_type: 'missing_customer_info' };
  }
  if (source !== 'shopify_pos' && fulfillmentMethod === 'delivery' && !deliveryDateForOrder(order)) {
    return { code: 'delivery_order_missing_date', incident_type: 'missing_fulfillment_date' };
  }
  return null;
}

async function createOrUpdateReviewQueue({ base44, incidentType, errorCode, source, eventType, order, lineItems, paymentStatus, fulfillmentMethod, idempotencyKey, mode }) {
  const draft = {
    incident_type: incidentType,
    customer_email: sanitizeText(order?.customer_email, 180),
    customer_name: sanitizeText(order?.customer_name, 160),
    incoming_source: source,
    incoming_payload: buildSafeReviewPayload({ source, eventType, order, lineItems, paymentStatus, fulfillmentMethod }),
    issue_description: sanitizeText(`May 30 native order ops rejected order: ${errorCode}`, 220),
    recommended_action: 'manual_review_before_operational_processing',
    status: 'pending',
    idempotency_key: idempotencyKey,
    occurrence_count: 1,
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  };

  if (mode !== 'live') return { draft, action: 'drafted' };

  const existing = await base44.asServiceRole.entities.OrderReviewQueue.filter({ idempotency_key: idempotencyKey }, '-created_date', 1).catch(() => []);
  if (Array.isArray(existing) && existing.length > 0) {
    const current = existing[0];
    const occurrenceCount = safeNumber(current.occurrence_count, 1) + 1;
    const updated = await base44.asServiceRole.entities.OrderReviewQueue.update(current.id, {
      occurrence_count: occurrenceCount,
      last_seen_at: new Date().toISOString(),
      issue_description: draft.issue_description,
    });
    return { record: updated, action: 'updated' };
  }

  const created = await base44.asServiceRole.entities.OrderReviewQueue.create(draft);
  return { record: created, action: 'created' };
}

async function createOrderSyncLog({ base44, record, action, status, reason, fieldsUpdated, fieldsRejected, errorCode, idempotencyKey, requestId, source, eventType, mode }) {
  if (mode !== 'live') return null;
  return base44.asServiceRole.entities.OrderSyncLog.create({
    order_number: record?.shopify_order_number || 'unknown',
    status,
    sync_timestamp: new Date().toISOString(),
    sync_source: 'may30_native_order_ops',
    event_type: eventType,
    order_id: record?.id || null,
    action,
    reason: sanitizeText(reason, 300),
    fields_updated: safeStringArray(fieldsUpdated, 80),
    fields_rejected: safeStringArray(fieldsRejected, 80),
    success: status === 'success' || status === 'deduped',
    error_code: errorCode || null,
    idempotency_key: idempotencyKey,
    request_id: requestId,
    correlation_id: `${source}:${record?.shopify_order_number || 'unknown'}`,
  }).catch(error => {
    console.warn(`[processMay30NativeOrderOps] OrderSyncLog write failed safely: ${error?.message || 'unknown'}`);
    return null;
  });
}

async function createCommandLog({ base44, record, action, status, idempotencyKey, requestId, source, eventType, outputs, mode }) {
  if (mode !== 'live') return null;
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: 'may30_native_order_ops',
    command_source: source,
    status,
    target_entity: 'ShopifyOrder',
    target_id: record?.id || null,
    target_display_id: record?.shopify_order_number || null,
    actor_email: 'system',
    actor_role: 'service',
    actor_type: 'system',
    payload: {
      source,
      event_type: eventType,
      order_number: record?.shopify_order_number || null,
    },
    result: {
      action,
      production_product_count: outputs?.production_demand?.product_count || 0,
      production_total_units: outputs?.production_demand?.total_units || 0,
      fulfillment_status: outputs?.fulfillment_need?.status || null,
      ingredient_procurement_status: outputs?.ingredient_procurement_need?.status || null,
    },
    idempotency_key: idempotencyKey,
    request_id: requestId,
    function_name: 'processMay30NativeOrderOps',
    completed_at: new Date().toISOString(),
  }).catch(error => {
    console.warn(`[processMay30NativeOrderOps] CommandLog write failed safely: ${error?.message || 'unknown'}`);
    return null;
  });
}

async function handleNativeRefundMirror({ base44, source, eventType, order, idempotencyKey, requestId, mode }) {
  const orderNumber = normalizeOrderNumber(order);
  if (!SUPPORTED_SOURCES.has(source)) {
    return Response.json({
      success: false,
      dry_run: mode !== 'live',
      action: 'queued_for_review',
      error_code: 'unsupported_source',
      order_number: orderNumber || null,
      hub_bridge_fallback: true,
    }, { status: 202 });
  }
  if (isSubscriptionLike(order)) {
    return Response.json({
      success: true,
      skipped: true,
      dry_run: mode !== 'live',
      action: 'skipped',
      error_code: 'subscription_refund_out_of_scope',
      order_number: orderNumber || null,
      hub_bridge_fallback: true,
    });
  }

  const existing = await findExistingOrderForIncoming(base44, order);
  const now = new Date().toISOString();
  const refundId = sanitizeText(order?.refund_id, 160) || sanitizeText(order?.stripe_charge_id, 160) || 'stripe_refund';
  const refundAmount = order?.refund_amount === undefined || order?.refund_amount === null ? null : safeNumber(order.refund_amount, 0);

  if (!existing) {
    const review = await createOrUpdateReviewQueue({
      base44,
      incidentType: 'native_refund_mirror_missing_order',
      errorCode: 'native_refund_mirror_missing_order',
      source,
      eventType,
      order,
      lineItems: sanitizeLineItems(order?.line_items || order?.items),
      paymentStatus: 'refunded',
      fulfillmentMethod: normalizeLower(order?.fulfillment_method || order?.fulfillment_type) || 'delivery',
      idempotencyKey,
      mode,
    });
    await createOrderSyncLog({
      base44,
      record: { shopify_order_number: orderNumber },
      action: 'rejected',
      status: 'rejected',
      reason: 'native refund mirror could not find existing ShopifyOrder mirror',
      fieldsUpdated: [],
      fieldsRejected: ['native_refund_mirror_missing_order'],
      errorCode: 'native_refund_mirror_missing_order',
      idempotencyKey,
      requestId,
      source,
      eventType,
      mode,
    });

    return Response.json({
      success: false,
      dry_run: mode !== 'live',
      action: 'queued_for_review',
      error_code: 'native_refund_mirror_missing_order',
      order_number: orderNumber || null,
      review_queue_action: review.action,
      order_review_queue_draft: mode === 'live' ? null : review.draft,
      hub_bridge_fallback: true,
    }, { status: 202 });
  }

  const alreadyRefunded = normalizeLower(existing.payment_status) === 'refunded' &&
    ['canceled', 'cancelled', 'refunded'].includes(normalizeLower(existing.production_status || existing.order_status));
  const existingLogs = mode === 'live'
    ? await base44.asServiceRole.entities.OrderSyncLog.filter({ idempotency_key: idempotencyKey }, '-created_date', 1).catch(() => [])
    : [];

  if (alreadyRefunded && existingLogs.length > 0) {
    return Response.json({
      success: true,
      skipped: true,
      dry_run: mode !== 'live',
      action: 'skipped',
      order_id: existing.id,
      order_number: existing.shopify_order_number || orderNumber,
      reason: 'already_refunded_idempotent',
      native_refund_mirror: { order_updated: false, fulfillment_tasks_cancelled: 0 },
      hub_bridge_fallback: true,
    });
  }

  const tags = uniqueStrings([...(existing.tags || []), 'may30_native_ops', 'refunded', 'excluded']);
  const auditEntry = {
    at: now,
    source: 'processMay30NativeOrderOps',
    action: 'native_refund_mirror_applied',
    event_type: eventType,
    request_id: requestId,
    refund_id: refundId,
  };
  const fulfillments = Array.isArray(existing.fulfillments)
    ? existing.fulfillments.map(fulfillment => ({ ...fulfillment, status: 'cancelled', payment_status: 'refunded' }))
    : existing.fulfillments;
  const patch = compactObject({
    payment_status: 'refunded',
    financial_status: 'refunded',
    production_status: 'canceled',
    fulfillment_status: 'cancelled',
    order_status: 'refunded',
    operational_visibility: 'archived',
    sync_status: 'native_may30_refunded',
    data_quality_status: existing.data_quality_status || 'complete',
    excluded_from_production: true,
    refunded_at: sanitizeText(order?.refunded_at, 80) || now,
    cancel_type: 'stripe_refund',
    stripe_charge_id: sanitizeText(order?.refund_id, 160) || existing.stripe_charge_id,
    stripe_payment_intent_id: sanitizeText(order?.stripe_payment_intent_id, 160) || existing.stripe_payment_intent_id,
    tags,
    fulfillments,
    internal_notes: sanitizeText(`${existing.internal_notes || ''}\n[May30 native refund mirror] ${refundId} on ${now}`, 1200),
    audit_trail: [...(existing.audit_trail || []), auditEntry],
    last_sync_at: now,
  });

  let writtenRecord = existing;
  let taskUpdateResult = { action: mode === 'live' ? 'not_run' : 'would_cancel', count: 0 };

  if (mode === 'live') {
    writtenRecord = await base44.asServiceRole.entities.ShopifyOrder.update(existing.id, patch);
    const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({ order_id: existing.id }, '-created_date', 20).catch(() => []);
    let cancelledCount = 0;
    for (const task of tasks || []) {
      if (normalizeLower(task.status) === 'cancelled' || normalizeLower(task.status) === 'delivered') continue;
      await base44.asServiceRole.entities.FulfillmentTask.update(task.id, {
        status: 'cancelled',
        notes: sanitizeText(`${task.notes || ''}\nCancelled by native May 30 refund mirror for ${orderNumber || existing.shopify_order_number}.`, 500),
      });
      cancelledCount += 1;
    }
    taskUpdateResult = { action: 'cancelled', count: cancelledCount };

    await createOrderSyncLog({
      base44,
      record: writtenRecord,
      action: 'refund_mirrored',
      status: 'success',
      reason: `Native May 30 refund mirror applied. Refund amount=${refundAmount ?? 'unknown'}.`,
      fieldsUpdated: ['payment_status', 'financial_status', 'production_status', 'fulfillment_status', 'order_status', 'sync_status', 'excluded_from_production', 'refunded_at'],
      fieldsRejected: [],
      errorCode: null,
      idempotencyKey,
      requestId,
      source,
      eventType,
      mode,
    });

    await createCommandLog({
      base44,
      record: writtenRecord,
      action: 'refund_mirrored',
      status: 'success',
      idempotencyKey,
      requestId,
      source,
      eventType,
      outputs: {
        production_demand: { product_count: 0, total_units: 0 },
        fulfillment_need: { status: 'cancelled_by_refund' },
        ingredient_procurement_need: { status: 'not_required_refunded' },
      },
      mode,
    });
  }

  return Response.json({
    success: true,
    dry_run: mode !== 'live',
    action: mode === 'live' ? 'refund_mirrored' : 'would_mirror_refund',
    order_id: writtenRecord.id,
    order_number: writtenRecord.shopify_order_number || orderNumber,
    native_refund_mirror: {
      payment_status: 'refunded',
      production_status: 'canceled',
      fulfillment_status: 'cancelled',
      excluded_from_production: true,
      fulfillment_tasks_cancelled: taskUpdateResult.count,
      fulfillment_task_action: taskUpdateResult.action,
    },
    inventory_deduction_deferred: true,
    purchase_order_deferred: true,
    notifications_deferred: true,
    provider_calls_deferred: true,
    hub_bridge_fallback: true,
  });
}

async function createOrUpdateNativeFulfillmentTask({ base44, shopifyOrder, outputs, idempotencyKey, requestId, source, eventType, mode }) {
  const fulfillmentNeed = outputs?.fulfillment_need || {};
  if (!fulfillmentNeed.requires_fulfillment_task) {
    return { action: 'not_required', record: null };
  }

  const deliveryDate = outputs?.record?.assigned_delivery_date || outputs?.record?.selected_delivery_date || outputs?.record?.requested_delivery_date;
  if (!deliveryDate || !shopifyOrder?.id) {
    return {
      action: 'skipped',
      record: null,
      reason: !deliveryDate ? 'missing_delivery_date' : 'missing_native_order_id',
    };
  }

  const draft = {
    order_id: shopifyOrder.id,
    customer_email: outputs.record.customer_email,
    fulfillment_number: 1,
    delivery_date: deliveryDate,
    items: Array.isArray(outputs.record.line_items)
      ? outputs.record.line_items.map(item => ({
          product_id: item.shopify_line_item_id || '',
          title: item.title || 'Item',
          price: item.price ?? 0,
          quantity: item.quantity ?? 0,
        }))
      : [],
    status: 'pending',
    notes: sanitizeText(
      `Native May 30 delivery task mirror. Source=${source}; event=${eventType}; request=${requestId}; idempotency=${idempotencyKey}`,
      500,
    ),
  };

  if (mode !== 'live') return { action: 'would_create_or_update', draft };

  const existing = await base44.asServiceRole.entities.FulfillmentTask.filter({
    order_id: shopifyOrder.id,
    fulfillment_number: 1,
  }, '-created_date', 1).catch(() => []);

  if (Array.isArray(existing) && existing.length > 0) {
    const updated = await base44.asServiceRole.entities.FulfillmentTask.update(existing[0].id, {
      customer_email: draft.customer_email,
      delivery_date: draft.delivery_date,
      items: draft.items,
      notes: draft.notes,
    });
    return { action: 'updated', record: updated };
  }

  const created = await base44.asServiceRole.entities.FulfillmentTask.create(draft);
  return { action: 'created', record: created };
}

async function runPlanner({ base44, source, record, existing, idempotencyKey }) {
  const plannerPayload = { ...record };
  if (source !== 'shopify_pos') {
    delete plannerPayload.shopify_order_id;
  }

  const plannerResponse = await base44.asServiceRole.functions.invoke('previewNativeSafeSyncOrderUpdate', {
    mode: 'dry_run',
    fixture_id: 'may30_native_order_ops',
    source: source === 'shopify_pos' ? 'admin' : 'customer_app',
    idempotency_key: idempotencyKey,
    incoming_payload: plannerPayload,
    starting_order: existing || null,
  });
  return plannerResponse?.data || plannerResponse;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', message: 'POST required' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const body = await readJsonBody(req);
    if (body === null) {
      return Response.json({ success: false, error_code: 'malformed_json', message: 'Malformed JSON body' }, { status: 400 });
    }

    const mode = body?.mode === 'live' ? 'live' : 'dry_run';
    const auth = await resolveAuth({ base44, req, body, mode });
    if (!auth.ok) {
      return Response.json({ success: false, error_code: 'unauthorized', message: 'Unauthorized' }, { status: 401 });
    }

    if (mode === 'live' && !ENABLE_MAY30_NATIVE_ORDER_OPS) {
      return Response.json({
        success: true,
        skipped: true,
        dry_run: false,
        action: 'skipped',
        error_code: 'may30_native_order_ops_disabled',
        message: 'May 30 native order ops is disabled; existing Hub bridge remains the fallback.',
      });
    }

    const source = normalizeLower(body?.source || body?.order?.source_type || 'customer_app_one_time');
    const eventType = normalizeText(body?.event_type || body?.event || 'order.created') || 'order.created';
    const order = body?.order && typeof body.order === 'object' ? body.order : {};
    const lineItems = sanitizeLineItems(order.line_items || order.items);
    const paymentStatus = normalizePaymentStatus(order, source);
    const fulfillmentMethod = source === 'shopify_pos'
      ? 'pos'
      : (normalizeLower(order.fulfillment_method || order.fulfillment_type) || 'delivery');
    const requestId = sanitizeText(body?.request_id, 120) || `may30_native_ops:${Date.now()}`;
    const orderNumber = normalizeOrderNumber(order);
    const idempotencyKey = sanitizeText(body?.idempotency_key, 180) || `may30_native_order_ops:${source}:${orderNumber || order?.id || 'unknown'}`;

    if (isRefundEvent(eventType)) {
      return handleNativeRefundMirror({ base44, source, eventType, order, idempotencyKey, requestId, mode });
    }

    const validation = validationError({ source, eventType, order, lineItems, paymentStatus, fulfillmentMethod });
    if (validation) {
      const review = await createOrUpdateReviewQueue({
        base44,
        incidentType: validation.incident_type,
        errorCode: validation.code,
        source,
        eventType,
        order,
        lineItems,
        paymentStatus,
        fulfillmentMethod,
        idempotencyKey,
        mode,
      });

      await createOrderSyncLog({
        base44,
        record: { shopify_order_number: orderNumber },
        action: 'rejected',
        status: 'rejected',
        reason: validation.code,
        fieldsUpdated: [],
        fieldsRejected: [validation.code],
        errorCode: validation.code,
        idempotencyKey,
        requestId,
        source,
        eventType,
        mode,
      });

      return Response.json({
        success: false,
        dry_run: mode !== 'live',
        action: 'queued_for_review',
        error_code: validation.code,
        order_number: orderNumber || null,
        review_queue_action: review.action,
        order_review_queue_draft: mode === 'live' ? null : review.draft,
        hub_bridge_fallback: true,
        native_writer_scope: 'may30_order_ops_only',
      }, { status: 202 });
    }

    const outputs = source === 'shopify_pos'
      ? buildPosRecord({ order, source, eventType, lineItems, paymentStatus })
      : buildOneTimeRecord({ order, source, eventType, lineItems, paymentStatus });
    const existing = await findExistingOrder(base44, outputs.record);
    const planner = await runPlanner({ base44, source, record: outputs.record, existing, idempotencyKey });

    if (!planner?.success || planner?.would_reject === true) {
      const errorCode = planner?.error_code || 'native_safe_sync_guard_rejected';
      const review = await createOrUpdateReviewQueue({
        base44,
        incidentType: errorCode,
        errorCode,
        source,
        eventType,
        order,
        lineItems,
        paymentStatus,
        fulfillmentMethod,
        idempotencyKey,
        mode,
      });

      await createOrderSyncLog({
        base44,
        record: outputs.record,
        action: 'rejected',
        status: 'rejected',
        reason: errorCode,
        fieldsUpdated: [],
        fieldsRejected: Object.keys(planner?.rejected_fields || {}),
        errorCode,
        idempotencyKey,
        requestId,
        source,
        eventType,
        mode,
      });

      return Response.json({
        success: false,
        dry_run: mode !== 'live',
        action: 'queued_for_review',
        error_code: errorCode,
        order_number: outputs.record.shopify_order_number,
        native_safe_sync: {
          would_reject: planner?.would_reject === true,
          rejected_fields: Object.keys(planner?.rejected_fields || {}),
        },
        review_queue_action: review.action,
        order_review_queue_draft: mode === 'live' ? null : review.draft,
        hub_bridge_fallback: true,
      }, { status: 202 });
    }

    const fieldsUpdated = Object.keys(planner.accepted_fields || outputs.record);
    let writeAction = existing ? 'skipped' : 'created';
    let writtenRecord = existing || outputs.record;
    let fulfillmentTaskResult = {
      action: mode === 'live' ? 'not_run' : (outputs.fulfillment_need.requires_fulfillment_task ? 'would_create_or_update' : 'not_required'),
      record: null,
    };

    if (mode === 'live') {
      if (existing) {
        const updatePayload = compactObject({
          ...planner.accepted_fields,
          sync_status: 'native_may30_ready',
          last_sync_at: new Date().toISOString(),
        });
        delete updatePayload.id;
        delete updatePayload.created_date;

        if (Object.keys(updatePayload).length > 0) {
          writtenRecord = await base44.asServiceRole.entities.ShopifyOrder.update(existing.id, updatePayload);
          writeAction = 'updated';
        }
      } else {
        writtenRecord = await base44.asServiceRole.entities.ShopifyOrder.create(outputs.record);
      }

      fulfillmentTaskResult = await createOrUpdateNativeFulfillmentTask({
        base44,
        shopifyOrder: writtenRecord,
        outputs,
        idempotencyKey,
        requestId,
        source,
        eventType,
        mode,
      }).catch(error => {
        console.warn(`[processMay30NativeOrderOps] FulfillmentTask mirror failed safely: ${error?.message || 'unknown'}`);
        return { action: 'failed', record: null, reason: 'fulfillment_task_write_failed' };
      });

      await createOrderSyncLog({
        base44,
        record: writtenRecord,
        action: writeAction,
        status: writeAction === 'skipped' ? 'deduped' : 'success',
        reason: `May 30 native operational mirror ${writeAction}`,
        fieldsUpdated,
        fieldsRejected: Object.keys(planner?.rejected_fields || {}),
        errorCode: null,
        idempotencyKey,
        requestId,
        source,
        eventType,
        mode,
      });

      await createCommandLog({
        base44,
        record: writtenRecord,
        action: writeAction,
        status: writeAction === 'skipped' ? 'skipped' : 'success',
        idempotencyKey,
        requestId,
        source,
        eventType,
        outputs,
        mode,
      });
    }

    return Response.json({
      success: true,
      dry_run: mode !== 'live',
      action: mode === 'live' ? writeAction : (existing ? 'would_update_or_skip' : 'would_create'),
      source,
      event_type: eventType,
      order_id: writtenRecord?.id || null,
      order_number: outputs.record.shopify_order_number,
      existing_native_order: Boolean(existing),
      native_operational_record: {
        source_channel: outputs.record.source_channel,
        source_type: outputs.record.source_type,
        order_type: outputs.record.order_type,
        fulfillment_method: outputs.record.fulfillment_method,
        payment_status: outputs.record.payment_status,
        production_status: outputs.record.production_status,
        fulfillment_status: outputs.record.fulfillment_status,
        order_lock_status: outputs.record.order_lock_status,
      },
      fulfillment_need: outputs.fulfillment_need,
      native_fulfillment_task: {
        action: fulfillmentTaskResult.action,
        task_id: fulfillmentTaskResult.record?.id || null,
        required: outputs.fulfillment_need.requires_fulfillment_task === true,
        reason: fulfillmentTaskResult.reason || null,
      },
      production_demand: outputs.production_demand,
      ingredient_procurement_need: outputs.ingredient_procurement_need,
      native_safe_sync: {
        would_create_order: planner?.would_create_order === true,
        would_update_order: planner?.would_update_order === true,
        would_quarantine: planner?.would_quarantine === true,
        would_reject: planner?.would_reject === true,
        accepted_field_count: Object.keys(planner?.accepted_fields || {}).length,
        rejected_fields: Object.keys(planner?.rejected_fields || {}),
      },
      writes_performed: mode === 'live',
      inventory_deduction_deferred: true,
      purchase_order_deferred: true,
      notifications_deferred: true,
      provider_calls_deferred: true,
      hub_bridge_fallback: true,
    });
  } catch (error) {
    console.error(`[processMay30NativeOrderOps] failed safely: ${error?.message || 'unknown error'}`);
    return Response.json({
      success: false,
      error_code: 'may30_native_order_ops_failed',
      message: 'May 30 native order ops failed safely; Hub bridge fallback remains available.',
      hub_bridge_fallback: true,
    }, { status: 500 });
  }
});
