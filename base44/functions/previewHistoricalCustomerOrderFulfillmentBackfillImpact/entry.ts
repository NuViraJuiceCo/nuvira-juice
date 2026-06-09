import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const FUNCTION_NAME = 'previewHistoricalCustomerOrderFulfillmentBackfillImpact';
const REQUIRED_PREVIEW_MODE = 'HISTORICAL_CUSTOMER_ORDER_FULFILLMENT_BACKFILL_IMPACT';
const REQUIRED_NOTIFICATION_POLICY = 'NO_NOTIFICATION';
const REQUIRED_CUSTOMER_APP_ORDER_BACKFILL = 'PREVIEW_ONLY';
const REQUIRED_NATIVE_TASK_BACKFILL = 'PREVIEW_ONLY';
const REQUIRED_PROOF_DROP_POLICY = 'HELD_NOT_REQUIRED_FOR_RECONCILIATION';
const TARGET_HUB_ORDER_NUMBER = '1052';
const TARGET_NATIVE_SHOPIFY_ORDER_ID = '6a2848655450ef3556960d99';
const HISTORICAL_MIRROR_SOURCE_TYPE = 'hub_historical_backfill';
const HISTORICAL_MIRROR_SYNC_STATUS = 'historical_hub_fulfilled_native_mirror_g32l';
const DEFAULT_HUB_SINCE = '2026-05-01';
const HUB_FETCH_TIMEOUT_MS = 8000;
const HUB_TASK_FETCH_LIMIT = '10';
const MAX_TEXT = 180;

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

const READ_ONLY_SAFETY = Object.freeze({
  dry_run_only: true,
  writes_performed: false,
  customer_app_order_created: false,
  customer_app_order_updated: false,
  status_history_appended: false,
  native_shopify_order_created: false,
  native_shopify_order_updated: false,
  native_fulfillment_task_created: false,
  native_fulfillment_task_updated: false,
  hub_records_updated: false,
  notifications_created: false,
  notifications_sent: false,
  message_logs_created: false,
  proof_drop_route_fields_written: false,
  production_batch_created: false,
  production_batch_updated: false,
  batch_compliance_log_created: false,
  batch_compliance_log_updated: false,
  provider_calls_performed: false,
  stripe_calls_performed: false,
  shopify_api_calls_performed: false,
  sync_repair_replay_performed: false,
  inventory_deducted: false,
  purchase_order_created: false,
  hub_bridge_modified: false,
});

const AUDITED_HUB_FULFILLED_FALLBACKS = Object.freeze({
  '1052': {
    shopify_order_number: '1052',
    fulfillment_status: 'fulfilled',
    production_status: 'new',
    assigned_delivery_date: '2026-06-06',
    fulfilled_at: '2026-06-06T00:00:00.000Z',
    line_items: [{ title: 'redacted item', quantity: 1 }, { title: 'redacted item', quantity: 1 }, { title: 'redacted item', quantity: 1 }],
    audit_fallback_reason: 'g32j_g32m_read_only_hub_audit_confirmed_fulfilled_native_mirror_created',
  },
});

const ALLOWED_BODY_KEYS = new Set([
  'mode',
  'hub_order_number',
  'native_shopify_order_id',
  'preview_mode',
  'notification_policy',
  'customer_app_order_backfill',
  'native_fulfillment_task_backfill',
  'proof_drop_policy',
  'request_id',
  'since',
  '_internal_secret',
  'internal_secret',
]);

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizeLower(value) {
  return normalizeSingleLine(value).toLowerCase();
}

function normalizeUpper(value) {
  return normalizeSingleLine(value).toUpperCase();
}

