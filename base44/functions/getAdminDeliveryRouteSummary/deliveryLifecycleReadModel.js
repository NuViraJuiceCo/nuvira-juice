const READ_MODEL_VERSION = 'g48d_delivery_lifecycle_v1';

function text(value) {
  return (value ?? '').toString().trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function normalizeOrderNumber(value) {
  return text(value).replace(/^#/, '').toUpperCase();
}

function normalizeDate(value) {
  const valueText = text(value);
  const match = valueText.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isDeliveredStatus(value) {
  return ['delivered', 'completed', 'fulfilled', 'complete'].includes(lower(value).replace(/\s+/g, '_'));
}

function isStalePendingProductionStatus(value) {
  return ['awaiting_production', 'scheduled', 'pending', 'not_required'].includes(lower(value).replace(/\s+/g, '_'));
}

function canonicalDeliveryStatus(row = {}) {
  const raw = lower(row.delivery_status || row.task_status || row.status || row.fulfillment_status);
  if (raw === 'out for delivery' || raw === 'in transit') return 'out_for_delivery';
  if (raw === 'complete') return 'completed';
  return raw || null;
}

function visibleDeliveryStatus({ stop, task, nativeOrder, order }) {
  return canonicalDeliveryStatus(stop) ||
    canonicalDeliveryStatus(task) ||
    canonicalDeliveryStatus(nativeOrder) ||
    canonicalDeliveryStatus(order);
}

function visibleProductionStatus({ stop, task, nativeOrder, order }) {
  const stopDeliveryStatus = canonicalDeliveryStatus(stop);
  const taskProductionStatus = task?.production_status;
  const nativeProductionStatus = nativeOrder?.production_status;
  if (
    isDeliveredStatus(stopDeliveryStatus) &&
    (isStalePendingProductionStatus(taskProductionStatus) || isStalePendingProductionStatus(nativeProductionStatus))
  ) {
    return stop?.production_status && !isStalePendingProductionStatus(stop.production_status)
      ? stop.production_status
      : 'delivered';
  }
  return taskProductionStatus || nativeProductionStatus || order?.production_status || stop?.production_status || null;
}

function canonicalOrderNumber(row = {}) {
  return normalizeOrderNumber(row.order_number || row.shopify_order_number || row.name);
}

function isPaid(value) {
  const key = lower(value);
  return key === 'paid' || key === 'captured' || key === 'succeeded';
}

function hasRefundCancelHold(...rows) {
  return rows.filter(Boolean).some(row => {
    const statuses = [
      row.status,
      row.order_status,
      row.payment_status,
      row.financial_status,
      row.refund_status,
      row.cancel_status,
      row.production_status,
      row.fulfillment_status,
      row.delivery_status,
    ].map(lower);
    return Boolean(row.refunded_at || row.refund_status || row.canceled_at || row.cancelled_at || row.cancel_type) ||
      statuses.some(status => ['refunded', 'refund', 'fully_refunded', 'partially_refunded', 'cancelled', 'canceled', 'voided'].includes(status));
  });
}

function hasSubscriptionHold(...rows) {
  return rows.filter(Boolean).some(row => {
    const fields = [
      row.source_type,
      row.source_channel,
      row.order_type,
      row.fulfillment_type,
      row.fulfillment_mode,
      row.source,
    ].map(lower);
    return Boolean(
      row.is_subscription ||
      row.subscription_id ||
      row.stripe_subscription_id ||
      row.customer_app_subscription_id ||
      row.subscription_occurrence_id ||
      row.subscription_cycle_key ||
      row.subscription_parent_id ||
      row.fulfillment_instance_count > 1 ||
      row.fulfillment_mode === 'multi_delivery'
    ) || fields.some(field => field.includes('subscription') || field.includes('multi_delivery') || field.includes('multi-delivery'));
  });
}

function paymentSafeForDelivery(order, nativeOrder, task) {
  const values = [
    order?.payment_status || order?.financial_status,
    nativeOrder?.payment_status || nativeOrder?.financial_status,
    task?.payment_status,
  ].filter(value => text(value));
  const capturedSignals = [order?.payment_captured, nativeOrder?.payment_captured, task?.payment_captured]
    .filter(value => value !== undefined && value !== null);
  if (values.length === 0) return false;
  if (!values.every(isPaid)) return false;
  if (capturedSignals.length > 0 && capturedSignals.some(value => value === false)) return false;
  return true;
}

function makeOrderIndexes(customerOrders = []) {
  const byId = new Map();
  const byNumber = new Map();
  for (const order of customerOrders || []) {
    if (order?.id) byId.set(text(order.id), [...(byId.get(text(order.id)) || []), order]);
    const number = canonicalOrderNumber(order);
    if (number) byNumber.set(number, [...(byNumber.get(number) || []), order]);
  }
  return { byId, byNumber };
}

function findCustomerOrdersForStop(stop, orderIndexes) {
  const matches = [];
  const add = rows => {
    for (const row of rows || []) if (row && !matches.includes(row)) matches.push(row);
  };
  if (stop?.customer_app_order_id) add(orderIndexes.byId.get(text(stop.customer_app_order_id)) || []);
  if (stop?.order_id) add(orderIndexes.byId.get(text(stop.order_id)) || []);
  const number = canonicalOrderNumber(stop);
  if (number) add(orderIndexes.byNumber.get(number) || []);
  return matches;
}

function findNativeOrdersForOrder(order, nativeOrders = [], stop = {}) {
  const orderId = text(order?.id || stop?.customer_app_order_id);
  const number = canonicalOrderNumber(order || stop);
  return (nativeOrders || []).filter(nativeOrder => {
    const explicitLinks = [nativeOrder?.base44_order_id, nativeOrder?.customer_app_order_id].map(text).filter(Boolean);
    const nativeNumber = canonicalOrderNumber(nativeOrder);
    return (orderId && explicitLinks.includes(orderId)) || (number && nativeNumber === number);
  });
}

function findTasksForContext({ order, nativeOrder, stop, tasks = [] }) {
  const orderId = text(order?.id || stop?.customer_app_order_id);
  const nativeIds = [nativeOrder?.id, nativeOrder?.shopify_order_id, stop?.native_shopify_order_id].map(text).filter(Boolean);
  const number = canonicalOrderNumber(order || stop || nativeOrder);
  return (tasks || []).filter(task => {
    const taskOrderLinks = [task?.order_id, task?.base44_order_id, task?.customer_app_order_id].map(text).filter(Boolean);
    const taskNativeLinks = [task?.native_shopify_order_id, task?.shopify_order_id].map(text).filter(Boolean);
    const taskNumber = canonicalOrderNumber(task);
    const orderMatch = (orderId && taskOrderLinks.includes(orderId)) || (number && taskNumber === number);
    const nativeMatch = nativeIds.length === 0 || taskNativeLinks.length === 0 || taskNativeLinks.some(id => nativeIds.includes(id));
    return orderMatch && nativeMatch;
  });
}

function hasReviewHold(order, stop, reviewRows = []) {
  const orderId = text(order?.id || stop?.customer_app_order_id);
  const number = canonicalOrderNumber(order || stop);
  return (reviewRows || []).some(row => {
    const status = lower(row?.status || row?.queue_visibility_status);
    if (['resolved', 'archived', 'rejected'].includes(status)) return false;
    return (orderId && text(row?.existing_order_id) === orderId) || (number && normalizeOrderNumber(row?.existing_order_number || row?.order_number) === number);
  });
}

function hasRepairReplayHold(order, nativeOrder, stop, orderSyncLogs = [], safeSyncParityLogs = []) {
  const orderId = text(order?.id || nativeOrder?.id || stop?.customer_app_order_id || stop?.native_shopify_order_id);
  const number = canonicalOrderNumber(order || nativeOrder || stop);
  const syncHold = (orderSyncLogs || []).some(row => {
    const rowNumber = normalizeOrderNumber(row?.order_number);
    const rowOrderId = text(row?.order_id);
    const status = lower(row?.status || row?.action || row?.reason);
    if (!((number && rowNumber === number) || (orderId && rowOrderId === orderId))) return false;
    return ['error', 'recovery', 'pending', 'queued_for_review', 'rejected'].includes(status) || lower(row?.error_code).includes('repair');
  });
  const parityHold = (safeSyncParityLogs || []).some(row => {
    const rowNumber = normalizeOrderNumber(row?.order_number);
    const rowOrderId = text(row?.order_id);
    const status = lower(row?.native_parity_status || row?.bridge_action || row?.hub_result_status);
    if (!((number && rowNumber === number) || (orderId && rowOrderId === orderId))) return false;
    return ['mismatch', 'blocked', 'needs_manual_review', 'unsupported', 'error', 'recovery'].includes(status);
  });
  return syncHold || parityHold;
}

function canonicalDeliveryDateFor(order, nativeOrder, task, stop) {
  return normalizeDate(
    task?.delivery_date || task?.scheduled_date || task?.assigned_delivery_date ||
    stop?.delivery_date || stop?.scheduled_date || stop?.assigned_delivery_date ||
    nativeOrder?.assigned_delivery_date || nativeOrder?.selected_delivery_date || nativeOrder?.requested_delivery_date ||
    order?.assigned_delivery_date || order?.estimated_delivery_date,
  );
}

function scheduleDates(order, nativeOrder, task, stop) {
  return unique([
    normalizeDate(order?.assigned_delivery_date || order?.estimated_delivery_date),
    normalizeDate(nativeOrder?.assigned_delivery_date || nativeOrder?.selected_delivery_date || nativeOrder?.requested_delivery_date),
    normalizeDate(task?.delivery_date || task?.scheduled_date || task?.assigned_delivery_date),
    normalizeDate(stop?.delivery_date || stop?.scheduled_date || stop?.assigned_delivery_date),
  ]);
}

function statusMismatch(order, nativeOrder, task, stop) {
  const customerStatus = canonicalDeliveryStatus({ delivery_status: order?.delivery_status, task_status: order?.status, fulfillment_status: order?.fulfillment_status });
  const nativeStatus = canonicalDeliveryStatus({ delivery_status: nativeOrder?.fulfillment_status, task_status: nativeOrder?.order_status, fulfillment_status: nativeOrder?.shopify_fulfillment_status });
  const taskStatus = canonicalDeliveryStatus(task || stop || {});
  const values = unique([customerStatus, nativeStatus, taskStatus].filter(value => value && value !== 'pending'));
  if (values.length < 2) return false;
  const terminal = values.filter(value => ['delivered', 'completed', 'fulfilled', 'out_for_delivery'].includes(value));
  return terminal.length > 1 && new Set(terminal).size > 1;
}

function routeContext(task, stop) {
  const source = task || stop || {};
  return {
    driver_assignment_present: Boolean(text(source.assigned_driver || source.assigned_driver_id || source.assigned_driver_email || stop?.assigned_driver)),
    route_context_present: Boolean(text(source.route_id || source.delivery_route_id || stop?.route_id || stop?.delivery_route_id)),
    route_stop_present: Boolean(text(source.route_stop_id || source.route_stop_sequence || stop?.route_stop_id || stop?.route_stop_sequence)),
    route_sequence_present: Boolean(text(source.route_stop_sequence || source.stop_sequence || stop?.route_stop_sequence || stop?.stop_sequence)),
  };
}

function buildClassification({ exactIdentityReady, blockers, task, stop }) {
  if (blockers.includes('delivery_lifecycle_duplicate_identity_risk')) return 'delivery_lifecycle_duplicate_identity_risk';
  if (blockers.includes('delivery_lifecycle_order_chain_missing')) return 'delivery_lifecycle_order_chain_missing';
  if (blockers.includes('delivery_lifecycle_native_order_missing')) return 'delivery_lifecycle_native_order_missing';
  if (blockers.includes('delivery_lifecycle_task_missing')) return 'delivery_lifecycle_task_missing';
  if (blockers.includes('delivery_lifecycle_refund_cancel_hold')) return 'delivery_lifecycle_refund_cancel_hold';
  if (blockers.includes('delivery_lifecycle_payment_hold')) return 'delivery_lifecycle_payment_hold';
  if (blockers.includes('delivery_lifecycle_subscription_multi_delivery_hold')) return 'delivery_lifecycle_subscription_multi_delivery_hold';
  if (blockers.includes('delivery_lifecycle_review_queue_hold')) return 'delivery_lifecycle_review_queue_hold';
  if (blockers.includes('delivery_lifecycle_repair_replay_hold')) return 'delivery_lifecycle_repair_replay_hold';
  if (blockers.includes('delivery_lifecycle_schedule_mismatch')) return 'delivery_lifecycle_schedule_mismatch';
  if (blockers.includes('delivery_lifecycle_status_mismatch')) return 'delivery_lifecycle_status_mismatch';
  const taskStatus = canonicalDeliveryStatus(task || stop || {});
  if (isDeliveredStatus(taskStatus) || isDeliveredStatus(stop?.delivery_status)) return 'delivery_lifecycle_already_completed';
  if (!exactIdentityReady && stop?.hub_fallback_used === true) return 'delivery_lifecycle_hub_fallback_required';
  if (!exactIdentityReady) return 'delivery_lifecycle_native_read_partial';
  return 'delivery_lifecycle_native_read_ready';
}

function buildDeliveryLifecycleRow({ stop, orderIndexes, customerOrders, nativeOrders, tasks, reviewRows, orderSyncLogs, safeSyncParityLogs }) {
  const matchingOrders = findCustomerOrdersForStop(stop, orderIndexes);
  const order = matchingOrders.length === 1 ? matchingOrders[0] : null;
  const matchingNativeOrders = order
    ? findNativeOrdersForOrder(order, nativeOrders, stop)
    : findNativeOrdersForOrder(null, nativeOrders, stop);
  const nativeOrder = matchingNativeOrders.length === 1 ? matchingNativeOrders[0] : null;
  const matchingTasks = findTasksForContext({ order, nativeOrder, stop, tasks });
  const task = matchingTasks.length === 1 ? matchingTasks[0] : null;
  const mismatchCategories = [];
  const blockers = [];
  const warnings = [];

  if (matchingOrders.length === 0) blockers.push('delivery_lifecycle_order_chain_missing');
  if (matchingOrders.length > 1 || matchingNativeOrders.length > 1 || matchingTasks.length > 1) blockers.push('delivery_lifecycle_duplicate_identity_risk');
  if (matchingNativeOrders.length === 0) blockers.push('delivery_lifecycle_native_order_missing');
  if (matchingTasks.length === 0) blockers.push('delivery_lifecycle_task_missing');
  if (hasRefundCancelHold(order, nativeOrder, task, stop)) blockers.push('delivery_lifecycle_refund_cancel_hold');
  if (hasSubscriptionHold(order, nativeOrder, task, stop)) blockers.push('delivery_lifecycle_subscription_multi_delivery_hold');
  if (!paymentSafeForDelivery(order, nativeOrder, task)) blockers.push('delivery_lifecycle_payment_hold');

  const dates = scheduleDates(order, nativeOrder, task, stop);
  const scheduleMatch = dates.length <= 1;
  if (!scheduleMatch) {
    blockers.push('delivery_lifecycle_schedule_mismatch');
    mismatchCategories.push('delivery_schedule_mismatch');
  }
  if (statusMismatch(order, nativeOrder, task, stop)) {
    blockers.push('delivery_lifecycle_status_mismatch');
    mismatchCategories.push('delivery_status_mismatch');
  }
  if (hasReviewHold(order, stop, reviewRows)) blockers.push('delivery_lifecycle_review_queue_hold');
  if (hasRepairReplayHold(order, nativeOrder, stop, orderSyncLogs, safeSyncParityLogs)) blockers.push('delivery_lifecycle_repair_replay_hold');

  const exactIdentityReady = Boolean(order && nativeOrder && task && matchingOrders.length === 1 && matchingNativeOrders.length === 1 && matchingTasks.length === 1 && !blockers.length);
  const route = routeContext(task, stop);
  if (!route.driver_assignment_present) warnings.push('delivery_lifecycle_driver_assignment_missing');
  if (!route.route_context_present) warnings.push('delivery_lifecycle_route_context_missing');

  const classification = buildClassification({ exactIdentityReady, blockers, task, stop });
  const fallbackRequired = stop?.hub_fallback_used === true || blockers.length > 0 || !exactIdentityReady;
  const reviewRequired = blockers.length > 0 || warnings.includes('delivery_lifecycle_route_context_missing');

  return {
    canonical_order_ref: order?.id || stop?.customer_app_order_id || null,
    canonical_order_number: canonicalOrderNumber(order || stop) || null,
    native_shopify_order_present: Boolean(nativeOrder),
    fulfillment_task_ref: task?.id || stop?.task_id || null,
    exact_identity_ready: exactIdentityReady,
    fulfillment_type: task?.fulfillment_type || order?.fulfillment_type || nativeOrder?.fulfillment_method || stop?.fulfillment_type || null,
    canonical_delivery_date: canonicalDeliveryDateFor(order, nativeOrder, task, stop),
    task_delivery_date: normalizeDate(task?.delivery_date || task?.scheduled_date || stop?.delivery_date),
    schedule_match: scheduleMatch,
    delivery_status: visibleDeliveryStatus({ stop, task, nativeOrder, order }),
    fulfillment_status: stop?.task_status || stop?.fulfillment_status || task?.status || nativeOrder?.fulfillment_status || order?.fulfillment_status || null,
    production_status: visibleProductionStatus({ stop, task, nativeOrder, order }),
    payment_safe_for_delivery: paymentSafeForDelivery(order, nativeOrder, task),
    driver_assignment_present: route.driver_assignment_present,
    route_context_present: route.route_context_present,
    route_stop_present: route.route_stop_present,
    route_sequence_present: route.route_sequence_present,
    customer_tracker_mapping_safe: exactIdentityReady && !statusMismatch(order, nativeOrder, task, stop),
    native_read_ready: exactIdentityReady,
    fallback_required: fallbackRequired,
    review_required: reviewRequired,
    mismatch_categories: unique(mismatchCategories),
    blockers: unique(blockers),
    warnings: unique(warnings),
    classification,
  };
}

function summarizeRows(rows) {
  const count = predicate => rows.filter(predicate).length;
  return {
    delivery_task_count: rows.length,
    exact_order_chain_count: count(row => row.exact_identity_ready),
    assigned_count: count(row => row.driver_assignment_present),
    unassigned_count: count(row => !row.driver_assignment_present),
    route_linked_count: count(row => row.route_context_present),
    route_missing_count: count(row => !row.route_context_present),
    pending_count: count(row => ['pending', 'scheduled', 'assigned', 'packed', 'ready_for_delivery', null].includes(row.delivery_status)),
    out_for_delivery_count: count(row => row.delivery_status === 'out_for_delivery'),
    delivered_count: count(row => ['delivered', 'completed', 'fulfilled'].includes(row.delivery_status)),
    failed_or_exception_count: count(row => ['unable_to_deliver', 'failed', 'exception', 'cancelled', 'canceled'].includes(row.delivery_status)),
    schedule_mismatch_count: count(row => row.mismatch_categories.includes('delivery_schedule_mismatch')),
    status_mismatch_count: count(row => row.mismatch_categories.includes('delivery_status_mismatch')),
    duplicate_identity_count: count(row => row.blockers.includes('delivery_lifecycle_duplicate_identity_risk')),
    fallback_required_count: count(row => row.fallback_required),
    review_required_count: count(row => row.review_required),
  };
}

function classificationCounts(rows) {
  return rows.reduce((acc, row) => {
    acc[row.classification] = (acc[row.classification] || 0) + 1;
    return acc;
  }, {});
}

function buildDeliveryLifecycleReadModel({
  deliveryDate = null,
  routeSummaryRows = [],
  customerOrders = [],
  nativeOrders = [],
  fulfillmentTasks = [],
  reviewRows = [],
  orderSyncLogs = [],
  safeSyncParityLogs = [],
  sourceMode = 'native_first_with_hub_fallback',
} = {}) {
  const orderIndexes = makeOrderIndexes(customerOrders);
  const rows = (routeSummaryRows || []).map(stop => buildDeliveryLifecycleRow({
    stop,
    orderIndexes,
    customerOrders,
    nativeOrders,
    tasks: fulfillmentTasks,
    reviewRows,
    orderSyncLogs,
    safeSyncParityLogs,
  }));

  return {
    read_model_version: READ_MODEL_VERSION,
    read_model_available: true,
    read_model_enabled: true,
    source_mode: sourceMode,
    delivery_date: deliveryDate || null,
    summary: summarizeRows(rows),
    classification_counts: classificationCounts(rows),
    rows,
    driver_assignment_write_ready: false,
    route_mutation_ready: false,
    out_for_delivery_write_ready: false,
    delivered_write_ready: false,
    shopify_fulfillment_write_ready: false,
    notification_expansion_ready: false,
    customer_status_write_ready: false,
    hub_write_suppression_ready: false,
    writes_performed: false,
    provider_call_impact: false,
    notifications_sent: false,
    hub_mutation_performed: false,
  };
}

export { READ_MODEL_VERSION, buildDeliveryLifecycleReadModel };
