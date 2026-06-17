import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const COMMAND_TYPE = 'native_production_batch_verify';
const FUNCTION_NAME = 'verifyNativeProductionBatchesForCustomerApp';
const ENABLE_FLAG = 'ENABLE_NATIVE_PRODUCTION_BATCH_VERIFY';
const KILL_SWITCH_FLAG = 'NATIVE_PRODUCTION_BATCH_VERIFY_KILL_SWITCH';
const ALLOWED_EMAILS_FLAG = 'NATIVE_PRODUCTION_BATCH_VERIFY_ALLOWED_EMAILS';
const ORDER_ALLOWLIST_FLAG = 'NATIVE_PRODUCTION_BATCH_VERIFY_ORDER_ALLOWLIST';
const BATCH_ALLOWLIST_FLAG = 'NATIVE_PRODUCTION_BATCH_VERIFY_BATCH_ALLOWLIST';
const POLICY_FLAG = 'NATIVE_PRODUCTION_BATCH_VERIFY_POLICY';
const REQUIRED_POLICY = 'EXACT_BATCH_VERIFICATION_DATA_ONLY';
const CONFIRMATION_PHRASE = 'verify_native_production_batches_for_customer_app';
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
  'policy',
  'order_number',
  'shopify_order_number',
  'production_date',
  'expected_production_date',
  'expected_delivery_date',
  'delivery_date',
  'expected_status',
  'batch_ids',
  'selected_production_batch_ids',
  'production_batch_ids',
  'verification_data',
  'verification_data_by_batch_id',
  'verification_data_by_batch',
  'batch_verification_data',
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
  'verified_at',
  'verified_by',
  'compliance_log_policy',
  'inventory_deduction_policy',
  'purchase_order_policy',
  'notification_policy',
  'provider_call_policy',
  'hub_mutation_policy',
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
  'ingredients_used',
  'ingredient_lot_notes',
  'inventory_deduction',
  'deduct_inventory',
  'purchase_order',
  'create_purchase_order',
  'start_production',
  'complete_production',
  'pack_task',
  'bottle_order',
  'route',
  'proof',
  'drop',
  'delivery',
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

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeStringArray(value, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map(item => safeText(item, maxLength)).filter(Boolean);
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
    if (/(^|_)(custom|raw|payload|provider|stripe|shopify|inventory|purchase|notification|sync|repair|replay|bulk|status|task|order|batch|recipe|route|proof|delivery|ingredient|complete|start|pack|bottle)($|_)/i.test(normalized)) {
      return key;
    }
    return key;
  }
  return null;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function firstOwnValue(object, keys) {
  const source = safeObject(object);
  for (const key of keys) {
    if (hasOwn(source, key)) return source[key];
  }
  return undefined;
}

function normalizePassFail(value) {
  if (value === true) return 'passed';
  if (value === false) return 'failed';
  const text = normalizeLower(value);
  if (['passed', 'pass', 'true', 'yes', 'ok'].includes(text)) return 'passed';
  if (['failed', 'fail', 'false', 'no'].includes(text)) return 'failed';
  return '';
}

function normalizeVerificationInput(source, label, blockers) {
  const input = safeObject(source);
  const normalized = {};
  const pHResultRaw = firstOwnValue(input, ['pH_result', 'ph_result', 'ph_value']);
  if (pHResultRaw !== undefined) {
    const pHResult = safeNumber(pHResultRaw);
    if (pHResult === null) blockers.push(`invalid_ph_result:${label}`);
    else normalized.pH_result = pHResult;
  }

  const pHStatusRaw = firstOwnValue(input, ['pH_passed_failed', 'ph_passed_failed', 'pH_passed', 'ph_passed']);
  if (pHStatusRaw !== undefined) {
    const pHStatus = normalizePassFail(pHStatusRaw);
    if (!pHStatus) blockers.push(`invalid_ph_pass_fail:${label}`);
    else normalized.pH_passed_failed = pHStatus;
  }

  const batchStatusRaw = firstOwnValue(input, ['passed_failed', 'batch_passed_failed', 'batch_passed']);
  if (batchStatusRaw !== undefined) {
    const batchStatus = normalizePassFail(batchStatusRaw);
    if (!batchStatus) blockers.push(`invalid_batch_pass_fail:${label}`);
    else normalized.passed_failed = batchStatus;
  }

  const notes = safeText(input.verification_notes || input.qc_notes || input.notes, 600);
  if (notes) normalized.verification_notes = notes;
  if (Array.isArray(input.staff_on_duty)) normalized.staff_on_duty = safeStringArray(input.staff_on_duty, 120);
  return normalized;
}