function normalizeOrderNumber(value) {
  return normalizeSingleLine(value).replace(/^#/, '');
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function safeText(value, maxLength = MAX_TEXT) {
  const text = normalizeSingleLine(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\b(?:ch|re|pi|cs|cus|sub|evt|in|pm|seti|si|src|tok|po|li)_[A-Za-z0-9]{8,}\b/g, '[redacted provider id]')
    .replace(/\bgid:\/\/shopify\/[A-Za-z]+\/[A-Za-z0-9_-]+\b/g, '[redacted shopify id]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function safeId(value, maxLength = MAX_TEXT) {
  const text = safeText(value, maxLength);
  return text && /^[A-Za-z0-9._:@/#-]+$/.test(text) ? text : '';
}

function isoDate(value) {
  const match = normalizeText(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
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

function unsupportedBodyKey(body) {
  for (const key of Object.keys(body || {})) {
    if (!ALLOWED_BODY_KEYS.has(normalizeLower(key))) return key;
  }
  return null;
}

function getPreviewSecret() {
  return normalizeText(Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET')) ||
    normalizeText(Deno.env.get('CUSTOMER_APP_SYNC_SECRET')) ||
    normalizeText(Deno.env.get('HUB_SYNC_SECRET'));
}

function suppliedInternalSecret(req, body) {
  return normalizeText(req.headers.get('x-native-preview-secret')) ||
    normalizeText(req.headers.get('x-internal-secret')) ||
    normalizeText(body?._internal_secret || body?.internal_secret);
}

async function requirePreviewAccess({ base44, req, body }) {
  const expected = getPreviewSecret();
  const supplied = suppliedInternalSecret(req, body);
  if (expected && supplied && supplied === expected) return { ok: true, actor_type: 'internal_service', actor_role: 'service' };
  try {
    const user = await base44.auth.me();
    if (!user) return { ok: false, response: Response.json({ success: false, error_code: 'unauthorized', writes_performed: false }, { status: 401 }) };
    if (user.role !== 'admin') return { ok: false, response: Response.json({ success: false, error_code: 'forbidden', writes_performed: false }, { status: 403 }) };
    return { ok: true, actor_type: 'admin', actor_role: user.role, actor_email_present: Boolean(user.email) };
  } catch {
    return { ok: false, response: Response.json({ success: false, error_code: 'unauthorized', writes_performed: false }, { status: 401 }) };
  }
}

function lookupFromBody(body) {
  return {
    hubOrderNumber: normalizeOrderNumber(body?.hub_order_number || TARGET_HUB_ORDER_NUMBER),
    nativeShopifyOrderId: safeId(body?.native_shopify_order_id || TARGET_NATIVE_SHOPIFY_ORDER_ID, 180),
    previewMode: normalizeUpper(body?.preview_mode),
    notificationPolicy: normalizeUpper(body?.notification_policy),
    customerAppOrderBackfill: normalizeUpper(body?.customer_app_order_backfill),
    nativeFulfillmentTaskBackfill: normalizeUpper(body?.native_fulfillment_task_backfill),
    proofDropPolicy: normalizeUpper(body?.proof_drop_policy),
    requestId: safeId(body?.request_id, 180),
    since: safeText(body?.since || DEFAULT_HUB_SINCE, 40),
  };
}

function policyBlockers(lookup) {
  return unique([
    lookup.previewMode !== REQUIRED_PREVIEW_MODE ? 'preview_mode_must_be_historical_customer_order_fulfillment_backfill_impact' : null,
    lookup.notificationPolicy !== REQUIRED_NOTIFICATION_POLICY ? 'notification_policy_must_be_no_notification' : null,
    lookup.customerAppOrderBackfill !== REQUIRED_CUSTOMER_APP_ORDER_BACKFILL ? 'customer_app_order_backfill_must_be_preview_only' : null,
    lookup.nativeFulfillmentTaskBackfill !== REQUIRED_NATIVE_TASK_BACKFILL ? 'native_fulfillment_task_backfill_must_be_preview_only' : null,
    lookup.proofDropPolicy !== REQUIRED_PROOF_DROP_POLICY ? 'proof_drop_policy_must_be_held_not_required_for_reconciliation' : null,
  ]);
}

async function filterEntity(base44, entityName, filter, sort = '-created_date', limit = 20) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity?.filter) return [];
  const rows = await entity.filter(filter, sort, limit).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

function hubOrderNumber(order) {
  return normalizeOrderNumber(order?.shopify_order_number || order?.order_number || order?.name);
}

function hubOrderIdValue(order) {
  return safeId(order?.id || order?.shopify_order_id || order?.hub_order_id || order?.source_order_id, 180);
}

function isHubFulfilled(order) {
  return normalizeLower(order?.fulfillment_status || order?.shopify_fulfillment_status).includes('fulfilled') ||
    Boolean(order?.fulfilled_at || order?.delivered_at || order?.completed_at);
}

function isCancelledOrRefunded(order) {
  const statuses = [
    order?.fulfillment_status,
    order?.shopify_fulfillment_status,
    order?.production_status,
    order?.payment_status,
    order?.financial_status,
    order?.order_status,
    order?.cancelled_at,
    order?.canceled_at,
    order?.refund_status,
  ].map(normalizeLower);
  return statuses.some(status => status.includes('cancel') || status.includes('refund') || status === 'voided');
}

function isSubscriptionOrMultiDelivery(order) {
  return normalizeLower(order?.source_channel) === 'subscription' ||
    normalizeLower(order?.source_type) === 'subscription' ||
    normalizeLower(order?.order_type) === 'subscription' ||
    normalizeLower(order?.fulfillment_mode) === 'multi_delivery' ||
    Boolean(order?.stripe_subscription_id) ||
    (Array.isArray(order?.fulfillments) && order.fulfillments.length > 1);
}

function safeHubOrderStatus(order) {
  return order ? {
    order_number: safeText(hubOrderNumber(order), 80) || null,
    hub_order_id_present: Boolean(hubOrderIdValue(order)),
    customer_email_present: Boolean(order.customer_email || order.contact_email || order.email),
    customer_name_present: Boolean(order.customer_name || order.full_name || order.customer?.name),
    source_channel: safeText(order.source_channel || order.source_type, 80) || null,
    order_type: safeText(order.order_type || (isSubscriptionOrMultiDelivery(order) ? 'subscription' : 'one_time'), 80) || null,
    payment_status: safeText(order.payment_status || order.financial_status, 80) || null,
    production_status: safeText(order.production_status || order.status, 80) || null,
    fulfillment_status: safeText(order.fulfillment_status || order.shopify_fulfillment_status, 80) || null,
    fulfillment_method: safeText(order.fulfillment_method || order.fulfillment_type, 80) || null,
    assigned_delivery_date: isoDate(order.assigned_delivery_date || order.selected_delivery_date || order.estimated_delivery_date || order.delivery_date) || null,
    production_date: isoDate(order.production_date) || null,
    delivered_at_present: Boolean(order.delivered_at || order.fulfilled_at || order.completed_at),
    fulfilled_at_present: Boolean(order.fulfilled_at || order.delivered_at || order.completed_at),
    line_item_count: Array.isArray(order.line_items) ? order.line_items.length : 0,
    total_present: order.total_price !== undefined || order.total !== undefined || order.current_total_price !== undefined,
    cancelled_or_refunded: isCancelledOrRefunded(order),
    subscription_or_multi_delivery: isSubscriptionOrMultiDelivery(order),
    audit_fallback_used: Boolean(order.audit_fallback_reason),
  } : null;
}

function auditedHubFallbackOrder(orderNumber) {
  const fallback = AUDITED_HUB_FULFILLED_FALLBACKS[normalizeOrderNumber(orderNumber)];
  return fallback ? { ...fallback } : null;
}

function hubBaseUrl() {
  return HUB_API_URL ? HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '') : null;
}

async function fetchHubOrders({ hubOrderNumber: orderNumber, since = DEFAULT_HUB_SINCE } = {}) {
  const hubBase = hubBaseUrl();
  if (!hubBase || !CUSTOMER_APP_SYNC_SECRET) return { ok: false, status: 0, error_code: 'hub_config_missing', orders: [] };
  const url = new URL(`${hubBase}/functions/getOrderUpdatesForCustomerApp`);
  if (since) url.searchParams.set('since', since);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HUB_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}` }, signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status, error_code: `hub_fetch_failed_${response.status}`, orders: [] };
    const data = await response.json().catch(() => null);
    const orders = Array.isArray(data?.orders) ? data.orders : [];
    const targetKey = normalizeLower(orderNumber);
    const filtered = targetKey ? orders.filter(order => normalizeLower(hubOrderNumber(order)) === targetKey) : orders;
    return { ok: true, status: response.status, orders: filtered };
  } catch (error) {
    return { ok: false, status: 0, error_code: error?.name === 'AbortError' ? 'hub_fetch_timeout' : 'hub_fetch_failed', orders: [] };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHubTasksForOrder(orderNumber) {
  const hubBase = hubBaseUrl();
  if (!hubBase || !CUSTOMER_APP_SYNC_SECRET || !orderNumber) return { ok: false, status: 0, error_code: 'hub_task_detail_unavailable', tasks: [] };
  const url = new URL(`${hubBase}/functions/getFulfillmentTaskDetailsForCustomerApp`);
  url.searchParams.set('order_number', orderNumber);
  url.searchParams.set('limit', HUB_TASK_FETCH_LIMIT);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HUB_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}` }, signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status, error_code: `hub_task_fetch_failed_${response.status}`, tasks: [] };
    const data = await response.json().catch(() => null);
    return { ok: true, status: response.status, matched_by: data?.matched_by || null, tasks: Array.isArray(data?.tasks) ? data.tasks : [] };
  } catch (error) {
    return { ok: false, status: 0, error_code: error?.name === 'AbortError' ? 'hub_task_fetch_timeout' : 'hub_task_fetch_failed', tasks: [] };
  } finally {
    clearTimeout(timeout);
  }
}

function recordText(record) {
  return normalizeLower([
    record?.id,
    record?.order_number,
    record?.shopify_order_number,
    record?.name,
    record?.hub_order_id,
    record?.source_order_id,
    record?.shopify_order_id,
    record?.native_shopify_order_id,
    record?.base44_order_id,
  ].filter(Boolean).join(' '));
}

function exactDuplicateMatch(row, { orderNumber, hubOrderId, nativeShopifyOrderId }) {
  const text = recordText(row);
  const orderKey = normalizeLower(orderNumber);
  const hubKey = normalizeLower(hubOrderId);
  const nativeKey = normalizeLower(nativeShopifyOrderId);
  return Boolean(
    (orderKey && text.includes(orderKey)) ||
    (hubKey && text.includes(hubKey)) ||
    (nativeKey && normalizeLower(row?.id) === nativeKey),
  );
}

async function findLocalRecords(base44, { hubOrderNumber: orderNumber, hubOrderId, nativeShopifyOrderId }) {
  const searches = async (entityName, filters) => {
    const groups = await Promise.all(filters.map(filter => filterEntity(base44, entityName, filter, '-created_date', 20)));
    const flat = groups.flat();
    return [...new Map(flat.map(row => [row.id || JSON.stringify(row), row])).values()]
      .filter(row => exactDuplicateMatch(row, { orderNumber, hubOrderId, nativeShopifyOrderId }));
  };

  const orderFilters = unique([{ order_number: orderNumber }, { shopify_order_number: orderNumber }]);
  const sourceFilters = unique([
    hubOrderId ? { hub_order_id: hubOrderId } : null,
    hubOrderId ? { source_order_id: hubOrderId } : null,
    hubOrderId ? { shopify_order_id: hubOrderId } : null,
    nativeShopifyOrderId ? { id: nativeShopifyOrderId } : null,
    { shopify_order_id: `historical_hub_fulfilled:${orderNumber}` },
  ]);

  const [customerOrders, nativeOrders, tasks, orderSyncLogs, reviewRows, commandLogs, parityLogs, notifications, messageLogs] = await Promise.all([
    searches('Order', [...orderFilters, ...sourceFilters]),
    searches('ShopifyOrder', [...orderFilters, ...sourceFilters]),
    searches('FulfillmentTask', [...orderFilters, ...sourceFilters]),
    searches('OrderSyncLog', [...orderFilters, ...sourceFilters]),
    searches('OrderReviewQueue', [...orderFilters, ...sourceFilters]),
    searches('CommandLog', [{ target_display_id: orderNumber }, { related_order_number: orderNumber }, { request_id: `g32m_historical_native_shopify_order_backfill_${orderNumber}` }, ...sourceFilters]),
    searches('SafeSyncParityLog', [...orderFilters, ...sourceFilters]),
    searches('Notification', [...orderFilters, ...sourceFilters]),
    searches('CustomerMessageDeliveryLog', [...orderFilters, ...sourceFilters]),
  ]);

  return { customerOrders, nativeOrders, tasks, orderSyncLogs, reviewRows, commandLogs, parityLogs, notifications, messageLogs };
}

function summarizeNativeMirror(order) {
  if (!order) return null;
  return {
    native_shopify_order_id: safeId(order.id, 140) || null,
    shopify_order_number: safeText(order.shopify_order_number, 80) || null,
    shopify_order_id: safeText(order.shopify_order_id, 120) || null,
    source_type: safeText(order.source_type, 80) || null,
    source_channel: safeText(order.source_channel, 80) || null,
    order_type: safeText(order.order_type, 80) || null,
    fulfillment_mode: safeText(order.fulfillment_mode, 80) || null,
    fulfillment_method: safeText(order.fulfillment_method, 80) || null,
    production_status: safeText(order.production_status, 80) || null,
    fulfillment_status: safeText(order.fulfillment_status, 80) || null,
    shopify_fulfillment_status: safeText(order.shopify_fulfillment_status, 80) || null,
    sync_status: safeText(order.sync_status, 120) || null,
    operational_visibility: safeText(order.operational_visibility, 120) || null,
    line_item_count: Array.isArray(order.line_items) ? order.line_items.length : 0,
    customer_name_written: Boolean(order.customer_name),
    customer_email_written: Boolean(order.customer_email),
    customer_phone_written: Boolean(order.customer_phone),
    raw_payload_present: Boolean(order.shopify_raw_payload || order.raw_payload || order.raw_hub_payload),
    proof_drop_route_fields_present: Boolean(order.delivery_photo_url || order.delivery_drop_location || order.delivered_by || order.route_id || order.route_stop_sequence),
  };
}

function nativeMirrorIsValid(order, lookup) {
  return Boolean(
    order &&
    (!lookup.nativeShopifyOrderId || order.id === lookup.nativeShopifyOrderId) &&
    normalizeOrderNumber(order.shopify_order_number) === TARGET_HUB_ORDER_NUMBER &&
    normalizeLower(order.source_type) === HISTORICAL_MIRROR_SOURCE_TYPE &&
    (!order.sync_status || normalizeLower(order.sync_status) === HISTORICAL_MIRROR_SYNC_STATUS) &&
    normalizeLower(order.production_status) === 'fulfilled' &&
    normalizeLower(order.fulfillment_status) === 'fulfilled'
  );
}

function buildProposedCustomerAppOrderPreview({ hubStatus, nativeMirror, customerBackfillRecommendation }) {
  return {
    record_type: 'Customer App Order',
    action: 'held_preview_only',
    recommendation: customerBackfillRecommendation,
    proposed_safe_fields: {
      order_number: TARGET_HUB_ORDER_NUMBER,
      status: 'delivered',
      payment_status: hubStatus?.payment_status || nativeMirror?.payment_status || null,
      line_item_count: nativeMirror?.line_item_count || hubStatus?.line_item_count || 0,
      customer_identity_present_not_printed: hubStatus?.customer_email_present === true || hubStatus?.customer_name_present === true,
      delivery_date: hubStatus?.assigned_delivery_date || null,
      source_type: 'hub_historical_backfill_customer_order_if_separately_approved',
      operational_visibility_option: 'admin_only_if_schema_supports_else_customer_visible_risk',
      status_history_preview: 'would require separate exact approval; not written by G32N',
    },
    customer_visibility_risk: 'customer_visible_if_created_with_customer_email',
    writes_performed: false,
  };
}

function buildProposedFulfillmentTaskPreview({ hubTasksResult, hubStatus, nativeMirror, taskBackfillRecommendation }) {
  return {
    record_type: 'Native FulfillmentTask',
    action: 'held_preview_only',
    recommendation: taskBackfillRecommendation,
    proposed_safe_fields: {
      order_number: TARGET_HUB_ORDER_NUMBER,
      native_shopify_order_id: nativeMirror?.native_shopify_order_id || null,
      status: 'delivered',
      delivery_status: 'delivered',
      production_status: 'fulfilled',
      delivered_at_required: true,
      delivery_date: hubStatus?.assigned_delivery_date || null,
      hub_task_rows_present: Array.isArray(hubTasksResult?.tasks) && hubTasksResult.tasks.length > 0,
      proof_drop_policy: REQUIRED_PROOF_DROP_POLICY,
    },
    delivery_queue_risk: 'creating a task can create historical delivery queue artifacts unless delivered/hidden behavior is separately contracted',
    writes_performed: false,
  };
}

function buildPreview({ lookup, hubOrder, hubFetchResult, hubTasksResult, localRecords, auth }) {
  const hubStatus = safeHubOrderStatus(hubOrder);
  const nativeMirror = localRecords.nativeOrders.find(order => nativeMirrorIsValid(order, lookup)) || localRecords.nativeOrders[0] || null;
  const nativeMirrorSummary = summarizeNativeMirror(nativeMirror);
  const policyErrors = policyBlockers(lookup);
  const hubOrderPresent = Boolean(hubOrder);
  const nativeMirrorPresent = Boolean(nativeMirror);
  const customerOrderPresent = localRecords.customerOrders.length > 0;
  const taskPresent = localRecords.tasks.length > 0;
  const hubTasksAbsent = !Array.isArray(hubTasksResult?.tasks) || hubTasksResult.tasks.length === 0;
  const customerIdentityPresent = hubStatus?.customer_email_present === true || hubStatus?.customer_name_present === true;
  const paymentMissing = !hubStatus?.payment_status;
  const mirrorSufficientForAdminHistoricalContext = nativeMirrorPresent && !customerOrderPresent && !taskPresent;

  const blockers = unique([
    lookup.hubOrderNumber !== TARGET_HUB_ORDER_NUMBER ? 'target_hub_order_number_mismatch' : null,
    lookup.nativeShopifyOrderId && lookup.nativeShopifyOrderId !== TARGET_NATIVE_SHOPIFY_ORDER_ID ? 'native_shopify_order_id_mismatch' : null,
    ...policyErrors,
    !hubOrderPresent ? 'hub_order_not_found' : null,
    hubOrderPresent && !isHubFulfilled(hubOrder) ? 'hub_order_not_fulfilled' : null,
    hubOrderPresent && isCancelledOrRefunded(hubOrder) ? 'hub_order_cancelled_or_refunded' : null,
    hubOrderPresent && isSubscriptionOrMultiDelivery(hubOrder) ? 'subscription_multi_delivery_not_supported' : null,
    !nativeMirrorPresent ? 'historical_native_shopify_order_mirror_missing' : null,
    nativeMirrorPresent && !nativeMirrorIsValid(nativeMirror, lookup) ? 'historical_native_shopify_order_mirror_invalid' : null,
  ]);

  const customerAppOrderBackfillRecommendation = (() => {
    if (customerOrderPresent) return 'customer_app_order_backfill_not_needed_existing_order_present';
    if (!customerIdentityPresent || paymentMissing) return 'customer_app_order_backfill_blocked_missing_payment_or_customer_data';
    if (mirrorSufficientForAdminHistoricalContext) return 'customer_app_order_backfill_hold';
    return 'customer_app_order_backfill_customer_visible_requires_owner_approval';
  })();

  const nativeFulfillmentTaskBackfillRecommendation = (() => {
    if (taskPresent) return 'native_fulfillment_task_backfill_not_needed_existing_task_present';
    if (hubTasksAbsent) return 'native_fulfillment_task_backfill_hold';
    return 'native_fulfillment_task_backfill_requires_delivered_timestamp';
  })();

  const customerFacingImpact = {
    risk_level: customerOrderPresent ? 'low_existing_record' : 'high_customer_visible_if_created',
    would_expose_order_to_customer: !customerOrderPresent,
    order_history_visibility: !customerOrderPresent ? 'would likely become customer-visible because Order access is customer_email scoped' : 'already represented locally',
    rewards_loyalty_analytics_impact: !customerOrderPresent ? 'possible_if_live_customer_order_backfill_is_approved' : 'no_new_customer_app_order_projected',
    status_history_impact: 'held_not_written',
    notification_would_send: false,
    recommendation: customerAppOrderBackfillRecommendation,
  };

  const deliveryQueueImpact = {
    risk_level: taskPresent ? 'low_existing_task' : 'medium_stale_queue_artifact_risk',
    would_create_delivery_queue_artifact: !taskPresent,
    active_delivery_queue_row_projected: false,
    reason: taskPresent ? 'existing FulfillmentTask already represents task context' : 'no Hub task rows; reconstructing a delivered task could confuse operations without a separate delivered-task contract',
    recommendation: nativeFulfillmentTaskBackfillRecommendation,
  };

  const warnings = unique([
    hubFetchResult?.ok === false ? hubFetchResult.error_code : null,
    hubTasksResult?.ok === false ? hubTasksResult.error_code : null,
    hubStatus?.audit_fallback_used ? 'hub_safe_audit_fallback_used' : null,
    normalizeLower(hubOrder?.production_status || hubOrder?.status) === 'new' && isHubFulfilled(hubOrder) ? 'hub_production_status_new_despite_fulfilled' : null,
    hubTasksAbsent ? 'hub_task_rows_absent' : null,
    paymentMissing ? 'hub_payment_status_missing' : null,
    customerOrderPresent ? 'existing_customer_app_order_present' : 'customer_app_order_missing_held',
    taskPresent ? 'existing_native_fulfillment_task_present' : 'native_fulfillment_task_missing_held',
    'notifications_held',
    'proof_drop_held',
    'hub_mutation_not_proposed',
    'raw_payload_not_used',
  ]);

  const backfillRiskLevel = (() => {
    if (blockers.length > 0) return 'blocked';
    if (!customerOrderPresent && !taskPresent) return 'medium_high_customer_visibility_and_queue_artifact_risk';
    if (!customerOrderPresent || !taskPresent) return 'medium_partial_backfill_risk';
    return 'low_existing_records';
  })();

  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    preview_only: true,
    safety: READ_ONLY_SAFETY,
    function_name: FUNCTION_NAME,
    generated_at: new Date().toISOString(),
    actor_type: auth?.actor_type || 'admin',
    hub_order_number: safeText(lookup.hubOrderNumber, 80) || null,
    native_shopify_order_id: nativeMirrorSummary?.native_shopify_order_id || lookup.nativeShopifyOrderId || null,
    preview_mode: lookup.previewMode,
    notification_policy: lookup.notificationPolicy,
    proof_drop_policy: lookup.proofDropPolicy,
    hub_order_present: hubOrderPresent,
    hub_order_context: hubStatus,
    hub_fulfillment_status: safeText(hubOrder?.fulfillment_status || hubOrder?.shopify_fulfillment_status, 80) || null,
    hub_production_status: safeText(hubOrder?.production_status || hubOrder?.status, 80) || null,
    native_shopify_order_present: nativeMirrorPresent,
    native_shopify_order_mirror: nativeMirrorSummary,
    customer_app_order_present: customerOrderPresent,
    native_fulfillment_task_present: taskPresent,
    local_context_counts: {
      customer_app_order_count: localRecords.customerOrders.length,
      native_shopify_order_count: localRecords.nativeOrders.length,
      native_fulfillment_task_count: localRecords.tasks.length,
      order_sync_log_count: localRecords.orderSyncLogs.length,
      order_review_queue_count: localRecords.reviewRows.length,
      command_log_count: localRecords.commandLogs.length,
      safe_sync_parity_log_count: localRecords.parityLogs.length,
      notification_count: localRecords.notifications.length,
      message_log_count: localRecords.messageLogs.length,
    },
    native_shopify_order_mirror_sufficient_for_admin_historical_context: mirrorSufficientForAdminHistoricalContext,
    customer_app_order_backfill_recommended: false,
    customer_app_order_backfill_recommendation: customerAppOrderBackfillRecommendation,
    native_fulfillment_task_backfill_recommended: false,
    native_fulfillment_task_backfill_recommendation: nativeFulfillmentTaskBackfillRecommendation,
    backfill_risk_level: backfillRiskLevel,
    customer_facing_impact: customerFacingImpact,
    notification_impact: false,
    notification_would_send: false,
    notification_held: true,
    delivery_queue_impact: deliveryQueueImpact,
    proof_drop_impact: {
      proof_drop_required: false,
      proof_drop_policy: REQUIRED_PROOF_DROP_POLICY,
      would_write_proof_drop_fields: false,
    },
    proposed_customer_app_order_preview: buildProposedCustomerAppOrderPreview({ hubStatus, nativeMirror: nativeMirrorSummary, customerBackfillRecommendation: customerAppOrderBackfillRecommendation }),
    proposed_fulfillment_task_preview: buildProposedFulfillmentTaskPreview({ hubTasksResult, hubStatus, nativeMirror: nativeMirrorSummary, taskBackfillRecommendation: nativeFulfillmentTaskBackfillRecommendation }),
    held_records: [
      {
        record_type: 'Customer App Order',
        action: 'held',
        recommendation: customerAppOrderBackfillRecommendation,
        reason: 'historical Customer App Order creation can expose order 1052 to the customer account and requires separate explicit approval',
      },
      {
        record_type: 'Native FulfillmentTask',
        action: 'held',
        recommendation: nativeFulfillmentTaskBackfillRecommendation,
        reason: hubTasksAbsent ? 'Hub task rows absent; delivered task reconstruction needs a dedicated contract' : 'task backfill requires separate delivered-task contract',
      },
      {
        record_type: 'Notification/MessageLog',
        action: 'held',
        reason: 'notification_policy is NO_NOTIFICATION',
      },
      {
        record_type: 'Proof/Drop/Route fields',
        action: 'held',
        reason: 'proof_drop_policy is HELD_NOT_REQUIRED_FOR_RECONCILIATION',
      },
      {
        record_type: 'Hub records',
        action: 'not_mutated',
        reason: 'Hub remains read-only source context',
      },
    ],
    safe_hub_read_context: {
      order_fetch_attempted: true,
      order_fetch_success: hubFetchResult?.ok === true,
      order_fetch_status: hubFetchResult?.status || null,
      task_fetch_attempted: true,
      task_fetch_success: hubTasksResult?.ok === true,
      task_fetch_status: hubTasksResult?.status || null,
      hub_task_count: Array.isArray(hubTasksResult?.tasks) ? hubTasksResult.tasks.length : 0,
    },
    blockers,
    warnings,
    next_action: blockers.length > 0
      ? 'hold_historical_customer_task_backfill_for_blockers'
      : mirrorSufficientForAdminHistoricalContext
        ? 'hold_additional_backfill_native_shopify_order_mirror_sufficient'
        : 'review_customer_order_or_task_backfill_only_with_separate_approval',
  };
}

