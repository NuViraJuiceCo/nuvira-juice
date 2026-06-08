import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const COMMAND_TYPE = 'native_production_batch_complete';
const FUNCTION_NAME = 'completeNativeProductionBatchesForCustomerApp';
const ENABLE_FLAG = 'ENABLE_NATIVE_PRODUCTION_BATCH_COMPLETE';
const KILL_SWITCH_FLAG = 'NATIVE_PRODUCTION_BATCH_COMPLETE_KILL_SWITCH';
const ALLOWED_EMAILS_FLAG = 'NATIVE_PRODUCTION_BATCH_COMPLETE_ALLOWED_EMAILS';
const ORDER_ALLOWLIST_FLAG = 'NATIVE_PRODUCTION_BATCH_COMPLETE_ORDER_ALLOWLIST';
const BATCH_ALLOWLIST_FLAG = 'NATIVE_PRODUCTION_BATCH_COMPLETE_BATCH_ALLOWLIST';
const POLICY_FLAG = 'NATIVE_PRODUCTION_BATCH_COMPLETE_POLICY';
const REQUIRED_POLICY = 'EXACT_BATCH_ACTUAL_UNITS_ONLY';
const CONFIRMATION_PHRASE = 'complete_native_production_batches_for_customer_app';
const TARGET_ORDER_NUMBER = 'NV-MPZNKGNT';
const TARGET_CUSTOMER_APP_ORDER_ID = '6a219a3f4adcda5856c3d579';
const TARGET_NATIVE_SHOPIFY_ORDER_ID = '6a22ffda400eb806eb3ca945';
const TARGET_NATIVE_FULFILLMENT_TASK_ID = '6a22ffdaf675ea79e30575aa';
const TARGET_PRODUCTION_DATE = '2026-06-05';
const TARGET_DELIVERY_DATE = '2026-06-06';
const MAX_TEXT = 180;
const MAX_ROWS = 20;

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

const ALLOWED_BODY_KEYS = new Set([
  'mode',
  'confirmation',
  'order_number',
  'shopify_order_number',
  'production_date',
  'expected_production_date',
  'expected_delivery_date',
  'expected_status',
  'batch_ids',
  'production_batch_ids',
  'batch_actual_units',
  'actual_units_by_batch_id',
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
  'actual_quantity_produced',
  'ingredients_used',
  'final_ingredients',
  'ingredient_lot_notes',
  'manual_ingredient_override',
  'bottles_produced',
  'bottles_rejected_or_wasted',
  'final_usable_quantity',
  'storage_location',
  'use_by_date',
  'pH_result',
  'ph_result',
  'ph_value',
  'pH_passed_failed',
  'ph_passed_failed',
  'passed_failed',
  'pH_meter_id',
  'ph_meter_id',
  'calibration_checked',
  'ccp_check_complete',
  'sanitation_verification_complete',
  'labels_applied',
  'corrective_action_required',
  'issue_identified',
  'detection_method',
  'product_involved',
  'action_taken',
  'disposed',
  'quantity_disposed',
  'preventive_steps',
  'compliance',
  'compliance_log',
  'batch_compliance_log',
  'staff_on_duty',
  'inventory_deduction',
  'deduct_inventory',
  'purchase_order',
  'create_purchase_order',
  'start_production',
  'verify_production',
  'pack_task',
  'bottle_order',
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
    if (/(^|_)(custom|raw|payload|provider|stripe|shopify|inventory|purchase|notification|sync|repair|replay|bulk|status|task|order|batch|recipe|route|proof|delivery|compliance|ingredient|ph|qc|verify|pack|bottle)($|_)/i.test(normalized)) {
      return key;
    }
    return key;
  }
  return null;
}

