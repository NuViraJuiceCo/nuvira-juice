import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const FUNCTION_NAME = 'updateNativeCustomerOrderDeliveredStatusForCustomerApp';
const COMMAND_TYPE = 'native_customer_order_delivered_status_update';
const ENABLE_FLAG = 'ENABLE_NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE';
const KILL_SWITCH_FLAG = 'NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_KILL_SWITCH';
const ALLOWED_EMAILS_FLAG = 'NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_ALLOWED_EMAILS';
const ORDER_ALLOWLIST_FLAG = 'NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_ORDER_ALLOWLIST';
const CUSTOMER_ORDER_ALLOWLIST_FLAG = 'NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_CUSTOMER_ORDER_ALLOWLIST';
const TASK_ALLOWLIST_FLAG = 'NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_TASK_ALLOWLIST';
const SHOPIFY_ORDER_ALLOWLIST_FLAG = 'NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_SHOPIFY_ORDER_ALLOWLIST';
const POLICY_FLAG = 'NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_POLICY';
const REQUIRED_POLICY = 'DELIVERED_STATUS_ONLY_NO_NOTIFICATION';
const REQUIRED_NOTIFICATION_POLICY = 'NO_NOTIFICATION';
const REQUIRED_PROOF_DROP_POLICY = 'HELD_NOT_REQUIRED_FOR_RECONCILIATION';
const CONFIRMATION_PHRASE = 'update_customer_order_delivered_status_no_notification';
const TARGET_ORDER_NUMBER = 'NV-MPZNKGNT';
const TARGET_CUSTOMER_APP_ORDER_ID = '6a219a3f4adcda5856c3d579';
const TARGET_NATIVE_SHOPIFY_ORDER_ID = '6a22ffda400eb806eb3ca945';
const TARGET_NATIVE_FULFILLMENT_TASK_ID = '6a22ffdaf675ea79e30575aa';
const REQUIRED_CURRENT_STATUS = 'scheduled_for_juicing';
const TARGET_CUSTOMER_STATUS = 'delivered';
const NATIVE_TASK_DELIVERED_STATUS = 'delivered';
const NATIVE_TASK_DELIVERED_DELIVERY_STATUS = 'delivered';
const NATIVE_ORDER_FULFILLED_STATUS = 'fulfilled';
const NATIVE_ORDER_BOTTLED_STATUS = 'bottled';
const PREVIEW_TIMEOUT_MS = 8000;
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
  'customer_app_order_id',
  'base44_order_id',
  'order_id',
  'native_shopify_order_id',
  'native_order_id',
  'shopify_order_id',
  'native_fulfillment_task_id',
  'fulfillment_task_id',
  'task_id',
  'current_status_expected',
  'expected_current_status',
  'target_status',
  'expected_target_status',
  'status_mode',
  'correction_mode',
  'notification_policy',
  'proof_drop_policy',
  'request_id',
]);

const FORBIDDEN_BODY_KEYS = new Set([
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
  'delivery_status',
  'delivery_status_override',
  'delivered_at',
  'native_shopify_order_update',
  'shopify_order_update',
  'native_fulfillment_task_update',
  'fulfillment_task_update',
  'task_status_override',
  'fulfillment_status_override',
  'production_status_override',
  'production_batch_update',
  'batch_update',
  'batch_ids',
  'production_batch_ids',
  'batch_compliance_log',
  'compliance_log',
  'compliance',
  'inventory_deduction',
  'deduct_inventory',
  'purchase_order',
  'create_purchase_order',
  'sync',
  'repair',
  'replay',
  'shopify_api',
  'provider_id',
  'provider_ids',
  'stripe_id',
  'shopify_provider_id',
  'raw_payload',
  'payload',
  'raw_body',
  'raw_order',
  'raw_task',
  'raw_provider_payload',
  'raw_payment_payload',
  'headers',
  'authorization',
  'auth_header',
  'secret',
  'token',
  'api_key',
  'api-key',
  'bulk_order_ids',
  'bulk_task_ids',
  'task_ids',
]);

const CUSTOMER_ORDER_CANCELLED_REFUNDED = new Set(['cancelled', 'canceled', 'refunded', 'voided']);
const NATIVE_ORDER_CANCELLED_REFUNDED = new Set(['cancelled', 'canceled', 'refunded', 'voided']);
const STATUS_NOTIFICATION_SUBTYPES = Object.freeze({ delivered: 'delivered' });

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

