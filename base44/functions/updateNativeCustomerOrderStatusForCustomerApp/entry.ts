import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const COMMAND_TYPE = 'native_customer_order_status_only_update';
const FUNCTION_NAME = 'updateNativeCustomerOrderStatusForCustomerApp';
const ENABLE_FLAG = 'ENABLE_NATIVE_CUSTOMER_STATUS_UPDATE';
const KILL_SWITCH_FLAG = 'NATIVE_CUSTOMER_STATUS_UPDATE_KILL_SWITCH';
const ALLOWED_EMAILS_FLAG = 'NATIVE_CUSTOMER_STATUS_UPDATE_ALLOWED_EMAILS';
const ORDER_ALLOWLIST_FLAG = 'NATIVE_CUSTOMER_STATUS_UPDATE_ORDER_ALLOWLIST';
const CUSTOMER_ORDER_ALLOWLIST_FLAG = 'NATIVE_CUSTOMER_STATUS_UPDATE_CUSTOMER_ORDER_ALLOWLIST';
const POLICY_FLAG = 'NATIVE_CUSTOMER_STATUS_UPDATE_POLICY';
const REQUIRED_POLICY = 'EXACT_STATUS_ONLY_NO_NOTIFICATION';
const REQUIRED_NOTIFICATION_POLICY = 'NO_NOTIFICATION';
const CONFIRMATION_PHRASE = 'update_customer_order_status_bottled_packed_no_notification';
const G32D_MARKER = 'g32d_gated_customer_order_status_only_no_notification_command';
const TARGET_ORDER_NUMBER = 'NV-MPZNKGNT';
const TARGET_CUSTOMER_APP_ORDER_ID = '6a219a3f4adcda5856c3d579';
const TARGET_NATIVE_SHOPIFY_ORDER_ID = '6a22ffda400eb806eb3ca945';
const TARGET_NATIVE_FULFILLMENT_TASK_ID = '6a22ffdaf675ea79e30575aa';
const TARGET_PRODUCTION_DATE = '2026-06-05';
const TARGET_DELIVERY_DATE = '2026-06-06';
const REQUIRED_CURRENT_STATUS = 'scheduled_for_juicing';
const TARGET_CUSTOMER_STATUS = 'bottled_packed';
const MAX_TEXT = 180;
const MAX_ROWS = 80;

const EXPECTED_BATCH_PRODUCTS = Object.freeze({
  'NATIVE-NV-MPZNKGNT-2026-06-05-AURA': 'Aura',
  'NATIVE-NV-MPZNKGNT-2026-06-05-OASIS': 'Oasis',
  'NATIVE-NV-MPZNKGNT-2026-06-05-PINEAPPLE-JUICE': 'Pineapple Juice',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RADIANCE-SHOT': 'Radiance Shot',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RE-NU': 'Re-Nu',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RESET-SHOT': 'Reset Shot',
});
const EXPECTED_BATCH_IDS = Object.freeze(Object.keys(EXPECTED_BATCH_PRODUCTS).sort());
const EXPECTED_PRODUCTS = Object.freeze(Object.values(EXPECTED_BATCH_PRODUCTS).sort());

const CUSTOMER_ORDER_TERMINAL_STATUSES = new Set(['delivered', 'picked_up', 'cancelled', 'canceled', 'refunded']);
const NATIVE_ORDER_CANCELLED_REFUNDED = new Set(['canceled', 'cancelled', 'refunded', 'voided']);
const TASK_PACKED_STATUSES = new Set(['packed', 'bottled_packed']);
const TASK_PACKED_PRODUCTION_STATUSES = new Set(['packed', 'bottled_packed']);
const TERMINAL_TASK_STATUSES = new Set(['delivered', 'unable_to_deliver', 'cancelled', 'canceled', 'out_for_delivery']);
const TERMINAL_DELIVERY_STATUSES = new Set(['out_for_delivery', 'delivered', 'unable_to_deliver', 'cancelled', 'canceled']);
const STATUS_NOTIFICATION_SUBTYPES = Object.freeze({
  scheduled_for_juicing: 'production_reminder',
  in_production: 'production_reminder',
  out_for_delivery: 'out_for_delivery',
  arriving_soon: 'delivery_reminder',
  delivered: 'delivered',
  ready_for_pickup: 'delivery_reminder',
});

const ALLOWED_BODY_KEYS = new Set([
  'mode',
  'confirmation',
  'order_number',
  'shopify_order_number',
  'customer_app_order_id',
  'base44_order_id',
  'order_id',
  'native_shopify_order_id',
  'native_order_id',
  'shopify_order_id',
  'native_fulfillment_task_id',
  'fulfillment_task_id',
  'task_id',
  'production_date',
  'expected_production_date',
  'expected_delivery_date',
  'current_status_expected',
  'expected_current_status',
  'target_status',
  'expected_target_status',
  'notification_policy',
  'expected_preview_hash',
  'request_id',
]);

const FORBIDDEN_BODY_KEYS = new Set([
  'rows',
  'custom_rows',
  'raw_payload',
  'payload',
  'raw_body',
  'raw_order',
  'order',
  'raw_task',
  'task',
  'raw_provider_payload',
  'raw_payment_payload',
  'notification',
  'notifications',
  'notification_payload',
  'notification_rows',
  'message_log',
  'message_logs',
  'send_notification',
  'notify_customer',
  'push',
  'sms',
  'email',
  'in_app',
  'delivery_status',
  'fulfillment_status',
  'production_status',
  'native_shopify_order_update',
  'shopify_order_update',
  'native_fulfillment_task_update',
  'fulfillment_task_update',
  'production_batch_update',
  'batch_update',
  'batch_ids',
  'production_batch_ids',
  'compliance',
  'compliance_log',
  'inventory_deduction',
  'deduct_inventory',
  'inventory_update',
  'purchase_order',
  'create_purchase_order',
  'delivered_at',
  'proof',
  'proof_url',
  'proof_file',
  'proof_photo_url',
  'photo',
  'drop',
  'drop_location',
  'route',
  'route_id',
  'route_stop_sequence',
  'sync',
  'repair',
  'replay',
  'provider_id',
  'provider_ids',
  'stripe_id',
  'shopify_id',
  'headers',
  'authorization',
  'auth_header',
  'secret',
  'token',
  'api_key',
  'api-key',
  'bulk_task_ids',
  'bulk_order_ids',
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

function roundQuantity(value, decimals = 3) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return null;
  const factor = 10 ** decimals;
  return Math.round(numberValue * factor) / factor;
}

function parseCsvSet(value) {
  return new Set(normalizeText(value).split(',').map(normalizeLower).filter(Boolean));
}

function uniqueStrings(values, limit = MAX_ROWS) {
  return [...new Set((values || []).map(value => safeText(value, 180)).filter(Boolean))].slice(0, limit);
}

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
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
    if (/(^|_)(custom|raw|payload|provider|stripe|shopify|inventory|purchase|notification|message|sync|repair|replay|bulk|task|batch|recipe|route|proof|delivery|drop|compliance|customer)($|_)/i.test(normalized)) {
      return key;
    }
    return key;
  }
  return null;
}