function parseActualUnitsMap(body) {
  const source = body?.batch_actual_units ?? body?.actual_units_by_batch_id;
  const blockers = [];
  const actualUnitsByBatchId = {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return { actualUnitsByBatchId, blockers: ['batch_actual_units_required'] };
  }

  for (const [rawBatchId, rawUnits] of Object.entries(source)) {
    const batchId = safeId(rawBatchId, 180);
    if (!batchId) {
      blockers.push('invalid_actual_units_batch_id');
      continue;
    }
    const units = safeNumber(rawUnits);
    if (units === null || units < 0) {
      blockers.push(`invalid_actual_units:${batchId}`);
      continue;
    }
    actualUnitsByBatchId[batchId] = roundQuantity(units, 3);
  }

  const providedIds = Object.keys(actualUnitsByBatchId).sort();
  const missing = EXPECTED_BATCH_IDS.filter(batchId => !(batchId in actualUnitsByBatchId));
  const extra = providedIds.filter(batchId => !EXPECTED_BATCH_IDS.includes(batchId));
  if (missing.length > 0) blockers.push(...missing.map(batchId => `missing_actual_units:${batchId}`));
  if (extra.length > 0) blockers.push(...extra.map(batchId => `unexpected_actual_units_batch:${batchId}`));
  if (providedIds.length !== EXPECTED_BATCH_IDS.length) blockers.push('exact_batch_actual_units_required');

  return {
    actualUnitsByBatchId,
    blockers: uniqueStrings(blockers, 80),
  };
}

