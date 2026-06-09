import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const FUNCTION_NAME = 'previewHistoricalHubFulfilledNativeBackfill';
const REQUIRED_CORRECTION_MODE = 'HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION';
const REQUIRED_NOTIFICATION_POLICY = 'NO_NOTIFICATION';
const REQUIRED_PROOF_DROP_POLICY = 'HELD_NOT_REQUIRED_FOR_RECONCILIATION';
const TARGET_HUB_ORDER_NUMBER = '1052';
const DEFAULT_HUB_SINCE = '2026-05-01';
const HUB_FETCH_TIMEOUT_MS = 8000;
const HUB_TASK_FETCH_LIMIT = '10';
const HISTORICAL_NATIVE_PRODUCTION_STATUS = 'fulfilled';
const HISTORICAL_NATIVE_FULFILLMENT_STATUS = 'fulfilled';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

const AUDITED_HUB_FULFILLED_FALLBACKS = Object.freeze({
  '1052': {
    shopify_order_number: '1052',
    fulfillment_status: 'fulfilled',
    production_status: 'new',
    audit_fallback_reason: 'g32h_read_only_hub_audit_confirmed_fulfilled_no_native_records',
  },
});

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

const ALLOWED_BODY_KEYS = new Set([
  'mode',
  'hub_order_number',
  'hub_order_id',
  'correction_mode',
  'notification_policy',
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

function sanitizeText(value, maxLength = 180) {
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

function sanitizeId(value, maxLength = 180) {
  const text = sanitizeText(value, maxLength);
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
    hubOrderId: sanitizeId(body?.hub_order_id, 180),
    correctionMode: normalizeUpper(body?.correction_mode),
    notificationPolicy: normalizeUpper(body?.notification_policy),
    proofDropPolicy: normalizeUpper(body?.proof_drop_policy),
    requestId: sanitizeId(body?.request_id, 180),
    since: sanitizeText(body?.since || DEFAULT_HUB_SINCE, 40),
  };
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
  return sanitizeId(order?.id || order?.shopify_order_id || order?.hub_order_id || order?.source_order_id, 180);
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
    order_number: sanitizeText(hubOrderNumber(order), 80) || null,
    hub_order_id_present: Boolean(hubOrderIdValue(order)),
    customer_email_present: Boolean(order.customer_email || order.contact_email || order.email),
    customer_name_present: Boolean(order.customer_name || order.full_name || order.customer?.name),
    source_channel: sanitizeText(order.source_channel || order.source_type, 80) || null,
    order_type: sanitizeText(order.order_type || (isSubscriptionOrMultiDelivery(order) ? 'subscription' : 'one_time'), 80) || null,
    payment_status: sanitizeText(order.payment_status || order.financial_status, 80) || null,
    production_status: sanitizeText(order.production_status || order.status, 80) || null,
    fulfillment_status: sanitizeText(order.fulfillment_status || order.shopify_fulfillment_status, 80) || null,
    fulfillment_method: sanitizeText(order.fulfillment_method || order.fulfillment_type, 80) || null,
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
  const key = normalizeOrderNumber(orderNumber);
  const fallback = AUDITED_HUB_FULFILLED_FALLBACKS[key];
  return fallback ? { ...fallback } : null;
}

function hubBaseUrl() {
  return HUB_API_URL ? HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '') : null;
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

function exactDuplicateMatch(row, { orderNumber, hubOrderId }) {
  const text = recordText(row);
  const orderKey = normalizeLower(orderNumber);
  const hubKey = normalizeLower(hubOrderId);
  return Boolean((orderKey && text.includes(orderKey)) || (hubKey && text.includes(hubKey)));
}

async function findLocalRecords(base44, { hubOrderNumber: orderNumber, hubOrderId }) {
  const searches = async (entityName, filters) => {
    const groups = await Promise.all(filters.map(filter => filterEntity(base44, entityName, filter, '-created_date', 20)));
    const flat = groups.flat();
    return [...new Map(flat.map(row => [row.id || JSON.stringify(row), row])).values()];
  };

  const orderFilters = unique([{ order_number: orderNumber }, { shopify_order_number: orderNumber }]);
  const sourceFilters = hubOrderId ? [{ hub_order_id: hubOrderId }, { source_order_id: hubOrderId }, { shopify_order_id: hubOrderId }] : [];
  const [customerOrders, nativeOrders, tasks, orderSyncLogs, reviewRows, commandLogs, parityLogs, notifications, messageLogs] = await Promise.all([
    searches('Order', [...orderFilters, ...sourceFilters]),
    searches('ShopifyOrder', [...orderFilters, ...sourceFilters]),
    searches('FulfillmentTask', [...orderFilters, ...sourceFilters]),
    searches('OrderSyncLog', [...orderFilters, ...sourceFilters]),
    searches('OrderReviewQueue', [...orderFilters, ...sourceFilters]),
    searches('CommandLog', [{ request_id: `g32j_${orderNumber}` }, { target_order_number: orderNumber }, { order_number: orderNumber }, ...sourceFilters]),
    searches('SafeSyncParityLog', [...orderFilters, ...sourceFilters]),
    searches('Notification', [...orderFilters, ...sourceFilters]),
    searches('CustomerMessageDeliveryLog', [...orderFilters, ...sourceFilters]),
  ]);

  const exact = rows => rows.filter(row => exactDuplicateMatch(row, { orderNumber, hubOrderId }));
  return {
    customerOrders: exact(customerOrders),
    nativeOrders: exact(nativeOrders),
    tasks: exact(tasks),
    orderSyncLogs: exact(orderSyncLogs),
    reviewRows: exact(reviewRows),
    commandLogs: exact(commandLogs),
    parityLogs: exact(parityLogs),
    notifications: exact(notifications),
    messageLogs: exact(messageLogs),
  };
}

function policyBlockers(policy) {
  return unique([
    policy.correctionMode !== REQUIRED_CORRECTION_MODE ? 'correction_mode_must_be_historical_hub_fulfilled_backfill_no_notification' : null,
    policy.notificationPolicy !== REQUIRED_NOTIFICATION_POLICY ? 'notification_policy_must_be_no_notification' : null,
    policy.proofDropPolicy !== REQUIRED_PROOF_DROP_POLICY ? 'proof_drop_policy_must_be_held_not_required_for_reconciliation' : null,
  ]);
}

function buildDuplicateRisks(localRecords) {
  return unique([
    localRecords.customerOrders.length > 0 ? 'existing_customer_app_order_for_hub_order_number_or_id' : null,
    localRecords.nativeOrders.length > 0 ? 'existing_native_shopify_order_for_hub_order_number_or_id' : null,
    localRecords.tasks.length > 0 ? 'existing_native_fulfillment_task_for_hub_order_number_or_id' : null,
    localRecords.orderSyncLogs.length > 0 ? 'existing_order_sync_log_context' : null,
    localRecords.reviewRows.length > 0 ? 'existing_order_review_queue_context' : null,
    localRecords.parityLogs.length > 0 ? 'existing_safe_sync_parity_log_context' : null,
    localRecords.commandLogs.length > 0 ? 'existing_command_log_context' : null,
  ]);
}

function buildProposedNativeShopifyOrderRecord({ hubOrder, hubStatus, nativeMirrorReady }) {
  return {
    record_type: 'Native ShopifyOrder',
    action: 'create_historical_fulfilled_mirror',
    ready_for_dedicated_live_contract: nativeMirrorReady,
    proposed_safe_fields: {
      shopify_order_number: hubStatus?.order_number || null,
      source_type: 'hub_historical_backfill',
      order_type: hubStatus?.order_type || 'one_time',
      production_status: HISTORICAL_NATIVE_PRODUCTION_STATUS,
      fulfillment_status: HISTORICAL_NATIVE_FULFILLMENT_STATUS,
      payment_status: hubStatus?.payment_status || null,
      line_item_count: hubStatus?.line_item_count || 0,
      total_present: hubStatus?.total_present === true,
      customer_identity_present_not_printed: hubStatus?.customer_email_present === true || hubStatus?.customer_name_present === true,
      fulfillment_or_delivery_date: hubStatus?.assigned_delivery_date || (hubOrder ? isoDate(hubOrder.fulfilled_at || hubOrder.delivered_at || hubOrder.completed_at) : null) || null,
      backfill_marker: true,
      hub_source_id_present: hubStatus?.hub_order_id_present === true,
      audit_trail_entry: 'g32j_historical_hub_fulfilled_backfill_preview',
    },
    forbidden_fields: [
      'raw Hub payload',
      'provider payment payloads',
      'notification payloads',
      'proof/drop/route fields',
      'Hub mutation fields',
    ],
  };
}

function buildPreview({ lookup, policy, hubOrder, hubFetchResult, hubTasksResult, localRecords, auth }) {
  const hubStatus = safeHubOrderStatus(hubOrder);
  const hubOrderPresent = Boolean(hubOrder);
  const duplicateRisks = buildDuplicateRisks(localRecords);
  const safeMinimumForNativeMirror = Boolean(
    hubOrderPresent &&
    isHubFulfilled(hubOrder) &&
    !isCancelledOrRefunded(hubOrder) &&
    !isSubscriptionOrMultiDelivery(hubOrder) &&
    (hubStatus?.line_item_count || 0) > 0 &&
    (hubStatus?.customer_email_present || hubStatus?.customer_name_present) &&
    (hubStatus?.assigned_delivery_date || hubStatus?.fulfilled_at_present),
  );
  const dataQualityBlockers = unique([
    !hubOrderPresent ? 'hub_order_not_found' : null,
    hubOrderPresent && !isHubFulfilled(hubOrder) ? 'hub_order_not_fulfilled' : null,
    hubOrderPresent && isCancelledOrRefunded(hubOrder) ? 'hub_order_cancelled_or_refunded' : null,
    hubOrderPresent && isSubscriptionOrMultiDelivery(hubOrder) ? 'subscription_multi_delivery_not_supported' : null,
    hubOrderPresent && (hubStatus?.line_item_count || 0) <= 0 ? 'hub_line_items_missing' : null,
    hubOrderPresent && !hubStatus?.customer_email_present && !hubStatus?.customer_name_present ? 'hub_customer_identity_missing' : null,
    hubOrderPresent && !hubStatus?.assigned_delivery_date && !hubStatus?.fulfilled_at_present ? 'hub_fulfillment_or_delivery_date_missing' : null,
    hubOrderPresent && !safeMinimumForNativeMirror ? 'insufficient_hub_data_for_historical_backfill' : null,
    localRecords.customerOrders.length > 0 || localRecords.nativeOrders.length > 0 || localRecords.tasks.length > 0 ? 'duplicate_native_or_customer_order_exists' : null,
  ]);
  const policyErrors = policyBlockers(policy);
  const nativeMirrorReady = policyErrors.length === 0 && dataQualityBlockers.length === 0;
  const historicalBackfillNeeded = Boolean(hubOrderPresent && isHubFulfilled(hubOrder) && localRecords.customerOrders.length === 0 && localRecords.nativeOrders.length === 0 && localRecords.tasks.length === 0);
  const hubProductionStatus = normalizeLower(hubOrder?.production_status || hubOrder?.status);
  const warnings = unique([
    hubFetchResult?.ok === false ? hubFetchResult.error_code : null,
    hubTasksResult?.ok === false ? hubTasksResult.error_code : null,
    hubStatus?.audit_fallback_used ? 'hub_safe_audit_fallback_used' : null,
    hubProductionStatus === 'new' && isHubFulfilled(hubOrder) ? 'hub_production_status_new_despite_fulfilled' : null,
    (hubTasksResult?.tasks || []).length === 0 ? 'hub_task_rows_absent' : null,
    !hubStatus?.payment_status ? 'hub_payment_status_missing' : null,
    'customer_app_order_backfill_held',
    'native_fulfillment_task_backfill_held',
    'proof_drop_held',
    'notifications_held',
    'hub_mutation_not_proposed',
    'raw_payload_not_used',
  ]);
  const proposedNativeRecord = buildProposedNativeShopifyOrderRecord({ hubOrder, hubStatus, nativeMirrorReady });
  const blockers = unique([...policyErrors, ...dataQualityBlockers]);

  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    preview_only: true,
    safety: READ_ONLY_SAFETY,
    function_name: FUNCTION_NAME,
    generated_at: new Date().toISOString(),
    actor_type: auth?.actor_type || 'admin',
    hub_order_number: sanitizeText(lookup.hubOrderNumber, 80) || null,
    hub_order_present: hubOrderPresent,
    hub_order_status: sanitizeText(hubOrder?.status || hubOrder?.production_status, 80) || null,
    hub_fulfillment_status: sanitizeText(hubOrder?.fulfillment_status || hubOrder?.shopify_fulfillment_status, 80) || null,
    hub_production_status: sanitizeText(hubOrder?.production_status || hubOrder?.status, 80) || null,
    hub_order_context: hubStatus,
    local_customer_app_order_present: localRecords.customerOrders.length > 0,
    native_shopify_order_present: localRecords.nativeOrders.length > 0,
    native_fulfillment_task_present: localRecords.tasks.length > 0,
    local_absence_verification: {
      customer_app_order_count: localRecords.customerOrders.length,
      native_shopify_order_count: localRecords.nativeOrders.length,
      native_fulfillment_task_count: localRecords.tasks.length,
      order_sync_log_count: localRecords.orderSyncLogs.length,
      order_review_queue_count: localRecords.reviewRows.length,
      command_log_count: localRecords.commandLogs.length,
      safe_sync_parity_log_count: localRecords.parityLogs.length,
      notification_count: localRecords.notifications.length,
      message_log_count: localRecords.messageLogs.length,
      exact_match_only: true,
      fuzzy_customer_matching_used: false,
    },
    historical_backfill_needed: historicalBackfillNeeded,
    proposed_backfill_mode: REQUIRED_CORRECTION_MODE,
    correction_mode: policy.correctionMode,
    notification_policy: policy.notificationPolicy,
    proof_drop_policy: policy.proofDropPolicy,
    proposed_records: [proposedNativeRecord],
    blocked_records: blockers.length > 0 ? [{ record_type: 'Native ShopifyOrder', action: 'create_historical_fulfilled_mirror', blockers }] : [],
    held_records: [
      {
        record_type: 'Customer App Order',
        action: 'held',
        reason: 'customer-facing record creation requires separate approval because it can expose a historical order to the customer account',
      },
      {
        record_type: 'Native FulfillmentTask',
        action: 'held',
        reason: (hubTasksResult?.tasks || []).length === 0 ? 'no Hub task rows returned; delivered task reconstruction requires dedicated contract' : 'task backfill requires separate exact delivery task contract',
      },
      {
        record_type: 'Notification/MessageLog',
        action: 'held',
        reason: 'notification_policy is NO_NOTIFICATION',
      },
      {
        record_type: 'Hub records',
        action: 'not_mutated',
        reason: 'Hub remains read-only source context',
      },
      {
        record_type: 'Proof/Drop/Route fields',
        action: 'held',
        reason: 'proof_drop_policy is HELD_NOT_REQUIRED_FOR_RECONCILIATION',
      },
    ],
    duplicate_risks: duplicateRisks,
    data_quality_blockers: dataQualityBlockers,
    notification_would_send: false,
    notification_impact: false,
    proof_drop_impact: {
      proof_drop_required: false,
      policy: REQUIRED_PROOF_DROP_POLICY,
      would_write_proof_drop_fields: false,
    },
    hub_mutation: false,
    safe_hub_read_context: {
      order_fetch_attempted: true,
      order_fetch_success: hubFetchResult?.ok === true,
      order_fetch_status: hubFetchResult?.status || null,
      task_fetch_attempted: true,
      task_fetch_success: hubTasksResult?.ok === true,
      task_fetch_status: hubTasksResult?.status || null,
      hub_task_count: Array.isArray(hubTasksResult?.tasks) ? hubTasksResult.tasks.length : 0,
    },
    warnings,
    blockers,
    next_action: blockers.length > 0
      ? 'hold_historical_backfill_for_hub_data_blockers'
      : 'approve_historical_native_shopify_order_mirror_backfill_or_hold_customer_app_backfill',
  };
}

async function findHubOrder(lookup) {
  const hubFetchResult = await fetchHubOrders({ hubOrderNumber: lookup.hubOrderNumber, since: lookup.since });
  const hubByNumber = new Map((hubFetchResult.orders || []).map(order => [normalizeLower(hubOrderNumber(order)), order]).filter(([key]) => Boolean(key)));
  let hubOrder = hubByNumber.get(normalizeLower(lookup.hubOrderNumber)) || null;
  if (!hubOrder && lookup.hubOrderId) {
    hubOrder = (hubFetchResult.orders || []).find(order => normalizeLower(hubOrderIdValue(order)) === normalizeLower(lookup.hubOrderId)) || null;
  }
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
    if (badKey) return Response.json({ success: false, error_code: 'unsupported_request_field', field: sanitizeText(badKey, 80), writes_performed: false }, { status: 400 });

    const lookup = lookupFromBody(body);
    const policy = {
      correctionMode: lookup.correctionMode,
      notificationPolicy: lookup.notificationPolicy,
      proofDropPolicy: lookup.proofDropPolicy,
      requestId: lookup.requestId,
    };
    if (!lookup.hubOrderNumber) return Response.json({ success: false, error_code: 'hub_order_number_required', writes_performed: false }, { status: 400 });
    if (!policy.correctionMode || !policy.notificationPolicy || !policy.proofDropPolicy) {
      return Response.json({ success: false, error_code: 'policy_required', writes_performed: false }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const auth = await requirePreviewAccess({ base44, req, body });
    if (!auth.ok) return auth.response;

    const { hubOrder, hubFetchResult } = await findHubOrder(lookup);
    const hubTasksResult = await fetchHubTasksForOrder(lookup.hubOrderNumber);
    const localRecords = await findLocalRecords(base44, { hubOrderNumber: lookup.hubOrderNumber, hubOrderId: lookup.hubOrderId || hubOrderIdValue(hubOrder) });
    return Response.json(buildPreview({ lookup, policy, hubOrder, hubFetchResult, hubTasksResult, localRecords, auth }));
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] failed safely: ${error?.message || 'unknown error'}`);
    return Response.json({
      success: false,
      dry_run: true,
      error_code: 'historical_hub_fulfilled_backfill_preview_failed',
      message: 'Historical Hub fulfilled backfill preview failed safely; no records were changed.',
      writes_performed: false,
    }, { status: 500 });
  }
});

export {
  READ_ONLY_SAFETY,
  lookupFromBody,
  unsupportedBodyKey,
  safeHubOrderStatus,
  auditedHubFallbackOrder,
  isHubFulfilled,
  isCancelledOrRefunded,
  isSubscriptionOrMultiDelivery,
  policyBlockers,
  buildDuplicateRisks,
  buildProposedNativeShopifyOrderRecord,
  buildPreview,
  HISTORICAL_NATIVE_PRODUCTION_STATUS,
  HISTORICAL_NATIVE_FULFILLMENT_STATUS,
};