function expectedPreviewSecret() {
  return normalizeText(Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET')) ||
    normalizeText(Deno.env.get('CUSTOMER_APP_SYNC_SECRET')) ||
    normalizeText(Deno.env.get('HUB_SYNC_SECRET'));
}

function shouldUseServicePreview() {
  return Deno.env.get('NATIVE_CUSTOMER_STATUS_UPDATE_USE_SERVICE_PREVIEW') === 'true';
}

function previewFailureCode(status) {
  return status === 408 || status === 504
    ? 'native_customer_status_update_preview_timeout'
    : 'native_customer_status_update_preview_failed';
}

function getLookup(body) {
  return {
    orderNumber: normalizeText(body?.order_number || body?.shopify_order_number).replace(/^#/, ''),
    customerAppOrderId: safeId(body?.customer_app_order_id || body?.base44_order_id || body?.order_id, 120),
    nativeShopifyOrderId: safeId(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id, 120),
    nativeFulfillmentTaskId: safeId(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id, 120),
    productionDate: normalizeText(body?.production_date || body?.expected_production_date),
    expectedDeliveryDate: normalizeText(body?.expected_delivery_date),
    expectedCurrentStatus: normalizeLower(body?.current_status_expected || body?.expected_current_status || REQUIRED_CURRENT_STATUS),
    targetStatus: normalizeLower(body?.target_status || body?.expected_target_status || TARGET_CUSTOMER_STATUS),
    notificationPolicy: normalizeText(body?.notification_policy || '').toUpperCase(),
    expectedPreviewHash: safeId(body?.expected_preview_hash, 180),
    requestId: safeId(body?.request_id, 160),
  };
}

function exactTargetBlockers(lookup) {
  const blockers = [];
  if (lookup.orderNumber !== TARGET_ORDER_NUMBER) blockers.push('target_order_number_mismatch');
  if (lookup.productionDate !== TARGET_PRODUCTION_DATE) blockers.push('target_production_date_mismatch');
  if (lookup.expectedDeliveryDate && lookup.expectedDeliveryDate !== TARGET_DELIVERY_DATE) blockers.push('expected_delivery_date_mismatch');
  if (lookup.expectedCurrentStatus !== REQUIRED_CURRENT_STATUS) blockers.push('expected_current_status_must_be_scheduled_for_juicing');
  if (lookup.targetStatus !== TARGET_CUSTOMER_STATUS) blockers.push('target_status_must_be_bottled_packed');
  if (lookup.notificationPolicy !== REQUIRED_NOTIFICATION_POLICY) blockers.push('notification_policy_must_be_no_notification');
  if (lookup.customerAppOrderId !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('target_customer_app_order_id_required');
  if (lookup.nativeShopifyOrderId !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('target_native_shopify_order_id_required');
  if (lookup.nativeFulfillmentTaskId !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('target_native_fulfillment_task_id_required');
  return blockers;
}

function gateFailure({ actorEmail, lookup }) {
  if (Deno.env.get(KILL_SWITCH_FLAG) === 'true') return 'kill_switch_active';
  if (Deno.env.get(ENABLE_FLAG) !== 'true') return 'native_customer_status_update_disabled';
  if (normalizeText(Deno.env.get(POLICY_FLAG)) !== REQUIRED_POLICY) return 'exact_status_only_no_notification_policy_required';

  const allowedEmails = parseCsvSet(Deno.env.get(ALLOWED_EMAILS_FLAG) || '');
  if (allowedEmails.size === 0) return 'allowed_email_gate_required';
  if (!allowedEmails.has(normalizeLower(actorEmail))) return 'actor_email_not_allowlisted';

  const orderAllowlist = parseCsvSet(Deno.env.get(ORDER_ALLOWLIST_FLAG) || '');
  if (orderAllowlist.size === 0) return 'order_allowlist_required';
  const orderCandidates = [lookup.orderNumber, lookup.customerAppOrderId, lookup.nativeShopifyOrderId, lookup.nativeFulfillmentTaskId]
    .map(normalizeLower)
    .filter(Boolean);
  if (!orderCandidates.some(candidate => orderAllowlist.has(candidate))) return 'order_not_allowlisted';

  const customerOrderAllowlist = parseCsvSet(Deno.env.get(CUSTOMER_ORDER_ALLOWLIST_FLAG) || '');
  if (customerOrderAllowlist.size === 0) return 'customer_order_allowlist_required';
  if (!customerOrderAllowlist.has(normalizeLower(TARGET_CUSTOMER_APP_ORDER_ID))) return 'target_customer_order_not_allowlisted';
  if (!customerOrderAllowlist.has(normalizeLower(lookup.customerAppOrderId))) return 'request_customer_order_not_allowlisted';

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

async function getEntity(base44, entityName, id) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity?.get || !id) return null;
  return entity.get(id).catch(() => null);
}

async function findExistingCommandLog(base44, idempotencyKey) {
  return filterEntity(base44, 'CommandLog', { idempotency_key: idempotencyKey }, '-created_date', 3);
}

async function findCustomerOrder(base44) {
  const byId = await getEntity(base44, 'Order', TARGET_CUSTOMER_APP_ORDER_ID);
  if (byId?.id) return byId;
  const rows = await filterEntity(base44, 'Order', { order_number: TARGET_ORDER_NUMBER }, '-created_date', 5);
  return rows.find(row => safeId(row?.id, 120) === TARGET_CUSTOMER_APP_ORDER_ID) || rows[0] || null;
}

async function findNativeShopifyOrder(base44) {
  const byId = await getEntity(base44, 'ShopifyOrder', TARGET_NATIVE_SHOPIFY_ORDER_ID);
  if (byId?.id) return byId;
  const rows = await filterEntity(base44, 'ShopifyOrder', { shopify_order_number: TARGET_ORDER_NUMBER }, '-created_date', 5);
  return rows.find(row => safeId(row?.id, 120) === TARGET_NATIVE_SHOPIFY_ORDER_ID) || rows[0] || null;
}

async function findTargetTask(base44) {
  const byId = await getEntity(base44, 'FulfillmentTask', TARGET_NATIVE_FULFILLMENT_TASK_ID);
  if (byId?.id) return byId;
  const rows = await filterEntity(base44, 'FulfillmentTask', { id: TARGET_NATIVE_FULFILLMENT_TASK_ID }, '-created_date', 5);
  if (rows[0]?.id) return rows[0];
  const byTaskId = await filterEntity(base44, 'FulfillmentTask', { fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID }, '-created_date', 5);
  return byTaskId[0] || null;
}

async function findBatchByBatchId(base44, batchId) {
  return filterEntity(base44, 'ProductionBatch', { batch_id: batchId }, '-created_date', 5);
}

async function findComplianceLogsForBatch(base44, batch) {
  const byDisplayId = batch?.batch_id ? await filterEntity(base44, 'BatchComplianceLog', { batch_id: batch.batch_id }, '-created_date', 20) : [];
  const bySourceId = batch?.id ? await filterEntity(base44, 'BatchComplianceLog', { source_production_batch_id: batch.id }, '-created_date', 20) : [];
  return [...new Map([...byDisplayId, ...bySourceId].map(row => [row.id || `${row.batch_id}:${row.source_production_batch_id}`, row])).values()];
}

function rowReferencesTarget(row) {
  const text = `${safeText(row?.order_number, 120)} ${safeText(row?.shopify_order_number, 120)} ${safeText(row?.order_id, 120)} ${safeText(row?.base44_order_id, 120)} ${safeText(row?.shopify_order_id, 120)} ${safeText(row?.native_shopify_order_id, 120)} ${safeText(row?.fulfillment_task_id, 120)} ${safeText(row?.id, 120)}`;
  return [TARGET_ORDER_NUMBER, TARGET_CUSTOMER_APP_ORDER_ID, TARGET_NATIVE_SHOPIFY_ORDER_ID, TARGET_NATIVE_FULFILLMENT_TASK_ID]
    .some(value => value && text.includes(value));
}

function batchHasTargetSource(batch) {
  const text = `${safeText(batch?.batch_id, 180)} ${safeText(batch?.source_order_number, 120)} ${safeText(batch?.order_number, 120)} ${safeText(batch?.source_order_id, 120)} ${safeText(batch?.base44_order_id, 120)} ${safeText(batch?.native_shopify_order_id, 120)} ${safeText(batch?.native_fulfillment_task_id, 120)} ${JSON.stringify(batch?.order_sources || [])} ${JSON.stringify(batch?.related_orders || [])}`;
  return [TARGET_ORDER_NUMBER, TARGET_CUSTOMER_APP_ORDER_ID, TARGET_NATIVE_SHOPIFY_ORDER_ID, TARGET_NATIVE_FULFILLMENT_TASK_ID]
    .some(value => value && text.includes(value));
}

function targetOrderType(customerOrder, nativeOrder, task) {
  if (nativeOrder?.is_subscription === true || customerOrder?.is_subscription === true || customerOrder?.subscription_id || nativeOrder?.subscription_parent_id || task?.customer_app_subscription_id || task?.stripe_subscription_id) return 'subscription';
  return normalizeLower(nativeOrder?.order_type || customerOrder?.order_type || task?.order_type || 'one_time') || 'one_time';
}

function targetFulfillmentMode(customerOrder, nativeOrder, task) {
  return normalizeLower(nativeOrder?.fulfillment_mode || customerOrder?.fulfillment_mode || task?.fulfillment_mode || task?.fulfillment_type || nativeOrder?.fulfillment_method || customerOrder?.fulfillment_type || 'single_delivery') || 'single_delivery';
}

function statusHistoryAlreadyContains(order, status) {
  return Array.isArray(order?.status_history) && order.status_history.some(entry => normalizeLower(entry?.status) === normalizeLower(status));
}

function statusMessage(status) {
  if (status === TARGET_CUSTOMER_STATUS) return 'Native production verified, packed, and bottled. Status updated without customer notification.';
  return `Customer-facing status updated to ${status}.`;
}

function notificationConfiguredForStatus(status) {
  return Boolean(STATUS_NOTIFICATION_SUBTYPES[normalizeLower(status)]);
}

function summarizeCustomerOrder(order, previousStatus = null, skippedReason = null) {
  return {
    customer_app_order_id: safeId(order?.id, 120) || null,
    order_number: safeText(order?.order_number || order?.shopify_order_number, 120) || null,
    previous_status: safeText(previousStatus || order?.status, 80) || null,
    status: safeText(order?.status, 80) || null,
    payment_status: safeText(order?.payment_status, 80) || null,
    payment_captured: order?.payment_captured === true,
    status_history_count: Array.isArray(order?.status_history) ? order.status_history.length : 0,
    skipped_reason: skippedReason,
  };
}

function summarizeBatch(batch) {
  return {
    production_batch_id: safeId(batch?.id, 120) || null,
    batch_id: safeId(batch?.batch_id, 180) || null,
    product_name: safeText(batch?.product_name, 120) || null,
    status: safeText(batch?.status, 80) || null,
    production_date: safeText(batch?.production_date, 40) || null,
    actual_units: roundQuantity(batch?.actual_units, 3),
    verified_at_present: Boolean(batch?.verified_at),
    compliance_log_id_present: Boolean(batch?.compliance_log_id),
  };
}

async function preflightTargetContext(base44) {
  const blockers = [];
  const warnings = [];
  const conflicts = [];
  const customerOrder = await findCustomerOrder(base44);
  const nativeOrder = await findNativeShopifyOrder(base44);
  const task = await findTargetTask(base44);
  const batches = [];
  const complianceLogs = [];

  if (!customerOrder) blockers.push('customer_app_order_not_found');
  if (!nativeOrder) blockers.push('native_shopify_order_not_found');
  if (!task) blockers.push('native_fulfillment_task_not_found');

  if (customerOrder) {
    const status = normalizeLower(customerOrder?.status);
    if (safeId(customerOrder?.id, 120) !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('customer_app_order_id_mismatch');
    if (normalizeText(customerOrder?.order_number || customerOrder?.shopify_order_number).replace(/^#/, '') !== TARGET_ORDER_NUMBER) blockers.push('customer_app_order_number_mismatch');
    if (normalizeLower(customerOrder?.payment_status) !== 'paid') blockers.push('customer_app_order_not_paid');
    if (customerOrder?.payment_captured !== true) blockers.push('customer_app_order_payment_not_captured');
    if (CUSTOMER_ORDER_TERMINAL_STATUSES.has(status)) blockers.push('customer_app_order_terminal_status');
    if (customerOrder?.is_subscription === true || customerOrder?.subscription_id) blockers.push('customer_app_subscription_order_blocked');
    if (![REQUIRED_CURRENT_STATUS, TARGET_CUSTOMER_STATUS].includes(status)) blockers.push('customer_app_order_status_not_status_update_eligible');
  }

  if (nativeOrder) {
    const orderStatus = normalizeLower(nativeOrder?.production_status);
    const fulfillmentStatus = normalizeLower(nativeOrder?.fulfillment_status);
    const paymentStatus = normalizeLower(nativeOrder?.payment_status || nativeOrder?.financial_status || customerOrder?.payment_status);
    const type = targetOrderType(customerOrder, nativeOrder, task);
    const mode = targetFulfillmentMode(customerOrder, nativeOrder, task);
    if (safeId(nativeOrder?.id, 120) !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('native_shopify_order_id_mismatch');
    if (normalizeText(nativeOrder?.shopify_order_number || nativeOrder?.order_number).replace(/^#/, '') !== TARGET_ORDER_NUMBER) blockers.push('native_shopify_order_number_mismatch');
    if (nativeOrder?.base44_order_id && safeId(nativeOrder.base44_order_id, 120) !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('native_shopify_order_base44_order_mismatch');
    if (orderStatus !== 'bottled') blockers.push('native_shopify_order_not_bottled');
    if (['subscription', 'multi_delivery'].includes(type) || mode === 'multi_delivery' || nativeOrder?.is_subscription === true || nativeOrder?.subscription_parent_id) blockers.push('subscription_multi_delivery_customer_status_blocked');
    if (NATIVE_ORDER_CANCELLED_REFUNDED.has(orderStatus) || NATIVE_ORDER_CANCELLED_REFUNDED.has(paymentStatus) || ['cancelled', 'canceled'].includes(fulfillmentStatus)) blockers.push('native_order_cancelled_or_refunded');
  }

  if (task) {
    const taskStatus = normalizeLower(task?.status);
    const productionStatus = normalizeLower(task?.production_status);
    if (safeId(task?.id, 120) !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('native_fulfillment_task_id_mismatch');
    if (!rowReferencesTarget(task)) blockers.push('native_fulfillment_task_order_context_mismatch');
    if (normalizeText(task?.production_date) !== TARGET_PRODUCTION_DATE) blockers.push('native_fulfillment_task_production_date_mismatch');
    if (TERMINAL_TASK_STATUSES.has(taskStatus)) blockers.push('native_fulfillment_task_terminal_or_delivery_advanced');
    if (task?.delivery_status && TERMINAL_DELIVERY_STATUSES.has(normalizeLower(task.delivery_status))) blockers.push('native_fulfillment_task_delivery_lifecycle_advanced');
    if (!TASK_PACKED_STATUSES.has(taskStatus)) blockers.push('native_fulfillment_task_not_packed');
    if (!TASK_PACKED_PRODUCTION_STATUSES.has(productionStatus)) blockers.push('native_fulfillment_task_production_status_not_packed');
  }

  for (const batchId of EXPECTED_BATCH_IDS) {
    const matches = await findBatchByBatchId(base44, batchId);
    if (matches.length === 0) {
      blockers.push(`production_batch_not_found:${batchId}`);
      continue;
    }
    if (matches.length > 1) {
      blockers.push(`multiple_production_batch_matches:${batchId}`);
      conflicts.push({ batch_id: batchId, reason: 'multiple_production_batch_matches', match_count: matches.length });
      continue;
    }
    const batch = matches[0];
    batches.push(batch);
    const batchBlockers = [];
    if (safeText(batch?.product_name, 120) !== EXPECTED_BATCH_PRODUCTS[batchId]) batchBlockers.push('product_name_mismatch');
    if (normalizeText(batch?.production_date) !== TARGET_PRODUCTION_DATE) batchBlockers.push('production_date_mismatch');
    if (normalizeLower(batch?.status) !== 'verified_logged') batchBlockers.push('status_not_verified_logged');
    if (roundQuantity(batch?.actual_units, 3) === null) batchBlockers.push('missing_actual_units');
    if (!batch?.verified_at || !batch?.verified_by) batchBlockers.push('missing_verification_metadata');
    if (!batch?.compliance_log_id) batchBlockers.push('missing_compliance_log_id');
    if (!batchHasTargetSource(batch)) batchBlockers.push('target_order_source_missing');
    const logs = await findComplianceLogsForBatch(base44, batch);
    complianceLogs.push(...logs);
    if (logs.length === 0) batchBlockers.push('missing_batch_compliance_log');
    if (batchBlockers.length > 0) {
      blockers.push(`production_batch_context_blocked:${batchId}`);
      conflicts.push({ batch_id: batchId, product_name: EXPECTED_BATCH_PRODUCTS[batchId], status: safeText(batch?.status, 80) || null, blockers: batchBlockers });
    }
  }

  if (notificationConfiguredForStatus(TARGET_CUSTOMER_STATUS)) blockers.push('target_status_has_notification_configuration');

  if (blockers.length > 0) {
    return { ready: false, mode: 'blocked', blockers: uniqueStrings(blockers, 160), warnings: uniqueStrings(warnings, 120), conflicts, customerOrder, nativeOrder, task, batches, complianceLogs, rowToUpdate: null, alreadySatisfiedOrder: null };
  }

  const currentStatus = normalizeLower(customerOrder?.status);
  if (currentStatus === REQUIRED_CURRENT_STATUS) {
    return { ready: true, mode: 'status_update', blockers: [], warnings: uniqueStrings(warnings, 120), conflicts: [], customerOrder, nativeOrder, task, batches, complianceLogs, rowToUpdate: customerOrder, alreadySatisfiedOrder: null };
  }
  if (currentStatus === TARGET_CUSTOMER_STATUS) {
    return { ready: true, mode: 'already_satisfied', blockers: [], warnings: uniqueStrings([...warnings, 'customer_status_already_bottled_packed'], 120), conflicts: [], customerOrder, nativeOrder, task, batches, complianceLogs, rowToUpdate: null, alreadySatisfiedOrder: customerOrder };
  }

  return { ready: false, mode: 'blocked', blockers: ['customer_app_order_status_not_status_update_eligible'], warnings: uniqueStrings(warnings, 120), conflicts: [], customerOrder, nativeOrder, task, batches, complianceLogs, rowToUpdate: null, alreadySatisfiedOrder: null };
}

function buildLocalFreshStatusPreview(preflight) {
  const customerOrder = preflight?.customerOrder || {};
  const currentStatus = normalizeLower(customerOrder?.status);
  const alreadySatisfied = currentStatus === TARGET_CUSTOMER_STATUS;
  const updateReady = preflight?.ready === true && preflight?.mode === 'status_update';
  return {
    success: preflight?.ready === true,
    dry_run: true,
    writes_performed: false,
    preview_source: 'local_preflight',
    patch_marker: G32D_MARKER,
    order_number: TARGET_ORDER_NUMBER,
    customer_app_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
    native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
    native_fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
    production_date: TARGET_PRODUCTION_DATE,
    delivery_date: TARGET_DELIVERY_DATE,
    customer_app_order_present: Boolean(preflight?.customerOrder?.id),
    native_shopify_order_present: Boolean(preflight?.nativeOrder?.id),
    native_fulfillment_task_present: Boolean(preflight?.task?.id),
    production_verified: Array.isArray(preflight?.batches) && preflight.batches.length === EXPECTED_BATCH_IDS.length,
    task_packed: true,
    native_order_bottled: true,
    current_customer_order_status: safeText(customerOrder?.status, 80) || null,
    proposed_customer_order_status: TARGET_CUSTOMER_STATUS,
    status_update_ready: updateReady,
    status_update_held: true,
    status_update_already_satisfied: alreadySatisfied,
    status_only_path_available_without_notification: updateReady,
    status_command_available: updateReady,
    status_command_gated: true,
    status_requires_exact_approval: updateReady,
    notification_policy_required: REQUIRED_NOTIFICATION_POLICY,
    notification_would_send: false,
    notification_held: true,
    production_batch_count: Array.isArray(preflight?.batches) ? preflight.batches.length : 0,
    verified_batch_count: Array.isArray(preflight?.batches) ? preflight.batches.length : 0,
    compliance_log_count: Array.isArray(preflight?.complianceLogs) ? preflight.complianceLogs.length : 0,
    blockers: [],
    warnings: uniqueStrings([
      'customer_status_update_held_pending_explicit_approval',
      'notifications_held',
      'status_only_path_notification_free',
      'hub_fallback_required',
      ...(preflight?.warnings || []),
    ], 80),
    next_action: updateReady ? 'plan_status_only_command_with_notifications_disabled' : 'customer_status_already_satisfied',
    status_history_preview: {
      would_append: updateReady,
      append_held: true,
      current_status: safeText(customerOrder?.status, 80) || null,
      proposed_status: TARGET_CUSTOMER_STATUS,
      existing_status_history_count: Array.isArray(customerOrder?.status_history) ? customerOrder.status_history.length : 0,
      already_has_proposed_status_entry: statusHistoryAlreadyContains(customerOrder, TARGET_CUSTOMER_STATUS),
      preview_entry: updateReady ? {
        status: TARGET_CUSTOMER_STATUS,
        timestamp: '[server timestamp if later approved]',
        message: statusMessage(TARGET_CUSTOMER_STATUS),
        source: 'native_customer_status_update_command_preflight',
        writes_performed: false,
      } : null,
    },
    notification_preview: {
      notification_would_send: false,
      notification_held: true,
      status_notification_configured: false,
      proposed_notification_subtype: null,
      automatic_notification_would_send_if_status_updated: false,
      status_only_path_available_without_notification: true,
      notification_channels: { in_app: false, push: false, sms: false, email: false },
    },
    safety: safetyResult(),
  };
}

async function fetchFreshPreview(base44, lookup) {
  const secret = expectedPreviewSecret();
  if (!secret) return { ok: false, status: 409, error_code: 'preview_secret_not_configured', data: null };

  try {
    const invokePromise = base44.asServiceRole.functions.invoke('previewNativeCustomerStatusNotificationImpact', {
      mode: 'dry_run',
      order_number: TARGET_ORDER_NUMBER,
      customer_app_order_id: lookup.customerAppOrderId || TARGET_CUSTOMER_APP_ORDER_ID,
      native_shopify_order_id: lookup.nativeShopifyOrderId || TARGET_NATIVE_SHOPIFY_ORDER_ID,
      native_fulfillment_task_id: lookup.nativeFulfillmentTaskId || TARGET_NATIVE_FULFILLMENT_TASK_ID,
      request_id: `${lookup.requestId || 'g32d'}:fresh_customer_status_preview`,
      _internal_secret: secret,
    });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error('Fresh customer status impact preview invocation timed out');
        error.status = 504;
        error.code = 'native_customer_status_update_preview_timeout';
        reject(error);
      }, 8000);
    });
    const response = await Promise.race([invokePromise, timeoutPromise]);
    const data = response?.data || response;
    if (!data?.success) {
      return { ok: false, status: 409, error_code: data?.error_code || 'native_customer_status_update_preview_failed', data };
    }
    return { ok: true, status: 200, data };
  } catch (error) {
    const status = error?.response?.status || error?.status || 502;
    const data = error?.response?.data || error?.data || null;
    return { ok: false, status, error_code: data?.error_code || error?.code || previewFailureCode(status), data };
  }
}

function validateFreshPreview(preview) {
  const blockers = [];
  const warnings = [];
  const notificationPreview = preview?.notification_preview || {};
  const safety = preview?.safety || {};

  if (!preview?.success) blockers.push('fresh_customer_status_preview_failed');
  if (preview?.dry_run !== true) blockers.push('fresh_customer_status_preview_not_dry_run');
  if (preview?.writes_performed !== false) blockers.push('fresh_customer_status_preview_writes_flag_not_false');
  if (preview?.order_number !== TARGET_ORDER_NUMBER) blockers.push('fresh_preview_order_number_mismatch');
  if (preview?.customer_app_order_id !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('fresh_preview_customer_app_order_id_mismatch');
  if (preview?.native_shopify_order_id !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('fresh_preview_native_shopify_order_id_mismatch');
  if (preview?.native_fulfillment_task_id !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('fresh_preview_native_fulfillment_task_id_mismatch');
  if (preview?.production_verified !== true) blockers.push('fresh_preview_production_not_verified');
  if (preview?.task_packed !== true) blockers.push('fresh_preview_task_not_packed');
  if (preview?.native_order_bottled !== true) blockers.push('fresh_preview_native_order_not_bottled');
  if (preview?.current_customer_order_status !== REQUIRED_CURRENT_STATUS) blockers.push('fresh_preview_current_status_mismatch');
  if (preview?.proposed_customer_order_status !== TARGET_CUSTOMER_STATUS) blockers.push('fresh_preview_target_status_mismatch');
  if (preview?.status_update_ready !== true) blockers.push('fresh_preview_status_update_not_ready');
  if (preview?.status_update_held !== true) blockers.push('fresh_preview_status_update_not_held');
  if (preview?.notification_would_send !== false) blockers.push('fresh_preview_notification_projected');
  if (preview?.notification_held !== true) blockers.push('fresh_preview_notification_not_held');
  if (notificationPreview.automatic_notification_would_send_if_status_updated === true) blockers.push('fresh_preview_automatic_notification_would_send');
  if (notificationPreview.status_only_path_available_without_notification !== true) blockers.push('fresh_preview_status_only_notification_free_path_missing');
  if (Number(preview?.verified_batch_count) !== EXPECTED_BATCH_IDS.length) blockers.push('fresh_preview_verified_batch_count_mismatch');
  if (Number(preview?.production_batch_count) !== EXPECTED_BATCH_IDS.length) blockers.push('fresh_preview_production_batch_count_mismatch');
  if (Number(preview?.compliance_log_count) < EXPECTED_BATCH_IDS.length) blockers.push('fresh_preview_compliance_log_count_mismatch');
  if (Array.isArray(preview?.blockers) && preview.blockers.length > 0) blockers.push('fresh_preview_blockers_present');
  if (safety.writes_performed !== false) blockers.push('fresh_preview_safety_writes_not_false');
  if (safety.customer_app_order_updated === true || safety.status_history_appended === true || safety.notifications_created === true || safety.notifications_sent === true || safety.native_shopify_order_updated === true || safety.native_fulfillment_task_updated === true || safety.production_batch_updated === true || safety.provider_calls_performed === true || safety.shopify_api_calls_performed === true || safety.sync_repair_replay_performed === true) {
    blockers.push('fresh_preview_side_effect_projected');
  }

  if (Array.isArray(preview?.warnings)) warnings.push(...preview.warnings);
  return { ready: blockers.length === 0, blockers: uniqueStrings(blockers, 160), warnings: uniqueStrings(warnings, 120) };
}

function buildStatusPatch({ order, actorEmail, requestId, now }) {
  const existingHistory = Array.isArray(order?.status_history) ? order.status_history.slice(-120) : [];
  return {
    status: TARGET_CUSTOMER_STATUS,
    status_history: [
      ...existingHistory,
      {
        status: TARGET_CUSTOMER_STATUS,
        timestamp: now,
        message: statusMessage(TARGET_CUSTOMER_STATUS),
      },
    ],
  };
}

function validateStatusPatch(patch) {
  const blockers = [];
  const allowed = new Set(['status', 'status_history']);
  for (const key of Object.keys(patch || {})) if (!allowed.has(key)) blockers.push(`unapproved_customer_status_update_field:${key}`);
  if (patch.status !== TARGET_CUSTOMER_STATUS) blockers.push('customer_order_status_must_be_bottled_packed');
  if (!Array.isArray(patch.status_history) || patch.status_history.length === 0) blockers.push('status_history_append_required');
  if ('delivery_status' in patch || 'fulfillment_status' in patch || 'production_status' in patch || 'delivered_at' in patch || 'delivery_photo_url' in patch || 'delivery_drop_location' in patch || 'route_id' in patch || 'ready_for_driver' in patch || 'notification' in patch || 'notified_at' in patch) {
    blockers.push('forbidden_delivery_or_notification_field_present');
  }
  return blockers;
}

async function updateCustomerOrderStatusOnly({ base44, order, actorEmail, requestId }) {
  const now = new Date().toISOString();
  const previousStatus = safeText(order?.status, 80) || null;
  const patch = buildStatusPatch({ order, actorEmail, requestId, now });
  const patchBlockers = validateStatusPatch(patch);
  if (patchBlockers.length > 0) {
    const error = new Error(`Customer order status patch validation failed: ${patchBlockers.join(',')}`);
    error.code = 'customer_order_status_patch_invalid';
    throw error;
  }
  const updated = await base44.asServiceRole.entities.Order.update(order.id, patch);
  return summarizeCustomerOrder(updated, previousStatus);
}

async function createCommandLogSafe(args) {
  try {
    const commandLog = await createCommandLog(args);
    if (!commandLog?.id) {
      return { ok: false, error_code: 'customer_status_update_command_log_missing_id', commandLog: null };
    }
    return { ok: true, commandLog };
  } catch (error) {
    return {
      ok: false,
      error_code: error?.code || 'customer_status_update_command_log_create_failed',
      message: error?.message || 'CommandLog create failed',
      commandLog: null,
    };
  }
}

async function createCommandLog({ base44, status, idempotencyKey, requestId, user, result, errorCode, errorMessage }) {
  const now = new Date().toISOString();
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: COMMAND_TYPE,
    command_source: 'customer_app_native_admin',
    status,
    target_entity: 'Order',
    target_id: TARGET_CUSTOMER_APP_ORDER_ID,
    target_display_id: TARGET_ORDER_NUMBER,
    actor_email: safeActorEmail(user?.email) || null,
    actor_role: safeText(user?.role, 80) || null,
    actor_type: 'admin',
    payload: {
      exact_order_allowlist: true,
      exact_customer_order_allowlist: true,
      order_number: TARGET_ORDER_NUMBER,
      customer_app_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
      native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
      native_fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
      production_date: TARGET_PRODUCTION_DATE,
      delivery_date: TARGET_DELIVERY_DATE,
      policy: REQUIRED_POLICY,
      notification_policy: REQUIRED_NOTIFICATION_POLICY,
      current_status_expected: REQUIRED_CURRENT_STATUS,
      target_status: TARGET_CUSTOMER_STATUS,
      expected_batch_ids: EXPECTED_BATCH_IDS,
      expected_products: EXPECTED_PRODUCTS,
      preview_function: 'previewNativeCustomerStatusNotificationImpact',
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
    related_order_number: TARGET_ORDER_NUMBER,
    related_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
    notes: 'G32D exact gated Customer App Order status-only command. Updates only exact Customer App Order status/status_history and CommandLog. No notification rows, message logs, native ShopifyOrder, FulfillmentTask, ProductionBatch, BatchComplianceLog, delivery/proof/drop/route, inventory, PurchaseOrder, provider, payment, sync, repair, replay, or Hub mutation.',
  });
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
    return {
      ok: false,
      error_code: error?.code || 'customer_status_update_command_log_update_failed',
      message: error?.message || 'CommandLog update failed',
    };
  }
}

function safetyResult(extra = {}) {
  return {
    writes_performed: false,
    customer_app_order_updated: false,
    customer_facing_status_updated: false,
    status_history_appended: false,
    notifications_created: false,
    notifications_sent: false,
    message_logs_created: false,
    native_shopify_order_updated: false,
    native_fulfillment_task_updated: false,
    delivery_status_updated: false,
    delivery_route_proof_drop_mutated: false,
    production_batches_updated: false,
    production_batches_created: false,
    manual_production_batches_created: false,
    compliance_logs_created: false,
    batch_compliance_logs_created: false,
    inventory_deducted: false,
    purchase_orders_created: false,
    provider_calls_performed: false,
    stripe_calls_performed: false,
    shopify_api_calls_performed: false,
    sync_repair_replay_performed: false,
    hub_bridge_modified: false,
    ...extra,
  };
}

function writeSafetyResult(extra = {}) {
  return safetyResult({
    writes_performed: true,
    ...extra,
  });
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
    if (!lookup.requestId) return jsonResponse({ success: false, error_code: 'request_id_required', writes_performed: false }, 400);

    const targetBlockers = exactTargetBlockers(lookup);
    if (targetBlockers.length > 0) {
      return jsonResponse({ success: false, skipped: true, error_code: 'exact_customer_status_update_target_required', blockers: targetBlockers, writes_performed: false }, 409);
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
        command_log_id: safeId(existingLog.id, 120) || null,
        writes_performed: false,
        customer_app_order_updated: false,
        duplicate_status_history_appended: false,
        duplicate_notifications_created: false,
        safety: safetyResult(),
      });
    }
    if (existingLog && existingLog.status === 'failed') {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: 'previous_failed_request_id_not_reusable',
        request_id: lookup.requestId,
        idempotency_key: idempotencyKey,
        writes_performed: false,
      }, 409);
    }

    const preflight = await preflightTargetContext(base44);
    if (!preflight.ready) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: 'customer_status_update_preflight_blocked',
        blockers: preflight.blockers,
        warnings: preflight.warnings,
        conflicts: preflight.conflicts,
        writes_performed: false,
      }, 409);
    }

    if (preflight.mode === 'already_satisfied') {
      const skippedLog = await createCommandLogSafe({
        base44,
        status: 'skipped',
        idempotencyKey,
        requestId: lookup.requestId,
        user: auth.user,
        result: {
          writes_performed: false,
          customer_app_order_updated: false,
          customer_status_already_satisfied: true,
          customer_order: summarizeCustomerOrder(preflight.alreadySatisfiedOrder, preflight.alreadySatisfiedOrder?.status, 'already_bottled_packed'),
          duplicate_status_history_appended: false,
          notifications_created: false,
          notifications_sent: false,
          ...safetyResult(),
        },
      });
      if (!skippedLog.ok) {
        return jsonResponse({
          success: false,
          skipped: true,
          error_code: skippedLog.error_code,
          message: 'Customer status update skipped but CommandLog creation failed safely.',
          writes_performed: false,
        }, 500);
      }
      return jsonResponse({
        success: true,
        skipped: true,
        idempotent: false,
        reason: 'customer_status_already_bottled_packed',
        request_id: lookup.requestId,
        idempotency_key: idempotencyKey,
        command_log_id: safeId(skippedLog.commandLog?.id, 120) || null,
        order_number: TARGET_ORDER_NUMBER,
        customer_app_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
        writes_performed: false,
        customer_app_order_updated: false,
        customer_facing_status_updated: true,
        status_history_appended: false,
        notifications_created: false,
        notifications_sent: false,
        customer_order: summarizeCustomerOrder(preflight.alreadySatisfiedOrder, preflight.alreadySatisfiedOrder?.status, 'already_bottled_packed'),
        duplicate_status_history_appended: false,
        safety: safetyResult({ customer_facing_status_updated: true }),
      });
    }

    const freshPreview = shouldUseServicePreview()
      ? await fetchFreshPreview(base44, lookup)
      : { ok: true, status: 200, data: buildLocalFreshStatusPreview(preflight) };
    if (!freshPreview.ok) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: freshPreview.error_code || 'native_customer_status_update_preview_failed',
        preview_status: freshPreview.status,
        writes_performed: false,
      }, 409);
    }

    const validation = validateFreshPreview(freshPreview.data);
    if (!validation.ready) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: 'fresh_customer_status_preview_not_clean',
        blockers: validation.blockers,
        warnings: validation.warnings,
        writes_performed: false,
      }, 409);
    }

    const commandLogCreate = await createCommandLogSafe({
      base44,
      status: 'running',
      idempotencyKey,
      requestId: lookup.requestId,
      user: auth.user,
      result: {
        writes_performed: false,
        projected_update_count: 1,
        projected_customer_app_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
        projected_status_from: REQUIRED_CURRENT_STATUS,
        projected_status_to: TARGET_CUSTOMER_STATUS,
        projected_status_history_append: true,
        notification_policy: REQUIRED_NOTIFICATION_POLICY,
        notifications_created: false,
        notifications_sent: false,
        native_shopify_order_updated: false,
        native_fulfillment_task_updated: false,
        verified_batch_count: preflight.batches.length,
        compliance_log_count: preflight.complianceLogs.length,
        preview_source: freshPreview.data?.preview_source || 'service_preview',
        patch_marker: G32D_MARKER,
      },
    });
    if (!commandLogCreate.ok) {
      return jsonResponse({
        success: false,
        skipped: false,
        error_code: commandLogCreate.error_code,
        message: 'Customer status update validation passed, but CommandLog creation failed before any order update.',
        writes_performed: false,
        customer_app_order_updated: false,
      }, 500);
    }
    const commandLog = commandLogCreate.commandLog;

    let updatedOrder = null;
    try {
      updatedOrder = await updateCustomerOrderStatusOnly({
        base44,
        order: preflight.rowToUpdate,
        actorEmail: auth.user?.email,
        requestId: lookup.requestId,
      });
    } catch (error) {
      await updateCommandLogSafe({
        base44,
        commandLogId: commandLog?.id,
        status: 'failed',
        result: {
          writes_performed: false,
          customer_app_order_updated: false,
          projected_customer_app_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
          duplicate_status_history_appended: false,
          notifications_created: false,
          notifications_sent: false,
          ...safetyResult(),
        },
        errorCode: error?.code || 'customer_status_update_write_failed',
        errorMessage: error?.message || 'Customer status update write failed',
      });
      return jsonResponse({
        success: false,
        skipped: false,
        error_code: error?.code || 'customer_status_update_write_failed',
        message: 'Customer status update failed safely.',
        writes_performed: false,
      }, 500);
    }

    const successSafety = writeSafetyResult({ customer_app_order_updated: true, customer_facing_status_updated: true, status_history_appended: true });
    const successLogUpdate = await updateCommandLogSafe({
      base44,
      commandLogId: commandLog?.id,
      status: 'success',
      result: {
        ...successSafety,
        customer_order: updatedOrder,
        status_from: updatedOrder?.previous_status || null,
        status_to: TARGET_CUSTOMER_STATUS,
        status_history_appended: true,
        notifications_created: false,
        notifications_sent: false,
        message_logs_created: false,
        native_shopify_order_updated: false,
        native_fulfillment_task_updated: false,
        verified_batch_count: preflight.batches.length,
        compliance_log_count: preflight.complianceLogs.length,
        patch_marker: G32D_MARKER,
      },
    });
    if (!successLogUpdate.ok) {
      return jsonResponse({
        success: false,
        skipped: false,
        error_code: successLogUpdate.error_code,
        message: 'Customer App Order status was updated, but CommandLog finalization failed. Reconciliation required before retry.',
        request_id: lookup.requestId,
        idempotency_key: idempotencyKey,
        command_log_id: safeId(commandLog?.id, 120) || null,
        order_number: TARGET_ORDER_NUMBER,
        customer_app_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
        writes_performed: true,
        reconciliation_required: true,
        customer_app_order_updated: true,
        customer_facing_status_updated: true,
        status_history_appended: true,
        notifications_created: false,
        notifications_sent: false,
        customer_order: updatedOrder,
        safety: successSafety,
      }, 500);
    }

    return jsonResponse({
      success: true,
      skipped: false,
      idempotent: false,
      request_id: lookup.requestId,
      idempotency_key: idempotencyKey,
      command_log_id: safeId(commandLog?.id, 120) || null,
      order_number: TARGET_ORDER_NUMBER,
      customer_app_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
      writes_performed: true,
      customer_app_order_updated: true,
      customer_facing_status_updated: true,
      status_history_appended: true,
      status_from: updatedOrder?.previous_status || null,
      status_to: TARGET_CUSTOMER_STATUS,
      customer_order: updatedOrder,
      notification_policy: REQUIRED_NOTIFICATION_POLICY,
      notifications_created: false,
      notifications_sent: false,
      message_logs_created: false,
      native_shopify_order_updated: false,
      native_fulfillment_task_updated: false,
      delivery_status_updated: false,
      delivery_route_proof_drop_mutated: false,
      production_batches_updated: false,
      compliance_logs_created: false,
      batch_compliance_logs_created: false,
      inventory_deducted: false,
      purchase_orders_created: false,
      provider_calls: false,
      stripe_calls: false,
      shopify_calls: false,
      sync_retry_repair_run: false,
      hub_records_updated: false,
      duplicate_status_history_appended: false,
      verified_batch_count: preflight.batches.length,
      compliance_log_count: preflight.complianceLogs.length,
      safety: successSafety,
    });
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] failed safely: ${error?.message || 'unknown error'}`);
    return jsonResponse({
      success: false,
      error_code: 'customer_status_update_failed',
      message: 'Customer status update failed safely.',
      writes_performed: false,
    }, 500);
  }
});
