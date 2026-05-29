import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_FETCH_TIMEOUT_MS = 3000;
const MAX_TARGET_ORDERS = 25;
const CONFIRMATION_PHRASE = 'BACKFILL_HISTORICAL_HUB_ORDERS';
const ENABLE_LIVE_BACKFILL = Deno.env.get('ENABLE_HISTORICAL_HUB_BACKFILL') === 'true';
const LIVE_ORDER_ALLOWLIST = parseCsv(Deno.env.get('HISTORICAL_HUB_BACKFILL_ALLOWED_ORDER_NUMBERS'));

const VALID_PRODUCTION_STATUSES = new Set([
  'new',
  'awaiting_production',
  'in_production',
  'bottled',
  'labeled',
  'qc_checked',
  'packed',
  'in_cold_storage',
  'assigned_for_pickup',
  'assigned_for_delivery',
  'not_required',
  'fulfilled',
  'canceled',
  'refunded',
]);

function parseCsv(value) {
  return new Set(
    (value || '')
      .split(',')
      .map(item => normalizeOrderNumber(item))
      .filter(Boolean),
  );
}

async function readJsonBody(req) {
  const raw = await req.text();
  if (!raw.trim()) return { ok: true, body: {} };
  try {
    const parsed = JSON.parse(raw);
    return { ok: true, body: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {} };
  } catch {
    return { ok: false, body: null };
  }
}

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeOrderNumber(value) {
  return normalizeText(value).replace(/^#/, '').toLowerCase();
}

function displayOrderNumber(value) {
  return normalizeText(value).replace(/^#/, '');
}

function safeText(value, maxLength = 180) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\b(?:ch|re|pi|cs|cus|sub|evt|in|pm|seti|si|src|tok|po|li)_[A-Za-z0-9]{8,}\b/g, '[redacted]');
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compactObject(value) {
  const out = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (item !== undefined && item !== null && item !== '') out[key] = item;
  }
  return out;
}

function uniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(value => safeText(value, 80)).filter(Boolean)));
}

function requestedOrderNumbers(body) {
  const raw = Array.isArray(body?.order_numbers)
    ? body.order_numbers
    : normalizeText(body?.order_numbers).split(',');
  return Array.from(new Set(raw.map(value => normalizeOrderNumber(value)).filter(Boolean))).slice(0, MAX_TARGET_ORDERS + 1);
}

function orderNumber(order) {
  return displayOrderNumber(order?.shopify_order_number || order?.order_number || order?.name);
}

function orderKey(order) {
  return normalizeOrderNumber(orderNumber(order));
}

function sourceChannel(order) {
  return normalizeLower(order?.source_channel || order?.source_type || '');
}

function paymentStatus(order) {
  return normalizeLower(order?.payment_status || order?.financial_status || '');
}

function productionStatus(order) {
  return normalizeLower(order?.production_status || order?.status || '');
}

function fulfillmentStatus(order) {
  return normalizeLower(order?.fulfillment_status || order?.shopify_fulfillment_status || '');
}

function fulfillmentMethod(order) {
  return normalizeLower(order?.fulfillment_method || order?.fulfillment_type || (sourceChannel(order) === 'pos' ? 'pos' : 'delivery')) || 'delivery';
}

function isSubscriptionLike(order) {
  return sourceChannel(order) === 'subscription' ||
    normalizeLower(order?.order_type) === 'subscription' ||
    normalizeLower(order?.fulfillment_mode) === 'multi_delivery' ||
    Boolean(order?.stripe_subscription_id) ||
    (Array.isArray(order?.fulfillments) && order.fulfillments.length > 1);
}

function isPosLike(order) {
  return sourceChannel(order) === 'pos' ||
    normalizeLower(order?.order_type) === 'pos' ||
    fulfillmentMethod(order) === 'pos' ||
    order?.is_pos_order === true;
}

function isCancelledOrRefunded(order) {
  const statuses = [paymentStatus(order), productionStatus(order), fulfillmentStatus(order), normalizeLower(order?.order_status)];
  return statuses.some(status => status.includes('refund') || status.includes('cancel') || status === 'voided');
}

function hasLineItems(order) {
  return Array.isArray(order?.line_items) && order.line_items.length > 0;
}

