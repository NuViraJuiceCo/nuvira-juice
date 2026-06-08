import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const FUNCTION_NAME = 'correctNativeScheduleExceptionForCustomerApp';
const COMMAND_TYPE = 'native_schedule_exception_date_only_correction';
const ENABLE_FLAG = 'ENABLE_NATIVE_SCHEDULE_EXCEPTION_CORRECTION';
const KILL_SWITCH_FLAG = 'NATIVE_SCHEDULE_EXCEPTION_CORRECTION_KILL_SWITCH';
const ALLOWED_EMAILS_FLAG = 'NATIVE_SCHEDULE_EXCEPTION_CORRECTION_ALLOWED_EMAILS';
const ORDER_ALLOWLIST_FLAG = 'NATIVE_SCHEDULE_EXCEPTION_CORRECTION_ORDER_ALLOWLIST';
const CUSTOMER_ORDER_ALLOWLIST_FLAG = 'NATIVE_SCHEDULE_EXCEPTION_CORRECTION_CUSTOMER_ORDER_ALLOWLIST';
const TASK_ALLOWLIST_FLAG = 'NATIVE_SCHEDULE_EXCEPTION_CORRECTION_TASK_ALLOWLIST';
const SHOPIFY_ORDER_ALLOWLIST_FLAG = 'NATIVE_SCHEDULE_EXCEPTION_CORRECTION_SHOPIFY_ORDER_ALLOWLIST';
const POLICY_FLAG = 'NATIVE_SCHEDULE_EXCEPTION_CORRECTION_POLICY';
const REQUIRED_POLICY = 'EXACT_DATE_ONLY_NO_NOTIFICATION';
const REQUIRED_NOTIFICATION_POLICY = 'NO_NOTIFICATION';
const CONFIRMATION_PHRASE = 'correct_native_schedule_exception_date_only_no_notification';
const TARGET_ORDER_NUMBER = 'NV-MPZNKGNT';
const TARGET_CUSTOMER_APP_ORDER_ID = '6a219a3f4adcda5856c3d579';
const TARGET_NATIVE_SHOPIFY_ORDER_ID = '6a22ffda400eb806eb3ca945';
const TARGET_NATIVE_FULFILLMENT_TASK_ID = '6a22ffdaf675ea79e30575aa';
const EXPECTED_RECORDED_PRODUCTION_DATE = '2026-06-05';
const EXPECTED_RECORDED_DELIVERY_DATE = '2026-06-06';
const TARGET_ACTUAL_PRODUCTION_DATE = '2026-06-07';
const TARGET_ACTUAL_DELIVERY_DATE = '2026-06-08';
const REQUIRED_CORRECTION_MODE = 'DATE_ONLY';
const MAX_TEXT = 180;

const EXPECTED_BATCH_IDS = Object.freeze([
  'NATIVE-NV-MPZNKGNT-2026-06-05-AURA',
  'NATIVE-NV-MPZNKGNT-2026-06-05-OASIS',
  'NATIVE-NV-MPZNKGNT-2026-06-05-PINEAPPLE-JUICE',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RADIANCE-SHOT',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RE-NU',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RESET-SHOT',
]);

const ALLOWED_BODY_KEYS = new Set([
  'mode',
  'confirmation',
  'order_number',
  'shopify_order_number',
  'request_id',
  'customer_app_order_id',
  'base44_order_id',
  'order_id',
  'native_shopify_order_id',
  'native_order_id',
  'shopify_order_id',
  'native_fulfillment_task_id',
  'fulfillment_task_id',
  'task_id',
  'current_recorded_production_date',
  'current_recorded_delivery_date',
  'actual_production_date',
  'actual_delivery_date',
  'correction_mode',
  'leave_delivery_window_unchanged',
  'notification_policy',
]);

const FORBIDDEN_BODY_KEYS = new Set([
  'status',
  'target_status',
  'status_history',
  'append_status_history',
  'customer_status',
  'send_notification',
  'notify_customer',
  'notification',
  'notifications',
  'notification_payload',
  'message_log',
  'message_logs',
  'push',
  'sms',
  'email',
  'in_app',
  'delivery_status',
  'delivery_status_override',
  'fulfillment_status',
  'production_status',
  'out_for_delivery',
  'delivered',
  'delivered_at',
  'proof',
  'proof_url',
  'proof_photo_url',
  'drop',
  'drop_location',
  'route',
  'route_id',
  'production_batch_date',
  'production_batch_dates',
  'batch_date',
  'batch_ids',
  'production_batch_ids',
  'batch_compliance_log_date',
  'compliance_log_date',
  'compliance',
  'sync',
  'repair',
  'replay',
  'raw_payload',
  'payload',
  'raw_body',
  'raw_order',
  'raw_task',
  'raw_provider_payload',
  'raw_payment_payload',
  'provider_id',
  'provider_ids',
  'stripe_id',
  'shopify_provider_id',
  'headers',
  'authorization',
  'auth_header',
  'secret',
  'token',
  'api_key',
  'api-key',
  'bulk_order_ids',
  'bulk_task_ids',
  'inventory_deduction',
  'deduct_inventory',
  'purchase_order',
  'create_purchase_order',
  'proposed_delivery_window',
  'delivery_window',
  'delivery_window_label',
  'assigned_delivery_window_start',
  'assigned_delivery_window_end',
]);

const CUSTOMER_TERMINAL_STATUSES = new Set(['cancelled', 'canceled', 'refunded', 'delivered', 'picked_up']);
const TASK_TERMINAL_STATUSES = new Set(['cancelled', 'canceled', 'delivered', 'unable_to_deliver']);
const DELIVERY_ADVANCED_STATUSES = new Set(['out_for_delivery', 'arriving_soon', 'delivered']);
const NATIVE_ORDER_CANCELLED_REFUNDED = new Set(['canceled', 'cancelled', 'refunded', 'voided']);

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

function parseCsvSet(value) {
  return new Set(normalizeText(value).split(',').map(normalizeLower).filter(Boolean));
}

function uniqueStrings(values, limit = 160) {
  return [...new Set((values || []).map(value => safeText(value, 180)).filter(Boolean))].slice(0, limit);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizeText(value));
}

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
}