function batchIdForSelection(value) {
  const rawText = safeText(value, 180);
  const text = safeId(rawText, 180);
  if (text && EXPECTED_BATCH_IDS.includes(text)) return text;
  if (text) {
    const recordMatch = Object.entries(EXPECTED_BATCH_RECORD_IDS).find(([, recordId]) => recordId === text);
    if (recordMatch) return recordMatch[0];
  }
  const productMatch = Object.entries(EXPECTED_BATCH_PRODUCTS).find(([, productName]) => normalizeLower(productName) === normalizeLower(rawText));
  return productMatch?.[0] || '';
}

function isExpectedBatchSelection(values) {
  return sameStringArray(values, EXPECTED_BATCH_IDS) || sameStringArray(values, EXPECTED_BATCH_RECORD_ID_VALUES);
}

function parseVerificationDataMap(body) {
  const blockers = [];
  const rawVerificationData = safeObject(body?.verification_data);
  const verificationDataLooksByBatch = Object.keys(rawVerificationData).some(key => Boolean(batchIdForSelection(key)));
  const globalData = verificationDataLooksByBatch ? {} : normalizeVerificationInput(rawVerificationData, 'global', blockers);
  const byBatchSource = {
    ...(verificationDataLooksByBatch ? rawVerificationData : {}),
    ...safeObject(body?.verification_data_by_batch_id || body?.verification_data_by_batch || body?.batch_verification_data),
  };
  const verificationDataByBatchId = {};

  for (const batchId of EXPECTED_BATCH_IDS) {
    verificationDataByBatchId[batchId] = { ...globalData };
  }

  for (const [rawBatchId, rawData] of Object.entries(byBatchSource)) {
    const batchId = batchIdForSelection(rawBatchId);
    if (!batchId) {
      blockers.push('invalid_verification_data_batch_id');
      continue;
    }
    verificationDataByBatchId[batchId] = {
      ...verificationDataByBatchId[batchId],
      ...normalizeVerificationInput(rawData, batchId, blockers),
    };
  }

  const hasGlobal = Object.keys(globalData).length > 0;
  const hasByBatch = Object.keys(byBatchSource).length > 0;
  if (!hasGlobal && !hasByBatch) blockers.push('verification_data_required');

  for (const batchId of EXPECTED_BATCH_IDS) {
    const row = verificationDataByBatchId[batchId] || {};
    if (safeNumber(row.pH_result) === null) blockers.push(`missing_ph_result:${batchId}`);
    if (!normalizePassFail(row.pH_passed_failed)) blockers.push(`missing_ph_pass_fail:${batchId}`);
    if (!normalizePassFail(row.passed_failed)) blockers.push(`missing_batch_pass_fail:${batchId}`);
  }

  return {
    verificationDataByBatchId,
    blockers: uniqueStrings(blockers, 120),
  };
}