function mapProductionStatus(order) {
  if (isPosLike(order)) return 'not_required';
  if (isCancelledOrRefunded(order)) return paymentStatus(order).includes('refund') ? 'refunded' : 'canceled';

  const status = productionStatus(order);
  if (VALID_PRODUCTION_STATUSES.has(status)) return status;
  if (status.includes('production')) return 'in_production';
  if (status.includes('bottle')) return 'bottled';
  if (status.includes('pack')) return 'packed';
  if (status.includes('fulfill') || status.includes('deliver')) return 'fulfilled';
  if (status.includes('schedule') || status.includes('pending') || status.includes('await')) return 'awaiting_production';
  return 'awaiting_production';
}

function mapSourceChannel(order) {
  if (isPosLike(order)) return 'pos';
  const source = sourceChannel(order);
  if (['online', 'draft', 'wholesale', 'admin', 'event'].includes(source)) return source;
  return 'online';
}

function mapOrderType(order) {
  if (isPosLike(order)) return 'pos';
  const type = normalizeLower(order?.order_type);
  if (['wholesale', 'admin', 'event'].includes(type)) return type;
  return 'one_time';
}

function mapFulfillmentMethod(order) {
  if (isPosLike(order)) return 'pos';
  const method = fulfillmentMethod(order);
  if (['delivery', 'pickup', 'shipping', 'pos'].includes(method)) return method;
  return 'delivery';
}

function safeLineItems(order) {
  return (Array.isArray(order?.line_items) ? order.line_items : [])
    .slice(0, 60)
    .map(item => compactObject({
      shopify_line_item_id: safeText(item?.shopify_line_item_id || item?.id, 120),
      title: safeText(item?.title || item?.name || item?.product_title, 160),
      variant_title: safeText(item?.variant_title, 120),
      sku: safeText(item?.sku, 80),
      quantity: safeNumber(item?.quantity, 0),
      price: item?.price === undefined || item?.price === null ? null : safeNumber(item.price, 0),
      total_discount: item?.total_discount === undefined || item?.total_discount === null ? null : safeNumber(item.total_discount, 0),
    }))
    .filter(item => item.title && item.quantity > 0);
}

function safeAddress(order) {
  const deliveryAddress = typeof order?.delivery_address === 'object' && order.delivery_address !== null
    ? order.delivery_address
    : {};

  return compactObject({
    delivery_address: typeof order?.delivery_address === 'string'
      ? safeText(order.delivery_address, 280)
      : safeText(order?.address_line1 || deliveryAddress.address_line1 || deliveryAddress.address1, 280),
    address_line1: safeText(order?.address_line1 || deliveryAddress.address_line1 || deliveryAddress.address1, 180),
    address_line2: safeText(order?.address_line2 || deliveryAddress.address_line2 || deliveryAddress.address2, 120),
    address_city: safeText(order?.address_city || deliveryAddress.city, 100),
    address_state: safeText(order?.address_state || deliveryAddress.state || deliveryAddress.province, 80),
    address_postal_code: safeText(order?.address_postal_code || deliveryAddress.postal_code || deliveryAddress.zip, 40),
    address_country: safeText(order?.address_country || deliveryAddress.country || deliveryAddress.country_code || 'US', 40),
  });
}

function buildFulfillments(order, lineItems) {
  if (isPosLike(order)) return [];
  return [compactObject({
    fulfillment_number: 1,
    status: safeText(fulfillmentStatus(order) || 'pending', 80),
    fulfillment_method: mapFulfillmentMethod(order),
    delivery_date: safeText(order?.assigned_delivery_date || order?.selected_delivery_date || order?.estimated_delivery_date || order?.requested_delivery_date, 40),
    production_date: safeText(order?.production_date, 40),
    delivery_window_label: safeText(order?.delivery_window_label || order?.requested_time_window, 120),
    line_items: lineItems,
  })];
}

