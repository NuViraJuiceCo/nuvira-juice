import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const FUNCTION_NAME = 'backfillHistoricalHubFulfilledNativeShopifyOrderForCustomerApp';
const COMMAND_TYPE = 'historical_hub_fulfilled_native_shopify_order_backfill';
const ENABLE_FLAG = 'ENABLE_HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL';
const KILL_SWITCH_FLAG = 'HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL_KILL_SWITCH';
const ALLOWED_EMAILS_FLAG = 'HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL_ALLOWED_EMAILS';
const ORDER_ALLOWLIST_FLAG = 'HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL_ORDER_ALLOWLIST';
const POLICY_FLAG = 'HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL_POLICY';
const REQUIRED_POLICY = 'HISTORICAL_FULFILLED_NATIVE_SHOPIFY_ORDER_ONLY_NO_NOTIFICATION';
const REQUIRED_CORRECTION_MODE = 'HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION';
const REQUIRED_NOTIFICATION_POLICY = 'NO_NOTIFICATION';
const REQUIRED_CUSTOMER_APP_ORDER_BACKFILL_POLICY = 'HELD';
const REQUIRED_NATIVE_TASK_BACKFILL_POLICY = 'HELD';
const REQUIRED_PROOF_DROP_POLICY = 'HELD_NOT_REQUIRED_FOR_RECONCILIATION';
const CONFIRMATION_PHRASE = 'backfill_historical_hub_fulfilled_native_shopify_order_no_notification';
const TARGET_HUB_ORDER_NUMBER = '1052';
const DEFAULT_HUB_SINCE = '2026-05-01';
const HUB_FETCH_TIMEOUT_MS = 8000;
const PREVIEW_TIMEOUT_MS = 8000;
const TARGET_PRODUCTION_STATUS = 'fulfilled';
const TARGET_FULFILLMENT_STATUS = 'fulfilled';
const TARGET_SOURCE_TYPE = 'hub_historical_backfill';
const TARGET_SOURCE_CHANNEL = 'admin';
const TARGET_ORDER_TYPE = 'one_time';
const TARGET_FULFILLMENT_MODE = 'single_delivery';
const TARGET_FULFILLMENT_METHOD = 'delivery';
const TARGET_SYNC_STATUS = 'historical_hub_fulfilled_native_mirror_g32l';
const MAX_TEXT = 180;

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

const SHOPIFY_ORDER_SCHEMA_FIELDS = new Set([
  'shopify_order_id',
  'shopify_order_number',
  'description',
  'base44_order_id',
  'source_channel',
  'customer_name',
  'customer_email',
  'customer_phone',
  'line_items',
  'fulfillment_method',
  'delivery_address',
  'requested_delivery_date',
  'requested_time_window',
  'payment_status',
  'fulfillment_status',
  'shopify_fulfillment_status',
  'financial_status',
  'subtotal',
  'total_tax',
  'total_discounts',
  'tip_received',
  'total_price',
  'discount_codes',
  'customer_notes',
  'internal_notes',
  'tags',
  'is_pos_order',
  'is_subscription',
  'subscription_cadence',
  'event_name',
  'event_date',
  'event_location',
  'assigned_driver',
  'production_status',
  'workflow_checklist',
  'shopify_synced_at',
  'shopify_raw_payload',
  'assigned_delivery_date',
  'order_type',
  'fulfillment_mode',
  'customer_order_date',
  'internal_customer_id',
  'customer_app_user_id',
  'address_line1',
  'address_line2',
  'address_city',
  'address_state',
  'address_postal_code',
  'address_country',
  'delivery_notes',
  'address_last_synced_from',
  'address_last_synced_at',
  'fulfillments',
  'production_snapshot',
  'selected_delivery_date',
  'production_date',
  'delivery_window_label',
  'order_lock_status',
  'order_status',
  'operational_visibility',
  'sync_status',
  'last_sync_at',
  'stripe_customer_id',
  'stripe_checkout_session_id',
  'stripe_payment_intent_id',
  'stripe_invoice_id',
  'stripe_subscription_id',
  'stripe_charge_id',
  'stripe_event_id_applied',
  'stripe_created_event_type',
  'last_reconciliation_at',
  'source_type',
  'repair_status',
  'repair_timestamp',
  'repair_method',
  'subscription_parent_id',
  'fulfillment_instance_date',
  'fulfillment_sequence_number',
  'source_invoice_id',
  'data_quality_status',
  'last_verified_at',
  'delivery_photo_url',
  'delivery_drop_location',
  'delivered_by',
  'delivered_at',
  'manual_override',
  'manual_override_at',
  'manual_override_by',
  'audit_trail',
  'delivery_zone_key',
  'delivery_zone_name',
  'delivery_zone_type',
  'delivery_fee',
  'minimum_order',
  'distance_miles',
  'drive_time_minutes',
  'approval_request_id',
  'approval_status',
  'approved_delivery_fee',
  'route_review_required',
  'origin_address',
  'refunded_at',
  'cancel_type',
  'excluded_from_production',
]);