function getLookup(body) {
  return {
    orderNumber: normalizeText(body?.order_number || body?.shopify_order_number).replace(/^#/, ''),
    customerAppOrderId: safeId(body?.customer_app_order_id || body?.base44_order_id, 120),
    nativeShopifyOrderId: safeId(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id, 120),
    nativeFulfillmentTaskId: safeId(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id, 120),
    productionDate: normalizeText(body?.production_date || body?.expected_production_date),
    expectedDeliveryDate: normalizeText(body?.expected_delivery_date),
    expectedStatus: normalizeLower(body?.expected_status || 'in_production'),
    expectedPreviewHash: safeId(body?.expected_preview_hash, 180),
    requestId: safeId(body?.request_id, 160),
    batchIds: parseStringList(body?.batch_ids || body?.production_batch_ids),
    ...parseActualUnitsMap(body),
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

function exactTargetBlockers(lookup) {
  const blockers = [];
  if (lookup.orderNumber !== TARGET_ORDER_NUMBER) blockers.push('target_order_number_mismatch');
  if (lookup.productionDate !== TARGET_PRODUCTION_DATE) blockers.push('target_production_date_mismatch');
  if (lookup.expectedDeliveryDate && lookup.expectedDeliveryDate !== TARGET_DELIVERY_DATE) blockers.push('expected_delivery_date_mismatch');
  if (lookup.expectedStatus && lookup.expectedStatus !== 'in_production') blockers.push('expected_status_must_be_in_production');
  if (lookup.customerAppOrderId && lookup.customerAppOrderId !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('target_customer_app_order_id_mismatch');
  if (lookup.nativeShopifyOrderId && lookup.nativeShopifyOrderId !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('target_native_shopify_order_id_mismatch');
  if (lookup.nativeFulfillmentTaskId && lookup.nativeFulfillmentTaskId !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('target_native_fulfillment_task_id_mismatch');
  if (lookup.batchIds.length !== EXPECTED_BATCH_IDS.length || !sameStringArray(lookup.batchIds, EXPECTED_BATCH_IDS)) {
    blockers.push('target_batch_ids_mismatch');
  }
  if (lookup.blockers?.length > 0) blockers.push(...lookup.blockers);
  return uniqueStrings(blockers, 80);
}

function gateFailure({ actorEmail, lookup }) {
  if (Deno.env.get(KILL_SWITCH_FLAG) === 'true') return 'kill_switch_active';
  if (Deno.env.get(ENABLE_FLAG) !== 'true') return 'native_production_batch_complete_disabled';
  if (normalizeText(Deno.env.get(POLICY_FLAG)) !== REQUIRED_POLICY) return 'exact_batch_actual_units_policy_required';

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
  if (!EXPECTED_BATCH_IDS.every(batchId => batchAllowlist.has(normalizeLower(batchId)))) return 'target_batches_not_allowlisted';
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
      batch_actual_units: lookup.actualUnitsByBatchId,
      customer_app_order_id: lookup.customerAppOrderId || TARGET_CUSTOMER_APP_ORDER_ID,
      native_shopify_order_id: lookup.nativeShopifyOrderId || TARGET_NATIVE_SHOPIFY_ORDER_ID,
      native_fulfillment_task_id: lookup.nativeFulfillmentTaskId || TARGET_NATIVE_FULFILLMENT_TASK_ID,
      request_id: `${lookup.requestId || 'g31r'}:fresh_lifecycle_preview`,
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
  if (safeNumber(preview?.start_preview?.ready_count) !== 0) warnings.push('start_ready_count_unexpected_nonzero');
  if (safeNumber(preview?.complete_preview?.ready_count) !== EXPECTED_BATCH_IDS.length) blockers.push('unexpected_complete_ready_count');
  if (safeNumber(preview?.verify_preview?.ready_count) !== 0) warnings.push('verify_ready_count_unexpected_nonzero');
  if (rows.length !== EXPECTED_BATCH_IDS.length) blockers.push('target_lifecycle_rows_missing');
  if (!sameStringArray(rowIds, EXPECTED_BATCH_IDS)) blockers.push('unexpected_lifecycle_batch_ids');

  for (const row of rows) {
    const batchId = safeId(row?.batch_id, 180);
    const expectedProduct = EXPECTED_BATCH_PRODUCTS[batchId];
    if (!expectedProduct) blockers.push(`unexpected_lifecycle_batch:${batchId || 'missing'}`);
    if (safeText(row?.product_name, 120) !== expectedProduct) blockers.push(`lifecycle_product_mismatch:${batchId || 'missing'}`);
    if (row?.production_date !== TARGET_PRODUCTION_DATE) blockers.push(`lifecycle_production_date_mismatch:${batchId || 'missing'}`);
    if (roundQuantity(row?.planned_units, 3) !== 1) blockers.push(`lifecycle_planned_units_mismatch:${batchId || 'missing'}`);
    if (normalizeLower(row?.current_status || row?.status) !== 'in_production') blockers.push(`lifecycle_status_not_in_production:${batchId || 'missing'}`);
    if (!row?.actual_start_time) blockers.push(`lifecycle_missing_actual_start_time:${batchId || 'missing'}`);
    if (row?.is_locked === true) blockers.push(`lifecycle_batch_locked:${batchId || 'missing'}`);
    if (row?.can_start === true) warnings.push(`lifecycle_start_ready_unexpected:${batchId || 'missing'}`);
    if (row?.can_complete !== true) blockers.push(`lifecycle_batch_not_completable:${batchId || 'missing'}`);
    if (Array.isArray(row?.complete_blockers) && row.complete_blockers.length > 0) blockers.push(`lifecycle_complete_blockers:${batchId || 'missing'}`);
    if (row?.can_verify === true) warnings.push(`lifecycle_verify_ready_unexpected:${batchId || 'missing'}`);
    const expectedActualUnits = roundQuantity(lookup.actualUnitsByBatchId?.[batchId], 3);
    if (expectedActualUnits === null || roundQuantity(row?.completion_actual_units_preview, 3) !== expectedActualUnits) {
      blockers.push(`lifecycle_actual_units_preview_mismatch:${batchId || 'missing'}`);
    }
  }

  if (preview?.inventory_deduction_ready !== false) blockers.push('inventory_deduction_should_remain_held');
  if (preview?.purchase_order_ready !== false) warnings.push('purchase_order_ready_unexpected_true');
  if (preview?.hub_fallback_required !== true) warnings.push('hub_fallback_required_flag_missing');

  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)].slice(0, 100),
    warnings: [...new Set(warnings.concat(preview?.warnings || []))].slice(0, 100),
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
    started_by: safeText(batch?.started_by, 120) || null,
    completed_by: safeText(batch?.completed_by, 120) || null,
    skipped_reason: skippedReason,
  };
}

async function preflightTargetBatches(base44, lookup) {
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
    if (roundQuantity(batch?.planned_units, 3) !== 1) batchBlockers.push('planned_units_mismatch');
    if (!batchHasTargetSource(batch)) batchBlockers.push('target_order_source_missing');
    if (batch?.is_locked === true) batchBlockers.push('batch_locked');
    if (!batch?.actual_start_time) batchBlockers.push('missing_actual_start_time');
    if (status !== 'in_production' && status !== 'completed_pending_verification') batchBlockers.push('status_not_in_production_or_completed_pending_verification');
    if (['verified_logged', 'archived'].includes(status) || batch?.verified_at || batch?.verified_by || batch?.compliance_log_id) {
      batchBlockers.push('terminal_or_verified_lifecycle_state');
    }
    if (status === 'in_production' && (batch?.actual_end_time || batch?.completed_by)) {
      batchBlockers.push('already_completed');
    }
    const expectedActualUnits = lookup.actualUnitsByBatchId?.[batchId];
    if (status === 'completed_pending_verification') {
      if (roundQuantity(batch?.actual_units, 3) !== roundQuantity(expectedActualUnits, 3)) batchBlockers.push('already_completed_actual_units_mismatch');
      if (!batch?.actual_end_time || !batch?.completed_by) batchBlockers.push('already_completed_metadata_incomplete');
    }
    if (batchBlockers.length > 0) {
      blockers.push(`lifecycle_conflict:${batchId}`);
      conflicts.push({ batch_id: batchId, product_name: productName, status: safeText(batch?.status, 80) || null, blockers: batchBlockers });
    }
    batches.push(batch);
  }

  if (blockers.length > 0) return { ready: false, mode: 'blocked', blockers, conflicts, batches, rowsToUpdate: [], alreadyCompletedRows: [] };

  const inProduction = batches.filter(batch => normalizeLower(batch?.status) === 'in_production');
  const completed = batches.filter(batch => normalizeLower(batch?.status) === 'completed_pending_verification');
  if (inProduction.length === EXPECTED_BATCH_IDS.length) {
    return { ready: true, mode: 'complete', blockers: [], conflicts: [], batches, rowsToUpdate: inProduction, alreadyCompletedRows: [] };
  }
  if (completed.length === EXPECTED_BATCH_IDS.length) {
    return { ready: true, mode: 'already_completed', blockers: [], conflicts: [], batches, rowsToUpdate: [], alreadyCompletedRows: completed };
  }

  return {
    ready: false,
    mode: 'blocked',
    blockers: ['partial_lifecycle_conflict'],
    conflicts: batches.map(batch => ({ batch_id: safeId(batch?.batch_id, 180), status: safeText(batch?.status, 80), reason: 'mixed_in_production_and_completed_state' })),
    batches,
    rowsToUpdate: [],
    alreadyCompletedRows: completed,
  };
}

function buildCompletePatch({ batch, actualUnits, commandLogId, actorEmail, requestId, now }) {
  const existingTrail = Array.isArray(batch.audit_trail) ? batch.audit_trail.slice(-100) : [];
  const existingCommandIds = Array.isArray(batch.command_log_ids) ? batch.command_log_ids.map(id => safeId(id, 120)).filter(Boolean).slice(-40) : [];
  const commandIds = commandLogId ? [...new Set([...existingCommandIds, safeId(commandLogId, 120)])] : existingCommandIds;
  return {
    status: 'completed_pending_verification',
    actual_units: roundQuantity(actualUnits, 3),
    actual_end_time: now,
    completed_by: safeActorEmail(actorEmail) || 'native_admin_actor',
    audit_trail: [
      ...existingTrail,
      {
        timestamp: now,
        action: 'production_batch_complete',
        performed_by: safeActorEmail(actorEmail) || 'native_admin_actor',
        before: { status: safeText(batch?.status, 80) || null, actual_units: roundQuantity(batch?.actual_units, 3) },
        after: { status: 'completed_pending_verification', actual_units: roundQuantity(actualUnits, 3) },
        reason: 'G31R gated exact-order native Complete Production command',
        request_id: safeId(requestId, 160) || null,
        command_log_id: safeId(commandLogId, 120) || null,
      },
    ],
    ...(commandIds.length > 0 ? { command_log_ids: commandIds } : {}),
  };
}

function validateCompletePatch(patch) {
  const blockers = [];
  const allowed = new Set(['status', 'actual_units', 'actual_end_time', 'completed_by', 'audit_trail', 'command_log_ids']);
  for (const key of Object.keys(patch || {})) {
    if (!allowed.has(key)) blockers.push(`unapproved_production_batch_complete_field:${key}`);
  }
  if (patch.status !== 'completed_pending_verification') blockers.push('status_must_be_completed_pending_verification');
  if (roundQuantity(patch.actual_units, 3) === null || roundQuantity(patch.actual_units, 3) < 0) blockers.push('actual_units_required');
  if (!safeText(patch.actual_end_time, 80)) blockers.push('actual_end_time_required');
  if (!safeText(patch.completed_by, 120)) blockers.push('completed_by_required');
  if (!Array.isArray(patch.audit_trail) || patch.audit_trail.length === 0) blockers.push('audit_trail_required');
  if ('ingredients_used' in patch || 'pH_result' in patch || 'pH_passed_failed' in patch || 'passed_failed' in patch || 'compliance_log_id' in patch || 'inventory_deduction_log_id' in patch || 'verified_at' in patch || 'verified_by' in patch || 'production_status' in patch) {
    blockers.push('forbidden_verify_inventory_or_compliance_field_present');
  }
  return blockers;
}

async function updateProductionBatches({ base44, batches, actualUnitsByBatchId, commandLogId, actorEmail, requestId }) {
  const updatedRows = [];
  const now = new Date().toISOString();
  for (const batch of batches) {
    const previousStatus = safeText(batch?.status, 80) || null;
    const batchId = safeId(batch?.batch_id, 180);
    const patch = buildCompletePatch({ batch, actualUnits: actualUnitsByBatchId[batchId], commandLogId, actorEmail, requestId, now });
    const patchBlockers = validateCompletePatch(patch);
    if (patchBlockers.length > 0) {
      const error = new Error(`ProductionBatch complete patch validation failed: ${patchBlockers.join(',')}`);
      error.code = 'production_batch_complete_patch_invalid';
      throw error;
    }
    const updated = await base44.asServiceRole.entities.ProductionBatch.update(batch.id, patch);
    updatedRows.push(summarizeBatch(updated, previousStatus));
  }
  return updatedRows;
}

async function createCommandLog({ base44, status, idempotencyKey, requestId, user, actualUnitsByBatchId, result, errorCode, errorMessage }) {
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
      actual_units_by_batch_id: Object.fromEntries(EXPECTED_BATCH_IDS.map(batchId => [batchId, roundQuantity(actualUnitsByBatchId?.[batchId], 3)])),
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
    notes: 'G31R exact gated native Complete Production command. Updates only six exact in_production ProductionBatch records with actual_units, actual_end_time, completed_by, status completed_pending_verification, and audit metadata. No verify/compliance logs, ingredients_used, inventory deduction, PurchaseOrder, Customer App Order, ShopifyOrder, FulfillmentTask, provider, notification, sync, repair, replay, or Hub mutation.',
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
      return jsonResponse({ success: false, skipped: true, error_code: 'exact_complete_target_required', blockers: targetBlockers, writes_performed: false }, 409);
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

    const preflight = await preflightTargetBatches(base44, lookup);
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

    if (preflight.mode === 'already_completed') {
      const commandLog = await createCommandLog({
        base44,
        status: 'skipped',
        idempotencyKey,
        requestId: lookup.requestId,
        user: auth.user,
        actualUnitsByBatchId: lookup.actualUnitsByBatchId,
        result: {
          writes_performed: false,
          production_batches_updated: false,
          already_completed_count: preflight.alreadyCompletedRows.length,
          already_completed_rows: preflight.alreadyCompletedRows.map(batch => summarizeBatch(batch, batch.status, 'already_completed_pending_verification')),
          duplicate_audit_entries_created: false,
          ...safetyResult(),
        },
      });
      return jsonResponse({
        success: true,
        skipped: true,
        idempotent: false,
        reason: 'exact_native_batches_already_completed_pending_verification',
        request_id: lookup.requestId,
        idempotency_key: idempotencyKey,
        command_log_id: safeId(commandLog?.id, 120) || null,
        order_number: TARGET_ORDER_NUMBER,
        production_date: TARGET_PRODUCTION_DATE,
        writes_performed: false,
        production_batches_updated: false,
        updated_batch_count: 0,
        already_completed_count: preflight.alreadyCompletedRows.length,
        already_completed_rows: preflight.alreadyCompletedRows.map(batch => summarizeBatch(batch, batch.status, 'already_completed_pending_verification')),
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
      actualUnitsByBatchId: lookup.actualUnitsByBatchId,
      result: {
        writes_performed: false,
        projected_update_count: preflight.rowsToUpdate.length,
        projected_batch_ids: preflight.rowsToUpdate.map(batch => safeId(batch.batch_id, 180)),
        production_date: TARGET_PRODUCTION_DATE,
        compliance_logs_created: false,
        inventory_deducted: false,
        purchase_orders_created: false,
      },
    });

    let updatedRows = [];
    try {
      updatedRows = await updateProductionBatches({
        base44,
        batches: preflight.rowsToUpdate,
        actualUnitsByBatchId: lookup.actualUnitsByBatchId,
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
          writes_performed: updatedRows.length > 0,
          partial_update_count: updatedRows.length,
          updated_batches: updatedRows,
          duplicate_audit_entries_created: false,
          ...safetyResult({ production_batches_updated: updatedRows.length > 0, production_completed: updatedRows.length > 0 }),
        },
        errorCode: error?.code || 'production_batch_complete_write_failed',
        errorMessage: error?.message || 'ProductionBatch complete write failed',
      }).catch(() => null);
      return jsonResponse({
        success: false,
        skipped: false,
        error_code: error?.code || 'production_batch_complete_write_failed',
        message: 'Native ProductionBatch complete failed safely.',
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
        production_completed: true,
        updated_batch_count: updatedRows.length,
        updated_batches: updatedRows,
        production_date: TARGET_PRODUCTION_DATE,
        batch_ids: updatedRows.map(row => row.batch_id),
        status_from: 'in_production',
        status_to: 'completed_pending_verification',
        actual_units_by_batch_id: Object.fromEntries(updatedRows.map(row => [row.batch_id, row.actual_units])),
        ...safetyResult({ production_batches_updated: true, production_completed: true }),
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
      production_completed: true,
      updated_batch_count: updatedRows.length,
      updated_batches: updatedRows,
      status_from: 'in_production',
      status_to: 'completed_pending_verification',
      duplicate_audit_entries_created: false,
      inventory_deducted: false,
      purchase_orders_created: false,
      compliance_logs_created: false,
      batch_compliance_logs_created: false,
      ingredients_used_written: false,
      provider_calls: false,
      stripe_calls: false,
      shopify_calls: false,
      notifications_sent: false,
      sync_retry_repair_run: false,
      customer_app_order_updated: false,
      native_shopify_order_updated: false,
      native_fulfillment_task_updated: false,
      hub_records_updated: false,
      safety: safetyResult({ production_batches_updated: true, production_completed: true }),
    });
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] failed safely: ${error?.message || 'unknown error'}`);
    return jsonResponse({
      success: false,
      error_code: 'native_production_batch_complete_failed',
      message: 'Native ProductionBatch complete failed safely.',
      writes_performed: false,
    }, 500);
  }
});