function buildNativeRecord({ hubOrder, localOrder, existing, requestId, action }) {
  const now = new Date().toISOString();
  const number = orderNumber(hubOrder);
  const lineItems = safeLineItems(hubOrder);
  const pos = isPosLike(hubOrder);
  const archived = isCancelledOrRefunded(hubOrder) || pos;
  const fulfillmentMethodValue = mapFulfillmentMethod(hubOrder);
  const productionStatusValue = pos ? 'canceled' : mapProductionStatus(hubOrder);
  const fulfillmentStatusValue = pos ? 'cancelled' : safeText(fulfillmentStatus(hubOrder) || 'pending', 80);
  const auditEntry = {
    at: now,
    source: 'backfillAdminHistoricalHubOrders',
    action,
    request_id: requestId,
    hub_order_id: safeText(hubOrder?.id || hubOrder?._id, 120),
  };

  const record = compactObject({
    shopify_order_id: safeText(hubOrder?.shopify_order_id || hubOrder?.shopify_id || `historical_hub:${hubOrder?.id || number}`, 140),
    shopify_order_number: safeText(number, 120),
    base44_order_id: safeText(localOrder?.id || hubOrder?.base44_order_id, 120),
    source_channel: mapSourceChannel(hubOrder),
    source_type: 'historical_hub_backfill',
    order_type: mapOrderType(hubOrder),
    fulfillment_method: fulfillmentMethodValue,
    fulfillment_mode: 'single_delivery',
    customer_name: safeText(hubOrder?.customer_name || hubOrder?.full_name, 160),
    customer_email: safeText(hubOrder?.customer_email || hubOrder?.contact_email, 180),
    customer_phone: safeText(hubOrder?.customer_phone || hubOrder?.contact_phone, 80),
    line_items: lineItems,
    subtotal: safeNumber(hubOrder?.subtotal ?? hubOrder?.subtotal_price, 0),
    total_tax: safeNumber(hubOrder?.total_tax, 0),
    total_discounts: safeNumber(hubOrder?.total_discounts, 0),
    delivery_fee: safeNumber(hubOrder?.delivery_fee, 0),
    total_price: safeNumber(hubOrder?.total_price ?? hubOrder?.total, 0),
    payment_status: safeText(paymentStatus(hubOrder) || 'unknown', 80),
    financial_status: safeText(hubOrder?.financial_status || paymentStatus(hubOrder) || 'unknown', 80),
    fulfillment_status: fulfillmentStatusValue,
    shopify_fulfillment_status: safeText(hubOrder?.shopify_fulfillment_status, 80),
    production_status: productionStatusValue,
    order_status: pos ? 'canceled' : safeText(hubOrder?.order_status || hubOrder?.status, 80),
    order_lock_status: archived || pos ? 'fulfilled' : 'verified',
    operational_visibility: archived ? 'archived' : 'active',
    excluded_from_production: archived || pos,
    data_quality_status: 'complete',
    sync_status: 'historical_hub_backfilled',
    last_sync_at: now,
    customer_order_date: safeText(hubOrder?.created_date || hubOrder?.created_at || hubOrder?.order_date || now, 80),
    requested_delivery_date: safeText(hubOrder?.requested_delivery_date || hubOrder?.estimated_delivery_date, 40),
    selected_delivery_date: safeText(hubOrder?.selected_delivery_date || hubOrder?.assigned_delivery_date || hubOrder?.estimated_delivery_date, 40),
    assigned_delivery_date: safeText(hubOrder?.assigned_delivery_date || hubOrder?.selected_delivery_date || hubOrder?.estimated_delivery_date, 40),
    production_date: safeText(hubOrder?.production_date, 40),
    delivery_window_label: safeText(hubOrder?.delivery_window_label || hubOrder?.requested_time_window, 120),
    customer_notes: safeText(hubOrder?.customer_notes || hubOrder?.notes, 300),
    internal_notes: safeText(`Historical Hub backfill ${pos ? 'canceled POS test ' : archived ? 'archived ' : ''}mirror for ${number}.`, 300),
    event_name: safeText(hubOrder?.event_name, 120),
    event_date: safeText(hubOrder?.event_date, 40),
    event_location: safeText(hubOrder?.event_location || hubOrder?.location_name, 160),
    tags: uniqueStrings([
      ...(Array.isArray(hubOrder?.tags) ? hubOrder.tags : []),
      'historical_hub_backfill',
      archived ? 'archived' : null,
      pos ? 'pos_test_cancelled' : null,
      pos ? 'pos_sale' : null,
    ]),
    is_pos_order: pos,
    is_subscription: false,
    fulfillments: buildFulfillments(hubOrder, lineItems),
    audit_trail: [...(Array.isArray(existing?.audit_trail) ? existing.audit_trail : []), auditEntry],
    ...safeAddress(hubOrder),
  });

  if (archived) {
    record.refunded_at = safeText(hubOrder?.refunded_at || hubOrder?.cancelled_at || hubOrder?.updated_date, 80);
    record.cancel_type = pos ? 'historical_pos_test_cancel' : paymentStatus(hubOrder).includes('refund') ? 'historical_refund' : 'historical_cancel';
  }

  return record;
}

