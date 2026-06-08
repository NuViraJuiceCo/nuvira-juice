import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const FUNCTION_NAME = 'previewNativeScheduleExceptionCorrection';
const DEFAULT_MAX_ROWS = 80;
const DEFAULT_RECORDED_PRODUCTION_DATE = '2026-06-05';
const DEFAULT_RECORDED_DELIVERY_DATE = '2026-06-06';
const TARGET_ORDER_NUMBER = 'NV-MPZNKGNT';
const TARGET_CUSTOMER_APP_ORDER_ID = '6a219a3f4adcda5856c3d579';
const TARGET_NATIVE_SHOPIFY_ORDER_ID = '6a22ffda400eb806eb3ca945';
const TARGET_NATIVE_FULFILLMENT_TASK_ID = '6a22ffdaf675ea79e30575aa';
const TARGET_BATCH_ID_PREFIX = 'NATIVE-NV-MPZNKGNT-2026-06-05-';

const ALLOWED_BODY_KEYS = new Set([
  'mode',
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
  'current_recorded_production_date',
  'current_recorded_delivery_date',
  'proposed_actual_production_date',
  'proposed_actual_delivery_date',
  'proposed_delivery_window',
  'correction_mode',
  'request_id',
  '_internal_secret',
  'internal_secret',
]);

const TERMINAL_CUSTOMER_STATUSES = new Set(['cancelled', 'canceled', 'refunded', 'delivered', 'picked_up']);
const TERMINAL_TASK_STATUSES = new Set(['cancelled', 'canceled', 'delivered', 'unable_to_deliver']);
const DELIVERY_ADVANCED_STATUSES = new Set(['out_for_delivery', 'arriving_soon', 'delivered']);
const READ_ONLY_SAFETY = Object.freeze({
  dry_run_only: true,
  writes_performed: false,
  customer_app_order_updated: false,
  status_history_appended: false,
  native_shopify_order_updated: false,
  native_fulfillment_task_updated: false,
  production_batch_updated: false,
  batch_compliance_log_updated: false,
  notifications_created: false,
  notifications_sent: false,
  delivery_status_updated: false,
  delivery_route_proof_drop_mutated: false,
  inventory_deducted: false,
  purchase_orders_created: false,
  provider_calls_performed: false,
  stripe_calls_performed: false,
  shopify_api_calls_performed: false,
  sync_repair_replay_performed: false,
  global_schedule_logic_changed: false,
  hub_bridge_modified: false,
});

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizeLower(value) {
  return normalizeSingleLine(value).toLowerCase();
}