const PRODUCTION_STATUS_VALUES = new Set([
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

const SOURCE_CHANNEL_VALUES = new Set(['online', 'pos', 'draft', 'subscription', 'wholesale', 'admin', 'event']);
const ORDER_TYPE_VALUES = new Set(['one_time', 'subscription', 'pos', 'wholesale', 'admin', 'event']);
const FULFILLMENT_METHOD_VALUES = new Set(['delivery', 'pickup', 'shipping', 'pos']);
const FULFILLMENT_MODE_VALUES = new Set(['single_delivery', 'multi_delivery']);

const ALLOWED_BODY_KEYS = new Set([
  'mode',
  'hub_order_number',
  'request_id',
  'correction_mode',
  'notification_policy',
  'customer_app_order_backfill',
  'native_fulfillment_task_backfill',
  'proof_drop_policy',
  'confirmation',
]);

const FORBIDDEN_BODY_KEYS = new Set([
  'customer_app_order_create',
  'create_customer_app_order',
  'customer_app_order_payload',
  'fulfillment_task_create',
  'native_fulfillment_task_create',
  'create_fulfillment_task',
  'task_payload',
  'notification',
  'notifications',
  'notification_payload',
  'notification_rows',
  'send_notification',
  'notify_customer',
  'push',
  'sms',
  'email',
  'in_app',
  'message_log',
  'message_logs',
  'proof',
  'proof_url',
  'proof_photo_url',
  'proof_file',
  'drop',
  'drop_location',
  'route',
  'route_id',
  'route_stop_sequence',
  'provider_payload',
  'payment_payload',
  'provider_id',
  'provider_ids',
  'stripe_id',
  'stripe_payload',
  'shopify_api',
  'shopify_payload',
  'sync',
  'repair',
  'replay',
  'production_batch',
  'production_batch_create',
  'batch_compliance_log',
  'compliance_log',
  'inventory_deduction',
  'deduct_inventory',
  'purchase_order',
  'create_purchase_order',
  'bulk_order_ids',
  'raw_payload',
  'payload',
  'raw_body',
  'raw_order',
  'raw_hub_payload',
  'raw_provider_payload',
  'headers',
  'authorization',
  'auth_header',
  'secret',
  'token',
  'api_key',
  'api-key',
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

function safeActorEmail(value) {
  const email = normalizeSingleLine(value).toLowerCase();
  return email && email.length <= 180 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isoDate(value) {
  const match = normalizeText(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function compactObject(value) {
  const out = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (item !== undefined && item !== null && item !== '') out[key] = item;
  }
  return out;
}

function uniqueStrings(values, limit = 120) {
  return [...new Set((values || []).map(value => safeText(value, 180)).filter(Boolean))].slice(0, limit);
}

function parseCsvSet(value) {
  return new Set(normalizeText(value).split(',').map(normalizeLower).filter(Boolean));
}

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
}

function safetyResult(extra = {}) {
  return {
    writes_performed: false,
    native_shopify_order_created: false,
    native_shopify_order_updated: false,
    customer_app_order_created: false,
    customer_app_order_updated: false,
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
    order_sync_log_created: false,
    order_review_queue_created: false,
    safe_sync_parity_log_created: false,
    provider_calls_performed: false,
    stripe_calls_performed: false,
    shopify_api_calls_performed: false,
    sync_repair_replay_performed: false,
    inventory_deducted: false,
    purchase_order_created: false,
    hub_bridge_modified: false,
    ...extra,
  };
}

function writeSafetyResult(extra = {}) {
  return safetyResult({ writes_performed: true, ...extra });
}

async function readJsonBody(req) {
  const raw = await req.text();
  if (!raw.trim()) return { ok: true, body: {} };
  try {
    const body = JSON.parse(raw);
    return body && typeof body === 'object' && !Array.isArray(body)
      ? { ok: true, body }
      : { ok: false, body: null };
  } catch {
    return { ok: false, body: null };
  }
}

function unsupportedBodyKey(body) {
  for (const key of Object.keys(body || {})) {
    const normalized = normalizeLower(key);
    if (ALLOWED_BODY_KEYS.has(normalized)) continue;
    if (FORBIDDEN_BODY_KEYS.has(normalized)) return key;
    if (/(^|_)(raw|payload|provider|stripe|shopify|inventory|purchase|notification|message|sync|repair|replay|bulk|proof|route|drop|task|customer|batch|compliance|hub)($|_)/i.test(normalized)) return key;
    return key;
  }
  return null;
}

function getPreviewSecret() {
  return normalizeText(Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET')) ||
    normalizeText(Deno.env.get('CUSTOMER_APP_SYNC_SECRET')) ||
    normalizeText(Deno.env.get('HUB_SYNC_SECRET'));
}

function shouldUseServicePreview() {
  return Deno.env.get('HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL_USE_SERVICE_PREVIEW') === 'true';
}

function getLookup(body) {
  return {
    hubOrderNumber: normalizeOrderNumber(body?.hub_order_number),
    requestId: safeId(body?.request_id, 180),
    correctionMode: normalizeUpper(body?.correction_mode),
    notificationPolicy: normalizeUpper(body?.notification_policy),
    customerAppOrderBackfill: normalizeUpper(body?.customer_app_order_backfill),
    nativeFulfillmentTaskBackfill: normalizeUpper(body?.native_fulfillment_task_backfill),
    proofDropPolicy: normalizeUpper(body?.proof_drop_policy),
  };
}

function exactTargetBlockers(lookup) {
  const blockers = [];
  if (lookup.hubOrderNumber !== TARGET_HUB_ORDER_NUMBER) blockers.push('target_hub_order_number_mismatch');
  if (!lookup.requestId) blockers.push('request_id_required');
  if (lookup.correctionMode !== REQUIRED_CORRECTION_MODE) blockers.push('correction_mode_must_be_historical_hub_fulfilled_backfill_no_notification');
  if (lookup.notificationPolicy !== REQUIRED_NOTIFICATION_POLICY) blockers.push('notification_policy_must_be_no_notification');
  if (lookup.customerAppOrderBackfill !== REQUIRED_CUSTOMER_APP_ORDER_BACKFILL_POLICY) blockers.push('customer_app_order_backfill_must_be_held');
  if (lookup.nativeFulfillmentTaskBackfill !== REQUIRED_NATIVE_TASK_BACKFILL_POLICY) blockers.push('native_fulfillment_task_backfill_must_be_held');
  if (lookup.proofDropPolicy !== REQUIRED_PROOF_DROP_POLICY) blockers.push('proof_drop_policy_must_be_held_not_required_for_reconciliation');
  return blockers;
}

function gateFailure({ actorEmail, lookup }) {
  if (Deno.env.get(KILL_SWITCH_FLAG) === 'true') return 'kill_switch_active';
  if (Deno.env.get(ENABLE_FLAG) !== 'true') return 'historical_hub_fulfilled_native_shopify_order_backfill_disabled';
  if (normalizeText(Deno.env.get(POLICY_FLAG)) !== REQUIRED_POLICY) return 'historical_fulfilled_native_shopify_order_only_no_notification_policy_required';

  const allowedEmails = parseCsvSet(Deno.env.get(ALLOWED_EMAILS_FLAG) || '');
  if (allowedEmails.size === 0) return 'allowed_email_gate_required';
  if (!allowedEmails.has(normalizeLower(actorEmail))) return 'actor_email_not_allowlisted';

  const orderAllowlist = parseCsvSet(Deno.env.get(ORDER_ALLOWLIST_FLAG) || '');
  if (orderAllowlist.size === 0) return 'order_allowlist_required';
  if (!orderAllowlist.has(normalizeLower(lookup.hubOrderNumber))) return 'hub_order_not_allowlisted';

  return null;
}

async function requireAdmin(base44) {
  try {
    const user = await base44.auth.me();
    if (!user) return { ok: false, status: 401, error_code: 'unauthorized', user: null };
    if (user.role !== 'admin') return { ok: false, status: 403, error_code: 'forbidden', user };
    return { ok: true, status: 200, error_code: null, user };
  } catch {
    return { ok: false, status: 401, error_code: 'unauthorized', user: null };
  }
}

async function filterEntity(base44, entityName, filter, sort = '-created_date', limit = 20) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity?.filter) return [];
  const rows = await entity.filter(filter, sort, limit).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

function hubBaseUrl() {
  return HUB_API_URL ? HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '') : null;
}

function hubOrderNumber(order) {
  return normalizeOrderNumber(order?.shopify_order_number || order?.order_number || order?.name);
}

function hubOrderIdValue(order) {
  return safeId(order?.id || order?.shopify_order_id || order?.hub_order_id || order?.source_order_id, 180);
}

async function fetchHubOrders({ hubOrderNumber, since = DEFAULT_HUB_SINCE } = {}) {
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
    const targetKey = normalizeLower(hubOrderNumber);
    const filtered = targetKey ? orders.filter(order => normalizeLower(hubOrderNumberFromAny(order)) === targetKey) : orders;
    return { ok: true, status: response.status, orders: filtered };
  } catch (error) {
    return { ok: false, status: 0, error_code: error?.name === 'AbortError' ? 'hub_fetch_timeout' : 'hub_fetch_failed', orders: [] };
  } finally {
    clearTimeout(timeout);
  }
}

function hubOrderNumberFromAny(order) {
  return hubOrderNumber(order);
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
  } : null;
}

function safeLineItems(order) {
  return (Array.isArray(order?.line_items) ? order.line_items : [])
    .slice(0, 60)
    .map(item => compactObject({
      title: safeText(item?.title || item?.name || item?.product_title, 160),
      variant_title: safeText(item?.variant_title, 120),
      sku: safeText(item?.sku, 80),
      quantity: safeNumber(item?.quantity, 0),
      price: item?.price === undefined || item?.price === null ? null : safeNumber(item.price, 0),
      total_discount: item?.total_discount === undefined || item?.total_discount === null ? null : safeNumber(item.total_discount, 0),
    }))
    .filter(item => item.title && item.quantity > 0);
}

async function findHubOrder(lookup) {
  const hubFetchResult = await fetchHubOrders({ hubOrderNumber: lookup.hubOrderNumber, since: DEFAULT_HUB_SINCE });
  const hubByNumber = new Map((hubFetchResult.orders || []).map(order => [normalizeLower(hubOrderNumber(order)), order]).filter(([key]) => Boolean(key)));
  const hubOrder = hubByNumber.get(normalizeLower(lookup.hubOrderNumber)) || null;
  return { hubOrder, hubFetchResult };
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
    record?.source_type,
    record?.sync_status,
  ].filter(Boolean).join(' '));
}

