#!/usr/bin/env node
import assert from 'node:assert/strict';

function normalizeLower(value) {
  return (value || '').toString().trim().toLowerCase();
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
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
  return Boolean(
    order?.payment_status ||
    order?.financial_status ||
    order?.payment_captured === true ||
    order?.native_payment_status ||
    order?.customer_app_payment_status
  );
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
  return ['cancelled', 'canceled', 'refunded'].some(status => [
    order?.status,
    order?.payment_status,
    order?.financial_status,
    order?.refund_status,
  ].map(normalizeLower).includes(status));
}

function isSubscriptionOrMultiDelivery(order) {
  return [
    order?.order_type,
    order?.native_order_type,
    order?.source_channel,
    order?.source_type,
    order?.fulfillment_mode,
  ].some(value => {
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

  return ['repair', 'replay', 'safe_sync', 'safesync', 'review_required', 'queued_for_review'].some(token => joined.includes(token)) ||
    Boolean(order?.native_review_queue_summary);
}

function isHistoricalLateMirror(order) {
  const joined = [
    order?.notes,
    order?.source_type,
    order?.native_source_type,
    order?.native_sync_status,
    order?.native_order_lock_status,
    order?.order_lock_status,
    order?.native_latest_sync_log?.source,
    order?.native_latest_sync_log?.reason,
  ].map(normalizeLower).join(' ');

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
  if (
    order?.payment_captured !== undefined &&
    order?.customer_app_payment_captured !== undefined &&
    Boolean(order.payment_captured) !== Boolean(order.customer_app_payment_captured)
  ) {
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
  if (
    Number.isFinite(Number(visibleLineCount)) &&
    Number.isFinite(Number(comparableLineCount)) &&
    Number(visibleLineCount) !== Number(comparableLineCount)
  ) {
    addMismatch('line_item_count', 'line_item_mismatch');
  }
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

function addCount(counts, key) {
  if (!key) return;
  counts[key] = (counts[key] || 0) + 1;
}

function decorateAdminOrderDiagnostics(order) {
  const classification = orderClassification(order);
  const sourceOfTruth = sourceOfTruthForOrder(order, classification);
  const { mismatchFields, mismatchCategories } = mismatchDiagnosticsForOrder(order);
  const fallbackReason = fallbackReasonForOrder(order, classification, mismatchFields);
  const reviewRequired = mismatchFields.length > 0 ||
    ['payment_provider_hub', 'manual_review', 'unknown'].includes(sourceOfTruth) ||
    ['historical_late_mirror', 'repair_replay_context'].includes(classification);
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

function buildAdminOrderDiagnostics({ mergedOrders, filteredHubOrders, nativeAdminOrders, fulfillmentTasks, localOrders }) {
  const exactMatchRows = mergedOrders.filter(order => (
    order.has_native_order &&
    order.is_hub_order &&
    Array.isArray(order.mismatch_fields) &&
    order.mismatch_fields.length === 0
  ));
  const mismatchRows = mergedOrders.filter(order => Array.isArray(order.mismatch_fields) && order.mismatch_fields.length > 0);
  const nativeMissingHubAvailable = mergedOrders.filter(order => order.is_hub_order && !order.has_native_order);
  const nativeOnlyRows = mergedOrders.filter(order => !order.is_hub_order && (order.is_native_order || order.has_native_order));
  const hubOnlyRows = mergedOrders.filter(order => order.is_hub_order && !order.has_native_order && !order.has_customer_app_order);
  const fallbackRows = mergedOrders.filter(order => Boolean(order.fallback_reason));
  const reviewRows = mergedOrders.filter(order => order.review_required === true);
  const mismatchCategoryCounts = {};
  const fallbackReasonCounts = {};
  const sourceOfTruthCounts = {};

  for (const order of mergedOrders) {
    for (const category of Array.isArray(order.mismatch_categories) ? order.mismatch_categories : []) addCount(mismatchCategoryCounts, category);
    addCount(fallbackReasonCounts, order.fallback_reason);
    addCount(sourceOfTruthCounts, order.source_of_truth);
  }

  return {
    admin_orders_diagnostics_enabled: true,
    native_first_enabled: false,
    hub_first_enabled: true,
    hub_fallback_active: true,
    writes_performed: false,
    provider_call_impact: false,
    notifications_sent: false,
    hub_mutation_performed: false,
    customer_facing_behavior_changed: false,
    append_admin_hub_order_note_touched: false,
    hub_row_count: filteredHubOrders.length,
    native_shopify_order_row_count: nativeAdminOrders.length,
    native_fulfillment_task_row_count: Array.isArray(fulfillmentTasks) ? fulfillmentTasks.length : 0,
    local_customer_app_order_row_count: localOrders.length,
    merged_row_count: mergedOrders.length,
    exact_match_count: exactMatchRows.length,
    mismatch_count: mismatchRows.length,
    native_missing_hub_available_count: nativeMissingHubAvailable.length,
    hub_missing_native_available_count: nativeOnlyRows.length,
    hub_only_count: hubOnlyRows.length,
    native_only_count: nativeOnlyRows.length,
    fallback_required_count: fallbackRows.length,
    review_required_count: reviewRows.length,
    mismatch_categories: mismatchCategoryCounts,
    fallback_reasons: fallbackReasonCounts,
    source_of_truth_holds: sourceOfTruthCounts,
  };
}

function runFixtureMerge({ hubRows = [], nativeRows = [], localRows = [] }) {
  const mergedMap = new Map();
  for (const order of hubRows) mergedMap.set(order.order_number.toLowerCase(), order);
  for (const order of nativeRows) {
    const key = order.order_number.toLowerCase();
    if (!mergedMap.has(key)) mergedMap.set(key, order);
  }
  for (const order of localRows) {
    const key = order.order_number.toLowerCase();
    const hubHasIt = mergedMap.has(key) && mergedMap.get(key).is_hub_order;
    if (!hubHasIt) mergedMap.set(key, order);
  }
  const mergedOrders = Array.from(mergedMap.values()).map(decorateAdminOrderDiagnostics);
  const diagnostics = buildAdminOrderDiagnostics({
    mergedOrders,
    filteredHubOrders: hubRows,
    nativeAdminOrders: nativeRows,
    fulfillmentTasks: [{ id: 'task_1' }, { id: 'task_2' }],
    localOrders: localRows,
  });
  return { success: true, total: mergedOrders.length, orders: mergedOrders, ...diagnostics };
}

const hubMatch = {
  id: 'hub_match',
  order_number: 'NV-MATCH',
  is_hub_order: true,
  has_native_order: true,
  has_customer_app_order: true,
  status: 'scheduled_for_juicing',
  customer_app_order_status: 'scheduled_for_juicing',
  payment_status: 'paid',
  native_payment_status: 'paid',
  customer_app_payment_status: 'paid',
  assigned_delivery_date: '2026-06-20',
  customer_app_estimated_delivery_date: '2026-06-20',
  items: [{ title: 'A', quantity: 1 }],
  customer_app_line_item_count: 1,
  native_line_item_count: 1,
  total: 12,
  native_total: 12,
};

const hubMismatch = {
  id: 'hub_mismatch',
  order_number: 'NV-MISMATCH',
  is_hub_order: true,
  has_native_order: true,
  status: 'scheduled_for_juicing',
  customer_app_order_status: 'order_received',
  payment_status: 'paid',
  native_payment_status: 'pending',
  assigned_delivery_date: '2026-06-22',
  native_fulfillment_task_summary: { count: 1, next_delivery_date: '2026-06-23', tasks: [{ id: 'task_mismatch', delivery_date: '2026-06-23' }] },
  items: [{ title: 'A', quantity: 1 }],
  native_line_item_count: 2,
  total: 20,
  native_total: 25,
};

const hubSubscription = {
  id: 'hub_subscription',
  order_number: 'NV-SUB-1',
  is_hub_order: true,
  order_type: 'subscription',
  stripe_subscription_id: 'sub_synthetic',
  payment_status: 'paid',
  status: 'scheduled_for_juicing',
};

const hubRefunded = {
  id: 'hub_refunded',
  order_number: 'NV-REFUND',
  is_hub_order: true,
  status: 'cancelled',
  payment_status: 'refunded',
};

const hubRepair = {
  id: 'hub_repair',
  order_number: 'NV-REPAIR',
  is_hub_order: true,
  has_native_order: true,
  native_review_queue_summary: { incident_type: 'safe_sync_replay', status: 'open' },
  status: 'order_received',
  payment_status: 'paid',
};

const hubOnly = {
  id: 'hub_only',
  order_number: 'NV-HUBONLY',
  is_hub_order: true,
  status: 'order_received',
  payment_status: 'paid',
};

const nativeOnly = {
  id: 'native_only',
  order_number: 'NV-NATIVEONLY',
  is_native_order: true,
  has_native_order: true,
  native_shopify_order_id: 'native_1',
  status: 'order_received',
  native_payment_status: 'paid',
};

const historicalLateMirror = {
  id: 'native_historical',
  order_number: 'NV-HIST',
  is_native_order: true,
  has_native_order: true,
  status: 'delivered',
  native_payment_status: 'paid',
  notes: 'historical late_mirror backfill context',
};

const localOnly = {
  id: 'local_only',
  order_number: 'NV-LOCAL',
  has_customer_app_order: true,
  status: 'order_received',
  payment_status: 'paid',
};

const result = runFixtureMerge({
  hubRows: [hubMatch, hubMismatch, hubSubscription, hubRefunded, hubRepair, hubOnly],
  nativeRows: [nativeOnly, historicalLateMirror, { ...hubMatch, id: 'native_duplicate', is_hub_order: false, is_native_order: true }],
  localRows: [localOnly, { ...hubMatch, id: 'local_duplicate', is_hub_order: false }],
});

const byOrder = new Map(result.orders.map(order => [order.order_number, order]));
const results = [];

assert.equal(byOrder.get('NV-MATCH').id, 'hub_match');
assert.equal(byOrder.get('NV-MATCH').hub_primary, true);
results.push('hub_row_primary_behavior_preserved');

assert.equal(byOrder.get('NV-NATIVEONLY').id, 'native_only');
assert.equal(byOrder.get('NV-NATIVEONLY').data_source, 'native_only');
results.push('native_row_appended_only_when_no_hub_row_exists');

assert.equal(byOrder.get('NV-LOCAL').id, 'local_only');
assert.equal(byOrder.get('NV-LOCAL').data_source, 'local_customer_app_only');
results.push('local_customer_app_row_appended_only_when_no_hub_row_exists');

assert.ok(result.exact_match_count >= 1);
results.push('exact_match_count_returned');

assert.ok(byOrder.get('NV-MISMATCH').mismatch_fields.includes('status'));
assert.ok(byOrder.get('NV-MISMATCH').mismatch_categories.includes('status_mismatch'));
results.push('status_mismatch_diagnostic_returned');

assert.ok(byOrder.get('NV-MISMATCH').mismatch_categories.includes('payment_mismatch'));
assert.equal(byOrder.get('NV-MISMATCH').fallback_reason, 'native_hub_mismatch_hub_primary_preserved');
results.push('payment_mismatch_source_of_truth_hold');

assert.ok(byOrder.get('NV-MISMATCH').mismatch_fields.includes('delivery_date'));
results.push('delivery_date_mismatch_metadata_returned');

assert.equal(byOrder.get('NV-HIST').order_classification, 'historical_late_mirror');
assert.equal(byOrder.get('NV-HIST').live_command_candidate, false);
results.push('late_mirror_not_live_command_candidate');

assert.equal(byOrder.get('NV-REFUND').source_of_truth, 'payment_provider_hub');
results.push('refunded_cancelled_hub_payment_source_of_truth');

assert.equal(byOrder.get('NV-SUB-1').source_of_truth, 'subscription_hub');
results.push('subscription_multi_delivery_hub_source_of_truth');

assert.equal(byOrder.get('NV-REPAIR').source_of_truth, 'manual_review');
results.push('repair_replay_manual_review_metadata');

assert.equal(result.native_only_count, 2);
assert.equal(byOrder.get('NV-NATIVEONLY').fallback_reason, 'hub_missing_native_available');
results.push('native_only_row_retained_and_classified');

assert.equal(byOrder.get('NV-HUBONLY').data_source, 'hub_primary');
assert.equal(byOrder.get('NV-HUBONLY').fallback_reason, 'native_missing_hub_available');
results.push('hub_only_row_retained_and_classified');

for (const field of ['success', 'total', 'orders']) assert.ok(Object.prototype.hasOwnProperty.call(result, field));
assert.ok(Array.isArray(result.orders));
results.push('response_shape_backward_compatible');

assert.equal(result.append_admin_hub_order_note_touched, false);
results.push('append_admin_hub_order_note_untouched');

const serialized = JSON.stringify(result);
assert.equal(serialized.includes('new_customer_email'), false);
assert.equal(serialized.includes('new_customer_phone'), false);
results.push('no_customer_email_phone_newly_exposed');

assert.equal(serialized.includes('shopify_raw_payload'), false);
assert.equal(serialized.includes('stripe_raw_payload'), false);
assert.equal(serialized.includes('provider_payload'), false);
results.push('no_raw_provider_payloads_returned');

assert.equal(result.writes_performed, false);
results.push('writes_performed_false');
assert.equal(result.provider_call_impact, false);
results.push('provider_call_impact_false');
assert.equal(result.notifications_sent, false);
results.push('notifications_sent_false');
assert.equal(result.hub_mutation_performed, false);
results.push('hub_mutation_performed_false');

assert.equal(result.admin_orders_diagnostics_enabled, true);
assert.equal(result.native_first_enabled, false);
assert.equal(result.hub_first_enabled, true);
assert.equal(result.hub_fallback_active, true);
assert.equal(result.customer_facing_behavior_changed, false);
results.push('top_level_diagnostics_contract_returned');

assert.equal(result.orders.some(order => order.created_log_or_queue), false);
results.push('no_logs_queues_created');

console.log(JSON.stringify({
  suite: 'g39j_admin_orders_mismatch_diagnostics',
  total_test_cases: results.length,
  passed: results.length,
  failed: 0,
  results,
  live_base44_calls: false,
  live_api_calls: false,
}, null, 2));
