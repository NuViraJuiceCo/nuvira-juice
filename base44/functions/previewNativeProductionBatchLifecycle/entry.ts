import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ALLOWED_ACTIONS = new Set(['start', 'complete', 'verify']);
const STARTABLE_STATUSES = new Set(['planned', 'ready_for_production']);
const COMPLETABLE_STATUSES = new Set(['in_production']);
const VERIFYABLE_STATUSES = new Set(['completed_pending_verification']);
const TERMINAL_STATUSES = new Set(['verified_logged', 'archived']);
const SAFE_ARRAY_LIMIT = 40;
const SAFE_SUMMARY_LIMIT = 12;
const DEFAULT_LIST_LIMIT = 500;

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
    .replace(/\b(?:ch|re|pi|cs|cus|sub|evt|in|pm|seti|si|src|tok|po|li)_[A-Za-z0-9]{8,}\b/g, '[redacted provider id]')
    .replace(/\bgid:\/\/shopify\/[A-Za-z]+\/[A-Za-z0-9_-]+\b/g, '[redacted shopify id]');

  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function sanitizeId(value, maxLength = 180) {
  const text = sanitizeText(value, maxLength);
  return text && /^[A-Za-z0-9._:@/#-]+$/.test(text) ? text : '';
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

function uniqueStrings(values, limit = SAFE_ARRAY_LIMIT) {
  return [...new Set((values || []).map(value => sanitizeText(value, 160)).filter(Boolean))].slice(0, limit);
}

function parseRequestedBatchIds(value) {
  if (Array.isArray(value)) return uniqueStrings(value, 180);
  const text = normalizeText(value);
  if (!text) return [];
  return uniqueStrings(text.split(',').map(item => item.trim()), 180);
}

function getPreviewSecret() {
  return Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET') ||
    Deno.env.get('CUSTOMER_APP_SYNC_SECRET') ||
    Deno.env.get('HUB_SYNC_SECRET') ||
    '';
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

function unauthorized() {
  return Response.json({ success: false, error_code: 'unauthorized', message: 'Unauthorized' }, { status: 401 });
}

function forbidden() {
  return Response.json({ success: false, error_code: 'forbidden', message: 'Admin access required' }, { status: 403 });
}

async function requirePreviewAccess({ base44, req, body }) {
  const headerSecret = normalizeText(req.headers?.get?.('x-internal-secret'));
  const bodySecret = normalizeText(body?._internal_secret || body?.internal_secret);
  const providedSecret = headerSecret || bodySecret;
  const expectedSecret = getPreviewSecret();

  if (providedSecret) {
    return expectedSecret && providedSecret === expectedSecret
      ? { ok: true, actor_type: 'system', actor_role: 'service', actor_email: 'system' }
      : { ok: false, response: unauthorized() };
  }

  try {
    const user = await base44.auth.me().catch(() => null);
    if (!user) return { ok: false, response: unauthorized() };
    if (user.role !== 'admin') return { ok: false, response: forbidden() };
    return { ok: true, actor_type: 'admin', actor_role: 'admin', actor_email: sanitizeText(user.email, 120) || 'admin' };
  } catch {
    return { ok: false, response: unauthorized() };
  }
}

function getLookup(body) {
  return {
    orderId: normalizeText(body?.customer_app_order_id || body?.base44_order_id || body?.order_id),
    nativeOrderId: normalizeText(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id),
    taskId: normalizeText(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id),
    orderNumber: normalizeText(body?.order_number || body?.shopify_order_number || body?.number).replace(/^#/, ''),
    productionDate: normalizeText(body?.production_date || body?.expected_production_date),
    requestId: normalizeText(body?.request_id),
    batchIds: parseRequestedBatchIds(body?.batch_ids || body?.batch_id || body?.production_batch_ids || body?.production_batch_id),
  };
}

function hasOrderLevelLookup(lookup) {
  return Boolean(lookup.orderId || lookup.nativeOrderId || lookup.taskId || lookup.orderNumber || lookup.batchIds.length > 0);
}

async function listEntity(base44, entityName, sort = '-created_date', limit = DEFAULT_LIST_LIMIT) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity || typeof entity.list !== 'function') return [];
  const rows = await entity.list(sort, limit).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function filterEntity(base44, entityName, filter, sort = '-created_date', limit = 10) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity || typeof entity.filter !== 'function') return [];
  const rows = await entity.filter(filter, sort, limit).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function findCustomerOrder(base44, lookup) {
  const filters = [];
  if (lookup.orderId) filters.push({ id: lookup.orderId });
  if (lookup.orderNumber) {
    filters.push({ order_number: lookup.orderNumber });
    filters.push({ shopify_order_number: lookup.orderNumber });
  }
  for (const filter of filters) {
    const rows = await filterEntity(base44, 'Order', filter, '-created_date', 5);
    if (rows.length > 0) return rows[0];
  }
  return null;
}

async function findNativeShopifyOrder(base44, customerOrder, lookup) {
  const orderNumber = lookup.orderNumber || normalizeText(customerOrder?.order_number || customerOrder?.shopify_order_number).replace(/^#/, '');
  const filters = [];
  if (lookup.nativeOrderId) {
    filters.push({ id: lookup.nativeOrderId });
    filters.push({ shopify_order_id: lookup.nativeOrderId });
  }
  if (customerOrder?.id) filters.push({ base44_order_id: customerOrder.id });
  if (orderNumber) filters.push({ shopify_order_number: orderNumber });
  for (const filter of filters) {
    const rows = await filterEntity(base44, 'ShopifyOrder', filter, '-created_date', 5);
    if (rows.length > 0) return rows[0];
  }
  return null;
}

async function findNativeFulfillmentTask(base44, customerOrder, nativeOrder, lookup) {
  const orderNumber = lookup.orderNumber || normalizeText(nativeOrder?.shopify_order_number || customerOrder?.order_number).replace(/^#/, '');
  const filters = [];
  if (lookup.taskId) filters.push({ id: lookup.taskId });
  if (nativeOrder?.id) {
    filters.push({ native_shopify_order_id: nativeOrder.id });
    filters.push({ shopify_order_id: nativeOrder.id });
    filters.push({ order_id: nativeOrder.id });
  }
  if (customerOrder?.id) {
    filters.push({ base44_order_id: customerOrder.id });
    filters.push({ order_id: customerOrder.id });
  }
  if (orderNumber) {
    filters.push({ order_number: orderNumber });
    filters.push({ shopify_order_number: orderNumber });
  }

  const seen = new Set();
  for (const filter of filters) {
    const rows = await filterEntity(base44, 'FulfillmentTask', filter, '-created_date', 10);
    for (const row of rows) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      if (lookup.taskId && row.id === lookup.taskId) return row;
      if (!lookup.taskId) return row;
    }
  }
  return null;
}

function paymentStatus(customerOrder, nativeOrder) {
  return normalizeLower(customerOrder?.payment_status || nativeOrder?.payment_status || nativeOrder?.financial_status);
}

function isPaymentCaptured(customerOrder, nativeOrder) {
  return customerOrder?.payment_captured === true ||
    customerOrder?.stripe_payment_captured === true ||
    nativeOrder?.payment_captured === true ||
    nativeOrder?.stripe_payment_captured === true ||
    paymentStatus(customerOrder, nativeOrder) === 'paid';
}

function orderNumberFor(customerOrder, nativeOrder, task, lookup) {
  return sanitizeText(lookup.orderNumber || nativeOrder?.shopify_order_number || customerOrder?.order_number || task?.order_number, 120);
}

function productionDateFor(customerOrder, nativeOrder, task, lookup) {
  return sanitizeText(lookup.productionDate || task?.production_date || task?.scheduled_date || nativeOrder?.production_date || customerOrder?.production_date || customerOrder?.scheduled_date, 40);
}

function deliveryDateFor(customerOrder, nativeOrder, task) {
  return sanitizeText(task?.assigned_delivery_date || task?.delivery_date || task?.scheduled_date || nativeOrder?.delivery_date || customerOrder?.delivery_date || customerOrder?.scheduled_date, 40);
}

function fulfillmentTypeFor(customerOrder, nativeOrder, task) {
  return sanitizeText(task?.fulfillment_type || nativeOrder?.fulfillment_type || customerOrder?.fulfillment_type || customerOrder?.fulfillment_method, 80);
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

function safeIngredientRows(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, SAFE_ARRAY_LIMIT).map((item) => {
    const source = safeObject(item);
    const ingredient = sanitizeText(source.ingredient_name || source.name, 160);
    if (!ingredient) return null;
    return {
      ingredient_name: ingredient,
      quantity: safeNumber(source.quantity),
      unit: sanitizeText(source.unit, 40),
      lot_number: sanitizeText(source.lot_number, 120),
    };
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
  if (!Array.isArray(batch.ingredients_used) || batch.ingredients_used.length === 0) warnings.push('ingredients_used_not_present_inventory_deduction_held');
  if (batch.procurement_needed === true) warnings.push('procurement_needed_does_not_block_completion_preview');
  if (normalizeLower(batch.inventory_deduction_status || batch.ingredient_usage_status).includes('held')) warnings.push('inventory_deduction_held');

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

  const pHResult = verificationInput.pH_result ?? verificationInput.ph_result ?? verificationInput.ph_value ?? batch.pH_result;
  const pHStatus = normalizePassFail(verificationInput.pH_passed_failed ?? verificationInput.ph_passed_failed ?? batch.pH_passed_failed);
  const passedFailed = normalizePassFail(verificationInput.passed_failed ?? batch.passed_failed);
  const staffOnDuty = Array.isArray(verificationInput.staff_on_duty)
    ? verificationInput.staff_on_duty
    : (Array.isArray(batch.staff_on_duty) ? batch.staff_on_duty : []);
  const quantityProduced = safeNumber(batch.actual_units) ?? safeNumber(batch.final_usable_quantity);

  if (!isPositiveNumber(pHResult)) blockers.push('missing_ph_result');
  if (!pHStatus) blockers.push('missing_ph_pass_fail');
  if (!passedFailed) blockers.push('missing_batch_pass_fail');
  if (!isPositiveNumber(quantityProduced)) blockers.push('missing_quantity_produced_for_compliance_log');
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
    ingredients: safeIngredientRows(batch.ingredients_used),
    start_time: sanitizeText(batch.actual_start_time, 80) || null,
    end_time: sanitizeText(batch.actual_end_time, 80) || null,
    quantity_produced: quantityProduced ?? null,
    staff_on_duty: safeStringArray(staffOnDuty),
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
      'ProductionBatch.compliance_log_id',
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
  const completionInput = safeObject(body.completion_input || body);
  const verificationInput = safeObject(body.verification_input || body);

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

function batchMatchesOrder(batch, { orderNumber, customerOrder, nativeOrder, task, lookup }) {
  const requestedIds = new Set(lookup.batchIds || []);
  if (requestedIds.size > 0 && (requestedIds.has(batch.id) || requestedIds.has(batch.batch_id))) return true;

  const haystack = [
    batch.batch_id,
    batch.source_order_number,
    batch.order_number,
    batch.source_order_id,
    batch.base44_order_id,
    batch.native_shopify_order_id,
    batch.native_fulfillment_task_id,
    JSON.stringify(batch.order_sources || []),
    JSON.stringify(batch.related_orders || []),
  ].filter(Boolean).join(' ');

  return Boolean(
    (orderNumber && haystack.includes(orderNumber)) ||
    (customerOrder?.id && haystack.includes(customerOrder.id)) ||
    (nativeOrder?.id && haystack.includes(nativeOrder.id)) ||
    (task?.id && haystack.includes(task.id))
  );
}

function filterProductionBatches(batches, { orderNumber, customerOrder, nativeOrder, task, lookup }) {
  return (batches || [])
    .filter(batch => {
      if (lookup.productionDate && normalizeText(batch.production_date) !== lookup.productionDate) return false;
      return batchMatchesOrder(batch, { orderNumber, customerOrder, nativeOrder, task, lookup });
    })
    .sort((a, b) => (sanitizeText(a.product_name, 120) || '').localeCompare(sanitizeText(b.product_name, 120) || ''));
}

function matchingComplianceLogsForBatch(batch, complianceLogs) {
  const batchId = sanitizeId(batch.id);
  const displayId = sanitizeId(batch.batch_id);
  return (complianceLogs || [])
    .filter(log => {
      return (batchId && log.source_production_batch_id === batchId) ||
        (displayId && log.batch_id === displayId) ||
        (batch.compliance_log_id && log.id === batch.compliance_log_id);
    })
    .slice(0, 5)
    .map(log => ({
      id: sanitizeId(log.id, 120) || null,
      batch_id: sanitizeId(log.batch_id, 120) || null,
      juice_flavor: sanitizeText(log.juice_flavor, 120) || null,
      date: sanitizeText(log.date, 40) || null,
      passed_failed: sanitizeText(log.passed_failed, 40) || null,
      verified_at: sanitizeText(log.verified_at, 80) || null,
      locked: log.locked === true,
    }));
}

function classifyLifecycle({ batch, startPlan, completePlan, verifyPlan }) {
  const status = normalizeLower(batch.status);
  if (TERMINAL_STATUSES.has(status) || batch.verified_at || batch.verified_by || batch.compliance_log_id) return 'already_completed_or_verified';
  if (verifyPlan.blockers.length === 0) return 'ready_to_verify_preview_only';
  if (status === 'completed_pending_verification') return 'verify_blocked';
  if (completePlan.blockers.length === 0) return 'ready_to_complete_preview_only';
  if (status === 'in_production') return 'complete_blocked';
  if (startPlan.blockers.length === 0) return 'ready_to_start_preview_only';
  if (STARTABLE_STATUSES.has(status) || !status) return 'start_blocked';
  return 'unsupported_lifecycle_state';
}

function nextAllowedTransition({ startPlan, completePlan, verifyPlan }) {
  if (startPlan.blockers.length === 0) return 'start';
  if (completePlan.blockers.length === 0) return 'complete';
  if (verifyPlan.blockers.length === 0) return 'verify';
  return null;
}

function buildBatchLifecycleRow({ batch, actorEmail, requestId, now, complianceLogs }) {
  const startPlan = planStart({ batch, actorEmail, requestId, now });
  const completePlan = planComplete({ batch, actorEmail, requestId, now, completionInput: {} });
  const verifyPlan = planVerify({ batch, actorEmail, requestId, now, verificationInput: {} });
  const startBlockers = uniqueStrings(startPlan.blockers);
  const completeBlockers = uniqueStrings(completePlan.blockers);
  const verifyBlockers = uniqueStrings(verifyPlan.blockers);
  const lifecycleWarnings = uniqueStrings([...startPlan.warnings, ...completePlan.warnings, ...verifyPlan.warnings]);
  const classification = classifyLifecycle({ batch, startPlan, completePlan, verifyPlan });

  return {
    ...buildBaseSummary(batch),
    classification,
    current_status: sanitizeText(batch.status || 'planned', 80) || null,
    can_start: startBlockers.length === 0,
    can_complete: completeBlockers.length === 0,
    can_verify: verifyBlockers.length === 0,
    next_allowed_transition: nextAllowedTransition({ startPlan, completePlan, verifyPlan }),
    start_blockers: startBlockers,
    complete_blockers: completeBlockers,
    verify_blockers: verifyBlockers,
    lifecycle_blockers: uniqueStrings([
      ...startBlockers.map(item => `start:${item}`),
      ...completeBlockers.map(item => `complete:${item}`),
      ...verifyBlockers.map(item => `verify:${item}`),
    ]),
    lifecycle_warnings: lifecycleWarnings,
    existing_compliance_logs: matchingComplianceLogsForBatch(batch, complianceLogs),
    expected_start_writes_if_approved: safeStringArray(startPlan.projected_writes),
    expected_complete_writes_if_approved: safeStringArray(completePlan.projected_writes),
    expected_verify_writes_if_approved: safeStringArray(verifyPlan.projected_writes),
  };
}

function summarizeAction(rows, action) {
  const key = `can_${action}`;
  const blockerKey = `${action}_blockers`;
  const readyRows = rows.filter(row => row[key] === true);
  const blockedRows = rows.filter(row => row[key] !== true);
  const expectedWrites = action === 'start'
    ? ['ProductionBatch.status', 'ProductionBatch.actual_start_time', 'ProductionBatch.started_by', 'ProductionBatch.audit_trail']
    : action === 'complete'
      ? ['ProductionBatch.status', 'ProductionBatch.actual_end_time', 'ProductionBatch.completed_by', 'ProductionBatch.actual_units', 'ProductionBatch.audit_trail']
      : ['ProductionBatch.status', 'ProductionBatch.verified_by', 'ProductionBatch.verified_at', 'ProductionBatch.compliance_log_id', 'BatchComplianceLog', 'ProductionBatch.audit_trail'];
  return {
    action,
    preview_only: true,
    ready_count: readyRows.length,
    blocked_count: blockedRows.length,
    ready_batch_ids: readyRows.map(row => row.batch_id || row.production_batch_id).filter(Boolean),
    blocked_rows: blockedRows.slice(0, SAFE_SUMMARY_LIMIT).map(row => ({
      batch_id: row.batch_id || row.production_batch_id,
      product_name: row.product_name,
      blockers: row[blockerKey] || [],
    })),
    expected_writes_if_later_approved: expectedWrites,
    no_writes_now: true,
  };
}

function buildCompliancePreview(rows, complianceLogs) {
  const verifyReadyRows = rows.filter(row => row.can_verify);
  const missingComplianceData = uniqueStrings(rows.flatMap(row => row.verify_blockers || [])
    .filter(item => [
      'missing_ph_result',
      'missing_ph_pass_fail',
      'missing_batch_pass_fail',
      'missing_quantity_produced_for_compliance_log',
      'missing_completion_metadata',
    ].includes(item)));
  return {
    preview_only: true,
    batch_compliance_log_ready_count: verifyReadyRows.length,
    existing_compliance_log_count: Array.isArray(complianceLogs) ? complianceLogs.length : 0,
    missing_compliance_data: missingComplianceData,
    batch_compliance_log_requirements: [
      'completed batch',
      'quantity produced',
      'pH result',
      'pH pass/fail',
      'batch pass/fail',
      'verified_by',
      'verified_at',
    ],
    sanitation_temperature_checklist_context: 'not_required_for_start_preview_and_held_for_later_compliance_policy',
    corrective_action_context: 'review_required_if_batch_fails_or_corrective_action_required',
    compliance_log_creation_held: true,
    no_compliance_logs_created: true,
  };
}

function buildCascadePreview({ rows, nativeOrder, task }) {
  const allVerified = rows.length > 0 && rows.every(row => normalizeLower(row.current_status) === 'verified_logged' || row.compliance_log_present);
  return {
    preview_only: true,
    native_fulfillment_task_present: Boolean(task),
    native_shopify_order_present: Boolean(nativeOrder),
    fulfillment_task_pack_cascade_ready: false,
    shopify_order_bottled_cascade_ready: false,
    customer_facing_status_impact: 'none_preview_only',
    cascade_blockers: allVerified
      ? ['cascade_policy_requires_separate_exact_approval']
      : ['production_batches_not_verified'],
    cascade_warnings: [
      'pack_task_cascade_held',
      'bottled_shopify_order_cascade_held',
      'customer_status_mutation_held',
    ],
    expected_writes_if_later_approved: [],
    no_task_order_mutation: true,
  };
}

function buildOrderLifecyclePreview({ customerOrder, nativeOrder, task, batches, complianceLogs, lookup, auth, now }) {
  const orderNumber = orderNumberFor(customerOrder, nativeOrder, task, lookup);
  const productionDate = productionDateFor(customerOrder, nativeOrder, task, lookup);
  const deliveryDate = deliveryDateFor(customerOrder, nativeOrder, task);
  const blockers = [];
  const warnings = [];

  if (!hasOrderLevelLookup(lookup)) blockers.push('exact_order_or_batch_required');
  if (!customerOrder && !nativeOrder && lookup.batchIds.length === 0) blockers.push('order_not_found');
  if (customerOrder && paymentStatus(customerOrder, nativeOrder) !== 'paid' && !isPaymentCaptured(customerOrder, nativeOrder)) blockers.push('order_payment_not_confirmed_for_lifecycle_context');
  if (!nativeOrder && lookup.batchIds.length === 0) warnings.push('native_shopify_order_missing_or_not_required_for_batch_only_preview');
  if (!task && lookup.batchIds.length === 0) warnings.push('native_fulfillment_task_missing_or_not_required_for_batch_only_preview');
  if (!productionDate) warnings.push('production_date_missing_or_inferred_from_batches');
  if (!Array.isArray(batches) || batches.length === 0) blockers.push('native_production_batches_not_found');

  const rows = (batches || []).map(batch => buildBatchLifecycleRow({
    batch,
    actorEmail: auth.actor_email,
    requestId: lookup.requestId,
    now,
    complianceLogs,
  }));

  if (rows.some(row => row.is_locked)) warnings.push('one_or_more_batches_locked');
  if (rows.some(row => row.current_status === 'planned' || row.current_status === 'ready_for_production')) warnings.push('complete_and_verify_held_until_start_and_completion_data_exist');
  if (rows.some(row => row.lifecycle_warnings.includes('inventory_deduction_held'))) warnings.push('inventory_deduction_held');
  warnings.push('purchase_order_automation_held');
  warnings.push('hub_fallback_required');
  warnings.push('live_lifecycle_execution_requires_separate_exact_approval');

  const startPreview = summarizeAction(rows, 'start');
  const completePreview = summarizeAction(rows, 'complete');
  const verifyPreview = summarizeAction(rows, 'verify');
  const compliancePreview = buildCompliancePreview(rows, complianceLogs);
  const cascadePreview = buildCascadePreview({ rows, nativeOrder, task });
  const nextAction = blockers.length > 0
    ? 'hold_lifecycle_preview_blockers'
    : startPreview.ready_count > 0
      ? 'plan_gated_native_start_production_command'
      : completePreview.ready_count > 0
        ? 'plan_gated_native_complete_production_command'
        : verifyPreview.ready_count > 0
          ? 'plan_gated_native_verify_production_command'
          : 'review_lifecycle_state_or_hub_fallback';

  return {
    success: blockers.length === 0,
    dry_run: true,
    writes_performed: false,
    order_number: orderNumber || null,
    customer_app_order_id: sanitizeId(customerOrder?.id, 120) || null,
    native_shopify_order_id: sanitizeId(nativeOrder?.id, 120) || null,
    native_fulfillment_task_id: sanitizeId(task?.id, 120) || null,
    customer_app_order_present: Boolean(customerOrder),
    native_shopify_order_present: Boolean(nativeOrder),
    native_fulfillment_task_present: Boolean(task),
    payment_status: sanitizeText(customerOrder?.payment_status || nativeOrder?.payment_status, 80) || null,
    payment_captured: isPaymentCaptured(customerOrder, nativeOrder),
    production_date: productionDate || rows[0]?.production_date || null,
    delivery_date: deliveryDate || null,
    fulfillment_type: fulfillmentTypeFor(customerOrder, nativeOrder, task) || null,
    batch_count: rows.length,
    batch_lifecycle_rows: rows,
    start_preview: startPreview,
    complete_preview: completePreview,
    verify_preview: verifyPreview,
    compliance_preview: compliancePreview,
    cascade_preview: cascadePreview,
    blockers: uniqueStrings(blockers),
    warnings: uniqueStrings(warnings),
    hub_fallback_required: true,
    live_execution_approved: false,
    live_command_available: true,
    native_writer_enabled: false,
    inventory_deduction_ready: false,
    purchase_order_ready: false,
    compliance_log_creation_ready: verifyPreview.ready_count > 0,
    next_action: nextAction,
    safety: {
      dry_run_only: true,
      writes_performed: false,
      production_batch_updated: false,
      production_batches_created: false,
      manual_production_batches_created: false,
      batch_compliance_logs_created: false,
      compliance_alerts_created: false,
      customer_app_order_mutated: false,
      native_shopify_order_mutated: false,
      native_fulfillment_task_mutated: false,
      inventory_deducted: false,
      purchase_orders_created: false,
      provider_calls_performed: false,
      stripe_calls_performed: false,
      shopify_api_calls_performed: false,
      notifications_sent: false,
      sync_repair_replay_performed: false,
      hub_bridge_modified: false,
      raw_payload_returned: false,
    },
  };
}

async function buildLiveOrderPreview({ base44, body, auth }) {
  const lookup = getLookup(body);
  let customerOrder = await findCustomerOrder(base44, lookup);
  let nativeOrder = await findNativeShopifyOrder(base44, customerOrder, lookup);
  if (!customerOrder && nativeOrder?.base44_order_id) {
    customerOrder = await findCustomerOrder(base44, {
      ...lookup,
      orderId: nativeOrder.base44_order_id,
      orderNumber: normalizeText(nativeOrder.shopify_order_number).replace(/^#/, ''),
    });
  }
  if (!nativeOrder && customerOrder) nativeOrder = await findNativeShopifyOrder(base44, customerOrder, lookup);
  const task = await findNativeFulfillmentTask(base44, customerOrder, nativeOrder, lookup);
  const orderNumber = orderNumberFor(customerOrder, nativeOrder, task, lookup);

  const [allBatches, complianceLogs] = await Promise.all([
    listEntity(base44, 'ProductionBatch', '-production_date', DEFAULT_LIST_LIMIT),
    listEntity(base44, 'BatchComplianceLog', '-created_date', DEFAULT_LIST_LIMIT),
  ]);
  const batches = filterProductionBatches(allBatches, { orderNumber, customerOrder, nativeOrder, task, lookup });
  const now = new Date().toISOString();
  return buildOrderLifecyclePreview({ customerOrder, nativeOrder, task, batches, complianceLogs, lookup, auth, now });
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', error: 'Method not allowed' }, { status: 405 });
    }

    const parsed = await readJsonBody(req);
    if (!parsed.ok) {
      return Response.json({ success: false, dry_run: true, error_code: 'malformed_json', error: 'Malformed JSON' }, { status: 400 });
    }
    const body = parsed.body || {};
    if (body.mode && normalizeLower(body.mode) !== 'dry_run') {
      return Response.json({ success: false, dry_run: true, error_code: 'dry_run_only', error: 'Only dry_run mode is supported' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const auth = await requirePreviewAccess({ base44, req, body });
    if (!auth.ok) return auth.response;

    if (body.action && body.batch) {
      const result = planLifecycle({ ...body, actor_email: auth.actor_email });
      const status = result.status || 200;
      delete result.status;
      return Response.json({
        ...result,
        actor_type: auth.actor_type,
        generated_at: new Date().toISOString(),
      }, { status });
    }

    const lookup = getLookup(body);
    if (!hasOrderLevelLookup(lookup)) {
      return Response.json({
        success: false,
        dry_run: true,
        error_code: 'exact_order_or_batch_required',
        error: 'order_number, exact target id, or batch_ids are required',
        writes_performed: false,
      }, { status: 400 });
    }

    const result = await buildLiveOrderPreview({ base44, body, auth });
    return Response.json({
      ...result,
      generated_at: new Date().toISOString(),
      request_id: sanitizeId(lookup.requestId, 120) || null,
      actor_type: auth.actor_type,
    }, { status: result.success ? 200 : 409 });
  } catch (error) {
    console.error(`[previewNativeProductionBatchLifecycle] failed safely: ${error?.message || 'unknown error'}`);
    return Response.json({
      success: false,
      dry_run: true,
      error_code: 'native_production_batch_lifecycle_preview_failed',
      error: 'Unable to preview native production batch lifecycle',
      writes_performed: false,
    }, { status: 500 });
  }
});