function exactDuplicateMatch(row, { orderNumber, hubOrderId }) {
  const text = recordText(row);
  const orderKey = normalizeLower(orderNumber);
  const hubKey = normalizeLower(hubOrderId);
  return Boolean((orderKey && text.includes(orderKey)) || (hubKey && text.includes(hubKey)));
}

async function searchEntityExact(base44, entityName, filters, context) {
  const groups = await Promise.all(filters.map(filter => filterEntity(base44, entityName, filter, '-created_date', 20)));
  const rows = [...new Map(groups.flat().map(row => [row.id || JSON.stringify(row), row])).values()];
  return rows.filter(row => exactDuplicateMatch(row, context));
}

async function findLocalRecords(base44, { hubOrderNumber, hubOrderId }) {
  const orderFilters = [{ order_number: hubOrderNumber }, { shopify_order_number: hubOrderNumber }];
  const sourceFilters = hubOrderId ? [{ hub_order_id: hubOrderId }, { source_order_id: hubOrderId }, { shopify_order_id: hubOrderId }] : [];
  const context = { orderNumber: hubOrderNumber, hubOrderId };
  const [customerOrders, nativeOrders, tasks, orderSyncLogs, reviewRows, commandLogs, parityLogs] = await Promise.all([
    searchEntityExact(base44, 'Order', [...orderFilters, ...sourceFilters], context),
    searchEntityExact(base44, 'ShopifyOrder', [...orderFilters, ...sourceFilters], context),
    searchEntityExact(base44, 'FulfillmentTask', [...orderFilters, ...sourceFilters], context),
    searchEntityExact(base44, 'OrderSyncLog', [...orderFilters, ...sourceFilters], context),
    searchEntityExact(base44, 'OrderReviewQueue', [...orderFilters, ...sourceFilters], context),
    searchEntityExact(base44, 'CommandLog', [{ target_display_id: hubOrderNumber }, { related_order_number: hubOrderNumber }, { request_id: `g32l_${hubOrderNumber}` }, ...sourceFilters], context),
    searchEntityExact(base44, 'SafeSyncParityLog', [...orderFilters, ...sourceFilters], context),
  ]);
  return { customerOrders, nativeOrders, tasks, orderSyncLogs, reviewRows, commandLogs, parityLogs };
}

async function findExistingCommandLog(base44, idempotencyKey) {
  return filterEntity(base44, 'CommandLog', { idempotency_key: idempotencyKey }, '-created_date', 3);
}

function nativeOrderCreatedByRequest(order, requestId) {
  if (!order || !requestId) return false;
  return Array.isArray(order.audit_trail) && order.audit_trail.some(entry => normalizeText(entry?.request_id) === requestId && normalizeText(entry?.source) === FUNCTION_NAME);
}

function schemaAudit() {
  return {
    schema_audited: true,
    shopify_order_number_required: true,
    production_status_fulfilled_supported: PRODUCTION_STATUS_VALUES.has(TARGET_PRODUCTION_STATUS),
    fulfillment_status_fulfilled_supported: true,
    source_channel_admin_supported: SOURCE_CHANNEL_VALUES.has(TARGET_SOURCE_CHANNEL),
    order_type_one_time_supported: ORDER_TYPE_VALUES.has(TARGET_ORDER_TYPE),
    fulfillment_mode_single_delivery_supported: FULFILLMENT_MODE_VALUES.has(TARGET_FULFILLMENT_MODE),
    fulfillment_method_delivery_supported: FULFILLMENT_METHOD_VALUES.has(TARGET_FULFILLMENT_METHOD),
    payment_status_required: false,
    customer_identity_required: false,
    audit_trail_supported: SHOPIFY_ORDER_SCHEMA_FIELDS.has('audit_trail'),
    sync_status_supported: SHOPIFY_ORDER_SCHEMA_FIELDS.has('sync_status'),
  };
}

