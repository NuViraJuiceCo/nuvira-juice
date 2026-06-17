import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const COMMAND_TYPE = 'native_production_batch_start';
const FUNCTION_NAME = 'startNativeProductionBatchesForCustomerApp';
const ENABLE_FLAG = 'ENABLE_NATIVE_PRODUCTION_BATCH_START';
const KILL_SWITCH_FLAG = 'NATIVE_PRODUCTION_BATCH_START_KILL_SWITCH';
const ALLOWED_EMAILS_FLAG = 'NATIVE_PRODUCTION_BATCH_START_ALLOWED_EMAILS';
const ORDER_ALLOWLIST_FLAG = 'NATIVE_PRODUCTION_BATCH_START_ORDER_ALLOWLIST';
const BATCH_ALLOWLIST_FLAG = 'NATIVE_PRODUCTION_BATCH_START_BATCH_ALLOWLIST';
const POLICY_FLAG = 'NATIVE_PRODUCTION_BATCH_START_POLICY';
const REQUIRED_POLICY = 'EXACT_PREVIEW_PACKET_ONLY';
const REPAIR_SCOPE = 'REVERT_PREMATURE_START_TO_PLANNED';
const REPAIR_POLICY = 'EXACT_REVERT_PREMATURE_START_TO_PLANNED_NO_NOTIFICATION';
const CONFIRMATION_PHRASE = 'start_native_production_batches_for_customer_app';
const REPAIR_CONFIRMATION_PHRASE = 'revert_premature_production_start_to_planned_no_notification';
const REPAIR_COMMAND_TYPE = 'native_production_batch_start_revert';
const PREMATURE_ACTUAL_START_TIME = '2026-06-17T16:59:27.000Z';
const TARGET_ORDER_NUMBER = 'NV-MQHJR3V2';
const TARGET_CUSTOMER_APP_ORDER_ID = '6a321cbfd8d78863f15de956';
const TARGET_NATIVE_SHOPIFY_ORDER_ID = '6a321d38a3819cdd5cf89031';
const TARGET_NATIVE_FULFILLMENT_TASK_ID = '6a321d38071327f8218b958b';
const TARGET_PRODUCTION_DATE = '2026-06-19';
const TARGET_DELIVERY_DATE = '2026-06-20';
const MAX_TEXT = 180;
const MAX_ROWS = 20;

const EXPECTED_BATCH_PRODUCTS = Object.freeze({
  'NATIVE-NV-MQHJR3V2-2026-06-19-HYDRATION-SHOT': 'Hydration Shot',
  'NATIVE-NV-MQHJR3V2-2026-06-19-RADIANCE-SHOT': 'Radiance Shot',
});
const EXPECTED_BATCH_RECORD_IDS = Object.freeze({
  'NATIVE-NV-MQHJR3V2-2026-06-19-HYDRATION-SHOT': '6a32c1de2fd3943a9cf171a8',
  'NATIVE-NV-MQHJR3V2-2026-06-19-RADIANCE-SHOT': '6a32c1de87810fd871f131c5',
});
const EXPECTED_BATCH_UNITS = Object.freeze({
  'NATIVE-NV-MQHJR3V2-2026-06-19-HYDRATION-SHOT': 3,
  'NATIVE-NV-MQHJR3V2-2026-06-19-RADIANCE-SHOT': 3,
});
const EXPECTED_BATCH_IDS = Object.freeze(Object.keys(EXPECTED_BATCH_PRODUCTS).sort());
const EXPECTED_BATCH_RECORD_ID_VALUES = Object.freeze(Object.values(EXPECTED_BATCH_RECORD_IDS).sort());
const EXPECTED_PRODUCTS = Object.freeze(Object.values(EXPECTED_BATCH_PRODUCTS).sort());

const ALLOWED_BODY_KEYS = new Set([
  'mode',
  'confirmation',
  'order_number',
  'shopify_order_number',
  'production_date',
  'expected_production_date',
  'delivery_date',
  'expected_delivery_date',
  'expected_status',
  'batch_ids',
  'production_batch_ids',
  'selected_production_batch_ids',
  'actual_start_time',
  'repair_scope',
  'current_status',
  'target_status',
  'reason',
  'clear_actual_start_time',
  'clear_started_by',
  'clear_started_at',
  'notification_policy',
  'provider_call_policy',
  'hub_mutation_policy',
  'inventory_deduction_policy',
  'purchase_order_policy',
  'policy',
  'customer_app_order_id',
  'base44_order_id',
  'native_shopify_order_id',
  'native_order_id',
  'shopify_order_id',
  'native_fulfillment_task_id',
  'fulfillment_task_id',
  'task_id',
  'expected_preview_hash',
  'request_id',
]);