function parseCsvSet(value) {
  return new Set(normalizeText(value).split(',').map(normalizeLower).filter(Boolean));
}

function uniqueStrings(values, limit = 120) {
  return [...new Set((values || []).map(value => safeText(value, 180)).filter(Boolean))].slice(0, limit);
}

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
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
    proof_drop_route_fields_written: false,
    production_batch_updated: false,
    batch_compliance_log_updated: false,
    order_sync_log_created: false,
    order_review_queue_created: false,
    safe_sync_parity_log_created: false,
    hub_records_updated: false,
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
    if (/(^|_)(raw|payload|provider|stripe|shopify|inventory|purchase|notification|message|sync|repair|replay|bulk|proof|route|drop|delivery|batch|compliance|task|native)($|_)/i.test(normalized)) return key;
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
  return Deno.env.get('NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_USE_SERVICE_PREVIEW') === 'true';
}

function getLookup(body) {
  return {
    orderNumber: normalizeOrderNumber(body?.order_number || body?.shopify_order_number),
    customerAppOrderId: safeId(body?.customer_app_order_id || body?.base44_order_id || body?.order_id, 140),
    nativeShopifyOrderId: safeId(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id, 140),
    nativeFulfillmentTaskId: safeId(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id, 140),
    expectedCurrentStatus: normalizeLower(body?.current_status_expected || body?.expected_current_status || REQUIRED_CURRENT_STATUS),
    targetStatus: normalizeLower(body?.target_status || body?.expected_target_status || TARGET_CUSTOMER_STATUS),
    statusMode: normalizeUpper(body?.status_mode || body?.correction_mode || REQUIRED_POLICY),
    notificationPolicy: normalizeUpper(body?.notification_policy),
    proofDropPolicy: normalizeUpper(body?.proof_drop_policy),
    requestId: safeId(body?.request_id, 180),
  };
}

