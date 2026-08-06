import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ENABLE_WRITES_FLAG = 'ENABLE_NATIVE_PRODUCTION_BATCH_LIFECYCLE_WRITES';
const ALLOWED_EMAILS_FLAG = 'NATIVE_PRODUCTION_BATCH_LIFECYCLE_ALLOWED_EMAILS';
const TEST_BATCH_ALLOWLIST_FLAG = 'NATIVE_PRODUCTION_BATCH_LIFECYCLE_TEST_BATCH_ALLOWLIST';
const ALLOWED_ACTIONS_FLAG = 'NATIVE_PRODUCTION_BATCH_LIFECYCLE_ALLOWED_ACTIONS';
const KILL_SWITCH_FLAG = 'NATIVE_PRODUCTION_BATCH_LIFECYCLE_KILL_SWITCH';
const ALLOWED_ACTIONS = new Set(['start', 'complete', 'verify']);
const STARTABLE_STATUSES = new Set(['planned', 'ready_for_production']);
const COMPLETABLE_STATUSES = new Set(['in_production']);
const VERIFYABLE_STATUSES = new Set(['completed_pending_verification']);
const TERMINAL_STATUSES = new Set(['verified_logged', 'archived']);
const SAFE_PRODUCTION_LIFECYCLE_LABELS = new Set([
  'planned',
  'ready_for_production',
  'in_production',
  'completed_pending_verification',
  'verified_logged',
  'archived',
  'blocked',
  'held',
  'pending',
  'completed',
]);
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