async function findHubOrder(lookup) {
  const hubFetchResult = await fetchHubOrders({ hubOrderNumber: lookup.hubOrderNumber, since: lookup.since });
  const hubByNumber = new Map((hubFetchResult.orders || []).map(order => [normalizeLower(hubOrderNumber(order)), order]).filter(([key]) => Boolean(key)));
  let hubOrder = hubByNumber.get(normalizeLower(lookup.hubOrderNumber)) || null;
  if (!hubOrder) hubOrder = auditedHubFallbackOrder(lookup.hubOrderNumber);
  return { hubOrder, hubFetchResult };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', message: 'POST required', writes_performed: false }, { status: 405 });
    }
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return Response.json({ success: false, error_code: 'malformed_json', writes_performed: false }, { status: 400 });
    const body = parsed.body || {};
    if (body.mode && body.mode !== 'dry_run') return Response.json({ success: false, error_code: 'dry_run_only', writes_performed: false }, { status: 400 });
    const badKey = unsupportedBodyKey(body);
    if (badKey) return Response.json({ success: false, error_code: 'unsupported_request_field', field: safeText(badKey, 80), writes_performed: false }, { status: 400 });

    const lookup = lookupFromBody(body);
    if (!lookup.hubOrderNumber) return Response.json({ success: false, error_code: 'hub_order_number_required', writes_performed: false }, { status: 400 });
    if (!lookup.previewMode || !lookup.notificationPolicy || !lookup.customerAppOrderBackfill || !lookup.nativeFulfillmentTaskBackfill || !lookup.proofDropPolicy) {
      return Response.json({ success: false, error_code: 'preview_policy_required', writes_performed: false }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const auth = await requirePreviewAccess({ base44, req, body });
    if (!auth.ok) return auth.response;

    const { hubOrder, hubFetchResult } = await findHubOrder(lookup);
    const hubTasksResult = await fetchHubTasksForOrder(lookup.hubOrderNumber);
    const localRecords = await findLocalRecords(base44, { hubOrderNumber: lookup.hubOrderNumber, hubOrderId: hubOrderIdValue(hubOrder), nativeShopifyOrderId: lookup.nativeShopifyOrderId });
    return Response.json(buildPreview({ lookup, hubOrder, hubFetchResult, hubTasksResult, localRecords, auth }));
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] failed safely: ${error?.message || 'unknown error'}`);
    return Response.json({
      success: false,
      dry_run: true,
      error_code: 'historical_customer_task_backfill_impact_preview_failed',
      message: 'Historical Customer App Order / FulfillmentTask backfill impact preview failed safely; no records were changed.',
      writes_performed: false,
    }, { status: 500 });
  }
});

export {
  READ_ONLY_SAFETY,
  lookupFromBody,
  unsupportedBodyKey,
  policyBlockers,
  safeHubOrderStatus,
  auditedHubFallbackOrder,
  isHubFulfilled,
  isCancelledOrRefunded,
  isSubscriptionOrMultiDelivery,
  summarizeNativeMirror,
  nativeMirrorIsValid,
  buildProposedCustomerAppOrderPreview,
  buildProposedFulfillmentTaskPreview,
  buildPreview,
  REQUIRED_PREVIEW_MODE,
  REQUIRED_NOTIFICATION_POLICY,
  REQUIRED_CUSTOMER_APP_ORDER_BACKFILL,
  REQUIRED_NATIVE_TASK_BACKFILL,
  REQUIRED_PROOF_DROP_POLICY,
  TARGET_HUB_ORDER_NUMBER,
  TARGET_NATIVE_SHOPIFY_ORDER_ID,
};
