const ALLOWED_ACTIONS = new Set(['start', 'complete', 'verify']);
const STARTABLE_STATUSES = new Set(['planned', 'ready_for_production']);
const COMPLETABLE_STATUSES = new Set(['in_production']);
const VERIFYABLE_STATUSES = new Set(['completed_pending_verification']);
const SAFE_ARRAY_LIMIT = 40;
const SAFE_SUMMARY_LIMIT = 12;

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

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function isPositiveNumber(value) {
  const numberValue = safeNumber(value);
  return numberValue !== null && numberValue > 0;
}

function safeStringArray(value, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, SAFE_ARRAY_LIMIT).map((item) => sanitizeText(item, maxLength)).filter(Boolean);
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeOrderSourceSummaries(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, SAFE_SUMMARY_LIMIT).map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const orderNumber = sanitizeText(item.order_number, 80);
    const sourceType = sanitizeText(item.source_type, 80);
    const sourceItem = sanitizeText(item.source_item, 120);
    const quantity = safeNumber(item.quantity);
    const summary = {};
    if (orderNumber) summary.order_number = orderNumber;
    if (sourceType) summary.source_type = sourceType;
    if (sourceItem) summary.source_item = sourceItem;
    if (quantity !== null) summary.quantity = quantity;
    return Object.keys(summary).length ? summary : null;
  }).filter(Boolean);
}

function buildBaseSummary(batch) {
  const orderSources = Array.isArray(batch.order_sources) ? batch.order_sources : [];
  const ingredients = Array.isArray(batch.ingredients_used) ? batch.ingredients_used : [];
  return {
    production_batch_id: sanitizeId(batch.id) || null,
    batch_id: sanitizeId(batch.batch_id) || null,
    product_name: sanitizeText(batch.product_name, 120) || null,
    product_category: sanitizeText(batch.product_category, 80) || null,
    current_status: sanitizeText(batch.status, 80) || null,
    production_status: sanitizeText(batch.production_status, 80) || null,
    production_date: sanitizeText(batch.production_date, 40) || null,
    is_locked: batch.is_locked === true,
    planned_units: safeNumber(batch.planned_units),
    actual_units: safeNumber(batch.actual_units),
    order_sources_count: orderSources.length,
    safe_order_source_summaries: safeOrderSourceSummaries(orderSources),
    ingredients_used_count: ingredients.length,
    compliance_log_present: Boolean(batch.compliance_log_id),
    audit_trail_count: Array.isArray(batch.audit_trail) ? batch.audit_trail.length : 0,
  };
}

function requireBatchIdentity(batch, blockers) {
  if (!sanitizeId(batch.id) && !sanitizeId(batch.batch_id)) {
    blockers.push('missing_batch_identity');
  }
  if (!sanitizeText(batch.product_name, 120)) {
    blockers.push('missing_product_name');
  }
  if (!sanitizeText(batch.production_date, 40)) {
    blockers.push('missing_production_date');
  }
}

function appendCommonGuards(batch, blockers, warnings) {
  requireBatchIdentity(batch, blockers);
  if (batch.is_locked === true) blockers.push('batch_locked');
  if (batch.inventory_deduction_log_id) warnings.push('inventory_deduction_already_linked');
  if (batch.source_system && normalizeLower(batch.source_system).includes('hub')) {
    warnings.push('legacy_hub_mirrored_batch');
  }
}

function buildCommandDraft({ action, batch, actorEmail, requestId, now }) {
  return {
    command_type: `production_batch_${action}_preview`,
    command_source: 'customer_app_native_preview',
    target_entity: 'ProductionBatch',
    target_id: sanitizeId(batch.id) || null,
    target_display_id: sanitizeId(batch.batch_id) || sanitizeId(batch.id) || null,
    actor_email: sanitizeText(actorEmail, 120) || null,
    actor_type: actorEmail ? 'admin' : 'unknown',
    status: 'dry_run',
    request_id: sanitizeId(requestId) || null,
    function_name: 'previewNativeProductionBatchLifecycle',
    notes: 'Dry-run only. No records are created or updated.',
    submitted_at: now,
    completed_at: now,
  };
}