function existingNativeDiff(hubOrder, nativeOrder) {
  const fields = [];
  const checks = [
    ['customer_email', hubOrder?.customer_email, nativeOrder?.customer_email],
    ['customer_name', hubOrder?.customer_name, nativeOrder?.customer_name],
    ['payment_status', paymentStatus(hubOrder), paymentStatus(nativeOrder)],
    ['production_status', mapProductionStatus(hubOrder), nativeOrder?.production_status],
    ['fulfillment_status', fulfillmentStatus(hubOrder), nativeOrder?.fulfillment_status],
    ['fulfillment_method', fulfillmentMethod(hubOrder), nativeOrder?.fulfillment_method],
    ['assigned_delivery_date', hubOrder?.assigned_delivery_date || hubOrder?.selected_delivery_date || hubOrder?.estimated_delivery_date, nativeOrder?.assigned_delivery_date || nativeOrder?.selected_delivery_date],
  ];

  for (const [field, hubValue, nativeValue] of checks) {
    if (normalizeText(hubValue) && normalizeLower(hubValue) !== normalizeLower(nativeValue)) fields.push(field);
  }

  const hubItems = Array.isArray(hubOrder?.line_items) ? hubOrder.line_items.length : 0;
  const nativeItems = Array.isArray(nativeOrder?.line_items) ? nativeOrder.line_items.length : 0;
  if (hubItems > 0 && hubItems !== nativeItems) fields.push('line_items');

  return fields;
}

function isHistoricalPosExcluded(nativeOrder) {
  if (!nativeOrder) return false;
  const status = normalizeLower(nativeOrder.production_status || nativeOrder.order_status);
  return nativeOrder.excluded_from_production === true &&
    normalizeLower(nativeOrder.operational_visibility) === 'archived' &&
    (status === 'canceled' || status === 'cancelled' || status === 'refunded');
}

function classifyHubOrder({ hubOrder, nativeOrder }) {
  if (!orderKey(hubOrder)) return { action: 'blocked', reason: 'missing_order_number' };
  if (isSubscriptionLike(hubOrder)) return { action: 'blocked', reason: 'subscription_future_compatible_hold' };
  if (!hasLineItems(hubOrder)) return { action: 'blocked', reason: 'missing_line_items' };
  if (isPosLike(hubOrder)) {
    if (nativeOrder) {
      return isHistoricalPosExcluded(nativeOrder)
        ? { action: 'already_native', reason: 'historical_pos_test_order_already_cancelled' }
        : {
            action: 'would_update_native',
            reason: 'historical_pos_test_order_needs_cancellation',
            diff_fields: ['production_status', 'fulfillment_status', 'operational_visibility', 'excluded_from_production', 'cancel_type'],
          };
    }
    return { action: 'would_create_archived_native', reason: 'historical_pos_test_order_cancelled' };
  }
  if (nativeOrder) {
    const diffFields = existingNativeDiff(hubOrder, nativeOrder);
    return diffFields.length > 0
      ? { action: 'would_update_native', reason: 'native_record_differs', diff_fields: diffFields }
      : { action: 'already_native', reason: 'native_record_present' };
  }
  if (isCancelledOrRefunded(hubOrder)) return { action: 'would_create_archived_native', reason: 'historical_cancelled_or_refunded' };
  return { action: 'would_create_native_from_hub', reason: 'historical_one_time_order_missing_native' };
}

function safeSummary(order) {
  return {
    order_number: safeText(orderNumber(order), 80),
    customer_email: safeText(order?.customer_email || order?.contact_email, 160),
    source_channel: safeText(sourceChannel(order) || (isPosLike(order) ? 'pos' : 'online'), 60),
    order_type: safeText(order?.order_type || (isPosLike(order) ? 'pos' : 'one_time'), 60),
    payment_status: safeText(paymentStatus(order), 60),
    production_status: safeText(productionStatus(order), 80),
    fulfillment_status: safeText(fulfillmentStatus(order), 80),
    line_item_count: Array.isArray(order?.line_items) ? order.line_items.length : 0,
    total_price: safeNumber(order?.total_price ?? order?.total, 0),
  };
}

