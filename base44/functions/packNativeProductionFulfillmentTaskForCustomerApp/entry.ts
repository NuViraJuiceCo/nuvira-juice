import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const COMMAND_TYPE = 'native_fulfillment_task_pack';
const FUNCTION_NAME = 'packNativeProductionFulfillmentTaskForCustomerApp';
const ENABLE_FLAG = 'ENABLE_NATIVE_FULFILLMENT_TASK_PACK';
const KILL_SWITCH_FLAG = 'NATIVE_FULFILLMENT_TASK_PACK_KILL_SWITCH';
const ALLOWED_EMAILS_FLAG = 'NATIVE_FULFILLMENT_TASK_PACK_ALLOWED_EMAILS';
const ORDER_ALLOWLIST_FLAG = 'NATIVE_FULFILLMENT_TASK_PACK_ORDER_ALLOWLIST';
const TASK_ALLOWLIST_FLAG = 'NATIVE_FULFILLMENT_TASK_PACK_TASK_ALLOWLIST';
const POLICY_FLAG = 'NATIVE_FULFILLMENT_TASK_PACK_POLICY';
const REQUIRED_POLICY = 'EXACT_VERIFIED_ORDER_TASK_ONLY';
const CONFIRMATION_PHRASE = 'pack_native_fulfillment_task_for_customer_app';
const TARGET_ORDER_NUMBER = 'NV-MPZNKGNT';
const TARGET_CUSTOMER_APP_ORDER_ID = '6a219a3f4adcda5856c3d579';
const TARGET_NATIVE_SHOPIFY_ORDER_ID = '6a22ffda400eb806eb3ca945';
const TARGET_NATIVE_FULFILLMENT_TASK_ID = '6a22ffdaf675ea79e30575aa';
const TARGET_PRODUCTION_DATE = '2026-06-05';
const TARGET_DELIVERY_DATE = '2026-06-06';
const MAX_TEXT = 180;
const MAX_ROWS = 30;

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

const PACKABLE_TASK_STATUSES = new Set(['pending', 'scheduled', 'assigned', 'in_production']);
const ALREADY_PACKED_TASK_STATUSES = new Set(['packed', 'bottled_packed']);
const TERMINAL_TASK_STATUSES = new Set(['delivered', 'unable_to_deliver', 'cancelled', 'canceled', 'out_for_delivery']);
const TERMINAL_DELIVERY_STATUSES = new Set(['out_for_delivery', 'delivered', 'unable_to_deliver', 'cancelled', 'canceled']);
const PACKED_TASK_STATUS = 'packed';
const PACKED_PRODUCTION_STATUS = 'packed';