function planStart({ batch, actorEmail, requestId, now }) {
  const blockers = [];
  const warnings = [];
  appendCommonGuards(batch, blockers, warnings);

  const currentStatus = normalizeLower(batch.status);
  if (!STARTABLE_STATUSES.has(currentStatus)) {
    blockers.push('status_not_startable');
  }
  if (batch.actual_start_time) blockers.push('already_started');
  if (batch.actual_end_time || batch.completed_by) blockers.push('already_completed');
  if (batch.compliance_log_id || batch.verified_at || batch.verified_by) blockers.push('already_verified_logged');

  const proposedPatch = blockers.length ? null : {
    status: 'in_production',
    actual_start_time: now,
    started_by: sanitizeText(actorEmail, 120) || 'native_preview_actor',
    audit_trail_append: {
      timestamp: now,
      action: 'production_batch_start',
      performed_by: sanitizeText(actorEmail, 120) || 'native_preview_actor',
      reason: 'Native dry-run production start preview',
      request_id: sanitizeId(requestId) || null,
    },
  };

  return {
    projected_writes: blockers.length ? [] : ['ProductionBatch.status', 'ProductionBatch.actual_start_time', 'ProductionBatch.started_by', 'ProductionBatch.audit_trail'],
    proposed_patch: proposedPatch,
    blockers,
    warnings,
  };
}

