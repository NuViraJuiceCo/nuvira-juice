const READ_MODEL_VERSION = 'g48e_admin_order_lifecycle_v1';

function text(value) {
  return (value ?? '').toString().trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function normalizeOrderNumber(value) {
  return text(value).replace(/^#/, '').trim().toUpperCase();
}

function normalizeKey(value) {
  return normalizeOrderNumber(value).toLowerCase();
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function addCount(target, key) {
  if (!key) return;
  target[key] = (target[key] || 0) + 1;
}

function dateOnly(value) {
  const raw = text(value);
  if (!raw) return null;
  return raw.slice(0, 10);
}

function valuesDiffer(left, right) {
  const a = lower(left);
  const b = lower(right);
  if (!a || !b) return false;
  return a !== b;
}

function paymentIsPaid(row) {
  return ['paid', 'captured'].includes(lower(row?.payment_status)) ||
    ['paid', 'captured'].includes(lower(row?.financial_status)) ||
    row?.payment_captured === true ||
    row?.customer_app_payment_captured === true ||
    lower(row?.native_payment_status) === 'paid';
}

function paymentCaptured(row) {
  return row?.payment_captured === true || row?.customer_app_payment_captured === true || row?.native_payment_captured === true;
}

function isRefunded(row) {
  return ['refunded', 'partially_refunded'].some(status => [
    row?.payment_status,
    row?.financial_status,
    row?.refund_status,
    row?.status,
  ].map(lower).includes(status));
}

function isCancelled(row) {
  return ['cancelled', 'canceled'].some(status => [row?.status, row?.order_status, row?.customer_app_order_status].map(lower).includes(status));
}

function isSubscriptionOrMultiDelivery(row) {
  return [
    row?.order_type,
    row?.native_order_type,
    row?.source_channel,
    row?.source_type,
    row?.fulfillment_mode,
    row?.fulfillment_type,
  ].some(value => {
    const normalized = lower(value);
    return normalized.includes('subscription') || normalized.includes('multi_delivery') || normalized.includes('multi-delivery');
  }) || Boolean(row?.stripe_subscription_id || row?.hub_fulfillment_number);
}

function isHistoricalLateMirror(row) {
  const joined = [
    row?.order_classification,
    row?.notes,
    row?.source_type,
    row?.native_source_type,
    row?.native_sync_status,
    row?.order_lock_status,
    row?.native_order_lock_status,
    row?.fallback_reason,
    ...(Array.isArray(row?.warnings) ? row.warnings : []),
  ].map(lower).join(' ');
  return ['historical', 'late_mirror', 'late-mirror', 'backfill'].some(token => joined.includes(token));
}

function isRepairReplay(row, syncByOrderNumber) {
  const sync = syncByOrderNumber.get(normalizeKey(row?.order_number));
  const joined = [
    row?.order_classification,
    row?.source_of_truth,
    row?.native_sync_status,
    row?.native_review_status,
    row?.fallback_reason,
    row?.native_latest_sync_log?.action,
    row?.native_latest_sync_log?.reason,
    row?.hub_sync_summary?.action,
    row?.hub_sync_summary?.reason,
    sync?.action,
    sync?.reason,
    sync?.status,
  ].map(lower).join(' ');
  return ['repair', 'replay', 'safe_sync', 'safesync'].some(token => joined.includes(token));
}

function sourceIds(row) {
  return unique([
    row?.id,
    row?.customer_app_order_id,
    row?.native_base44_order_id,
  ].map(text));
}

function nativeOrderNumber(nativeOrder) {
  return normalizeOrderNumber(nativeOrder?.shopify_order_number || nativeOrder?.order_number || nativeOrder?.name);
}

function taskOrderNumber(task) {
  return normalizeOrderNumber(task?.order_number || task?.shopify_order_number || task?.name);
}

function uniqueById(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows || []) {
    const key = text(row?.id) || JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

function buildNativeMatches(row, nativeOrders) {
  const orderNumber = normalizeKey(row?.order_number || row?.native_order_number);
  const ids = sourceIds(row);
  const nativeIdHints = unique([
    row?.native_shopify_order_id,
    row?.shopify_order_id,
    row?.hub_order_id,
  ].map(text));

  return uniqueById((nativeOrders || []).filter(nativeOrder => {
    const nativeNumber = normalizeKey(nativeOrder?.shopify_order_number || nativeOrder?.order_number || nativeOrder?.name);
    const directIds = unique([
      nativeOrder?.id,
      nativeOrder?.base44_order_id,
      nativeOrder?.customer_app_order_id,
      nativeOrder?.shopify_order_id,
    ].map(text));
    if (orderNumber && nativeNumber && orderNumber === nativeNumber) return true;
    if (directIds.some(id => ids.includes(id) || nativeIdHints.includes(id))) return true;
    return false;
  }));
}

function buildTaskMatches(row, nativeMatches, fulfillmentTasks) {
  const orderNumber = normalizeKey(row?.order_number || row?.native_order_number);
  const ids = sourceIds(row);
  const nativeIds = unique([
    row?.native_shopify_order_id,
    row?.shopify_order_id,
    ...((nativeMatches || []).map(nativeOrder => nativeOrder?.id)),
    ...((nativeMatches || []).map(nativeOrder => nativeOrder?.shopify_order_id)),
  ].map(text));

  return uniqueById((fulfillmentTasks || []).filter(task => {
    const taskNumber = normalizeKey(task?.order_number || task?.shopify_order_number || task?.name);
    const taskOrderIds = unique([task?.order_id, task?.base44_order_id, task?.customer_app_order_id].map(text));
    const taskNativeIds = unique([task?.native_shopify_order_id, task?.shopify_order_id].map(text));
    if (orderNumber && taskNumber && orderNumber === taskNumber) return true;
    if (taskOrderIds.some(id => ids.includes(id))) return true;
    if (taskNativeIds.some(id => nativeIds.includes(id))) return true;
    return false;
  }));
}

function buildReviewIndex(reviewRows) {
  const byOrderNumber = new Map();
  for (const row of reviewRows || []) {
    if (['resolved', 'archived'].includes(lower(row?.status))) continue;
    const payload = row?.incoming_payload && typeof row.incoming_payload === 'object' ? row.incoming_payload : {};
    const key = normalizeKey(row?.existing_order_number || payload.order_number || row?.order_number);
    if (key && !byOrderNumber.has(key)) byOrderNumber.set(key, row);
  }
  return byOrderNumber;
}

function buildSyncIndex(orderSyncLogs, safeSyncParityLogs) {
  const byOrderNumber = new Map();
  const add = (row, source) => {
    const key = normalizeKey(row?.order_number || row?.shopify_order_number);
    if (!key || byOrderNumber.has(key)) return;
    byOrderNumber.set(key, {
      status: row?.status || row?.parity_status || null,
      action: row?.action || row?.hub_action || row?.bridge_action || null,
      reason: row?.reason || row?.error_code || row?.mismatch_reason || null,
      source,
    });
  };
  for (const row of orderSyncLogs || []) add(row, 'OrderSyncLog');
  for (const row of safeSyncParityLogs || []) add(row, 'SafeSyncParityLog');
  return byOrderNumber;
}

function nativePaymentStatus(nativeMatches, row) {
  return nativeMatches?.[0]?.payment_status || nativeMatches?.[0]?.financial_status || row?.native_payment_status || null;
}

function nativeFulfillmentStatus(nativeMatches, row) {
  return nativeMatches?.[0]?.fulfillment_status || nativeMatches?.[0]?.order_status || row?.native_fulfillment_status || null;
}

function nativeDeliveryStatus(taskMatches, row) {
  return taskMatches?.[0]?.delivery_status || taskMatches?.[0]?.status || row?.native_delivery_status || row?.delivery_status || null;
}

function nativeProductionStatus(nativeMatches, taskMatches, row) {
  return nativeMatches?.[0]?.production_status || taskMatches?.[0]?.production_status || row?.native_production_status || null;
}

function detectMismatches(row, nativeMatches, taskMatches) {
  const categories = new Set(Array.isArray(row?.mismatch_categories) ? row.mismatch_categories : []);
  const nativePayment = nativePaymentStatus(nativeMatches, row);
  if (valuesDiffer(row?.payment_status || row?.financial_status || row?.customer_app_payment_status, nativePayment)) categories.add('payment_mismatch');
  const nativeFulfillment = nativeFulfillmentStatus(nativeMatches, row);
  const currentFulfillment = row?.fulfillment_status || row?.hub_fulfillment_status || row?.native_fulfillment_status || null;
  if (valuesDiffer(currentFulfillment, nativeFulfillment)) categories.add('fulfillment_mismatch');
  const orderDeliveryDate = dateOnly(row?.assigned_delivery_date || row?.estimated_delivery_date || row?.delivery_date || row?.customer_app_estimated_delivery_date);
  const nativeDeliveryDate = dateOnly(taskMatches?.[0]?.delivery_date || taskMatches?.[0]?.scheduled_date || taskMatches?.[0]?.assigned_delivery_date || nativeMatches?.[0]?.assigned_delivery_date || nativeMatches?.[0]?.selected_delivery_date || nativeMatches?.[0]?.requested_delivery_date);
  if (orderDeliveryDate && nativeDeliveryDate && orderDeliveryDate !== nativeDeliveryDate) categories.add('delivery_schedule_mismatch');
  return Array.from(categories);
}

function classifyRow({ row, nativeMatches, taskMatches, reviewIndex, syncIndex }) {
  const blockers = [];
  const warnings = [];
  const addBlocker = value => { if (value && !blockers.includes(value)) blockers.push(value); };
  const addWarning = value => { if (value && !warnings.includes(value)) warnings.push(value); };

  const review = reviewIndex.get(normalizeKey(row?.order_number));
  const duplicateIdentity = nativeMatches.length > 1 || taskMatches.length > 1;
  const nativePresent = nativeMatches.length === 1 || row?.has_native_order === true;
  const taskPresent = taskMatches.length === 1 || row?.has_native_task === true || Number(row?.native_fulfillment_task_summary?.count) === 1;
  const mismatchCategories = detectMismatches(row, nativeMatches, taskMatches);
  const paidReady = paymentIsPaid(row) && paymentCaptured(row);
  const refundHold = isRefunded(row);
  const cancelHold = isCancelled(row);
  const subscriptionHold = isSubscriptionOrMultiDelivery(row);
  const repairReplayHold = isRepairReplay(row, syncIndex);
  const historicalHold = isHistoricalLateMirror(row);
  const hubOnlyValid = row?.is_hub_order === true && !nativePresent && row?.has_customer_app_order !== true;

  if (duplicateIdentity) addBlocker('admin_order_duplicate_identity_risk');
  if (!nativePresent && !hubOnlyValid) addBlocker('admin_order_native_order_missing');
  if (nativePresent && !taskPresent) addBlocker('admin_order_fulfillment_task_missing');
  if (!paidReady) addBlocker('payment_not_paid_or_captured');
  if (refundHold) addBlocker('admin_order_refund_payment_hold');
  if (cancelHold) addBlocker('admin_order_cancelled_payment_risk');
  if (subscriptionHold) addBlocker('admin_order_subscription_multi_delivery_hold');
  if (review || row?.review_required === true || row?.native_review_queue_summary) addBlocker('admin_order_review_queue_hold');
  if (repairReplayHold) addBlocker('admin_order_repair_replay_hold');
  if (historicalHold) addBlocker('admin_order_historical_late_mirror');
  for (const category of mismatchCategories) addBlocker(`admin_order_${category}`);

  if (hubOnlyValid) addWarning('admin_order_hub_only_valid');
  if (row?.fallback_reason) addWarning(row.fallback_reason);

  let classification = 'admin_order_manual_review_required';
  if (hubOnlyValid) classification = 'admin_order_hub_only_valid';
  else if (historicalHold) classification = 'admin_order_historical_late_mirror';
  else if (repairReplayHold) classification = 'admin_order_repair_replay_hold';
  else if (review || row?.review_required === true || row?.native_review_queue_summary) classification = 'admin_order_review_queue_hold';
  else if (subscriptionHold) classification = 'admin_order_subscription_multi_delivery_hold';
  else if (refundHold) classification = 'admin_order_refund_payment_hold';
  else if (cancelHold) classification = 'admin_order_cancelled_payment_risk';
  else if (duplicateIdentity) classification = 'admin_order_duplicate_identity_risk';
  else if (mismatchCategories.includes('payment_mismatch')) classification = 'admin_order_payment_mismatch';
  else if (mismatchCategories.includes('fulfillment_mismatch')) classification = 'admin_order_fulfillment_mismatch';
  else if (mismatchCategories.includes('delivery_schedule_mismatch')) classification = 'admin_order_delivery_schedule_mismatch';
  else if (!nativePresent) classification = 'admin_order_native_order_missing';
  else if (!taskPresent) classification = 'admin_order_fulfillment_task_missing';
  else if (nativePresent && taskPresent && paidReady && blockers.length === 0) classification = 'admin_order_native_read_ready';
  else if (nativePresent) classification = 'admin_order_native_read_partial';

  const fallbackRequired = classification !== 'admin_order_native_read_ready' || blockers.length > 0 || row?.fallback_reason != null || row?.is_hub_order === true;
  if (fallbackRequired && classification !== 'admin_order_hub_only_valid') addWarning('admin_order_hub_fallback_required');

  return {
    classification,
    blockers: unique(blockers),
    warnings: unique(warnings),
    mismatch_categories: mismatchCategories,
    paid_captured_ready: paidReady,
    refund_cancel_hold: refundHold || cancelHold,
    subscription_multi_delivery_hold: subscriptionHold,
    native_shopify_order_present: nativePresent,
    fulfillment_task_present: taskPresent,
    native_shopify_order_match_count: nativeMatches.length,
    compatible_fulfillment_task_count: taskMatches.length,
    exact_identity_ready: nativeMatches.length === 1 && taskMatches.length <= 1 && !duplicateIdentity,
    native_chain_complete: nativeMatches.length === 1 && taskMatches.length === 1 && !duplicateIdentity,
    fallback_required: fallbackRequired,
    review_required: blockers.length > 0 || classification !== 'admin_order_native_read_ready',
  };
}

function buildRow(row, context) {
  const nativeMatches = buildNativeMatches(row, context.nativeOrders);
  const taskMatches = buildTaskMatches(row, nativeMatches, context.fulfillmentTasks);
  const evaluation = classifyRow({ row, nativeMatches, taskMatches, reviewIndex: context.reviewIndex, syncIndex: context.syncIndex });
  return {
    canonical_order_ref: text(row?.id || row?.customer_app_order_id || row?.order_number) || null,
    canonical_order_number: normalizeOrderNumber(row?.order_number || row?.native_order_number),
    created_date: row?.created_date || null,
    order_type: row?.order_type || row?.native_order_type || row?.source_type || null,
    fulfillment_type: row?.fulfillment_type || row?.customer_app_fulfillment_type || null,
    delivery_date: row?.assigned_delivery_date || row?.estimated_delivery_date || row?.delivery_date || row?.customer_app_estimated_delivery_date || null,
    payment_status: row?.payment_status || row?.financial_status || row?.customer_app_payment_status || null,
    payment_captured: paymentCaptured(row),
    customer_order_status: row?.customer_app_order_status || row?.status || null,
    native_shopify_order_present: evaluation.native_shopify_order_present,
    fulfillment_task_present: evaluation.fulfillment_task_present,
    native_shopify_order_match_count: evaluation.native_shopify_order_match_count,
    compatible_fulfillment_task_count: evaluation.compatible_fulfillment_task_count,
    exact_identity_ready: evaluation.exact_identity_ready,
    native_chain_complete: evaluation.native_chain_complete,
    native_payment_status: nativePaymentStatus(nativeMatches, row),
    native_fulfillment_status: nativeFulfillmentStatus(nativeMatches, row),
    native_delivery_status: nativeDeliveryStatus(taskMatches, row),
    native_production_status: nativeProductionStatus(nativeMatches, taskMatches, row),
    Hub_context_present: row?.is_hub_order === true || Boolean(row?.hub_order_id || row?.hub_sync_summary),
    Hub_sync_status: row?.hub_sync_summary?.status || null,
    fallback_required: evaluation.fallback_required,
    review_required: evaluation.review_required,
    mismatch_categories: evaluation.mismatch_categories,
    blockers: evaluation.blockers,
    warnings: evaluation.warnings,
    classification: evaluation.classification,
  };
}

function buildSummary(rows) {
  const count = predicate => rows.filter(predicate).length;
  const classificationCounts = {};
  for (const row of rows) addCount(classificationCounts, row.classification);
  return {
    canonical_order_count: rows.length,
    native_order_present_count: count(row => row.native_shopify_order_present),
    fulfillment_task_present_count: count(row => row.fulfillment_task_present),
    complete_native_chain_count: count(row => row.native_chain_complete),
    paid_captured_count: count(row => row.payment_status === 'paid' || row.payment_captured === true),
    pending_payment_count: count(row => !row.payment_captured && !['paid', 'captured'].includes(lower(row.payment_status))),
    refunded_cancelled_count: count(row => row.classification === 'admin_order_refund_payment_hold' || row.classification === 'admin_order_cancelled_payment_risk'),
    subscription_multi_delivery_count: count(row => row.classification === 'admin_order_subscription_multi_delivery_hold'),
    hub_only_valid_count: count(row => row.classification === 'admin_order_hub_only_valid'),
    payment_mismatch_count: count(row => row.mismatch_categories.includes('payment_mismatch')),
    fulfillment_mismatch_count: count(row => row.mismatch_categories.includes('fulfillment_mismatch')),
    schedule_mismatch_count: count(row => row.mismatch_categories.includes('delivery_schedule_mismatch')),
    duplicate_identity_count: count(row => row.classification === 'admin_order_duplicate_identity_risk'),
    review_hold_count: count(row => row.classification === 'admin_order_review_queue_hold'),
    repair_replay_hold_count: count(row => row.classification === 'admin_order_repair_replay_hold'),
    fallback_required_count: count(row => row.fallback_required),
    classification_counts: classificationCounts,
  };
}

export function buildAdminOrderLifecycleReadModel({
  currentOrders = [],
  customerOrders = [],
  nativeOrders = [],
  fulfillmentTasks = [],
  hubOrders = [],
  reviewRows = [],
  orderSyncLogs = [],
  safeSyncParityLogs = [],
  filters = {},
} = {}) {
  const rows = (Array.isArray(currentOrders) ? currentOrders : []).map(row => buildRow(row, {
    customerOrders,
    nativeOrders,
    fulfillmentTasks,
    hubOrders,
    reviewIndex: buildReviewIndex(reviewRows),
    syncIndex: buildSyncIndex(orderSyncLogs, safeSyncParityLogs),
  }));
  const summary = buildSummary(rows);
  return {
    read_model_version: READ_MODEL_VERSION,
    read_model_available: true,
    read_model_enabled: true,
    source_mode: 'hub_primary_native_context_read_model',
    filters: {
      search_present: Boolean(filters?.search),
      date_filter_present: Boolean(filters?.date_from || filters?.date_to),
      status_filter: filters?.status || null,
    },
    summary,
    classification_counts: summary.classification_counts,
    rows,
    order_write_ready: false,
    payment_write_ready: false,
    refund_write_ready: false,
    fulfillment_write_ready: false,
    delivery_write_ready: false,
    notification_expansion_ready: false,
    hub_write_suppression_ready: false,
    repair_replay_ready: false,
    writes_performed: false,
    provider_call_impact: false,
    hub_mutation_performed: false,
    notifications_sent: false,
    raw_payloads_returned: false,
    pii_returned: false,
  };
}
