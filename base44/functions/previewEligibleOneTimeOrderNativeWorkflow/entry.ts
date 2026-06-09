import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const FUNCTION_NAME = 'previewEligibleOneTimeOrderNativeWorkflow';
const DEFAULT_RECENT_LIMIT = 10;
const MAX_RECENT_LIMIT = 25;
const MAX_TEXT = 180;

const ALLOWED_BODY_KEYS = new Set([
  'mode',
  'order_number',
  'shopify_order_number',
  'customer_app_order_id',
  'base44_order_id',
  'order_id',
  'max_recent_candidates',
  'include_hub_context',
  'request_id',
  '_internal_secret',
  'internal_secret',
]);

const READ_ONLY_SAFETY = Object.freeze({
  dry_run_only: true,
  writes_performed: false,
  gates_opened: false,
  live_commands_run: false,
  customer_app_order_created: false,
  customer_app_order_updated: false,
  native_shopify_order_created: false,
  native_shopify_order_updated: false,
  native_fulfillment_task_created: false,
  native_fulfillment_task_updated: false,
  production_batch_created: false,
  production_batch_updated: false,
  batch_compliance_log_created: false,
  batch_compliance_log_updated: false,
  notifications_created: false,
  notifications_sent: false,
  message_logs_created: false,
  provider_calls_performed: false,
  stripe_calls_performed: false,
  shopify_api_calls_performed: false,
  sync_repair_replay_performed: false,
  inventory_deducted: false,
  purchase_order_created: false,
  hub_records_updated: false,
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

function normalizeUpper(value) {
  return normalizeSingleLine(value).toUpperCase();
}

function normalizeOrderNumber(value) {
  return normalizeSingleLine(value).replace(/^#/, '');
}

function normalizeOrderKey(value) {
  return normalizeOrderNumber(value).toLowerCase();
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

function uniqueStrings(values, limit = 40) {
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
    if (!ALLOWED_BODY_KEYS.has(normalizeLower(key))) return key;
  }
  return null;
}

function getPreviewSecret() {
  return normalizeText(Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET')) ||
    normalizeText(Deno.env.get('CUSTOMER_APP_SYNC_SECRET')) ||
    normalizeText(Deno.env.get('HUB_SYNC_SECRET'));
}

function suppliedInternalSecret(req, body) {
  return normalizeText(req.headers.get('x-native-preview-secret')) ||
    normalizeText(req.headers.get('x-internal-secret')) ||
    normalizeText(body?._internal_secret || body?.internal_secret);
}

async function requirePreviewAccess({ base44, req, body }) {
  const expected = getPreviewSecret();
  const supplied = suppliedInternalSecret(req, body);
  if (expected && supplied && supplied === expected) {
    return { ok: true, actor_type: 'internal_service', actor_role: 'service', actor_email_present: false };
  }
  try {
    const user = await base44.auth.me();
    if (!user) return { ok: false, response: jsonResponse({ success: false, error_code: 'unauthorized', writes_performed: false }, 401) };
    if (user.role !== 'admin') return { ok: false, response: jsonResponse({ success: false, error_code: 'forbidden', writes_performed: false }, 403) };
    return { ok: true, actor_type: 'admin', actor_role: user.role, actor_email_present: Boolean(user.email) };
  } catch {
    return { ok: false, response: jsonResponse({ success: false, error_code: 'unauthorized', writes_performed: false }, 401) };
  }
}

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = normalizeLower(value);
  if (['true', '1', 'yes', 'y'].includes(text)) return true;
  if (['false', '0', 'no', 'n'].includes(text)) return false;
  return fallback;
}

function getLookup(body) {
  const orderNumber = normalizeOrderNumber(body?.order_number || body?.shopify_order_number);
  const maxRecentRaw = Number(body?.max_recent_candidates || DEFAULT_RECENT_LIMIT);
  const maxRecent = Number.isFinite(maxRecentRaw)
    ? Math.max(1, Math.min(MAX_RECENT_LIMIT, Math.floor(maxRecentRaw)))
    : DEFAULT_RECENT_LIMIT;
  const requestedMode = normalizeUpper(body?.mode);
  const mode = requestedMode || (orderNumber || body?.customer_app_order_id || body?.base44_order_id || body?.order_id ? 'EXACT_ORDER_PREVIEW' : 'RECENT_CANDIDATE_SCAN');
  return {
    mode,
    orderNumber,
    customerAppOrderId: safeId(body?.customer_app_order_id || body?.base44_order_id || body?.order_id, 140),
    maxRecentCandidates: maxRecent,
    includeHubContext: parseBoolean(body?.include_hub_context, true),
    requestId: safeId(body?.request_id, 180),
  };
}

async function listEntity(base44, entityName, sort = '-created_date', limit = 100) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity?.list) return [];
  const rows = await entity.list(sort, limit).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function filterEntity(base44, entityName, filter, sort = '-created_date', limit = 20) {
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

function uniqueById(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const key = row?.id || JSON.stringify(row).slice(0, 160);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function entityMatchesOrder(row, orderNumber, customerAppOrderId) {
  const key = normalizeOrderKey(orderNumber);
  if (customerAppOrderId && [row?.base44_order_id, row?.order_id, row?.customer_app_order_id].some(value => normalizeText(value) === customerAppOrderId)) return true;
  if (!key) return false;
  return [
    row?.order_number,
    row?.shopify_order_number,
    row?.source_order_number,
    row?.customer_order_number,
    row?.hub_order_number,
  ].some(value => normalizeOrderKey(value) === key);
}

async function findCustomerOrders(base44, lookup) {
  const rows = [];
  if (lookup.customerAppOrderId) {
    const byId = await getEntity(base44, 'Order', lookup.customerAppOrderId);
    if (byId?.id) rows.push(byId);
  }
  if (lookup.orderNumber) {
    rows.push(...await filterEntity(base44, 'Order', { order_number: lookup.orderNumber }, '-created_date', 10));
    rows.push(...await filterEntity(base44, 'Order', { order_number: `#${lookup.orderNumber}` }, '-created_date', 10));
  }
  return uniqueById(rows);
}

async function findNativeShopifyOrders(base44, orderNumber, customerAppOrderId) {
  const rows = [];
  if (customerAppOrderId) rows.push(...await filterEntity(base44, 'ShopifyOrder', { base44_order_id: customerAppOrderId }, '-created_date', 10));
  if (orderNumber) {
    rows.push(...await filterEntity(base44, 'ShopifyOrder', { shopify_order_number: orderNumber }, '-created_date', 10));
    rows.push(...await filterEntity(base44, 'ShopifyOrder', { shopify_order_number: `#${orderNumber}` }, '-created_date', 10));
  }
  return uniqueById(rows).filter(row => entityMatchesOrder(row, orderNumber, customerAppOrderId));
}

async function findNativeFulfillmentTasks(base44, orderNumber, customerAppOrderId, nativeOrderId) {
  const rows = [];
  if (customerAppOrderId) {
    rows.push(...await filterEntity(base44, 'FulfillmentTask', { base44_order_id: customerAppOrderId }, '-created_date', 20));
    rows.push(...await filterEntity(base44, 'FulfillmentTask', { order_id: customerAppOrderId }, '-created_date', 20));
  }
  if (nativeOrderId) {
    rows.push(...await filterEntity(base44, 'FulfillmentTask', { native_shopify_order_id: nativeOrderId }, '-created_date', 20));
    rows.push(...await filterEntity(base44, 'FulfillmentTask', { shopify_order_id: nativeOrderId }, '-created_date', 20));
  }
  if (orderNumber) {
    rows.push(...await filterEntity(base44, 'FulfillmentTask', { order_number: orderNumber }, '-created_date', 20));
    rows.push(...await filterEntity(base44, 'FulfillmentTask', { shopify_order_number: orderNumber }, '-created_date', 20));
    rows.push(...await filterEntity(base44, 'FulfillmentTask', { shopify_order_number: `#${orderNumber}` }, '-created_date', 20));
  }
  return uniqueById(rows).filter(row => entityMatchesOrder(row, orderNumber, customerAppOrderId) || (nativeOrderId && [row?.native_shopify_order_id, row?.shopify_order_id].includes(nativeOrderId)));
}

async function findRelatedLogs(base44, entityName, orderNumber, customerAppOrderId, limit = 20) {
  const rows = [];
  if (customerAppOrderId) {
    rows.push(...await filterEntity(base44, entityName, { base44_order_id: customerAppOrderId }, '-created_date', limit));
    rows.push(...await filterEntity(base44, entityName, { order_id: customerAppOrderId }, '-created_date', limit));
    rows.push(...await filterEntity(base44, entityName, { customer_app_order_id: customerAppOrderId }, '-created_date', limit));
  }
  if (orderNumber) {
    rows.push(...await filterEntity(base44, entityName, { order_number: orderNumber }, '-created_date', limit));
    rows.push(...await filterEntity(base44, entityName, { shopify_order_number: orderNumber }, '-created_date', limit));
    rows.push(...await filterEntity(base44, entityName, { source_order_number: orderNumber }, '-created_date', limit));
  }
  return uniqueById(rows).filter(row => entityMatchesOrder(row, orderNumber, customerAppOrderId));
}

async function findProductionBatches(base44, orderNumber, customerAppOrderId, nativeOrderId, taskId) {
  const all = await listEntity(base44, 'ProductionBatch', '-production_date', 800);
  return all.filter(batch => {
    if (customerAppOrderId && [batch?.base44_order_id, batch?.order_id, batch?.source_order_id].includes(customerAppOrderId)) return true;
    if (nativeOrderId && [batch?.native_shopify_order_id, batch?.shopify_order_id].includes(nativeOrderId)) return true;
    if (taskId && [batch?.native_fulfillment_task_id, batch?.fulfillment_task_id].includes(taskId)) return true;
    return entityMatchesOrder(batch, orderNumber, customerAppOrderId);
  });
}

async function complianceLogsForBatches(base44, batches) {
  const rows = [];
  for (const batch of batches || []) {
    if (batch?.batch_id) rows.push(...await filterEntity(base44, 'BatchComplianceLog', { batch_id: batch.batch_id }, '-created_date', 10));
    if (batch?.id) rows.push(...await filterEntity(base44, 'BatchComplianceLog', { source_production_batch_id: batch.id }, '-created_date', 10));
  }
  return uniqueById(rows);
}

function summarizeLogRows(rows) {
  const statuses = uniqueStrings((rows || []).map(row => row?.status || row?.sync_status || row?.review_status || row?.result_status || row?.error_code || row?.action), 8);
  return {
    count: Array.isArray(rows) ? rows.length : 0,
    statuses,
    latest_status: statuses[0] || null,
  };
}

function isPaid(order, nativeOrder) {
  return order?.payment_captured === true ||
    normalizeLower(order?.payment_status) === 'paid' ||
    normalizeLower(order?.financial_status) === 'paid' ||
    normalizeLower(nativeOrder?.payment_status) === 'paid' ||
    normalizeLower(nativeOrder?.financial_status) === 'paid';
}

function isCancelledOrRefunded(order, nativeOrder) {
  const values = [
    order?.status,
    order?.payment_status,
    order?.financial_status,
    nativeOrder?.fulfillment_status,
    nativeOrder?.production_status,
    nativeOrder?.financial_status,
    nativeOrder?.payment_status,
  ].map(normalizeLower);
  return Boolean(order?.canceled_at || order?.deleted_at || order?.do_not_recover) ||
    values.some(value => ['cancelled', 'canceled', 'refunded', 'partially_refunded', 'voided'].includes(value));
}

function lineItemCount(order, nativeOrder, task) {
  if (Array.isArray(order?.items)) return order.items.length;
  if (Array.isArray(nativeOrder?.line_items)) return nativeOrder.line_items.length;
  if (Array.isArray(task?.items)) return task.items.length;
  return Number(nativeOrder?.line_item_count || task?.line_item_count || 0) || 0;
}

function totalQuantity(order, nativeOrder, task) {
  const items = Array.isArray(order?.items) ? order.items : Array.isArray(nativeOrder?.line_items) ? nativeOrder.line_items : Array.isArray(task?.items) ? task.items : [];
  return items.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0);
}

function fulfillmentTypeFor(order, nativeOrder, task) {
  return normalizeLower(order?.fulfillment_type || nativeOrder?.fulfillment_method || task?.fulfillment_type || task?.source_type || '');
}

function orderTypeFor(order, nativeOrder, task) {
  const nativeType = normalizeLower(nativeOrder?.order_type || nativeOrder?.source_type || task?.order_type || task?.source_type);
  if (nativeType) return nativeType;
  if (normalizeLower(nativeOrder?.source_channel) === 'subscription' || nativeOrder?.is_subscription) return 'subscription';
  return 'one_time';
}

function subscriptionOrMultiDelivery(order, nativeOrder, task) {
  const type = orderTypeFor(order, nativeOrder, task);
  return type === 'subscription' ||
    normalizeLower(nativeOrder?.fulfillment_mode) === 'multi_delivery' ||
    normalizeLower(task?.fulfillment_type) === 'subscription_delivery' ||
    Boolean(nativeOrder?.is_subscription || nativeOrder?.stripe_subscription_id || task?.stripe_subscription_id || task?.customer_app_subscription_id);
}

function alreadyNativeComplete(order, nativeOrder, task) {
  const customerStatus = normalizeLower(order?.status);
  const nativeFulfillmentStatus = normalizeLower(nativeOrder?.fulfillment_status || nativeOrder?.shopify_fulfillment_status);
  const taskStatus = normalizeLower(task?.status);
  const taskDeliveryStatus = normalizeLower(task?.delivery_status);
  return ['delivered', 'fulfilled', 'completed'].includes(customerStatus) ||
    (
      ['fulfilled', 'delivered', 'completed'].includes(nativeFulfillmentStatus) &&
      ['delivered', 'completed'].includes(taskStatus) &&
      ['delivered', 'completed'].includes(taskDeliveryStatus)
    );
}

function reviewQueueHasOpenBlocker(rows) {
  return (rows || []).some(row => {
    const status = normalizeLower(row?.status || row?.review_status || row?.resolution_status);
    if (!status) return true;
    return !['resolved', 'closed', 'ignored', 'safe', 'deduped', 'not_applicable', 'test_only'].includes(status);
  });
}

function duplicateRiskFor({ customerOrders, nativeOrders, tasks }) {
  const risks = [];
  if ((customerOrders || []).length > 1) risks.push('multiple_customer_app_orders_match');
  if ((nativeOrders || []).length > 1) risks.push('multiple_native_shopify_orders_match');
  if ((tasks || []).length > 1) risks.push('multiple_native_fulfillment_tasks_match');
  return risks;
}

function classifyRow({ customerOrder, nativeOrder, task, customerOrders, nativeOrders, tasks, reviewRows }) {
  const blockers = [];
  const warnings = [];
  const paid = isPaid(customerOrder, nativeOrder);
  const cancelledOrRefunded = isCancelledOrRefunded(customerOrder, nativeOrder);
  const fulfillType = fulfillmentTypeFor(customerOrder, nativeOrder, task);
  const lineItems = lineItemCount(customerOrder, nativeOrder, task);
  const duplicateRisks = duplicateRiskFor({ customerOrders, nativeOrders, tasks });
  const reviewBlocker = reviewQueueHasOpenBlocker(reviewRows);
  const nativeAlreadyComplete = alreadyNativeComplete(customerOrder, nativeOrder, task);

  if (!customerOrder?.id) blockers.push('customer_app_order_missing');
  if (!paid) blockers.push('payment_not_paid_or_captured');
  if (cancelledOrRefunded) blockers.push('cancelled_or_refunded');
  if (subscriptionOrMultiDelivery(customerOrder, nativeOrder, task)) blockers.push('subscription_or_multi_delivery_not_supported');
  if (!lineItems) blockers.push('missing_line_items');
  if (!['delivery', 'pickup'].includes(fulfillType)) blockers.push('ambiguous_delivery_or_pickup_classification');
  if (reviewBlocker) blockers.push('order_review_queue_blocker');
  blockers.push(...duplicateRisks);

  if (!nativeOrder?.id) warnings.push('native_shopify_order_missing_mirror_preview_required');
  if (!task?.id) warnings.push('native_fulfillment_task_missing_task_preview_required');

  let classification = 'eligible_next_one_time_order_candidate';
  if (!customerOrder?.id) classification = 'insufficient_data';
  else if (!paid) classification = 'pending_payment_do_not_process';
  else if (cancelledOrRefunded) classification = 'cancelled_or_refunded';
  else if (subscriptionOrMultiDelivery(customerOrder, nativeOrder, task)) classification = 'unsupported_subscription_or_multi_delivery';
  else if (duplicateRisks.length) classification = 'duplicate_or_deduped';
  else if (reviewBlocker) classification = 'needs_review';
  else if (nativeAlreadyComplete) classification = 'no_action_needed_already_native_complete';
  else if (!lineItems || !['delivery', 'pickup'].includes(fulfillType)) classification = 'insufficient_data';
  else if (!nativeOrder?.id) classification = 'paid_but_native_mirror_missing';
  else if (!task?.id) classification = 'paid_but_task_missing';

  const eligible = classification === 'eligible_next_one_time_order_candidate';

  return {
    eligible,
    classification,
    blockers,
    warnings,
  };
}

function downstreamState({ nativeOrder, task, batches, complianceLogs }) {
  const batchCount = batches.length;
  const verifiedBatchCount = batches.filter(batch => normalizeLower(batch?.status || batch?.lifecycle_status || batch?.production_status) === 'verified_logged').length;
  const taskStatus = normalizeLower(task?.status);
  const taskDeliveryStatus = normalizeLower(task?.delivery_status);
  const nativeProductionStatus = normalizeLower(nativeOrder?.production_status);
  const nativeFulfillmentStatus = normalizeLower(nativeOrder?.fulfillment_status);
  return {
    production: {
      master_data_ready: null,
      production_inventory_ready: null,
      production_demand_preview_ready: null,
      production_batch_materialized: batchCount > 0,
      production_batch_count: batchCount,
      verified_batch_count: verifiedBatchCount,
      compliance_log_count: complianceLogs.length,
      production_lifecycle_state: batchCount === 0
        ? 'not_applicable_until_production_batches_exist'
        : verifiedBatchCount === batchCount
          ? 'verified_logged'
          : 'production_batches_present_not_fully_verified',
      production_blockers: batchCount > 0 && verifiedBatchCount < batchCount ? ['production_batches_not_fully_verified'] : [],
      production_warnings: batchCount === 0 ? ['not_applicable_until_production_batches_exist'] : [],
    },
    post: {
      task_pack_state: !task?.id
        ? 'not_applicable_until_task_exists'
        : ['packed', 'bottled_packed', 'delivered'].includes(taskStatus)
          ? taskStatus
          : 'task_not_packed',
      native_order_bottle_state: !nativeOrder?.id
        ? 'not_applicable_until_native_order_exists'
        : ['bottled', 'fulfilled'].includes(nativeProductionStatus)
          ? nativeProductionStatus
          : 'order_not_bottled',
      customer_status_state: 'not_applicable_until_downstream_preview',
      delivery_state: !task?.id
        ? 'not_applicable_until_task_exists'
        : taskDeliveryStatus || taskStatus || 'pending',
      notification_policy_state: 'held_no_notification',
      native_order_fulfillment_state: nativeFulfillmentStatus || 'unknown',
    },
  };
}

function nextActionFor(classification, eligible) {
  if (eligible) return 'run_g33d_second_exact_controlled_pilot_approval_packet';
  if (classification === 'paid_but_native_mirror_missing') return 'run_native_mirror_parity_preview_only';
  if (classification === 'paid_but_task_missing') return 'run_native_task_materialization_preview_only';
  if (classification === 'pending_payment_do_not_process') return 'wait_for_payment_capture';
  if (classification === 'needs_review') return 'resolve_order_review_queue_before_pilot';
  if (classification === 'insufficient_data') return 'collect_exact_order_identity_and_rerun_preview';
  if (classification === 'duplicate_or_deduped') return 'resolve_duplicate_risk_before_pilot';
  if (classification === 'unsupported_subscription_or_multi_delivery') return 'hold_for_subscription_or_multi_delivery_workflow';
  if (classification === 'cancelled_or_refunded') return 'no_action_cancelled_or_refunded';
  if (classification === 'no_action_needed_already_native_complete') return 'no_action_already_native_complete';
  return 'wait_for_next_natural_paid_one_time_order';
}

function recommendedPilotType(eligible, classification) {
  if (eligible) return 'second_exact_controlled_one_time_order_pilot';
  if (classification === 'paid_but_native_mirror_missing') return 'mirror_preview_before_pilot';
  if (classification === 'paid_but_task_missing') return 'task_preview_before_pilot';
  return 'not_recommended';
}

function safeDate(value) {
  return safeText(value, 40) || null;
}

async function buildCandidateRow(base44, seed) {
  const seedOrderNumber = normalizeOrderNumber(seed?.order_number || seed?.shopify_order_number || seed?.orderNumber);
  const seedCustomerOrderId = safeId(seed?.customer_app_order_id || seed?.base44_order_id || seed?.order_id || seed?.id, 140);
  const lookup = { orderNumber: seedOrderNumber, customerAppOrderId: seedCustomerOrderId };
  const customerOrders = seed?.__entity === 'Order' && seed?.id ? uniqueById([seed, ...await findCustomerOrders(base44, lookup)]) : await findCustomerOrders(base44, lookup);
  const customerOrder = customerOrders[0] || null;
  const orderNumber = normalizeOrderNumber(customerOrder?.order_number || seedOrderNumber);
  const customerAppOrderId = safeId(customerOrder?.id || seedCustomerOrderId, 140);
  const nativeOrders = await findNativeShopifyOrders(base44, orderNumber, customerAppOrderId);
  const nativeOrder = nativeOrders[0] || null;
  const tasks = await findNativeFulfillmentTasks(base44, orderNumber, customerAppOrderId, nativeOrder?.id);
  const task = tasks[0] || null;
  const [orderSyncRows, reviewRows, commandRows, parityRows] = await Promise.all([
    findRelatedLogs(base44, 'OrderSyncLog', orderNumber, customerAppOrderId, 20),
    findRelatedLogs(base44, 'OrderReviewQueue', orderNumber, customerAppOrderId, 20),
    findRelatedLogs(base44, 'CommandLog', orderNumber, customerAppOrderId, 20),
    findRelatedLogs(base44, 'SafeSyncParityLog', orderNumber, customerAppOrderId, 20),
  ]);
  const batches = await findProductionBatches(base44, orderNumber, customerAppOrderId, nativeOrder?.id, task?.id);
  const complianceLogs = await complianceLogsForBatches(base44, batches);
  const classification = classifyRow({ customerOrder, nativeOrder, task, customerOrders, nativeOrders, tasks, reviewRows });
  const downstream = downstreamState({ nativeOrder, task, batches, complianceLogs });
  const duplicateRisks = duplicateRiskFor({ customerOrders, nativeOrders, tasks });
  const fulfillmentType = fulfillmentTypeFor(customerOrder, nativeOrder, task);
  const orderType = orderTypeFor(customerOrder, nativeOrder, task);
  const nativeAlreadyComplete = alreadyNativeComplete(customerOrder, nativeOrder, task);

  return {
    order_number: orderNumber || seedOrderNumber || null,
    customer_app_order_id: customerAppOrderId || null,
    native_shopify_order_id: safeId(nativeOrder?.id, 140) || null,
    native_fulfillment_task_id: safeId(task?.id, 140) || null,
    hub_order_id: null,
    hub_task_id: null,
    hub_order_present: null,
    hub_task_present: null,
    hub_context_status: 'not_available_without_safe_hub_preview_helper',
    customer_app_order_present: Boolean(customerOrder?.id),
    payment_status: safeText(customerOrder?.payment_status || customerOrder?.financial_status || nativeOrder?.payment_status || nativeOrder?.financial_status, 80) || null,
    payment_captured: customerOrder?.payment_captured === true,
    is_paid: isPaid(customerOrder, nativeOrder),
    order_status: safeText(customerOrder?.status || nativeOrder?.order_status, 80) || null,
    order_type: orderType || null,
    source_type: safeText(nativeOrder?.source_type || task?.source_type || customerOrder?.source_type, 80) || null,
    fulfillment_type: fulfillmentType || null,
    delivery_or_pickup_date: safeDate(customerOrder?.assigned_delivery_date || customerOrder?.estimated_delivery_date || customerOrder?.preorder_fulfillment_date || nativeOrder?.assigned_delivery_date || nativeOrder?.selected_delivery_date || task?.delivery_date || task?.scheduled_date),
    line_item_count: lineItemCount(customerOrder, nativeOrder, task),
    total_quantity: totalQuantity(customerOrder, nativeOrder, task),
    cancelled_or_refunded: isCancelledOrRefunded(customerOrder, nativeOrder),
    subscription_or_multi_delivery: subscriptionOrMultiDelivery(customerOrder, nativeOrder, task),
    already_native_complete: nativeAlreadyComplete,
    review_queue_present: (reviewRows || []).length > 0,
    review_queue_status: summarizeLogRows(reviewRows),
    duplicate_risk: duplicateRisks.length > 0,
    duplicate_risk_reasons: duplicateRisks,
    native_shopify_order_present: Boolean(nativeOrder?.id),
    native_fulfillment_task_present: Boolean(task?.id),
    hub_bridge_present: (orderSyncRows || []).length > 0 || Boolean(nativeOrder?.sync_status),
    hub_bridge_status: safeText(nativeOrder?.sync_status || summarizeLogRows(orderSyncRows).latest_status, 140) || null,
    order_sync_log_status: summarizeLogRows(orderSyncRows),
    safe_sync_parity_log_status: summarizeLogRows(parityRows),
    command_log_status: summarizeLogRows(commandRows),
    safeSync_native_mirror_status: nativeOrder?.id ? 'native_mirror_present' : 'native_mirror_missing_preview_required',
    ...downstream.production,
    task_pack_state: downstream.post.task_pack_state,
    native_order_bottle_state: downstream.post.native_order_bottle_state,
    customer_status_state: downstream.post.customer_status_state,
    delivery_state: downstream.post.delivery_state,
    notification_policy_state: downstream.post.notification_policy_state,
    native_order_fulfillment_state: downstream.post.native_order_fulfillment_state,
    eligible_for_second_controlled_pilot: classification.eligible,
    recommended_pilot_type: recommendedPilotType(classification.eligible, classification.classification),
    exact_gates_required: true,
    eligibility_classification: classification.classification,
    blockers: classification.blockers,
    warnings: uniqueStrings([...classification.warnings, ...downstream.production.production_warnings], 20),
    next_action: nextActionFor(classification.classification, classification.eligible),
  };
}

async function recentCustomerOrderSeeds(base44, limit) {
  const rows = await listEntity(base44, 'Order', '-created_date', Math.max(limit * 4, 25));
  return rows
    .filter(row => row?.order_number)
    .slice(0, limit)
    .map(row => ({ ...row, __entity: 'Order' }));
}

async function buildPreview({ base44, lookup }) {
  const warnings = [];
  const blockers = [];
  let seeds = [];
  if (lookup.mode === 'EXACT_ORDER_PREVIEW') {
    if (!lookup.orderNumber && !lookup.customerAppOrderId) {
      blockers.push('order_number_or_customer_app_order_id_required');
    } else {
      seeds = [{ order_number: lookup.orderNumber, customer_app_order_id: lookup.customerAppOrderId }];
    }
  } else if (lookup.mode === 'RECENT_CANDIDATE_SCAN') {
    seeds = await recentCustomerOrderSeeds(base44, lookup.maxRecentCandidates);
    if (!seeds.length) warnings.push('no_recent_customer_app_orders_returned');
  } else {
    blockers.push('unsupported_mode');
  }

  const candidateRows = [];
  for (const seed of seeds) {
    candidateRows.push(await buildCandidateRow(base44, seed));
  }
  const selectedOrderNumber = lookup.mode === 'EXACT_ORDER_PREVIEW' ? (candidateRows[0]?.order_number || lookup.orderNumber || null) : null;
  const eligibleRows = candidateRows.filter(row => row.eligible_for_second_controlled_pilot);
  const topLevelNextAction = blockers.length
    ? 'fix_preview_request_and_rerun'
    : eligibleRows.length
      ? 'plan_g33d_second_exact_controlled_pilot_for_clean_candidate'
      : lookup.mode === 'EXACT_ORDER_PREVIEW'
        ? (candidateRows[0]?.next_action || 'wait_for_next_natural_paid_one_time_order')
        : 'wait_for_next_natural_paid_one_time_order_or_run_exact_order_preview';

  return {
    success: blockers.length === 0,
    dry_run: true,
    writes_performed: false,
    generated_at: new Date().toISOString(),
    function_name: FUNCTION_NAME,
    mode: lookup.mode,
    include_hub_context: lookup.includeHubContext,
    scanned_count: candidateRows.length,
    selected_order_number: selectedOrderNumber,
    eligible_candidate_count: eligibleRows.length,
    eligible_candidate_found: eligibleRows.length > 0,
    candidate_rows: candidateRows,
    blockers,
    warnings,
    next_action: topLevelNextAction,
    safety: READ_ONLY_SAFETY,
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error_code: 'method_not_allowed', writes_performed: false }, 405);
  }

  const parsed = await readJsonBody(req);
  if (!parsed.ok) {
    return jsonResponse({ success: false, error_code: 'invalid_json_body', writes_performed: false }, 400);
  }

  const body = parsed.body || {};
  const unsupported = unsupportedBodyKey(body);
  if (unsupported) {
    return jsonResponse({ success: false, error_code: 'unsupported_body_key', unsupported_key: safeText(unsupported, 80), writes_performed: false }, 400);
  }

  const base44 = createClientFromRequest(req);
  const access = await requirePreviewAccess({ base44, req, body });
  if (!access.ok) return access.response;

  const lookup = getLookup(body);
  const result = await buildPreview({ base44, lookup });
  return jsonResponse({
    ...result,
    actor_type: access.actor_type,
    actor_role: access.actor_role,
    actor_email_present: access.actor_email_present,
  });
});