function safetyResult(overrides = {}) {
  return {
    writes_performed: false,
    customer_app_order_updated: false,
    native_shopify_order_updated: false,
    native_fulfillment_task_updated: false,
    production_batch_updated: false,
    batch_compliance_log_updated: false,
    status_history_appended: false,
    notifications_created: false,
    notifications_sent: false,
    delivery_status_updated: false,
    delivery_route_proof_drop_mutated: false,
    provider_calls_performed: false,
    stripe_calls_performed: false,
    shopify_api_calls_performed: false,
    sync_repair_replay_performed: false,
    inventory_deducted: false,
    purchase_order_created: false,
    hub_bridge_modified: false,
    ...overrides,
  };
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
    if (FORBIDDEN_BODY_KEYS.has(normalized)) return key;
    if (ALLOWED_BODY_KEYS.has(normalized)) continue;
    if (/(^|_)(custom|raw|payload|provider|stripe|shopify|inventory|purchase|notification|message|sync|repair|replay|bulk|batch|compliance|route|proof|delivery|drop|status|window|secret|token)($|_)/i.test(normalized)) return key;
    return key;
  }
  return null;
}

function getLookup(body) {
  return {
    orderNumber: normalizeText(body?.order_number || body?.shopify_order_number).replace(/^#/, ''),
    requestId: safeId(body?.request_id, 180),
    confirmation: normalizeText(body?.confirmation),
    customerAppOrderId: safeId(body?.customer_app_order_id || body?.base44_order_id || body?.order_id, 120),
    nativeShopifyOrderId: safeId(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id, 120),
    nativeFulfillmentTaskId: safeId(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id, 120),
    currentRecordedProductionDate: normalizeText(body?.current_recorded_production_date),
    currentRecordedDeliveryDate: normalizeText(body?.current_recorded_delivery_date),
    actualProductionDate: normalizeText(body?.actual_production_date),
    actualDeliveryDate: normalizeText(body?.actual_delivery_date),
    correctionMode: normalizeText(body?.correction_mode).toUpperCase(),
    leaveDeliveryWindowUnchanged: body?.leave_delivery_window_unchanged === true,
    notificationPolicy: normalizeText(body?.notification_policy).toUpperCase(),
  };
}

function exactInputBlockers(lookup) {
  const blockers = [];
  if (!lookup.requestId) blockers.push('request_id_required');
  if (lookup.confirmation !== CONFIRMATION_PHRASE) blockers.push('confirmation_phrase_required');
  if (lookup.orderNumber !== TARGET_ORDER_NUMBER) blockers.push('target_order_number_mismatch');
  if (lookup.customerAppOrderId !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('target_customer_app_order_id_required');
  if (lookup.nativeShopifyOrderId !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('target_native_shopify_order_id_required');
  if (lookup.nativeFulfillmentTaskId !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('target_native_fulfillment_task_id_required');
  if (lookup.currentRecordedProductionDate !== EXPECTED_RECORDED_PRODUCTION_DATE) blockers.push('current_recorded_production_date_must_match_expected_stale_value');
  if (lookup.currentRecordedDeliveryDate !== EXPECTED_RECORDED_DELIVERY_DATE) blockers.push('current_recorded_delivery_date_must_match_expected_stale_value');
  if (!isIsoDate(lookup.actualProductionDate) || lookup.actualProductionDate !== TARGET_ACTUAL_PRODUCTION_DATE) blockers.push('actual_production_date_must_be_2026_06_07');
  if (!isIsoDate(lookup.actualDeliveryDate) || lookup.actualDeliveryDate !== TARGET_ACTUAL_DELIVERY_DATE) blockers.push('actual_delivery_date_must_be_2026_06_08');
  if (lookup.correctionMode !== REQUIRED_CORRECTION_MODE) blockers.push('correction_mode_must_be_date_only');
  if (lookup.leaveDeliveryWindowUnchanged !== true) blockers.push('leave_delivery_window_unchanged_required');
  if (lookup.notificationPolicy !== REQUIRED_NOTIFICATION_POLICY) blockers.push('notification_policy_must_be_no_notification');
  return blockers;
}

function gateFailure({ actorEmail, lookup }) {
  if (Deno.env.get(KILL_SWITCH_FLAG) === 'true') return 'kill_switch_active';
  if (Deno.env.get(ENABLE_FLAG) !== 'true') return 'native_schedule_exception_correction_disabled';
  if (normalizeText(Deno.env.get(POLICY_FLAG)) !== REQUIRED_POLICY) return 'exact_date_only_no_notification_policy_required';

  const allowedEmails = parseCsvSet(Deno.env.get(ALLOWED_EMAILS_FLAG) || '');
  if (allowedEmails.size === 0) return 'allowed_email_gate_required';
  if (!allowedEmails.has(normalizeLower(actorEmail))) return 'actor_email_not_allowlisted';

  const orderAllowlist = parseCsvSet(Deno.env.get(ORDER_ALLOWLIST_FLAG) || '');
  if (orderAllowlist.size === 0) return 'order_allowlist_required';
  if (!orderAllowlist.has(normalizeLower(lookup.orderNumber))) return 'order_not_allowlisted';

  const customerOrderAllowlist = parseCsvSet(Deno.env.get(CUSTOMER_ORDER_ALLOWLIST_FLAG) || '');
  if (customerOrderAllowlist.size === 0) return 'customer_order_allowlist_required';
  if (!customerOrderAllowlist.has(normalizeLower(lookup.customerAppOrderId))) return 'customer_order_not_allowlisted';

  const taskAllowlist = parseCsvSet(Deno.env.get(TASK_ALLOWLIST_FLAG) || '');
  if (taskAllowlist.size === 0) return 'task_allowlist_required';
  if (!taskAllowlist.has(normalizeLower(lookup.nativeFulfillmentTaskId))) return 'task_not_allowlisted';

  const shopifyOrderAllowlist = parseCsvSet(Deno.env.get(SHOPIFY_ORDER_ALLOWLIST_FLAG) || '');
  if (shopifyOrderAllowlist.size === 0) return 'shopify_order_allowlist_required';
  if (!shopifyOrderAllowlist.has(normalizeLower(lookup.nativeShopifyOrderId))) return 'shopify_order_not_allowlisted';

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
  return filterEntity(base44, 'CommandLog', { idempotency_key: idempotencyKey }, '-created_date', 5);
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

async function findNativeFulfillmentTask(base44) {
  const byId = await getEntity(base44, 'FulfillmentTask', TARGET_NATIVE_FULFILLMENT_TASK_ID);
  if (byId?.id) return byId;
  const rows = await filterEntity(base44, 'FulfillmentTask', { id: TARGET_NATIVE_FULFILLMENT_TASK_ID }, '-created_date', 5);
  if (rows[0]?.id) return rows[0];
  const byTaskId = await filterEntity(base44, 'FulfillmentTask', { fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID }, '-created_date', 5);
  return byTaskId[0] || null;
}

async function findProductionBatch(base44, batchId) {
  const rows = await filterEntity(base44, 'ProductionBatch', { batch_id: batchId }, '-created_date', 5);
  return rows[0] || null;
}

async function findComplianceLogsForBatch(base44, batch) {
  const byBatch = batch?.batch_id ? await filterEntity(base44, 'BatchComplianceLog', { batch_id: batch.batch_id }, '-created_date', 20) : [];
  const bySource = batch?.id ? await filterEntity(base44, 'BatchComplianceLog', { source_production_batch_id: batch.id }, '-created_date', 20) : [];
  return [...new Map([...byBatch, ...bySource].map(row => [row.id || `${row.batch_id}:${row.source_production_batch_id}`, row])).values()];
}

function targetOrderType(customerOrder, nativeOrder, task) {
  if (nativeOrder?.is_subscription === true || customerOrder?.is_subscription === true || customerOrder?.subscription_id || nativeOrder?.subscription_parent_id || task?.customer_app_subscription_id || task?.stripe_subscription_id) return 'subscription';
  return normalizeLower(nativeOrder?.order_type || customerOrder?.order_type || task?.order_type || 'one_time') || 'one_time';
}

function targetFulfillmentMode(customerOrder, nativeOrder, task) {
  return normalizeLower(nativeOrder?.fulfillment_mode || customerOrder?.fulfillment_mode || task?.fulfillment_mode || task?.fulfillment_type || nativeOrder?.fulfillment_method || customerOrder?.fulfillment_type || 'single_delivery') || 'single_delivery';
}

function firstFulfillment(nativeOrder) {
  return Array.isArray(nativeOrder?.fulfillments) && nativeOrder.fulfillments.length > 0 ? nativeOrder.fulfillments[0] : null;
}

function hasDateOnlyStaleState({ customerOrder, nativeOrder, task }) {
  return Boolean(
    customerOrder?.production_date === EXPECTED_RECORDED_PRODUCTION_DATE &&
    customerOrder?.assigned_production_day === EXPECTED_RECORDED_PRODUCTION_DATE &&
    customerOrder?.estimated_delivery_date === EXPECTED_RECORDED_DELIVERY_DATE &&
    customerOrder?.assigned_delivery_date === EXPECTED_RECORDED_DELIVERY_DATE &&
    nativeOrder?.production_date === EXPECTED_RECORDED_PRODUCTION_DATE &&
    nativeOrder?.assigned_delivery_date === EXPECTED_RECORDED_DELIVERY_DATE &&
    (!Object.prototype.hasOwnProperty.call(nativeOrder || {}, 'selected_delivery_date') || nativeOrder?.selected_delivery_date === EXPECTED_RECORDED_DELIVERY_DATE) &&
    task?.production_date === EXPECTED_RECORDED_PRODUCTION_DATE &&
    task?.delivery_date === EXPECTED_RECORDED_DELIVERY_DATE &&
    task?.scheduled_date === EXPECTED_RECORDED_DELIVERY_DATE &&
    task?.assigned_delivery_date === EXPECTED_RECORDED_DELIVERY_DATE
  );
}

function hasDateOnlyCorrectedState({ customerOrder, nativeOrder, task }) {
  return Boolean(
    customerOrder?.production_date === TARGET_ACTUAL_PRODUCTION_DATE &&
    customerOrder?.assigned_production_day === TARGET_ACTUAL_PRODUCTION_DATE &&
    customerOrder?.estimated_delivery_date === TARGET_ACTUAL_DELIVERY_DATE &&
    customerOrder?.assigned_delivery_date === TARGET_ACTUAL_DELIVERY_DATE &&
    nativeOrder?.production_date === TARGET_ACTUAL_PRODUCTION_DATE &&
    nativeOrder?.assigned_delivery_date === TARGET_ACTUAL_DELIVERY_DATE &&
    (!Object.prototype.hasOwnProperty.call(nativeOrder || {}, 'selected_delivery_date') || nativeOrder?.selected_delivery_date === TARGET_ACTUAL_DELIVERY_DATE) &&
    task?.production_date === TARGET_ACTUAL_PRODUCTION_DATE &&
    task?.delivery_date === TARGET_ACTUAL_DELIVERY_DATE &&
    task?.scheduled_date === TARGET_ACTUAL_DELIVERY_DATE &&
    task?.assigned_delivery_date === TARGET_ACTUAL_DELIVERY_DATE
  );
}

function summarizeContext({ customerOrder, nativeOrder, task, batches, complianceLogs }) {
  return {
    customer_app_order: customerOrder ? {
      id: safeId(customerOrder.id, 120),
      status: safeText(customerOrder.status, 80) || null,
      payment_status: safeText(customerOrder.payment_status, 80) || null,
      payment_captured: customerOrder.payment_captured === true,
      production_date: safeText(customerOrder.production_date, 40) || null,
      assigned_production_day: safeText(customerOrder.assigned_production_day, 40) || null,
      estimated_delivery_date: safeText(customerOrder.estimated_delivery_date, 40) || null,
      assigned_delivery_date: safeText(customerOrder.assigned_delivery_date, 40) || null,
      status_history_count: Array.isArray(customerOrder.status_history) ? customerOrder.status_history.length : 0,
    } : null,
    native_shopify_order: nativeOrder ? {
      id: safeId(nativeOrder.id, 120),
      production_status: safeText(nativeOrder.production_status, 80) || null,
      fulfillment_status: safeText(nativeOrder.fulfillment_status, 80) || null,
      production_date: safeText(nativeOrder.production_date, 40) || null,
      assigned_delivery_date: safeText(nativeOrder.assigned_delivery_date, 40) || null,
      selected_delivery_date: safeText(nativeOrder.selected_delivery_date, 40) || null,
    } : null,
    native_fulfillment_task: task ? {
      id: safeId(task.id, 120),
      status: safeText(task.status, 80) || null,
      delivery_status: safeText(task.delivery_status, 80) || null,
      production_status: safeText(task.production_status, 80) || null,
      production_date: safeText(task.production_date, 40) || null,
      delivery_date: safeText(task.delivery_date, 40) || null,
      scheduled_date: safeText(task.scheduled_date, 40) || null,
      assigned_delivery_date: safeText(task.assigned_delivery_date, 40) || null,
    } : null,
    production_batch_count: Array.isArray(batches) ? batches.length : 0,
    production_batch_dates: uniqueStrings((batches || []).map(batch => batch.production_date), 20),
    production_batch_statuses: uniqueStrings((batches || []).map(batch => batch.status), 20),
    batch_compliance_log_count: Array.isArray(complianceLogs) ? complianceLogs.length : 0,
    batch_compliance_log_dates: uniqueStrings((complianceLogs || []).map(log => log.date), 20),
  };
}

async function preflightTargetContext(base44) {
  const blockers = [];
  const warnings = [];
  const customerOrder = await findCustomerOrder(base44);
  const nativeOrder = await findNativeShopifyOrder(base44);
  const task = await findNativeFulfillmentTask(base44);
  const batches = [];
  const complianceLogs = [];

  if (!customerOrder) blockers.push('customer_app_order_not_found');
  if (!nativeOrder) blockers.push('native_shopify_order_not_found');
  if (!task) blockers.push('native_fulfillment_task_not_found');

  if (customerOrder) {
    if (safeId(customerOrder.id, 120) !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('customer_app_order_id_mismatch');
    if (normalizeText(customerOrder.order_number || customerOrder.shopify_order_number).replace(/^#/, '') !== TARGET_ORDER_NUMBER) blockers.push('customer_app_order_number_mismatch');
    if (normalizeLower(customerOrder.payment_status) !== 'paid') blockers.push('customer_app_order_not_paid');
    if (customerOrder.payment_captured !== true) blockers.push('customer_app_order_payment_not_captured');
    if (CUSTOMER_TERMINAL_STATUSES.has(normalizeLower(customerOrder.status))) blockers.push('customer_app_order_terminal_status');
    if (customerOrder.is_subscription === true || customerOrder.subscription_id) blockers.push('customer_app_subscription_order_blocked');
    if (normalizeLower(customerOrder.status) !== 'scheduled_for_juicing') warnings.push('customer_status_not_scheduled_for_juicing_but_status_unchanged');
  }

  if (nativeOrder) {
    const orderStatus = normalizeLower(nativeOrder.production_status);
    const fulfillmentStatus = normalizeLower(nativeOrder.fulfillment_status);
    const paymentStatus = normalizeLower(nativeOrder.payment_status || nativeOrder.financial_status || customerOrder?.payment_status);
    const type = targetOrderType(customerOrder, nativeOrder, task);
    const mode = targetFulfillmentMode(customerOrder, nativeOrder, task);
    if (safeId(nativeOrder.id, 120) !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('native_shopify_order_id_mismatch');
    if (normalizeText(nativeOrder.shopify_order_number || nativeOrder.order_number).replace(/^#/, '') !== TARGET_ORDER_NUMBER) blockers.push('native_shopify_order_number_mismatch');
    if (nativeOrder.base44_order_id && safeId(nativeOrder.base44_order_id, 120) !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('native_shopify_order_base44_order_mismatch');
    if (orderStatus !== 'bottled') blockers.push('native_shopify_order_not_bottled');
    if (['subscription', 'multi_delivery'].includes(type) || mode === 'multi_delivery' || nativeOrder.is_subscription === true || nativeOrder.subscription_parent_id) blockers.push('subscription_multi_delivery_schedule_exception_blocked');
    if (NATIVE_ORDER_CANCELLED_REFUNDED.has(orderStatus) || NATIVE_ORDER_CANCELLED_REFUNDED.has(paymentStatus) || ['cancelled', 'canceled'].includes(fulfillmentStatus)) blockers.push('native_order_cancelled_or_refunded');
  }

  if (task) {
    const taskStatus = normalizeLower(task.status);
    const productionStatus = normalizeLower(task.production_status);
    if (safeId(task.id, 120) !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('native_fulfillment_task_id_mismatch');
    if (normalizeText(task.order_number || task.shopify_order_number).replace(/^#/, '') !== TARGET_ORDER_NUMBER) blockers.push('native_fulfillment_task_order_number_mismatch');
    if (TASK_TERMINAL_STATUSES.has(taskStatus)) blockers.push('native_fulfillment_task_terminal_status');
    if (DELIVERY_ADVANCED_STATUSES.has(normalizeLower(task.delivery_status))) blockers.push('delivery_lifecycle_already_advanced');
    if (taskStatus !== 'packed') blockers.push('native_fulfillment_task_not_packed');
    if (productionStatus !== 'packed') blockers.push('native_fulfillment_task_production_status_not_packed');
  }

  for (const batchId of EXPECTED_BATCH_IDS) {
    const batch = await findProductionBatch(base44, batchId);
    if (!batch?.id) {
      blockers.push(`production_batch_not_found:${batchId}`);
      continue;
    }
    batches.push(batch);
    if (normalizeLower(batch.status) !== 'verified_logged') blockers.push(`production_batch_not_verified_logged:${batchId}`);
    if (batch.production_date !== EXPECTED_RECORDED_PRODUCTION_DATE) blockers.push(`production_batch_date_changed_unexpectedly:${batchId}`);
    const logs = await findComplianceLogsForBatch(base44, batch);
    complianceLogs.push(...logs);
    if (logs.length === 0) blockers.push(`batch_compliance_log_missing:${batchId}`);
    if (logs.some(log => log.date !== EXPECTED_RECORDED_PRODUCTION_DATE)) blockers.push(`batch_compliance_log_date_changed_unexpectedly:${batchId}`);
  }

  const staleState = hasDateOnlyStaleState({ customerOrder, nativeOrder, task });
  const correctedState = hasDateOnlyCorrectedState({ customerOrder, nativeOrder, task });
  if (!staleState && !correctedState && customerOrder && nativeOrder && task) blockers.push('current_recorded_dates_do_not_match_stale_or_corrected_contract');

  return {
    ready: blockers.length === 0,
    mode: correctedState ? 'already_satisfied' : staleState ? 'date_correction' : 'blocked',
    blockers: uniqueStrings(blockers),
    warnings: uniqueStrings(warnings),
    customerOrder,
    nativeOrder,
    task,
    batches,
    complianceLogs,
    staleState,
    correctedState,
    summary: summarizeContext({ customerOrder, nativeOrder, task, batches, complianceLogs }),
  };
}

function proposedFieldChanges() {
  return [
    { record_type: 'FulfillmentTask', record_id: TARGET_NATIVE_FULFILLMENT_TASK_ID, field: 'delivery_date', from: EXPECTED_RECORDED_DELIVERY_DATE, to: TARGET_ACTUAL_DELIVERY_DATE },
    { record_type: 'FulfillmentTask', record_id: TARGET_NATIVE_FULFILLMENT_TASK_ID, field: 'scheduled_date', from: EXPECTED_RECORDED_DELIVERY_DATE, to: TARGET_ACTUAL_DELIVERY_DATE },
    { record_type: 'FulfillmentTask', record_id: TARGET_NATIVE_FULFILLMENT_TASK_ID, field: 'assigned_delivery_date', from: EXPECTED_RECORDED_DELIVERY_DATE, to: TARGET_ACTUAL_DELIVERY_DATE },
    { record_type: 'FulfillmentTask', record_id: TARGET_NATIVE_FULFILLMENT_TASK_ID, field: 'production_date', from: EXPECTED_RECORDED_PRODUCTION_DATE, to: TARGET_ACTUAL_PRODUCTION_DATE },
    { record_type: 'Order', record_id: TARGET_CUSTOMER_APP_ORDER_ID, field: 'estimated_delivery_date', from: EXPECTED_RECORDED_DELIVERY_DATE, to: TARGET_ACTUAL_DELIVERY_DATE },
    { record_type: 'Order', record_id: TARGET_CUSTOMER_APP_ORDER_ID, field: 'assigned_delivery_date', from: EXPECTED_RECORDED_DELIVERY_DATE, to: TARGET_ACTUAL_DELIVERY_DATE },
    { record_type: 'Order', record_id: TARGET_CUSTOMER_APP_ORDER_ID, field: 'production_date', from: EXPECTED_RECORDED_PRODUCTION_DATE, to: TARGET_ACTUAL_PRODUCTION_DATE },
    { record_type: 'Order', record_id: TARGET_CUSTOMER_APP_ORDER_ID, field: 'assigned_production_day', from: EXPECTED_RECORDED_PRODUCTION_DATE, to: TARGET_ACTUAL_PRODUCTION_DATE },
    { record_type: 'ShopifyOrder', record_id: TARGET_NATIVE_SHOPIFY_ORDER_ID, field: 'assigned_delivery_date', from: EXPECTED_RECORDED_DELIVERY_DATE, to: TARGET_ACTUAL_DELIVERY_DATE },
    { record_type: 'ShopifyOrder', record_id: TARGET_NATIVE_SHOPIFY_ORDER_ID, field: 'selected_delivery_date', from: EXPECTED_RECORDED_DELIVERY_DATE, to: TARGET_ACTUAL_DELIVERY_DATE },
    { record_type: 'ShopifyOrder', record_id: TARGET_NATIVE_SHOPIFY_ORDER_ID, field: 'production_date', from: EXPECTED_RECORDED_PRODUCTION_DATE, to: TARGET_ACTUAL_PRODUCTION_DATE },
    { record_type: 'ShopifyOrder.fulfillments[0]', record_id: TARGET_NATIVE_SHOPIFY_ORDER_ID, field: 'production_date', from: EXPECTED_RECORDED_PRODUCTION_DATE, to: TARGET_ACTUAL_PRODUCTION_DATE },
    { record_type: 'ShopifyOrder.fulfillments[0]', record_id: TARGET_NATIVE_SHOPIFY_ORDER_ID, field: 'delivery_date', from: EXPECTED_RECORDED_DELIVERY_DATE, to: TARGET_ACTUAL_DELIVERY_DATE },
  ];
}

function buildLocalFreshSchedulePreview(preflight) {
  const alreadySatisfied = preflight.mode === 'already_satisfied';
  return {
    success: preflight.ready,
    dry_run: true,
    writes_performed: false,
    preview_source: 'local_preflight',
    order_number: TARGET_ORDER_NUMBER,
    correction_needed: preflight.mode === 'date_correction',
    correction_mode: REQUIRED_CORRECTION_MODE,
    proposed_dates: {
      actual_production_date: TARGET_ACTUAL_PRODUCTION_DATE,
      actual_delivery_date: TARGET_ACTUAL_DELIVERY_DATE,
    },
    window_update_status: 'not_updated_date_only',
    proposed_field_changes: alreadySatisfied ? [] : proposedFieldChanges(),
    records_not_updated: [
      { record_type: 'ProductionBatch', reason: 'verified_batches_keep_original_materialized_batch_ids_and_dates_in_first_correction', affected_count: preflight.batches.length },
      { record_type: 'BatchComplianceLog', reason: 'locked_compliance_logs_keep_original_log_date_in_first_correction', affected_count: preflight.complianceLogs.length },
      { record_type: 'Order.status', reason: 'customer_facing_status_held', affected_count: preflight.customerOrder ? 1 : 0 },
      { record_type: 'Notification', reason: 'notifications_held', affected_count: 0 },
      { record_type: 'DeliveryRouteProofDrop', reason: 'delivery_workflow_held', affected_count: 0 },
    ],
    customer_facing_impact: {
      customer_app_order_status_current: safeText(preflight.customerOrder?.status, 80) || null,
      customer_app_order_status_would_change: false,
      status_history_would_append: false,
      customer_status_held: true,
    },
    notification_impact: false,
    notification_preview: { notification_would_send: false, notification_held: true },
    delivery_workflow_impact: {
      delivery_status_would_change: false,
      out_for_delivery_would_mark: false,
      delivered_would_mark: false,
      proof_drop_route_would_change: false,
    },
    blockers: preflight.blockers,
    warnings: uniqueStrings([
      'delivery_window_not_updated',
      'notifications_held',
      'customer_status_held',
      'delivery_status_held',
      'global_schedule_logic_unchanged',
      ...(preflight.warnings || []),
    ]),
    next_action: alreadySatisfied ? 'schedule_exception_correction_already_satisfied' : 'approve_exact_date_only_schedule_correction',
    safety: safetyResult(),
    context_summary: preflight.summary,
  };
}

function validateFreshPreview(preview) {
  const blockers = [];
  if (!preview?.success) blockers.push('fresh_schedule_exception_preview_failed');
  if (preview?.dry_run !== true) blockers.push('fresh_schedule_exception_preview_not_dry_run');
  if (preview?.writes_performed !== false) blockers.push('fresh_schedule_exception_preview_writes_flag_not_false');
  if (preview?.order_number !== TARGET_ORDER_NUMBER) blockers.push('fresh_preview_order_number_mismatch');
  if (preview?.correction_needed !== true) blockers.push('fresh_preview_correction_not_needed');
  if (preview?.correction_mode !== REQUIRED_CORRECTION_MODE) blockers.push('fresh_preview_correction_mode_mismatch');
  if (preview?.proposed_dates?.actual_production_date !== TARGET_ACTUAL_PRODUCTION_DATE) blockers.push('fresh_preview_actual_production_date_mismatch');
  if (preview?.proposed_dates?.actual_delivery_date !== TARGET_ACTUAL_DELIVERY_DATE) blockers.push('fresh_preview_actual_delivery_date_mismatch');
  if (preview?.window_update_status !== 'not_updated_date_only') blockers.push('fresh_preview_delivery_window_update_projected');
  if (preview?.notification_impact !== false) blockers.push('fresh_preview_notification_impact_not_false');
  if (preview?.customer_facing_impact?.customer_app_order_status_would_change === true) blockers.push('fresh_preview_customer_status_change_projected');
  if (preview?.customer_facing_impact?.status_history_would_append === true) blockers.push('fresh_preview_status_history_append_projected');
  if (preview?.delivery_workflow_impact?.delivery_status_would_change === true) blockers.push('fresh_preview_delivery_status_change_projected');
  if (Array.isArray(preview?.blockers) && preview.blockers.length > 0) blockers.push('fresh_preview_blockers_present');
  const changes = Array.isArray(preview?.proposed_field_changes) ? preview.proposed_field_changes : [];
  if (changes.some(change => change.record_type === 'ProductionBatch')) blockers.push('fresh_preview_production_batch_date_change_projected');
  if (changes.some(change => change.record_type === 'BatchComplianceLog')) blockers.push('fresh_preview_batch_compliance_log_date_change_projected');
  if (preview?.safety?.writes_performed !== false) blockers.push('fresh_preview_safety_writes_not_false');
  return { ready: blockers.length === 0, blockers: uniqueStrings(blockers), warnings: uniqueStrings(preview?.warnings || []) };
}

function buildTaskPatch() {
  return {
    delivery_date: TARGET_ACTUAL_DELIVERY_DATE,
    scheduled_date: TARGET_ACTUAL_DELIVERY_DATE,
    assigned_delivery_date: TARGET_ACTUAL_DELIVERY_DATE,
    production_date: TARGET_ACTUAL_PRODUCTION_DATE,
  };
}

function buildCustomerOrderPatch() {
  return {
    estimated_delivery_date: TARGET_ACTUAL_DELIVERY_DATE,
    assigned_delivery_date: TARGET_ACTUAL_DELIVERY_DATE,
    production_date: TARGET_ACTUAL_PRODUCTION_DATE,
    assigned_production_day: TARGET_ACTUAL_PRODUCTION_DATE,
  };
}

function buildNativeOrderPatch(nativeOrder) {
  const patch = {
    assigned_delivery_date: TARGET_ACTUAL_DELIVERY_DATE,
    production_date: TARGET_ACTUAL_PRODUCTION_DATE,
  };
  if (Object.prototype.hasOwnProperty.call(nativeOrder || {}, 'selected_delivery_date')) patch.selected_delivery_date = TARGET_ACTUAL_DELIVERY_DATE;
  if (Array.isArray(nativeOrder?.fulfillments) && nativeOrder.fulfillments.length > 0) {
    patch.fulfillments = nativeOrder.fulfillments.map((fulfillment, index) => index === 0
      ? { ...fulfillment, production_date: TARGET_ACTUAL_PRODUCTION_DATE, delivery_date: TARGET_ACTUAL_DELIVERY_DATE }
      : { ...fulfillment });
  }
  return patch;
}

function validatePatches({ taskPatch, customerOrderPatch, nativeOrderPatch }) {
  const blockers = [];
  const taskAllowed = new Set(['delivery_date', 'scheduled_date', 'assigned_delivery_date', 'production_date']);
  const orderAllowed = new Set(['estimated_delivery_date', 'assigned_delivery_date', 'production_date', 'assigned_production_day']);
  const nativeAllowed = new Set(['assigned_delivery_date', 'selected_delivery_date', 'production_date', 'fulfillments']);
  for (const key of Object.keys(taskPatch || {})) if (!taskAllowed.has(key)) blockers.push(`unsupported_task_field:${key}`);
  for (const key of Object.keys(customerOrderPatch || {})) if (!orderAllowed.has(key)) blockers.push(`unsupported_customer_order_field:${key}`);
  for (const key of Object.keys(nativeOrderPatch || {})) if (!nativeAllowed.has(key)) blockers.push(`unsupported_native_shopify_order_field:${key}`);
  if (taskPatch.delivery_date !== TARGET_ACTUAL_DELIVERY_DATE || taskPatch.scheduled_date !== TARGET_ACTUAL_DELIVERY_DATE || taskPatch.assigned_delivery_date !== TARGET_ACTUAL_DELIVERY_DATE || taskPatch.production_date !== TARGET_ACTUAL_PRODUCTION_DATE) blockers.push('task_patch_dates_invalid');
  if (customerOrderPatch.estimated_delivery_date !== TARGET_ACTUAL_DELIVERY_DATE || customerOrderPatch.assigned_delivery_date !== TARGET_ACTUAL_DELIVERY_DATE || customerOrderPatch.production_date !== TARGET_ACTUAL_PRODUCTION_DATE || customerOrderPatch.assigned_production_day !== TARGET_ACTUAL_PRODUCTION_DATE) blockers.push('customer_order_patch_dates_invalid');
  if (nativeOrderPatch.assigned_delivery_date !== TARGET_ACTUAL_DELIVERY_DATE || nativeOrderPatch.production_date !== TARGET_ACTUAL_PRODUCTION_DATE) blockers.push('native_order_patch_dates_invalid');
  if ('delivery_status' in taskPatch || 'status' in taskPatch || 'production_status' in taskPatch || 'packed_at' in taskPatch) blockers.push('task_patch_contains_status_or_delivery_lifecycle_field');
  if ('status' in customerOrderPatch || 'status_history' in customerOrderPatch || 'delivery_status' in customerOrderPatch) blockers.push('customer_order_patch_contains_status_or_delivery_lifecycle_field');
  if ('production_status' in nativeOrderPatch || 'fulfillment_status' in nativeOrderPatch) blockers.push('native_order_patch_contains_status_field');
  return uniqueStrings(blockers);
}

async function applyScheduleCorrection({ base44, preflight }) {
  const taskPatch = buildTaskPatch();
  const customerOrderPatch = buildCustomerOrderPatch();
  const nativeOrderPatch = buildNativeOrderPatch(preflight.nativeOrder);
  const patchBlockers = validatePatches({ taskPatch, customerOrderPatch, nativeOrderPatch });
  if (patchBlockers.length > 0) {
    const error = new Error(`Schedule correction patch validation failed: ${patchBlockers.join(',')}`);
    error.code = 'schedule_correction_patch_invalid';
    error.blockers = patchBlockers;
    throw error;
  }
  const updates = [];
  const updatedTask = await base44.asServiceRole.entities.FulfillmentTask.update(TARGET_NATIVE_FULFILLMENT_TASK_ID, taskPatch);
  updates.push({ record_type: 'FulfillmentTask', record_id: TARGET_NATIVE_FULFILLMENT_TASK_ID, fields: Object.keys(taskPatch) });
  const updatedCustomerOrder = await base44.asServiceRole.entities.Order.update(TARGET_CUSTOMER_APP_ORDER_ID, customerOrderPatch);
  updates.push({ record_type: 'Order', record_id: TARGET_CUSTOMER_APP_ORDER_ID, fields: Object.keys(customerOrderPatch) });
  const updatedNativeOrder = await base44.asServiceRole.entities.ShopifyOrder.update(TARGET_NATIVE_SHOPIFY_ORDER_ID, nativeOrderPatch);
  updates.push({ record_type: 'ShopifyOrder', record_id: TARGET_NATIVE_SHOPIFY_ORDER_ID, fields: Object.keys(nativeOrderPatch) });
  return { updatedTask, updatedCustomerOrder, updatedNativeOrder, updates };
}

function buildSuccessResult({ requestId, updates, preview, skipped = false, idempotent = false, alreadySatisfied = false }) {
  return {
    success: true,
    skipped,
    idempotent,
    already_satisfied: alreadySatisfied,
    writes_performed: !skipped && !alreadySatisfied,
    command_type: COMMAND_TYPE,
    order_number: TARGET_ORDER_NUMBER,
    request_id: requestId,
    correction_mode: REQUIRED_CORRECTION_MODE,
    actual_production_date: TARGET_ACTUAL_PRODUCTION_DATE,
    actual_delivery_date: TARGET_ACTUAL_DELIVERY_DATE,
    leave_delivery_window_unchanged: true,
    notification_policy: REQUIRED_NOTIFICATION_POLICY,
    updated_record_count: skipped || alreadySatisfied ? 0 : 3,
    native_fulfillment_task_updated: !skipped && !alreadySatisfied,
    customer_app_order_updated: !skipped && !alreadySatisfied,
    native_shopify_order_updated: !skipped && !alreadySatisfied,
    updated_records: updates || [],
    preview_summary: preview ? {
      correction_needed: preview.correction_needed,
      correction_mode: preview.correction_mode,
      window_update_status: preview.window_update_status,
      blockers: preview.blockers || [],
      warnings: preview.warnings || [],
    } : null,
    safety: safetyResult({
      writes_performed: !skipped && !alreadySatisfied,
      customer_app_order_updated: !skipped && !alreadySatisfied,
      native_shopify_order_updated: !skipped && !alreadySatisfied,
      native_fulfillment_task_updated: !skipped && !alreadySatisfied,
    }),
  };
}

async function createCommandLog({ base44, status, idempotencyKey, requestId, user, result, errorCode, errorMessage }) {
  const now = new Date().toISOString();
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: COMMAND_TYPE,
    command_source: 'customer_app_native_admin',
    status,
    target_entity: 'schedule_exception',
    target_id: TARGET_ORDER_NUMBER,
    target_display_id: TARGET_ORDER_NUMBER,
    actor_email: safeActorEmail(user?.email) || null,
    actor_role: safeText(user?.role, 80) || null,
    actor_type: 'admin',
    payload: {
      exact_order_allowlist: true,
      order_number: TARGET_ORDER_NUMBER,
      customer_app_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
      native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
      native_fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
      current_recorded_production_date: EXPECTED_RECORDED_PRODUCTION_DATE,
      current_recorded_delivery_date: EXPECTED_RECORDED_DELIVERY_DATE,
      actual_production_date: TARGET_ACTUAL_PRODUCTION_DATE,
      actual_delivery_date: TARGET_ACTUAL_DELIVERY_DATE,
      correction_mode: REQUIRED_CORRECTION_MODE,
      leave_delivery_window_unchanged: true,
      notification_policy: REQUIRED_NOTIFICATION_POLICY,
      policy: REQUIRED_POLICY,
      preview_function: 'previewNativeScheduleExceptionCorrection',
    },
    result,
    error_code: errorCode || null,
    error_message: errorMessage ? safeText(errorMessage, 220) : null,
    idempotency_key: idempotencyKey,
    idempotent_skipped: status === 'skipped',
    request_id: requestId,
    submitted_at: now,
    completed_at: status === 'success' || status === 'failed' || status === 'skipped' ? now : null,
    notes: 'G32D-SCHED2 exact gated date-only schedule correction. Updates only approved Order, ShopifyOrder, and FulfillmentTask date metadata plus CommandLog. No status/status_history, delivery_status, ProductionBatch, BatchComplianceLog, notification, provider, payment, inventory, PO, sync, repair, replay, or Hub mutation.',
  });
}

async function createCommandLogSafe(args) {
  try {
    const commandLog = await createCommandLog(args);
    if (!commandLog?.id) return { ok: false, commandLog: null, error_code: 'schedule_correction_command_log_missing_id' };
    return { ok: true, commandLog };
  } catch (error) {
    return { ok: false, commandLog: null, error_code: error?.code || 'schedule_correction_command_log_create_failed', message: error?.message || 'CommandLog create failed' };
  }
}

async function updateCommandLog({ base44, commandLogId, status, result, errorCode, errorMessage }) {
  return base44.asServiceRole.entities.CommandLog.update(commandLogId, {
    status,
    result,
    error_code: errorCode || null,
    error_message: errorMessage ? safeText(errorMessage, 220) : null,
    idempotent_skipped: status === 'skipped',
    completed_at: new Date().toISOString(),
  });
}

async function updateCommandLogSafe(args) {
  try {
    return { ok: true, commandLog: await updateCommandLog(args) };
  } catch (error) {
    return { ok: false, error_code: error?.code || 'schedule_correction_command_log_update_failed', message: error?.message || 'CommandLog update failed' };
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return jsonResponse({ success: false, error_code: 'method_not_allowed', writes_performed: false }, 405);
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return jsonResponse({ success: false, error_code: 'malformed_json', writes_performed: false }, 400);
    const body = parsed.body || {};
    const badKey = unsupportedBodyKey(body);
    if (badKey) return jsonResponse({ success: false, error_code: 'unsupported_request_field', field: safeText(badKey, 80), writes_performed: false }, 400);
    if (body.mode && body.mode !== 'execute') return jsonResponse({ success: false, error_code: 'execute_mode_required', writes_performed: false }, 400);

    const base44 = createClientFromRequest(req);
    const auth = await requireAdmin(base44);
    if (!auth.ok) return jsonResponse({ success: false, error_code: auth.error_code, writes_performed: false }, auth.status);

    const lookup = getLookup(body);
    const inputBlockers = exactInputBlockers(lookup);
    if (inputBlockers.length > 0) return jsonResponse({ success: false, error_code: 'schedule_exception_input_validation_failed', blockers: inputBlockers, writes_performed: false }, 409);

    const gateError = gateFailure({ actorEmail: auth.user?.email, lookup });
    if (gateError) return jsonResponse({ success: false, error_code: gateError, writes_performed: false }, 409);

    const idempotencyKey = `${COMMAND_TYPE}:${TARGET_ORDER_NUMBER}:${lookup.requestId}`;
    const existingLogs = await findExistingCommandLog(base44, idempotencyKey);
    const successfulExisting = existingLogs.find(log => normalizeLower(log.status) === 'success');
    if (successfulExisting) {
      return jsonResponse(buildSuccessResult({ requestId: lookup.requestId, updates: [], preview: successfulExisting.result?.preview_summary || null, skipped: true, idempotent: true }));
    }

    const preflight = await preflightTargetContext(base44);
    const freshPreview = buildLocalFreshSchedulePreview(preflight);
    const previewValidation = validateFreshPreview(freshPreview);
    if (!preflight.ready || !previewValidation.ready) {
      const blockers = uniqueStrings([...(preflight.blockers || []), ...(previewValidation.blockers || [])]);
      const failedLog = await createCommandLogSafe({
        base44,
        status: 'failed',
        idempotencyKey,
        requestId: lookup.requestId,
        user: auth.user,
        result: { success: false, writes_performed: false, blockers, preview_summary: freshPreview },
        errorCode: 'schedule_exception_prewrite_validation_failed',
        errorMessage: blockers.join(', '),
      });
      return jsonResponse({ success: false, error_code: 'schedule_exception_prewrite_validation_failed', blockers, warnings: uniqueStrings([...(preflight.warnings || []), ...(previewValidation.warnings || [])]), writes_performed: false, command_log_created: failedLog.ok }, 409);
    }

    if (preflight.mode === 'already_satisfied') {
      return jsonResponse({ success: false, error_code: 'schedule_exception_already_corrected_with_different_request', writes_performed: false, blockers: ['schedule_exception_already_corrected_with_different_request'] }, 409);
    }

    const runningLog = await createCommandLogSafe({
      base44,
      status: 'running',
      idempotencyKey,
      requestId: lookup.requestId,
      user: auth.user,
      result: { success: false, writes_performed: false, preview_summary: freshPreview },
      errorCode: null,
      errorMessage: null,
    });
    if (!runningLog.ok) return jsonResponse({ success: false, error_code: runningLog.error_code, message: 'Schedule correction validation passed, but CommandLog creation failed before any date update.', writes_performed: false }, 500);

    let updateResult;
    try {
      updateResult = await applyScheduleCorrection({ base44, preflight });
    } catch (error) {
      const failureResult = { success: false, writes_performed: false, error_code: error?.code || 'schedule_exception_update_failed', message: safeText(error?.message, 220), partial_updates_unknown: true };
      await updateCommandLogSafe({ base44, commandLogId: runningLog.commandLog.id, status: 'failed', result: failureResult, errorCode: failureResult.error_code, errorMessage: failureResult.message });
      return jsonResponse(failureResult, 500);
    }

    const successResult = buildSuccessResult({ requestId: lookup.requestId, updates: updateResult.updates, preview: freshPreview });
    const finalize = await updateCommandLogSafe({ base44, commandLogId: runningLog.commandLog.id, status: 'success', result: successResult, errorCode: null, errorMessage: null });
    if (!finalize.ok) {
      return jsonResponse({ ...successResult, success: false, error_code: finalize.error_code, message: 'Schedule correction completed but CommandLog finalization failed. Reconciliation required before retry.', reconciliation_required: true }, 500);
    }

    return jsonResponse(successResult);
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] failed safely: ${error?.message || 'unknown error'}`);
    return jsonResponse({ success: false, error_code: 'native_schedule_exception_correction_failed_safely', message: 'Schedule exception correction failed safely.', writes_performed: false }, 500);
  }
});

export {
  gateFailure,
  exactInputBlockers,
  preflightTargetContext,
  buildLocalFreshSchedulePreview,
  validateFreshPreview,
  buildTaskPatch,
  buildCustomerOrderPatch,
  buildNativeOrderPatch,
  validatePatches,
  applyScheduleCorrection,
  getLookup,
  safetyResult,
  COMMAND_TYPE,
  CONFIRMATION_PHRASE,
};