function buildPlanRow({ key, hubOrder, nativeOrder, localOrder, includeArchived, requestId }) {
  if (!hubOrder) {
    return {
      order_number: key,
      action: 'blocked',
      reason: 'hub_order_not_found',
      live_eligible: false,
      blocker: 'hub_order_not_found',
    };
  }

  const classification = classifyHubOrder({ hubOrder, nativeOrder, localOrder });
  const archived = classification.action === 'would_create_archived_native';
  const posCancellation = classification.reason === 'historical_pos_test_order_cancelled' ||
    classification.reason === 'historical_pos_test_order_needs_cancellation';
  const blocker = classification.action === 'blocked'
    ? classification.reason
    : ((archived || posCancellation) && !includeArchived ? 'archived_order_requires_include_archived' : null);
  const liveEligible = !blocker && ['would_create_native_from_hub', 'would_update_native', 'would_create_archived_native', 'already_native'].includes(classification.action);

  return {
    order_number: orderNumber(hubOrder),
    action: classification.action,
    reason: classification.reason,
    diff_fields: classification.diff_fields || [],
    idempotency_key: requestId ? `historical_hub_backfill:${requestId}:${orderKey(hubOrder)}` : null,
    live_eligible: liveEligible,
    blocker,
    existing: {
      native_shopify_order: Boolean(nativeOrder),
      customer_app_order: Boolean(localOrder),
      native_shopify_order_id: nativeOrder?.id || null,
      customer_app_order_id: localOrder?.id || null,
    },
    order: safeSummary(hubOrder),
  };
}

function indexByOrderNumber(records, numberFieldNames) {
  const index = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    for (const field of numberFieldNames) {
      const key = normalizeOrderNumber(record?.[field]);
      if (key && !index.has(key)) index.set(key, record);
    }
  }
  return index;
}