function planComplete({ batch, actorEmail, requestId, now, completionInput }) {
  const blockers = [];
  const warnings = [];
  appendCommonGuards(batch, blockers, warnings);

  const currentStatus = normalizeLower(batch.status);
  if (!COMPLETABLE_STATUSES.has(currentStatus)) {
    blockers.push('status_not_completable');
  }
  if (!batch.actual_start_time) blockers.push('missing_actual_start_time');
  if (batch.actual_end_time || batch.completed_by) blockers.push('already_completed');
  if (batch.compliance_log_id || batch.verified_at || batch.verified_by) blockers.push('already_verified_logged');

  const actualUnits = completionInput.actual_units ?? completionInput.actual_quantity_produced ?? batch.actual_units;
  if (!isPositiveNumber(actualUnits)) blockers.push('missing_actual_units');

  const bottlesProduced = safeNumber(completionInput.bottles_produced ?? batch.bottles_produced);
  const bottlesRejectedOrWasted = safeNumber(completionInput.bottles_rejected_or_wasted ?? batch.bottles_rejected_or_wasted);
  const finalUsableQuantity = safeNumber(completionInput.final_usable_quantity ?? batch.final_usable_quantity);
  const storageLocation = sanitizeText(completionInput.storage_location ?? batch.storage_location, 120);
  const useByDate = sanitizeText(completionInput.use_by_date ?? batch.use_by_date, 40);

  if (bottlesProduced === null) warnings.push('bottles_produced_not_provided');
  if (finalUsableQuantity === null) warnings.push('final_usable_quantity_not_provided');
  if (!storageLocation) warnings.push('storage_location_not_provided');
  if (!useByDate) warnings.push('use_by_date_not_provided');

  const proposedPatch = blockers.length ? null : {
    status: 'completed_pending_verification',
    actual_end_time: now,
    completed_by: sanitizeText(actorEmail, 120) || 'native_preview_actor',
    actual_units: Number(actualUnits),
    ...(bottlesProduced !== null ? { bottles_produced: bottlesProduced } : {}),
    ...(bottlesRejectedOrWasted !== null ? { bottles_rejected_or_wasted: bottlesRejectedOrWasted } : {}),
    ...(finalUsableQuantity !== null ? { final_usable_quantity: finalUsableQuantity } : {}),
    ...(storageLocation ? { storage_location: storageLocation } : {}),
    ...(useByDate ? { use_by_date: useByDate } : {}),
    audit_trail_append: {
      timestamp: now,
      action: 'production_batch_complete',
      performed_by: sanitizeText(actorEmail, 120) || 'native_preview_actor',
      reason: 'Native dry-run production complete preview',
      request_id: sanitizeId(requestId) || null,
    },
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

function normalizePassFail(value) {
  const text = normalizeLower(value);
  return ['passed', 'failed'].includes(text) ? text : '';
}

function planVerify({ batch, actorEmail, requestId, now, verificationInput }) {
  const blockers = [];
  const warnings = [];
  appendCommonGuards(batch, blockers, warnings);

  const currentStatus = normalizeLower(batch.status);
  if (!VERIFYABLE_STATUSES.has(currentStatus)) {
    blockers.push('status_not_verifiable');
  }
  if (!batch.actual_end_time && !batch.completed_by) blockers.push('missing_completion_metadata');
  if (batch.compliance_log_id || batch.verified_at || batch.verified_by) blockers.push('already_verified_logged');

  const pHResult = verificationInput.pH_result ?? batch.pH_result;
  const pHStatus = normalizePassFail(verificationInput.pH_passed_failed ?? batch.pH_passed_failed);
  const passedFailed = normalizePassFail(verificationInput.passed_failed ?? batch.passed_failed);
  const staffOnDuty = Array.isArray(verificationInput.staff_on_duty)
    ? verificationInput.staff_on_duty
    : (Array.isArray(batch.staff_on_duty) ? batch.staff_on_duty : []);

  if (!isPositiveNumber(pHResult)) blockers.push('missing_ph_result');
  if (!pHStatus) blockers.push('missing_ph_pass_fail');
  if (!passedFailed) blockers.push('missing_batch_pass_fail');
  if (staffOnDuty.length === 0) warnings.push('staff_on_duty_not_provided');
  if (verificationInput.corrective_action_required === true || batch.corrective_action_required === true) {
    warnings.push('corrective_action_present_requires_admin_review');
  }
  if (!Array.isArray(batch.ingredients_used) || batch.ingredients_used.length === 0) {
    warnings.push('ingredients_used_not_present');
  }

  const complianceLogDraft = blockers.length ? null : {
    batch_id: sanitizeId(batch.batch_id) || sanitizeId(batch.id) || null,
    juice_flavor: sanitizeText(batch.product_name, 120) || null,
    date: sanitizeText(batch.production_date, 40) || null,
    quantity_produced: safeNumber(batch.actual_units) ?? safeNumber(batch.final_usable_quantity) ?? null,
    pH_result: Number(pHResult),
    passed_failed: passedFailed,
    verified_by: sanitizeText(actorEmail, 120) || 'native_preview_actor',
    verified_at: now,
    source_production_batch_id: sanitizeId(batch.id) || null,
    locked: true,
  };

  const proposedPatch = blockers.length ? null : {
    status: 'verified_logged',
    verified_by: sanitizeText(actorEmail, 120) || 'native_preview_actor',
    verified_at: now,
    pH_result: Number(pHResult),
    pH_passed_failed: pHStatus,
    passed_failed: passedFailed,
    audit_trail_append: {
      timestamp: now,
      action: 'production_batch_verify',
      performed_by: sanitizeText(actorEmail, 120) || 'native_preview_actor',
      reason: 'Native dry-run production verification preview',
      request_id: sanitizeId(requestId) || null,
    },
  };

  return {
    projected_writes: blockers.length ? [] : [
      'ProductionBatch.status',
      'ProductionBatch.verified_by',
      'ProductionBatch.verified_at',
      'ProductionBatch.pH_result',
      'ProductionBatch.pH_passed_failed',
      'ProductionBatch.passed_failed',
      'ProductionBatch.audit_trail',
      'BatchComplianceLog',
    ],
    proposed_patch: proposedPatch,
    compliance_log_draft: complianceLogDraft,
    blockers,
    warnings,
  };
}

function planLifecycle(input) {
  const body = safeObject(input);
  const action = normalizeLower(body.action);
  const batch = safeObject(body.batch);
  const actorEmail = body.actor_email;
  const requestId = body.request_id;
  const now = sanitizeText(body.now, 40) || new Date().toISOString();
  const completionInput = safeObject(body.completion_input);
  const verificationInput = safeObject(body.verification_input);

  if (!ALLOWED_ACTIONS.has(action)) {
    return {
      success: false,
      dry_run: true,
      error_code: 'unsupported_action',
      error: 'action must be start, complete, or verify',
      status: 400,
    };
  }

  if (body.mode && normalizeLower(body.mode) !== 'dry_run') {
    return {
      success: false,
      dry_run: true,
      action,
      error_code: 'dry_run_only',
      error: 'previewNativeProductionBatchLifecycle does not support live mode',
      status: 400,
    };
  }

  let plan;
  if (action === 'start') {
    plan = planStart({ batch, actorEmail, requestId, now });
  } else if (action === 'complete') {
    plan = planComplete({ batch, actorEmail, requestId, now, completionInput });
  } else {
    plan = planVerify({ batch, actorEmail, requestId, now, verificationInput });
  }

  const blockers = safeStringArray(plan.blockers);
  const warnings = safeStringArray(plan.warnings);
  return {
    success: true,
    dry_run: true,
    action,
    native_writer_enabled: false,
    source: 'customer_app_native_preview',
    ...buildBaseSummary(batch),
    lifecycle_ready: blockers.length === 0,
    native_write_allowed: false,
    projected_writes: safeStringArray(plan.projected_writes),
    proposed_patch: plan.proposed_patch,
    compliance_log_draft: plan.compliance_log_draft || null,
    command_log_draft: buildCommandDraft({ action, batch, actorEmail, requestId, now }),
    blockers,
    warnings,
    response_safety: {
      raw_payload_returned: false,
      live_records_read: false,
      live_records_mutated: false,
      external_service_calls: false,
    },
    status: 200,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', error: 'Method not allowed' }, { status: 405 });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ success: false, dry_run: true, error_code: 'malformed_json', error: 'Malformed JSON' }, { status: 400 });
    }

    const result = planLifecycle(body);
    const status = result.status || 200;
    delete result.status;
    return Response.json(result, { status });
  } catch {
    return Response.json({
      success: false,
      dry_run: true,
      error_code: 'preview_failed',
      error: 'Unable to preview native production batch lifecycle',
    }, { status: 500 });
  }
});