function schemaMappingBlockers() {
  const audit = schemaAudit();
  const blockers = [];
  if (!audit.production_status_fulfilled_supported) blockers.push('production_status_fulfilled_not_schema_supported');
  if (!audit.fulfillment_status_fulfilled_supported) blockers.push('fulfillment_status_fulfilled_not_schema_supported');
  if (!audit.source_channel_admin_supported) blockers.push('source_channel_admin_not_schema_supported');
  if (!audit.order_type_one_time_supported) blockers.push('order_type_one_time_not_schema_supported');
  if (!audit.fulfillment_mode_single_delivery_supported) blockers.push('fulfillment_mode_single_delivery_not_schema_supported');
  if (!audit.fulfillment_method_delivery_supported) blockers.push('fulfillment_method_delivery_not_schema_supported');
  return blockers;
}

async function preflightTargetContext(base44, lookup) {
  const blockers = [];
  const warnings = [];
  const { hubOrder, hubFetchResult } = await findHubOrder(lookup);
  const hubOrderId = hubOrderIdValue(hubOrder);
  const localRecords = await findLocalRecords(base44, { hubOrderNumber: lookup.hubOrderNumber, hubOrderId });
  const hubStatus = safeHubOrderStatus(hubOrder);
  const lineItems = safeLineItems(hubOrder);

  blockers.push(...schemaMappingBlockers());
  if (!hubOrder) blockers.push('hub_order_not_found');
  if (hubOrder && hubOrderNumber(hubOrder) !== TARGET_HUB_ORDER_NUMBER) blockers.push('hub_order_number_mismatch');
  if (hubOrder && !isHubFulfilled(hubOrder)) blockers.push('hub_order_not_fulfilled');
  if (hubOrder && isCancelledOrRefunded(hubOrder)) blockers.push('hub_order_cancelled_or_refunded');
  if (hubOrder && isSubscriptionOrMultiDelivery(hubOrder)) blockers.push('subscription_multi_delivery_not_supported');
  if (lineItems.length === 0) blockers.push('hub_line_items_missing');
  if (schemaAudit().payment_status_required && !hubStatus?.payment_status) blockers.push('missing_payment_status_for_historical_backfill');
  if (schemaAudit().customer_identity_required && !hubStatus?.customer_email_present && !hubStatus?.customer_name_present) blockers.push('missing_customer_identity_for_historical_backfill');
  if (localRecords.customerOrders.length > 0) blockers.push('customer_app_order_already_exists_for_hub_order');
  if (localRecords.nativeOrders.length > 0) blockers.push('native_shopify_order_already_exists_for_hub_order');
  if (localRecords.tasks.length > 0) blockers.push('native_fulfillment_task_already_exists_for_hub_order');

  if (hubFetchResult?.ok === false) warnings.push(hubFetchResult.error_code || 'hub_fetch_failed');
  if (hubStatus && !hubStatus.payment_status) warnings.push('hub_payment_status_missing_not_required_by_schema');
  if (hubStatus && !hubStatus.customer_email_present && !hubStatus.customer_name_present) warnings.push('hub_customer_identity_missing_not_required_by_schema');
  if (normalizeLower(hubStatus?.production_status) === 'new' && isHubFulfilled(hubOrder)) warnings.push('hub_production_status_new_despite_fulfilled');
  warnings.push('customer_app_order_backfill_held');
  warnings.push('native_fulfillment_task_backfill_held');
  warnings.push('notifications_held');
  warnings.push('proof_drop_held');
  warnings.push('hub_mutation_not_proposed');

  return {
    ready: blockers.length === 0,
    blockers: uniqueStrings(blockers, 160),
    warnings: uniqueStrings(warnings, 160),
    hubOrder,
    hubStatus,
    hubFetchResult,
    hubOrderId,
    localRecords,
    lineItems,
    schema: schemaAudit(),
  };
}

function buildLocalFreshPreview(preflight, lookup) {
  return {
    success: preflight.ready,
    dry_run: true,
    writes_performed: false,
    preview_source: 'local_preflight',
    function_name: 'previewHistoricalHubFulfilledNativeBackfill',
    hub_order_number: lookup.hubOrderNumber,
    hub_order_present: Boolean(preflight.hubOrder),
    hub_fulfillment_status: safeText(preflight.hubStatus?.fulfillment_status, 80) || null,
    hub_production_status: safeText(preflight.hubStatus?.production_status, 80) || null,
    local_customer_app_order_present: preflight.localRecords.customerOrders.length > 0,
    native_shopify_order_present: preflight.localRecords.nativeOrders.length > 0,
    native_fulfillment_task_present: preflight.localRecords.tasks.length > 0,
    historical_backfill_needed: Boolean(preflight.hubOrder && preflight.localRecords.customerOrders.length === 0 && preflight.localRecords.nativeOrders.length === 0 && preflight.localRecords.tasks.length === 0),
    proposed_backfill_mode: REQUIRED_CORRECTION_MODE,
    correction_mode: REQUIRED_CORRECTION_MODE,
    notification_policy: REQUIRED_NOTIFICATION_POLICY,
    proof_drop_policy: REQUIRED_PROOF_DROP_POLICY,
    proposed_records: [{
      record_type: 'Native ShopifyOrder',
      action: 'create_historical_fulfilled_mirror',
      ready_for_dedicated_live_contract: preflight.ready,
      proposed_safe_fields: {
        shopify_order_number: TARGET_HUB_ORDER_NUMBER,
        source_type: TARGET_SOURCE_TYPE,
        source_channel: TARGET_SOURCE_CHANNEL,
        order_type: TARGET_ORDER_TYPE,
        production_status: TARGET_PRODUCTION_STATUS,
        fulfillment_status: TARGET_FULFILLMENT_STATUS,
        line_item_count: preflight.lineItems.length,
        total_present: preflight.hubStatus?.total_present === true,
        customer_identity_present_not_printed: preflight.hubStatus?.customer_email_present === true || preflight.hubStatus?.customer_name_present === true,
        backfill_marker: true,
        hub_source_id_present: preflight.hubStatus?.hub_order_id_present === true,
      },
    }],
    held_records: [
      { record_type: 'Customer App Order', action: 'held' },
      { record_type: 'Native FulfillmentTask', action: 'held' },
      { record_type: 'Notification/MessageLog', action: 'held' },
      { record_type: 'Hub records', action: 'not_mutated' },
      { record_type: 'Proof/Drop/Route fields', action: 'held' },
    ],
    data_quality_blockers: preflight.blockers,
    blockers: preflight.blockers,
    warnings: preflight.warnings,
    notification_would_send: false,
    notification_impact: false,
    hub_mutation: false,
    proof_drop_impact: { proof_drop_required: false, policy: REQUIRED_PROOF_DROP_POLICY, would_write_proof_drop_fields: false },
    next_action: preflight.ready ? 'approve_historical_native_shopify_order_mirror_backfill_or_hold_customer_app_backfill' : 'hold_historical_backfill_for_hub_data_blockers',
    safety: safetyResult(),
  };
}