const ALLOWED_BODY_KEYS = new Set([
  'mode',
  'confirmation',
  'order_number',
  'shopify_order_number',
  'customer_app_order_id',
  'base44_order_id',
  'native_shopify_order_id',
  'native_order_id',
  'shopify_order_id',
  'native_fulfillment_task_id',
  'fulfillment_task_id',
  'task_id',
  'production_date',
  'expected_production_date',
  'expected_delivery_date',
  'expected_task_status',
  'expected_status',
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
  'shopify_order_update',
  'native_shopify_order_update',
  'customer_app_order_update',
  'order_update',
  'status_history',
  'production_batch_update',
  'batch_update',
  'batch_ids',
  'production_batch_ids',
  'compliance',
  'compliance_log',
  'batch_compliance_log',
  'inventory_deduction',
  'deduct_inventory',
  'inventory_update',
  'purchase_order',
  'create_purchase_order',
  'pack_shopify_order',
  'bottle_order',
  'shopify_bottle',
  'task_status',
  'delivery_status',
  'production_status',
  'status_override',
  'customer_status',
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
  'send_notification',
  'notify_customer',
  'notification',
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

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function roundQuantity(value, decimals = 3) {
  const numberValue = safeNumber(value);
  if (numberValue === null) return null;
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
    if (/(^|_)(custom|raw|payload|provider|stripe|shopify|inventory|purchase|notification|sync|repair|replay|bulk|status|task|order|batch|recipe|route|proof|delivery|drop|compliance|customer)($|_)/i.test(normalized)) {
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

function getLookup(body) {
  return {
    orderNumber: normalizeText(body?.order_number || body?.shopify_order_number).replace(/^#/, ''),
    customerAppOrderId: safeId(body?.customer_app_order_id || body?.base44_order_id, 120),
    nativeShopifyOrderId: safeId(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id, 120),
    nativeFulfillmentTaskId: safeId(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id, 120),
    productionDate: normalizeText(body?.production_date || body?.expected_production_date),
    expectedDeliveryDate: normalizeText(body?.expected_delivery_date),
    expectedTaskStatus: normalizeLower(body?.expected_task_status || body?.expected_status || 'pending'),
    expectedPreviewHash: safeId(body?.expected_preview_hash, 180),
    requestId: safeId(body?.request_id, 160),
  };
}

function exactTargetBlockers(lookup) {
  const blockers = [];
  if (lookup.orderNumber !== TARGET_ORDER_NUMBER) blockers.push('target_order_number_mismatch');
  if (lookup.productionDate !== TARGET_PRODUCTION_DATE) blockers.push('target_production_date_mismatch');
  if (lookup.expectedDeliveryDate && lookup.expectedDeliveryDate !== TARGET_DELIVERY_DATE) blockers.push('expected_delivery_date_mismatch');
  if (lookup.expectedTaskStatus && !['pending', 'packed'].includes(lookup.expectedTaskStatus)) blockers.push('expected_task_status_must_be_pending_or_packed');
  if (lookup.customerAppOrderId && lookup.customerAppOrderId !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('target_customer_app_order_id_mismatch');
  if (lookup.nativeShopifyOrderId !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('target_native_shopify_order_id_required');
  if (lookup.nativeFulfillmentTaskId !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('target_native_fulfillment_task_id_required');
  return blockers;
}

function gateFailure({ actorEmail, lookup }) {
  if (Deno.env.get(KILL_SWITCH_FLAG) === 'true') return 'kill_switch_active';
  if (Deno.env.get(ENABLE_FLAG) !== 'true') return 'native_fulfillment_task_pack_disabled';
  if (normalizeText(Deno.env.get(POLICY_FLAG)) !== REQUIRED_POLICY) return 'exact_verified_order_task_policy_required';

  const allowedEmails = parseCsvSet(Deno.env.get(ALLOWED_EMAILS_FLAG) || '');
  if (allowedEmails.size === 0) return 'allowed_email_gate_required';
  if (!allowedEmails.has(normalizeLower(actorEmail))) return 'actor_email_not_allowlisted';

  const orderAllowlist = parseCsvSet(Deno.env.get(ORDER_ALLOWLIST_FLAG) || '');
  if (orderAllowlist.size === 0) return 'order_allowlist_required';
  const orderCandidates = [
    lookup.orderNumber,
    lookup.customerAppOrderId,
    lookup.nativeShopifyOrderId,
    lookup.nativeFulfillmentTaskId,
    TARGET_CUSTOMER_APP_ORDER_ID,
    TARGET_NATIVE_SHOPIFY_ORDER_ID,
    TARGET_NATIVE_FULFILLMENT_TASK_ID,
  ].map(normalizeLower).filter(Boolean);
  if (!orderCandidates.some(candidate => orderAllowlist.has(candidate))) return 'order_not_allowlisted';

  const taskAllowlist = parseCsvSet(Deno.env.get(TASK_ALLOWLIST_FLAG) || '');
  if (taskAllowlist.size === 0) return 'task_allowlist_required';
  if (!taskAllowlist.has(normalizeLower(TARGET_NATIVE_FULFILLMENT_TASK_ID))) return 'target_task_not_allowlisted';
  if (!taskAllowlist.has(normalizeLower(lookup.nativeFulfillmentTaskId))) return 'request_task_not_allowlisted';

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

async function fetchFreshPreview(base44, lookup) {
  const secret = expectedPreviewSecret();
  if (!secret) return { ok: false, status: 409, error_code: 'preview_secret_not_configured', data: null };

  try {
    const response = await base44.asServiceRole.functions.invoke('previewNativeProductionVerifyCascades', {
      mode: 'dry_run',
      order_number: TARGET_ORDER_NUMBER,
      customer_app_order_id: lookup.customerAppOrderId || TARGET_CUSTOMER_APP_ORDER_ID,
      native_shopify_order_id: lookup.nativeShopifyOrderId || TARGET_NATIVE_SHOPIFY_ORDER_ID,
      native_fulfillment_task_id: lookup.nativeFulfillmentTaskId || TARGET_NATIVE_FULFILLMENT_TASK_ID,
      production_date: TARGET_PRODUCTION_DATE,
      request_id: `${lookup.requestId || 'g31x'}:fresh_post_verify_cascade_preview`,
      _internal_secret: secret,
    });
    const data = response?.data || response;
    if (!data?.success) {
      return { ok: false, status: 409, error_code: data?.error_code || 'fresh_post_verify_cascade_preview_not_successful', data };
    }
    return { ok: true, status: 200, data };
  } catch (error) {
    const status = error?.response?.status || error?.status || 502;
    const data = error?.response?.data || error?.data || null;
    return { ok: false, status, error_code: data?.error_code || `fresh_post_verify_cascade_preview_invoke_${status}`, data };
  }
}

function validateFreshPreview(preview) {
  const blockers = [];
  const warnings = [];
  const taskPreview = preview?.task_pack_preview || {};
  const customerImpact = preview?.customer_status_impact_preview || {};
  const notificationImpact = preview?.notification_impact_preview || {};
  const safety = preview?.safety || {};

  if (!preview?.success) blockers.push('fresh_post_verify_cascade_preview_failed');
  if (preview?.dry_run !== true) blockers.push('fresh_post_verify_cascade_preview_not_dry_run');
  if (preview?.writes_performed !== false) blockers.push('fresh_post_verify_cascade_preview_writes_flag_not_false');
  if (preview?.order_number !== TARGET_ORDER_NUMBER) blockers.push('fresh_preview_order_number_mismatch');
  if (preview?.customer_app_order_id !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('fresh_preview_customer_app_order_id_mismatch');
  if (preview?.native_shopify_order_id !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('fresh_preview_native_shopify_order_id_mismatch');
  if (preview?.native_fulfillment_task_id !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('fresh_preview_native_fulfillment_task_id_mismatch');
  if (preview?.production_date !== TARGET_PRODUCTION_DATE) blockers.push('fresh_preview_production_date_mismatch');
  if (preview?.customer_app_order_present !== true) blockers.push('fresh_preview_missing_customer_app_order');
  if (preview?.native_shopify_order_present !== true) blockers.push('fresh_preview_missing_native_shopify_order');
  if (preview?.native_fulfillment_task_present !== true) blockers.push('fresh_preview_missing_native_fulfillment_task');
  if (safeNumber(preview?.verified_batch_count) !== EXPECTED_BATCH_IDS.length) blockers.push('fresh_preview_verified_batch_count_mismatch');
  if (safeNumber(preview?.production_batch_count) !== EXPECTED_BATCH_IDS.length) blockers.push('fresh_preview_production_batch_count_mismatch');
  if (safeNumber(preview?.compliance_log_count) !== EXPECTED_BATCH_IDS.length) blockers.push('fresh_preview_compliance_log_count_mismatch');
  if (preview?.task_pack_ready !== true) blockers.push('fresh_preview_task_pack_not_ready');
  if (taskPreview?.pack_cascade_allowed !== true) blockers.push('fresh_preview_task_pack_cascade_not_allowed');
  if (safeId(taskPreview?.task_id, 120) !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('fresh_preview_task_id_mismatch');
  if (taskPreview?.would_update_task_status !== true && normalizeLower(taskPreview?.current_task_status) !== PACKED_TASK_STATUS) blockers.push('fresh_preview_task_status_update_not_projected');
  if (taskPreview?.proposed_task_status && normalizeLower(taskPreview.proposed_task_status) !== PACKED_TASK_STATUS) blockers.push('fresh_preview_proposed_task_status_mismatch');
  if (taskPreview?.proposed_production_status && ![PACKED_PRODUCTION_STATUS, 'verified_logged'].includes(normalizeLower(taskPreview.proposed_production_status))) blockers.push('fresh_preview_proposed_production_status_mismatch');
  if (taskPreview?.would_update_delivery_status === true) blockers.push('fresh_preview_delivery_status_update_projected');
  if (Array.isArray(taskPreview?.blockers) && taskPreview.blockers.length > 0) blockers.push('fresh_preview_task_pack_blockers_present');
  if (Array.isArray(preview?.cascade_blockers) && preview.cascade_blockers.length > 0) blockers.push('fresh_preview_cascade_blockers_present');
  if (customerImpact?.would_touch_customer_app_order !== false) blockers.push('fresh_preview_customer_order_touch_projected');
  if (customerImpact?.customer_facing_status_changes_held !== true) blockers.push('fresh_preview_customer_status_not_held');
  if (notificationImpact?.would_send_notification !== false) blockers.push('fresh_preview_notification_projected');
  if (notificationImpact?.non_confirmation_notifications_disabled_until_separate_approval !== true) warnings.push('fresh_preview_notification_hold_flag_missing');
  if (safety.fulfillment_task_updated !== false || safety.native_shopify_order_updated !== false || safety.customer_app_order_updated !== false) blockers.push('fresh_preview_safety_write_flags_not_false');
  if (safety.notifications_sent !== false || safety.provider_calls_performed !== false || safety.shopify_api_calls_performed !== false || safety.stripe_calls_performed !== false) blockers.push('fresh_preview_safety_external_action_flags_not_false');

  return {
    ready: blockers.length === 0,
    blockers: uniqueStrings(blockers, 80),
    warnings: uniqueStrings(warnings.concat(preview?.cascade_warnings || []), 80),
  };
}

async function filterEntity(base44, entityName, filter, sort = '-created_date', limit = 10) {
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

function summarizeTask(task, previousStatus = null, skippedReason = null) {
  return {
    native_fulfillment_task_id: safeId(task?.id, 120) || null,
    fulfillment_task_id: safeId(task?.fulfillment_task_id, 180) || null,
    order_number: safeText(task?.order_number || task?.shopify_order_number, 120) || null,
    previous_status: safeText(previousStatus || task?.status, 80) || null,
    status: safeText(task?.status, 80) || null,
    production_status: safeText(task?.production_status, 80) || null,
    delivery_status: safeText(task?.delivery_status, 80) || null,
    packed_at: safeText(task?.packed_at, 80) || null,
    audit_trail_count: Array.isArray(task?.audit_trail) ? task.audit_trail.length : 0,
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
  const customerOrder = await findCustomerOrder(base44);
  const nativeOrder = await findNativeShopifyOrder(base44);
  const task = await findTargetTask(base44);
  const batches = [];
  const complianceLogs = [];
  const conflicts = [];

  if (!customerOrder) blockers.push('customer_app_order_not_found');
  if (!nativeOrder) blockers.push('native_shopify_order_not_found');
  if (!task) blockers.push('native_fulfillment_task_not_found');

  if (customerOrder) {
    if (safeId(customerOrder?.id, 120) !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('customer_app_order_id_mismatch');
    if (normalizeText(customerOrder?.order_number || customerOrder?.shopify_order_number).replace(/^#/, '') !== TARGET_ORDER_NUMBER) blockers.push('customer_app_order_number_mismatch');
    if (normalizeLower(customerOrder?.payment_status) !== 'paid') blockers.push('customer_app_order_not_paid');
    if (customerOrder?.payment_captured !== true) blockers.push('customer_app_order_payment_not_captured');
  }

  if (nativeOrder) {
    if (safeId(nativeOrder?.id, 120) !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('native_shopify_order_id_mismatch');
    if (normalizeText(nativeOrder?.shopify_order_number || nativeOrder?.order_number).replace(/^#/, '') !== TARGET_ORDER_NUMBER) blockers.push('native_shopify_order_number_mismatch');
    if (['cancelled', 'canceled', 'refunded'].includes(normalizeLower(nativeOrder?.production_status)) || ['refunded', 'voided'].includes(normalizeLower(nativeOrder?.payment_status || nativeOrder?.financial_status))) blockers.push('native_shopify_order_cancelled_or_refunded');
  }

  if (task) {
    const taskStatus = normalizeLower(task?.status);
    const productionStatus = normalizeLower(task?.production_status);
    if (safeId(task?.id, 120) !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('native_fulfillment_task_id_mismatch');
    if (!rowReferencesTarget(task)) blockers.push('native_fulfillment_task_order_context_mismatch');
    if (normalizeText(task?.production_date) !== TARGET_PRODUCTION_DATE) blockers.push('native_fulfillment_task_production_date_mismatch');
    if (TERMINAL_TASK_STATUSES.has(taskStatus)) blockers.push('native_fulfillment_task_terminal_or_delivery_advanced');
    if (task?.delivery_status && TERMINAL_DELIVERY_STATUSES.has(normalizeLower(task.delivery_status))) blockers.push('native_fulfillment_task_delivery_lifecycle_advanced');
    if (!PACKABLE_TASK_STATUSES.has(taskStatus) && !ALREADY_PACKED_TASK_STATUSES.has(taskStatus)) blockers.push('native_fulfillment_task_status_not_packable');
    if (ALREADY_PACKED_TASK_STATUSES.has(taskStatus) && !['packed', 'verified_logged', 'bottled_packed'].includes(productionStatus)) blockers.push('already_packed_task_production_status_incoherent');
    if (ALREADY_PACKED_TASK_STATUSES.has(taskStatus) && !task?.packed_at) blockers.push('already_packed_task_missing_packed_at');
    if (!Array.isArray(task?.items) || task.items.length === 0) warnings.push('native_fulfillment_task_items_missing_or_empty');
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

  if (blockers.length > 0) {
    return { ready: false, mode: 'blocked', blockers: uniqueStrings(blockers, 120), warnings: uniqueStrings(warnings, 120), conflicts, customerOrder, nativeOrder, task, batches, complianceLogs, rowToUpdate: null, alreadyPackedTask: null };
  }

  const taskStatus = normalizeLower(task?.status);
  if (PACKABLE_TASK_STATUSES.has(taskStatus)) {
    return { ready: true, mode: 'pack', blockers: [], warnings: uniqueStrings(warnings, 120), conflicts: [], customerOrder, nativeOrder, task, batches, complianceLogs, rowToUpdate: task, alreadyPackedTask: null };
  }
  if (ALREADY_PACKED_TASK_STATUSES.has(taskStatus)) {
    return { ready: true, mode: 'already_packed', blockers: [], warnings: uniqueStrings([...warnings, 'native_fulfillment_task_already_packed'], 120), conflicts: [], customerOrder, nativeOrder, task, batches, complianceLogs, rowToUpdate: null, alreadyPackedTask: task };
  }

  return { ready: false, mode: 'blocked', blockers: ['native_fulfillment_task_status_not_packable'], warnings: uniqueStrings(warnings, 120), conflicts: [], customerOrder, nativeOrder, task, batches, complianceLogs, rowToUpdate: null, alreadyPackedTask: null };
}

function buildPackPatch({ task, commandLogId, actorEmail, requestId, now }) {
  const existingTrail = Array.isArray(task.audit_trail) ? task.audit_trail.slice(-100) : [];
  return {
    status: PACKED_TASK_STATUS,
    production_status: PACKED_PRODUCTION_STATUS,
    packed_at: now,
    command_log_id: safeId(commandLogId, 120) || null,
    audit_trail: [
      ...existingTrail,
      {
        timestamp: now,
        action: 'fulfillment_task_pack',
        performed_by: safeActorEmail(actorEmail) || 'native_admin_actor',
        before: {
          status: safeText(task?.status, 80) || null,
          production_status: safeText(task?.production_status, 80) || null,
          delivery_status: safeText(task?.delivery_status, 80) || null,
        },
        after: {
          status: PACKED_TASK_STATUS,
          production_status: PACKED_PRODUCTION_STATUS,
          delivery_status: safeText(task?.delivery_status, 80) || null,
        },
        reason: 'G31X gated exact-order native FulfillmentTask Pack command',
        request_id: safeId(requestId, 160) || null,
        command_log_id: safeId(commandLogId, 120) || null,
      },
    ],
  };
}

function validatePackPatch(patch) {
  const blockers = [];
  const allowed = new Set(['status', 'production_status', 'packed_at', 'command_log_id', 'audit_trail']);
  for (const key of Object.keys(patch || {})) if (!allowed.has(key)) blockers.push(`unapproved_fulfillment_task_pack_field:${key}`);
  if (patch.status !== PACKED_TASK_STATUS) blockers.push('task_status_must_be_packed');
  if (patch.production_status !== PACKED_PRODUCTION_STATUS) blockers.push('task_production_status_must_be_packed');
  if (!safeText(patch.packed_at, 80)) blockers.push('packed_at_required');
  if (!Array.isArray(patch.audit_trail) || patch.audit_trail.length === 0) blockers.push('audit_trail_required');
  if ('delivery_status' in patch || 'delivered_at' in patch || 'out_for_delivery_at' in patch || 'route_id' in patch || 'route_stop_sequence' in patch || 'proof_url' in patch || 'drop_location' in patch || 'customer_status' in patch || 'status_history' in patch) {
    blockers.push('forbidden_delivery_customer_or_route_field_present');
  }
  return blockers;
}

async function updateFulfillmentTaskPack({ base44, task, commandLogId, actorEmail, requestId }) {
  const now = new Date().toISOString();
  const previousStatus = safeText(task?.status, 80) || null;
  const patch = buildPackPatch({ task, commandLogId, actorEmail, requestId, now });
  const patchBlockers = validatePackPatch(patch);
  if (patchBlockers.length > 0) {
    const error = new Error(`FulfillmentTask pack patch validation failed: ${patchBlockers.join(',')}`);
    error.code = 'fulfillment_task_pack_patch_invalid';
    throw error;
  }
  const updated = await base44.asServiceRole.entities.FulfillmentTask.update(task.id, patch);
  return summarizeTask(updated, previousStatus);
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
      exact_task_allowlist: true,
      order_number: TARGET_ORDER_NUMBER,
      customer_app_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
      native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
      native_fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
      production_date: TARGET_PRODUCTION_DATE,
      delivery_date: TARGET_DELIVERY_DATE,
      policy: REQUIRED_POLICY,
      expected_batch_ids: EXPECTED_BATCH_IDS,
      expected_products: EXPECTED_PRODUCTS,
      proposed_task_status: PACKED_TASK_STATUS,
      proposed_task_production_status: PACKED_PRODUCTION_STATUS,
      preview_function: 'previewNativeProductionVerifyCascades',
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
    notes: 'G31X exact gated native FulfillmentTask Pack command. Updates only exact native FulfillmentTask status/production_status/packed_at/audit metadata. No ShopifyOrder, Customer App Order, ProductionBatch, BatchComplianceLog, delivery/proof/drop/route, inventory, PurchaseOrder, provider, payment, notification, sync, repair, replay, or Hub mutation.',
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

function safetyResult(extra = {}) {
  return {
    native_fulfillment_task_updated: false,
    task_packed: false,
    native_shopify_order_updated: false,
    shopify_order_bottled: false,
    customer_app_order_updated: false,
    customer_facing_status_updated: false,
    customer_status_history_appended: false,
    notifications_sent: false,
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
      return jsonResponse({ success: false, skipped: true, error_code: 'exact_fulfillment_task_pack_target_required', blockers: targetBlockers, writes_performed: false }, 409);
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
        native_fulfillment_task_updated: false,
        duplicate_audit_entries_created: false,
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

    const freshPreview = await fetchFreshPreview(base44, lookup);
    if (!freshPreview.ok) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: freshPreview.error_code || 'fresh_post_verify_cascade_preview_failed',
        preview_status: freshPreview.status,
        writes_performed: false,
      }, freshPreview.status || 409);
    }

    const validation = validateFreshPreview(freshPreview.data);
    if (!validation.ready) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: 'fresh_post_verify_cascade_preview_not_clean',
        blockers: validation.blockers,
        warnings: validation.warnings,
        writes_performed: false,
      }, 409);
    }

    const preflight = await preflightTargetContext(base44);
    if (!preflight.ready) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: 'fulfillment_task_pack_preflight_blocked',
        blockers: preflight.blockers,
        warnings: preflight.warnings,
        conflicts: preflight.conflicts,
        writes_performed: false,
      }, 409);
    }

    if (preflight.mode === 'already_packed') {
      const commandLog = await createCommandLog({
        base44,
        status: 'skipped',
        idempotencyKey,
        requestId: lookup.requestId,
        user: auth.user,
        result: {
          writes_performed: false,
          native_fulfillment_task_updated: false,
          already_packed: true,
          task: summarizeTask(preflight.alreadyPackedTask, preflight.alreadyPackedTask?.status, 'already_packed'),
          duplicate_audit_entries_created: false,
          ...safetyResult(),
        },
      });
      return jsonResponse({
        success: true,
        skipped: true,
        idempotent: false,
        reason: 'native_fulfillment_task_already_packed',
        request_id: lookup.requestId,
        idempotency_key: idempotencyKey,
        command_log_id: safeId(commandLog?.id, 120) || null,
        order_number: TARGET_ORDER_NUMBER,
        native_fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
        writes_performed: false,
        native_fulfillment_task_updated: false,
        task: summarizeTask(preflight.alreadyPackedTask, preflight.alreadyPackedTask?.status, 'already_packed'),
        duplicate_audit_entries_created: false,
        safety: safetyResult(),
      });
    }

    const commandLog = await createCommandLog({
      base44,
      status: 'running',
      idempotencyKey,
      requestId: lookup.requestId,
      user: auth.user,
      result: {
        writes_performed: false,
        projected_update_count: 1,
        projected_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
        projected_status_to: PACKED_TASK_STATUS,
        projected_production_status_to: PACKED_PRODUCTION_STATUS,
        verified_batch_count: preflight.batches.length,
        compliance_log_count: preflight.complianceLogs.length,
        customer_app_order_updated: false,
        native_shopify_order_updated: false,
        notifications_sent: false,
      },
    });

    let updatedTask = null;
    try {
      updatedTask = await updateFulfillmentTaskPack({
        base44,
        task: preflight.rowToUpdate,
        commandLogId: commandLog?.id,
        actorEmail: auth.user?.email,
        requestId: lookup.requestId,
      });
    } catch (error) {
      await updateCommandLog({
        base44,
        commandLogId: commandLog?.id,
        status: 'failed',
        result: {
          writes_performed: false,
          native_fulfillment_task_updated: false,
          projected_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
          duplicate_audit_entries_created: false,
          ...safetyResult(),
        },
        errorCode: error?.code || 'fulfillment_task_pack_write_failed',
        errorMessage: error?.message || 'FulfillmentTask pack write failed',
      }).catch(() => null);
      return jsonResponse({
        success: false,
        skipped: false,
        error_code: error?.code || 'fulfillment_task_pack_write_failed',
        message: 'Native FulfillmentTask pack failed safely.',
        writes_performed: false,
      }, 500);
    }

    await updateCommandLog({
      base44,
      commandLogId: commandLog?.id,
      status: 'success',
      result: {
        writes_performed: true,
        native_fulfillment_task_updated: true,
        task_packed: true,
        updated_task: updatedTask,
        status_from: 'pending',
        status_to: PACKED_TASK_STATUS,
        production_status_to: PACKED_PRODUCTION_STATUS,
        verified_batch_count: preflight.batches.length,
        compliance_log_count: preflight.complianceLogs.length,
        ...safetyResult({ native_fulfillment_task_updated: true, task_packed: true }),
      },
    });

    return jsonResponse({
      success: true,
      skipped: false,
      idempotent: false,
      request_id: lookup.requestId,
      idempotency_key: idempotencyKey,
      command_log_id: safeId(commandLog?.id, 120) || null,
      order_number: TARGET_ORDER_NUMBER,
      native_fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
      writes_performed: true,
      native_fulfillment_task_updated: true,
      task_packed: true,
      updated_task: updatedTask,
      status_from: 'pending',
      status_to: PACKED_TASK_STATUS,
      production_status_to: PACKED_PRODUCTION_STATUS,
      verified_batch_count: preflight.batches.length,
      compliance_log_count: preflight.complianceLogs.length,
      duplicate_audit_entries_created: false,
      native_shopify_order_updated: false,
      customer_app_order_updated: false,
      customer_facing_status_updated: false,
      notifications_sent: false,
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
      safety: safetyResult({ native_fulfillment_task_updated: true, task_packed: true }),
    });
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] failed safely: ${error?.message || 'unknown error'}`);
    return jsonResponse({
      success: false,
      error_code: 'native_fulfillment_task_pack_failed',
      message: 'Native FulfillmentTask pack failed safely.',
      writes_performed: false,
    }, 500);
  }
});
