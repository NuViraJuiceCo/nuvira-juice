import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const FUNCTION_NAME = 'previewNativeProductionVerifyCascades';
const DEFAULT_MAX_ROWS = 60;
const TARGET_PRODUCTION_DATE = '2026-06-05';
const TARGET_DELIVERY_DATE = '2026-06-06';

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
  'production_date',
  'request_id',
  '_internal_secret',
  'internal_secret',
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

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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

function getLookup(body) {
  return {
    orderNumber: normalizeText(body?.order_number || body?.shopify_order_number).replace(/^#/, ''),
    customerAppOrderId: sanitizeId(body?.customer_app_order_id || body?.base44_order_id || body?.order_id, 120),
    nativeShopifyOrderId: sanitizeId(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id, 120),
    nativeFulfillmentTaskId: sanitizeId(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id, 120),
    productionDate: normalizeText(body?.production_date),
    requestId: sanitizeId(body?.request_id, 180),
  };
}

function hasExactLookup(lookup) {
  return Boolean(lookup.orderNumber || lookup.customerAppOrderId || lookup.nativeShopifyOrderId || lookup.nativeFulfillmentTaskId);
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

async function findCustomerOrder(base44, lookup) {
  const filters = [];
  if (lookup.customerAppOrderId) filters.push({ id: lookup.customerAppOrderId });
  if (lookup.orderNumber) filters.push({ order_number: lookup.orderNumber }, { shopify_order_number: lookup.orderNumber });
  for (const filter of filters) {
    const rows = await filterEntity(base44, 'Order', filter, '-created_date', 5);
    if (rows.length > 0) return rows[0];
  }
  return null;
}

async function findNativeShopifyOrder(base44, customerOrder, lookup) {
  const orderNumber = lookup.orderNumber || normalizeText(customerOrder?.order_number || customerOrder?.shopify_order_number).replace(/^#/, '');
  const filters = [];
  if (lookup.nativeShopifyOrderId) filters.push({ id: lookup.nativeShopifyOrderId }, { shopify_order_id: lookup.nativeShopifyOrderId });
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
  if (lookup.nativeFulfillmentTaskId) filters.push({ id: lookup.nativeFulfillmentTaskId }, { fulfillment_task_id: lookup.nativeFulfillmentTaskId });
  if (nativeOrder?.id) filters.push({ native_shopify_order_id: nativeOrder.id }, { shopify_order_id: nativeOrder.id }, { order_id: nativeOrder.id });
  if (customerOrder?.id) filters.push({ base44_order_id: customerOrder.id }, { order_id: customerOrder.id });
  if (orderNumber) filters.push({ order_number: orderNumber }, { shopify_order_number: orderNumber });
  for (const filter of filters) {
    const rows = await filterEntity(base44, 'FulfillmentTask', filter, '-created_date', 20);
    if (rows.length > 0) return rows[0];
  }
  return null;
}

function batchReferencesTarget(batch, { orderNumber, customerOrder, nativeOrder, task }) {
  const sourceText = [
    batch?.batch_id,
    batch?.source_order_number,
    batch?.order_number,
    batch?.source_order_id,
    batch?.base44_order_id,
    batch?.native_shopify_order_id,
    batch?.native_fulfillment_task_id,
    JSON.stringify(batch?.order_sources || []),
    JSON.stringify(batch?.related_orders || []),
  ].map(value => normalizeText(value)).join(' ');
  return [orderNumber, customerOrder?.id, nativeOrder?.id, task?.id]
    .filter(Boolean)
    .some(value => sourceText.includes(value));
}

async function findProductionBatches(base44, { orderNumber, productionDate, customerOrder, nativeOrder, task }) {
  const all = await listEntity(base44, 'ProductionBatch', '-production_date', 800);
  return all
    .filter(batch => {
      const batchDate = normalizeText(batch?.production_date);
      if (productionDate && batchDate && batchDate !== productionDate) return false;
      return batchReferencesTarget(batch, { orderNumber, customerOrder, nativeOrder, task });
    })
    .slice(0, DEFAULT_MAX_ROWS);
}

async function complianceLogsForBatches(base44, batches) {
  const groups = await Promise.all((batches || []).map(async batch => {
    const byDisplayId = batch?.batch_id ? await filterEntity(base44, 'BatchComplianceLog', { batch_id: batch.batch_id }, '-created_date', 20) : [];
    const bySourceId = batch?.id ? await filterEntity(base44, 'BatchComplianceLog', { source_production_batch_id: batch.id }, '-created_date', 20) : [];
    return [...new Map([...byDisplayId, ...bySourceId].map(row => [row.id, row])).values()];
  }));
  return groups.flat();
}

function safeBatchRow(batch, complianceLogs) {
  const logs = complianceLogs.filter(log => log?.batch_id === batch?.batch_id || log?.source_production_batch_id === batch?.id);
  return {
    production_batch_id: sanitizeId(batch?.id, 120),
    batch_id: sanitizeText(batch?.batch_id, 180),
    product_name: sanitizeText(batch?.product_name, 120),
    production_date: sanitizeText(batch?.production_date, 40),
    status: sanitizeText(batch?.status, 80),
    planned_units: numberOrNull(batch?.planned_units),
    actual_units: numberOrNull(batch?.actual_units),
    verified_at_present: Boolean(batch?.verified_at),
    verified_by_present: Boolean(batch?.verified_by),
    compliance_log_id_present: Boolean(batch?.compliance_log_id),
    compliance_log_count: logs.length,
    is_locked: batch?.is_locked === true,
  };
}

function isTerminalTaskStatus(status) {
  return ['delivered', 'unable_to_deliver', 'cancelled', 'canceled'].includes(normalizeLower(status));
}

function isEligiblePackStatus(status) {
  return ['pending', 'scheduled', 'assigned', 'in_production', 'packed', 'bottled_packed'].includes(normalizeLower(status || 'pending'));
}

function orderType(customerOrder, nativeOrder, task) {
  if (nativeOrder?.is_subscription === true || customerOrder?.is_subscription === true || customerOrder?.subscription_id) return 'subscription';
  return normalizeLower(nativeOrder?.order_type || customerOrder?.order_type || task?.order_type || 'one_time') || 'one_time';
}

function fulfillmentMode(customerOrder, nativeOrder, task) {
  return normalizeLower(nativeOrder?.fulfillment_mode || customerOrder?.fulfillment_mode || task?.fulfillment_mode || task?.fulfillment_type || nativeOrder?.fulfillment_method || customerOrder?.fulfillment_type || 'single_delivery') || 'single_delivery';
}

function buildTaskPackPreview({ task, allVerified, complianceReady, batches }) {
  const blockers = [];
  const warnings = [];
  const currentStatus = sanitizeText(task?.status, 80) || null;
  const currentDeliveryStatus = sanitizeText(task?.delivery_status, 80) || null;
  const currentProductionStatus = sanitizeText(task?.production_status, 80) || null;
  const alreadyPacked = ['packed', 'bottled_packed'].includes(normalizeLower(task?.status));

  if (!task) blockers.push('missing_native_fulfillment_task');
  if (!allVerified) blockers.push('not_all_batches_verified_logged');
  if (!complianceReady) blockers.push('missing_batch_compliance_logs');
  if (task && isTerminalTaskStatus(task.status)) blockers.push('task_terminal_or_cancelled');
  if (task && !isEligiblePackStatus(task.status)) blockers.push('task_status_not_pack_eligible');
  if (batches.length === 0) blockers.push('missing_native_production_batches');
  if (task?.delivery_status && ['out_for_delivery', 'delivered', 'unable_to_deliver', 'cancelled', 'canceled'].includes(normalizeLower(task.delivery_status))) {
    blockers.push('delivery_lifecycle_already_advanced');
  }
  if (alreadyPacked) warnings.push('task_already_packed_or_bottled');

  const allowed = blockers.length === 0;
  const packCommandAvailable = allowed && !alreadyPacked;
  return {
    task_id: sanitizeId(task?.id, 120) || null,
    task_display_id: sanitizeId(task?.fulfillment_task_id, 180) || null,
    current_task_status: currentStatus,
    current_delivery_status: currentDeliveryStatus,
    current_production_status: currentProductionStatus,
    pack_cascade_allowed: allowed,
    task_pack_already_satisfied: allowed && alreadyPacked,
    task_already_satisfied: allowed && alreadyPacked,
    pack_action_state: allowed ? (alreadyPacked ? 'already_packed' : 'ready_to_pack') : 'held',
    would_update_task_status: packCommandAvailable && normalizeLower(currentStatus) !== 'packed',
    proposed_task_status: allowed ? 'packed' : null,
    would_update_production_status: packCommandAvailable && normalizeLower(currentProductionStatus) !== 'packed',
    proposed_production_status: allowed ? 'packed' : null,
    would_update_delivery_status: false,
    proposed_delivery_status: currentDeliveryStatus,
    blockers,
    warnings,
    pack_command_available: packCommandAvailable,
    pack_command_gated: true,
    pack_requires_exact_approval: packCommandAvailable,
    projected_writes_if_later_approved: packCommandAvailable ? ['FulfillmentTask.status', 'FulfillmentTask.production_status', 'FulfillmentTask.packed_at', 'FulfillmentTask.audit_trail', 'CommandLog'] : [],
  };
}

function buildOrderBottlePreview({ nativeOrder, customerOrder, task, allVerified, complianceReady, batches }) {
  const blockers = [];
  const warnings = [];
  const type = orderType(customerOrder, nativeOrder, task);
  const mode = fulfillmentMode(customerOrder, nativeOrder, task);
  const currentProductionStatus = sanitizeText(nativeOrder?.production_status, 80) || null;
  const currentFulfillmentStatus = sanitizeText(nativeOrder?.fulfillment_status, 80) || null;
  const currentPaymentStatus = sanitizeText(nativeOrder?.payment_status || nativeOrder?.financial_status || customerOrder?.payment_status, 80) || null;

  if (!nativeOrder) blockers.push('missing_native_shopify_order');
  if (!allVerified) blockers.push('not_all_batches_verified_logged');
  if (!complianceReady) blockers.push('missing_batch_compliance_logs');
  if (batches.length === 0) blockers.push('missing_native_production_batches');
  if (!task) blockers.push('missing_native_fulfillment_task');
  if (task && !['packed', 'bottled_packed'].includes(normalizeLower(task.status))) blockers.push('native_fulfillment_task_not_packed');
  if (task && !['packed', 'bottled_packed'].includes(normalizeLower(task.production_status))) blockers.push('native_fulfillment_task_production_status_not_packed');
  if (['subscription', 'multi_delivery'].includes(type) || mode === 'multi_delivery' || nativeOrder?.is_subscription === true) blockers.push('subscription_multi_delivery_order_bottle_blocked');
  if (['canceled', 'cancelled', 'refunded'].includes(normalizeLower(currentProductionStatus)) || ['refunded', 'voided'].includes(normalizeLower(currentPaymentStatus))) blockers.push('order_cancelled_or_refunded');
  if (['labeled', 'qc_checked', 'packed', 'in_cold_storage', 'assigned_for_pickup', 'assigned_for_delivery', 'fulfilled'].includes(normalizeLower(currentProductionStatus))) blockers.push('order_production_status_already_after_bottle');
  if (normalizeLower(currentProductionStatus) === 'bottled') warnings.push('native_shopify_order_already_bottled');

  const allowed = blockers.length === 0;
  return {
    native_shopify_order_id: sanitizeId(nativeOrder?.id, 120) || null,
    order_number: sanitizeText(nativeOrder?.shopify_order_number || customerOrder?.order_number, 120) || null,
    current_production_status: currentProductionStatus,
    current_fulfillment_status: currentFulfillmentStatus,
    order_type: type,
    fulfillment_type: sanitizeText(task?.fulfillment_type || nativeOrder?.fulfillment_method || customerOrder?.fulfillment_type, 80) || null,
    fulfillment_mode: mode,
    is_subscription: nativeOrder?.is_subscription === true || customerOrder?.is_subscription === true || type === 'subscription',
    order_bottle_cascade_allowed: allowed,
    would_update_native_shopify_order: allowed && normalizeLower(currentProductionStatus) !== 'bottled',
    bottle_command_available: allowed && normalizeLower(currentProductionStatus) !== 'bottled',
    bottle_command_gated: true,
    bottle_requires_exact_approval: allowed && normalizeLower(currentProductionStatus) !== 'bottled',
    already_bottled: allowed && normalizeLower(currentProductionStatus) === 'bottled',
    proposed_production_status: allowed ? 'bottled' : null,
    proposed_fulfillment_status: currentFulfillmentStatus,
    would_update_fulfillment_status: false,
    customer_app_order_sync_deferred: true,
    notifications_deferred: true,
    blockers,
    warnings,
    projected_writes_if_later_approved: allowed && normalizeLower(currentProductionStatus) !== 'bottled' ? ['ShopifyOrder.production_status', 'ShopifyOrder.audit_trail', 'CommandLog'] : [],
  };
}

function buildImpactPreviews() {
  return {
    customer_status_impact_preview: {
      would_touch_customer_app_order: false,
      customer_facing_status_changes_held: true,
      status_history_append_held: true,
      delivered_status_held: true,
      production_status_customer_projection_held: true,
      expected_customer_status_after_this_phase: 'unchanged',
      blockers: [],
      warnings: ['customer_facing_status_requires_separate_approval'],
    },
    notification_impact_preview: {
      would_send_notification: false,
      notification_types_held: ['production_verified', 'packed', 'bottled', 'ready_for_delivery', 'delivered'],
      non_confirmation_notifications_disabled_until_separate_approval: true,
      blockers: [],
      warnings: ['notifications_require_separate_approval'],
    },
  };
}

function buildPreview({ customerOrder, nativeOrder, task, batches, complianceLogs, commandLogs, lookup, auth }) {
  const orderNumber = sanitizeText(lookup.orderNumber || nativeOrder?.shopify_order_number || customerOrder?.order_number || task?.order_number, 120) || null;
  const productionDate = sanitizeText(lookup.productionDate || task?.production_date || batches[0]?.production_date || TARGET_PRODUCTION_DATE, 40) || null;
  const targetBatchRows = batches.map(batch => safeBatchRow(batch, complianceLogs));
  const verifiedRows = targetBatchRows.filter(row => normalizeLower(row.status) === 'verified_logged');
  const complianceReadyRows = targetBatchRows.filter(row => row.compliance_log_count > 0);
  const complianceIdWithoutLogRows = targetBatchRows.filter(row => row.compliance_log_id_present && row.compliance_log_count === 0);
  const allVerified = targetBatchRows.length > 0 && verifiedRows.length === targetBatchRows.length;
  const complianceReady = targetBatchRows.length > 0 && complianceReadyRows.length === targetBatchRows.length;

  const cascadeBlockers = [];
  const cascadeWarnings = [];
  if (!customerOrder) cascadeBlockers.push('missing_customer_app_order_context');
  if (!nativeOrder) cascadeBlockers.push('missing_native_shopify_order');
  if (!task) cascadeBlockers.push('missing_native_fulfillment_task');
  if (targetBatchRows.length === 0) cascadeBlockers.push('missing_native_production_batches');
  if (targetBatchRows.length > 0 && !allVerified) cascadeBlockers.push('not_all_batches_verified_logged');
  if (targetBatchRows.length > 0 && !complianceReady) cascadeBlockers.push('missing_batch_compliance_logs');

  if (complianceIdWithoutLogRows.length > 0) cascadeWarnings.push('compliance_log_id_present_without_log_row');
  cascadeWarnings.push('task_pack_cascade_held_until_separate_approval');
  cascadeWarnings.push('shopify_order_bottle_cascade_held_until_separate_approval');
  cascadeWarnings.push('customer_facing_status_held');
  cascadeWarnings.push('notifications_held');
  cascadeWarnings.push('hub_fallback_required');

  const taskPackPreview = buildTaskPackPreview({ task, allVerified, complianceReady, batches: targetBatchRows });
  const shopifyOrderBottlePreview = buildOrderBottlePreview({ nativeOrder, customerOrder, task, allVerified, complianceReady, batches: targetBatchRows });
  const impacts = buildImpactPreviews();

  const taskReady = taskPackPreview.pack_command_available === true;
  const taskAlreadySatisfied = taskPackPreview.task_pack_already_satisfied === true;
  const orderReady = shopifyOrderBottlePreview.order_bottle_cascade_allowed === true;
  const nextAction = taskReady && orderReady
    ? 'plan_gated_native_task_pack_and_order_bottle_commands'
    : taskReady
      ? 'plan_gated_native_fulfillment_task_pack_command'
      : taskAlreadySatisfied && orderReady
        ? 'plan_gated_native_shopify_order_bottle_command'
        : orderReady
          ? 'plan_gated_native_shopify_order_bottle_command'
          : 'hold_post_verify_cascades';

  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    function_name: FUNCTION_NAME,
    order_number: orderNumber,
    request_id: sanitizeId(lookup.requestId, 180) || null,
    generated_at: new Date().toISOString(),
    production_date: productionDate,
    delivery_date: sanitizeText(task?.delivery_date || task?.assigned_delivery_date || nativeOrder?.requested_delivery_date || customerOrder?.delivery_date || TARGET_DELIVERY_DATE, 40) || null,
    customer_app_order_present: Boolean(customerOrder),
    native_shopify_order_present: Boolean(nativeOrder),
    native_fulfillment_task_present: Boolean(task),
    customer_app_order_id: sanitizeId(customerOrder?.id, 120) || null,
    native_shopify_order_id: sanitizeId(nativeOrder?.id, 120) || null,
    native_fulfillment_task_id: sanitizeId(task?.id, 120) || null,
    verified_batch_count: verifiedRows.length,
    production_batch_count: targetBatchRows.length,
    compliance_log_count: complianceLogs.length,
    target_batch_rows: targetBatchRows,
    prior_command_context: {
      command_log_count: commandLogs.length,
      verify_command_log_present: commandLogs.some(log => normalizeLower(log?.command_type) === 'native_production_batch_verify' && normalizeLower(log?.status) === 'success'),
      latest_command_types: [...new Set(commandLogs.map(log => sanitizeText(log?.command_type, 120)).filter(Boolean))].slice(0, 10),
    },
    task_pack_preview: taskPackPreview,
    shopify_order_bottle_preview: shopifyOrderBottlePreview,
    customer_status_impact_preview: impacts.customer_status_impact_preview,
    notification_impact_preview: impacts.notification_impact_preview,
    cascade_blockers: [...new Set(cascadeBlockers)].slice(0, DEFAULT_MAX_ROWS),
    cascade_warnings: [...new Set([...cascadeWarnings, ...taskPackPreview.warnings, ...shopifyOrderBottlePreview.warnings])].slice(0, DEFAULT_MAX_ROWS),
    task_pack_ready: taskReady,
    task_pack_already_satisfied: taskAlreadySatisfied,
    shopify_order_bottle_ready: orderReady,
    customer_facing_status_held: true,
    notifications_held: true,
    inventory_deduction_held: true,
    purchase_order_automation_held: true,
    hub_fallback_required: true,
    next_action: nextAction,
    actor_context: {
      actor_type: auth?.actor_type || 'unknown',
      actor_role: auth?.actor_role || 'unknown',
    },
    safety: {
      dry_run_only: true,
      writes_performed: false,
      fulfillment_task_updated: false,
      native_shopify_order_updated: false,
      customer_app_order_updated: false,
      production_batch_updated: false,
      compliance_logs_created: false,
      inventory_deducted: false,
      purchase_orders_created: false,
      provider_calls_performed: false,
      stripe_calls_performed: false,
      shopify_api_calls_performed: false,
      notifications_sent: false,
      sync_repair_replay_performed: false,
      delivery_route_proof_drop_mutated: false,
      hub_bridge_modified: false,
    },
  };
}

async function loadCommandLogs(base44, orderNumber) {
  const byOrder = orderNumber ? await filterEntity(base44, 'CommandLog', { related_order_number: orderNumber }, '-created_date', 40) : [];
  const byTarget = orderNumber ? await filterEntity(base44, 'CommandLog', { target_display_id: orderNumber }, '-created_date', 40) : [];
  return [...new Map([...byOrder, ...byTarget].map(row => [row.id, row])).values()].slice(0, 40);
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
      return Response.json({ success: false, error_code: 'exact_order_required', message: 'order_number or exact target id is required', writes_performed: false }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const auth = await requirePreviewAccess({ base44, req, body });
    if (!auth.ok) return auth.response;

    let customerOrder = await findCustomerOrder(base44, lookup);
    let nativeOrder = await findNativeShopifyOrder(base44, customerOrder, lookup);
    if (!customerOrder && nativeOrder?.base44_order_id) {
      customerOrder = await findCustomerOrder(base44, { ...lookup, customerAppOrderId: nativeOrder.base44_order_id, orderNumber: normalizeText(nativeOrder.shopify_order_number).replace(/^#/, '') });
    }
    if (!nativeOrder && customerOrder) nativeOrder = await findNativeShopifyOrder(base44, customerOrder, lookup);
    const task = await findNativeFulfillmentTask(base44, customerOrder, nativeOrder, lookup);
    const orderNumber = lookup.orderNumber || normalizeText(nativeOrder?.shopify_order_number || customerOrder?.order_number || task?.order_number).replace(/^#/, '');
    const productionDate = lookup.productionDate || normalizeText(task?.production_date || TARGET_PRODUCTION_DATE);
    const batches = await findProductionBatches(base44, { orderNumber, productionDate, customerOrder, nativeOrder, task });
    const complianceLogs = await complianceLogsForBatches(base44, batches);
    const commandLogs = await loadCommandLogs(base44, orderNumber);

    return Response.json(buildPreview({ customerOrder, nativeOrder, task, batches, complianceLogs, commandLogs, lookup: { ...lookup, orderNumber, productionDate }, auth }));
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] failed safely: ${error?.message || 'unknown error'}`);
    return Response.json({ success: false, error_code: 'native_production_verify_cascade_preview_failed', message: 'Native post-verify cascade preview failed safely.', writes_performed: false }, { status: 500 });
  }
});
