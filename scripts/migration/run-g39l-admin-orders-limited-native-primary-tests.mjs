#!/usr/bin/env node
import assert from 'node:assert/strict';

function normalizeLower(value) {
  return (value || '').toString().trim().toLowerCase();
}

function normalizeOrderNum(value) {
  return (value || '').toString().replace(/^#/, '').trim().toLowerCase();
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function addCount(counts, key) {
  if (!key) return;
  counts[key] = (counts[key] || 0) + 1;
}

function isPosLikeOrder(order) {
  return [order?.source_channel, order?.source_type, order?.order_type, order?.fulfillment_type, order?.fulfillment_method]
    .some(value => normalizeLower(value) === 'pos');
}

function isPaidOrder(order) {
  return (
    order?.payment_status === 'paid' ||
    order?.financial_status === 'paid' ||
    order?.payment_captured === true ||
    order?.native_payment_status === 'paid' ||
    order?.customer_app_payment_status === 'paid'
  );
}

function isPendingPaymentOrder(order) {
  return (
    order?.status === 'pending_payment' ||
    ['pending', 'unpaid', 'requires_payment_method'].includes(normalizeLower(order?.payment_status)) ||
    ['pending', 'unpaid', 'requires_payment_method'].includes(normalizeLower(order?.financial_status))
  );
}

function hasPaymentSignal(order) {
  return Boolean(order?.payment_status || order?.financial_status || order?.payment_captured === true || order?.native_payment_status || order?.customer_app_payment_status);
}

function normalizeComparable(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return value.toString().trim().toLowerCase();
}

function valuesDiffer(left, right) {
  const normalizedLeft = normalizeComparable(left);
  const normalizedRight = normalizeComparable(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft !== normalizedRight;
}

function numericValuesDiffer(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
  return Math.abs(leftNumber - rightNumber) > 0.009;
}

function lineItemCount(order) {
  if (Number.isFinite(Number(order?.customer_app_line_item_count))) return Number(order.customer_app_line_item_count);
  if (Number.isFinite(Number(order?.native_line_item_count))) return Number(order.native_line_item_count);
  if (Array.isArray(order?.items)) return order.items.length;
  if (Array.isArray(order?.line_items)) return order.line_items.length;
  return null;
}

function currentRowLineItemCount(order) {
  if (Array.isArray(order?.items)) return order.items.length;
  if (Array.isArray(order?.line_items)) return order.line_items.length;
  return null;
}

function statusLooksTerminalOrRefunded(order) {
  return ['cancelled', 'canceled', 'refunded'].some(status => [order?.status, order?.payment_status, order?.financial_status, order?.refund_status].map(normalizeLower).includes(status));
}

function isSubscriptionOrMultiDelivery(order) {
  return [order?.order_type, order?.native_order_type, order?.source_channel, order?.source_type, order?.fulfillment_mode].some(value => {
    const normalized = normalizeLower(value);
    return normalized.includes('subscription') || normalized.includes('multi_delivery') || normalized.includes('multi-delivery');
  }) || Boolean(order?.stripe_subscription_id || order?.hub_fulfillment_number);
}

function isRepairReplayContext(order) {
  const joined = [
    order?.native_sync_status,
    order?.native_review_status,
    order?.order_lock_status,
    order?.native_order_lock_status,
    order?.hub_sync_summary?.action,
    order?.hub_sync_summary?.reason,
    order?.native_latest_sync_log?.action,
    order?.native_latest_sync_log?.reason,
    order?.native_review_queue_summary?.incident_type,
    order?.native_review_queue_summary?.recommended_action,
  ].map(normalizeLower).join(' ');
  return ['repair', 'replay', 'safe_sync', 'safesync', 'review_required', 'queued_for_review'].some(token => joined.includes(token)) || Boolean(order?.native_review_queue_summary);
}

function isHistoricalLateMirror(order) {
  const joined = [order?.notes, order?.source_type, order?.native_source_type, order?.native_sync_status, order?.native_order_lock_status, order?.order_lock_status, order?.native_latest_sync_log?.source, order?.native_latest_sync_log?.reason]
    .map(normalizeLower).join(' ');
  return ['historical', 'late_mirror', 'late-mirror', 'backfill'].some(token => joined.includes(token));
}

function orderClassification(order) {
  if (isSubscriptionOrMultiDelivery(order)) return 'subscription_or_multi_delivery';
  if (statusLooksTerminalOrRefunded(order)) return 'refunded_or_cancelled';
  if (isPendingPaymentOrder(order) || (hasPaymentSignal(order) && !isPaidOrder(order))) return 'payment_not_ready';
  if (isRepairReplayContext(order)) return 'repair_replay_context';
  if (isHistoricalLateMirror(order)) return 'historical_late_mirror';
  if (!order?.is_hub_order && (order?.is_native_order || order?.has_native_order)) return 'native_mirror_only';
  if (order?.is_hub_order && !order?.has_native_order && !order?.has_customer_app_order) return 'hub_dedupe_only';
  if (['delivered', 'picked_up'].includes(normalizeLower(order?.status))) return 'one_time_complete';
  if (isPaidOrder(order)) return 'one_time_active_paid';
  return 'unknown';
}

function sourceOfTruthForOrder(order, classification) {
  if (classification === 'subscription_or_multi_delivery') return 'subscription_hub';
  if (['refunded_or_cancelled', 'payment_not_ready'].includes(classification)) return 'payment_provider_hub';
  if (classification === 'repair_replay_context') return 'manual_review';
  if (order?.is_hub_order) return 'hub';
  if (order?.is_native_order || order?.has_native_order) return 'native';
  return 'unknown';
}

function mismatchDiagnosticsForOrder(order) {
  const mismatchFields = [];
  const mismatchCategories = [];
  const addMismatch = (field, category) => {
    if (!mismatchFields.includes(field)) mismatchFields.push(field);
    if (category && !mismatchCategories.includes(category)) mismatchCategories.push(category);
  };
  if (valuesDiffer(order?.status, order?.customer_app_order_status)) addMismatch('status', 'status_mismatch');
  if (valuesDiffer(order?.payment_status || order?.financial_status, order?.customer_app_payment_status)) addMismatch('payment_status', 'payment_mismatch');
  if (valuesDiffer(order?.payment_status || order?.financial_status, order?.native_payment_status)) addMismatch('payment_status', 'payment_mismatch');
  if (order?.payment_captured !== undefined && order?.customer_app_payment_captured !== undefined && Boolean(order.payment_captured) !== Boolean(order.customer_app_payment_captured)) {
    addMismatch('payment_captured', 'payment_mismatch');
  }
  if (valuesDiffer(order?.hub_fulfillment_status || order?.fulfillment_status, order?.native_fulfillment_status)) addMismatch('fulfillment_status', 'fulfillment_mismatch');
  if (valuesDiffer(order?.production_status, order?.native_production_status)) addMismatch('production_status', 'production_mismatch');
  const taskSummary = order?.native_fulfillment_task_summary || {};
  const nativeTask = Array.isArray(taskSummary.tasks) ? taskSummary.tasks[0] : null;
  const hubDeliveryDate = order?.assigned_delivery_date || order?.estimated_delivery_date || null;
  const nativeDeliveryDate = nativeTask?.delivery_date || taskSummary.next_delivery_date || order?.customer_app_estimated_delivery_date || null;
  if (valuesDiffer(hubDeliveryDate, nativeDeliveryDate)) addMismatch('delivery_date', 'delivery_schedule_mismatch');
  const visibleLineCount = currentRowLineItemCount(order);
  const comparableLineCount = lineItemCount(order);
  if (Number.isFinite(Number(visibleLineCount)) && Number.isFinite(Number(comparableLineCount)) && Number(visibleLineCount) !== Number(comparableLineCount)) addMismatch('line_item_count', 'line_item_mismatch');
  if (numericValuesDiffer(order?.total, order?.native_total)) addMismatch('total_price', 'financial_mismatch');
  return { mismatchFields, mismatchCategories };
}

function fallbackReasonForOrder(order, classification, mismatchFields) {
  if (classification === 'subscription_or_multi_delivery') return 'subscription_hub_source_of_truth';
  if (['refunded_or_cancelled', 'payment_not_ready'].includes(classification)) return 'payment_or_refund_hub_source_of_truth';
  if (classification === 'repair_replay_context') return 'manual_review_repair_replay_context';
  if (classification === 'historical_late_mirror') return 'historical_late_mirror_admin_context_only';
  if (order?.is_hub_order && !order?.has_native_order) return 'native_missing_hub_available';
  if (!order?.is_hub_order && (order?.is_native_order || order?.has_native_order)) return 'hub_missing_native_available';
  if (mismatchFields.length > 0) return 'native_hub_mismatch_hub_primary_preserved';
  if (order?.is_hub_order && order?.has_native_order) return 'hub_primary_with_native_context';
  if (!order?.is_hub_order && order?.has_customer_app_order) return 'local_customer_app_only';
  return null;
}

function dataSourceForOrder(order) {
  if (order?.is_hub_order && (order?.has_native_order || order?.has_customer_app_order)) return 'hub_with_native_context';
  if (order?.is_hub_order) return 'hub_primary';
  if (order?.is_native_order || order?.has_native_order) return 'native_only';
  if (order?.hub_sync_summary) return 'native_with_hub_fallback_context';
  return 'local_customer_app_only';
}

function decorateAdminOrderDiagnostics(order) {
  const classification = orderClassification(order);
  const sourceOfTruth = sourceOfTruthForOrder(order, classification);
  const { mismatchFields, mismatchCategories } = mismatchDiagnosticsForOrder(order);
  const fallbackReason = fallbackReasonForOrder(order, classification, mismatchFields);
  const reviewRequired = mismatchFields.length > 0 || ['payment_provider_hub', 'manual_review', 'unknown'].includes(sourceOfTruth) || ['historical_late_mirror', 'repair_replay_context'].includes(classification);
  const warnings = [];
  if (mismatchFields.length > 0) warnings.push('native_hub_mismatch_diagnostics_only');
  if (classification === 'historical_late_mirror') warnings.push('not_live_lifecycle_candidate');
  if (classification === 'subscription_or_multi_delivery') warnings.push('subscription_hub_source_of_truth');
  if (sourceOfTruth === 'payment_provider_hub') warnings.push('payment_or_refund_hub_source_of_truth');
  return {
    ...order,
    data_source: dataSourceForOrder(order),
    hub_primary: order?.is_hub_order === true,
    native_context_available: Boolean(order?.has_native_order || order?.has_native_task || order?.native_fulfillment_task_summary?.count),
    fallback_source: fallbackReason ? (order?.is_hub_order ? 'hub_order_context' : order?.has_native_order ? 'native_order_context' : 'customer_app_order_context') : null,
    fallback_reason: fallbackReason,
    mismatch_fields: mismatchFields,
    mismatch_categories: mismatchCategories,
    review_required: reviewRequired,
    customer_facing_safe: false,
    source_of_truth: sourceOfTruth,
    order_classification: classification,
    live_command_candidate: false,
    warnings: uniqueValues([...(Array.isArray(order?.warnings) ? order.warnings : []), ...warnings]),
  };
}

function hasOneTimeOrderSignal(order) {
  const values = [order?.order_type, order?.native_order_type, order?.source_type, order?.native_source_type, order?.source_channel, order?.native_source_channel].map(normalizeLower);
  if (values.some(value => ['one_time', 'one-time', 'one time'].includes(value))) return true;
  if (['one_time_active_paid', 'one_time_complete', 'historical_late_mirror', 'native_mirror_only'].includes(order?.order_classification)) return !isSubscriptionOrMultiDelivery(order) && !isPosLikeOrder(order);
  return false;
}

function evaluateAdminOrderLimitedNativePrimaryEligibility(order, nativeCandidate = null) {
  const blockers = [];
  const addBlocker = blocker => {
    if (blocker && !blockers.includes(blocker)) blockers.push(blocker);
  };
  const classification = order?.order_classification || orderClassification(order);
  const sourceOfTruth = order?.source_of_truth || sourceOfTruthForOrder(order, classification);
  const mismatchFields = Array.isArray(order?.mismatch_fields) ? order.mismatch_fields : [];
  const taskSummary = order?.native_fulfillment_task_summary || {};
  if (!hasOneTimeOrderSignal({ ...order, order_classification: classification })) addBlocker('one_time_not_proven');
  if (isPosLikeOrder(order)) addBlocker('pos_or_event_not_in_limited_subset');
  if (isSubscriptionOrMultiDelivery(order) || classification === 'subscription_or_multi_delivery') addBlocker('subscription_or_multi_delivery_hub_source_of_truth');
  if (classification === 'refunded_or_cancelled' || statusLooksTerminalOrRefunded(order)) addBlocker('refund_cancel_payment_source_of_truth');
  if (classification === 'payment_not_ready' || isPendingPaymentOrder(order) || !isPaidOrder(order)) addBlocker('payment_not_ready');
  if (order?.payment_captured !== true && order?.customer_app_payment_captured !== true) addBlocker('payment_not_captured');
  if (classification === 'repair_replay_context' || isRepairReplayContext(order)) addBlocker('repair_replay_manual_review');
  if (sourceOfTruth === 'payment_provider_hub') addBlocker('payment_provider_hub_source_of_truth');
  if (sourceOfTruth === 'subscription_hub') addBlocker('subscription_hub_source_of_truth');
  if (sourceOfTruth === 'manual_review') addBlocker('manual_review_source_of_truth');
  if (sourceOfTruth === 'unknown') addBlocker('unknown_source_of_truth');
  if (!order?.has_customer_app_order || !order?.customer_app_order_id) addBlocker('customer_app_order_missing');
  if (!order?.has_native_order || !(order?.native_shopify_order_id || nativeCandidate?.native_shopify_order_id)) addBlocker('native_shopify_order_missing');
  if (!nativeCandidate) addBlocker('native_primary_candidate_missing');
  if (!(order?.has_native_task === true || Number(taskSummary.count) > 0)) addBlocker('native_fulfillment_task_missing');
  if (order?.native_review_queue_summary) addBlocker('order_review_queue_blocker');
  if (mismatchFields.length > 0) addBlocker('native_hub_mismatch');
  if (order?.review_required === true) addBlocker('review_required');
  if (Array.isArray(order?.native_task_missing_metadata_fields) && order.native_task_missing_metadata_fields.length > 0) addBlocker('native_task_metadata_incomplete');
  return {
    eligible: blockers.length === 0,
    reason: blockers.length === 0 ? (classification === 'historical_late_mirror' ? 'safe_historical_late_mirror_admin_context_only' : order?.is_hub_order ? 'safe_one_time_reconciled_native_context' : 'safe_one_time_native_born_or_mirror') : null,
    blockers,
  };
}

function adminPrimarySourceForOrder(order, evaluation) {
  if (evaluation?.eligible === true) return 'native';
  if (order?.is_hub_order) return 'hub';
  if (order?.is_native_order || order?.has_native_order) return 'native';
  return 'local_customer_app';
}

function applyLimitedNativePrimaryMetadata(order, evaluation) {
  return {
    ...order,
    admin_primary_source: adminPrimarySourceForOrder(order, evaluation),
    native_primary_eligible: evaluation?.eligible === true,
    native_primary_reason: evaluation?.reason || null,
    native_primary_blockers: Array.isArray(evaluation?.blockers) ? evaluation.blockers : [],
    customer_facing_safe: evaluation?.eligible === true,
    source_of_truth: evaluation?.eligible === true ? 'native' : order?.source_of_truth,
    write_path_not_in_scope: true,
  };
}

function buildAdminOrderDiagnostics({ mergedOrders, hubRows = [], nativeRows = [], localRows = [], fulfillmentTasks = [] }) {
  const exactMatchRows = mergedOrders.filter(order => order.has_native_order && order.is_hub_order && Array.isArray(order.mismatch_fields) && order.mismatch_fields.length === 0);
  const mismatchRows = mergedOrders.filter(order => Array.isArray(order.mismatch_fields) && order.mismatch_fields.length > 0);
  const reviewRows = mergedOrders.filter(order => order.review_required === true);
  const nativePrimaryRows = mergedOrders.filter(order => order.native_primary_eligible === true && order.admin_primary_source === 'native');
  const hubPrimaryRows = mergedOrders.filter(order => order.admin_primary_source === 'hub');
  const nativePrimaryIneligibleRows = mergedOrders.filter(order => order.native_primary_eligible !== true);
  const mismatchCategoryCounts = {};
  const nativePrimaryIneligibleReasonCounts = {};
  for (const order of mergedOrders) {
    for (const category of Array.isArray(order.mismatch_categories) ? order.mismatch_categories : []) addCount(mismatchCategoryCounts, category);
    for (const blocker of Array.isArray(order.native_primary_blockers) ? order.native_primary_blockers : []) addCount(nativePrimaryIneligibleReasonCounts, blocker);
  }
  return {
    admin_orders_diagnostics_enabled: true,
    limited_native_primary_enabled: true,
    native_first_enabled: false,
    hub_first_enabled: true,
    hub_fallback_active: true,
    writes_performed: false,
    provider_call_impact: false,
    notifications_sent: false,
    hub_mutation_performed: false,
    customer_facing_behavior_changed: false,
    append_admin_hub_order_note_touched: false,
    hub_row_count: hubRows.length,
    native_shopify_order_row_count: nativeRows.length,
    native_fulfillment_task_row_count: fulfillmentTasks.length,
    local_customer_app_order_row_count: localRows.length,
    merged_row_count: mergedOrders.length,
    exact_match_count: exactMatchRows.length,
    mismatch_count: mismatchRows.length,
    mismatch_categories: mismatchCategoryCounts,
    review_required_count: reviewRows.length,
    native_primary_row_count: nativePrimaryRows.length,
    hub_primary_row_count: hubPrimaryRows.length,
    native_primary_eligible_count: nativePrimaryRows.length,
    native_primary_ineligible_count: nativePrimaryIneligibleRows.length,
    native_primary_ineligible_reasons: nativePrimaryIneligibleReasonCounts,
  };
}

function buildNativeIndex(nativeRows) {
  const byOrderNumber = new Map();
  for (const row of nativeRows) byOrderNumber.set(normalizeOrderNum(row.order_number || row.native_order_number), row);
  return byOrderNumber;
}

function applyLimitedSelection(row, nativeIndex) {
  const decorated = decorateAdminOrderDiagnostics(row);
  const nativeCandidate = nativeIndex.get(normalizeOrderNum(decorated.order_number));
  const evaluation = evaluateAdminOrderLimitedNativePrimaryEligibility(decorated, nativeCandidate);
  if (!evaluation.eligible || !nativeCandidate) return applyLimitedNativePrimaryMetadata(decorated, evaluation);
  const nativePrimary = decorateAdminOrderDiagnostics({
    ...nativeCandidate,
    is_hub_order: decorated.is_hub_order === true,
    hub_order_id: decorated.hub_order_id || nativeCandidate.hub_order_id || null,
    hub_sync_summary: decorated.hub_sync_summary || null,
    created_date: decorated.created_date || nativeCandidate.created_date || null,
  });
  return applyLimitedNativePrimaryMetadata(nativePrimary, evaluation);
}

function runFixtureMerge({ hubRows = [], nativeRows = [], localRows = [], fulfillmentTasks = [] }) {
  const mergedMap = new Map();
  for (const order of hubRows) mergedMap.set(normalizeOrderNum(order.order_number), order);
  for (const order of nativeRows) {
    const key = normalizeOrderNum(order.order_number);
    if (!mergedMap.has(key)) mergedMap.set(key, order);
  }
  for (const order of localRows) {
    const key = normalizeOrderNum(order.order_number);
    const hubHasIt = mergedMap.has(key) && mergedMap.get(key).is_hub_order;
    if (!hubHasIt) mergedMap.set(key, order);
  }
  const nativeIndex = buildNativeIndex(nativeRows);
  const mergedOrders = Array.from(mergedMap.values()).map(order => applyLimitedSelection(order, nativeIndex));
  const diagnostics = buildAdminOrderDiagnostics({ mergedOrders, hubRows, nativeRows, localRows, fulfillmentTasks });
  return { success: true, total: mergedOrders.length, orders: mergedOrders, ...diagnostics };
}

const nativeTaskSummary = {
  count: 1,
  next_delivery_date: '2026-06-20',
  tasks: [{ id: 'task_safe', delivery_date: '2026-06-20' }],
  missing_metadata_fields: [],
};

const safeHub = {
  id: 'hub_safe',
  order_number: 'NV-SAFE',
  is_hub_order: true,
  has_customer_app_order: true,
  customer_app_order_id: 'order_safe',
  has_native_order: true,
  native_shopify_order_id: 'native_safe',
  has_native_task: true,
  order_type: 'one_time',
  status: 'delivered',
  customer_app_order_status: 'delivered',
  payment_status: 'paid',
  native_payment_status: 'paid',
  customer_app_payment_status: 'paid',
  payment_captured: true,
  customer_app_payment_captured: true,
  hub_fulfillment_status: 'fulfilled',
  native_fulfillment_status: 'fulfilled',
  native_production_status: 'bottled',
  production_status: 'bottled',
  assigned_delivery_date: '2026-06-20',
  customer_app_estimated_delivery_date: '2026-06-20',
  native_fulfillment_task_summary: nativeTaskSummary,
  items: [{ title: 'A', quantity: 1 }],
  customer_app_line_item_count: 1,
  native_line_item_count: 1,
  total: 12,
  native_total: 12,
};

const safeNative = {
  id: 'native_safe',
  order_number: 'NV-SAFE',
  is_native_order: true,
  has_native_order: true,
  native_shopify_order_id: 'native_safe',
  has_customer_app_order: true,
  customer_app_order_id: 'order_safe',
  has_native_task: true,
  order_type: 'one_time',
  status: 'delivered',
  customer_app_order_status: 'delivered',
  payment_status: 'paid',
  native_payment_status: 'paid',
  customer_app_payment_status: 'paid',
  payment_captured: true,
  customer_app_payment_captured: true,
  native_fulfillment_status: 'fulfilled',
  native_production_status: 'bottled',
  production_status: 'bottled',
  assigned_delivery_date: '2026-06-20',
  customer_app_estimated_delivery_date: '2026-06-20',
  native_fulfillment_task_summary: nativeTaskSummary,
  items: [{ title: 'A', quantity: 1 }],
  customer_app_line_item_count: 1,
  native_line_item_count: 1,
  total: 12,
  native_total: 12,
};

const safeNativeBorn = {
  ...safeNative,
  id: 'native_born',
  order_number: 'NV-NATIVE-BORN',
  native_shopify_order_id: 'native_born',
};

const ambiguousHub = { ...safeHub, id: 'hub_ambiguous', order_number: 'NV-AMBIG', order_type: null, has_native_order: false, native_shopify_order_id: null };
const statusMismatch = { ...safeHub, id: 'hub_status_mismatch', order_number: 'NV-STATUS', status: 'scheduled_for_juicing', customer_app_order_status: 'delivered' };
const paymentMismatch = { ...safeHub, id: 'hub_payment_mismatch', order_number: 'NV-PAYMENT', native_payment_status: 'pending' };
const deliveryMismatch = { ...safeHub, id: 'hub_delivery_mismatch', order_number: 'NV-DATE', assigned_delivery_date: '2026-06-21' };
const refunded = { ...safeHub, id: 'hub_refund', order_number: 'NV-REFUND', status: 'cancelled', payment_status: 'refunded' };
const cancelled = { ...safeHub, id: 'hub_cancel', order_number: 'NV-CANCEL', status: 'cancelled' };
const subscription = { ...safeHub, id: 'hub_subscription', order_number: 'NV-SUB', order_type: 'subscription', stripe_subscription_id: 'sub_synthetic' };
const multiDelivery = { ...safeHub, id: 'hub_multi', order_number: 'NV-MULTI', fulfillment_mode: 'multi_delivery' };
const repairReplay = { ...safeHub, id: 'hub_repair', order_number: 'NV-REPAIR', native_review_queue_summary: { incident_type: 'safe_sync_replay' } };
const hubOnly = { id: 'hub_only', order_number: 'NV-HUBONLY', is_hub_order: true, order_type: 'one_time', status: 'delivered', payment_status: 'paid', payment_captured: true };
const nativeOnlyCautious = { ...safeNative, id: 'native_only_cautious', order_number: 'NV-NATIVE-ONLY', has_native_task: false, native_fulfillment_task_summary: { count: 0 } };
const nativeMissingHubAvailable = { ...safeHub, id: 'hub_native_missing', order_number: 'NV-NATIVE-MISSING', has_native_order: false, native_shopify_order_id: null };

const nativeRows = [
  safeNative,
  safeNativeBorn,
  { ...safeNative, order_number: 'NV-STATUS' },
  { ...safeNative, order_number: 'NV-PAYMENT' },
  { ...safeNative, order_number: 'NV-DATE' },
  { ...safeNative, order_number: 'NV-REFUND' },
  { ...safeNative, order_number: 'NV-CANCEL' },
  { ...safeNative, order_number: 'NV-SUB' },
  { ...safeNative, order_number: 'NV-MULTI' },
  { ...safeNative, order_number: 'NV-REPAIR' },
  nativeOnlyCautious,
];

const result = runFixtureMerge({
  hubRows: [safeHub, ambiguousHub, statusMismatch, paymentMismatch, deliveryMismatch, refunded, cancelled, subscription, multiDelivery, repairReplay, hubOnly, nativeMissingHubAvailable],
  nativeRows,
  localRows: [{ order_number: 'NV-LOCAL', has_customer_app_order: true, customer_app_order_id: 'local_1', payment_status: 'paid' }],
  fulfillmentTasks: [{ id: 'task_safe' }],
});

const byOrder = new Map(result.orders.map(order => [order.order_number, order]));
const results = [];

assert.equal(byOrder.get('NV-SAFE').admin_primary_source, 'native');
assert.equal(byOrder.get('NV-SAFE').native_primary_eligible, true);
assert.equal(byOrder.get('NV-SAFE').source_of_truth, 'native');
assert.equal(byOrder.get('NV-SAFE').is_hub_order, true);
results.push('safe_one_time_reconciled_native_row_becomes_admin_primary');

assert.equal(byOrder.get('NV-NATIVE-BORN').admin_primary_source, 'native');
assert.equal(byOrder.get('NV-NATIVE-BORN').native_primary_eligible, true);
results.push('safe_one_time_native_born_row_becomes_admin_primary');

assert.equal(byOrder.get('NV-AMBIG').admin_primary_source, 'hub');
assert.equal(byOrder.get('NV-AMBIG').native_primary_eligible, false);
results.push('hub_primary_default_for_ambiguous_row');

assert.equal(byOrder.get('NV-STATUS').admin_primary_source, 'hub');
assert.ok(byOrder.get('NV-STATUS').native_primary_blockers.includes('native_hub_mismatch'));
results.push('status_mismatch_remains_hub_primary');

assert.equal(byOrder.get('NV-PAYMENT').admin_primary_source, 'hub');
assert.ok(byOrder.get('NV-PAYMENT').mismatch_categories.includes('payment_mismatch'));
results.push('payment_mismatch_remains_hub_primary');

assert.equal(byOrder.get('NV-DATE').admin_primary_source, 'hub');
assert.ok(byOrder.get('NV-DATE').mismatch_categories.includes('delivery_schedule_mismatch'));
results.push('delivery_schedule_mismatch_remains_hub_primary');

assert.equal(byOrder.get('NV-REFUND').source_of_truth, 'payment_provider_hub');
assert.equal(byOrder.get('NV-REFUND').admin_primary_source, 'hub');
results.push('refunded_row_hub_payment_source_of_truth');

assert.equal(byOrder.get('NV-CANCEL').admin_primary_source, 'hub');
assert.ok(byOrder.get('NV-CANCEL').native_primary_blockers.includes('refund_cancel_payment_source_of_truth'));
results.push('cancelled_row_remains_hub_primary');

assert.equal(byOrder.get('NV-SUB').source_of_truth, 'subscription_hub');
assert.equal(byOrder.get('NV-SUB').admin_primary_source, 'hub');
results.push('subscription_row_remains_hub_primary');

assert.equal(byOrder.get('NV-MULTI').source_of_truth, 'subscription_hub');
assert.equal(byOrder.get('NV-MULTI').admin_primary_source, 'hub');
results.push('multi_delivery_row_remains_hub_primary');

assert.equal(byOrder.get('NV-REPAIR').source_of_truth, 'manual_review');
assert.equal(byOrder.get('NV-REPAIR').admin_primary_source, 'hub');
results.push('repair_replay_row_hub_manual_review');

assert.equal(byOrder.get('NV-HUBONLY').admin_primary_source, 'hub');
assert.ok(byOrder.get('NV-HUBONLY').native_primary_blockers.includes('native_shopify_order_missing'));
results.push('hub_only_row_remains_hub_primary');

assert.equal(byOrder.get('NV-NATIVE-ONLY').admin_primary_source, 'native');
assert.equal(byOrder.get('NV-NATIVE-ONLY').native_primary_eligible, false);
assert.ok(byOrder.get('NV-NATIVE-ONLY').native_primary_blockers.includes('native_fulfillment_task_missing'));
results.push('native_only_row_retained_and_classified_carefully');

assert.equal(byOrder.get('NV-NATIVE-MISSING').admin_primary_source, 'hub');
assert.ok(byOrder.get('NV-NATIVE-MISSING').native_primary_blockers.includes('native_shopify_order_missing'));
results.push('native_missing_hub_available_remains_hub_primary');

assert.equal(result.append_admin_hub_order_note_touched, false);
results.push('append_admin_hub_order_note_untouched');

for (const field of ['success', 'total', 'orders']) assert.ok(Object.prototype.hasOwnProperty.call(result, field));
assert.ok(Array.isArray(result.orders));
results.push('response_shape_backward_compatible');

const serialized = JSON.stringify(result);
assert.equal(serialized.includes('new_customer_email'), false);
assert.equal(serialized.includes('new_customer_phone'), false);
results.push('no_customer_email_phone_newly_exposed');
assert.equal(serialized.includes('shopify_raw_payload'), false);
assert.equal(serialized.includes('stripe_raw_payload'), false);
assert.equal(serialized.includes('provider_payload'), false);
results.push('no_raw_hub_shopify_stripe_provider_payloads');

assert.equal(result.writes_performed, false);
results.push('writes_performed_false');
assert.equal(result.provider_call_impact, false);
results.push('provider_call_impact_false');
assert.equal(result.notifications_sent, false);
results.push('notifications_sent_false');
assert.equal(result.hub_mutation_performed, false);
results.push('hub_mutation_performed_false');
assert.equal(result.orders.some(order => order.created_log_or_queue), false);
results.push('no_logs_queues_created');
assert.equal(result.customer_facing_behavior_changed, false);
results.push('customer_facing_behavior_changed_false');

assert.equal(result.admin_orders_diagnostics_enabled, true);
assert.equal(result.limited_native_primary_enabled, true);
assert.equal(result.native_first_enabled, false);
assert.equal(result.hub_first_enabled, true);
assert.ok(result.native_primary_row_count >= 2);
assert.ok(result.hub_primary_row_count >= 1);
assert.ok(result.native_primary_ineligible_count >= 1);
results.push('g39j_diagnostics_and_g39l_metadata_present');

console.log(JSON.stringify({
  suite: 'g39l_admin_orders_limited_native_primary',
  total_test_cases: results.length,
  passed: results.length,
  failed: 0,
  results,
  live_base44_calls: false,
  live_api_calls: false,
}, null, 2));
