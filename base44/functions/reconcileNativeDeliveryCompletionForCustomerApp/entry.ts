import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const FUNCTION_NAME = 'reconcileNativeDeliveryCompletionForCustomerApp';
const COMMAND_TYPE = 'native_delivery_completion_reconciliation';
const ENABLE_FLAG = 'ENABLE_NATIVE_DELIVERY_COMPLETION_RECONCILIATION';
const KILL_SWITCH_FLAG = 'NATIVE_DELIVERY_COMPLETION_RECONCILIATION_KILL_SWITCH';
const ALLOWED_EMAILS_FLAG = 'NATIVE_DELIVERY_COMPLETION_RECONCILIATION_ALLOWED_EMAILS';
const ORDER_ALLOWLIST_FLAG = 'NATIVE_DELIVERY_COMPLETION_RECONCILIATION_ORDER_ALLOWLIST';
const CUSTOMER_ORDER_ALLOWLIST_FLAG = 'NATIVE_DELIVERY_COMPLETION_RECONCILIATION_CUSTOMER_ORDER_ALLOWLIST';
const TASK_ALLOWLIST_FLAG = 'NATIVE_DELIVERY_COMPLETION_RECONCILIATION_TASK_ALLOWLIST';
const SHOPIFY_ORDER_ALLOWLIST_FLAG = 'NATIVE_DELIVERY_COMPLETION_RECONCILIATION_SHOPIFY_ORDER_ALLOWLIST';
const POLICY_FLAG = 'NATIVE_DELIVERY_COMPLETION_RECONCILIATION_POLICY';
const REQUIRED_POLICY = 'DIRECT_DELIVERED_NO_NOTIFICATION';
const REQUIRED_NOTIFICATION_POLICY = 'NO_NOTIFICATION';
const REQUIRED_PROOF_DROP_POLICY = 'HELD_NOT_REQUIRED_FOR_RECONCILIATION';
const CONFIRMATION_PHRASE = 'reconcile_native_delivery_completion_no_notification';
const TARGET_ORDER_NUMBER = 'NV-MPZNKGNT';
const TARGET_CUSTOMER_APP_ORDER_ID = '6a219a3f4adcda5856c3d579';
const TARGET_NATIVE_SHOPIFY_ORDER_ID = '6a22ffda400eb806eb3ca945';
const TARGET_NATIVE_FULFILLMENT_TASK_ID = '6a22ffdaf675ea79e30575aa';
const DELIVERED_TASK_STATUS = 'delivered';
const DELIVERED_DELIVERY_STATUS = 'delivered';
const FULFILLED_ORDER_STATUS = 'fulfilled';
const MAX_TEXT = 180;
const PREVIEW_TIMEOUT_MS = 8000;

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
  'actual_delivered_at',
  'notification_policy',
  'proof_drop_policy',
  'correction_mode',
  'request_id',
]);