async function fetchFreshPreview(base44, lookup) {
  const secret = getPreviewSecret();
  if (!secret) return { ok: false, status: 409, error_code: 'preview_secret_not_configured', data: null };
  try {
    const invokePromise = base44.asServiceRole.functions.invoke('previewHistoricalHubFulfilledNativeBackfill', {
      mode: 'dry_run',
      hub_order_number: TARGET_HUB_ORDER_NUMBER,
      correction_mode: REQUIRED_CORRECTION_MODE,
      notification_policy: REQUIRED_NOTIFICATION_POLICY,
      proof_drop_policy: REQUIRED_PROOF_DROP_POLICY,
      request_id: `${lookup.requestId || 'g32l'}:fresh_historical_hub_fulfilled_preview`,
      _internal_secret: secret,
    });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error('Fresh historical Hub fulfilled preview invocation timed out');
        error.status = 504;
        error.code = 'historical_hub_fulfilled_backfill_preview_timeout';
        reject(error);
      }, PREVIEW_TIMEOUT_MS);
    });
    const response = await Promise.race([invokePromise, timeoutPromise]);
    const data = response?.data || response;
    if (!data?.success) return { ok: false, status: 409, error_code: data?.error_code || 'historical_hub_fulfilled_backfill_preview_failed', data };
    return { ok: true, status: 200, data };
  } catch (error) {
    const status = error?.response?.status || error?.status || 502;
    const data = error?.response?.data || error?.data || null;
    return { ok: false, status, error_code: data?.error_code || error?.code || 'historical_hub_fulfilled_backfill_preview_failed', data };
  }
}

function validateFreshPreview(preview) {
  const blockers = [];
  const warnings = [];
  const proposedRecord = Array.isArray(preview?.proposed_records) ? preview.proposed_records.find(record => record?.record_type === 'Native ShopifyOrder') : null;
  const proposedFields = proposedRecord?.proposed_safe_fields || {};
  const proofDropImpact = preview?.proof_drop_impact || {};
  const safety = preview?.safety || {};

  if (!preview?.success) blockers.push('fresh_historical_hub_preview_failed');
  if (preview?.dry_run !== true) blockers.push('fresh_historical_hub_preview_not_dry_run');
  if (preview?.writes_performed !== false) blockers.push('fresh_historical_hub_preview_writes_flag_not_false');
  if (preview?.hub_order_number !== TARGET_HUB_ORDER_NUMBER) blockers.push('fresh_preview_hub_order_number_mismatch');
  if (preview?.hub_order_present !== true) blockers.push('fresh_preview_hub_order_not_present');
  if (normalizeLower(preview?.hub_fulfillment_status) !== TARGET_FULFILLMENT_STATUS) blockers.push('fresh_preview_hub_order_not_fulfilled');
  if (preview?.local_customer_app_order_present !== false) blockers.push('fresh_preview_customer_app_order_exists');
  if (preview?.native_shopify_order_present !== false) blockers.push('fresh_preview_native_shopify_order_exists');
  if (preview?.native_fulfillment_task_present !== false) blockers.push('fresh_preview_native_fulfillment_task_exists');
  if (preview?.historical_backfill_needed !== true) blockers.push('fresh_preview_historical_backfill_not_needed');
  if (!proposedRecord || proposedRecord.ready_for_dedicated_live_contract !== true) blockers.push('fresh_preview_native_mirror_not_ready');
  if (proposedFields.production_status !== TARGET_PRODUCTION_STATUS) blockers.push('fresh_preview_production_status_mismatch');
  if (proposedFields.fulfillment_status !== TARGET_FULFILLMENT_STATUS) blockers.push('fresh_preview_fulfillment_status_mismatch');
  if (Number(proposedFields.line_item_count || 0) <= 0) blockers.push('fresh_preview_line_items_missing');
  if (preview?.notification_would_send !== false || preview?.notification_impact !== false) blockers.push('fresh_preview_notification_projected');
  if (preview?.hub_mutation !== false) blockers.push('fresh_preview_hub_mutation_projected');
  if (proofDropImpact.proof_drop_required === true || proofDropImpact.would_write_proof_drop_fields === true) blockers.push('fresh_preview_proof_drop_projected');
  if (Array.isArray(preview?.data_quality_blockers) && preview.data_quality_blockers.length > 0) blockers.push('fresh_preview_data_quality_blockers_present');
  if (Array.isArray(preview?.blockers) && preview.blockers.length > 0) blockers.push('fresh_preview_blockers_present');
  if (safety.writes_performed === true || safety.customer_app_order_created === true || safety.native_fulfillment_task_created === true || safety.notifications_created === true || safety.notifications_sent === true || safety.hub_records_updated === true || safety.provider_calls_performed === true || safety.shopify_api_calls_performed === true || safety.sync_repair_replay_performed === true) blockers.push('fresh_preview_side_effect_projected');
  if (Array.isArray(preview?.warnings)) warnings.push(...preview.warnings);
  return { ready: blockers.length === 0, blockers: uniqueStrings(blockers, 160), warnings: uniqueStrings(warnings, 160) };
}

