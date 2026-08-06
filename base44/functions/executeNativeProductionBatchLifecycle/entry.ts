import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const COMMAND_TYPE = 'native_production_batch_lifecycle';
const SOURCE = 'customer_app_native_admin';
const ENABLE_WRITES_FLAG = 'ENABLE_NATIVE_PRODUCTION_BATCH_LIFECYCLE_WRITES';
const ALLOWED_EMAILS_FLAG = 'NATIVE_PRODUCTION_BATCH_LIFECYCLE_ALLOWED_EMAILS';
const TEST_BATCH_ALLOWLIST_FLAG = 'NATIVE_PRODUCTION_BATCH_LIFECYCLE_TEST_BATCH_ALLOWLIST';
const ALLOWED_ACTIONS_FLAG = 'NATIVE_PRODUCTION_BATCH_LIFECYCLE_ALLOWED_ACTIONS';
const KILL_SWITCH_FLAG = 'NATIVE_PRODUCTION_BATCH_LIFECYCLE_KILL_SWITCH';
const CONFIRMATION_PHRASE = 'execute_native_production_batch_lifecycle';
const ALLOWED_ACTIONS = new Set(['start', 'complete', 'verify']);
const STARTABLE_STATUSES = new Set(['planned', 'ready_for_production']);
const COMPLETABLE_STATUSES = new Set(['in_production']);
const VERIFYABLE_STATUSES = new Set(['completed_pending_verification']);
const SAFE_ARRAY_LIMIT = 50;
const MAX_REASON_LENGTH = 300;
const ALLOWED_BODY_KEYS = new Set([
  'mode',
  'confirmation',
  'production_batch_id',
  'batch_id',
  'action',
  'request_id',
  'reason',
  'actual_units',
  'actual_quantity_produced',
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
  'pH_meter_id',
  'ph_meter_id',
  'calibration_checked',
  'ccp_check_complete',
  'sanitation_verification_complete',
  'labels_applied',
  'passed_failed',
  'staff_on_duty',
  'corrective_action_required',
  'verification_notes',
]);
const FORBIDDEN_BODY_KEYS = new Set([
  'raw_payload',
  'payload',
  'raw_body',
  'raw_batch',
  'batch',
  'raw_order',
  'order',
  'order_update',
  'customer_app_order_update',
  'shopify_order_update',
  'fulfillment_task_update',
  'inventory_update',
  'purchase_order_update',
  'review_queue_update',
  'compliance_log',
  'compliance_log_update',
  'batch_compliance_log',
  'batch_compliance_log_update',
  'corrective_action_log',
  'status_history',
  'notification',
  'send_notification',
  'notify_customer',
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
  'bulk_ids',
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

function sanitizeText(value, maxLength = 160) {
  const text = normalizeSingleLine(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');

  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function sanitizeId(value, maxLength = 180) {
  const text = sanitizeText(value, maxLength);
  return /^[A-Za-z0-9._:@/#-]+$/.test(text) ? text : '';
}

function normalizeRequiredId(value, fieldName) {
  const id = sanitizeId(value);
  if (!id) throw new Error(`${fieldName} is required`);
  return id;
}

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function isPositiveNumber(value) {
  const numberValue = safeNumber(value);
  return numberValue !== null && numberValue > 0;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function safeStringArray(value, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, SAFE_ARRAY_LIMIT).map((item) => sanitizeText(item, maxLength)).filter(Boolean);
}

function referenceList(value) {
  if (Array.isArray(value)) return value.map(item => sanitizeId(item)).filter(Boolean);
  return normalizeText(value).split(',').map(item => sanitizeId(item)).filter(Boolean);
}

function complianceRecordMatchesBatch(record, batch) {
  const sourceBatchId = sanitizeId(batch?.id);
  const displayBatchId = sanitizeId(batch?.batch_id);
  const sourceRefs = new Set([
    sanitizeId(record?.source_production_batch_id),
    ...referenceList(record?.related_source_production_batch_ids),
  ].filter(Boolean));
  const displayRefs = new Set([
    sanitizeId(record?.batch_id),
    ...referenceList(record?.related_batch_ids),
    ...referenceList(record?.batches_logged),
  ].filter(Boolean));
  return Boolean(
    (sourceBatchId && sourceRefs.has(sourceBatchId)) ||
    (displayBatchId && displayRefs.has(displayBatchId))
  );
}

function uniqueRecords(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter(row => {
    const key = sanitizeId(row?.id) || JSON.stringify([
      sanitizeId(row?.source_production_batch_id),
      sanitizeId(row?.batch_id),
      sanitizeText(row?.created_date, 80),
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function evaluatePreStartCompliance({ batch, sanitationLogs = [], dailyChecklists = [], temperatureLogs = [], unavailable = false }) {
  const sanitationMatches = uniqueRecords(sanitationLogs).filter(row => complianceRecordMatchesBatch(row, batch));
  const checklistMatches = uniqueRecords(dailyChecklists).filter(row => complianceRecordMatchesBatch(row, batch));
  const temperatureMatches = uniqueRecords(temperatureLogs).filter(row => complianceRecordMatchesBatch(row, batch));

  const sanitationReady = sanitationMatches.some(row => (
    row.cleaned === true &&
    row.sanitized === true &&
    normalizeLower(row.sanitizer_level) !== 'low'
  ));
  const checklistReady = checklistMatches.some(row => (
    ['complete', 'pre-production complete'].includes(normalizeLower(row.overall_status)) &&
    row.morning_fridge_temp_logged === true &&
    row.sanitizer_levels_checked === true &&
    row.equipment_sanitized === true &&
    row.work_areas_cleaned === true
  ));
  const temperatureReady = temperatureMatches.some(row => (
    row.within_range === true &&
    safeNumber(row.temperature) !== null
  ));

  const blockers = [];
  if (unavailable) blockers.push('pre_start_compliance_unavailable');
  if (!sanitationReady) blockers.push('pre_start_sanitation_missing_or_incomplete');
  if (!checklistReady) blockers.push('pre_start_daily_checklist_missing_or_incomplete');
  if (!temperatureReady) blockers.push('pre_start_temperature_missing_or_out_of_range');

  return {
    enforced: true,
    ready: blockers.length === 0,
    blockers,
    matched_record_counts: {
      sanitation: sanitationMatches.length,
      daily_checklist: checklistMatches.length,
      temperature: temperatureMatches.length,
    },
    ready_record_ids: {
      sanitation: sanitationMatches.filter(row => row.cleaned === true && row.sanitized === true).map(row => sanitizeId(row.id)).filter(Boolean).slice(0, 5),
      daily_checklist: checklistMatches.filter(row => ['complete', 'pre-production complete'].includes(normalizeLower(row.overall_status))).map(row => sanitizeId(row.id)).filter(Boolean).slice(0, 5),
      temperature: temperatureMatches.filter(row => row.within_range === true).map(row => sanitizeId(row.id)).filter(Boolean).slice(0, 5),
    },
  };
}

async function linkedComplianceRows(base44, entityName, batch) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity || typeof entity.filter !== 'function') throw new Error(`${entityName}_unavailable`);
  const sourceBatchId = sanitizeId(batch?.id);
  const displayBatchId = sanitizeId(batch?.batch_id);
  const results = await Promise.all([
    sourceBatchId ? entity.filter({ source_production_batch_id: sourceBatchId }, '-created_date', 20).catch(() => []) : [],
    displayBatchId ? entity.filter({ batch_id: displayBatchId }, '-created_date', 20).catch(() => []) : [],
  ]);
  return uniqueRecords(results.flat());
}

async function loadPreStartCompliance(base44, batch) {
  try {
    const [sanitationLogs, dailyChecklists, temperatureLogs] = await Promise.all([
      linkedComplianceRows(base44, 'SanitationLog', batch),
      linkedComplianceRows(base44, 'DailyChecklist', batch),
      linkedComplianceRows(base44, 'TemperatureLog', batch),
    ]);
    return evaluatePreStartCompliance({ batch, sanitationLogs, dailyChecklists, temperatureLogs });
  } catch {
    return evaluatePreStartCompliance({ batch, unavailable: true });
  }
}

function parseCsvSet(value) {
  return new Set(
    normalizeText(value)
      .split(',')
      .map((item) => normalizeLower(item))
      .filter(Boolean),
  );
}

async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function normalizeActorEmail(value) {
  const email = normalizeSingleLine(value).toLowerCase();
  if (!email || email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Authenticated admin email is unavailable');
  }
  return email;
}

function normalizeAction(value) {
  const action = normalizeLower(value);
  if (!ALLOWED_ACTIONS.has(action)) throw new Error('action must be start, complete, or verify');
  return action;
}

function findUnsupportedBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const key of Object.keys(body)) {
    const normalized = normalizeLower(key);
    if (ALLOWED_BODY_KEYS.has(normalized)) continue;
    if (FORBIDDEN_BODY_KEYS.has(normalized)) return key;
    if (/(^|_)(customer|order|task|batch|inventory|purchase_order|review_queue|delivery|route|proof|provider|compliance)_(id|ids|status|update|mutation|payload|name|email|phone|address|fields|url|file)$/i.test(normalized)) {
      return key;
    }
    if (/(^|_)(header|headers|authorization|auth|secret|token|api_key|api-key)$/i.test(normalized)) {
      return key;
    }
  }
  return null;
}

function envGateFailure({ action, batchKeys, actorEmail, batch }) {
  if (Deno.env.get(KILL_SWITCH_FLAG) === 'true') return 'kill_switch_active';
  if (Deno.env.get(ENABLE_WRITES_FLAG) !== 'true') return 'native_production_batch_lifecycle_writes_disabled';

  const allowedEmails = parseCsvSet(Deno.env.get(ALLOWED_EMAILS_FLAG) || '');
  if (allowedEmails.size === 0) return 'allowed_email_gate_required';
  if (!allowedEmails.has(normalizeLower(actorEmail))) return 'actor_email_not_allowlisted';

  const allowedActions = parseCsvSet(Deno.env.get(ALLOWED_ACTIONS_FLAG) || '');
  if (allowedActions.size === 0) return 'allowed_action_gate_required';
  if (!allowedActions.has(action)) return 'action_not_allowlisted';

  const requestedBatchKeys = Array.isArray(batchKeys)
    ? batchKeys.map(normalizeLower).filter(Boolean)
    : [];
  if (requestedBatchKeys.length === 0) return 'production_batch_id_or_batch_id_required';
  if (isInternalTestBatch(batch)) {
    const testBatches = parseCsvSet(Deno.env.get(TEST_BATCH_ALLOWLIST_FLAG) || '');
    if (testBatches.size === 0) return 'test_batch_allowlist_required';
    if (!requestedBatchKeys.some(batchKey => testBatches.has(batchKey))) return 'test_batch_not_allowlisted';
  }

  return null;
}

function testBatchMarkerFailure({ batchKeys, batch }) {
  const testBatches = parseCsvSet(Deno.env.get(TEST_BATCH_ALLOWLIST_FLAG) || '');
  const requestedBatchKeys = Array.isArray(batchKeys)
    ? batchKeys.map(normalizeLower).filter(Boolean)
    : [];
  const usesTestAllowlist = requestedBatchKeys.some(batchKey => testBatches.has(batchKey));
  if (usesTestAllowlist && !isInternalTestBatch(batch)) return 'test_batch_allowlist_requires_test_marker';
  return null;
}

function isInternalTestBatch(batch) {
  const batchId = normalizeLower(batch?.batch_id || batch?.id);
  const sourceSystem = normalizeLower(batch?.source_system);
  const ownerStatus = normalizeLower(batch?.native_owner_status);
  const testPurpose = normalizeLower(batch?.test_purpose);
  return batch?.is_test_batch === true ||
    batchId.includes('-test-') ||
    sourceSystem.includes('internal_validation') ||
    ownerStatus.includes('internal_test') ||
    testPurpose.includes('internal validation');
}

function appendCommonGuards(batch, blockers, warnings) {
  if (!sanitizeId(batch.id) && !sanitizeId(batch.batch_id)) blockers.push('missing_batch_identity');
  if (!sanitizeText(batch.product_name, 120)) blockers.push('missing_product_name');
  if (!sanitizeText(batch.production_date, 40)) blockers.push('missing_production_date');
  if (batch.is_locked === true) blockers.push('batch_locked');
  if (batch.inventory_deduction_log_id) warnings.push('inventory_deduction_already_linked');
  if (batch.source_system && normalizeLower(batch.source_system).includes('hub')) warnings.push('legacy_hub_mirrored_batch');
}

function auditTrailAppend({ action, actorEmail, requestId, now, reason }) {
  return {
    timestamp: now,
    action: `production_batch_${action}`,
    performed_by: sanitizeText(actorEmail, 120) || 'native_admin_actor',
    reason: sanitizeText(reason, MAX_REASON_LENGTH) || 'Native production batch lifecycle command',
    request_id: sanitizeId(requestId) || null,
  };
}

function normalizePassFail(value) {
  const text = normalizeLower(value);
  return ['passed', 'failed'].includes(text) ? text : '';
}

function safeIngredientRows(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, SAFE_ARRAY_LIMIT).map(row => {
    const source = safeObject(row);
    return {
      ingredient_name: sanitizeText(source.ingredient_name || source.name, 160),
      quantity: safeNumber(source.quantity),
      unit: sanitizeText(source.unit, 40),
      lot_number: sanitizeText(source.lot_number, 120),
    };
  }).filter(row => row.ingredient_name);
}

function batchSetupBlockers(batch) {
  const blockers = [];
  if (safeStringArray(batch?.staff_on_duty).length === 0) blockers.push('batch_setup_staff_missing');
  if (safeStringArray(batch?.equipment_used).length === 0) blockers.push('batch_setup_equipment_missing');
  if (!sanitizeText(batch?.formula_or_recipe_used, 240)) blockers.push('batch_setup_recipe_missing');
  if (!sanitizeText(batch?.bottle_size, 80)) blockers.push('batch_setup_bottle_size_missing');
  const rawIngredients = Array.isArray(batch?.ingredients_used) ? batch.ingredients_used : [];
  if (rawIngredients.length === 0) {
    blockers.push('batch_setup_ingredients_missing');
  } else {
    const completeIngredients = safeIngredientRows(rawIngredients);
    const allComplete = completeIngredients.length === rawIngredients.length && completeIngredients.every(row => (
      row.ingredient_name && Number.isFinite(row.quantity) && row.quantity > 0 && row.unit && row.lot_number
    ));
    if (!allComplete) blockers.push('batch_setup_ingredient_details_incomplete');
  }
  return blockers;
}

function planStart({ batch, actorEmail, requestId, now, reason, preStartCompliance }) {
  const blockers = [];
  const warnings = [];
  appendCommonGuards(batch, blockers, warnings);
  const currentStatus = normalizeLower(batch.status);
  if (!STARTABLE_STATUSES.has(currentStatus)) blockers.push('status_not_startable');
  if (batch.actual_start_time) blockers.push('already_started');
  if (batch.actual_end_time || batch.completed_by) blockers.push('already_completed');
  if (batch.compliance_log_id || batch.verified_at || batch.verified_by) blockers.push('already_verified_logged');
  blockers.push(...batchSetupBlockers(batch));
  if (preStartCompliance?.enforced !== true) {
    blockers.push('pre_start_compliance_unavailable');
  } else {
    blockers.push(...safeStringArray(preStartCompliance.blockers));
  }

  const proposedPatch = blockers.length ? null : {
    status: 'in_production',
    actual_start_time: now,
    started_by: sanitizeText(actorEmail, 120) || 'native_admin_actor',
    audit_trail_append: auditTrailAppend({ action: 'start', actorEmail, requestId, now, reason }),
  };

  return {
    projected_writes: blockers.length ? [] : ['ProductionBatch.status', 'ProductionBatch.actual_start_time', 'ProductionBatch.started_by', 'ProductionBatch.audit_trail'],
    proposed_patch: proposedPatch,
    blockers,
    warnings,
  };
}

function planComplete({ batch, actorEmail, requestId, now, body, reason }) {
  const blockers = [];
  const warnings = [];
  appendCommonGuards(batch, blockers, warnings);
  const currentStatus = normalizeLower(batch.status);
  if (!COMPLETABLE_STATUSES.has(currentStatus)) blockers.push('status_not_completable');
  if (!batch.actual_start_time) blockers.push('missing_actual_start_time');
  if (batch.actual_end_time || batch.completed_by) blockers.push('already_completed');
  if (batch.compliance_log_id || batch.verified_at || batch.verified_by) blockers.push('already_verified_logged');

  const actualUnits = body.actual_units ?? body.actual_quantity_produced ?? batch.actual_units;
  if (!isPositiveNumber(actualUnits)) blockers.push('missing_actual_units');

  const bottlesProduced = safeNumber(body.bottles_produced ?? batch.bottles_produced);
  const bottlesRejectedOrWasted = safeNumber(body.bottles_rejected_or_wasted ?? batch.bottles_rejected_or_wasted);
  const finalUsableQuantity = safeNumber(body.final_usable_quantity ?? batch.final_usable_quantity);
  const storageLocation = sanitizeText(body.storage_location ?? batch.storage_location, 120);
  const useByDate = sanitizeText(body.use_by_date ?? batch.use_by_date, 40);

  if (bottlesProduced === null) warnings.push('bottles_produced_not_provided');
  if (finalUsableQuantity === null) warnings.push('final_usable_quantity_not_provided');
  if (!storageLocation) warnings.push('storage_location_not_provided');
  if (!useByDate) warnings.push('use_by_date_not_provided');

  const proposedPatch = blockers.length ? null : {
    status: 'completed_pending_verification',
    actual_end_time: now,
    completed_by: sanitizeText(actorEmail, 120) || 'native_admin_actor',
    actual_units: Number(actualUnits),
    ...(bottlesProduced !== null ? { bottles_produced: bottlesProduced } : {}),
    ...(bottlesRejectedOrWasted !== null ? { bottles_rejected_or_wasted: bottlesRejectedOrWasted } : {}),
    ...(finalUsableQuantity !== null ? { final_usable_quantity: finalUsableQuantity } : {}),
    ...(storageLocation ? { storage_location: storageLocation } : {}),
    ...(useByDate ? { use_by_date: useByDate } : {}),
    audit_trail_append: auditTrailAppend({ action: 'complete', actorEmail, requestId, now, reason }),
  };

  return {
    projected_writes: blockers.length ? [] : [
      'ProductionBatch.status',
      'ProductionBatch.actual_end_time',
      'ProductionBatch.completed_by',
      'ProductionBatch.actual_units',
      'ProductionBatch.audit_trail',
    ],
    proposed_patch: proposedPatch,
    blockers,
    warnings,
  };
}

function planVerify({ batch, actorEmail, requestId, now, body, reason }) {
  const blockers = [];
  const warnings = [];
  appendCommonGuards(batch, blockers, warnings);
  const currentStatus = normalizeLower(batch.status);
  if (!VERIFYABLE_STATUSES.has(currentStatus)) blockers.push('status_not_verifiable');
  if (!batch.actual_end_time && !batch.completed_by) blockers.push('missing_completion_metadata');
  if (batch.compliance_log_id || batch.verified_at || batch.verified_by) blockers.push('already_verified_logged');

  const pHResult = body.pH_result ?? body.ph_result ?? body.ph_value ?? batch.pH_result;
  const pHStatus = normalizePassFail(body.pH_passed_failed ?? body.ph_passed_failed ?? batch.pH_passed_failed);
  const passedFailed = normalizePassFail(body.passed_failed ?? batch.passed_failed);
  const pHMeterId = sanitizeText(body.pH_meter_id ?? batch.pH_meter_id, 120);
  const calibrationChecked = hasOwn(body, 'calibration_checked')
    ? body.calibration_checked === true
    : batch.calibration_checked === true;
  const ccpCheckComplete = hasOwn(body, 'ccp_check_complete')
    ? body.ccp_check_complete === true
    : batch.ccp_check_complete === true;
  const sanitationVerificationComplete = hasOwn(body, 'sanitation_verification_complete')
    ? body.sanitation_verification_complete === true
    : batch.sanitation_verification_complete === true;
  const labelsApplied = hasOwn(body, 'labels_applied')
    ? body.labels_applied === true
    : batch.labels_applied === true;
  const staffOnDuty = Array.isArray(body.staff_on_duty) ? body.staff_on_duty : (Array.isArray(batch.staff_on_duty) ? batch.staff_on_duty : []);
  const quantityProduced = safeNumber(batch.actual_units) ?? safeNumber(batch.final_usable_quantity);

  if (!isPositiveNumber(pHResult)) blockers.push('missing_ph_result');
  if (!pHStatus) blockers.push('missing_ph_pass_fail');
  if (!passedFailed) blockers.push('missing_batch_pass_fail');
  if (!pHMeterId) blockers.push('missing_ph_meter_id');
  if (!calibrationChecked) blockers.push('ph_meter_calibration_not_confirmed');
  if (!ccpCheckComplete) blockers.push('ccp_check_incomplete');
  if (!sanitationVerificationComplete) blockers.push('sanitation_verification_incomplete');
  if (!labelsApplied) blockers.push('labels_not_confirmed');
  if (pHStatus === 'failed' && passedFailed === 'passed') blockers.push('batch_cannot_pass_when_ph_fails');
  if (!isPositiveNumber(quantityProduced)) blockers.push('missing_quantity_produced_for_compliance_log');
  if (staffOnDuty.length === 0) warnings.push('staff_on_duty_not_provided');
  if (body.corrective_action_required === true || batch.corrective_action_required === true) {
    warnings.push('corrective_action_present_requires_admin_review');
  }
  if (!Array.isArray(batch.ingredients_used) || batch.ingredients_used.length === 0) {
    warnings.push('ingredients_used_not_present');
  }

  const complianceLogRecord = blockers.length ? null : {
    date: sanitizeText(batch.production_date, 40),
    batch_id: sanitizeId(batch.batch_id) || sanitizeId(batch.id),
    juice_flavor: sanitizeText(batch.product_name, 120),
    ingredients: safeIngredientRows(batch.ingredients_used),
    start_time: sanitizeText(batch.actual_start_time, 80),
    end_time: sanitizeText(batch.actual_end_time, 80),
    quantity_produced: Number(quantityProduced),
    staff_on_duty: safeStringArray(staffOnDuty),
    pH_result: Number(pHResult),
    passed_failed: passedFailed,
    notes: sanitizeText(body.verification_notes || reason, 1000),
    verified_by: sanitizeText(actorEmail, 120) || 'native_admin_actor',
    verified_at: now,
    source_production_batch_id: sanitizeId(batch.id) || null,
    locked: true,
      is_test_record: isInternalTestBatch(batch),
      ...(isInternalTestBatch(batch) ? { test_batch_id: sanitizeId(batch.batch_id) || sanitizeId(batch.id) } : {}),
  };

  const proposedPatch = blockers.length ? null : {
    status: 'verified_logged',
    verified_by: sanitizeText(actorEmail, 120) || 'native_admin_actor',
    verified_at: now,
    pH_result: Number(pHResult),
    pH_passed_failed: pHStatus,
    pH_meter_id: pHMeterId,
    calibration_checked: calibrationChecked,
    ccp_check_complete: ccpCheckComplete,
    sanitation_verification_complete: sanitationVerificationComplete,
    labels_applied: labelsApplied,
    passed_failed: passedFailed,
    audit_trail_append: auditTrailAppend({ action: 'verify', actorEmail, requestId, now, reason }),
  };

  return {
    projected_writes: blockers.length ? [] : [
      'BatchComplianceLog',
      'ProductionBatch.status',
      'ProductionBatch.verified_by',
      'ProductionBatch.verified_at',
      'ProductionBatch.pH_result',
      'ProductionBatch.pH_passed_failed',
      'ProductionBatch.pH_meter_id',
      'ProductionBatch.calibration_checked',
      'ProductionBatch.ccp_check_complete',
      'ProductionBatch.sanitation_verification_complete',
      'ProductionBatch.labels_applied',
      'ProductionBatch.passed_failed',
      'ProductionBatch.compliance_log_id',
      'ProductionBatch.audit_trail',
    ],
    proposed_patch: proposedPatch,
    compliance_log_record: complianceLogRecord,
    blockers,
    warnings,
  };
}

function planLifecycle({ action, batch, actorEmail, requestId, now, body, reason, preStartCompliance }) {
  if (action === 'start') return planStart({ batch, actorEmail, requestId, now, reason, preStartCompliance });
  if (action === 'complete') return planComplete({ batch, actorEmail, requestId, now, body, reason });
  return planVerify({ batch, actorEmail, requestId, now, body, reason });
}

function buildWritePatch(batch, proposedPatch) {
  const patch = { ...safeObject(proposedPatch) };
  const auditEntry = patch.audit_trail_append;
  delete patch.audit_trail_append;
  if (auditEntry) {
    const existingTrail = Array.isArray(batch.audit_trail) ? batch.audit_trail.slice(-100) : [];
    patch.audit_trail = [...existingTrail, auditEntry];
  }
  return patch;
}

async function findBatch(base44, batchKey) {
  const byId = await base44.asServiceRole.entities.ProductionBatch.get(batchKey).catch(() => null);
  if (byId?.id) return byId;

  const byBatchId = await base44.asServiceRole.entities.ProductionBatch.filter({ batch_id: batchKey }, '-created_date', 2).catch(() => []);
  if (Array.isArray(byBatchId) && byBatchId.length === 1) return byBatchId[0];
  if (Array.isArray(byBatchId) && byBatchId.length > 1) throw new Error('multiple_production_batch_matches');

  return null;
}

async function findExistingCommandLog(base44, idempotencyKey) {
  return base44.asServiceRole.entities.CommandLog.filter({ idempotency_key: idempotencyKey }, '-created_date', 1).catch(() => []);
}

async function createCommandLog({ base44, batch, action, status, idempotencyKey, requestId, user, result, errorCode, errorMessage }) {
  const now = new Date().toISOString();
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: COMMAND_TYPE,
    command_source: SOURCE,
    status,
    target_entity: 'ProductionBatch',
    target_id: batch?.id || null,
    target_display_id: sanitizeId(batch?.batch_id) || sanitizeId(batch?.id) || null,
    actor_email: sanitizeText(user?.email, 180) || null,
    actor_role: sanitizeText(user?.role, 80) || null,
    actor_type: 'admin',
    payload: {
      action,
      operational_batch_policy: 'authenticated_admin_and_lifecycle_gates',
      legacy_exact_batch_allowlist_required: false,
      test_batch_allowlist_enforced: isInternalTestBatch(batch),
      is_test_batch: isInternalTestBatch(batch),
      test_batch_id: isInternalTestBatch(batch) ? sanitizeId(batch?.batch_id) || sanitizeId(batch?.id) || null : null,
    },
    result,
    error_code: errorCode || null,
    error_message: errorMessage ? sanitizeText(errorMessage, 180) : null,
    idempotency_key: idempotencyKey,
    idempotent_skipped: status === 'skipped',
    request_id: requestId,
    submitted_at: now,
    completed_at: status === 'running' ? null : now,
    function_name: 'executeNativeProductionBatchLifecycle',
    notes: 'Native ProductionBatch lifecycle command for start/complete/verify. Verify may create one BatchComplianceLog and link it to the ProductionBatch. No inventory, PO, Customer App Order, ShopifyOrder, FulfillmentTask, notification, provider, sync, or repair writes.',
  });
}

async function updateCommandLog({ base44, commandLogId, status, result, errorCode, errorMessage }) {
  if (!commandLogId) return null;
  return base44.asServiceRole.entities.CommandLog.update(commandLogId, {
    status,
    result,
    error_code: errorCode || null,
    error_message: errorMessage ? sanitizeText(errorMessage, 180) : null,
    idempotent_skipped: status === 'skipped',
    completed_at: new Date().toISOString(),
  });
}

function safeBatchSummary(batch) {
  return {
    production_batch_id: sanitizeId(batch?.id) || null,
    batch_id: sanitizeId(batch?.batch_id) || null,
    product_name: sanitizeText(batch?.product_name, 120) || null,
    previous_status: sanitizeText(batch?.status, 80) || null,
    production_date: sanitizeText(batch?.production_date, 40) || null,
    is_test_batch: isInternalTestBatch(batch),
    test_purpose: isInternalTestBatch(batch) ? sanitizeText(batch?.test_purpose, 160) || null : null,
  };
}

function safePreStartComplianceSummary(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    enforced: value.enforced === true,
    ready: value.ready === true,
    blockers: safeStringArray(value.blockers),
    matched_record_counts: {
      sanitation: Number(value.matched_record_counts?.sanitation) || 0,
      daily_checklist: Number(value.matched_record_counts?.daily_checklist) || 0,
      temperature: Number(value.matched_record_counts?.temperature) || 0,
    },
    ready_record_ids: {
      sanitation: safeStringArray(value.ready_record_ids?.sanitation),
      daily_checklist: safeStringArray(value.ready_record_ids?.daily_checklist),
      temperature: safeStringArray(value.ready_record_ids?.temperature),
    },
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', error: 'Method not allowed' }, { status: 405 });
    }

    if (Deno.env.get(ENABLE_WRITES_FLAG) !== 'true') {
      return Response.json({
        success: false,
        skipped: true,
        error_code: 'native_production_batch_lifecycle_writes_disabled',
        native_writer_enabled: false,
        writes_performed: false,
      }, { status: 409 });
    }

    const base44 = createClientFromRequest(req);
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ success: false, error_code: 'unauthorized', error: 'Unauthorized' }, { status: 401 });
    }

    if (!user) return Response.json({ success: false, error_code: 'unauthorized', error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ success: false, error_code: 'forbidden', error: 'Forbidden' }, { status: 403 });

    const body = await readJsonBody(req);
    if (body === null) {
      return Response.json({ success: false, error_code: 'malformed_json', error: 'Malformed JSON' }, { status: 400 });
    }

    const unsupportedKey = findUnsupportedBodyKey(body);
    if (unsupportedKey) {
      return Response.json({ success: false, error_code: 'unsupported_field', error: `Unsupported field: ${unsupportedKey}` }, { status: 400 });
    }

    let batchKey;
    let batchKeys;
    let action;
    let requestId;
    let actorEmail;
    let reason;
    try {
      if (normalizeLower(body.mode) !== 'live') throw new Error('mode live is required');
      if (normalizeText(body.confirmation) !== CONFIRMATION_PHRASE) throw new Error('confirmation phrase is required');
      batchKeys = [sanitizeId(body.production_batch_id), sanitizeId(body.batch_id)].filter(Boolean);
      batchKey = batchKeys[0];
      if (!batchKey) throw new Error('production_batch_id or batch_id is required');
      action = normalizeAction(body.action);
      requestId = normalizeRequiredId(body.request_id, 'request_id');
      actorEmail = normalizeActorEmail(user.email);
      reason = sanitizeText(body.reason, MAX_REASON_LENGTH);
    } catch (error) {
      return Response.json({ success: false, error_code: 'invalid_input', error: error.message }, { status: 400 });
    }

    const batch = await findBatch(base44, batchKey);
    if (!batch) {
      return Response.json({
        success: false,
        skipped: true,
        error_code: 'production_batch_not_found',
        native_writer_enabled: true,
        writes_performed: false,
      }, { status: 404 });
    }
    const testMarkerFailure = testBatchMarkerFailure({ batchKeys, batch });
    if (testMarkerFailure) {
      return Response.json({
        success: false,
        skipped: true,
        error_code: testMarkerFailure,
        native_writer_enabled: true,
        writes_performed: false,
      }, { status: 409 });
    }

    const gateFailure = envGateFailure({ action, batchKeys, actorEmail, batch });
    if (gateFailure) {
      return Response.json({
        success: false,
        skipped: true,
        error_code: gateFailure,
        native_writer_enabled: true,
        writes_performed: false,
      }, { status: 409 });
    }

    const idempotencyKey = `${COMMAND_TYPE}:${requestId}`;
    const existingLogs = await findExistingCommandLog(base44, idempotencyKey);
    const existingLog = Array.isArray(existingLogs) && existingLogs.length > 0 ? existingLogs[0] : null;
    if (existingLog && ['success', 'skipped'].includes(normalizeLower(existingLog.status))) {
      return Response.json({
        success: true,
        skipped: true,
        idempotent: true,
        action,
        request_id: requestId,
        idempotency_key: idempotencyKey,
        native_writer_enabled: true,
        writes_performed: false,
        reason: 'idempotency_log_present',
      });
    }
    if (existingLog && normalizeLower(existingLog.status) === 'rejected') {
      return Response.json({
        success: false,
        skipped: true,
        idempotent: true,
        action,
        request_id: requestId,
        idempotency_key: idempotencyKey,
        error_code: existingLog.error_code || 'lifecycle_preflight_blocked',
        blockers: safeStringArray(existingLog.result?.blockers),
        warnings: safeStringArray(existingLog.result?.warnings),
        pre_start_compliance: existingLog.result?.pre_start_compliance || null,
        native_writer_enabled: true,
        writes_performed: false,
        reason: 'idempotent_rejected_command_replay',
      }, { status: 409 });
    }
    if (existingLog && ['pending', 'running'].includes(normalizeLower(existingLog.status))) {
      return Response.json({
        success: false,
        skipped: true,
        idempotent: true,
        action,
        request_id: requestId,
        idempotency_key: idempotencyKey,
        error_code: 'command_already_in_progress',
        native_writer_enabled: true,
        writes_performed: false,
      }, { status: 409 });
    }
    if (existingLog?.status === 'failed' && action === 'verify' && sanitizeId(existingLog.result?.compliance_log_id)) {
      return Response.json({
        success: false,
        skipped: true,
        action,
        request_id: requestId,
        idempotency_key: idempotencyKey,
        error_code: 'prior_failed_verify_requires_manual_review',
        blockers: ['prior_failed_verify_requires_manual_review'],
        native_writer_enabled: true,
        writes_performed: false,
      }, { status: 409 });
    }

    const now = new Date().toISOString();
    const preStartCompliance = action === 'start'
      ? await loadPreStartCompliance(base44, batch)
      : null;
    const plan = planLifecycle({ action, batch, actorEmail, requestId, now, body, reason, preStartCompliance });
    const blockers = safeStringArray(plan.blockers);
    const warnings = safeStringArray(plan.warnings);
    if (blockers.length > 0 || !plan.proposed_patch) {
      await createCommandLog({
        base44,
        batch,
        action,
        status: 'rejected',
        idempotencyKey,
        requestId,
        user,
        result: {
          blockers,
          warnings,
          pre_start_compliance: safePreStartComplianceSummary(preStartCompliance),
          writes_performed: false,
          native_writer_enabled: true,
        },
        errorCode: 'lifecycle_preflight_blocked',
        errorMessage: blockers.join(', '),
      });
      return Response.json({
        success: false,
        skipped: true,
        action,
        ...safeBatchSummary(batch),
        request_id: requestId,
        idempotency_key: idempotencyKey,
        error_code: 'lifecycle_preflight_blocked',
        blockers,
        warnings,
        pre_start_compliance: safePreStartComplianceSummary(preStartCompliance),
        native_writer_enabled: true,
        writes_performed: false,
      }, { status: 409 });
    }

    const writePatch = buildWritePatch(batch, plan.proposed_patch);
    const commandLog = await createCommandLog({
      base44,
      batch,
      action,
      status: 'running',
      idempotencyKey,
      requestId,
      user,
      result: {
        action,
        projected_writes: safeStringArray(plan.projected_writes),
        warnings,
        pre_start_compliance: safePreStartComplianceSummary(preStartCompliance),
        writes_performed: false,
        native_writer_enabled: true,
      },
    });

    let writtenBatch;
    let complianceLog = null;
    let writeStage = 'production_batch_update';
    try {
      if (action === 'verify') {
        if (!plan.compliance_log_record) throw new Error('Batch compliance log record unavailable');
        writeStage = 'batch_compliance_log_create';
        complianceLog = await base44.asServiceRole.entities.BatchComplianceLog.create(plan.compliance_log_record);
        const complianceLogId = sanitizeId(complianceLog?.id);
        if (!complianceLogId) throw new Error('BatchComplianceLog id unavailable');
        writePatch.compliance_log_id = complianceLogId;
      }
      writeStage = 'production_batch_update';
      writtenBatch = await base44.asServiceRole.entities.ProductionBatch.update(batch.id, writePatch);
    } catch (error) {
      await updateCommandLog({
        base44,
        commandLogId: commandLog?.id,
        status: 'failed',
        result: {
          action,
          projected_writes: safeStringArray(plan.projected_writes),
          warnings,
          pre_start_compliance: safePreStartComplianceSummary(preStartCompliance),
          writes_performed: false,
          native_writer_enabled: true,
          compliance_log_created: Boolean(complianceLog?.id),
          compliance_log_id: sanitizeId(complianceLog?.id) || null,
        },
        errorCode: writeStage === 'batch_compliance_log_create' ? 'batch_compliance_log_create_failed' : 'production_batch_update_failed',
        errorMessage: writeStage === 'batch_compliance_log_create' ? 'BatchComplianceLog create failed' : (error?.message || 'ProductionBatch update failed'),
      }).catch(() => null);
      throw error;
    }

    await updateCommandLog({
      base44,
      commandLogId: commandLog?.id,
      status: 'success',
      result: {
        action,
        projected_writes: safeStringArray(plan.projected_writes),
        warnings,
        pre_start_compliance: safePreStartComplianceSummary(preStartCompliance),
        writes_performed: true,
        native_writer_enabled: true,
        compliance_log_created: Boolean(complianceLog?.id),
        compliance_log_id: sanitizeId(complianceLog?.id) || null,
        inventory_deduction_run: false,
        purchase_order_updated: false,
        customer_notification_sent: false,
        external_service_calls: false,
      },
    });

    return Response.json({
      success: true,
      skipped: false,
      action,
      ...safeBatchSummary(batch),
      status: sanitizeText(writtenBatch?.status, 80) || null,
      request_id: requestId,
      idempotency_key: idempotencyKey,
      command_log_id: commandLog?.id || null,
      compliance_log_id: sanitizeId(complianceLog?.id) || null,
      projected_writes: safeStringArray(plan.projected_writes),
      warnings,
      pre_start_compliance: safePreStartComplianceSummary(preStartCompliance),
      native_writer_enabled: true,
      writes_performed: true,
      compliance_log_created: Boolean(complianceLog?.id),
      inventory_deduction_run: false,
      purchase_order_updated: false,
      customer_notification_sent: false,
      external_service_calls: false,
    });
  } catch {
    console.error('[executeNativeProductionBatchLifecycle] Error');
    return Response.json({
      success: false,
      error_code: 'internal_error',
      error: 'Unable to execute native production batch lifecycle command',
      writes_performed: false,
    }, { status: 500 });
  }
});