function exactTargetBlockers(lookup) {
  const blockers = [];
  if (lookup.orderNumber !== TARGET_ORDER_NUMBER) blockers.push('target_order_number_mismatch');
  if (lookup.customerAppOrderId !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('target_customer_app_order_id_required');
  if (lookup.nativeShopifyOrderId !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('target_native_shopify_order_id_required');
  if (lookup.nativeFulfillmentTaskId !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('target_native_fulfillment_task_id_required');
  if (lookup.expectedCurrentStatus !== REQUIRED_CURRENT_STATUS) blockers.push('expected_current_status_must_be_scheduled_for_juicing');
  if (lookup.targetStatus !== TARGET_CUSTOMER_STATUS) blockers.push('target_status_must_be_delivered');
  if (lookup.statusMode !== REQUIRED_POLICY) blockers.push('delivered_status_only_no_notification_policy_required');
  if (lookup.notificationPolicy !== REQUIRED_NOTIFICATION_POLICY) blockers.push('notification_policy_must_be_no_notification');
  if (lookup.proofDropPolicy !== REQUIRED_PROOF_DROP_POLICY) blockers.push('proof_drop_policy_must_be_held_not_required_for_reconciliation');
  if (!lookup.requestId) blockers.push('request_id_required');
  return blockers;
}

function gateFailure({ actorEmail, lookup }) {
  if (Deno.env.get(KILL_SWITCH_FLAG) === 'true') return 'kill_switch_active';
  if (Deno.env.get(ENABLE_FLAG) !== 'true') return 'native_customer_delivered_status_update_disabled';
  if (normalizeText(Deno.env.get(POLICY_FLAG)) !== REQUIRED_POLICY) return 'delivered_status_only_no_notification_policy_required';

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
  return filterEntity(base44, 'CommandLog', { idempotency_key: idempotencyKey }, '-created_date', 3);
}

async function findCustomerOrder(base44) {
  const byId = await getEntity(base44, 'Order', TARGET_CUSTOMER_APP_ORDER_ID);
  if (byId?.id) return byId;
  const rows = await filterEntity(base44, 'Order', { order_number: TARGET_ORDER_NUMBER }, '-created_date', 5);
  return rows.find(row => safeId(row?.id, 140) === TARGET_CUSTOMER_APP_ORDER_ID) || rows[0] || null;
}

async function findNativeShopifyOrder(base44) {
  const byId = await getEntity(base44, 'ShopifyOrder', TARGET_NATIVE_SHOPIFY_ORDER_ID);
  if (byId?.id) return byId;
  const rows = await filterEntity(base44, 'ShopifyOrder', { shopify_order_number: TARGET_ORDER_NUMBER }, '-created_date', 5);
  return rows.find(row => safeId(row?.id, 140) === TARGET_NATIVE_SHOPIFY_ORDER_ID) || rows[0] || null;
}

async function findTargetTask(base44) {
  const byId = await getEntity(base44, 'FulfillmentTask', TARGET_NATIVE_FULFILLMENT_TASK_ID);
  if (byId?.id) return byId;
  const rows = await filterEntity(base44, 'FulfillmentTask', { order_number: TARGET_ORDER_NUMBER }, '-created_date', 20);
  return rows.find(row => safeId(row?.id, 140) === TARGET_NATIVE_FULFILLMENT_TASK_ID || safeId(row?.fulfillment_task_id, 140) === TARGET_NATIVE_FULFILLMENT_TASK_ID) || null;
}

async function findBatchByBatchId(base44, batchId) {
  return filterEntity(base44, 'ProductionBatch', { batch_id: batchId }, '-created_date', 5);
}

async function findComplianceLogsForBatch(base44, batch) {
  const byDisplayId = batch?.batch_id ? await filterEntity(base44, 'BatchComplianceLog', { batch_id: batch.batch_id }, '-created_date', 20) : [];
  const bySourceId = batch?.id ? await filterEntity(base44, 'BatchComplianceLog', { source_production_batch_id: batch.id }, '-created_date', 20) : [];
  return [...new Map([...byDisplayId, ...bySourceId].map(row => [row.id || `${row.batch_id}:${row.source_production_batch_id}`, row])).values()];
}

function orderType(customerOrder, nativeOrder, task) {
  if (nativeOrder?.is_subscription === true || customerOrder?.is_subscription === true || customerOrder?.subscription_id || nativeOrder?.subscription_parent_id || task?.customer_app_subscription_id || task?.stripe_subscription_id) return 'subscription';
  return normalizeLower(nativeOrder?.order_type || customerOrder?.order_type || task?.order_type || 'one_time') || 'one_time';
}

function fulfillmentMode(customerOrder, nativeOrder, task) {
  return normalizeLower(nativeOrder?.fulfillment_mode || customerOrder?.fulfillment_mode || task?.fulfillment_mode || task?.fulfillment_type || nativeOrder?.fulfillment_method || customerOrder?.fulfillment_type || 'single_delivery') || 'single_delivery';
}

function statusHistoryAlreadyContains(order, status) {
  return Array.isArray(order?.status_history) && order.status_history.some(entry => normalizeLower(entry?.status) === normalizeLower(status));
}

function statusMessage() {
  return 'Order delivered. Customer-facing delivered status reconciled without notification.';
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

  if (STATUS_NOTIFICATION_SUBTYPES[TARGET_CUSTOMER_STATUS]) warnings.push('delivered_notification_subtype_configured_but_not_called');

  if (customerOrder) {
    const status = normalizeLower(customerOrder.status);
    if (safeId(customerOrder.id, 140) !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('customer_app_order_id_mismatch');
    if (normalizeOrderNumber(customerOrder.order_number || customerOrder.shopify_order_number) !== TARGET_ORDER_NUMBER) blockers.push('customer_app_order_number_mismatch');
    if (normalizeLower(customerOrder.payment_status) !== 'paid') blockers.push('customer_app_order_not_paid');
    if (customerOrder.payment_captured !== true) blockers.push('customer_app_order_payment_not_captured');
    if (CUSTOMER_ORDER_CANCELLED_REFUNDED.has(status)) blockers.push('customer_app_order_cancelled_or_refunded');
    if (![REQUIRED_CURRENT_STATUS, TARGET_CUSTOMER_STATUS].includes(status)) blockers.push('customer_app_order_status_not_delivered_update_eligible');
    if (customerOrder.is_subscription === true || customerOrder.subscription_id) blockers.push('customer_app_subscription_order_blocked');
  }

  if (nativeOrder) {
    const productionStatus = normalizeLower(nativeOrder.production_status);
    const fulfillmentStatus = normalizeLower(nativeOrder.fulfillment_status);
    const paymentStatus = normalizeLower(nativeOrder.payment_status || nativeOrder.financial_status || customerOrder?.payment_status);
    const type = orderType(customerOrder, nativeOrder, task);
    const mode = fulfillmentMode(customerOrder, nativeOrder, task);
    if (safeId(nativeOrder.id, 140) !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('native_shopify_order_id_mismatch');
    if (normalizeOrderNumber(nativeOrder.shopify_order_number || nativeOrder.order_number) !== TARGET_ORDER_NUMBER) blockers.push('native_shopify_order_number_mismatch');
    if (nativeOrder.base44_order_id && safeId(nativeOrder.base44_order_id, 140) !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('native_shopify_order_base44_order_mismatch');
    if (productionStatus !== NATIVE_ORDER_BOTTLED_STATUS) blockers.push('native_shopify_order_not_bottled');
    if (fulfillmentStatus !== NATIVE_ORDER_FULFILLED_STATUS) blockers.push('native_shopify_order_not_fulfilled');
    if (NATIVE_ORDER_CANCELLED_REFUNDED.has(productionStatus) || NATIVE_ORDER_CANCELLED_REFUNDED.has(fulfillmentStatus) || NATIVE_ORDER_CANCELLED_REFUNDED.has(paymentStatus)) blockers.push('native_order_cancelled_or_refunded');
    if (['subscription', 'multi_delivery'].includes(type) || mode === 'multi_delivery') blockers.push('subscription_multi_delivery_delivered_status_blocked');
  }

  if (task) {
    if (safeId(task.id, 140) !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('native_fulfillment_task_id_mismatch');
    if (normalizeLower(task.status) !== NATIVE_TASK_DELIVERED_STATUS) blockers.push('native_fulfillment_task_not_delivered');
    if (normalizeLower(task.delivery_status) !== NATIVE_TASK_DELIVERED_DELIVERY_STATUS) blockers.push('native_fulfillment_task_delivery_status_not_delivered');
    if (!task.delivered_at) blockers.push('native_fulfillment_task_delivered_at_missing');
    if (normalizeLower(task.production_status) !== 'packed') warnings.push('native_fulfillment_task_production_status_not_packed');
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
    if (normalizeLower(batch.status) !== 'verified_logged') blockers.push(`production_batch_not_verified_logged:${batchId}`);
    const logs = await findComplianceLogsForBatch(base44, batch);
    complianceLogs.push(...logs);
    if (logs.length === 0) blockers.push(`missing_batch_compliance_log:${batchId}`);
  }

  const uniqueComplianceLogs = [...new Map(complianceLogs.map(row => [row.id || `${row.batch_id}:${row.source_production_batch_id}`, row])).values()];
  if (batches.length !== EXPECTED_BATCH_IDS.length) blockers.push('verified_production_batch_count_mismatch');
  if (uniqueComplianceLogs.length < EXPECTED_BATCH_IDS.length) blockers.push('batch_compliance_log_count_mismatch');

  if (blockers.length > 0) {
    return { ready: false, mode: 'blocked', blockers: uniqueStrings(blockers, 160), warnings: uniqueStrings(warnings, 120), conflicts, customerOrder, nativeOrder, task, batches, complianceLogs: uniqueComplianceLogs };
  }

  const currentStatus = normalizeLower(customerOrder.status);
  if (currentStatus === REQUIRED_CURRENT_STATUS) {
    return { ready: true, mode: 'status_update', blockers: [], warnings: uniqueStrings(warnings, 120), conflicts: [], customerOrder, nativeOrder, task, batches, complianceLogs: uniqueComplianceLogs };
  }
  if (currentStatus === TARGET_CUSTOMER_STATUS) {
    return { ready: true, mode: 'already_satisfied', blockers: [], warnings: uniqueStrings([...warnings, 'customer_status_already_delivered'], 120), conflicts: [], customerOrder, nativeOrder, task, batches, complianceLogs: uniqueComplianceLogs };
  }
  return { ready: false, mode: 'blocked', blockers: ['customer_app_order_status_not_delivered_update_eligible'], warnings: uniqueStrings(warnings, 120), conflicts: [], customerOrder, nativeOrder, task, batches, complianceLogs: uniqueComplianceLogs };
}

function buildLocalFreshPreview(preflight) {
  const customerOrder = preflight.customerOrder || {};
  const alreadySatisfied = preflight.mode === 'already_satisfied';
  const updateReady = preflight.ready === true && preflight.mode === 'status_update';
  return {
    success: preflight.ready === true,
    dry_run: true,
    writes_performed: false,
    preview_source: 'local_preflight',
    order_number: TARGET_ORDER_NUMBER,
    customer_app_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
    native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
    native_fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
    correction_mode: REQUIRED_POLICY,
    status_mode: REQUIRED_POLICY,
    current_customer_order_status: safeText(customerOrder.status, 80) || null,
    proposed_customer_order_status: TARGET_CUSTOMER_STATUS,
    status_update_ready: updateReady,
    status_update_held: true,
    customer_delivered_status_already_satisfied: alreadySatisfied,
    notification_policy: REQUIRED_NOTIFICATION_POLICY,
    notification_would_send: false,
    notification_held: true,
    proof_drop_policy: REQUIRED_PROOF_DROP_POLICY,
    proof_drop_required: false,
    production_verified: preflight.batches.length === EXPECTED_BATCH_IDS.length,
    production_batch_count: preflight.batches.length,
    verified_batch_count: preflight.batches.filter(batch => normalizeLower(batch.status) === 'verified_logged').length,
    compliance_log_count: preflight.complianceLogs.length,
    native_task_delivered: true,
    native_order_fulfilled: true,
    blockers: [],
    warnings: uniqueStrings([
      ...preflight.warnings,
      'customer_delivered_status_update_held_pending_explicit_approval',
      'notifications_held',
      'proof_drop_held_not_required_for_reconciliation',
    ], 120),
    next_action: updateReady ? 'plan_gated_customer_delivered_status_command' : 'customer_delivered_status_already_satisfied',
    status_history_preview: {
      would_append: updateReady,
      append_held: true,
      existing_status_history_count: Array.isArray(customerOrder.status_history) ? customerOrder.status_history.length : 0,
      already_has_delivered_entry: statusHistoryAlreadyContains(customerOrder, TARGET_CUSTOMER_STATUS),
      preview_entry: updateReady ? { status: TARGET_CUSTOMER_STATUS, timestamp: '[server timestamp if later approved]', message: statusMessage(), writes_performed: false } : null,
    },
    notification_preview: {
      notification_would_send: false,
      notification_held: true,
      delivered_notification_subtype_configured: true,
      automatic_notification_would_send_if_status_updated: false,
      channels: { in_app: false, push: false, sms: false, email: false },
    },
    safety: safetyResult(),
  };
}

async function fetchFreshPreview(base44, lookup) {
  const secret = getPreviewSecret();
  if (!secret) return { ok: false, status: 409, error_code: 'preview_secret_not_configured', data: null };
  try {
    const invokePromise = base44.asServiceRole.functions.invoke('previewNativeCustomerDeliveredStatusImpact', {
      mode: 'dry_run',
      order_number: TARGET_ORDER_NUMBER,
      customer_app_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
      native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
      native_fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
      status_mode: REQUIRED_POLICY,
      notification_policy: REQUIRED_NOTIFICATION_POLICY,
      proof_drop_policy: REQUIRED_PROOF_DROP_POLICY,
      request_id: `${lookup.requestId || 'g32k'}:fresh_delivered_customer_status_preview`,
      _internal_secret: secret,
    });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error('Fresh delivered customer status preview invocation timed out');
        error.status = 504;
        error.code = 'native_customer_delivered_status_preview_timeout';
        reject(error);
      }, PREVIEW_TIMEOUT_MS);
    });
    const response = await Promise.race([invokePromise, timeoutPromise]);
    const data = response?.data || response;
    if (!data?.success) return { ok: false, status: 409, error_code: data?.error_code || 'native_customer_delivered_status_preview_failed', data };
    return { ok: true, status: 200, data };
  } catch (error) {
    const status = error?.response?.status || error?.status || 502;
    const data = error?.response?.data || error?.data || null;
    return { ok: false, status, error_code: data?.error_code || error?.code || 'native_customer_delivered_status_preview_failed', data };
  }
}

function validateFreshPreview(preview) {
  const blockers = [];
  const warnings = [];
  const safety = preview?.safety || {};
  const notificationPreview = preview?.notification_preview || {};
  if (!preview?.success) blockers.push('fresh_delivered_status_preview_failed');
  if (preview?.dry_run !== true) blockers.push('fresh_delivered_status_preview_not_dry_run');
  if (preview?.writes_performed !== false) blockers.push('fresh_delivered_status_preview_writes_flag_not_false');
  if (preview?.order_number !== TARGET_ORDER_NUMBER) blockers.push('fresh_preview_order_number_mismatch');
  if (preview?.customer_app_order_id !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('fresh_preview_customer_app_order_id_mismatch');
  if (preview?.native_shopify_order_id !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('fresh_preview_native_shopify_order_id_mismatch');
  if (preview?.native_fulfillment_task_id !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('fresh_preview_native_fulfillment_task_id_mismatch');
  if (preview?.current_customer_order_status !== REQUIRED_CURRENT_STATUS) blockers.push('fresh_preview_current_status_mismatch');
  if (preview?.proposed_customer_order_status !== TARGET_CUSTOMER_STATUS) blockers.push('fresh_preview_target_status_mismatch');
  if (preview?.status_update_ready !== true) blockers.push('fresh_preview_status_update_not_ready');
  if (preview?.status_update_held !== true) blockers.push('fresh_preview_status_update_not_held');
  if (preview?.notification_would_send !== false) blockers.push('fresh_preview_notification_projected');
  if (preview?.notification_held !== true) blockers.push('fresh_preview_notification_not_held');
  if (preview?.proof_drop_required !== false) blockers.push('fresh_preview_proof_drop_required');
  if (preview?.native_task_delivered !== true) blockers.push('fresh_preview_native_task_not_delivered');
  if (preview?.native_order_fulfilled !== true) blockers.push('fresh_preview_native_order_not_fulfilled');
  if (Number(preview?.verified_batch_count) !== EXPECTED_BATCH_IDS.length) blockers.push('fresh_preview_verified_batch_count_mismatch');
  if (Number(preview?.production_batch_count) !== EXPECTED_BATCH_IDS.length) blockers.push('fresh_preview_production_batch_count_mismatch');
  if (Number(preview?.compliance_log_count) < EXPECTED_BATCH_IDS.length) blockers.push('fresh_preview_compliance_log_count_mismatch');
  if (Array.isArray(preview?.blockers) && preview.blockers.length > 0) blockers.push('fresh_preview_blockers_present');
  if (notificationPreview.automatic_notification_would_send_if_status_updated === true) blockers.push('fresh_preview_automatic_notification_would_send');
  if (safety.writes_performed !== false || safety.native_shopify_order_updated === true || safety.native_fulfillment_task_updated === true || safety.notifications_created === true || safety.notifications_sent === true || safety.proof_drop_route_fields_written === true || safety.provider_calls_performed === true || safety.shopify_api_calls_performed === true || safety.sync_repair_replay_performed === true) blockers.push('fresh_preview_side_effect_projected');
  if (Array.isArray(preview?.warnings)) warnings.push(...preview.warnings);
  return { ready: blockers.length === 0, blockers: uniqueStrings(blockers, 160), warnings: uniqueStrings(warnings, 120) };
}

function buildStatusPatch({ order, now }) {
  const existingHistory = Array.isArray(order.status_history) ? order.status_history.slice(-120) : [];
  return {
    status: TARGET_CUSTOMER_STATUS,
    status_history: [
      ...existingHistory,
      {
        status: TARGET_CUSTOMER_STATUS,
        timestamp: now,
        message: statusMessage(),
      },
    ],
  };
}

function validateStatusPatch(patch) {
  const blockers = [];
  const allowed = new Set(['status', 'status_history']);
  for (const key of Object.keys(patch || {})) if (!allowed.has(key)) blockers.push(`unapproved_customer_delivered_status_field:${key}`);
  if (patch.status !== TARGET_CUSTOMER_STATUS) blockers.push('customer_order_status_must_be_delivered');
  if (!Array.isArray(patch.status_history) || patch.status_history.length === 0) blockers.push('status_history_append_required');
  if ('delivery_status' in patch || 'fulfillment_status' in patch || 'production_status' in patch || 'delivered_at' in patch || 'proof_url' in patch || 'proof_photo_url' in patch || 'drop_location' in patch || 'route_id' in patch || 'notification' in patch || 'notified_at' in patch) blockers.push('forbidden_delivery_or_notification_field_present');
  return blockers;
}

function summarizeCustomerOrder(order, previousStatus = null, skippedReason = null) {
  return {
    customer_app_order_id: safeId(order?.id, 140) || null,
    order_number: safeText(order?.order_number || order?.shopify_order_number, 120) || null,
    previous_status: safeText(previousStatus || order?.status, 80) || null,
    status: safeText(order?.status, 80) || null,
    payment_status: safeText(order?.payment_status, 80) || null,
    payment_captured: order?.payment_captured === true,
    status_history_count: Array.isArray(order?.status_history) ? order.status_history.length : 0,
    skipped_reason: skippedReason,
  };
}

async function updateCustomerOrderDeliveredStatusOnly({ base44, order }) {
  const now = new Date().toISOString();
  const previousStatus = safeText(order?.status, 80) || null;
  const patch = buildStatusPatch({ order, now });
  const patchBlockers = validateStatusPatch(patch);
  if (patchBlockers.length > 0) {
    const error = new Error(`Customer delivered status patch validation failed: ${patchBlockers.join(',')}`);
    error.code = 'customer_delivered_status_patch_invalid';
    throw error;
  }
  const updated = await base44.asServiceRole.entities.Order.update(order.id, patch);
  return summarizeCustomerOrder(updated, previousStatus);
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
      order_number: TARGET_ORDER_NUMBER,
      customer_app_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
      native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
      native_fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
      policy: REQUIRED_POLICY,
      notification_policy: REQUIRED_NOTIFICATION_POLICY,
      proof_drop_policy: REQUIRED_PROOF_DROP_POLICY,
      current_status_expected: REQUIRED_CURRENT_STATUS,
      target_status: TARGET_CUSTOMER_STATUS,
      expected_batch_ids: EXPECTED_BATCH_IDS,
      preview_function: 'previewNativeCustomerDeliveredStatusImpact',
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
    notes: 'G32K exact gated Customer App Order delivered status command. Updates only exact Customer App Order status/status_history and CommandLog. No notifications, message logs, native ShopifyOrder, FulfillmentTask, ProductionBatch, BatchComplianceLog, proof/drop/route, provider, payment, sync, repair, replay, inventory, PurchaseOrder, or Hub mutation.',
  });
}

async function createCommandLogSafe(args) {
  try {
    const commandLog = await createCommandLog(args);
    if (!commandLog?.id) return { ok: false, error_code: 'customer_delivered_status_command_log_missing_id', commandLog: null };
    return { ok: true, commandLog };
  } catch (error) {
    return { ok: false, error_code: error?.code || 'customer_delivered_status_command_log_create_failed', message: error?.message || 'CommandLog create failed', commandLog: null };
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
    return { ok: false, error_code: error?.code || 'customer_delivered_status_command_log_update_failed', message: error?.message || 'CommandLog update failed' };
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
      return jsonResponse({ success: false, skipped: true, error_code: 'exact_customer_delivered_status_target_required', blockers: targetBlockers, writes_performed: false }, 409);
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
        customer_app_order_updated: false,
        duplicate_status_history_appended: false,
        duplicate_notifications_created: false,
        safety: safetyResult(),
      });
    }
    if (existingLog && existingLog.status === 'failed') {
      return jsonResponse({ success: false, skipped: true, error_code: 'previous_failed_request_id_not_reusable', request_id: lookup.requestId, idempotency_key: idempotencyKey, writes_performed: false }, 409);
    }

    const preflight = await preflightTargetContext(base44);
    if (!preflight.ready) {
      return jsonResponse({ success: false, skipped: true, error_code: 'customer_delivered_status_preflight_blocked', blockers: preflight.blockers, warnings: preflight.warnings, conflicts: preflight.conflicts, writes_performed: false }, 409);
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
          customer_order: summarizeCustomerOrder(preflight.customerOrder, preflight.customerOrder?.status, 'already_delivered'),
          duplicate_status_history_appended: false,
          notifications_created: false,
          notifications_sent: false,
          ...safetyResult(),
        },
      });
      if (!skippedLog.ok) {
        return jsonResponse({ success: false, skipped: true, error_code: skippedLog.error_code, message: 'Customer delivered status skipped but CommandLog creation failed safely.', writes_performed: false }, 500);
      }
      return jsonResponse({
        success: true,
        skipped: true,
        idempotent: false,
        reason: 'customer_status_already_delivered',
        request_id: lookup.requestId,
        idempotency_key: idempotencyKey,
        command_log_id: safeId(skippedLog.commandLog?.id, 140) || null,
        order_number: TARGET_ORDER_NUMBER,
        customer_app_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
        writes_performed: false,
        customer_app_order_updated: false,
        customer_facing_status_updated: false,
        customer_status_already_satisfied: true,
        status_history_appended: false,
        notifications_created: false,
        notifications_sent: false,
        customer_order: summarizeCustomerOrder(preflight.customerOrder, preflight.customerOrder?.status, 'already_delivered'),
        duplicate_status_history_appended: false,
        safety: safetyResult({ customer_status_already_satisfied: true }),
      });
    }

    const freshPreview = shouldUseServicePreview()
      ? await fetchFreshPreview(base44, lookup)
      : { ok: true, status: 200, data: buildLocalFreshPreview(preflight) };
    if (!freshPreview.ok) {
      return jsonResponse({ success: false, skipped: true, error_code: freshPreview.error_code || 'native_customer_delivered_status_preview_failed', preview_status: freshPreview.status, writes_performed: false }, 409);
    }
    const validation = validateFreshPreview(freshPreview.data);
    if (!validation.ready) {
      return jsonResponse({ success: false, skipped: true, error_code: 'fresh_customer_delivered_status_preview_not_clean', blockers: validation.blockers, warnings: validation.warnings, writes_performed: false }, 409);
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
        proof_drop_policy: REQUIRED_PROOF_DROP_POLICY,
        notifications_created: false,
        notifications_sent: false,
        message_logs_created: false,
        native_shopify_order_updated: false,
        native_fulfillment_task_updated: false,
        proof_drop_route_fields_written: false,
        verified_batch_count: preflight.batches.length,
        compliance_log_count: preflight.complianceLogs.length,
        preview_source: freshPreview.data?.preview_source || 'service_preview',
      },
    });
    if (!commandLogCreate.ok) {
      return jsonResponse({ success: false, skipped: false, error_code: commandLogCreate.error_code, message: 'Customer delivered status validation passed, but CommandLog creation failed before any order update.', writes_performed: false, customer_app_order_updated: false }, 500);
    }
    const commandLog = commandLogCreate.commandLog;

    let updatedOrder = null;
    try {
      updatedOrder = await updateCustomerOrderDeliveredStatusOnly({ base44, order: preflight.customerOrder });
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
        errorCode: error?.code || 'customer_delivered_status_update_write_failed',
        errorMessage: error?.message || 'Customer delivered status update write failed',
      });
      return jsonResponse({ success: false, skipped: false, error_code: error?.code || 'customer_delivered_status_update_write_failed', message: 'Customer delivered status update failed safely.', writes_performed: false }, 500);
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
        proof_drop_route_fields_written: false,
        verified_batch_count: preflight.batches.length,
        compliance_log_count: preflight.complianceLogs.length,
      },
    });
    if (!successLogUpdate.ok) {
      return jsonResponse({
        success: false,
        skipped: false,
        error_code: successLogUpdate.error_code,
        message: 'Customer App Order delivered status was updated, but CommandLog finalization failed. Reconciliation required before retry.',
        request_id: lookup.requestId,
        idempotency_key: idempotencyKey,
        command_log_id: safeId(commandLog?.id, 140) || null,
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
      command_log_id: safeId(commandLog?.id, 140) || null,
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
      proof_drop_policy: REQUIRED_PROOF_DROP_POLICY,
      notifications_created: false,
      notifications_sent: false,
      message_logs_created: false,
      native_shopify_order_updated: false,
      native_fulfillment_task_updated: false,
      proof_drop_route_fields_written: false,
      production_batches_updated: false,
      batch_compliance_logs_updated: false,
      inventory_deducted: false,
      purchase_order_created: false,
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
    return jsonResponse({ success: false, error_code: 'customer_delivered_status_update_failed', message: 'Customer delivered status update failed safely.', writes_performed: false }, 500);
  }
});