function buildNativeShopifyOrderRecord({ hubOrder, preflight, requestId, user }) {
  const now = new Date().toISOString();
  const deliveryDate = preflight.hubStatus?.assigned_delivery_date || isoDate(hubOrder?.fulfilled_at || hubOrder?.delivered_at || hubOrder?.completed_at);
  const lineItems = preflight.lineItems;
  const totalPrice = hubOrder?.total_price ?? hubOrder?.total ?? hubOrder?.current_total_price;
  const auditEntry = compactObject({
    at: now,
    source: FUNCTION_NAME,
    action: 'create_historical_fulfilled_native_shopify_order_mirror',
    request_id: requestId,
    actor_role: safeText(user?.role, 80) || 'admin',
    hub_order_number: TARGET_HUB_ORDER_NUMBER,
    notification_policy: REQUIRED_NOTIFICATION_POLICY,
    proof_drop_policy: REQUIRED_PROOF_DROP_POLICY,
  });

  return compactObject({
    shopify_order_id: `historical_hub_fulfilled:${TARGET_HUB_ORDER_NUMBER}`,
    shopify_order_number: TARGET_HUB_ORDER_NUMBER,
    description: 'Historical Hub fulfilled native ShopifyOrder mirror created by exact gated G32L backfill. Customer App Order and FulfillmentTask backfills held.',
    source_channel: TARGET_SOURCE_CHANNEL,
    source_type: TARGET_SOURCE_TYPE,
    order_type: TARGET_ORDER_TYPE,
    fulfillment_mode: TARGET_FULFILLMENT_MODE,
    fulfillment_method: TARGET_FULFILLMENT_METHOD,
    line_items: lineItems,
    total_price: totalPrice === undefined || totalPrice === null ? null : safeNumber(totalPrice, 0),
    payment_status: safeText(hubOrder?.payment_status || hubOrder?.financial_status, 80) || null,
    financial_status: safeText(hubOrder?.financial_status || hubOrder?.payment_status, 80) || null,
    production_status: TARGET_PRODUCTION_STATUS,
    fulfillment_status: TARGET_FULFILLMENT_STATUS,
    shopify_fulfillment_status: TARGET_FULFILLMENT_STATUS,
    assigned_delivery_date: deliveryDate || null,
    selected_delivery_date: deliveryDate || null,
    customer_order_date: deliveryDate || null,
    order_lock_status: 'fulfilled',
    order_status: 'historical_fulfilled',
    operational_visibility: 'historical_backfill',
    sync_status: TARGET_SYNC_STATUS,
    last_sync_at: now,
    last_reconciliation_at: now,
    manual_override: true,
    manual_override_at: now,
    tags: ['historical_hub_backfill', 'g32l', `hub_order_${TARGET_HUB_ORDER_NUMBER}`, 'no_notification'],
    internal_notes: 'Customer App Order, native FulfillmentTask, Hub mutation, notifications, proof/drop/route, inventory, PO, and sync/repair/replay were held by G32L contract.',
    audit_trail: [auditEntry],
  });
}

function validateNativeShopifyOrderRecord(record) {
  const blockers = [];
  for (const key of Object.keys(record || {})) {
    if (!SHOPIFY_ORDER_SCHEMA_FIELDS.has(key)) blockers.push(`unsupported_shopify_order_field:${key}`);
  }
  if (record.shopify_order_number !== TARGET_HUB_ORDER_NUMBER) blockers.push('shopify_order_number_must_be_1052');
  if (record.production_status !== TARGET_PRODUCTION_STATUS) blockers.push('production_status_must_be_fulfilled');
  if (record.fulfillment_status !== TARGET_FULFILLMENT_STATUS) blockers.push('fulfillment_status_must_be_fulfilled');
  if (!PRODUCTION_STATUS_VALUES.has(record.production_status)) blockers.push('production_status_not_schema_supported');
  if (!SOURCE_CHANNEL_VALUES.has(record.source_channel)) blockers.push('source_channel_not_schema_supported');
  if (!ORDER_TYPE_VALUES.has(record.order_type)) blockers.push('order_type_not_schema_supported');
  if (!FULFILLMENT_MODE_VALUES.has(record.fulfillment_mode)) blockers.push('fulfillment_mode_not_schema_supported');
  if (!FULFILLMENT_METHOD_VALUES.has(record.fulfillment_method)) blockers.push('fulfillment_method_not_schema_supported');
  if (!Array.isArray(record.line_items) || record.line_items.length === 0) blockers.push('line_items_required_for_historical_backfill');
  if ('shopify_raw_payload' in record || 'stripe_payment_intent_id' in record || 'stripe_customer_id' in record || 'delivery_photo_url' in record || 'delivery_drop_location' in record || 'delivered_at' in record || 'customer_phone' in record || 'delivery_address' in record || 'address_line1' in record || 'address_line2' in record || 'address_city' in record || 'address_postal_code' in record || 'customer_name' in record || 'customer_email' in record) blockers.push('forbidden_raw_provider_customer_or_delivery_field_present');
  return uniqueStrings(blockers, 160);
}

function summarizeNativeShopifyOrder(order, skippedReason = null) {
  return {
    native_shopify_order_id: safeId(order?.id, 140) || null,
    shopify_order_number: safeText(order?.shopify_order_number, 80) || null,
    production_status: safeText(order?.production_status, 80) || null,
    fulfillment_status: safeText(order?.fulfillment_status, 80) || null,
    source_type: safeText(order?.source_type, 80) || null,
    source_channel: safeText(order?.source_channel, 80) || null,
    sync_status: safeText(order?.sync_status, 120) || null,
    line_item_count: Array.isArray(order?.line_items) ? order.line_items.length : 0,
    customer_name_written: Boolean(order?.customer_name),
    customer_email_written: Boolean(order?.customer_email),
    skipped_reason: skippedReason,
  };
}

async function createNativeShopifyOrderMirror({ base44, record }) {
  const created = await base44.asServiceRole.entities.ShopifyOrder.create(record);
  return summarizeNativeShopifyOrder(created);
}

async function createCommandLog({ base44, status, idempotencyKey, requestId, user, result, errorCode, errorMessage }) {
  const now = new Date().toISOString();
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: COMMAND_TYPE,
    command_source: 'customer_app_native_admin',
    status,
    target_entity: 'ShopifyOrder',
    target_id: TARGET_HUB_ORDER_NUMBER,
    target_display_id: TARGET_HUB_ORDER_NUMBER,
    actor_email: safeActorEmail(user?.email) || null,
    actor_role: safeText(user?.role, 80) || null,
    actor_type: 'admin',
    payload: {
      exact_order_allowlist: true,
      hub_order_number: TARGET_HUB_ORDER_NUMBER,
      policy: REQUIRED_POLICY,
      correction_mode: REQUIRED_CORRECTION_MODE,
      notification_policy: REQUIRED_NOTIFICATION_POLICY,
      customer_app_order_backfill: REQUIRED_CUSTOMER_APP_ORDER_BACKFILL_POLICY,
      native_fulfillment_task_backfill: REQUIRED_NATIVE_TASK_BACKFILL_POLICY,
      proof_drop_policy: REQUIRED_PROOF_DROP_POLICY,
      production_status: TARGET_PRODUCTION_STATUS,
      fulfillment_status: TARGET_FULFILLMENT_STATUS,
      preview_function: 'previewHistoricalHubFulfilledNativeBackfill',
    },
    result,
    error_code: errorCode || null,
    error_message: errorMessage ? safeText(errorMessage, 180) : null,
    idempotency_key: idempotencyKey,
    idempotent_skipped: status === 'skipped',
    request_id: requestId,
    submitted_at: now,
    completed_at: status === 'running' ? null : now,
    function_name: FUNCTION_NAME,
    related_order_number: TARGET_HUB_ORDER_NUMBER,
    notes: 'G32L exact gated historical Hub fulfilled native ShopifyOrder mirror backfill. Creates only one native ShopifyOrder mirror and CommandLog. Does not create Customer App Order, FulfillmentTask, notifications, message logs, Hub records, ProductionBatch, BatchComplianceLog, proof/drop/route, provider/payment calls, sync/repair/replay, inventory, or PurchaseOrder.',
  });
}