function normalizeActorEmailForGate(value) {
  const email = normalizeSingleLine(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 160 ? email : '';
}

function parseCsvSet(value) {
  return new Set(
    normalizeText(value)
      .split(',')
      .map(item => normalizeLower(item))
      .filter(Boolean),
  );
}

function redactProviderLikeToken(match) {
  return SAFE_PRODUCTION_LIFECYCLE_LABELS.has(normalizeLower(match)) ? match : '[redacted provider id]';
}

function sanitizeLifecycleStatus(value, maxLength = 80) {
  const raw = normalizeSingleLine(value);
  if (!raw) return '';
  if (SAFE_PRODUCTION_LIFECYCLE_LABELS.has(normalizeLower(raw))) {
    return raw.length > maxLength ? `${raw.slice(0, maxLength - 1).trim()}...` : raw;
  }
  return sanitizeText(raw, maxLength);
}

function sanitizeText(value, maxLength = 160) {
  const text = normalizeSingleLine(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\b(?:ch|re|pi|cs|cus|sub|evt|in|pm|seti|si|src|tok|po|li)_[A-Za-z0-9]{8,}\b/g, redactProviderLikeToken)
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

function isNonNegativeNumber(value) {
  const numberValue = safeNumber(value);
  return numberValue !== null && numberValue >= 0;
}

function safeStringArray(value, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, SAFE_ARRAY_LIMIT).map((item) => sanitizeText(item, maxLength)).filter(Boolean);
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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
  const sanitationReady = sanitationMatches.some(row => row.cleaned === true && row.sanitized === true && normalizeLower(row.sanitizer_level) !== 'low');
  const checklistReady = checklistMatches.some(row => (
    ['complete', 'pre-production complete'].includes(normalizeLower(row.overall_status)) &&
    row.morning_fridge_temp_logged === true &&
    row.sanitizer_levels_checked === true &&
    row.equipment_sanitized === true &&
    row.work_areas_cleaned === true
  ));
  const temperatureReady = temperatureMatches.some(row => row.within_range === true && safeNumber(row.temperature) !== null);
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
  const sourceBatchId = sanitizeId(batch?.id);
  const displayBatchId = sanitizeId(batch?.batch_id);
  const results = await Promise.all([
    sourceBatchId ? filterEntity(base44, entityName, { source_production_batch_id: sourceBatchId }, '-created_date', 20) : [],
    displayBatchId ? filterEntity(base44, entityName, { batch_id: displayBatchId }, '-created_date', 20) : [],
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

function liveGateStatus({ action, batch, actorEmail }) {
  const blockers = [];
  const killSwitchActive = Deno.env.get(KILL_SWITCH_FLAG) === 'true';
  const nativeWriterEnabled = Deno.env.get(ENABLE_WRITES_FLAG) === 'true';

  if (killSwitchActive) blockers.push('kill_switch_active');
  if (!nativeWriterEnabled) blockers.push('native_production_batch_lifecycle_writes_disabled');

  const allowedEmails = parseCsvSet(Deno.env.get(ALLOWED_EMAILS_FLAG) || '');
  const normalizedActorEmail = normalizeLower(actorEmail);
  if (allowedEmails.size === 0) blockers.push('allowed_email_gate_required');
  else if (!allowedEmails.has(normalizedActorEmail)) blockers.push('actor_email_not_allowlisted');

  const allowedActions = parseCsvSet(Deno.env.get(ALLOWED_ACTIONS_FLAG) || '');
  const normalizedAction = normalizeLower(action);
  if (allowedActions.size === 0) blockers.push('allowed_action_gate_required');
  else if (!allowedActions.has(normalizedAction)) blockers.push('action_not_allowlisted');

  const batchKeys = [
    sanitizeId(batch?.id),
    sanitizeId(batch?.batch_id),
  ].filter(Boolean);
  const testAllowedBatches = parseCsvSet(Deno.env.get(TEST_BATCH_ALLOWLIST_FLAG) || '');
  const internalTestBatch = isInternalTestBatch(batch);
  const testBatchAllowlisted = batchKeys.some(batchKey => testAllowedBatches.has(normalizeLower(batchKey)));
  if (batchKeys.length === 0) blockers.push('production_batch_id_or_batch_id_required');
  if (internalTestBatch && testAllowedBatches.size === 0) blockers.push('test_batch_allowlist_required');
  else if (internalTestBatch && !testBatchAllowlisted) blockers.push('test_batch_not_allowlisted');
  if (!internalTestBatch && testBatchAllowlisted) blockers.push('test_batch_allowlist_requires_test_marker');

  const liveCommandAvailable = blockers.length === 0;
  return {
    native_writer_enabled: nativeWriterEnabled,
    native_write_allowed: liveCommandAvailable,
    live_command_available: liveCommandAvailable,
    live_command_blockers: uniqueStrings(blockers),
    live_gate: {
      kill_switch_active: killSwitchActive,
      writer_enabled: nativeWriterEnabled,
      actor_email_allowed: allowedEmails.size > 0 && allowedEmails.has(normalizedActorEmail),
      action_allowed: allowedActions.size > 0 && allowedActions.has(normalizedAction),
      operational_batch_authorized: batchKeys.length > 0 && !internalTestBatch,
      test_batch_allowlisted: internalTestBatch && testBatchAllowlisted,
      batch_allowlisted: batchKeys.length > 0 && (!internalTestBatch || testBatchAllowlisted),
      test_batch_marker_valid: !testBatchAllowlisted || internalTestBatch,
      pre_start_compliance_enforced: normalizedAction === 'start',
      legacy_exact_batch_allowlist_required: false,
    },
  };
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

function uniqueStrings(values, limit = SAFE_ARRAY_LIMIT) {
  return [...new Set((values || []).map(value => sanitizeText(value, 160)).filter(Boolean))].slice(0, limit);
}

function parseRequestedBatchIds(value) {
  if (Array.isArray(value)) return uniqueStrings(value, 180);
  const text = normalizeText(value);
  if (!text) return [];
  return uniqueStrings(text.split(',').map(item => item.trim()), 180);
}

function parseActualUnitsPreviewMap(body) {
  const sources = [
    body?.batch_actual_units,
    body?.actual_units_by_batch_id,
  ];
  const source = sources.find(item => item && typeof item === 'object' && !Array.isArray(item)) || {};
  const actualUnitsByBatchId = {};
  const actualUnitsBlockers = [];
  for (const [rawBatchId, rawUnits] of Object.entries(source)) {
    const batchId = sanitizeId(rawBatchId, 180);
    if (!batchId) {
      actualUnitsBlockers.push('invalid_actual_units_batch_id');
      continue;
    }
    const units = safeNumber(rawUnits);
    if (units === null || units < 0) {
      actualUnitsBlockers.push(`invalid_actual_units:${batchId}`);
      continue;
    }
    actualUnitsByBatchId[batchId] = units;
  }

  const productSource = body?.actual_units_by_product_name;
  const actualUnitsByProductName = {};
  if (productSource && typeof productSource === 'object' && !Array.isArray(productSource)) {
    for (const [rawProductName, rawUnits] of Object.entries(productSource)) {
      const productName = sanitizeText(rawProductName, 120);
      if (!productName) {
        actualUnitsBlockers.push('invalid_actual_units_product_name');
        continue;
      }
      const units = safeNumber(rawUnits);
      if (units === null || units < 0) {
        actualUnitsBlockers.push(`invalid_actual_units:${productName}`);
        continue;
      }
      actualUnitsByProductName[normalizeLower(productName)] = units;
    }
  }

  return {
    actualUnitsByBatchId,
    actualUnitsByProductName,
    actualUnitsBlockers: uniqueStrings(actualUnitsBlockers),
  };
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
    return { ok: true, actor_type: 'admin', actor_role: 'admin', actor_email: normalizeActorEmailForGate(user.email) || 'admin' };
  } catch {
    return { ok: false, response: unauthorized() };
  }
}

function getLookup(body) {
  const actualUnitsPreview = parseActualUnitsPreviewMap(body || {});
  return {
    orderId: normalizeText(body?.customer_app_order_id || body?.base44_order_id || body?.order_id),
    nativeOrderId: normalizeText(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id),
    taskId: normalizeText(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id),
    orderNumber: normalizeText(body?.order_number || body?.shopify_order_number || body?.number).replace(/^#/, ''),
    productionDate: normalizeText(body?.production_date || body?.expected_production_date),
    requestId: normalizeText(body?.request_id),
    batchIds: parseRequestedBatchIds(body?.batch_ids || body?.batch_id || body?.production_batch_ids || body?.production_batch_id),
    ...actualUnitsPreview,
    ...parseVerificationPreviewData(body || {}),
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
    current_status: sanitizeLifecycleStatus(batch.status, 80) || null,
    production_status: sanitizeText(batch.production_status, 80) || null,
    production_date: sanitizeText(batch.production_date, 40) || null,
    is_locked: batch.is_locked === true,
    is_test_batch: isInternalTestBatch(batch),
    test_purpose: isInternalTestBatch(batch) ? sanitizeText(batch.test_purpose, 160) || null : null,
    planned_units: safeNumber(batch.planned_units),
    actual_units: safeNumber(batch.actual_units),
    actual_start_time: sanitizeText(batch.actual_start_time, 80) || null,
    actual_end_time: sanitizeText(batch.actual_end_time, 80) || null,
    started_by: sanitizeText(batch.started_by, 120) || null,
    completed_by: sanitizeText(batch.completed_by, 120) || null,
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

function planStart({ batch, actorEmail, requestId, now, preStartCompliance }) {
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
  if (preStartCompliance?.enforced !== true) blockers.push('pre_start_compliance_unavailable');
  else blockers.push(...safeStringArray(preStartCompliance.blockers));

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
  if (!isNonNegativeNumber(actualUnits)) blockers.push('missing_actual_units');

  warnings.push('completion_v1_actual_units_only');
  warnings.push('qc_compliance_fields_deferred_to_verify');
  if (!Array.isArray(batch.ingredients_used) || batch.ingredients_used.length === 0) warnings.push('ingredients_used_not_present_inventory_deduction_held');
  if (batch.procurement_needed === true) warnings.push('procurement_needed_does_not_block_completion_preview');
  if (normalizeLower(batch.inventory_deduction_status || batch.ingredient_usage_status).includes('held')) warnings.push('inventory_deduction_held');

  const proposedPatch = blockers.length ? null : {
    status: 'completed_pending_verification',
    actual_end_time: now,
    completed_by: sanitizeText(actorEmail, 120) || 'native_preview_actor',
    actual_units: Number(actualUnits),
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
  if (value === true) return 'passed';
  if (value === false) return 'failed';
  const text = normalizeLower(value);
  if (['passed', 'pass', 'true', 'yes', 'ok'].includes(text)) return 'passed';
  if (['failed', 'fail', 'false', 'no'].includes(text)) return 'failed';
  return '';
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

  const verificationNotes = sanitizeText(input.verification_notes || input.notes, 600);
  if (verificationNotes) normalized.verification_notes = verificationNotes;
  if (Array.isArray(input.staff_on_duty)) normalized.staff_on_duty = safeStringArray(input.staff_on_duty, 120);
  if (input.corrective_action_required === true) normalized.corrective_action_required = true;
  return normalized;
}

function parseVerificationPreviewData(body) {
  const blockers = [];
  const globalInput = normalizeVerificationInput(body?.verification_data, 'global', blockers);
  const byBatchSource = safeObject(body?.verification_data_by_batch_id || body?.verification_data_by_batch || body?.batch_verification_data);
  const verificationDataByBatchId = {};
  for (const [rawBatchId, rawData] of Object.entries(byBatchSource)) {
    const batchId = sanitizeId(rawBatchId, 180);
    if (!batchId) {
      blockers.push('invalid_verification_data_batch_id');
      continue;
    }
    verificationDataByBatchId[batchId] = normalizeVerificationInput(rawData, batchId, blockers);
  }
  return {
    verificationData: globalInput,
    verificationDataByBatchId,
    verificationDataBlockers: uniqueStrings(blockers),
  };
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
  const pHStatus = normalizePassFail(verificationInput.pH_passed_failed ?? verificationInput.ph_passed_failed ?? verificationInput.pH_passed ?? verificationInput.ph_passed ?? batch.pH_passed_failed);
  const passedFailed = normalizePassFail(verificationInput.passed_failed ?? verificationInput.batch_passed_failed ?? verificationInput.batch_passed ?? batch.passed_failed);
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
    is_test_record: isInternalTestBatch(batch),
    ...(isInternalTestBatch(batch) ? { test_batch_id: sanitizeId(batch.batch_id) || sanitizeId(batch.id) } : {}),
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
  const preStartCompliance = safeObject(body.pre_start_compliance);

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
    plan = planStart({ batch, actorEmail, requestId, now, preStartCompliance });
  } else if (action === 'complete') {
    plan = planComplete({ batch, actorEmail, requestId, now, completionInput });
  } else {
    plan = planVerify({ batch, actorEmail, requestId, now, verificationInput });
  }

  const blockers = safeStringArray(plan.blockers);
  const warnings = safeStringArray(plan.warnings);
  const gate = liveGateStatus({ action, batch, actorEmail });
  const nativeWriteAllowed = blockers.length === 0 && gate.native_write_allowed === true;
  return {
    success: true,
    dry_run: true,
    action,
    native_writer_enabled: gate.native_writer_enabled,
    source: 'customer_app_native_preview',
    ...buildBaseSummary(batch),
    lifecycle_ready: blockers.length === 0,
    native_write_allowed: nativeWriteAllowed,
    live_command_available: nativeWriteAllowed,
    live_command_blockers: gate.live_command_blockers,
    live_gate: gate.live_gate,
    projected_writes: safeStringArray(plan.projected_writes),
    proposed_patch: plan.proposed_patch,
    compliance_log_draft: plan.compliance_log_draft || null,
    pre_start_compliance: action === 'start' ? preStartCompliance : null,
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

function nextLifecycleStepFor({ batch, startPlan, completePlan, verifyPlan }) {
  const status = normalizeLower(batch.status);
  if (TERMINAL_STATUSES.has(status) || batch.verified_at || batch.verified_by || batch.compliance_log_id) return 'lifecycle_complete';
  if (status === 'completed_pending_verification') return 'verify';
  if (status === 'in_production') return 'complete';
  if (startPlan.blockers.length === 0) return 'start';
  if (completePlan.blockers.length === 0) return 'complete';
  if (verifyPlan.blockers.length === 0) return 'verify';
  return null;
}

function startStateFor({ batch, startBlockers }) {
  const status = normalizeLower(batch.status);
  if (status === 'in_production' || batch.actual_start_time) return 'already_started';
  if (TERMINAL_STATUSES.has(status) || batch.actual_end_time || batch.completed_by || batch.verified_at || batch.verified_by || batch.compliance_log_id) return 'not_applicable_terminal_or_completed';
  return startBlockers.length === 0 ? 'ready_to_start_preview_only' : 'start_blocked';
}

function completeStateFor({ batch, completeBlockers }) {
  const status = normalizeLower(batch.status);
  if (completeBlockers.length === 0) return 'ready_to_complete_preview_only';
  if (status === 'in_production') return 'complete_blocked_missing_completion_fields';
  if (status === 'completed_pending_verification') return 'already_completed_pending_verification';
  if (TERMINAL_STATUSES.has(status)) return 'not_applicable_already_verified_or_archived';
  return 'complete_blocked';
}

function verifyStateFor({ batch, verifyBlockers }) {
  const status = normalizeLower(batch.status);
  if (verifyBlockers.length === 0) return 'ready_to_verify_preview_only';
  if (status === 'completed_pending_verification') return 'verify_blocked_missing_compliance_fields';
  if (status === 'in_production') return 'verify_blocked_until_completion';
  if (TERMINAL_STATUSES.has(status)) return 'not_applicable_already_verified_or_archived';
  return 'verify_blocked';
}

function completionInputForBatch(batch, lookup) {
  const batchId = sanitizeId(batch?.batch_id, 180);
  const productName = normalizeLower(batch?.product_name);
  const actualUnits = lookup?.actualUnitsByBatchId?.[batchId] ?? lookup?.actualUnitsByProductName?.[productName];
  return actualUnits === undefined ? {} : { actual_units: actualUnits };
}

function verificationInputForBatch(batch, lookup) {
  const batchId = sanitizeId(batch?.batch_id, 180);
  return {
    ...safeObject(lookup?.verificationData),
    ...safeObject(lookup?.verificationDataByBatchId?.[batchId]),
  };
}

function safeVerificationPreviewSummary(input) {
  const source = safeObject(input);
  return {
    pH_result: safeNumber(source.pH_result),
    pH_passed_failed: normalizePassFail(source.pH_passed_failed),
    passed_failed: normalizePassFail(source.passed_failed),
    verification_notes_present: Boolean(source.verification_notes),
    staff_on_duty_count: Array.isArray(source.staff_on_duty) ? source.staff_on_duty.length : 0,
  };
}

function buildBatchLifecycleRow({ batch, actorEmail, requestId, now, complianceLogs, preStartComplianceRecords, lookup }) {
  const completionInput = completionInputForBatch(batch, lookup);
  const verificationInput = verificationInputForBatch(batch, lookup);
  const preStartCompliance = evaluatePreStartCompliance({
    batch,
    sanitationLogs: preStartComplianceRecords?.sanitationLogs,
    dailyChecklists: preStartComplianceRecords?.dailyChecklists,
    temperatureLogs: preStartComplianceRecords?.temperatureLogs,
  });
  const startPlan = planStart({ batch, actorEmail, requestId, now, preStartCompliance });
  const completePlan = planComplete({ batch, actorEmail, requestId, now, completionInput });
  const verifyPlan = planVerify({ batch, actorEmail, requestId, now, verificationInput });
  const startBlockers = uniqueStrings(startPlan.blockers);
  const completeBlockers = uniqueStrings(completePlan.blockers);
  const verifyBlockers = uniqueStrings(verifyPlan.blockers);
  const lifecycleWarnings = uniqueStrings([...startPlan.warnings, ...completePlan.warnings, ...verifyPlan.warnings]);
  const classification = classifyLifecycle({ batch, startPlan, completePlan, verifyPlan });
  const completionActualUnits = safeNumber(completionInput.actual_units);

  return {
    ...buildBaseSummary(batch),
    classification,
    current_status: sanitizeLifecycleStatus(batch.status || 'planned', 80) || null,
    current_status_label: sanitizeLifecycleStatus(batch.status || 'planned', 80) || null,
    start_state: startStateFor({ batch, startBlockers }),
    complete_state: completeStateFor({ batch, completeBlockers }),
    verify_state: verifyStateFor({ batch, verifyBlockers }),
    completion_actual_units_preview: completionActualUnits,
    completion_required_fields: ['actual_units'],
    completion_optional_fields: [],
    completion_data_contract: 'exact_batch_actual_units_only',
    verification_input_preview: safeVerificationPreviewSummary(verificationInput),
    verification_required_fields: ['pH_result', 'pH_passed', 'batch_passed'],
    verification_optional_fields: ['verification_notes', 'staff_on_duty'],
    verification_data_contract: 'exact_batch_verification_data_only',
    verification_compliance_log_draft: verifyPlan.compliance_log_draft || null,
    can_start: startBlockers.length === 0,
    can_complete: completeBlockers.length === 0,
    can_verify: verifyBlockers.length === 0,
    next_allowed_transition: nextAllowedTransition({ startPlan, completePlan, verifyPlan }),
    next_lifecycle_step: nextLifecycleStepFor({ batch, startPlan, completePlan, verifyPlan }),
    next_lifecycle_step_label: sanitizeLifecycleStatus(nextLifecycleStepFor({ batch, startPlan, completePlan, verifyPlan }) || '', 80) || null,
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
    pre_start_compliance: preStartCompliance,
    expected_start_writes_if_approved: safeStringArray(startPlan.projected_writes),
    expected_complete_writes_if_approved: safeStringArray(completePlan.projected_writes),
    expected_verify_writes_if_approved: safeStringArray(verifyPlan.projected_writes),
  };
}

function summarizeAction(rows, action) {
  const key = `can_${action}`;
  const blockerKey = `${action}_blockers`;
  const readyRows = rows.filter(row => row[key] === true);
  const alreadyStartedRows = action === 'start'
    ? rows.filter(row => row.start_state === 'already_started')
    : [];
  const blockedRows = rows.filter(row => row[key] !== true && !(action === 'start' && row.start_state === 'already_started'));
  const expectedWrites = action === 'start'
    ? ['ProductionBatch.status', 'ProductionBatch.actual_start_time', 'ProductionBatch.started_by', 'ProductionBatch.audit_trail']
    : action === 'complete'
      ? ['ProductionBatch.status', 'ProductionBatch.actual_end_time', 'ProductionBatch.completed_by', 'ProductionBatch.actual_units', 'ProductionBatch.audit_trail']
      : ['BatchComplianceLog', 'ProductionBatch.status', 'ProductionBatch.verified_by', 'ProductionBatch.verified_at', 'ProductionBatch.pH_result', 'ProductionBatch.pH_passed_failed', 'ProductionBatch.passed_failed', 'ProductionBatch.compliance_log_id', 'ProductionBatch.audit_trail'];
  return {
    action,
    preview_only: true,
    ready_count: readyRows.length,
    blocked_count: blockedRows.length,
    already_started_count: alreadyStartedRows.length,
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
    sanitation_temperature_checklist_context: 'server_enforced_before_start',
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

function buildOrderLifecyclePreview({ customerOrder, nativeOrder, task, batches, complianceLogs, preStartComplianceRecords, lookup, auth, now }) {
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
  if (Array.isArray(lookup.actualUnitsBlockers) && lookup.actualUnitsBlockers.length > 0) {
    blockers.push(...lookup.actualUnitsBlockers);
  }
  if (Array.isArray(lookup.verificationDataBlockers) && lookup.verificationDataBlockers.length > 0) {
    blockers.push(...lookup.verificationDataBlockers);
  }

  const rows = (batches || []).map(batch => buildBatchLifecycleRow({
    batch,
    actorEmail: auth.actor_email,
    requestId: lookup.requestId,
    now,
    complianceLogs,
    preStartComplianceRecords,
    lookup,
  }));

  if (rows.some(row => row.is_locked)) warnings.push('one_or_more_batches_locked');
  if (rows.some(row => row.current_status === 'planned' || row.current_status === 'ready_for_production')) warnings.push('complete_and_verify_held_until_start_and_completion_data_exist');
  if (rows.some(row => normalizeLower(row.current_status) === 'in_production')) warnings.push('production_in_progress_complete_preview_pending_completion_data');
  if (rows.some(row => normalizeLower(row.current_status) === 'completed_pending_verification')) warnings.push('production_completed_verify_preview_pending_compliance_qc_data');
  if (rows.some(row => row.lifecycle_warnings.includes('inventory_deduction_held'))) warnings.push('inventory_deduction_held');
  warnings.push('purchase_order_automation_held');
  warnings.push('hub_fallback_required');

  const startPreview = summarizeAction(rows, 'start');
  const completePreview = summarizeAction(rows, 'complete');
  const verifyPreview = summarizeAction(rows, 'verify');
  const compliancePreview = buildCompliancePreview(rows, complianceLogs);
  const cascadePreview = buildCascadePreview({ rows, nativeOrder, task });
  const completionRows = rows.map(row => ({
    batch_id: row.batch_id || row.production_batch_id,
    product_name: row.product_name,
    current_status: row.current_status,
    complete_state: row.complete_state,
    can_complete: row.can_complete,
    actual_start_time_present: Boolean(row.actual_start_time),
    actual_units_preview: row.completion_actual_units_preview,
    required_fields: row.completion_required_fields || ['actual_units'],
    projected_writes_if_later_approved: row.expected_complete_writes_if_approved || [],
    blockers: row.complete_blockers || [],
    warnings: row.lifecycle_warnings || [],
  }));
  const verificationRows = rows.map(row => ({
    batch_id: row.batch_id || row.production_batch_id,
    product_name: row.product_name,
    current_status: row.current_status,
    verify_state: row.verify_state,
    can_verify: row.can_verify,
    actual_units_present: safeNumber(row.actual_units) !== null,
    actual_end_time_present: Boolean(row.actual_end_time),
    verification_input_preview: row.verification_input_preview,
    required_fields: row.verification_required_fields || ['pH_result', 'pH_passed', 'batch_passed'],
    optional_fields: row.verification_optional_fields || ['verification_notes', 'staff_on_duty'],
    compliance_log_draft_ready: Boolean(row.verification_compliance_log_draft),
    projected_writes_if_later_approved: row.expected_verify_writes_if_approved || [],
    blockers: row.verify_blockers || [],
    warnings: row.lifecycle_warnings || [],
  }));
  const completionPreviewReady = rows.length > 0 && completePreview.ready_count === rows.length && blockers.length === 0;
  const verificationPreviewReady = rows.length > 0 && verifyPreview.ready_count === rows.length && blockers.length === 0;
  const actualUnitsSuppliedCount = rows.filter(row => safeNumber(row.completion_actual_units_preview) !== null).length;
  const verificationDataSuppliedCount = rows.filter(row => safeNumber(row.verification_input_preview?.pH_result) !== null && Boolean(row.verification_input_preview?.pH_passed_failed) && Boolean(row.verification_input_preview?.passed_failed)).length;
  const hasInProductionRows = rows.some(row => normalizeLower(row.current_status) === 'in_production');
  const hasCompletedPendingVerificationRows = rows.some(row => normalizeLower(row.current_status) === 'completed_pending_verification');
  const allLifecycleComplete = rows.length > 0 && rows.every(row => row.next_lifecycle_step === 'lifecycle_complete');
  const nextAction = blockers.length > 0
    ? 'hold_lifecycle_preview_blockers'
    : startPreview.ready_count > 0
      ? 'plan_gated_native_start_production_command'
      : completePreview.ready_count > 0
        ? 'plan_gated_native_complete_production_command_with_actual_units'
        : verifyPreview.ready_count > 0
          ? 'plan_gated_native_verify_production_command'
          : hasCompletedPendingVerificationRows
            ? 'plan_native_verify_production_preview_or_command'
            : hasInProductionRows
              ? 'plan_native_complete_production_preview_or_command'
              : allLifecycleComplete
                ? 'lifecycle_complete_or_archived'
                : 'review_lifecycle_state_or_hub_fallback';
  const nextActionKey = nextAction.includes('start_production')
    ? 'start'
    : nextAction.includes('complete_production')
      ? 'complete'
      : nextAction.includes('verify_production')
        ? 'verify'
        : null;
  const nextActionRows = nextActionKey ? rows.filter(row => row[`can_${nextActionKey}`] === true) : [];
  const nextActionGates = nextActionRows.map(row => liveGateStatus({
    action: nextActionKey,
    batch: {
      id: row.production_batch_id,
      batch_id: row.batch_id,
      is_test_batch: isInternalTestBatch(row),
    },
    actorEmail: auth.actor_email,
  }));
  const liveCommandBlockers = uniqueStrings(nextActionGates.flatMap(gate => gate.live_command_blockers || []));
  const liveCommandAvailable = blockers.length === 0 &&
    nextActionRows.length > 0 &&
    nextActionGates.length === nextActionRows.length &&
    nextActionGates.every(gate => gate.native_write_allowed === true);
  const nativeWriterEnabled = Deno.env.get(ENABLE_WRITES_FLAG) === 'true';

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
    completion_preview_ready: completionPreviewReady,
    complete_ready_count: completePreview.ready_count,
    complete_blocked_count: completePreview.blocked_count,
    actual_units_supplied_count: actualUnitsSuppliedCount,
    completion_required_fields: ['actual_units'],
    completion_optional_fields: [],
    completion_data_contract: 'exact_batch_actual_units_only',
    completion_rows: completionRows,
    verify_preview: verifyPreview,
    verification_preview_ready: verificationPreviewReady,
    verify_ready_count: verifyPreview.ready_count,
    verify_blocked_count: verifyPreview.blocked_count,
    verification_data_supplied_count: verificationDataSuppliedCount,
    verification_required_fields: ['pH_result', 'pH_passed', 'batch_passed'],
    verification_optional_fields: ['verification_notes', 'staff_on_duty'],
    verification_data_contract: 'exact_batch_verification_data_only',
    verification_rows: verificationRows,
    compliance_preview: compliancePreview,
    cascade_preview: cascadePreview,
    blockers: uniqueStrings(blockers),
    warnings: uniqueStrings(warnings),
    hub_fallback_required: true,
    live_execution_approved: liveCommandAvailable,
    live_command_available: liveCommandAvailable,
    live_command_action: nextActionKey,
    live_command_blockers: liveCommandBlockers,
    native_write_allowed: liveCommandAvailable,
    native_writer_enabled: nativeWriterEnabled,
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

  const [allBatches, complianceLogs, sanitationLogs, dailyChecklists, temperatureLogs] = await Promise.all([
    listEntity(base44, 'ProductionBatch', '-production_date', DEFAULT_LIST_LIMIT),
    listEntity(base44, 'BatchComplianceLog', '-created_date', DEFAULT_LIST_LIMIT),
    listEntity(base44, 'SanitationLog', '-created_date', DEFAULT_LIST_LIMIT),
    listEntity(base44, 'DailyChecklist', '-created_date', DEFAULT_LIST_LIMIT),
    listEntity(base44, 'TemperatureLog', '-created_date', DEFAULT_LIST_LIMIT),
  ]);
  const batches = filterProductionBatches(allBatches, { orderNumber, customerOrder, nativeOrder, task, lookup });
  const now = new Date().toISOString();
  return buildOrderLifecyclePreview({
    customerOrder,
    nativeOrder,
    task,
    batches,
    complianceLogs,
    preStartComplianceRecords: { sanitationLogs, dailyChecklists, temperatureLogs },
    lookup,
    auth,
    now,
  });
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
      const preStartCompliance = normalizeLower(body.action) === 'start'
        ? await loadPreStartCompliance(base44, safeObject(body.batch))
        : null;
      const result = planLifecycle({
        ...body,
        actor_email: auth.actor_email,
        pre_start_compliance: preStartCompliance,
      });
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