function getLookup(body) {
  return {
    orderNumber: normalizeText(body?.order_number || body?.shopify_order_number).replace(/^#/, ''),
    customerAppOrderId: safeId(body?.customer_app_order_id || body?.base44_order_id, 120),
    nativeShopifyOrderId: safeId(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id, 120),
    nativeFulfillmentTaskId: safeId(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id, 120),
    productionDate: normalizeText(body?.production_date || body?.expected_production_date),
    expectedDeliveryDate: normalizeText(body?.expected_delivery_date || body?.delivery_date),
    expectedStatus: normalizeLower(body?.expected_status || 'completed_pending_verification'),
    expectedPreviewHash: safeId(body?.expected_preview_hash, 180),
    requestId: safeId(body?.request_id, 160),
    batchIds: parseStringList(body?.selected_production_batch_ids || body?.batch_ids || body?.production_batch_ids),
    verifiedAt: safeText(body?.verified_at, 80),
    verifiedBy: safeActorEmail(body?.verified_by) || safeText(body?.verified_by, 120),
    ...parseVerificationDataMap(body),
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

function validateExplicitPolicies(body) {
  const blockers = [];
  const expectedPolicies = [
    ['policy', REQUIRED_POLICY, 'policy_mismatch'],
    ['compliance_log_policy', 'CREATE_LOCKED_SAFE_LOGS', 'compliance_log_policy_required'],
    ['inventory_deduction_policy', 'HELD', 'inventory_deduction_requested'],
    ['purchase_order_policy', 'HELD', 'purchase_order_requested'],
    ['notification_policy', 'NO_NOTIFICATION', 'notification_requested'],
    ['provider_call_policy', 'NO_PROVIDER_CALLS', 'provider_call_requested'],
    ['hub_mutation_policy', 'NO_HUB_MUTATION', 'hub_mutation_requested'],
  ];
  for (const [field, expected, blocker] of expectedPolicies) {
    const value = normalizeText(body?.[field]);
    if (!value || value !== expected) blockers.push(blocker);
  }
  return uniqueStrings(blockers, 80);
}

function exactTargetBlockers(lookup) {
  const blockers = [];
  if (lookup.orderNumber !== TARGET_ORDER_NUMBER) blockers.push('target_order_number_mismatch');
  if (lookup.productionDate !== TARGET_PRODUCTION_DATE) blockers.push('target_production_date_mismatch');
  if (lookup.expectedDeliveryDate && lookup.expectedDeliveryDate !== TARGET_DELIVERY_DATE) blockers.push('expected_delivery_date_mismatch');
  if (lookup.expectedStatus && lookup.expectedStatus !== 'completed_pending_verification') blockers.push('expected_status_must_be_completed_pending_verification');
  if (lookup.customerAppOrderId && lookup.customerAppOrderId !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('target_customer_app_order_id_mismatch');
  if (lookup.nativeShopifyOrderId && lookup.nativeShopifyOrderId !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('target_native_shopify_order_id_mismatch');
  if (lookup.nativeFulfillmentTaskId && lookup.nativeFulfillmentTaskId !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('target_native_fulfillment_task_id_mismatch');
  if (lookup.batchIds.length !== EXPECTED_BATCH_IDS.length || !isExpectedBatchSelection(lookup.batchIds)) {
    blockers.push('target_batch_ids_mismatch');
  }
  if (!lookup.verifiedAt) blockers.push('verified_at_required');
  if (!lookup.verifiedBy) blockers.push('verified_by_required');
  if (lookup.blockers?.length > 0) blockers.push(...lookup.blockers);
  return uniqueStrings(blockers, 120);
}

function gateFailure({ actorEmail, lookup }) {
  if (Deno.env.get(KILL_SWITCH_FLAG) === 'true') return 'kill_switch_active';
  if (Deno.env.get(ENABLE_FLAG) !== 'true') return 'native_production_batch_verify_disabled';
  if (normalizeText(Deno.env.get(POLICY_FLAG)) !== REQUIRED_POLICY) return 'exact_batch_verification_data_policy_required';

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
      verification_data_by_batch_id: lookup.verificationDataByBatchId,
      customer_app_order_id: lookup.customerAppOrderId || TARGET_CUSTOMER_APP_ORDER_ID,
      native_shopify_order_id: lookup.nativeShopifyOrderId || TARGET_NATIVE_SHOPIFY_ORDER_ID,
      native_fulfillment_task_id: lookup.nativeFulfillmentTaskId || TARGET_NATIVE_FULFILLMENT_TASK_ID,
      request_id: `${lookup.requestId || 'g31u'}:fresh_lifecycle_preview`,
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

function validateFreshPreview(preview, lookup) {
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
  if (safeNumber(preview?.verify_preview?.ready_count) !== EXPECTED_BATCH_IDS.length) blockers.push('unexpected_verify_ready_count');
  if (preview?.verification_preview_ready !== true) blockers.push('fresh_lifecycle_preview_verification_not_ready');
  if (rows.length !== EXPECTED_BATCH_IDS.length) blockers.push('target_lifecycle_rows_missing');
  if (!sameStringArray(rowIds, EXPECTED_BATCH_IDS)) blockers.push('unexpected_lifecycle_batch_ids');

  for (const row of rows) {
    const batchId = safeId(row?.batch_id, 180);
    const expectedProduct = EXPECTED_BATCH_PRODUCTS[batchId];
    const expectedData = lookup.verificationDataByBatchId?.[batchId] || {};
    if (!expectedProduct) blockers.push(`unexpected_lifecycle_batch:${batchId || 'missing'}`);
    if (safeText(row?.product_name, 120) !== expectedProduct) blockers.push(`lifecycle_product_mismatch:${batchId || 'missing'}`);
    if (row?.production_date !== TARGET_PRODUCTION_DATE) blockers.push(`lifecycle_production_date_mismatch:${batchId || 'missing'}`);
    if (roundQuantity(row?.planned_units, 3) !== EXPECTED_BATCH_UNITS[batchId]) blockers.push(`lifecycle_planned_units_mismatch:${batchId || 'missing'}`);
    if (normalizeLower(row?.current_status || row?.status) !== 'completed_pending_verification') blockers.push(`lifecycle_status_not_completed_pending_verification:${batchId || 'missing'}`);
    if (!row?.actual_start_time) blockers.push(`lifecycle_missing_actual_start_time:${batchId || 'missing'}`);
    if (!row?.actual_end_time) blockers.push(`lifecycle_missing_actual_end_time:${batchId || 'missing'}`);
    if (roundQuantity(row?.actual_units, 3) === null) blockers.push(`lifecycle_missing_actual_units:${batchId || 'missing'}`);
    if (row?.is_locked === true) blockers.push(`lifecycle_batch_locked:${batchId || 'missing'}`);
    if (row?.can_verify !== true) blockers.push(`lifecycle_batch_not_verifiable:${batchId || 'missing'}`);
    if (Array.isArray(row?.verify_blockers) && row.verify_blockers.length > 0) blockers.push(`lifecycle_verify_blockers:${batchId || 'missing'}`);
    if (row?.compliance_log_present === true) blockers.push(`lifecycle_compliance_log_already_present:${batchId || 'missing'}`);
    if (roundQuantity(row?.verification_input_preview?.pH_result, 3) !== roundQuantity(expectedData.pH_result, 3)) blockers.push(`lifecycle_ph_preview_mismatch:${batchId || 'missing'}`);
    if (normalizePassFail(row?.verification_input_preview?.pH_passed_failed) !== normalizePassFail(expectedData.pH_passed_failed)) blockers.push(`lifecycle_ph_pass_preview_mismatch:${batchId || 'missing'}`);
    if (normalizePassFail(row?.verification_input_preview?.passed_failed) !== normalizePassFail(expectedData.passed_failed)) blockers.push(`lifecycle_batch_pass_preview_mismatch:${batchId || 'missing'}`);
  }

  if (preview?.inventory_deduction_ready !== false) blockers.push('inventory_deduction_should_remain_held');
  if (preview?.purchase_order_ready !== false) warnings.push('purchase_order_ready_unexpected_true');
  if (preview?.hub_fallback_required !== true) warnings.push('hub_fallback_required_flag_missing');

  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)].slice(0, 120),
    warnings: [...new Set(warnings.concat(preview?.warnings || []))].slice(0, 120),
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
  return filterEntity(base44, 'ProductionBatch', { batch_id: batchId }, '-created_date', 5);
}

async function findComplianceLogsForBatch(base44, batch) {
  const batchEntityId = safeId(batch?.id, 120);
  const batchDisplayId = safeId(batch?.batch_id, 180);
  const bySource = batchEntityId ? await filterEntity(base44, 'BatchComplianceLog', { source_production_batch_id: batchEntityId }, '-created_date', 10) : [];
  const byBatch = batchDisplayId ? await filterEntity(base44, 'BatchComplianceLog', { batch_id: batchDisplayId }, '-created_date', 10) : [];
  return [...new Map([...bySource, ...byBatch].map(row => [row.id, row])).values()];
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
    actual_units: roundQuantity(batch?.actual_units, 3),
    previous_status: safeText(previousStatus || batch?.status, 80) || null,
    status: safeText(batch?.status, 80) || null,
    actual_start_time: safeText(batch?.actual_start_time, 80) || null,
    actual_end_time: safeText(batch?.actual_end_time, 80) || null,
    verified_at: safeText(batch?.verified_at, 80) || null,
    started_by_present: Boolean(batch?.started_by),
    completed_by_present: Boolean(batch?.completed_by),
    verified_by_present: Boolean(batch?.verified_by),
    compliance_log_id_present: Boolean(batch?.compliance_log_id),
    pH_result: roundQuantity(batch?.pH_result, 3),
    pH_passed_failed: safeText(batch?.pH_passed_failed, 40) || null,
    passed_failed: safeText(batch?.passed_failed, 40) || null,
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
    if (roundQuantity(batch?.planned_units, 3) !== EXPECTED_BATCH_UNITS[batchId]) batchBlockers.push('planned_units_mismatch');
    if (!batchHasTargetSource(batch)) batchBlockers.push('target_order_source_missing');
    if (batch?.is_locked === true) batchBlockers.push('batch_locked');
    if (status !== 'completed_pending_verification') batchBlockers.push('status_not_completed_pending_verification');
    if (!batch?.actual_start_time) batchBlockers.push('missing_actual_start_time');
    if (!batch?.actual_end_time || !batch?.completed_by) batchBlockers.push('missing_completion_metadata');
    if (roundQuantity(batch?.actual_units, 3) === null) batchBlockers.push('missing_actual_units');
    if (batch?.verified_at || batch?.verified_by || batch?.compliance_log_id || status === 'verified_logged') batchBlockers.push('already_verified_logged');
    if (status === 'archived') batchBlockers.push('terminal_lifecycle_state');

    const complianceMatches = await findComplianceLogsForBatch(base44, batch);
    if (complianceMatches.length > 0) batchBlockers.push('existing_batch_compliance_log');

    if (batchBlockers.length > 0) {
      blockers.push(`lifecycle_conflict:${batchId}`);
      conflicts.push({ batch_id: batchId, product_name: productName, status: safeText(batch?.status, 80) || null, blockers: batchBlockers });
    }
    batches.push(batch);
  }

  if (blockers.length > 0) return { ready: false, blockers: uniqueStrings(blockers, 120), conflicts, batches };
  return { ready: true, blockers: [], conflicts: [], batches };
}

function safeIngredientRows(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map(row => {
    const source = safeObject(row);
    return {
      ingredient_name: safeText(source.ingredient_name || source.name, 160),
      quantity: roundQuantity(source.quantity, 4),
      unit: safeText(source.unit, 40),
      lot_number: safeText(source.lot_number, 120),
    };
  }).filter(row => row.ingredient_name);
}

function buildComplianceLogRecord({ batch, verificationData, verifiedBy, verifiedAt }) {
  return {
    date: safeText(batch?.production_date, 40),
    batch_id: safeId(batch?.batch_id, 180),
    juice_flavor: safeText(batch?.product_name, 120),
    ingredients: safeIngredientRows(batch?.ingredients_used),
    start_time: safeText(batch?.actual_start_time, 80),
    end_time: safeText(batch?.actual_end_time, 80),
    quantity_produced: roundQuantity(batch?.actual_units, 3),
    staff_on_duty: safeStringArray(verificationData?.staff_on_duty || batch?.staff_on_duty, 120),
    pH_result: roundQuantity(verificationData?.pH_result, 3),
    passed_failed: normalizePassFail(verificationData?.passed_failed),
    notes: safeText(verificationData?.verification_notes, 600),
    verified_by: safeActorEmail(verifiedBy) || safeText(verifiedBy, 120),
    verified_at: safeText(verifiedAt, 80),
    source_production_batch_id: safeId(batch?.id, 120) || null,
    locked: true,
  };
}

function validateComplianceLogRecord(record) {
  const blockers = [];
  const allowed = new Set(['date', 'batch_id', 'juice_flavor', 'ingredients', 'start_time', 'end_time', 'quantity_produced', 'staff_on_duty', 'pH_result', 'passed_failed', 'notes', 'verified_by', 'verified_at', 'source_production_batch_id', 'locked']);
  for (const key of Object.keys(record || {})) if (!allowed.has(key)) blockers.push(`unapproved_batch_compliance_log_field:${key}`);
  if (!safeText(record.date, 40)) blockers.push('compliance_log_date_required');
  if (!safeId(record.batch_id, 180)) blockers.push('compliance_log_batch_id_required');
  if (!safeText(record.juice_flavor, 120)) blockers.push('compliance_log_juice_flavor_required');
  if (roundQuantity(record.quantity_produced, 3) === null) blockers.push('compliance_log_quantity_produced_required');
  if (roundQuantity(record.pH_result, 3) === null) blockers.push('compliance_log_ph_result_required');
  if (!normalizePassFail(record.passed_failed)) blockers.push('compliance_log_passed_failed_required');
  if (!safeText(record.verified_by, 120)) blockers.push('compliance_log_verified_by_required');
  if (!safeText(record.verified_at, 80)) blockers.push('compliance_log_verified_at_required');
  if (record.locked !== true) blockers.push('compliance_log_must_be_locked');
  return blockers;
}

function buildVerifyPatch({ batch, verificationData, complianceLogId, commandLogId, verifiedBy, verifiedAt, requestId, now }) {
  const existingTrail = Array.isArray(batch.audit_trail) ? batch.audit_trail.slice(-100) : [];
  const existingCommandIds = Array.isArray(batch.command_log_ids) ? batch.command_log_ids.map(id => safeId(id, 120)).filter(Boolean).slice(-40) : [];
  const commandIds = commandLogId ? [...new Set([...existingCommandIds, safeId(commandLogId, 120)])] : existingCommandIds;
  return {
    status: 'verified_logged',
    verified_at: safeText(verifiedAt, 80),
    verified_by: safeActorEmail(verifiedBy) || safeText(verifiedBy, 120),
    pH_result: roundQuantity(verificationData?.pH_result, 3),
    pH_passed_failed: normalizePassFail(verificationData?.pH_passed_failed),
    passed_failed: normalizePassFail(verificationData?.passed_failed),
    compliance_log_id: safeId(complianceLogId, 120),
    audit_trail: [
      ...existingTrail,
      {
        timestamp: now,
        action: 'production_batch_verify',
        performed_by: safeActorEmail(verifiedBy) || safeText(verifiedBy, 120),
        before: { status: safeText(batch?.status, 80) || null },
        after: { status: 'verified_logged' },
        reason: 'G37H gated exact-order native Verify Production QC command',
        request_id: safeId(requestId, 160) || null,
        command_log_id: safeId(commandLogId, 120) || null,
        compliance_log_id: safeId(complianceLogId, 120) || null,
      },
    ],
    ...(commandIds.length > 0 ? { command_log_ids: commandIds } : {}),
  };
}

function validateVerifyPatch(patch) {
  const blockers = [];
  const allowed = new Set(['status', 'verified_at', 'verified_by', 'pH_result', 'pH_passed_failed', 'passed_failed', 'compliance_log_id', 'audit_trail', 'command_log_ids']);
  for (const key of Object.keys(patch || {})) if (!allowed.has(key)) blockers.push(`unapproved_production_batch_verify_field:${key}`);
  if (patch.status !== 'verified_logged') blockers.push('status_must_be_verified_logged');
  if (!safeText(patch.verified_at, 80)) blockers.push('verified_at_required');
  if (!safeText(patch.verified_by, 120)) blockers.push('verified_by_required');
  if (roundQuantity(patch.pH_result, 3) === null) blockers.push('ph_result_required');
  if (!normalizePassFail(patch.pH_passed_failed)) blockers.push('ph_passed_failed_required');
  if (!normalizePassFail(patch.passed_failed)) blockers.push('passed_failed_required');
  if (!safeId(patch.compliance_log_id, 120)) blockers.push('compliance_log_id_required');
  if (!Array.isArray(patch.audit_trail) || patch.audit_trail.length === 0) blockers.push('audit_trail_required');
  if ('ingredients_used' in patch || 'inventory_deduction_log_id' in patch || 'production_status' in patch || 'actual_units' in patch || 'actual_end_time' in patch || 'is_locked' in patch) {
    blockers.push('forbidden_inventory_completion_or_lock_field_present');
  }
  return blockers;
}

async function verifyProductionBatches({ base44, batches, verificationDataByBatchId, commandLogId, verifiedBy, verifiedAt, requestId }) {
  const updatedRows = [];
  const complianceRows = [];
  const now = new Date().toISOString();
  for (const batch of batches) {
    const previousStatus = safeText(batch?.status, 80) || null;
    const batchId = safeId(batch?.batch_id, 180);
    const verificationData = verificationDataByBatchId[batchId];
    const complianceRecord = buildComplianceLogRecord({ batch, verificationData, verifiedBy, verifiedAt });
    const complianceBlockers = validateComplianceLogRecord(complianceRecord);
    if (complianceBlockers.length > 0) {
      const error = new Error(`BatchComplianceLog verify record validation failed: ${complianceBlockers.join(',')}`);
      error.code = 'batch_compliance_log_verify_record_invalid';
      throw error;
    }
    const complianceLog = await base44.asServiceRole.entities.BatchComplianceLog.create(complianceRecord);
    complianceRows.push({
      id: safeId(complianceLog?.id, 120) || null,
      batch_id: complianceRecord.batch_id,
      juice_flavor: complianceRecord.juice_flavor,
      date: complianceRecord.date,
      pH_result: complianceRecord.pH_result,
      passed_failed: complianceRecord.passed_failed,
      source_production_batch_id: complianceRecord.source_production_batch_id,
      locked: complianceRecord.locked === true,
    });

    const patch = buildVerifyPatch({ batch, verificationData, complianceLogId: complianceLog?.id, commandLogId, verifiedBy, verifiedAt, requestId, now });
    const patchBlockers = validateVerifyPatch(patch);
    if (patchBlockers.length > 0) {
      const error = new Error(`ProductionBatch verify patch validation failed: ${patchBlockers.join(',')}`);
      error.code = 'production_batch_verify_patch_invalid';
      throw error;
    }
    const updated = await base44.asServiceRole.entities.ProductionBatch.update(batch.id, patch);
    updatedRows.push(summarizeBatch(updated, previousStatus));
  }
  return { updatedRows, complianceRows };
}

async function createCommandLog({ base44, status, idempotencyKey, requestId, user, verificationDataByBatchId, result, errorCode, errorMessage }) {
  const now = new Date().toISOString();
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: COMMAND_TYPE,
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
      policy: REQUIRED_POLICY,
      expected_batch_ids: EXPECTED_BATCH_IDS,
      expected_products: EXPECTED_PRODUCTS,
      verification_data_by_batch_id: Object.fromEntries(EXPECTED_BATCH_IDS.map(batchId => [batchId, {
        pH_result: roundQuantity(verificationDataByBatchId?.[batchId]?.pH_result, 3),
        pH_passed_failed: normalizePassFail(verificationDataByBatchId?.[batchId]?.pH_passed_failed),
        passed_failed: normalizePassFail(verificationDataByBatchId?.[batchId]?.passed_failed),
        verification_notes_present: Boolean(verificationDataByBatchId?.[batchId]?.verification_notes),
      }])),
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
    notes: 'G37H exact gated native Verify Production QC command. Updates only two exact completed_pending_verification ProductionBatch records with verified status/QC fields, creates one locked safe BatchComplianceLog per batch, and records audit metadata. No inventory deduction, PurchaseOrder, Customer App Order, ShopifyOrder, FulfillmentTask, delivery, provider, notification, sync, repair, replay, or Hub mutation.',
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
    ingredients_used_written: false,
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
    task_order_cascades_performed: false,
    route_proof_drop_delivery_mutated: false,
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
    const policyBlockers = validateExplicitPolicies(body);
    if (targetBlockers.length > 0 || policyBlockers.length > 0) {
      return jsonResponse({ success: false, skipped: true, error_code: 'exact_verify_target_required', blockers: uniqueStrings([...targetBlockers, ...policyBlockers], 120), writes_performed: false }, 409);
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
        production_batches_updated: false,
        batch_compliance_logs_created: false,
        duplicate_audit_entries_created: false,
        duplicate_compliance_logs_created: false,
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
        error_code: freshPreview.error_code || 'fresh_lifecycle_preview_failed',
        preview_status: freshPreview.status,
        writes_performed: false,
      }, freshPreview.status || 409);
    }

    const validation = validateFreshPreview(freshPreview.data, lookup);
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
        error_code: 'lifecycle_conflict',
        blockers: preflight.blockers,
        conflicts: preflight.conflicts,
        writes_performed: false,
      }, 409);
    }

    const commandLog = await createCommandLog({
      base44,
      status: 'running',
      idempotencyKey,
      requestId: lookup.requestId,
      user: auth.user,
      verificationDataByBatchId: lookup.verificationDataByBatchId,
      result: {
        writes_performed: false,
        projected_update_count: preflight.batches.length,
        projected_batch_ids: preflight.batches.map(batch => safeId(batch.batch_id, 180)),
        production_date: TARGET_PRODUCTION_DATE,
        compliance_logs_projected: preflight.batches.length,
        inventory_deducted: false,
        purchase_orders_created: false,
      },
    });

    let updatedRows = [];
    let complianceRows = [];
    try {
      const result = await verifyProductionBatches({
        base44,
        batches: preflight.batches,
        verificationDataByBatchId: lookup.verificationDataByBatchId,
        commandLogId: commandLog?.id,
        verifiedBy: lookup.verifiedBy,
        verifiedAt: lookup.verifiedAt,
        requestId: lookup.requestId,
      });
      updatedRows = result.updatedRows;
      complianceRows = result.complianceRows;
    } catch (error) {
      await updateCommandLog({
        base44,
        commandLogId: commandLog?.id,
        status: 'failed',
        result: {
          writes_performed: updatedRows.length > 0 || complianceRows.length > 0,
          partial_update_count: updatedRows.length,
          partial_compliance_log_count: complianceRows.length,
          updated_batches: updatedRows,
          compliance_logs_created: complianceRows,
          duplicate_audit_entries_created: false,
          duplicate_compliance_logs_created: false,
          ...safetyResult({ production_batches_updated: updatedRows.length > 0, production_verified: updatedRows.length > 0, batch_compliance_logs_created: complianceRows.length > 0, compliance_logs_created: complianceRows.length > 0 }),
        },
        errorCode: error?.code || 'production_batch_verify_write_failed',
        errorMessage: error?.message || 'ProductionBatch verify write failed',
      }).catch(() => null);
      return jsonResponse({
        success: false,
        skipped: false,
        error_code: error?.code || 'production_batch_verify_write_failed',
        message: 'Native ProductionBatch verify failed safely.',
        writes_performed: updatedRows.length > 0 || complianceRows.length > 0,
        partial_update_count: updatedRows.length,
        partial_compliance_log_count: complianceRows.length,
      }, 500);
    }

    await updateCommandLog({
      base44,
      commandLogId: commandLog?.id,
      status: 'success',
      result: {
        writes_performed: true,
        production_batches_updated: true,
        production_verified: true,
        batch_compliance_logs_created: true,
        batch_compliance_log_created: true,
        compliance_logs_created: true,
        updated_batch_count: updatedRows.length,
        batch_compliance_log_count: complianceRows.length,
        updated_batches: updatedRows,
        compliance_logs: complianceRows,
        production_date: TARGET_PRODUCTION_DATE,
        batch_ids: updatedRows.map(row => row.batch_id),
        status_from: 'completed_pending_verification',
        status_to: 'verified_logged',
        ...safetyResult({ production_batches_updated: true, production_verified: true, batch_compliance_logs_created: true, compliance_logs_created: true }),
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
      production_verified: true,
      batch_compliance_logs_created: true,
      batch_compliance_log_created: true,
      compliance_logs_created: true,
      updated_batch_count: updatedRows.length,
      batch_compliance_log_count: complianceRows.length,
      updated_batches: updatedRows,
      compliance_logs: complianceRows,
      status_from: 'completed_pending_verification',
      status_to: 'verified_logged',
      duplicate_audit_entries_created: false,
      duplicate_compliance_logs_created: false,
      inventory_deducted: false,
      purchase_orders_created: false,
      ingredients_used_written: false,
      task_order_cascades_performed: false,
      notifications_created: false,
      provider_calls: false,
      stripe_calls: false,
      shopify_calls: false,
      notifications_sent: false,
      sync_retry_repair_run: false,
      customer_app_order_updated: false,
      native_shopify_order_updated: false,
      native_fulfillment_task_updated: false,
      hub_records_updated: false,
      safety: safetyResult({ production_batches_updated: true, production_verified: true, batch_compliance_logs_created: true, compliance_logs_created: true }),
    });
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] failed safely: ${error?.message || 'unknown error'}`);
    return jsonResponse({
      success: false,
      error_code: 'native_production_batch_verify_failed',
      message: 'Native ProductionBatch verify failed safely.',
      writes_performed: false,
    }, 500);
  }
});