const FORBIDDEN_BODY_KEYS = new Set([
  'rows',
  'custom_rows',
  'product_rows',
  'products',
  'quantities',
  'batch_rows',
  'production_batches',
  'raw_payload',
  'payload',
  'raw_body',
  'raw_order',
  'order',
  'raw_recipe',
  'recipe',
  'raw_provider_payload',
  'raw_payment_payload',
  'actual_units',
  'actual_quantity_produced',
  'ingredients_used',
  'pH_result',
  'ph_result',
  'ph_value',
  'pH_passed_failed',
  'ph_passed_failed',
  'passed_failed',
  'compliance',
  'compliance_log',
  'batch_compliance_log',
  'inventory_deduction',
  'deduct_inventory',
  'purchase_order',
  'create_purchase_order',
  'complete_production',
  'verify_production',
  'send_notification',
  'notify_customer',
  'sync',
  'repair',
  'replay',
  'status_override',
  'customer_status',
  'task_status',
  'shopify_status',
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

function parseStringList(value) {
  if (Array.isArray(value)) return value.map(item => safeId(item, 180)).filter(Boolean);
  const text = normalizeText(value);
  if (!text) return [];
  return text.split(',').map(item => safeId(item.trim(), 180)).filter(Boolean);
}

function uniqueStrings(values, limit = MAX_ROWS) {
  return [...new Set((values || []).map(value => safeText(value, 160)).filter(Boolean))].slice(0, limit);
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
    if (/(^|_)(custom|raw|payload|provider|stripe|shopify|inventory|purchase|notification|sync|repair|replay|bulk|status|task|order|batch|recipe|route|proof|delivery|compliance|actual|ingredient|ph|qc)($|_)/i.test(normalized)) {
      return key;
    }
    return key;
  }
  return null;
}

function getLookup(body) {
  return {
    orderNumber: normalizeText(body?.order_number || body?.shopify_order_number).replace(/^#/, ''),
    customerAppOrderId: safeId(body?.customer_app_order_id || body?.base44_order_id, 120),
    nativeShopifyOrderId: safeId(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id, 120),
    nativeFulfillmentTaskId: safeId(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id, 120),
    productionDate: normalizeText(body?.production_date || body?.expected_production_date),
    expectedDeliveryDate: normalizeText(body?.expected_delivery_date || body?.delivery_date),
    expectedStatus: normalizeLower(body?.expected_status || 'planned'),
    actualStartTime: safeText(body?.actual_start_time, 80),
    repairScope: safeText(body?.repair_scope, 120),
    currentStatus: normalizeLower(body?.current_status),
    targetStatus: normalizeLower(body?.target_status),
    reason: safeText(body?.reason, 180),
    clearActualStartTime: body?.clear_actual_start_time === true || normalizeLower(body?.clear_actual_start_time) === 'true',
    clearStartedBy: body?.clear_started_by === true || normalizeLower(body?.clear_started_by) === 'true',
    clearStartedAt: body?.clear_started_at === true || normalizeLower(body?.clear_started_at) === 'true',
    expectedPreviewHash: safeId(body?.expected_preview_hash, 180),
    requestId: safeId(body?.request_id, 160),
    batchIds: parseStringList(body?.selected_production_batch_ids || body?.batch_ids || body?.production_batch_ids),
  };
}

function expectedPreviewSecret() {
  return normalizeText(Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET')) ||
    normalizeText(Deno.env.get('CUSTOMER_APP_SYNC_SECRET')) ||
    normalizeText(Deno.env.get('HUB_SYNC_SECRET'));
}

function sameStringArray(left, right) {
  return JSON.stringify([...(left || [])].sort()) === JSON.stringify([...(right || [])].sort());
}

function isExpectedBatchSelection(values) {
  return sameStringArray(values, EXPECTED_BATCH_IDS) || sameStringArray(values, EXPECTED_BATCH_RECORD_ID_VALUES);
}

function isRepairRequest(lookup) {
  return normalizeText(lookup?.repairScope) === REPAIR_SCOPE;
}

function requiredPolicyFor(lookup) {
  return isRepairRequest(lookup) ? REPAIR_POLICY : REQUIRED_POLICY;
}

function requiredConfirmationFor(lookup) {
  return isRepairRequest(lookup) ? REPAIR_CONFIRMATION_PHRASE : CONFIRMATION_PHRASE;
}

function commandTypeFor(lookup) {
  return isRepairRequest(lookup) ? REPAIR_COMMAND_TYPE : COMMAND_TYPE;
}

function validateExplicitPolicies(body, lookup = {}) {
  const blockers = [];
  const expectedPolicies = [
    ['policy', requiredPolicyFor(lookup), 'policy_mismatch'],
    ['inventory_deduction_policy', 'HELD', 'inventory_deduction_requested'],
    ['purchase_order_policy', 'HELD', 'purchase_order_requested'],
    ['notification_policy', 'NO_NOTIFICATION', 'notification_requested'],
    ['provider_call_policy', 'NO_PROVIDER_CALLS', 'provider_call_requested'],
    ['hub_mutation_policy', 'NO_HUB_MUTATION', 'hub_mutation_requested'],
  ];
  for (const [field, expected, blocker] of expectedPolicies) {
    const value = normalizeText(body?.[field]);
    if (value && value !== expected) blockers.push(blocker);
  }
  return blockers;
}

function exactTargetBlockers(lookup) {
  const blockers = [];
  if (lookup.orderNumber !== TARGET_ORDER_NUMBER) blockers.push('target_order_number_mismatch');
  if (lookup.productionDate !== TARGET_PRODUCTION_DATE) blockers.push('target_production_date_mismatch');
  if (lookup.expectedDeliveryDate && lookup.expectedDeliveryDate !== TARGET_DELIVERY_DATE) blockers.push('expected_delivery_date_mismatch');
  if (lookup.expectedStatus && lookup.expectedStatus !== 'planned') blockers.push('expected_status_must_be_planned');
  if (lookup.customerAppOrderId && lookup.customerAppOrderId !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('target_customer_app_order_id_mismatch');
  if (lookup.nativeShopifyOrderId && lookup.nativeShopifyOrderId !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('target_native_shopify_order_id_mismatch');
  if (lookup.nativeFulfillmentTaskId && lookup.nativeFulfillmentTaskId !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('target_native_fulfillment_task_id_mismatch');
  if (lookup.batchIds.length !== EXPECTED_BATCH_IDS.length || !isExpectedBatchSelection(lookup.batchIds)) {
    blockers.push('target_batch_ids_mismatch');
  }
  return blockers;
}

function exactRepairTargetBlockers(lookup) {
  const blockers = [];
  if (!isRepairRequest(lookup)) blockers.push('repair_scope_required');
  if (lookup.orderNumber !== TARGET_ORDER_NUMBER) blockers.push('target_order_number_mismatch');
  if (lookup.productionDate !== TARGET_PRODUCTION_DATE) blockers.push('target_production_date_mismatch');
  if (lookup.expectedDeliveryDate && lookup.expectedDeliveryDate !== TARGET_DELIVERY_DATE) blockers.push('expected_delivery_date_mismatch');
  if (lookup.currentStatus && lookup.currentStatus !== 'in_production') blockers.push('current_status_must_be_in_production');
  if (lookup.targetStatus && lookup.targetStatus !== 'planned') blockers.push('target_status_must_be_planned');
  if (lookup.customerAppOrderId && lookup.customerAppOrderId !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('target_customer_app_order_id_mismatch');
  if (lookup.nativeShopifyOrderId && lookup.nativeShopifyOrderId !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('target_native_shopify_order_id_mismatch');
  if (lookup.nativeFulfillmentTaskId && lookup.nativeFulfillmentTaskId !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('target_native_fulfillment_task_id_mismatch');
  if (lookup.batchIds.length !== EXPECTED_BATCH_IDS.length || !isExpectedBatchSelection(lookup.batchIds)) {
    blockers.push('target_batch_ids_mismatch');
  }
  if (!lookup.clearActualStartTime) blockers.push('clear_actual_start_time_required');
  if (!lookup.clearStartedBy) blockers.push('clear_started_by_required');
  return uniqueStrings(blockers, 80);
}

function gateFailure({ actorEmail, lookup }) {
  if (Deno.env.get(KILL_SWITCH_FLAG) === 'true') return 'kill_switch_active';
  if (Deno.env.get(ENABLE_FLAG) !== 'true') return 'native_production_batch_start_disabled';
  if (normalizeText(Deno.env.get(POLICY_FLAG)) !== requiredPolicyFor(lookup)) {
    return isRepairRequest(lookup) ? 'exact_revert_premature_start_policy_required' : 'exact_preview_packet_policy_required';
  }

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

  const batchAllowlist = parseCsvSet(Deno.env.get(BATCH_ALLOWLIST_FLAG) || '');
  if (batchAllowlist.size === 0) return 'batch_allowlist_required';
  const expectedBatchIdsAllowlisted = EXPECTED_BATCH_IDS.every(batchId => batchAllowlist.has(normalizeLower(batchId)));
  const expectedRecordIdsAllowlisted = EXPECTED_BATCH_RECORD_ID_VALUES.every(batchId => batchAllowlist.has(normalizeLower(batchId)));
  if (!expectedBatchIdsAllowlisted && !expectedRecordIdsAllowlisted) return 'target_batches_not_allowlisted';
  if (!lookup.batchIds.every(batchId => batchAllowlist.has(normalizeLower(batchId)))) return 'request_batch_not_allowlisted';

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
    const response = await base44.asServiceRole.functions.invoke('previewNativeProductionBatchLifecycle', {
      mode: 'dry_run',
      order_number: TARGET_ORDER_NUMBER,
      production_date: TARGET_PRODUCTION_DATE,
      batch_ids: EXPECTED_BATCH_IDS,
      customer_app_order_id: lookup.customerAppOrderId || TARGET_CUSTOMER_APP_ORDER_ID,
      native_shopify_order_id: lookup.nativeShopifyOrderId || TARGET_NATIVE_SHOPIFY_ORDER_ID,
      native_fulfillment_task_id: lookup.nativeFulfillmentTaskId || TARGET_NATIVE_FULFILLMENT_TASK_ID,
      request_id: `${lookup.requestId || 'g31o'}:fresh_lifecycle_preview`,
      _internal_secret: secret,
    });
    const data = response?.data || response;
    if (!data?.success) {
      return { ok: false, status: 409, error_code: data?.error_code || 'fresh_lifecycle_preview_not_successful', data };
    }
    return { ok: true, status: 200, data };
  } catch (error) {
    const status = error?.response?.status || error?.status || 502;
    const data = error?.response?.data || error?.data || null;
    return { ok: false, status, error_code: data?.error_code || `fresh_lifecycle_preview_invoke_${status}`, data };
  }
}

function targetBatchRows(preview) {
  const rows = Array.isArray(preview?.batch_lifecycle_rows) ? preview.batch_lifecycle_rows : [];
  return rows.filter(row => EXPECTED_BATCH_IDS.includes(safeId(row?.batch_id, 180)));
}

function validateFreshPreview(preview) {
  const blockers = [];
  const warnings = [];
  const rows = targetBatchRows(preview);
  const rowIds = rows.map(row => safeId(row?.batch_id, 180)).filter(Boolean);

  if (!preview?.success) blockers.push('fresh_lifecycle_preview_failed');
  if (preview?.dry_run !== true) blockers.push('fresh_lifecycle_preview_not_dry_run');
  if (preview?.writes_performed !== false) blockers.push('fresh_lifecycle_preview_writes_flag_not_false');
  if (preview?.order_number !== TARGET_ORDER_NUMBER) blockers.push('fresh_lifecycle_preview_target_order_mismatch');
  if (preview?.customer_app_order_id !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('fresh_lifecycle_preview_customer_app_order_id_mismatch');
  if (preview?.native_shopify_order_id !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('fresh_lifecycle_preview_native_shopify_order_id_mismatch');
  if (preview?.native_fulfillment_task_id !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('fresh_lifecycle_preview_native_task_id_mismatch');
  if (preview?.payment_status !== 'paid') blockers.push('fresh_lifecycle_preview_order_not_paid');
  if (preview?.payment_captured !== true) blockers.push('fresh_lifecycle_preview_payment_not_captured');
  if (preview?.production_date !== TARGET_PRODUCTION_DATE) blockers.push('fresh_lifecycle_preview_production_date_mismatch');
  if (preview?.native_shopify_order_present !== true) blockers.push('fresh_lifecycle_preview_missing_native_shopify_order');
  if (preview?.native_fulfillment_task_present !== true) blockers.push('fresh_lifecycle_preview_missing_native_fulfillment_task');
  if (Array.isArray(preview?.blockers) && preview.blockers.length > 0) blockers.push('fresh_lifecycle_preview_contains_blockers');
  if (safeNumber(preview?.batch_count) !== EXPECTED_BATCH_IDS.length) blockers.push('unexpected_lifecycle_batch_count');
  if (safeNumber(preview?.start_preview?.ready_count) !== EXPECTED_BATCH_IDS.length) blockers.push('unexpected_start_ready_count');
  if (safeNumber(preview?.complete_preview?.ready_count) !== 0) warnings.push('complete_ready_count_unexpected_nonzero');
  if (safeNumber(preview?.verify_preview?.ready_count) !== 0) warnings.push('verify_ready_count_unexpected_nonzero');
  if (rows.length !== EXPECTED_BATCH_IDS.length) blockers.push('target_lifecycle_rows_missing');
  if (!sameStringArray(rowIds, EXPECTED_BATCH_IDS)) blockers.push('unexpected_lifecycle_batch_ids');

  for (const row of rows) {
    const batchId = safeId(row?.batch_id, 180);
    const expectedProduct = EXPECTED_BATCH_PRODUCTS[batchId];
    if (!expectedProduct) blockers.push(`unexpected_lifecycle_batch:${batchId || 'missing'}`);
    if (safeText(row?.product_name, 120) !== expectedProduct) blockers.push(`lifecycle_product_mismatch:${batchId || 'missing'}`);
    if (row?.production_date !== TARGET_PRODUCTION_DATE) blockers.push(`lifecycle_production_date_mismatch:${batchId || 'missing'}`);
    if (roundQuantity(row?.planned_units, 3) !== EXPECTED_BATCH_UNITS[batchId]) blockers.push(`lifecycle_planned_units_mismatch:${batchId || 'missing'}`);
    if (row?.production_batch_id && safeId(row?.production_batch_id, 120) !== EXPECTED_BATCH_RECORD_IDS[batchId]) blockers.push(`lifecycle_production_batch_id_mismatch:${batchId || 'missing'}`);
    if (normalizeLower(row?.current_status || row?.status) !== 'planned') blockers.push(`lifecycle_status_not_planned:${batchId || 'missing'}`);
    if (row?.is_locked === true) blockers.push(`lifecycle_batch_locked:${batchId || 'missing'}`);
    if (row?.can_start !== true) blockers.push(`lifecycle_batch_not_startable:${batchId || 'missing'}`);
    if (Array.isArray(row?.start_blockers) && row.start_blockers.length > 0) blockers.push(`lifecycle_start_blockers:${batchId || 'missing'}`);
    if (row?.can_complete === true) warnings.push(`lifecycle_complete_ready_unexpected:${batchId || 'missing'}`);
    if (row?.can_verify === true) warnings.push(`lifecycle_verify_ready_unexpected:${batchId || 'missing'}`);
  }

  if (preview?.inventory_deduction_ready !== false) blockers.push('inventory_deduction_should_remain_held');
  if (preview?.purchase_order_ready !== false) warnings.push('purchase_order_ready_unexpected_true');
  if (preview?.hub_fallback_required !== true) warnings.push('hub_fallback_required_flag_missing');

  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)].slice(0, 80),
    warnings: [...new Set(warnings.concat(preview?.warnings || []))].slice(0, 80),
    rows,
  };
}

async function filterEntity(base44, entityName, filter, sort = '-created_date', limit = 10) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity?.filter) return [];
  const rows = await entity.filter(filter, sort, limit).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function findExistingCommandLog(base44, idempotencyKey) {
  return filterEntity(base44, 'CommandLog', { idempotency_key: idempotencyKey }, '-created_date', 3);
}

async function findBatchByBatchId(base44, batchId) {
  const rows = await filterEntity(base44, 'ProductionBatch', { batch_id: batchId }, '-created_date', 5);
  return rows;
}

function batchHasTargetSource(batch) {
  const text = `${safeText(batch?.batch_id, 180)} ${safeText(batch?.source_order_number, 120)} ${safeText(batch?.order_number, 120)} ${safeText(batch?.source_order_id, 120)} ${safeText(batch?.base44_order_id, 120)} ${safeText(batch?.native_shopify_order_id, 120)} ${safeText(batch?.native_fulfillment_task_id, 120)} ${JSON.stringify(batch?.order_sources || [])} ${JSON.stringify(batch?.related_orders || [])}`;
  return [TARGET_ORDER_NUMBER, TARGET_CUSTOMER_APP_ORDER_ID, TARGET_NATIVE_SHOPIFY_ORDER_ID, TARGET_NATIVE_FULFILLMENT_TASK_ID]
    .some(value => value && text.includes(value));
}

function summarizeBatch(batch, previousStatus = null, skippedReason = null) {
  return {
    production_batch_id: safeId(batch?.id, 120) || null,
    batch_id: safeId(batch?.batch_id, 180) || null,
    product_name: safeText(batch?.product_name, 120) || null,
    production_date: safeText(batch?.production_date, 40) || null,
    planned_units: roundQuantity(batch?.planned_units, 3),
    previous_status: safeText(previousStatus || batch?.status, 80) || null,
    status: safeText(batch?.status, 80) || null,
    actual_start_time: safeText(batch?.actual_start_time, 80) || null,
    started_by: safeText(batch?.started_by, 120) || null,
    skipped_reason: skippedReason,
  };
}

async function preflightTargetBatches(base44) {
  const blockers = [];
  const batches = [];
  const conflicts = [];

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
    const productName = EXPECTED_BATCH_PRODUCTS[batchId];
    const status = normalizeLower(batch?.status);
    const batchBlockers = [];
    if (safeText(batch?.product_name, 120) !== productName) batchBlockers.push('product_name_mismatch');
    if (normalizeText(batch?.production_date) !== TARGET_PRODUCTION_DATE) batchBlockers.push('production_date_mismatch');
    if (safeId(batch?.id, 120) !== EXPECTED_BATCH_RECORD_IDS[batchId]) batchBlockers.push('production_batch_record_id_mismatch');
    if (roundQuantity(batch?.planned_units, 3) !== EXPECTED_BATCH_UNITS[batchId]) batchBlockers.push('planned_units_mismatch');
    if (!batchHasTargetSource(batch)) batchBlockers.push('target_order_source_missing');
    if (batch?.is_locked === true) batchBlockers.push('batch_locked');
    if (['completed_pending_verification', 'verified_logged', 'archived'].includes(status) || batch?.actual_end_time || batch?.completed_by || batch?.verified_at || batch?.verified_by || batch?.compliance_log_id) {
      batchBlockers.push('terminal_or_later_lifecycle_state');
    }
    if (!['planned', 'in_production'].includes(status)) batchBlockers.push('status_not_planned_or_in_production');
    if (batchBlockers.length > 0) {
      blockers.push(`lifecycle_conflict:${batchId}`);
      conflicts.push({ batch_id: batchId, product_name: productName, status: safeText(batch?.status, 80) || null, blockers: batchBlockers });
    }
    batches.push(batch);
  }

  if (blockers.length > 0) return { ready: false, mode: 'blocked', blockers, conflicts, batches, rowsToUpdate: [], alreadyStartedRows: [] };

  const planned = batches.filter(batch => normalizeLower(batch?.status) === 'planned');
  const inProduction = batches.filter(batch => normalizeLower(batch?.status) === 'in_production');
  if (planned.length === EXPECTED_BATCH_IDS.length) {
    return { ready: true, mode: 'start', blockers: [], conflicts: [], batches, rowsToUpdate: planned, alreadyStartedRows: [] };
  }
  if (inProduction.length === EXPECTED_BATCH_IDS.length) {
    const incoherent = inProduction.filter(batch => !batch.actual_start_time || !batch.started_by);
    if (incoherent.length > 0) {
      return {
        ready: false,
        mode: 'blocked',
        blockers: ['already_in_production_start_metadata_incomplete'],
        conflicts: incoherent.map(batch => ({ batch_id: safeId(batch?.batch_id, 180), status: safeText(batch?.status, 80), reason: 'missing_actual_start_time_or_started_by' })),
        batches,
        rowsToUpdate: [],
        alreadyStartedRows: inProduction,
      };
    }
    return { ready: true, mode: 'already_started', blockers: [], conflicts: [], batches, rowsToUpdate: [], alreadyStartedRows: inProduction };
  }

  return {
    ready: false,
    mode: 'blocked',
    blockers: ['partial_lifecycle_conflict'],
    conflicts: batches.map(batch => ({ batch_id: safeId(batch?.batch_id, 180), status: safeText(batch?.status, 80), reason: 'mixed_planned_and_in_production_state' })),
    batches,
    rowsToUpdate: [],
    alreadyStartedRows: inProduction,
  };
}

function buildStartPatch({ batch, commandLogId, actorEmail, requestId, now }) {
  const existingTrail = Array.isArray(batch.audit_trail) ? batch.audit_trail.slice(-100) : [];
  const existingCommandIds = Array.isArray(batch.command_log_ids) ? batch.command_log_ids.map(id => safeId(id, 120)).filter(Boolean).slice(-40) : [];
  const commandIds = commandLogId ? [...new Set([...existingCommandIds, safeId(commandLogId, 120)])] : existingCommandIds;
  return {
    status: 'in_production',
    actual_start_time: now,
    started_by: safeActorEmail(actorEmail) || 'native_admin_actor',
    audit_trail: [
      ...existingTrail,
      {
        timestamp: now,
        action: 'production_batch_start',
        performed_by: safeActorEmail(actorEmail) || 'native_admin_actor',
        before: { status: safeText(batch?.status, 80) || null },
        after: { status: 'in_production' },
        reason: 'G37F gated exact-order native Start Production command',
        request_id: safeId(requestId, 160) || null,
        command_log_id: safeId(commandLogId, 120) || null,
      },
    ],
    ...(commandIds.length > 0 ? { command_log_ids: commandIds } : {}),
  };
}

function validateStartPatch(patch) {
  const blockers = [];
  const allowed = new Set(['status', 'actual_start_time', 'started_by', 'audit_trail', 'command_log_ids']);
  for (const key of Object.keys(patch || {})) {
    if (!allowed.has(key)) blockers.push(`unapproved_production_batch_start_field:${key}`);
  }
  if (patch.status !== 'in_production') blockers.push('status_must_be_in_production');
  if (!safeText(patch.actual_start_time, 80)) blockers.push('actual_start_time_required');
  if (!safeText(patch.started_by, 120)) blockers.push('started_by_required');
  if (!Array.isArray(patch.audit_trail) || patch.audit_trail.length === 0) blockers.push('audit_trail_required');
  if ('actual_units' in patch || 'ingredients_used' in patch || 'pH_result' in patch || 'compliance_log_id' in patch || 'inventory_deduction_log_id' in patch || 'actual_end_time' in patch || 'completed_by' in patch || 'verified_at' in patch || 'verified_by' in patch) {
    blockers.push('forbidden_completion_verify_inventory_or_compliance_field_present');
  }
  return blockers;
}

async function updateProductionBatches({ base44, batches, commandLogId, actorEmail, requestId, actualStartTime }) {
  const updatedRows = [];
  const now = safeText(actualStartTime, 80) || new Date().toISOString();
  for (const batch of batches) {
    const previousStatus = safeText(batch?.status, 80) || null;
    const patch = buildStartPatch({ batch, commandLogId, actorEmail, requestId, now });
    const patchBlockers = validateStartPatch(patch);
    if (patchBlockers.length > 0) {
      const error = new Error(`ProductionBatch start patch validation failed: ${patchBlockers.join(',')}`);
      error.code = 'production_batch_start_patch_invalid';
      throw error;
    }
    const updated = await base44.asServiceRole.entities.ProductionBatch.update(batch.id, patch);
    updatedRows.push(summarizeBatch(updated, previousStatus));
  }
  return updatedRows;
}

async function createCommandLog({ base44, status, idempotencyKey, requestId, user, result, errorCode, errorMessage, lookup = {} }) {
  const now = new Date().toISOString();
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: commandTypeFor(lookup),
    command_source: 'customer_app_native_admin',
    status,
    target_entity: 'ProductionBatch',
    target_id: TARGET_ORDER_NUMBER,
    target_display_id: TARGET_ORDER_NUMBER,
    actor_email: safeActorEmail(user?.email) || null,
    actor_role: safeText(user?.role, 80) || null,
    actor_type: 'admin',
    payload: {
      exact_order_allowlist: true,
      exact_batch_allowlist: true,
      order_number: TARGET_ORDER_NUMBER,
      customer_app_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
      native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
      native_fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
      production_date: TARGET_PRODUCTION_DATE,
      policy: requiredPolicyFor(lookup),
      repair_scope: isRepairRequest(lookup) ? REPAIR_SCOPE : null,
      expected_batch_ids: EXPECTED_BATCH_IDS,
      expected_products: EXPECTED_PRODUCTS,
      preview_function: 'previewNativeProductionBatchLifecycle',
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
    notes: isRepairRequest(lookup)
      ? 'G37F-REPAIR1 exact gated native premature Start Production revert command. Updates only two exact in_production ProductionBatch records back to planned and clears premature start metadata. No complete/verify/compliance, inventory deduction, PurchaseOrder, Customer App Order, ShopifyOrder, FulfillmentTask, provider, notification, broad sync/repair/replay, or Hub mutation.'
      : 'G37F exact gated native Start Production command. Updates only two exact planned ProductionBatch records to in_production. No complete/verify/compliance, inventory deduction, PurchaseOrder, Customer App Order, ShopifyOrder, FulfillmentTask, provider, notification, sync, repair, replay, or Hub mutation.',
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
    production_batches_updated: false,
    production_batches_created: false,
    manual_production_batches_created: false,
    production_completed: false,
    production_verified: false,
    compliance_logs_created: false,
    batch_compliance_logs_created: false,
    inventory_deducted: false,
    purchase_orders_created: false,
    customer_app_order_updated: false,
    native_shopify_order_updated: false,
    native_fulfillment_task_updated: false,
    recipe_updated: false,
    bundle_updated: false,
    inventory_item_updated: false,
    ingredient_yield_updated: false,
    provider_calls_performed: false,
    stripe_calls_performed: false,
    shopify_api_calls_performed: false,
    notifications_sent: false,
    sync_repair_replay_performed: false,
    hub_bridge_modified: false,
    ...extra,
  };
}

async function hasBatchComplianceLog(base44, batch) {
  const batchId = safeId(batch?.batch_id, 180);
  const recordId = safeId(batch?.id, 120);
  const byBatchId = batchId ? await filterEntity(base44, 'BatchComplianceLog', { batch_id: batchId }, '-created_date', 5) : [];
  const bySourceId = recordId ? await filterEntity(base44, 'BatchComplianceLog', { source_production_batch_id: recordId }, '-created_date', 5) : [];
  return byBatchId.length + bySourceId.length > 0;
}

async function preflightRepairTargetBatches(base44) {
  const blockers = [];
  const batches = [];
  const conflicts = [];

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
    const productName = EXPECTED_BATCH_PRODUCTS[batchId];
    const status = normalizeLower(batch?.status);
    const batchBlockers = [];
    if (safeText(batch?.product_name, 120) !== productName) batchBlockers.push('product_name_mismatch');
    if (normalizeText(batch?.production_date) !== TARGET_PRODUCTION_DATE) batchBlockers.push('production_date_mismatch');
    if (safeId(batch?.id, 120) !== EXPECTED_BATCH_RECORD_IDS[batchId]) batchBlockers.push('production_batch_record_id_mismatch');
    if (roundQuantity(batch?.planned_units, 3) !== EXPECTED_BATCH_UNITS[batchId]) batchBlockers.push('planned_units_mismatch');
    if (!batchHasTargetSource(batch)) batchBlockers.push('target_order_source_missing');
    if (batch?.is_locked === true) batchBlockers.push('batch_locked');
    if (await hasBatchComplianceLog(base44, batch)) batchBlockers.push('batch_compliance_log_present');
    if (roundQuantity(batch?.actual_units, 3) !== null) batchBlockers.push('actual_units_present');
    if (batch?.actual_end_time || batch?.completed_by) batchBlockers.push('completion_metadata_present');
    if (batch?.verified_at || batch?.verified_by || batch?.compliance_log_id) batchBlockers.push('verification_metadata_present');

    if (status === 'in_production') {
      if (safeText(batch?.actual_start_time, 80) !== PREMATURE_ACTUAL_START_TIME) batchBlockers.push('premature_actual_start_time_mismatch');
      if (!safeText(batch?.started_by, 120)) batchBlockers.push('started_by_missing');
    } else if (status === 'planned') {
      if (batch?.actual_start_time || batch?.started_at || batch?.started_by) batchBlockers.push('planned_state_still_has_start_metadata');
    } else if (['completed_pending_verification', 'verified_logged', 'archived'].includes(status)) {
      batchBlockers.push('terminal_or_later_lifecycle_state');
    } else {
      batchBlockers.push('status_not_in_production_or_planned');
    }

    if (batchBlockers.length > 0) {
      blockers.push(`repair_conflict:${batchId}`);
      conflicts.push({ batch_id: batchId, product_name: productName, status: safeText(batch?.status, 80) || null, blockers: batchBlockers });
    }
    batches.push(batch);
  }

  if (blockers.length > 0) return { ready: false, mode: 'blocked', blockers, conflicts, batches, rowsToUpdate: [], alreadyPlannedRows: [] };

  const inProduction = batches.filter(batch => normalizeLower(batch?.status) === 'in_production');
  const planned = batches.filter(batch => normalizeLower(batch?.status) === 'planned');
  if (inProduction.length === EXPECTED_BATCH_IDS.length) {
    return { ready: true, mode: 'repair', blockers: [], conflicts: [], batches, rowsToUpdate: inProduction, alreadyPlannedRows: [] };
  }
  if (planned.length === EXPECTED_BATCH_IDS.length) {
    return { ready: false, mode: 'already_reverted_without_matching_idempotency_log', blockers: ['already_reverted_without_matching_idempotency_log'], conflicts: [], batches, rowsToUpdate: [], alreadyPlannedRows: planned };
  }

  return {
    ready: false,
    mode: 'partial_repair_state_detected',
    blockers: ['partial_repair_state_detected'],
    conflicts: batches.map(batch => ({ batch_id: safeId(batch?.batch_id, 180), status: safeText(batch?.status, 80), reason: 'mixed_planned_and_in_production_state' })),
    batches,
    rowsToUpdate: [],
    alreadyPlannedRows: planned,
  };
}

function buildRepairPatch({ batch, commandLogId, actorEmail, requestId, reason, now }) {
  const existingTrail = Array.isArray(batch.audit_trail) ? batch.audit_trail.slice(-100) : [];
  const existingCommandIds = Array.isArray(batch.command_log_ids) ? batch.command_log_ids.map(id => safeId(id, 120)).filter(Boolean).slice(-40) : [];
  const commandIds = commandLogId ? [...new Set([...existingCommandIds, safeId(commandLogId, 120)])] : existingCommandIds;
  return {
    status: 'planned',
    actual_start_time: null,
    started_at: null,
    started_by: null,
    audit_trail: [
      ...existingTrail,
      {
        timestamp: now,
        action: 'production_batch_revert_premature_start',
        performed_by: safeActorEmail(actorEmail) || 'native_admin_actor',
        before: { status: safeText(batch?.status, 80) || null, actual_start_time: safeText(batch?.actual_start_time, 80) || null, started_by_present: Boolean(batch?.started_by) },
        after: { status: 'planned', actual_start_time: null, started_by_present: false },
        reason: safeText(reason, 180) || 'Physical production has not started; reverting premature native production start.',
        request_id: safeId(requestId, 160) || null,
        command_log_id: safeId(commandLogId, 120) || null,
      },
    ],
    ...(commandIds.length > 0 ? { command_log_ids: commandIds } : {}),
  };
}

function validateRepairPatch(patch) {
  const blockers = [];
  const allowed = new Set(['status', 'actual_start_time', 'started_at', 'started_by', 'audit_trail', 'command_log_ids']);
  for (const key of Object.keys(patch || {})) {
    if (!allowed.has(key)) blockers.push(`unapproved_premature_start_repair_field:${key}`);
  }
  if (patch.status !== 'planned') blockers.push('status_must_be_planned');
  if (patch.actual_start_time !== null) blockers.push('actual_start_time_must_clear');
  if (patch.started_at !== null) blockers.push('started_at_must_clear');
  if (patch.started_by !== null) blockers.push('started_by_must_clear');
  if (!Array.isArray(patch.audit_trail) || patch.audit_trail.length === 0) blockers.push('audit_trail_required');
  if ('actual_units' in patch || 'ingredients_used' in patch || 'pH_result' in patch || 'compliance_log_id' in patch || 'inventory_deduction_log_id' in patch || 'actual_end_time' in patch || 'completed_by' in patch || 'verified_at' in patch || 'verified_by' in patch) {
    blockers.push('forbidden_completion_verify_inventory_or_compliance_field_present');
  }
  return blockers;
}

async function repairProductionBatches({ base44, batches, commandLogId, actorEmail, requestId, reason }) {
  const updatedRows = [];
  const now = new Date().toISOString();
  for (const batch of batches) {
    const previousStatus = safeText(batch?.status, 80) || null;
    const patch = buildRepairPatch({ batch, commandLogId, actorEmail, requestId, reason, now });
    const patchBlockers = validateRepairPatch(patch);
    if (patchBlockers.length > 0) {
      const error = new Error(`ProductionBatch premature start repair patch validation failed: ${patchBlockers.join(',')}`);
      error.code = 'production_batch_premature_start_repair_patch_invalid';
      throw error;
    }
    const updated = await base44.asServiceRole.entities.ProductionBatch.update(batch.id, patch);
    updatedRows.push(summarizeBatch(updated, previousStatus));
  }
  return updatedRows;
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
    const repairMode = isRepairRequest(lookup);
    if (normalizeLower(body.mode) !== 'live' || normalizeText(body.confirmation) !== requiredConfirmationFor(lookup)) {
      return jsonResponse({ success: false, error_code: 'confirmation_required', writes_performed: false }, 400);
    }
    if (!lookup.requestId) return jsonResponse({ success: false, error_code: 'request_id_required', writes_performed: false }, 400);

    const targetBlockers = repairMode ? exactRepairTargetBlockers(lookup) : exactTargetBlockers(lookup);
    if (targetBlockers.length > 0) {
      return jsonResponse({ success: false, skipped: true, error_code: repairMode ? 'exact_premature_start_repair_target_required' : 'exact_start_target_required', blockers: targetBlockers, writes_performed: false }, 409);
    }

    const gate = gateFailure({ actorEmail: auth.user?.email, lookup });
    if (gate) return jsonResponse({ success: false, skipped: true, error_code: gate, writes_performed: false }, 409);

    const policyBlockers = validateExplicitPolicies(body, lookup);
    if (policyBlockers.length > 0) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: repairMode ? 'exact_premature_start_repair_approval_contract_required' : 'exact_start_approval_contract_required',
        blockers: policyBlockers,
        writes_performed: false,
        production_batch_updated: false,
        command_log_created: false,
      }, 409);
    }

    const idempotencyKey = `${commandTypeFor(lookup)}:${lookup.requestId}`;
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
        production_batches_updated: false,
        production_batch_updated: false,
        production_batch_records_updated: 0,
        command_log_created: false,
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

    if (repairMode) {
      const preflight = await preflightRepairTargetBatches(base44);
      if (!preflight.ready) {
        return jsonResponse({
          success: false,
          skipped: true,
          error_code: preflight.mode === 'partial_repair_state_detected' ? 'partial_repair_state_detected' : preflight.mode === 'already_reverted_without_matching_idempotency_log' ? 'already_reverted_without_matching_idempotency_log' : 'premature_start_repair_conflict',
          blockers: preflight.blockers,
          conflicts: preflight.conflicts,
          writes_performed: false,
          production_batch_updated: false,
          command_log_created: false,
        }, 409);
      }

      const commandLog = await createCommandLog({
        base44,
        status: 'running',
        idempotencyKey,
        requestId: lookup.requestId,
        user: auth.user,
        lookup,
        result: {
          repair_scope: REPAIR_SCOPE,
          writes_performed: false,
          projected_update_count: preflight.rowsToUpdate.length,
          projected_batch_ids: preflight.rowsToUpdate.map(batch => safeId(batch.batch_id, 180)),
          production_date: TARGET_PRODUCTION_DATE,
          inventory_deducted: false,
          purchase_orders_created: false,
          compliance_logs_created: false,
        },
      });

      let updatedRows = [];
      try {
        updatedRows = await repairProductionBatches({
          base44,
          batches: preflight.rowsToUpdate,
          commandLogId: commandLog?.id,
          actorEmail: auth.user?.email,
          requestId: lookup.requestId,
          reason: lookup.reason,
        });
      } catch (error) {
        await updateCommandLog({
          base44,
          commandLogId: commandLog?.id,
          status: 'failed',
          result: {
            repair_scope: REPAIR_SCOPE,
            writes_performed: updatedRows.length > 0,
            partial_update_count: updatedRows.length,
            updated_batches: updatedRows,
            duplicate_audit_entries_created: false,
            ...safetyResult({ production_batches_updated: updatedRows.length > 0 }),
          },
          errorCode: error?.code || 'premature_start_repair_write_failed',
          errorMessage: error?.message || 'ProductionBatch premature start repair failed',
        }).catch(() => null);
        return jsonResponse({
          success: false,
          skipped: false,
          error_code: error?.code || 'premature_start_repair_write_failed',
          message: 'Native ProductionBatch premature start repair failed safely.',
          writes_performed: updatedRows.length > 0,
          partial_update_count: updatedRows.length,
        }, 500);
      }

      await updateCommandLog({
        base44,
        commandLogId: commandLog?.id,
        status: 'success',
        result: {
          repair_scope: REPAIR_SCOPE,
          writes_performed: true,
          production_batches_updated: true,
          production_batch_updated: true,
          production_batch_records_updated: updatedRows.length,
          updated_batch_count: updatedRows.length,
          updated_batches: updatedRows,
          production_date: TARGET_PRODUCTION_DATE,
          batch_ids: updatedRows.map(row => row.batch_id),
          updated_production_batch_ids: updatedRows.map(row => row.production_batch_id).filter(Boolean),
          status_from: 'in_production',
          status_to: 'planned',
          reverted_to_status: 'planned',
          cleared_actual_start_time: true,
          cleared_started_by: true,
          cleared_started_at: true,
          exact_repair_command_performed: true,
          ...safetyResult({ production_batches_updated: true }),
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
        production_date: TARGET_PRODUCTION_DATE,
        repair_scope: REPAIR_SCOPE,
        writes_performed: true,
        production_batches_updated: true,
        production_batch_updated: true,
        production_batch_records_updated: updatedRows.length,
        updated_batch_count: updatedRows.length,
        updated_batches: updatedRows,
        updated_production_batch_ids: updatedRows.map(row => row.production_batch_id).filter(Boolean),
        status_from: 'in_production',
        status_to: 'planned',
        reverted_to_status: 'planned',
        cleared_actual_start_time: true,
        cleared_started_by: true,
        cleared_started_at: true,
        duplicate_audit_entries_created: false,
        inventory_deducted: false,
        purchase_orders_created: false,
        compliance_logs_created: false,
        batch_compliance_log_created: false,
        batch_compliance_logs_created: false,
        notifications_created: false,
        command_log_created: true,
        provider_calls: false,
        stripe_calls: false,
        shopify_calls: false,
        notifications_sent: false,
        sync_retry_repair_run: false,
        sync_repair_replay_performed: false,
        exact_repair_command_performed: true,
        customer_app_order_updated: false,
        native_shopify_order_updated: false,
        native_fulfillment_task_updated: false,
        hub_records_updated: false,
        safety: safetyResult({ production_batches_updated: true }),
      });
    }

    const freshPreview = await fetchFreshPreview(base44, lookup);
    if (!freshPreview.ok) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: freshPreview.error_code || 'fresh_lifecycle_preview_failed',
        preview_status: freshPreview.status,
        writes_performed: false,
      }, freshPreview.status || 409);
    }

    const validation = validateFreshPreview(freshPreview.data);
    if (!validation.ready) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: 'fresh_lifecycle_preview_not_clean',
        blockers: validation.blockers,
        warnings: validation.warnings,
        writes_performed: false,
      }, 409);
    }

    const preflight = await preflightTargetBatches(base44);
    if (!preflight.ready) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: preflight.blockers.includes('partial_lifecycle_conflict') ? 'partial_lifecycle_conflict' : 'lifecycle_conflict',
        blockers: preflight.blockers,
        conflicts: preflight.conflicts,
        writes_performed: false,
      }, 409);
    }

    if (preflight.mode === 'already_started') {
      const commandLog = await createCommandLog({
        base44,
        status: 'skipped',
        idempotencyKey,
        requestId: lookup.requestId,
        user: auth.user,
        lookup,
        result: {
          writes_performed: false,
          production_batches_updated: false,
          already_started_count: preflight.alreadyStartedRows.length,
          already_started_rows: preflight.alreadyStartedRows.map(batch => summarizeBatch(batch, batch.status, 'already_in_production')),
          duplicate_audit_entries_created: false,
          ...safetyResult(),
        },
      });
      return jsonResponse({
        success: true,
        skipped: true,
        idempotent: false,
        reason: 'exact_native_batches_already_in_production',
        request_id: lookup.requestId,
        idempotency_key: idempotencyKey,
        command_log_id: safeId(commandLog?.id, 120) || null,
        order_number: TARGET_ORDER_NUMBER,
        production_date: TARGET_PRODUCTION_DATE,
        writes_performed: false,
        production_batches_updated: false,
        production_batch_updated: false,
        production_batch_records_updated: 0,
        updated_batch_count: 0,
        already_started_count: preflight.alreadyStartedRows.length,
        already_started_rows: preflight.alreadyStartedRows.map(batch => summarizeBatch(batch, batch.status, 'already_in_production')),
        duplicate_audit_entries_created: false,
        command_log_created: true,
        safety: safetyResult(),
      });
    }

    const commandLog = await createCommandLog({
      base44,
      status: 'running',
      idempotencyKey,
      requestId: lookup.requestId,
      user: auth.user,
      lookup,
      result: {
        writes_performed: false,
        projected_update_count: preflight.rowsToUpdate.length,
        projected_batch_ids: preflight.rowsToUpdate.map(batch => safeId(batch.batch_id, 180)),
        production_date: TARGET_PRODUCTION_DATE,
        inventory_deducted: false,
        purchase_orders_created: false,
        compliance_logs_created: false,
      },
    });

    let updatedRows = [];
    try {
      updatedRows = await updateProductionBatches({
        base44,
        batches: preflight.rowsToUpdate,
        commandLogId: commandLog?.id,
        actorEmail: auth.user?.email,
        requestId: lookup.requestId,
        actualStartTime: lookup.actualStartTime,
      });
    } catch (error) {
      await updateCommandLog({
        base44,
        commandLogId: commandLog?.id,
        status: 'failed',
        result: {
          writes_performed: updatedRows.length > 0,
          partial_update_count: updatedRows.length,
          updated_batches: updatedRows,
          duplicate_audit_entries_created: false,
          ...safetyResult({ production_batches_updated: updatedRows.length > 0 }),
        },
        errorCode: error?.code || 'production_batch_start_write_failed',
        errorMessage: error?.message || 'ProductionBatch start write failed',
      }).catch(() => null);
      return jsonResponse({
        success: false,
        skipped: false,
        error_code: error?.code || 'production_batch_start_write_failed',
        message: 'Native ProductionBatch start failed safely.',
        writes_performed: updatedRows.length > 0,
        partial_update_count: updatedRows.length,
      }, 500);
    }

    await updateCommandLog({
      base44,
      commandLogId: commandLog?.id,
      status: 'success',
      result: {
        writes_performed: true,
        production_batches_updated: true,
        production_batch_updated: true,
        production_batch_records_updated: updatedRows.length,
        updated_batch_count: updatedRows.length,
        updated_batches: updatedRows,
        production_date: TARGET_PRODUCTION_DATE,
        batch_ids: updatedRows.map(row => row.batch_id),
        updated_production_batch_ids: updatedRows.map(row => row.production_batch_id).filter(Boolean),
        status_from: 'planned',
        status_to: 'in_production',
        ...safetyResult({ production_batches_updated: true }),
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
      production_date: TARGET_PRODUCTION_DATE,
      writes_performed: true,
      production_batches_updated: true,
      production_batch_updated: true,
      production_batch_records_updated: updatedRows.length,
      updated_batch_count: updatedRows.length,
      updated_batches: updatedRows,
      updated_production_batch_ids: updatedRows.map(row => row.production_batch_id).filter(Boolean),
      status_from: 'planned',
      status_to: 'in_production',
      duplicate_audit_entries_created: false,
      inventory_deducted: false,
      purchase_orders_created: false,
      compliance_logs_created: false,
      batch_compliance_log_created: false,
      batch_compliance_logs_created: false,
      notifications_created: false,
      command_log_created: true,
      provider_calls: false,
      stripe_calls: false,
      shopify_calls: false,
      notifications_sent: false,
      sync_retry_repair_run: false,
      sync_repair_replay_performed: false,
      customer_app_order_updated: false,
      native_shopify_order_updated: false,
      native_fulfillment_task_updated: false,
      hub_records_updated: false,
      safety: safetyResult({ production_batches_updated: true }),
    });
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] failed safely: ${error?.message || 'unknown error'}`);
    return jsonResponse({
      success: false,
      error_code: 'native_production_batch_start_failed',
      message: 'Native ProductionBatch start failed safely.',
      writes_performed: false,
    }, 500);
  }
});