async function fetchHubOrders({ hubBase, hubSecret, since }) {
  const url = new URL(`${hubBase}/functions/getOrderUpdatesForCustomerApp`);
  if (since) url.searchParams.set('since', since);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HUB_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${hubSecret}` },
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, status: res.status, orders: [] };
    const data = await res.json();
    return { ok: true, status: res.status, orders: Array.isArray(data?.orders) ? data.orders : [] };
  } finally {
    clearTimeout(timeout);
  }
}

function liveGateFailure({ mode, body, targetKeys }) {
  if (mode !== 'live') return null;
  if (!ENABLE_LIVE_BACKFILL) return 'historical_hub_backfill_disabled';
  if (normalizeText(body?.confirmation) !== CONFIRMATION_PHRASE) return 'confirmation_phrase_required';
  if (!normalizeText(body?.request_id)) return 'request_id_required';
  if (LIVE_ORDER_ALLOWLIST.size === 0) return 'env_order_allowlist_required';
  for (const key of targetKeys) {
    if (!LIVE_ORDER_ALLOWLIST.has(key)) return `order_not_env_allowlisted:${key}`;
  }
  return null;
}

async function createOrderSyncLog({ base44, record, action, status, reason, fieldsUpdated, fieldsRejected, idempotencyKey, requestId }) {
  return base44.asServiceRole.entities.OrderSyncLog.create({
    order_number: record?.shopify_order_number || 'unknown',
    status,
    sync_timestamp: new Date().toISOString(),
    sync_source: 'historical_hub_backfill',
    event_type: 'historical_backfill',
    order_id: record?.id || null,
    action,
    reason: safeText(reason, 300),
    fields_updated: fieldsUpdated,
    fields_rejected: fieldsRejected,
    success: status === 'success' || status === 'deduped',
    error_code: null,
    idempotency_key: idempotencyKey,
    request_id: requestId,
    correlation_id: `historical_hub_backfill:${record?.shopify_order_number || 'unknown'}`,
  });
}

async function createCommandLog({ base44, record, action, status, idempotencyKey, requestId, result, user }) {
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: 'historical_hub_backfill',
    command_source: 'admin',
    status,
    target_entity: 'ShopifyOrder',
    target_id: record?.id || null,
    target_display_id: record?.shopify_order_number || null,
    actor_email: safeText(user?.email, 180) || 'admin',
    actor_role: safeText(user?.role, 80) || 'admin',
    actor_type: 'admin',
    payload: {
      order_number: record?.shopify_order_number || null,
      exact_allowlist: true,
    },
    result,
    idempotency_key: idempotencyKey,
    request_id: requestId,
    function_name: 'backfillAdminHistoricalHubOrders',
    completed_at: new Date().toISOString(),
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ success: false, error_code: 'unauthorized' }, { status: 401 });
    }
    if (!user) return Response.json({ success: false, error_code: 'unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ success: false, error_code: 'forbidden' }, { status: 403 });

    const parsed = await readJsonBody(req);
    if (!parsed.ok) {
      return Response.json({ success: false, error_code: 'malformed_json' }, { status: 400 });
    }

    const body = parsed.body || {};
    const mode = body.mode === 'live' ? 'live' : 'dry_run';
    const targetKeys = requestedOrderNumbers(body);
    const includeArchived = body.include_archived === true;
    const requestId = safeText(body.request_id, 120);
    const since = safeText(body.since, 40);

    if (targetKeys.length === 0) {
      return Response.json({
        success: false,
        dry_run: mode !== 'live',
        error_code: 'order_numbers_required',
        writes_performed: false,
      }, { status: 400 });
    }
    if (targetKeys.length > MAX_TARGET_ORDERS) {
      return Response.json({
        success: false,
        dry_run: mode !== 'live',
        error_code: 'too_many_order_numbers',
        max_order_numbers: MAX_TARGET_ORDERS,
        writes_performed: false,
      }, { status: 400 });
    }

    const gateFailure = liveGateFailure({ mode, body, targetKeys });
    if (gateFailure) {
      return Response.json({
        success: true,
        skipped: true,
        dry_run: false,
        error_code: gateFailure,
        writes_performed: false,
        live_backfill_allowed: false,
      }, { status: 200 });
    }

    const hubApiUrl = Deno.env.get('HUB_API_URL');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    const hubBase = hubApiUrl ? hubApiUrl.replace(/\/$/, '').replace(/\/functions\/.*$/, '') : null;

    if (!hubBase || !hubSecret) {
      return Response.json({
        success: false,
        dry_run: mode !== 'live',
        error_code: 'hub_config_missing',
        message: 'Hub API URL or sync secret is not configured.',
        writes_performed: false,
      }, { status: 200 });
    }

    const [nativeOrders, localOrders, hubResult] = await Promise.all([
      base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 1000).catch(() => []),
      base44.asServiceRole.entities.Order.list('-created_date', 1000).catch(() => []),
      fetchHubOrders({ hubBase, hubSecret, since }),
    ]);

    if (!hubResult.ok) {
      return Response.json({
        success: false,
        dry_run: mode !== 'live',
        error_code: `hub_fetch_failed_${hubResult.status}`,
        writes_performed: false,
      }, { status: 502 });
    }

    const nativeByNumber = indexByOrderNumber(nativeOrders, ['shopify_order_number', 'order_number']);
    const localByNumber = indexByOrderNumber(localOrders, ['order_number', 'shopify_order_number']);
    const hubByNumber = indexByOrderNumber(hubResult.orders, ['shopify_order_number', 'order_number', 'name']);

    const rows = targetKeys.map(key => {
      const hubOrder = hubByNumber.get(key);
      return buildPlanRow({
        key,
        hubOrder,
        nativeOrder: nativeByNumber.get(key),
        localOrder: localByNumber.get(key),
        includeArchived,
        requestId,
      });
    });

    const blockers = rows.filter(row => !row.live_eligible);
    if (mode === 'live' && blockers.length > 0) {
      return Response.json({
        success: false,
        dry_run: false,
        error_code: 'live_backfill_preflight_blocked',
        writes_performed: false,
        blocker_count: blockers.length,
        blockers: blockers.map(row => ({
          order_number: row.order_number,
          reason: row.blocker || row.reason,
        })),
        plan_rows: rows,
      }, { status: 409 });
    }

    const results = [];
    let writeCount = 0;
    let createCount = 0;
    let updateCount = 0;
    let skippedCount = 0;

    if (mode === 'live') {
      for (const row of rows) {
        const key = normalizeOrderNumber(row.order_number);
        const hubOrder = hubByNumber.get(key);
        const nativeOrder = nativeByNumber.get(key);
        const localOrder = localByNumber.get(key);
        const idempotencyKey = `historical_hub_backfill:${requestId}:${key}`;
        const existingLogs = await base44.asServiceRole.entities.OrderSyncLog.filter({ idempotency_key: idempotencyKey }, '-created_date', 1).catch(() => []);

        if (Array.isArray(existingLogs) && existingLogs.length > 0) {
          skippedCount += 1;
          results.push({
            order_number: row.order_number,
            action: 'skipped',
            reason: 'idempotency_log_present',
            idempotent: true,
          });
          continue;
        }

        if (row.action === 'already_native') {
          await createOrderSyncLog({
            base44,
            record: nativeOrder,
            action: 'already_native',
            status: 'deduped',
            reason: 'Native ShopifyOrder already exists with no Hub diff.',
            fieldsUpdated: [],
            fieldsRejected: [],
            idempotencyKey,
            requestId,
          });
          await createCommandLog({
            base44,
            record: nativeOrder,
            action: 'already_native',
            status: 'skipped',
            idempotencyKey,
            requestId,
            result: { action: 'already_native', writes_performed: false },
            user,
          });
          skippedCount += 1;
          results.push({
            order_number: row.order_number,
            action: 'already_native',
            idempotent: false,
          });
          continue;
        }

        const record = buildNativeRecord({
          hubOrder,
          localOrder,
          existing: nativeOrder,
          requestId,
          action: row.action,
        });
        let writtenRecord = null;
        let action = 'created';
        const fieldsUpdated = Object.keys(record).filter(field => !['id', 'created_date'].includes(field));

        if (nativeOrder) {
          const patch = { ...record };
          delete patch.id;
          delete patch.created_date;
          writtenRecord = await base44.asServiceRole.entities.ShopifyOrder.update(nativeOrder.id, patch);
          action = 'updated';
          updateCount += 1;
        } else {
          writtenRecord = await base44.asServiceRole.entities.ShopifyOrder.create(record);
          createCount += 1;
        }
        writeCount += 1;

        await createOrderSyncLog({
          base44,
          record: writtenRecord,
          action: `historical_backfill_${action}`,
          status: 'success',
          reason: `Historical Hub backfill ${action} native ShopifyOrder.`,
          fieldsUpdated,
          fieldsRejected: [],
          idempotencyKey,
          requestId,
        });
        await createCommandLog({
          base44,
          record: writtenRecord,
          action: `historical_backfill_${action}`,
          status: 'success',
          idempotencyKey,
          requestId,
          result: {
            action,
            archived: isCancelledOrRefunded(hubOrder) || isPosLike(hubOrder),
            source_channel: record.source_channel,
            line_item_count: Array.isArray(record.line_items) ? record.line_items.length : 0,
            writes_performed: true,
          },
          user,
        });

        results.push({
          order_number: row.order_number,
          action,
          record_id: writtenRecord?.id || null,
          idempotent: false,
        });
      }
    }

    const countsByAction = {};
    for (const row of rows) countsByAction[row.action] = (countsByAction[row.action] || 0) + 1;

    return Response.json({
      success: true,
      dry_run: mode !== 'live',
      live_backfill_allowed: mode === 'live',
      writes_performed: mode === 'live' && writeCount > 0,
      mode,
      generated_at: new Date().toISOString(),
      requested_order_count: targetKeys.length,
      include_archived: includeArchived,
      summary: {
        hub_orders_scanned: Array.isArray(hubResult.orders) ? hubResult.orders.length : 0,
        planned_count: rows.length,
        live_eligible_count: rows.filter(row => row.live_eligible).length,
        blocker_count: blockers.length,
        counts_by_action: countsByAction,
        writes: {
          created: createCount,
          updated: updateCount,
          skipped: skippedCount,
        },
      },
      plan_rows: rows,
      live_results: results,
      guardrails: {
        native_writer_scope: 'historical_shopify_order_backfill_only',
        customer_app_order_writes: false,
        fulfillment_task_writes: false,
        order_review_queue_writes: false,
        notifications: false,
        provider_calls: false,
        inventory_or_purchase_orders: false,
        production_or_compliance_mutation: false,
      },
    });
  } catch (error) {
    console.error('[backfillAdminHistoricalHubOrders] failed safely:', error?.message || 'unknown error');
    return Response.json({
      success: false,
      error_code: 'historical_hub_backfill_failed',
      message: 'Historical Hub backfill failed safely.',
      writes_performed: false,
    }, { status: 500 });
  }
});