const FORBIDDEN_BODY_KEYS = new Set([
  'customer_status',
  'status_update',
  'target_status',
  'status_history',
  'append_status_history',
  'customer_app_order_update',
  'order_update',
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
  'proof',
  'proof_url',
  'proof_photo_url',
  'proof_file',
  'drop',
  'drop_location',
  'route',
  'route_id',
  'route_stop_sequence',
  'out_for_delivery',
  'out_for_delivery_at',
  'delivery_status_override',
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

function uniqueStrings(values, limit = 160) {
  return [...new Set((values || []).map(value => safeText(value, 180)).filter(Boolean))].slice(0, limit);
}

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
}

function safetyResult(overrides = {}) {
  return {
    writes_performed: false,
    native_fulfillment_task_updated: false,
    native_shopify_order_updated: false,
    customer_app_order_updated: false,
    status_history_appended: false,
    notifications_created: false,
    notifications_sent: false,
    message_logs_created: false,
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
    if (ALLOWED_BODY_KEYS.has(normalized)) continue;
    if (FORBIDDEN_BODY_KEYS.has(normalized)) return key;
    if (/(^|_)(raw|payload|provider|stripe|shopify|inventory|purchase|notification|message|sync|repair|replay|bulk|status|history|proof|route|drop|delivery|batch|compliance|customer|task)($|_)/i.test(normalized)) return key;
    return key;
  }
  return null;
}

function isIsoDateTime(value) {
  const text = normalizeText(value);
  return Boolean(text && !Number.isNaN(Date.parse(text)) && /\d{4}-\d{2}-\d{2}T/.test(text));
}

function canonicalIsoDateTime(value) {
  if (!isIsoDateTime(value)) return '';
  return new Date(value).toISOString();
}

function getPreviewSecret() {
  return normalizeText(Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET')) ||
    normalizeText(Deno.env.get('CUSTOMER_APP_SYNC_SECRET')) ||
    normalizeText(Deno.env.get('HUB_SYNC_SECRET'));
}

function shouldUseServicePreview() {
  return Deno.env.get('NATIVE_DELIVERY_COMPLETION_RECONCILIATION_USE_SERVICE_PREVIEW') === 'true';
}

function getLookup(body) {
  return {
    orderNumber: normalizeOrderNumber(body?.order_number || body?.shopify_order_number),
    customerAppOrderId: safeId(body?.customer_app_order_id || body?.base44_order_id || body?.order_id, 140),
    nativeShopifyOrderId: safeId(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id, 140),
    nativeFulfillmentTaskId: safeId(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id, 140),
    actualDeliveredAt: normalizeText(body?.actual_delivered_at),
    actualDeliveredAtIso: canonicalIsoDateTime(body?.actual_delivered_at),
    notificationPolicy: normalizeUpper(body?.notification_policy),
    proofDropPolicy: normalizeUpper(body?.proof_drop_policy),
    correctionMode: normalizeUpper(body?.correction_mode),
    requestId: safeId(body?.request_id, 180),
  };
}

function exactTargetBlockers(lookup) {
  const blockers = [];
  if (lookup.orderNumber !== TARGET_ORDER_NUMBER) blockers.push('target_order_number_mismatch');
  if (lookup.customerAppOrderId !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('target_customer_app_order_id_required');
  if (lookup.nativeShopifyOrderId !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('target_native_shopify_order_id_required');
  if (lookup.nativeFulfillmentTaskId !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('target_native_fulfillment_task_id_required');
  if (lookup.correctionMode !== REQUIRED_POLICY) blockers.push('direct_delivered_no_notification_mode_required');
  if (lookup.notificationPolicy !== REQUIRED_NOTIFICATION_POLICY) blockers.push('notification_policy_must_be_no_notification');
  if (lookup.proofDropPolicy !== REQUIRED_PROOF_DROP_POLICY) blockers.push('proof_drop_policy_must_be_held_not_required_for_reconciliation');
  if (!lookup.requestId) blockers.push('request_id_required');
  if (!lookup.actualDeliveredAt) blockers.push('actual_delivered_at_required');
  if (lookup.actualDeliveredAt && !lookup.actualDeliveredAtIso) blockers.push('actual_delivered_at_must_be_valid_iso_timestamp');
  return blockers;
}

function gateFailure({ actorEmail, lookup }) {
  if (Deno.env.get(KILL_SWITCH_FLAG) === 'true') return 'kill_switch_active';
  if (Deno.env.get(ENABLE_FLAG) !== 'true') return 'native_delivery_completion_reconciliation_disabled';
  if (normalizeText(Deno.env.get(POLICY_FLAG)) !== REQUIRED_POLICY) return 'direct_delivered_no_notification_policy_required';

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
  return rows[0] || null;
}

async function findNativeShopifyOrder(base44) {
  const byId = await getEntity(base44, 'ShopifyOrder', TARGET_NATIVE_SHOPIFY_ORDER_ID);
  if (byId?.id) return byId;
  const rows = await filterEntity(base44, 'ShopifyOrder', { shopify_order_number: TARGET_ORDER_NUMBER }, '-created_date', 5);
  return rows.find(row => safeId(row?.id, 140) === TARGET_NATIVE_SHOPIFY_ORDER_ID) || rows[0] || null;
}

async function findNativeFulfillmentTask(base44) {
  const byId = await getEntity(base44, 'FulfillmentTask', TARGET_NATIVE_FULFILLMENT_TASK_ID);
  if (byId?.id) return byId;
  const rows = await filterEntity(base44, 'FulfillmentTask', { id: TARGET_NATIVE_FULFILLMENT_TASK_ID }, '-created_date', 5);
  if (rows[0]?.id) return rows[0];
  const taskRows = await filterEntity(base44, 'FulfillmentTask', { fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID }, '-created_date', 5);
  return taskRows[0] || null;
}

async function findBatchByBatchId(base44, batchId) {
  return filterEntity(base44, 'ProductionBatch', { batch_id: batchId }, '-created_date', 5);
}

async function findComplianceLogsForBatch(base44, batch) {
  const byBatchId = batch?.batch_id ? await filterEntity(base44, 'BatchComplianceLog', { batch_id: batch.batch_id }, '-created_date', 20) : [];
  const bySourceId = batch?.id ? await filterEntity(base44, 'BatchComplianceLog', { source_production_batch_id: batch.id }, '-created_date', 20) : [];
  const byComplianceId = batch?.compliance_log_id ? await filterEntity(base44, 'BatchComplianceLog', { id: batch.compliance_log_id }, '-created_date', 20) : [];
  return [...new Map([...byBatchId, ...bySourceId, ...byComplianceId].map(row => [row.id || `${row.batch_id}:${row.source_production_batch_id}`, row])).values()];
}

function rowReferencesTarget(row) {
  const text = [
    row?.id,
    row?.order_number,
    row?.shopify_order_number,
    row?.base44_order_id,
    row?.order_id,
    row?.native_shopify_order_id,
    row?.shopify_order_id,
    row?.native_fulfillment_task_id,
    row?.fulfillment_task_id,
    JSON.stringify(row?.order_sources || []),
    JSON.stringify(row?.related_orders || []),
  ].map(value => normalizeText(value)).join(' ');
  return [TARGET_ORDER_NUMBER, TARGET_CUSTOMER_APP_ORDER_ID, TARGET_NATIVE_SHOPIFY_ORDER_ID, TARGET_NATIVE_FULFILLMENT_TASK_ID]
    .filter(Boolean)
    .some(value => text.includes(value));
}

function summarizeTask(task, before = {}) {
  return {
    native_fulfillment_task_id: safeId(task?.id, 140) || null,
    order_number: safeText(task?.order_number || task?.shopify_order_number, 80) || null,
    previous_status: safeText(before.status, 80) || null,
    previous_delivery_status: safeText(before.delivery_status, 80) || null,
    status: safeText(task?.status, 80) || null,
    delivery_status: safeText(task?.delivery_status, 80) || null,
    production_status: safeText(task?.production_status, 80) || null,
    delivered_at: safeText(task?.delivered_at, 100) || null,
    audit_trail_count: Array.isArray(task?.audit_trail) ? task.audit_trail.length : null,
  };
}

function summarizeNativeOrder(order, before = {}) {
  return {
    native_shopify_order_id: safeId(order?.id, 140) || null,
    order_number: safeText(normalizeOrderNumber(order?.shopify_order_number || order?.order_number), 80) || null,
    production_status: safeText(order?.production_status, 80) || null,
    previous_fulfillment_status: safeText(before.fulfillment_status, 80) || null,
    fulfillment_status: safeText(order?.fulfillment_status, 80) || null,
    audit_trail_count: Array.isArray(order?.audit_trail) ? order.audit_trail.length : null,
  };
}

async function preflightTargetContext(base44, lookup = {}) {
  const blockers = [];
  const warnings = [];
  const conflicts = [];
  const customerOrder = await findCustomerOrder(base44);
  const nativeOrder = await findNativeShopifyOrder(base44);
  const task = await findNativeFulfillmentTask(base44);
  const batches = [];
  const complianceLogs = [];

  if (!customerOrder) blockers.push('customer_app_order_not_found');
  if (!nativeOrder) blockers.push('native_shopify_order_not_found');
  if (!task) blockers.push('native_fulfillment_task_not_found');

  if (customerOrder) {
    if (safeId(customerOrder.id, 140) !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('customer_app_order_id_mismatch');
    if (normalizeOrderNumber(customerOrder.order_number || customerOrder.shopify_order_number) !== TARGET_ORDER_NUMBER) blockers.push('customer_app_order_number_mismatch');
    if (normalizeLower(customerOrder.payment_status || customerOrder.financial_status) !== 'paid') blockers.push('customer_app_order_not_paid');
    if (customerOrder.payment_captured !== true) blockers.push('customer_app_order_payment_not_captured');
  }

  if (nativeOrder) {
    const productionStatus = normalizeLower(nativeOrder.production_status);
    const fulfillmentStatus = normalizeLower(nativeOrder.fulfillment_status);
    if (safeId(nativeOrder.id, 140) !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('native_shopify_order_id_mismatch');
    if (normalizeOrderNumber(nativeOrder.shopify_order_number || nativeOrder.order_number) !== TARGET_ORDER_NUMBER) blockers.push('native_shopify_order_number_mismatch');
    if (!['bottled', 'fulfilled'].includes(productionStatus)) blockers.push('native_shopify_order_not_bottled');
    if (!['pending', 'fulfilled'].includes(fulfillmentStatus)) blockers.push('native_shopify_order_fulfillment_status_not_pending_or_fulfilled');
    if (['cancelled', 'canceled', 'refunded'].includes(productionStatus) || ['refunded', 'voided'].includes(normalizeLower(nativeOrder.payment_status || nativeOrder.financial_status))) blockers.push('native_shopify_order_cancelled_or_refunded');
  }

  if (task) {
    const taskStatus = normalizeLower(task.status);
    const deliveryStatus = normalizeLower(task.delivery_status);
    if (safeId(task.id, 140) !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('native_fulfillment_task_id_mismatch');
    if (!rowReferencesTarget(task)) blockers.push('native_fulfillment_task_order_context_mismatch');
    if (!['packed', 'delivered'].includes(taskStatus)) blockers.push('native_fulfillment_task_not_packed_or_delivered');
    if (!['pending', 'delivered'].includes(deliveryStatus)) blockers.push('native_delivery_status_not_pending_or_delivered');
    if (taskStatus === 'delivered' && deliveryStatus === 'delivered' && !task.delivered_at) blockers.push('delivered_task_missing_delivered_at');
    if (taskStatus === 'packed' && deliveryStatus !== 'pending') blockers.push('packed_task_delivery_status_not_pending');
    if (normalizeLower(task.production_status) !== 'packed') blockers.push('native_fulfillment_task_production_status_not_packed');
    if (!task.packed_at) warnings.push('native_fulfillment_task_missing_packed_at');
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
    if (normalizeLower(batch.status) !== 'verified_logged') batchBlockers.push('status_not_verified_logged');
    if (!rowReferencesTarget(batch)) batchBlockers.push('target_order_source_missing');
    if (!batch.verified_at || !batch.verified_by) batchBlockers.push('missing_verification_metadata');
    if (!batch.compliance_log_id) batchBlockers.push('missing_compliance_log_id');
    const logs = await findComplianceLogsForBatch(base44, batch);
    complianceLogs.push(...logs);
    if (logs.length === 0) batchBlockers.push('missing_batch_compliance_log');
    if (batchBlockers.length > 0) {
      blockers.push(`production_batch_context_blocked:${batchId}`);
      conflicts.push({ batch_id: batchId, status: safeText(batch.status, 80) || null, blockers: batchBlockers });
    }
  }

  const uniqueComplianceLogs = [...new Map(complianceLogs.map(row => [row.id || `${row.batch_id}:${row.source_production_batch_id}`, row])).values()];
  if (batches.length !== EXPECTED_BATCH_IDS.length) blockers.push('verified_production_batch_count_mismatch');
  if (uniqueComplianceLogs.length < EXPECTED_BATCH_IDS.length) blockers.push('batch_compliance_log_count_mismatch');

  if (blockers.length > 0) {
    return { ready: false, mode: 'blocked', blockers: uniqueStrings(blockers, 140), warnings: uniqueStrings(warnings, 120), conflicts, customerOrder, nativeOrder, task, batches, complianceLogs: uniqueComplianceLogs };
  }

  const taskStatus = normalizeLower(task.status);
  const deliveryStatus = normalizeLower(task.delivery_status);
  const nativeFulfillmentStatus = normalizeLower(nativeOrder.fulfillment_status);
  if (taskStatus === 'delivered' && deliveryStatus === 'delivered' && nativeFulfillmentStatus === 'fulfilled') {
    return { ready: true, mode: 'already_delivered', blockers: [], warnings: uniqueStrings([...warnings, 'native_delivery_completion_already_reconciled'], 120), conflicts: [], customerOrder, nativeOrder, task, batches, complianceLogs: uniqueComplianceLogs };
  }

  if (taskStatus !== 'packed' || deliveryStatus !== 'pending') {
    return { ready: false, mode: 'blocked', blockers: ['native_delivery_completion_state_not_reconcilable'], warnings: uniqueStrings(warnings, 120), conflicts, customerOrder, nativeOrder, task, batches, complianceLogs: uniqueComplianceLogs };
  }

  if (nativeFulfillmentStatus !== 'pending') {
    return { ready: false, mode: 'blocked', blockers: ['native_shopify_order_fulfillment_status_not_pending'], warnings: uniqueStrings(warnings, 120), conflicts, customerOrder, nativeOrder, task, batches, complianceLogs: uniqueComplianceLogs };
  }

  return { ready: true, mode: 'reconcile', blockers: [], warnings: uniqueStrings(warnings, 120), conflicts: [], customerOrder, nativeOrder, task, batches, complianceLogs: uniqueComplianceLogs };
}

function buildLocalFreshPreview(preflight, lookup) {
  const actualDeliveredAtProvided = Boolean(lookup.actualDeliveredAtIso);
  return {
    success: preflight.ready === true,
    dry_run: true,
    writes_performed: false,
    preview_source: 'local_preflight',
    order_number: TARGET_ORDER_NUMBER,
    correction_mode: REQUIRED_POLICY,
    notification_policy: REQUIRED_NOTIFICATION_POLICY,
    proof_drop_policy: REQUIRED_PROOF_DROP_POLICY,
    blockers: preflight.blockers || [],
    warnings: uniqueStrings([
      ...preflight.warnings,
      !actualDeliveredAtProvided ? 'delivered_timestamp_required_before_live_reconciliation' : null,
      'customer_status_update_held',
      'notifications_held',
      'proof_drop_held_not_required_for_reconciliation',
    ], 120),
    preview_rows: [
      {
        order_number: TARGET_ORDER_NUMBER,
        target_type: 'native_delivery_reconciliation',
        reconciliation_needed: preflight.mode !== 'already_delivered',
        delivered_reconciliation_needed: preflight.mode !== 'already_delivered',
        proposed_correction_mode: REQUIRED_POLICY,
        customer_app_order_present: Boolean(preflight.customerOrder?.id),
        native_shopify_order_present: Boolean(preflight.nativeOrder?.id),
        native_fulfillment_task_present: Boolean(preflight.task?.id),
        current_customer_order_status: safeText(preflight.customerOrder?.status, 80) || null,
        current_native_shopify_order_status: safeText(preflight.nativeOrder?.production_status, 80) || null,
        current_native_shopify_fulfillment_status: safeText(preflight.nativeOrder?.fulfillment_status, 80) || null,
        current_native_task_status: safeText(preflight.task?.status, 80) || null,
        current_native_delivery_status: safeText(preflight.task?.delivery_status, 80) || null,
        actual_delivered_at_required: !actualDeliveredAtProvided,
        proposed_field_changes: preflight.mode === 'reconcile' ? [
          { record: 'Native FulfillmentTask', id: TARGET_NATIVE_FULFILLMENT_TASK_ID, field: 'status', from: safeText(preflight.task?.status, 80) || null, to: DELIVERED_TASK_STATUS },
          { record: 'Native FulfillmentTask', id: TARGET_NATIVE_FULFILLMENT_TASK_ID, field: 'delivery_status', from: safeText(preflight.task?.delivery_status, 80) || null, to: DELIVERED_DELIVERY_STATUS },
          { record: 'Native FulfillmentTask', id: TARGET_NATIVE_FULFILLMENT_TASK_ID, field: 'delivered_at', from: preflight.task?.delivered_at || null, to: lookup.actualDeliveredAtIso || 'owner_approved_timestamp_required' },
          { record: 'Native ShopifyOrder', id: TARGET_NATIVE_SHOPIFY_ORDER_ID, field: 'fulfillment_status', from: safeText(preflight.nativeOrder?.fulfillment_status, 80) || null, to: FULFILLED_ORDER_STATUS },
        ] : [],
        records_that_would_be_created: [],
        records_that_would_be_updated: preflight.mode === 'reconcile' ? ['Native FulfillmentTask', 'Native ShopifyOrder'] : [],
        notification_impact: false,
        notification_would_send: false,
        proof_drop_impact: { proof_drop_required: false, policy: REQUIRED_PROOF_DROP_POLICY, would_write_proof_drop_fields: false },
        route_impact: { out_for_delivery_transition_proposed: false, direct_delivered_reconciliation: true, route_proof_drop_mutation: false },
        customer_status_impact: { customer_status_update_held: true, status_history_append_held: true, would_update_customer_status_in_this_correction: false },
        blockers: preflight.blockers || [],
        warnings: uniqueStrings(preflight.warnings || [], 120),
        next_action: preflight.mode === 'already_delivered' ? 'delivery_completion_already_reconciled' : 'approve_exact_direct_delivered_reconciliation_no_notification',
      },
    ],
    status_mapping_audit: {
      schema_audited: true,
      fulfillment_task: { status_value: DELIVERED_TASK_STATUS, delivery_status_value: DELIVERED_DELIVERY_STATUS, delivered_at_supported: true, sequence_required_before_direct_delivered: false },
      native_shopify_order: { fulfillment_status_value: FULFILLED_ORDER_STATUS, delivered_at_supported: true },
      customer_app_order: { status_update_held_for_separate_approval: true, status_history_supported: true },
      mapping_blockers: [],
    },
    safety: safetyResult(),
  };
}

async function fetchFreshPreview(base44, lookup) {
  const secret = getPreviewSecret();
  if (!secret) return { ok: false, status: 409, error_code: 'preview_secret_not_configured', data: null };
  try {
    const invokePromise = base44.asServiceRole.functions.invoke('previewNativeDeliveryCompletionReconciliation', {
      mode: 'dry_run',
      order_number: TARGET_ORDER_NUMBER,
      customer_app_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
      native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
      native_fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
      correction_mode: REQUIRED_POLICY,
      notification_policy: REQUIRED_NOTIFICATION_POLICY,
      proof_drop_policy: REQUIRED_PROOF_DROP_POLICY,
      actual_delivered_at: lookup.actualDeliveredAtIso,
      request_id: `${lookup.requestId || 'g32i'}:fresh_delivery_completion_preview`,
      _internal_secret: secret,
    });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error('Fresh delivery completion reconciliation preview invocation timed out');
        error.status = 504;
        error.code = 'native_delivery_completion_reconciliation_preview_timeout';
        reject(error);
      }, PREVIEW_TIMEOUT_MS);
    });
    const response = await Promise.race([invokePromise, timeoutPromise]);
    const data = response?.data || response;
    if (!data?.success) return { ok: false, status: 409, error_code: data?.error_code || 'native_delivery_completion_reconciliation_preview_failed', data };
    return { ok: true, status: 200, data };
  } catch (error) {
    const status = error?.response?.status || error?.status || 502;
    const data = error?.response?.data || error?.data || null;
    return { ok: false, status, error_code: data?.error_code || error?.code || 'native_delivery_completion_reconciliation_preview_failed', data };
  }
}

function validateFreshPreview(preview, lookup) {
  const blockers = [];
  const warnings = [];
  const row = Array.isArray(preview?.preview_rows) ? preview.preview_rows.find(item => normalizeOrderNumber(item?.order_number) === TARGET_ORDER_NUMBER) : null;
  const safety = preview?.safety || {};

  if (!preview?.success) blockers.push('fresh_delivery_completion_preview_failed');
  if (preview?.dry_run !== true) blockers.push('fresh_delivery_completion_preview_not_dry_run');
  if (preview?.writes_performed !== false) blockers.push('fresh_delivery_completion_preview_writes_flag_not_false');
  if (!row) blockers.push('fresh_delivery_completion_preview_missing_target_row');
  if (row) {
    if (row.proposed_correction_mode !== REQUIRED_POLICY) blockers.push('fresh_preview_correction_mode_mismatch');
    if (row.customer_app_order_present !== true) blockers.push('fresh_preview_missing_customer_app_order');
    if (row.native_shopify_order_present !== true) blockers.push('fresh_preview_missing_native_shopify_order');
    if (row.native_fulfillment_task_present !== true) blockers.push('fresh_preview_missing_native_fulfillment_task');
    if (row.reconciliation_needed !== true && row.delivered_reconciliation_needed !== true) blockers.push('fresh_preview_delivery_reconciliation_not_needed');
    if (row.actual_delivered_at_required === true) blockers.push('fresh_preview_delivered_timestamp_not_accepted');
    if (row.notification_would_send !== false || row.notification_impact !== false) blockers.push('fresh_preview_notification_projected');
    if (row.proof_drop_impact?.would_write_proof_drop_fields !== false) blockers.push('fresh_preview_proof_drop_write_projected');
    if (row.route_impact?.route_proof_drop_mutation !== false) blockers.push('fresh_preview_route_mutation_projected');
    if (row.customer_status_impact?.would_update_customer_status_in_this_correction !== false) blockers.push('fresh_preview_customer_status_update_projected');
    if (Array.isArray(row.blockers) && row.blockers.length > 0) blockers.push('fresh_preview_row_blockers_present');
    const changes = Array.isArray(row.proposed_field_changes) ? row.proposed_field_changes : [];
    const hasTaskDeliveredAt = changes.some(change => change.record === 'Native FulfillmentTask' && change.field === 'delivered_at' && change.to === lookup.actualDeliveredAtIso);
    if (!hasTaskDeliveredAt) warnings.push('fresh_preview_delivered_at_change_not_explicit');
  }
  if (Array.isArray(preview?.blockers) && preview.blockers.length > 0) blockers.push('fresh_preview_top_level_blockers_present');
  if (safety.customer_app_order_updated !== false || safety.status_history_appended !== false || safety.notifications_sent !== false || safety.proof_drop_route_fields_written !== false || safety.production_batch_updated !== false || safety.batch_compliance_log_updated !== false || safety.provider_calls_performed !== false || safety.shopify_api_calls_performed !== false || safety.stripe_calls_performed !== false || safety.sync_repair_replay_performed !== false) {
    blockers.push('fresh_preview_safety_flags_not_false');
  }

  return { ready: blockers.length === 0, blockers: uniqueStrings(blockers, 120), warnings: uniqueStrings(warnings, 80) };
}

function buildTaskPatch({ task, actualDeliveredAtIso, actorEmail, requestId, now }) {
  const existingTrail = Array.isArray(task.audit_trail) ? task.audit_trail.slice(-100) : [];
  return {
    status: DELIVERED_TASK_STATUS,
    delivery_status: DELIVERED_DELIVERY_STATUS,
    delivered_at: actualDeliveredAtIso,
    audit_trail: [
      ...existingTrail,
      {
        timestamp: now,
        action: 'native_delivery_completion_reconciliation',
        performed_by: safeActorEmail(actorEmail) || 'native_admin_actor',
        before: {
          status: safeText(task?.status, 80) || null,
          delivery_status: safeText(task?.delivery_status, 80) || null,
          production_status: safeText(task?.production_status, 80) || null,
          delivered_at: safeText(task?.delivered_at, 100) || null,
        },
        after: {
          status: DELIVERED_TASK_STATUS,
          delivery_status: DELIVERED_DELIVERY_STATUS,
          production_status: safeText(task?.production_status, 80) || null,
          delivered_at: actualDeliveredAtIso,
        },
        reason: 'G32I gated exact native direct delivered reconciliation command',
        request_id: safeId(requestId, 180) || null,
      },
    ],
  };
}

function buildNativeOrderPatch({ nativeOrder, actorEmail, requestId, now }) {
  const existingTrail = Array.isArray(nativeOrder.audit_trail) ? nativeOrder.audit_trail.slice(-100) : [];
  return {
    fulfillment_status: FULFILLED_ORDER_STATUS,
    audit_trail: [
      ...existingTrail,
      {
        timestamp: now,
        action: 'native_delivery_completion_reconciliation',
        performed_by: safeActorEmail(actorEmail) || 'native_admin_actor',
        before: {
          production_status: safeText(nativeOrder?.production_status, 80) || null,
          fulfillment_status: safeText(nativeOrder?.fulfillment_status, 80) || null,
        },
        after: {
          production_status: safeText(nativeOrder?.production_status, 80) || null,
          fulfillment_status: FULFILLED_ORDER_STATUS,
        },
        reason: 'G32I gated exact native direct delivered reconciliation command',
        request_id: safeId(requestId, 180) || null,
      },
    ],
  };
}

function validateTaskPatch(patch) {
  const blockers = [];
  const allowed = new Set(['status', 'delivery_status', 'delivered_at', 'audit_trail']);
  for (const key of Object.keys(patch || {})) if (!allowed.has(key)) blockers.push(`unapproved_fulfillment_task_delivery_field:${key}`);
  if (patch.status !== DELIVERED_TASK_STATUS) blockers.push('task_status_must_be_delivered');
  if (patch.delivery_status !== DELIVERED_DELIVERY_STATUS) blockers.push('task_delivery_status_must_be_delivered');
  if (!isIsoDateTime(patch.delivered_at)) blockers.push('task_delivered_at_must_be_iso_timestamp');
  if (!Array.isArray(patch.audit_trail) || patch.audit_trail.length === 0) blockers.push('task_audit_trail_required');
  if ('production_status' in patch || 'proof_url' in patch || 'proof_photo_url' in patch || 'drop_location' in patch || 'route_id' in patch || 'route_stop_sequence' in patch || 'out_for_delivery_at' in patch || 'status_history' in patch) blockers.push('forbidden_task_delivery_field_present');
  return blockers;
}

function validateNativeOrderPatch(patch) {
  const blockers = [];
  const allowed = new Set(['fulfillment_status', 'audit_trail']);
  for (const key of Object.keys(patch || {})) if (!allowed.has(key)) blockers.push(`unapproved_native_shopify_order_delivery_field:${key}`);
  if (patch.fulfillment_status !== FULFILLED_ORDER_STATUS) blockers.push('native_shopify_order_fulfillment_status_must_be_fulfilled');
  if (!Array.isArray(patch.audit_trail) || patch.audit_trail.length === 0) blockers.push('native_shopify_order_audit_trail_required');
  if ('production_status' in patch || 'delivered_at' in patch || 'status_history' in patch || 'customer_status' in patch || 'delivery_status' in patch || 'proof_url' in patch || 'route_id' in patch) blockers.push('forbidden_native_shopify_order_delivery_field_present');
  return blockers;
}

async function applyDeliveryCompletionUpdates({ base44, task, nativeOrder, actualDeliveredAtIso, actorEmail, requestId }) {
  const now = new Date().toISOString();
  const taskBefore = { status: task?.status, delivery_status: task?.delivery_status };
  const orderBefore = { fulfillment_status: nativeOrder?.fulfillment_status };
  const taskPatch = buildTaskPatch({ task, actualDeliveredAtIso, actorEmail, requestId, now });
  const orderPatch = buildNativeOrderPatch({ nativeOrder, actorEmail, requestId, now });
  const patchBlockers = [...validateTaskPatch(taskPatch), ...validateNativeOrderPatch(orderPatch)];
  if (patchBlockers.length > 0) {
    const error = new Error(`Delivery completion patch validation failed: ${patchBlockers.join(',')}`);
    error.code = 'delivery_completion_patch_invalid';
    throw error;
  }
  const updatedTask = await base44.asServiceRole.entities.FulfillmentTask.update(task.id, taskPatch);
  let updatedNativeOrder;
  try {
    updatedNativeOrder = await base44.asServiceRole.entities.ShopifyOrder.update(nativeOrder.id, orderPatch);
  } catch (error) {
    error.partialTaskUpdate = summarizeTask(updatedTask, taskBefore);
    throw error;
  }
  return {
    updated_task: summarizeTask(updatedTask, taskBefore),
    updated_native_shopify_order: summarizeNativeOrder(updatedNativeOrder, orderBefore),
  };
}

async function createCommandLog({ base44, status, idempotencyKey, requestId, user, result, errorCode, errorMessage }) {
  const now = new Date().toISOString();
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: COMMAND_TYPE,
    command_source: 'customer_app_native_admin',
    status,
    target_entity: 'FulfillmentTask',
    target_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
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
      correction_mode: REQUIRED_POLICY,
      notification_policy: REQUIRED_NOTIFICATION_POLICY,
      proof_drop_policy: REQUIRED_PROOF_DROP_POLICY,
      proposed_task_status: DELIVERED_TASK_STATUS,
      proposed_task_delivery_status: DELIVERED_DELIVERY_STATUS,
      proposed_native_shopify_order_fulfillment_status: FULFILLED_ORDER_STATUS,
      expected_batch_ids: EXPECTED_BATCH_IDS,
      preview_function: 'previewNativeDeliveryCompletionReconciliation',
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
    notes: 'G32I exact gated direct delivered reconciliation command. Updates only exact native FulfillmentTask delivery completion fields and exact native ShopifyOrder fulfillment_status. No Customer App Order, status_history, notifications, proof/drop/route, ProductionBatch, BatchComplianceLog, inventory, PurchaseOrder, provider, payment, sync, repair, replay, or Hub mutation.',
  });
}

async function createCommandLogSafe(args) {
  try {
    const commandLog = await createCommandLog(args);
    if (!commandLog?.id) return { ok: false, error_code: 'delivery_completion_command_log_missing_id', commandLog: null };
    return { ok: true, commandLog };
  } catch (error) {
    return { ok: false, error_code: error?.code || 'delivery_completion_command_log_create_failed', message: error?.message || 'CommandLog create failed', commandLog: null };
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
    return { ok: false, error_code: error?.code || 'delivery_completion_command_log_update_failed', message: error?.message || 'CommandLog update failed' };
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return jsonResponse({ success: false, error_code: 'method_not_allowed', message: 'POST required', writes_performed: false }, 405);

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
      return jsonResponse({ success: false, skipped: true, error_code: 'exact_delivery_completion_reconciliation_target_required', blockers: targetBlockers, writes_performed: false }, 409);
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
        native_fulfillment_task_updated: false,
        native_shopify_order_updated: false,
        duplicate_audit_entries_created: false,
        safety: safetyResult(),
      });
    }
    if (existingLog && existingLog.status === 'failed') {
      return jsonResponse({ success: false, skipped: true, error_code: 'previous_failed_request_id_not_reusable', request_id: lookup.requestId, idempotency_key: idempotencyKey, writes_performed: false }, 409);
    }

    const preflight = await preflightTargetContext(base44, lookup);
    if (!preflight.ready) {
      return jsonResponse({ success: false, skipped: true, error_code: 'delivery_completion_reconciliation_preflight_blocked', blockers: preflight.blockers, warnings: preflight.warnings, conflicts: preflight.conflicts, writes_performed: false }, 409);
    }

    if (preflight.mode === 'already_delivered') {
      const skippedLog = await createCommandLogSafe({
        base44,
        status: 'skipped',
        idempotencyKey,
        requestId: lookup.requestId,
        user: auth.user,
        result: {
          writes_performed: false,
          native_delivery_already_reconciled: true,
          native_fulfillment_task_updated: false,
          native_shopify_order_updated: false,
          duplicate_audit_entries_created: false,
          task: summarizeTask(preflight.task, preflight.task),
          native_shopify_order: summarizeNativeOrder(preflight.nativeOrder, preflight.nativeOrder),
          ...safetyResult(),
        },
      });
      if (!skippedLog.ok) {
        return jsonResponse({ success: false, skipped: true, error_code: skippedLog.error_code, message: 'Delivery reconciliation skipped but CommandLog creation failed safely.', writes_performed: false }, 500);
      }
      return jsonResponse({
        success: true,
        skipped: true,
        idempotent: false,
        reason: 'native_delivery_completion_already_reconciled',
        request_id: lookup.requestId,
        idempotency_key: idempotencyKey,
        command_log_id: safeId(skippedLog.commandLog?.id, 140) || null,
        order_number: TARGET_ORDER_NUMBER,
        native_fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
        native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
        writes_performed: false,
        native_fulfillment_task_updated: false,
        native_shopify_order_updated: false,
        duplicate_audit_entries_created: false,
        safety: safetyResult(),
      });
    }

    const freshPreview = shouldUseServicePreview()
      ? await fetchFreshPreview(base44, lookup)
      : { ok: true, status: 200, data: buildLocalFreshPreview(preflight, lookup) };
    if (!freshPreview.ok) {
      return jsonResponse({ success: false, skipped: true, error_code: freshPreview.error_code || 'native_delivery_completion_reconciliation_preview_failed', preview_status: freshPreview.status, writes_performed: false }, 409);
    }

    const validation = validateFreshPreview(freshPreview.data, lookup);
    if (!validation.ready) {
      return jsonResponse({ success: false, skipped: true, error_code: 'fresh_delivery_completion_reconciliation_preview_not_clean', blockers: validation.blockers, warnings: validation.warnings, writes_performed: false }, 409);
    }

    const commandLogCreate = await createCommandLogSafe({
      base44,
      status: 'running',
      idempotencyKey,
      requestId: lookup.requestId,
      user: auth.user,
      result: {
        writes_performed: false,
        projected_update_count: 2,
        projected_native_fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
        projected_native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
        projected_task_status_to: DELIVERED_TASK_STATUS,
        projected_task_delivery_status_to: DELIVERED_DELIVERY_STATUS,
        projected_native_shopify_order_fulfillment_status_to: FULFILLED_ORDER_STATUS,
        actual_delivered_at: lookup.actualDeliveredAtIso,
        verified_batch_count: preflight.batches.length,
        compliance_log_count: preflight.complianceLogs.length,
        customer_app_order_updated: false,
        status_history_appended: false,
        notifications_sent: false,
        proof_drop_route_fields_written: false,
        preview_source: freshPreview.data?.preview_source || 'service_preview',
      },
    });
    if (!commandLogCreate.ok) {
      return jsonResponse({ success: false, skipped: false, error_code: commandLogCreate.error_code, message: 'Delivery reconciliation validation passed, but CommandLog creation failed before any record update.', writes_performed: false }, 500);
    }
    const commandLog = commandLogCreate.commandLog;

    let updateResult = null;
    try {
      updateResult = await applyDeliveryCompletionUpdates({
        base44,
        task: preflight.task,
        nativeOrder: preflight.nativeOrder,
        actualDeliveredAtIso: lookup.actualDeliveredAtIso,
        actorEmail: auth.user?.email,
        requestId: lookup.requestId,
      });
    } catch (error) {
      const partialTaskUpdate = error?.partialTaskUpdate || null;
      await updateCommandLogSafe({
        base44,
        commandLogId: commandLog?.id,
        status: 'failed',
        result: {
          writes_performed: Boolean(partialTaskUpdate),
          native_fulfillment_task_updated: Boolean(partialTaskUpdate),
          native_shopify_order_updated: false,
          partial_task_update: partialTaskUpdate,
          reconciliation_required: Boolean(partialTaskUpdate),
          duplicate_audit_entries_created: false,
          ...safetyResult({ writes_performed: Boolean(partialTaskUpdate), native_fulfillment_task_updated: Boolean(partialTaskUpdate) }),
        },
        errorCode: error?.code || 'delivery_completion_reconciliation_write_failed',
        errorMessage: error?.message || 'Delivery completion reconciliation write failed',
      });
      return jsonResponse({
        success: false,
        skipped: false,
        error_code: error?.code || 'delivery_completion_reconciliation_write_failed',
        message: partialTaskUpdate ? 'Delivery reconciliation partially updated the FulfillmentTask; reconciliation is required before retry.' : 'Delivery reconciliation failed safely before record mutation.',
        writes_performed: Boolean(partialTaskUpdate),
        reconciliation_required: Boolean(partialTaskUpdate),
        partial_task_update: partialTaskUpdate,
      }, partialTaskUpdate ? 500 : 409);
    }

    const successResult = {
      writes_performed: true,
      native_fulfillment_task_updated: true,
      native_shopify_order_updated: true,
      customer_app_order_updated: false,
      status_history_appended: false,
      notifications_sent: false,
      proof_drop_route_fields_written: false,
      updated_task: updateResult.updated_task,
      updated_native_shopify_order: updateResult.updated_native_shopify_order,
      actual_delivered_at: lookup.actualDeliveredAtIso,
      verified_batch_count: preflight.batches.length,
      compliance_log_count: preflight.complianceLogs.length,
      ...safetyResult({ writes_performed: true, native_fulfillment_task_updated: true, native_shopify_order_updated: true }),
    };
    const successLogUpdate = await updateCommandLogSafe({ base44, commandLogId: commandLog?.id, status: 'success', result: successResult });
    if (!successLogUpdate.ok) {
      return jsonResponse({
        success: false,
        skipped: false,
        error_code: successLogUpdate.error_code,
        message: 'Delivery reconciliation updated native records, but CommandLog finalization failed. Reconciliation required before retry.',
        request_id: lookup.requestId,
        idempotency_key: idempotencyKey,
        command_log_id: safeId(commandLog?.id, 140) || null,
        order_number: TARGET_ORDER_NUMBER,
        native_fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
        native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
        writes_performed: true,
        reconciliation_required: true,
        native_fulfillment_task_updated: true,
        native_shopify_order_updated: true,
        safety: safetyResult({ writes_performed: true, native_fulfillment_task_updated: true, native_shopify_order_updated: true }),
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
      native_fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
      native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
      writes_performed: true,
      native_fulfillment_task_updated: true,
      native_shopify_order_updated: true,
      customer_app_order_updated: false,
      status_history_appended: false,
      notifications_sent: false,
      proof_drop_route_fields_written: false,
      updated_task: updateResult.updated_task,
      updated_native_shopify_order: updateResult.updated_native_shopify_order,
      actual_delivered_at: lookup.actualDeliveredAtIso,
      verified_batch_count: preflight.batches.length,
      compliance_log_count: preflight.complianceLogs.length,
      duplicate_audit_entries_created: false,
      provider_calls: false,
      stripe_calls: false,
      shopify_calls: false,
      sync_retry_repair_run: false,
      hub_records_updated: false,
      safety: safetyResult({ writes_performed: true, native_fulfillment_task_updated: true, native_shopify_order_updated: true }),
    });
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] failed safely: ${error?.message || 'unknown error'}`);
    return jsonResponse({
      success: false,
      error_code: 'native_delivery_completion_reconciliation_unhandled_error',
      message: 'Native delivery completion reconciliation failed safely before completing the command.',
      writes_performed: false,
      safety: safetyResult(),
    }, 500);
  }
});