async function createCommandLogSafe(args) {
  try {
    const commandLog = await createCommandLog(args);
    if (!commandLog?.id) return { ok: false, error_code: 'historical_backfill_command_log_missing_id', commandLog: null };
    return { ok: true, commandLog };
  } catch (error) {
    return { ok: false, error_code: error?.code || 'historical_backfill_command_log_create_failed', message: error?.message || 'CommandLog create failed', commandLog: null };
  }
}

async function updateCommandLog({ base44, commandLogId, status, result, errorCode, errorMessage }) {
  if (!commandLogId) return null;
  return base44.asServiceRole.entities.CommandLog.update(commandLogId, {
    status,
    result,
    error_code: errorCode || null,
    error_message: errorMessage ? safeText(errorMessage, 180) : null,
    idempotent_skipped: status === 'skipped',
    completed_at: new Date().toISOString(),
  });
}

async function updateCommandLogSafe(args) {
  try {
    return { ok: true, commandLog: await updateCommandLog(args) };
  } catch (error) {
    return { ok: false, error_code: error?.code || 'historical_backfill_command_log_update_failed', message: error?.message || 'CommandLog update failed' };
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return jsonResponse({ success: false, error_code: 'method_not_allowed', message: 'POST required', writes_performed: false }, 405);
    }

    const parsed = await readJsonBody(req);
    if (!parsed.ok) return jsonResponse({ success: false, error_code: 'malformed_json', writes_performed: false }, 400);
    const body = parsed.body || {};

    const base44 = createClientFromRequest(req);
    const auth = await requireAdmin(base44);
    if (!auth.ok) return jsonResponse({ success: false, error_code: auth.error_code, writes_performed: false }, auth.status);

    const badKey = unsupportedBodyKey(body);
    if (badKey) return jsonResponse({ success: false, error_code: 'unsupported_request_field', field: safeText(badKey, 80), writes_performed: false }, 400);

    const lookup = getLookup(body);
    if (normalizeLower(body.mode) !== 'live' || normalizeText(body.confirmation) !== CONFIRMATION_PHRASE) {
      return jsonResponse({ success: false, error_code: 'confirmation_required', writes_performed: false }, 400);
    }

    const targetBlockers = exactTargetBlockers(lookup);
    if (targetBlockers.length > 0) {
      return jsonResponse({ success: false, skipped: true, error_code: 'exact_historical_hub_fulfilled_target_required', blockers: targetBlockers, writes_performed: false }, 409);
    }

    const gate = gateFailure({ actorEmail: auth.user?.email, lookup });
    if (gate) return jsonResponse({ success: false, skipped: true, error_code: gate, writes_performed: false }, 409);

    const idempotencyKey = `${COMMAND_TYPE}:${lookup.requestId}`;
    const existingLogs = await findExistingCommandLog(base44, idempotencyKey);
    const existingLog = Array.isArray(existingLogs) && existingLogs.length > 0 ? existingLogs[0] : null;
    if (existingLog && ['success', 'skipped'].includes(existingLog.status)) {
      return jsonResponse({
        success: true,
        skipped: true,
        idempotent: true,
        reason: 'idempotency_log_present',
        request_id: lookup.requestId,
        idempotency_key: idempotencyKey,
        command_log_id: safeId(existingLog.id, 140) || null,
        writes_performed: false,
        native_shopify_order_created: false,
        duplicate_native_shopify_order_created: false,
        safety: safetyResult(),
      });
    }
    if (existingLog && existingLog.status === 'failed') {
      return jsonResponse({ success: false, skipped: true, error_code: 'previous_failed_request_id_not_reusable', request_id: lookup.requestId, idempotency_key: idempotencyKey, writes_performed: false }, 409);
    }

    const preflight = await preflightTargetContext(base44, lookup);
    const sameRequestNative = preflight.localRecords.nativeOrders.find(order => nativeOrderCreatedByRequest(order, lookup.requestId));
    if (sameRequestNative) {
      const skippedLog = await createCommandLogSafe({
        base44,
        status: 'skipped',
        idempotencyKey,
        requestId: lookup.requestId,
        user: auth.user,
        result: {
          writes_performed: false,
          native_shopify_order_created: false,
          native_shopify_order_already_created_by_same_request: true,
          native_shopify_order: summarizeNativeShopifyOrder(sameRequestNative, 'already_created_by_same_request'),
          ...safetyResult(),
        },
      });
      if (!skippedLog.ok) return jsonResponse({ success: false, skipped: true, error_code: skippedLog.error_code, writes_performed: false }, 500);
      return jsonResponse({
        success: true,
        skipped: true,
        idempotent: true,
        reason: 'native_shopify_order_already_created_by_same_request',
        request_id: lookup.requestId,
        idempotency_key: idempotencyKey,
        command_log_id: safeId(skippedLog.commandLog?.id, 140) || null,
        writes_performed: false,
        native_shopify_order_created: false,
        native_shopify_order: summarizeNativeShopifyOrder(sameRequestNative, 'already_created_by_same_request'),
        safety: safetyResult(),
      });
    }

    if (!preflight.ready) {
      return jsonResponse({ success: false, skipped: true, error_code: 'historical_hub_fulfilled_backfill_preflight_blocked', blockers: preflight.blockers, warnings: preflight.warnings, writes_performed: false }, 409);
    }

    const freshPreview = shouldUseServicePreview()
      ? await fetchFreshPreview(base44, lookup)
      : { ok: true, status: 200, data: buildLocalFreshPreview(preflight, lookup) };
    if (!freshPreview.ok) {
      return jsonResponse({ success: false, skipped: true, error_code: freshPreview.error_code || 'historical_hub_fulfilled_backfill_preview_failed', preview_status: freshPreview.status, writes_performed: false }, 409);
    }
    const validation = validateFreshPreview(freshPreview.data);
    if (!validation.ready) {
      return jsonResponse({ success: false, skipped: true, error_code: 'fresh_historical_hub_fulfilled_preview_not_clean', blockers: validation.blockers, warnings: validation.warnings, writes_performed: false }, 409);
    }

    const nativeRecord = buildNativeShopifyOrderRecord({ hubOrder: preflight.hubOrder, preflight, requestId: lookup.requestId, user: auth.user });
    const recordBlockers = validateNativeShopifyOrderRecord(nativeRecord);
    if (recordBlockers.length > 0) {
      return jsonResponse({ success: false, skipped: true, error_code: 'historical_native_shopify_order_record_invalid', blockers: recordBlockers, writes_performed: false }, 409);
    }

    const commandLogCreate = await createCommandLogSafe({
      base44,
      status: 'running',
      idempotencyKey,
      requestId: lookup.requestId,
      user: auth.user,
      result: {
        writes_performed: false,
        projected_create_count: 1,
        projected_entity: 'ShopifyOrder',
        projected_shopify_order_number: TARGET_HUB_ORDER_NUMBER,
        projected_production_status: TARGET_PRODUCTION_STATUS,
        projected_fulfillment_status: TARGET_FULFILLMENT_STATUS,
        line_item_count: preflight.lineItems.length,
        notification_policy: REQUIRED_NOTIFICATION_POLICY,
        proof_drop_policy: REQUIRED_PROOF_DROP_POLICY,
        customer_app_order_created: false,
        native_fulfillment_task_created: false,
        notifications_created: false,
        notifications_sent: false,
        hub_records_updated: false,
        preview_source: freshPreview.data?.preview_source || 'service_preview',
      },
    });
    if (!commandLogCreate.ok) {
      return jsonResponse({ success: false, skipped: false, error_code: commandLogCreate.error_code, message: 'Historical backfill validation passed, but CommandLog creation failed before any native ShopifyOrder create.', writes_performed: false, native_shopify_order_created: false }, 500);
    }
    const commandLog = commandLogCreate.commandLog;

    let createdNativeOrder = null;
    try {
      createdNativeOrder = await createNativeShopifyOrderMirror({ base44, record: nativeRecord });
    } catch (error) {
      await updateCommandLogSafe({
        base44,
        commandLogId: commandLog?.id,
        status: 'failed',
        result: {
          writes_performed: false,
          native_shopify_order_created: false,
          projected_shopify_order_number: TARGET_HUB_ORDER_NUMBER,
          customer_app_order_created: false,
          native_fulfillment_task_created: false,
          notifications_created: false,
          notifications_sent: false,
          ...safetyResult(),
        },
        errorCode: error?.code || 'historical_native_shopify_order_create_failed',
        errorMessage: error?.message || 'Native ShopifyOrder create failed',
      });
      return jsonResponse({ success: false, skipped: false, error_code: error?.code || 'historical_native_shopify_order_create_failed', message: 'Historical native ShopifyOrder mirror create failed safely.', writes_performed: false }, 500);
    }

    const successSafety = writeSafetyResult({ native_shopify_order_created: true });
    const successLogUpdate = await updateCommandLogSafe({
      base44,
      commandLogId: commandLog?.id,
      status: 'success',
      result: {
        ...successSafety,
        native_shopify_order: createdNativeOrder,
        shopify_order_number: TARGET_HUB_ORDER_NUMBER,
        production_status: TARGET_PRODUCTION_STATUS,
        fulfillment_status: TARGET_FULFILLMENT_STATUS,
        line_item_count: createdNativeOrder?.line_item_count || 0,
        customer_app_order_created: false,
        native_fulfillment_task_created: false,
        notifications_created: false,
        notifications_sent: false,
        message_logs_created: false,
        hub_records_updated: false,
        proof_drop_route_fields_written: false,
      },
    });
    if (!successLogUpdate.ok) {
      return jsonResponse({
        success: false,
        skipped: false,
        error_code: successLogUpdate.error_code,
        message: 'Native ShopifyOrder historical mirror was created, but CommandLog finalization failed. Reconciliation required before retry.',
        request_id: lookup.requestId,
        idempotency_key: idempotencyKey,
        command_log_id: safeId(commandLog?.id, 140) || null,
        hub_order_number: TARGET_HUB_ORDER_NUMBER,
        writes_performed: true,
        reconciliation_required: true,
        native_shopify_order_created: true,
        native_shopify_order: createdNativeOrder,
        customer_app_order_created: false,
        native_fulfillment_task_created: false,
        notifications_created: false,
        notifications_sent: false,
        safety: successSafety,
      }, 500);
    }

    return jsonResponse({
      success: true,
      skipped: false,
      idempotent: false,
      request_id: lookup.requestId,
      idempotency_key: idempotencyKey,
      command_log_id: safeId(commandLog?.id, 140) || null,
      hub_order_number: TARGET_HUB_ORDER_NUMBER,
      writes_performed: true,
      native_shopify_order_created: true,
      native_shopify_order_updated: false,
      native_shopify_order: createdNativeOrder,
      production_status: TARGET_PRODUCTION_STATUS,
      fulfillment_status: TARGET_FULFILLMENT_STATUS,
      customer_app_order_created: false,
      customer_app_order_updated: false,
      native_fulfillment_task_created: false,
      native_fulfillment_task_updated: false,
      notification_policy: REQUIRED_NOTIFICATION_POLICY,
      proof_drop_policy: REQUIRED_PROOF_DROP_POLICY,
      notifications_created: false,
      notifications_sent: false,
      message_logs_created: false,
      proof_drop_route_fields_written: false,
      production_batch_created: false,
      batch_compliance_log_created: false,
      inventory_deducted: false,
      purchase_order_created: false,
      provider_calls: false,
      stripe_calls: false,
      shopify_calls: false,
      sync_retry_repair_run: false,
      hub_records_updated: false,
      safety: successSafety,
    });
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] failed safely: ${error?.message || 'unknown error'}`);
    return jsonResponse({ success: false, error_code: 'historical_hub_fulfilled_native_shopify_order_backfill_failed', message: 'Historical Hub fulfilled native ShopifyOrder backfill failed safely.', writes_performed: false }, 500);
  }
});

export {
  safetyResult,
  writeSafetyResult,
  getLookup,
  unsupportedBodyKey,
  exactTargetBlockers,
  gateFailure,
  schemaAudit,
  schemaMappingBlockers,
  safeHubOrderStatus,
  safeLineItems,
  preflightTargetContext,
  buildLocalFreshPreview,
  validateFreshPreview,
  buildNativeShopifyOrderRecord,
  validateNativeShopifyOrderRecord,
  summarizeNativeShopifyOrder,
  nativeOrderCreatedByRequest,
  REQUIRED_POLICY,
  REQUIRED_CORRECTION_MODE,
  REQUIRED_NOTIFICATION_POLICY,
  REQUIRED_CUSTOMER_APP_ORDER_BACKFILL_POLICY,
  REQUIRED_NATIVE_TASK_BACKFILL_POLICY,
  REQUIRED_PROOF_DROP_POLICY,
  CONFIRMATION_PHRASE,
  TARGET_HUB_ORDER_NUMBER,
  TARGET_PRODUCTION_STATUS,
  TARGET_FULFILLMENT_STATUS,
  TARGET_SYNC_STATUS,
};