function sanitizeText(value, maxLength = 180) {
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

function sanitizeId(value, maxLength = 180) {
  const text = sanitizeText(value, maxLength);
  return text && /^[A-Za-z0-9._:@/#-]+$/.test(text) ? text : '';
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizeText(value));
}

function normalizedDate(value) {
  const text = normalizeText(value);
  return isIsoDate(text) ? text : '';
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function getPreviewSecret() {
  return normalizeText(Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET')) ||
    normalizeText(Deno.env.get('CUSTOMER_APP_SYNC_SECRET')) ||
    normalizeText(Deno.env.get('HUB_SYNC_SECRET'));
}

function unauthorized() {
  return Response.json({ success: false, error_code: 'unauthorized', writes_performed: false }, { status: 401 });
}

function forbidden() {
  return Response.json({ success: false, error_code: 'forbidden', writes_performed: false }, { status: 403 });
}

async function requirePreviewAccess({ base44, req, body }) {
  const headerSecret = normalizeText(req.headers.get('x-internal-secret'));
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
    if (!ALLOWED_BODY_KEYS.has(normalizeLower(key))) return key;
  }
  return null;
}

function parseDeliveryWindow(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const label = sanitizeText(raw.delivery_window_label || raw.label || raw.time_window, 120) || null;
  const start = sanitizeText(raw.assigned_delivery_window_start || raw.delivery_window_start || raw.start, 120) || null;
  const end = sanitizeText(raw.assigned_delivery_window_end || raw.delivery_window_end || raw.end, 120) || null;
  const timezone = sanitizeText(raw.delivery_window_timezone || raw.timezone || 'America/Chicago', 80) || 'America/Chicago';
  return label || start || end ? { delivery_window_label: label, assigned_delivery_window_start: start, assigned_delivery_window_end: end, delivery_window_timezone: timezone } : null;
}

function getLookup(body) {
  const explicitMode = normalizeText(body?.correction_mode).toUpperCase();
  const proposedWindow = parseDeliveryWindow(body?.proposed_delivery_window);
  const rawCurrentRecordedProductionDate = normalizeText(body?.current_recorded_production_date);
  const rawCurrentRecordedDeliveryDate = normalizeText(body?.current_recorded_delivery_date);
  const rawProposedActualProductionDate = normalizeText(body?.proposed_actual_production_date);
  const rawProposedActualDeliveryDate = normalizeText(body?.proposed_actual_delivery_date);
  return {
    orderNumber: normalizeText(body?.order_number || body?.shopify_order_number).replace(/^#/, ''),
    customerAppOrderId: sanitizeId(body?.customer_app_order_id || body?.base44_order_id || body?.order_id, 120),
    nativeShopifyOrderId: sanitizeId(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id, 120),
    nativeFulfillmentTaskId: sanitizeId(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id, 120),
    currentRecordedProductionDate: normalizedDate(rawCurrentRecordedProductionDate),
    currentRecordedDeliveryDate: normalizedDate(rawCurrentRecordedDeliveryDate),
    proposedActualProductionDate: normalizedDate(rawProposedActualProductionDate),
    proposedActualDeliveryDate: normalizedDate(rawProposedActualDeliveryDate),
    currentRecordedProductionDateProvided: Boolean(rawCurrentRecordedProductionDate),
    currentRecordedDeliveryDateProvided: Boolean(rawCurrentRecordedDeliveryDate),
    proposedActualProductionDateProvided: Boolean(rawProposedActualProductionDate),
    proposedActualDeliveryDateProvided: Boolean(rawProposedActualDeliveryDate),
    currentRecordedProductionDateInvalid: Boolean(rawCurrentRecordedProductionDate && !normalizedDate(rawCurrentRecordedProductionDate)),
    currentRecordedDeliveryDateInvalid: Boolean(rawCurrentRecordedDeliveryDate && !normalizedDate(rawCurrentRecordedDeliveryDate)),
    proposedActualProductionDateInvalid: Boolean(rawProposedActualProductionDate && !normalizedDate(rawProposedActualProductionDate)),
    proposedActualDeliveryDateInvalid: Boolean(rawProposedActualDeliveryDate && !normalizedDate(rawProposedActualDeliveryDate)),
    proposedDeliveryWindow: proposedWindow,
    correctionMode: explicitMode === 'DATE_AND_WINDOW' || proposedWindow ? 'DATE_AND_WINDOW' : 'DATE_ONLY',
    requestId: sanitizeId(body?.request_id, 180),
  };
}

function hasExactLookup(lookup) {
  return Boolean(lookup.orderNumber && lookup.customerAppOrderId && lookup.nativeShopifyOrderId && lookup.nativeFulfillmentTaskId);
}

async function filterEntity(base44, entityName, filter, sort = '-created_date', limit = 20) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity?.filter) return [];
  const rows = await entity.filter(filter, sort, limit).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function listEntity(base44, entityName, sort = '-created_date', limit = 500) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity?.list) return [];
  const rows = await entity.list(sort, limit).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function findOne(base44, entityName, filters, sort = '-created_date', limit = 20) {
  const matches = [];
  for (const filter of filters) {
    const rows = await filterEntity(base44, entityName, filter, sort, limit);
    for (const row of rows) {
      if (row?.id && !matches.some(existing => existing.id === row.id)) matches.push(row);
    }
  }
  return { row: matches[0] || null, matches };
}

async function loadContext(base44, lookup) {
  const customerOrderResult = await findOne(base44, 'Order', [
    { id: lookup.customerAppOrderId },
    { order_number: lookup.orderNumber },
    { shopify_order_number: lookup.orderNumber },
  ], '-created_date', 10);
  const customerOrder = customerOrderResult.row;

  const nativeOrderResult = await findOne(base44, 'ShopifyOrder', [
    { id: lookup.nativeShopifyOrderId },
    { shopify_order_id: lookup.nativeShopifyOrderId },
    { base44_order_id: lookup.customerAppOrderId },
    { shopify_order_number: lookup.orderNumber },
    { order_number: lookup.orderNumber },
  ], '-created_date', 20);
  const nativeOrder = nativeOrderResult.row;

  const taskResult = await findOne(base44, 'FulfillmentTask', [
    { id: lookup.nativeFulfillmentTaskId },
    { fulfillment_task_id: lookup.nativeFulfillmentTaskId },
    { native_shopify_order_id: lookup.nativeShopifyOrderId },
    { shopify_order_id: lookup.nativeShopifyOrderId },
    { base44_order_id: lookup.customerAppOrderId },
    { order_id: lookup.customerAppOrderId },
    { order_number: lookup.orderNumber },
    { shopify_order_number: lookup.orderNumber },
  ], '-created_date', 40);
  const task = taskResult.row;

  const allBatches = await listEntity(base44, 'ProductionBatch', '-production_date', 900);
  const batches = allBatches.filter(batch => {
    const text = [batch?.batch_id, batch?.source_order_number, batch?.order_number, batch?.source_order_id, batch?.base44_order_id, batch?.native_shopify_order_id, batch?.native_fulfillment_task_id, JSON.stringify(batch?.order_sources || []), JSON.stringify(batch?.related_orders || [])].map(normalizeText).join(' ');
    return text.includes(lookup.orderNumber) || text.includes(lookup.customerAppOrderId) || text.includes(lookup.nativeShopifyOrderId) || text.includes(lookup.nativeFulfillmentTaskId);
  }).slice(0, DEFAULT_MAX_ROWS);

  const complianceGroups = await Promise.all(batches.map(async batch => {
    const byBatch = batch?.batch_id ? await filterEntity(base44, 'BatchComplianceLog', { batch_id: batch.batch_id }, '-created_date', 20) : [];
    const bySource = batch?.id ? await filterEntity(base44, 'BatchComplianceLog', { source_production_batch_id: batch.id }, '-created_date', 20) : [];
    return [...new Map([...byBatch, ...bySource].map(row => [row.id, row])).values()];
  }));

  return {
    customerOrder,
    nativeOrder,
    task,
    batches,
    complianceLogs: complianceGroups.flat(),
    matchCounts: {
      customer_app_order_matches: customerOrderResult.matches.length,
      native_shopify_order_matches: nativeOrderResult.matches.length,
      native_fulfillment_task_matches: taskResult.matches.length,
    },
  };
}

function dateFields(row, fields) {
  const result = {};
  for (const field of fields) result[field] = sanitizeText(row?.[field], 80) || null;
  return result;
}

function firstFulfillment(row) {
  return Array.isArray(row?.fulfillments) && row.fulfillments.length > 0 ? row.fulfillments[0] : null;
}

function firstNonEmpty(row, fields) {
  for (const field of fields) {
    const value = normalizeText(row?.[field]);
    if (value) return value;
  }
  return '';
}

function addChange(changes, { record_type, record_id, field, from, to, reason, recommended = true }) {
  const cleanFrom = from === undefined ? null : from;
  const cleanTo = to === undefined ? null : to;
  if (cleanFrom === cleanTo) return;
  changes.push({
    record_type,
    record_id: sanitizeId(record_id, 140) || null,
    field,
    from: cleanFrom,
    to: cleanTo,
    reason,
    recommended,
  });
}

function summarizeBatchDates(batches) {
  const rows = (batches || []).map(batch => ({
    id: sanitizeId(batch?.id, 140) || null,
    batch_id: sanitizeText(batch?.batch_id, 180) || null,
    product_name: sanitizeText(batch?.product_name, 120) || null,
    status: sanitizeText(batch?.status, 80) || null,
    production_date: sanitizeText(batch?.production_date, 80) || null,
    actual_start_time: sanitizeText(batch?.actual_start_time, 120) || null,
    actual_end_time: sanitizeText(batch?.actual_end_time, 120) || null,
    verified_at: sanitizeText(batch?.verified_at, 120) || null,
    compliance_log_id_present: Boolean(batch?.compliance_log_id),
  }));
  return {
    count: rows.length,
    verified_logged_count: rows.filter(row => normalizeLower(row.status) === 'verified_logged').length,
    production_dates: unique(rows.map(row => row.production_date)),
    rows,
  };
}

function summarizeComplianceDates(complianceLogs) {
  const rows = (complianceLogs || []).map(log => ({
    id: sanitizeId(log?.id, 140) || null,
    batch_id: sanitizeText(log?.batch_id, 180) || null,
    juice_flavor: sanitizeText(log?.juice_flavor, 120) || null,
    date: sanitizeText(log?.date, 80) || null,
    start_time: sanitizeText(log?.start_time, 120) || null,
    end_time: sanitizeText(log?.end_time, 120) || null,
    verified_at: sanitizeText(log?.verified_at, 120) || null,
    locked: log?.locked === true,
  }));
  return {
    count: rows.length,
    locked_count: rows.filter(row => row.locked).length,
    dates: unique(rows.map(row => row.date)),
    rows,
  };
}

function buildPreview({ customerOrder, nativeOrder, task, batches, complianceLogs, matchCounts, lookup, auth }) {
  const blockers = [];
  const warnings = [];
  const classifications = [];
  const proposedFieldChanges = [];
  const recordsNotUpdated = [];
  const recordsToUpdate = [];
  const targetOrderNumber = sanitizeText(lookup.orderNumber, 120) || null;

  if (!customerOrder) blockers.push('target_customer_app_order_not_found');
  if (!nativeOrder) blockers.push('target_native_shopify_order_not_found');
  if (!task) blockers.push('target_native_fulfillment_task_not_found');
  if (!lookup.proposedActualProductionDateProvided) blockers.push('proposed_actual_production_date_missing');
  if (!lookup.proposedActualDeliveryDateProvided) blockers.push('proposed_actual_delivery_date_missing');
  if (lookup.currentRecordedProductionDateInvalid) blockers.push('current_recorded_production_date_invalid');
  if (lookup.currentRecordedDeliveryDateInvalid) blockers.push('current_recorded_delivery_date_invalid');
  if (lookup.proposedActualProductionDateInvalid) blockers.push('proposed_actual_production_date_invalid');
  if (lookup.proposedActualDeliveryDateInvalid) blockers.push('proposed_actual_delivery_date_invalid');

  if (matchCounts.customer_app_order_matches > 1) blockers.push('ambiguous_multiple_customer_app_order_matches');
  if (matchCounts.native_shopify_order_matches > 1) blockers.push('ambiguous_multiple_native_shopify_order_matches');
  if (matchCounts.native_fulfillment_task_matches > 1) blockers.push('ambiguous_multiple_native_fulfillment_task_matches');

  if (customerOrder && customerOrder.id !== lookup.customerAppOrderId) blockers.push('customer_app_order_id_mismatch');
  if (nativeOrder && nativeOrder.id !== lookup.nativeShopifyOrderId) blockers.push('native_shopify_order_id_mismatch');
  if (task && task.id !== lookup.nativeFulfillmentTaskId) blockers.push('native_fulfillment_task_id_mismatch');
  if (customerOrder && normalizeText(customerOrder.order_number || customerOrder.shopify_order_number).replace(/^#/, '') !== lookup.orderNumber) blockers.push('customer_app_order_number_mismatch');
  if (nativeOrder && normalizeText(nativeOrder.shopify_order_number || nativeOrder.order_number).replace(/^#/, '') !== lookup.orderNumber) blockers.push('native_shopify_order_number_mismatch');
  if (task && normalizeText(task.order_number || task.shopify_order_number).replace(/^#/, '') !== lookup.orderNumber) blockers.push('native_fulfillment_task_order_number_mismatch');

  if (customerOrder && !(customerOrder.payment_captured === true || normalizeLower(customerOrder.payment_status) === 'paid')) blockers.push('customer_app_order_not_paid_or_captured');
  if (customerOrder && TERMINAL_CUSTOMER_STATUSES.has(normalizeLower(customerOrder.status))) blockers.push('customer_app_order_terminal_status');
  if (task && TERMINAL_TASK_STATUSES.has(normalizeLower(task.status))) blockers.push('native_fulfillment_task_terminal_status');
  if (task && DELIVERY_ADVANCED_STATUSES.has(normalizeLower(task.delivery_status))) blockers.push('delivery_lifecycle_already_advanced');

  const currentCustomerProductionDate = firstNonEmpty(customerOrder, ['production_date', 'assigned_production_day']);
  const currentCustomerDeliveryDate = firstNonEmpty(customerOrder, ['estimated_delivery_date', 'assigned_delivery_date']);
  const currentNativeProductionDate = firstNonEmpty(nativeOrder, ['production_date']);
  const currentNativeDeliveryDate = firstNonEmpty(nativeOrder, ['assigned_delivery_date', 'selected_delivery_date']);
  const currentTaskProductionDate = firstNonEmpty(task, ['production_date']);
  const currentTaskDeliveryDate = firstNonEmpty(task, ['delivery_date', 'scheduled_date', 'assigned_delivery_date']);
  if (lookup.currentRecordedProductionDateProvided && lookup.currentRecordedProductionDate && (
    (currentCustomerProductionDate && currentCustomerProductionDate !== lookup.currentRecordedProductionDate) ||
    (currentNativeProductionDate && currentNativeProductionDate !== lookup.currentRecordedProductionDate) ||
    (currentTaskProductionDate && currentTaskProductionDate !== lookup.currentRecordedProductionDate)
  )) blockers.push('current_recorded_production_date_safety_mismatch');
  if (lookup.currentRecordedDeliveryDateProvided && lookup.currentRecordedDeliveryDate && (
    (currentCustomerDeliveryDate && currentCustomerDeliveryDate !== lookup.currentRecordedDeliveryDate) ||
    (currentNativeDeliveryDate && currentNativeDeliveryDate !== lookup.currentRecordedDeliveryDate) ||
    (currentTaskDeliveryDate && currentTaskDeliveryDate !== lookup.currentRecordedDeliveryDate)
  )) blockers.push('current_recorded_delivery_date_safety_mismatch');

  const customerOrderType = normalizeLower(nativeOrder?.order_type || customerOrder?.order_type || task?.order_type || 'one_time') || 'one_time';
  const fulfillmentMode = normalizeLower(nativeOrder?.fulfillment_mode || customerOrder?.fulfillment_mode || task?.fulfillment_mode || 'single_delivery') || 'single_delivery';
  if (customerOrderType === 'subscription' || fulfillmentMode === 'multi_delivery' || nativeOrder?.is_subscription === true || customerOrder?.is_subscription === true) blockers.push('subscription_multi_delivery_schedule_exception_blocked');

  const batchSummary = summarizeBatchDates(batches);
  const complianceSummary = summarizeComplianceDates(complianceLogs);
  const allBatchesVerified = batchSummary.count > 0 && batchSummary.verified_logged_count === batchSummary.count;
  const allComplianceLocked = complianceSummary.count > 0 && complianceSummary.locked_count === complianceSummary.count;
  if (batchSummary.count > 0 && allBatchesVerified) classifications.push('production_batch_date_change_not_recommended');
  if (complianceSummary.count > 0 && allComplianceLocked) classifications.push('compliance_log_date_change_not_recommended');

  const currentDates = {
    customer_app_order: customerOrder ? {
      ...dateFields(customerOrder, ['production_date', 'assigned_production_day', 'estimated_delivery_date', 'assigned_delivery_date', 'selected_delivery_date', 'requested_delivery_date', 'delivery_window_label', 'assigned_delivery_window_start', 'assigned_delivery_window_end', 'delivery_window_timezone']),
      status: sanitizeText(customerOrder.status, 80) || null,
      status_history_count: Array.isArray(customerOrder.status_history) ? customerOrder.status_history.length : 0,
    } : null,
    native_shopify_order: nativeOrder ? {
      ...dateFields(nativeOrder, ['production_date', 'assigned_delivery_date', 'selected_delivery_date', 'delivery_window_label']),
      production_status: sanitizeText(nativeOrder.production_status, 80) || null,
      fulfillment_status: sanitizeText(nativeOrder.fulfillment_status, 80) || null,
      first_fulfillment: firstFulfillment(nativeOrder) ? dateFields(firstFulfillment(nativeOrder), ['production_date', 'delivery_date', 'assigned_delivery_date', 'scheduled_date', 'delivery_window_label']) : null,
    } : null,
    native_fulfillment_task: task ? {
      ...dateFields(task, ['production_date', 'delivery_date', 'scheduled_date', 'assigned_delivery_date', 'time_window', 'delivery_window_label']),
      status: sanitizeText(task.status, 80) || null,
      delivery_status: sanitizeText(task.delivery_status, 80) || null,
      production_status: sanitizeText(task.production_status, 80) || null,
      packed_at: sanitizeText(task.packed_at, 120) || null,
    } : null,
    production_batch_summary: batchSummary,
    batch_compliance_log_summary: complianceSummary,
  };

  const proposedDates = {
    actual_production_date: lookup.proposedActualProductionDate,
    actual_delivery_date: lookup.proposedActualDeliveryDate,
  };

  const taskNeedsCorrection = Boolean(task && (
    task.production_date !== lookup.proposedActualProductionDate ||
    task.delivery_date !== lookup.proposedActualDeliveryDate ||
    task.scheduled_date !== lookup.proposedActualDeliveryDate ||
    task.assigned_delivery_date !== lookup.proposedActualDeliveryDate
  ));
  const customerOrderNeedsCorrection = Boolean(customerOrder && (
    customerOrder.production_date !== lookup.proposedActualProductionDate ||
    customerOrder.assigned_production_day !== lookup.proposedActualProductionDate ||
    customerOrder.estimated_delivery_date !== lookup.proposedActualDeliveryDate ||
    customerOrder.assigned_delivery_date !== lookup.proposedActualDeliveryDate
  ));
  const nativeOrderNeedsCorrection = Boolean(nativeOrder && (
    nativeOrder.production_date !== lookup.proposedActualProductionDate ||
    nativeOrder.assigned_delivery_date !== lookup.proposedActualDeliveryDate ||
    nativeOrder.selected_delivery_date !== lookup.proposedActualDeliveryDate ||
    firstFulfillment(nativeOrder)?.production_date !== lookup.proposedActualProductionDate ||
    firstFulfillment(nativeOrder)?.delivery_date !== lookup.proposedActualDeliveryDate
  ));

  if (taskNeedsCorrection) {
    classifications.push('native_fulfillment_task_schedule_correction_needed');
    recordsToUpdate.push({ record_type: 'FulfillmentTask', record_id: task.id, reason: 'date_filter_and_delivery_queue_alignment' });
    addChange(proposedFieldChanges, { record_type: 'FulfillmentTask', record_id: task.id, field: 'delivery_date', from: task.delivery_date || null, to: lookup.proposedActualDeliveryDate, reason: 'align_task_delivery_date_with_one_order_exception' });
    addChange(proposedFieldChanges, { record_type: 'FulfillmentTask', record_id: task.id, field: 'scheduled_date', from: task.scheduled_date || null, to: lookup.proposedActualDeliveryDate, reason: 'align_task_scheduled_date_with_one_order_exception' });
    addChange(proposedFieldChanges, { record_type: 'FulfillmentTask', record_id: task.id, field: 'assigned_delivery_date', from: task.assigned_delivery_date || null, to: lookup.proposedActualDeliveryDate, reason: 'align_task_assigned_delivery_date_with_one_order_exception' });
    addChange(proposedFieldChanges, { record_type: 'FulfillmentTask', record_id: task.id, field: 'production_date', from: task.production_date || null, to: lookup.proposedActualProductionDate, reason: 'align_task_production_date_display_metadata_with_actual_exception' });
    if (lookup.correctionMode === 'DATE_AND_WINDOW' && lookup.proposedDeliveryWindow) {
      addChange(proposedFieldChanges, { record_type: 'FulfillmentTask', record_id: task.id, field: 'time_window', from: task.time_window || null, to: lookup.proposedDeliveryWindow.delivery_window_label, reason: 'align_task_time_window_with_supplied_one_order_exception_window' });
      addChange(proposedFieldChanges, { record_type: 'FulfillmentTask', record_id: task.id, field: 'delivery_window_label', from: task.delivery_window_label || null, to: lookup.proposedDeliveryWindow.delivery_window_label, reason: 'align_task_delivery_window_label_with_supplied_one_order_exception_window' });
    }
  }

  if (customerOrderNeedsCorrection) {
    classifications.push('customer_order_date_correction_recommended');
    recordsToUpdate.push({ record_type: 'Order', record_id: customerOrder.id, reason: 'customer_admin_date_display_alignment' });
    addChange(proposedFieldChanges, { record_type: 'Order', record_id: customerOrder.id, field: 'estimated_delivery_date', from: customerOrder.estimated_delivery_date || null, to: lookup.proposedActualDeliveryDate, reason: 'align_customer_order_display_delivery_date' });
    addChange(proposedFieldChanges, { record_type: 'Order', record_id: customerOrder.id, field: 'assigned_delivery_date', from: customerOrder.assigned_delivery_date || null, to: lookup.proposedActualDeliveryDate, reason: 'align_customer_order_assigned_delivery_date' });
    addChange(proposedFieldChanges, { record_type: 'Order', record_id: customerOrder.id, field: 'production_date', from: customerOrder.production_date || null, to: lookup.proposedActualProductionDate, reason: 'align_customer_order_production_date_alias' });
    addChange(proposedFieldChanges, { record_type: 'Order', record_id: customerOrder.id, field: 'assigned_production_day', from: customerOrder.assigned_production_day || null, to: lookup.proposedActualProductionDate, reason: 'align_customer_order_canonical_production_date' });
    if (lookup.correctionMode === 'DATE_AND_WINDOW' && lookup.proposedDeliveryWindow) {
      addChange(proposedFieldChanges, { record_type: 'Order', record_id: customerOrder.id, field: 'delivery_window_label', from: customerOrder.delivery_window_label || null, to: lookup.proposedDeliveryWindow.delivery_window_label, reason: 'align_customer_order_delivery_window_label_with_supplied_one_order_exception_window' });
      addChange(proposedFieldChanges, { record_type: 'Order', record_id: customerOrder.id, field: 'assigned_delivery_window_start', from: customerOrder.assigned_delivery_window_start || null, to: lookup.proposedDeliveryWindow.assigned_delivery_window_start, reason: 'align_customer_order_delivery_window_start_with_supplied_one_order_exception_window' });
      addChange(proposedFieldChanges, { record_type: 'Order', record_id: customerOrder.id, field: 'assigned_delivery_window_end', from: customerOrder.assigned_delivery_window_end || null, to: lookup.proposedDeliveryWindow.assigned_delivery_window_end, reason: 'align_customer_order_delivery_window_end_with_supplied_one_order_exception_window' });
      addChange(proposedFieldChanges, { record_type: 'Order', record_id: customerOrder.id, field: 'delivery_window_timezone', from: customerOrder.delivery_window_timezone || null, to: lookup.proposedDeliveryWindow.delivery_window_timezone, reason: 'align_customer_order_delivery_window_timezone_with_supplied_one_order_exception_window' });
    }
  }

  if (nativeOrderNeedsCorrection) {
    classifications.push('native_shopify_order_date_correction_recommended');
    recordsToUpdate.push({ record_type: 'ShopifyOrder', record_id: nativeOrder.id, reason: 'native_operational_metadata_alignment' });
    addChange(proposedFieldChanges, { record_type: 'ShopifyOrder', record_id: nativeOrder.id, field: 'assigned_delivery_date', from: nativeOrder.assigned_delivery_date || null, to: lookup.proposedActualDeliveryDate, reason: 'align_native_order_assigned_delivery_date' });
    addChange(proposedFieldChanges, { record_type: 'ShopifyOrder', record_id: nativeOrder.id, field: 'selected_delivery_date', from: nativeOrder.selected_delivery_date || null, to: lookup.proposedActualDeliveryDate, reason: 'align_native_order_selected_delivery_date' });
    addChange(proposedFieldChanges, { record_type: 'ShopifyOrder', record_id: nativeOrder.id, field: 'production_date', from: nativeOrder.production_date || null, to: lookup.proposedActualProductionDate, reason: 'align_native_order_production_date' });
    const first = firstFulfillment(nativeOrder);
    if (first) {
      addChange(proposedFieldChanges, { record_type: 'ShopifyOrder.fulfillments[0]', record_id: nativeOrder.id, field: 'production_date', from: first.production_date || null, to: lookup.proposedActualProductionDate, reason: 'align_first_fulfillment_production_date_snapshot' });
      addChange(proposedFieldChanges, { record_type: 'ShopifyOrder.fulfillments[0]', record_id: nativeOrder.id, field: 'delivery_date', from: first.delivery_date || first.assigned_delivery_date || null, to: lookup.proposedActualDeliveryDate, reason: 'align_first_fulfillment_delivery_date_snapshot' });
      if (lookup.correctionMode === 'DATE_AND_WINDOW' && lookup.proposedDeliveryWindow) {
        addChange(proposedFieldChanges, { record_type: 'ShopifyOrder.fulfillments[0]', record_id: nativeOrder.id, field: 'delivery_window_label', from: first.delivery_window_label || null, to: lookup.proposedDeliveryWindow.delivery_window_label, reason: 'align_first_fulfillment_delivery_window_label_snapshot' });
      }
    }
    if (lookup.correctionMode === 'DATE_AND_WINDOW' && lookup.proposedDeliveryWindow) {
      addChange(proposedFieldChanges, { record_type: 'ShopifyOrder', record_id: nativeOrder.id, field: 'delivery_window_label', from: nativeOrder.delivery_window_label || null, to: lookup.proposedDeliveryWindow.delivery_window_label, reason: 'align_native_order_delivery_window_label_with_supplied_one_order_exception_window' });
    }
  }

  recordsNotUpdated.push({ record_type: 'ProductionBatch', reason: 'verified_batches_keep_original_materialized_batch_ids_and_dates_in_first_correction', affected_count: batchSummary.count });
  recordsNotUpdated.push({ record_type: 'BatchComplianceLog', reason: 'locked_compliance_logs_keep_original_log_date_in_first_correction', affected_count: complianceSummary.count });
  recordsNotUpdated.push({ record_type: 'Order.status', reason: 'customer_facing_status_held', affected_count: customerOrder ? 1 : 0 });
  recordsNotUpdated.push({ record_type: 'Notification', reason: 'notifications_held', affected_count: 0 });
  recordsNotUpdated.push({ record_type: 'DeliveryRouteProofDrop', reason: 'delivery_workflow_held', affected_count: 0 });

  if (lookup.correctionMode === 'DATE_ONLY') {
    warnings.push('delivery_window_not_updated');
    classifications.push('date_only_correction_window_left_unchanged');
  }
  if (lookup.correctionMode === 'DATE_AND_WINDOW' && !lookup.proposedDeliveryWindow) blockers.push('date_and_window_mode_requires_proposed_delivery_window');

  warnings.push('notifications_held');
  warnings.push('customer_status_held');
  warnings.push('delivery_status_held');
  warnings.push('out_for_delivery_delivered_route_proof_drop_held');
  warnings.push('global_schedule_logic_unchanged');
  warnings.push('hub_fallback_required');

  if (proposedFieldChanges.some(change => change.record_type === 'ProductionBatch')) blockers.push('production_batch_date_change_not_allowed_in_preview_contract');
  if (proposedFieldChanges.some(change => change.record_type === 'BatchComplianceLog')) blockers.push('batch_compliance_log_date_change_not_allowed_in_preview_contract');

  const correctionNeeded = proposedFieldChanges.length > 0;
  const deliveryQueueImpact = taskNeedsCorrection
    ? 'target_task_currently_filters_under_recorded_delivery_date_not_proposed_delivery_date'
    : 'target_task_schedule_dates_already_match_proposed_delivery_date';
  const nextAction = blockers.length > 0
    ? 'hold_for_schedule_exception_preview_blockers'
    : correctionNeeded
      ? (lookup.correctionMode === 'DATE_ONLY' ? 'approve_exact_date_only_schedule_correction' : 'approve_exact_date_and_window_schedule_correction')
      : 'schedule_exception_correction_not_needed';

  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    function_name: FUNCTION_NAME,
    order_number: targetOrderNumber,
    request_id: lookup.requestId || null,
    generated_at: new Date().toISOString(),
    correction_needed: correctionNeeded,
    correction_mode: lookup.correctionMode,
    current_dates: currentDates,
    expected_current_recorded_dates: {
      production_date: lookup.currentRecordedProductionDate || DEFAULT_RECORDED_PRODUCTION_DATE,
      delivery_date: lookup.currentRecordedDeliveryDate || DEFAULT_RECORDED_DELIVERY_DATE,
      safety_match_supplied: Boolean(lookup.currentRecordedProductionDateProvided || lookup.currentRecordedDeliveryDateProvided),
    },
    proposed_dates: proposedDates,
    proposed_delivery_window: lookup.proposedDeliveryWindow,
    window_update_status: lookup.correctionMode === 'DATE_AND_WINDOW' ? 'would_update_window_if_later_approved' : 'not_updated_date_only',
    records_to_update: recordsToUpdate,
    proposed_field_changes: proposedFieldChanges,
    records_not_updated: recordsNotUpdated,
    classifications: unique(classifications),
    customer_facing_impact: {
      customer_app_order_status_current: sanitizeText(customerOrder?.status, 80) || null,
      customer_app_order_status_would_change: false,
      status_history_would_append: false,
      customer_visible_date_metadata_would_change_if_later_approved: customerOrderNeedsCorrection,
      customer_status_held: true,
    },
    notification_impact: false,
    notification_preview: {
      notification_would_send: false,
      notification_held: true,
      notification_rows_would_create: 0,
      message_log_rows_would_create: 0,
      channels_held: ['in_app', 'push', 'sms', 'email'],
    },
    delivery_workflow_impact: {
      delivery_queue_date_filter_alignment_needed: taskNeedsCorrection,
      current_task_delivery_date: sanitizeText(task?.delivery_date || task?.scheduled_date || task?.assigned_delivery_date, 80) || null,
      proposed_task_delivery_date: lookup.proposedActualDeliveryDate,
      impact: deliveryQueueImpact,
      delivery_status_would_change: false,
      out_for_delivery_would_mark: false,
      delivered_would_mark: false,
      proof_drop_route_would_change: false,
    },
    blockers: unique(blockers),
    warnings: unique(warnings),
    next_action: nextAction,
    hub_fallback_required: true,
    actor_context: {
      actor_type: auth?.actor_type || 'unknown',
      actor_role: auth?.actor_role || 'unknown',
    },
    safety: READ_ONLY_SAFETY,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', message: 'POST required', writes_performed: false }, { status: 405 });
    }

    const parsed = await readJsonBody(req);
    if (!parsed.ok) return Response.json({ success: false, error_code: 'malformed_json', writes_performed: false }, { status: 400 });
    const body = parsed.body || {};
    if (body.mode && body.mode !== 'dry_run') {
      return Response.json({ success: false, error_code: 'dry_run_only', message: 'Only dry_run mode is supported', writes_performed: false }, { status: 400 });
    }
    const badKey = unsupportedBodyKey(body);
    if (badKey) return Response.json({ success: false, error_code: 'unsupported_request_field', field: sanitizeText(badKey, 80), writes_performed: false }, { status: 400 });

    const lookup = getLookup(body);
    if (!hasExactLookup(lookup)) {
      return Response.json({ success: false, error_code: 'exact_order_and_target_ids_required', message: 'order_number, customer_app_order_id, native_shopify_order_id, and native_fulfillment_task_id are required.', writes_performed: false }, { status: 400 });
    }
    if (lookup.orderNumber !== TARGET_ORDER_NUMBER || lookup.customerAppOrderId !== TARGET_CUSTOMER_APP_ORDER_ID || lookup.nativeShopifyOrderId !== TARGET_NATIVE_SHOPIFY_ORDER_ID || lookup.nativeFulfillmentTaskId !== TARGET_NATIVE_FULFILLMENT_TASK_ID) {
      return Response.json({ success: false, error_code: 'unsupported_schedule_exception_target', message: 'Only the exact approved one-order schedule exception target is supported.', writes_performed: false }, { status: 409 });
    }

    const base44 = createClientFromRequest(req);
    const auth = await requirePreviewAccess({ base44, req, body });
    if (!auth.ok) return auth.response;

    const context = await loadContext(base44, lookup);
    const preview = buildPreview({ ...context, lookup, auth });
    return Response.json(preview);
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] failed safely: ${error?.message || 'unknown error'}`);
    return Response.json({ success: false, error_code: 'native_schedule_exception_correction_preview_failed', message: 'Schedule exception correction preview failed safely.', writes_performed: false }, { status: 500 });
  }
});

export { buildPreview, getLookup, parseDeliveryWindow, READ_ONLY_SAFETY, TARGET_BATCH_ID_PREFIX };
