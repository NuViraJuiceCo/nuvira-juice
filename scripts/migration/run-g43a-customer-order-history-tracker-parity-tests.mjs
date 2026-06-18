#!/usr/bin/env node
import assert from 'node:assert/strict';

const CLASSIFICATIONS = Object.freeze({
  NATIVE_READY_ACTIVE: 'native_ready_one_time_active',
  NATIVE_READY_COMPLETED: 'native_ready_one_time_completed',
  NATIVE_BORN_ONE_TIME: 'native_born_one_time',
  HISTORICAL_LATE_MIRROR: 'historical_late_mirror',
  NATIVE_MISSING_HUB_AVAILABLE: 'native_missing_hub_available',
  HUB_MISSING_NATIVE_AVAILABLE: 'hub_missing_native_available',
  HUB_ONLY_VALID_ORDER: 'hub_only_valid_order',
  REFUND_PAYMENT_HOLD: 'refund_payment_hub_source_of_truth',
  CANCELLED_PAYMENT_RISK: 'cancelled_payment_risk',
  SUBSCRIPTION_HOLD: 'subscription_multi_delivery_hub_source_of_truth',
  DELIVERY_SCHEDULE_MISMATCH: 'delivery_schedule_mismatch',
  STATUS_MISMATCH: 'status_mismatch',
  PAYMENT_MISMATCH: 'payment_mismatch',
  FULFILLMENT_MISMATCH: 'fulfillment_mismatch',
  REVIEW_QUEUE_HOLD: 'review_queue_hold',
  REPAIR_REPLAY_HOLD: 'repair_replay_hold',
  UNKNOWN_REVIEW: 'unknown_manual_review_required',
});

const CUSTOMER_RESPONSE_KEYS = [
  'id',
  'order_number',
  'status',
  'fulfillment_type',
  'estimated_delivery_date',
  'assigned_delivery_date',
  'delivery_window_label',
  'items',
  'subtotal',
  'delivery_fee',
  'total',
  'created_date',
  'updated_date',
  'payment_status',
  'financial_status',
  'payment_captured',
  'is_hub_order',
  'is_local_fulfillment_expansion',
  'notes',
];

const WRITE_METHOD_PATTERNS = [
  /\.create\s*\(/,
  /\.update\s*\(/,
  /\.delete\s*\(/,
  /fetch\s*\(/,
  /base44\.functions\.invoke\s*\(/,
  /send[A-Z][A-Za-z]+Notification/,
  /stripe\./i,
  /shopify\./i,
  /syncOrderToHub\s*\(|pushOrderStatusToHub\s*\(|syncHubDeliveryStatuses\s*\(/i,
];

function clean(value) {
  return String(value || '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function normalizeOrderNumber(value) {
  return clean(value).replace(/^#/, '').toUpperCase();
}

function orderNumberFor(row) {
  return normalizeOrderNumber(
    row.customer_app_order?.order_number
    || row.native_shopify_order?.shopify_order_number
    || row.native_fulfillment_task?.order_number
    || row.hub_order?.order_number
    || row.hub_order?.shopify_order_number
    || row.order_number,
  );
}

function hasPaidCaptured(customerOrder, nativeOrder, hubOrder) {
  const paymentStatus = lower(customerOrder?.payment_status || nativeOrder?.payment_status || hubOrder?.payment_status || hubOrder?.financial_status);
  const financialStatus = lower(customerOrder?.financial_status || nativeOrder?.financial_status || hubOrder?.financial_status);
  return customerOrder?.payment_captured === true || paymentStatus === 'paid' || financialStatus === 'paid';
}

function isRefunded(customerOrder, nativeOrder, hubOrder) {
  return [
    customerOrder?.payment_status,
    customerOrder?.financial_status,
    customerOrder?.refund_status,
    nativeOrder?.payment_status,
    nativeOrder?.financial_status,
    nativeOrder?.refund_status,
    hubOrder?.payment_status,
    hubOrder?.financial_status,
    hubOrder?.refund_status,
    customerOrder?.status,
    nativeOrder?.production_status,
    hubOrder?.status,
    hubOrder?.production_status,
  ].some(value => /refund/.test(lower(value))) || Boolean(customerOrder?.refunded_at || nativeOrder?.refunded_at || hubOrder?.refunded_at);
}

function isCancelledOrFailed(customerOrder, nativeOrder, hubOrder) {
  return [
    customerOrder?.status,
    customerOrder?.payment_status,
    customerOrder?.financial_status,
    nativeOrder?.production_status,
    nativeOrder?.order_status,
    nativeOrder?.payment_status,
    hubOrder?.status,
    hubOrder?.production_status,
    hubOrder?.payment_status,
  ].some(value => ['cancelled', 'canceled', 'failed', 'voided'].includes(lower(value)));
}

function isSubscriptionOrMultiDelivery(customerOrder, nativeOrder, task, hubOrder) {
  const flags = [
    customerOrder?.order_type,
    customerOrder?.fulfillment_mode,
    customerOrder?.source_type,
    nativeOrder?.order_type,
    nativeOrder?.fulfillment_mode,
    nativeOrder?.source_type,
    task?.order_type,
    task?.fulfillment_type,
    task?.source_type,
    hubOrder?.order_type,
    hubOrder?.fulfillment_mode,
    hubOrder?.source_type,
  ].map(lower);
  return Boolean(
    customerOrder?.is_subscription
    || nativeOrder?.is_subscription
    || hubOrder?.is_subscription
    || flags.includes('subscription')
    || flags.includes('multi_delivery')
    || flags.includes('subscription_delivery')
  );
}

function statusProjection(customerOrder, nativeOrder, task, hubOrder) {
  return {
    customer: lower(customerOrder?.status || customerOrder?.production_status),
    native: lower(task?.delivery_status || task?.status || nativeOrder?.production_status || nativeOrder?.order_status),
    hub: lower(hubOrder?.status || hubOrder?.production_status || hubOrder?.fulfillment_status),
  };
}

function relevantStatus(value) {
  const map = {
    awaiting_production: 'scheduled_for_juicing',
    new: 'scheduled_for_juicing',
    pending: 'scheduled_for_juicing',
    production_scheduled: 'scheduled_for_juicing',
    scheduled: 'scheduled_for_juicing',
    fulfilled: 'delivered',
    bottled: 'bottled_packed',
    packed: 'bottled_packed',
    qc_checked: 'bottled_packed',
    assigned_for_delivery: 'out_for_delivery',
  };
  return map[value] || value || '';
}

function dateBucket(row) {
  const customer = row.customer_app_order;
  const native = row.native_shopify_order;
  const task = row.native_fulfillment_task;
  const hub = row.hub_order;
  return {
    customer: customer?.assigned_delivery_date || customer?.estimated_delivery_date || customer?.delivery_date || null,
    native: task?.delivery_date || task?.scheduled_date || task?.assigned_delivery_date || native?.assigned_delivery_date || native?.selected_delivery_date || native?.requested_delivery_date || null,
    hub: hub?.delivery_date || hub?.assigned_delivery_date || hub?.requested_delivery_date || null,
  };
}

function mismatchFields(row) {
  const customer = row.customer_app_order;
  const native = row.native_shopify_order;
  const task = row.native_fulfillment_task;
  const hub = row.hub_order;
  const mismatches = [];

  const statuses = statusProjection(customer, native, task, hub);
  const normalizedStatuses = Object.values(statuses).filter(Boolean).map(relevantStatus);
  if (new Set(normalizedStatuses).size > 1) mismatches.push('status');

  const paymentValues = [customer?.payment_status, native?.payment_status, hub?.payment_status, hub?.financial_status]
    .map(lower)
    .filter(Boolean);
  if (new Set(paymentValues).size > 1) mismatches.push('payment');

  const fulfillmentValues = [customer?.fulfillment_status, native?.fulfillment_status, task?.status, hub?.fulfillment_status]
    .map(relevantStatus)
    .filter(Boolean);
  if (fulfillmentValues.length > 1 && new Set(fulfillmentValues).size > 1) mismatches.push('fulfillment');

  const dates = Object.values(dateBucket(row)).filter(Boolean);
  if (dates.length > 1 && new Set(dates).size > 1) mismatches.push('delivery_schedule');

  return mismatches;
}

function hasReviewQueueHold(row) {
  return Boolean(row.review_queue?.some(entry => !['resolved', 'archived'].includes(lower(entry.status))));
}

function hasRepairReplayHold(row) {
  return Boolean(row.safe_sync_parity?.some(entry => ['mismatch', 'blocked', 'needs_manual_review'].includes(lower(entry.native_parity_status))))
    || Boolean(row.order_sync_logs?.some(entry => /repair|replay|retry|recovery/.test(lower(entry.sync_source || entry.triggered_by || entry.reason))));
}

function isHistoricalLateMirror(row) {
  return [
    row.native_shopify_order?.source_type,
    row.native_shopify_order?.sync_status,
    row.native_fulfillment_task?.task_source,
    row.native_fulfillment_task?.source_type,
    row.customer_app_order?.source_type,
  ].some(value => /historical|late|backfill|mirror/.test(lower(value))) && row.historical_late_mirror === true;
}

function classifyRow(row) {
  const orderNumber = orderNumberFor(row);
  const customerOrder = row.customer_app_order || null;
  const nativeOrder = row.native_shopify_order || null;
  const task = row.native_fulfillment_task || null;
  const hub = row.hub_order || null;
  const mismatch = mismatchFields(row);
  const blockers = [];
  const warnings = [];
  let classification = CLASSIFICATIONS.UNKNOWN_REVIEW;
  let sourceOfTruth = 'manual_review';
  let nativePrimaryEligible = false;
  let fallbackRequired = true;
  let customerFacingSafe = false;
  let reviewRequired = true;

  if (isSubscriptionOrMultiDelivery(customerOrder, nativeOrder, task, hub)) {
    classification = CLASSIFICATIONS.SUBSCRIPTION_HOLD;
    sourceOfTruth = 'hub_subscription_multi_delivery';
    blockers.push('subscription_multi_delivery_hub_source_of_truth');
  } else if (isRefunded(customerOrder, nativeOrder, hub)) {
    classification = CLASSIFICATIONS.REFUND_PAYMENT_HOLD;
    sourceOfTruth = 'hub_payment_refund';
    blockers.push('refund_payment_hub_source_of_truth');
  } else if (isCancelledOrFailed(customerOrder, nativeOrder, hub) || !hasPaidCaptured(customerOrder, nativeOrder, hub)) {
    classification = CLASSIFICATIONS.CANCELLED_PAYMENT_RISK;
    sourceOfTruth = 'hub_payment_cancelled_risk';
    blockers.push('cancelled_payment_risk_or_not_paid_captured');
  } else if (hasReviewQueueHold(row)) {
    classification = CLASSIFICATIONS.REVIEW_QUEUE_HOLD;
    sourceOfTruth = 'manual_review_queue';
    blockers.push('order_review_queue_hold');
  } else if (hasRepairReplayHold(row)) {
    classification = CLASSIFICATIONS.REPAIR_REPLAY_HOLD;
    sourceOfTruth = 'repair_replay_log_governed';
    blockers.push('repair_replay_hold');
  } else if (isHistoricalLateMirror(row)) {
    classification = CLASSIFICATIONS.HISTORICAL_LATE_MIRROR;
    sourceOfTruth = 'native_context_with_history_guard';
    blockers.push('historical_late_mirror_not_new_customer_activity');
    warnings.push('preserve_original_created_date_and_history_label');
  } else if (!customerOrder && hub && nativeOrder) {
    classification = CLASSIFICATIONS.NATIVE_MISSING_HUB_AVAILABLE;
    sourceOfTruth = 'hub_fallback';
    blockers.push('customer_app_order_missing');
  } else if (!customerOrder && hub && !nativeOrder) {
    classification = CLASSIFICATIONS.HUB_ONLY_VALID_ORDER;
    sourceOfTruth = 'hub_fallback';
    blockers.push('hub_only_valid_order_must_remain_visible');
  } else if (customerOrder && nativeOrder && !hub) {
    classification = CLASSIFICATIONS.HUB_MISSING_NATIVE_AVAILABLE;
    sourceOfTruth = 'native_with_hub_fallback_available';
    blockers.push('hub_context_missing_review_before_customer_cutover');
  } else if (mismatch.includes('delivery_schedule')) {
    classification = CLASSIFICATIONS.DELIVERY_SCHEDULE_MISMATCH;
    sourceOfTruth = 'hub_fallback_until_schedule_reconciled';
    blockers.push('delivery_schedule_mismatch');
  } else if (mismatch.includes('status')) {
    classification = CLASSIFICATIONS.STATUS_MISMATCH;
    sourceOfTruth = 'hub_fallback_until_status_reconciled';
    blockers.push('status_mismatch');
  } else if (mismatch.includes('payment')) {
    classification = CLASSIFICATIONS.PAYMENT_MISMATCH;
    sourceOfTruth = 'hub_payment';
    blockers.push('payment_mismatch');
  } else if (mismatch.includes('fulfillment')) {
    classification = CLASSIFICATIONS.FULFILLMENT_MISMATCH;
    sourceOfTruth = 'hub_fallback_until_fulfillment_reconciled';
    blockers.push('fulfillment_mismatch');
  } else if (customerOrder && nativeOrder && task) {
    const status = relevantStatus(lower(customerOrder.status || task.status || nativeOrder.production_status));
    classification = status === 'delivered' || status === 'picked_up'
      ? CLASSIFICATIONS.NATIVE_READY_COMPLETED
      : CLASSIFICATIONS.NATIVE_READY_ACTIVE;
    sourceOfTruth = 'native_one_time_with_hub_fallback';
    nativePrimaryEligible = true;
    fallbackRequired = false;
    customerFacingSafe = true;
    reviewRequired = false;
  } else if (customerOrder && nativeOrder) {
    classification = CLASSIFICATIONS.NATIVE_BORN_ONE_TIME;
    sourceOfTruth = 'native_one_time_needs_task_context_for_tracker';
    blockers.push('native_fulfillment_task_missing_for_operational_status');
  }

  if (!orderNumber) blockers.push('missing_order_number');

  return {
    order_number: orderNumber || null,
    customer_app_order_present: Boolean(customerOrder),
    native_shopify_order_present: Boolean(nativeOrder),
    native_fulfillment_task_present: Boolean(task),
    hub_context_present: Boolean(hub),
    order_classification: classification,
    mismatch_fields: mismatch,
    native_primary_eligible: nativePrimaryEligible,
    fallback_required: fallbackRequired,
    customer_facing_safe: customerFacingSafe,
    review_required: reviewRequired,
    source_of_truth: sourceOfTruth,
    blockers,
    warnings,
  };
}

function toCustomerCompatibleRow(row) {
  const source = row.customer_app_order || row.hub_order || row.native_shopify_order || {};
  const projected = {
    id: source.id || row.native_fulfillment_task?.id || orderNumberFor(row),
    order_number: orderNumberFor(row),
    status: source.status || (source.production_status ? relevantStatus(lower(source.production_status)) : undefined) || 'order_received',
    fulfillment_type: source.fulfillment_type || source.fulfillment_method || 'delivery',
    estimated_delivery_date: source.estimated_delivery_date || source.requested_delivery_date || row.native_fulfillment_task?.delivery_date || null,
    assigned_delivery_date: source.assigned_delivery_date || row.native_fulfillment_task?.assigned_delivery_date || null,
    delivery_window_label: source.delivery_window_label || source.requested_time_window || row.native_fulfillment_task?.delivery_window_label || null,
    items: source.items || source.line_items || row.native_fulfillment_task?.items || [],
    subtotal: source.subtotal || null,
    delivery_fee: source.delivery_fee || 0,
    total: source.total || source.total_price || row.native_fulfillment_task?.total_price || 0,
    created_date: source.created_date || null,
    updated_date: source.updated_date || null,
    payment_status: source.payment_status || source.financial_status || null,
    financial_status: source.financial_status || null,
    payment_captured: source.payment_captured === true,
    is_hub_order: Boolean(row.hub_order && !row.customer_app_order),
  };
  return Object.fromEntries(Object.entries(projected).filter(([key]) => CUSTOMER_RESPONSE_KEYS.includes(key)));
}

function buildPreview(rows) {
  const diagnostics = rows.map(classifyRow);
  const customerRows = rows.map(toCustomerCompatibleRow).filter(row => row.order_number);
  const hiddenValidOrders = diagnostics.filter(row => row.hub_context_present && !customerRows.some(customerRow => customerRow.order_number === row.order_number));
  const eligible = diagnostics.filter(row => row.native_primary_eligible);
  return {
    preview_mode: 'G43A_CUSTOMER_ORDER_HISTORY_TRACKER_PARITY',
    success: true,
    dry_run: true,
    writes_performed: false,
    provider_call_impact: false,
    notifications_sent: false,
    hub_mutation_performed: false,
    sync_repair_replay_performed: false,
    customer_behavior_changed: false,
    rows_scanned: rows.length,
    safe_native_first_subset_count: eligible.length,
    fallback_required_count: diagnostics.filter(row => row.fallback_required).length,
    review_required_count: diagnostics.filter(row => row.review_required).length,
    hidden_valid_order_count: hiddenValidOrders.length,
    classifications: diagnostics.reduce((acc, row) => {
      acc[row.order_classification] = (acc[row.order_classification] || 0) + 1;
      return acc;
    }, {}),
    diagnostics,
    customer_response_sample: customerRows,
  };
}

function caOrder(overrides = {}) {
  return {
    id: overrides.id || `ca_${overrides.order_number || 'order'}`,
    order_number: overrides.order_number || 'NV-G43A',
    status: overrides.status || 'scheduled_for_juicing',
    fulfillment_type: overrides.fulfillment_type || 'delivery',
    payment_status: overrides.payment_status || 'paid',
    financial_status: overrides.financial_status || 'paid',
    payment_captured: overrides.payment_captured ?? true,
    assigned_delivery_date: overrides.assigned_delivery_date || '2026-06-20',
    estimated_delivery_date: overrides.estimated_delivery_date || overrides.assigned_delivery_date || '2026-06-20',
    created_date: overrides.created_date || '2026-06-17T12:00:00.000Z',
    items: overrides.items || [{ title: 'Hydration Shot', quantity: 3, price: 5 }],
    total: overrides.total || 15,
    ...overrides,
  };
}

function nativeOrder(overrides = {}) {
  return {
    id: overrides.id || `native_${overrides.shopify_order_number || overrides.order_number || 'order'}`,
    shopify_order_number: overrides.shopify_order_number || overrides.order_number || 'NV-G43A',
    base44_order_id: overrides.base44_order_id || 'ca_order',
    order_type: overrides.order_type || 'one_time',
    fulfillment_mode: overrides.fulfillment_mode || 'single_delivery',
    production_status: overrides.production_status || 'awaiting_production',
    payment_status: overrides.payment_status || 'paid',
    financial_status: overrides.financial_status || 'paid',
    fulfillment_status: overrides.fulfillment_status || 'pending',
    assigned_delivery_date: overrides.assigned_delivery_date || '2026-06-20',
    requested_delivery_date: overrides.requested_delivery_date || overrides.assigned_delivery_date || '2026-06-20',
    line_items: overrides.line_items || [{ title: 'Hydration Shot', quantity: 3, price: 5 }],
    total_price: overrides.total_price || 15,
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    id: overrides.id || `task_${overrides.order_number || 'order'}`,
    order_number: overrides.order_number || 'NV-G43A',
    base44_order_id: overrides.base44_order_id || 'ca_order',
    native_shopify_order_id: overrides.native_shopify_order_id || 'native_order',
    order_type: overrides.order_type || 'one_time',
    status: overrides.status || 'pending',
    delivery_status: overrides.delivery_status || 'pending',
    production_status: overrides.production_status || 'awaiting_production',
    payment_status: overrides.payment_status || 'paid',
    delivery_date: overrides.delivery_date || '2026-06-20',
    assigned_delivery_date: overrides.assigned_delivery_date || overrides.delivery_date || '2026-06-20',
    ...overrides,
  };
}

function hubOrder(overrides = {}) {
  return {
    id: overrides.id || `hub_${overrides.order_number || 'order'}`,
    order_number: overrides.order_number || overrides.shopify_order_number || 'NV-G43A',
    shopify_order_number: overrides.shopify_order_number || overrides.order_number || 'NV-G43A',
    status: overrides.status || 'scheduled_for_juicing',
    production_status: overrides.production_status || 'awaiting_production',
    fulfillment_status: overrides.fulfillment_status || 'pending',
    payment_status: overrides.payment_status || 'paid',
    financial_status: overrides.financial_status || 'paid',
    requested_delivery_date: overrides.requested_delivery_date || '2026-06-20',
    line_items: overrides.line_items || [{ title: 'Hydration Shot', quantity: 3, price: 5 }],
    total_price: overrides.total_price || 15,
    ...overrides,
  };
}

function row(overrides = {}) {
  const order_number = overrides.order_number || 'NV-G43A';
  return {
    order_number,
    customer_app_order: overrides.customer_app_order === null ? null : caOrder({ order_number, ...(overrides.customer_app_order || {}) }),
    native_shopify_order: overrides.native_shopify_order === null ? null : nativeOrder({ order_number, ...(overrides.native_shopify_order || {}) }),
    native_fulfillment_task: overrides.native_fulfillment_task === null ? null : task({ order_number, ...(overrides.native_fulfillment_task || {}) }),
    hub_order: overrides.hub_order === null ? null : hubOrder({ order_number, ...(overrides.hub_order || {}) }),
    review_queue: overrides.review_queue || [],
    order_sync_logs: overrides.order_sync_logs || [],
    safe_sync_parity: overrides.safe_sync_parity || [],
    historical_late_mirror: overrides.historical_late_mirror || false,
  };
}

const fixtures = {
  activePilot: row({
    order_number: 'NV-MQHJR3V2',
    customer_app_order: { id: '6a321cbfd8d78863f15de956', status: 'scheduled_for_juicing', assigned_delivery_date: '2026-06-20' },
    native_shopify_order: { id: '6a321d38a3819cdd5cf89031', shopify_order_number: 'NV-MQHJR3V2', production_status: 'awaiting_production', assigned_delivery_date: '2026-06-20' },
    native_fulfillment_task: { id: '6a321d38071327f8218b958b', order_number: 'NV-MQHJR3V2', delivery_status: 'pending', production_status: 'awaiting_production', delivery_date: '2026-06-20' },
    hub_order: { order_number: 'NV-MQHJR3V2', production_status: 'awaiting_production', requested_delivery_date: '2026-06-20' },
  }),
  completedControlled: row({
    order_number: 'NV-MPZNKGNT',
    customer_app_order: { status: 'delivered', fulfillment_status: 'delivered', assigned_delivery_date: '2026-06-06' },
    native_shopify_order: { production_status: 'fulfilled', fulfillment_status: 'delivered', assigned_delivery_date: '2026-06-06' },
    native_fulfillment_task: { status: 'delivered', delivery_status: 'delivered', delivery_date: '2026-06-06' },
    hub_order: { status: 'delivered', production_status: 'fulfilled', fulfillment_status: 'delivered', requested_delivery_date: '2026-06-06' },
  }),
  historicalLateMirror: row({
    order_number: 'NV-MP5SOQLJ',
    customer_app_order: { created_date: '2026-05-15T14:00:00.000Z', status: 'delivered', assigned_delivery_date: '2026-05-16', source_type: 'hub_historical_late_mirror' },
    native_shopify_order: { source_type: 'hub_historical_backfill', sync_status: 'late_mirror', production_status: 'fulfilled', assigned_delivery_date: '2026-05-16' },
    native_fulfillment_task: { task_source: 'historical_late_task_mirror', status: 'delivered', delivery_status: 'delivered', delivery_date: '2026-05-16' },
    hub_order: { production_status: 'fulfilled', fulfillment_status: 'delivered', requested_delivery_date: '2026-05-16' },
    historical_late_mirror: true,
  }),
  nativeMissingHubAvailable: row({ order_number: 'NV-HUBCTX', customer_app_order: null }),
  hubOnlyValid: row({ order_number: 'NV-HUBONLY', customer_app_order: null, native_shopify_order: null, native_fulfillment_task: null }),
  refundHold: row({
    order_number: 'NV-MOVOAMIF',
    customer_app_order: { status: 'refunded', payment_status: 'refunded', financial_status: 'refunded', refund_status: 'fully_refunded', refunded_at: '2026-05-07T16:18:57.862Z' },
    native_shopify_order: { production_status: 'refunded', payment_status: 'refunded', refund_status: 'fully_refunded' },
    hub_order: { status: 'refunded', payment_status: 'refunded', refund_status: 'fully_refunded' },
  }),
  cancelledRisk: row({
    order_number: 'NV-CANCELLED',
    customer_app_order: { status: 'cancelled', payment_status: 'pending', financial_status: 'pending', payment_captured: false },
    native_shopify_order: { production_status: 'canceled', payment_status: 'pending' },
    native_fulfillment_task: { status: 'cancelled', delivery_status: 'cancelled', payment_status: 'pending' },
    hub_order: { status: 'canceled', payment_status: 'pending' },
  }),
  subscriptionHold: row({
    order_number: 'NV-SUB-001',
    customer_app_order: { order_type: 'subscription', source_type: 'subscription', is_subscription: true },
    native_shopify_order: { order_type: 'subscription', fulfillment_mode: 'multi_delivery', is_subscription: true },
    native_fulfillment_task: { order_type: 'subscription', fulfillment_type: 'subscription_delivery' },
    hub_order: { order_type: 'subscription', fulfillment_mode: 'multi_delivery', is_subscription: true },
  }),
  deliveryMismatch: row({ order_number: 'NV-DATEMIS', customer_app_order: { assigned_delivery_date: '2026-06-20' }, native_fulfillment_task: { delivery_date: '2026-06-21' }, hub_order: { requested_delivery_date: '2026-06-20' } }),
  statusMismatch: row({ order_number: 'NV-STATUSMIS', customer_app_order: { status: 'scheduled_for_juicing' }, native_fulfillment_task: { status: 'out_for_delivery', delivery_status: 'out_for_delivery' }, hub_order: { production_status: 'awaiting_production' } }),
  paymentMismatch: row({ order_number: 'NV-PAYMIS', customer_app_order: { payment_status: 'paid' }, native_shopify_order: { payment_status: 'pending' } }),
  fulfillmentMismatch: row({ order_number: 'NV-FULMIS', customer_app_order: { fulfillment_status: 'pending_production' }, native_shopify_order: { fulfillment_status: 'fulfilled' }, native_fulfillment_task: { status: 'pending' } }),
  reviewHold: row({ order_number: 'NV-REVIEW', review_queue: [{ id: 'review_safe_fixture', status: 'pending', incident_type: 'low_quality_new_order' }] }),
  repairHold: row({ order_number: 'NV-REPAIR', safe_sync_parity: [{ id: 'parity_safe_fixture', native_parity_status: 'needs_manual_review' }] }),
};

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function assertClass(fixture, expected) {
  assert.equal(classifyRow(fixture).order_classification, expected);
}

test('clean active one-time native row is eligible', () => {
  const result = classifyRow(fixtures.activePilot);
  assert.equal(result.order_number, 'NV-MQHJR3V2');
  assert.equal(result.order_classification, CLASSIFICATIONS.NATIVE_READY_ACTIVE);
  assert.equal(result.native_primary_eligible, true);
  assert.equal(result.customer_facing_safe, true);
});

test('clean delivered one-time native row is eligible completed', () => {
  assertClass(fixtures.completedControlled, CLASSIFICATIONS.NATIVE_READY_COMPLETED);
});

test('historical late mirror is classified and not new customer activity', () => {
  const result = classifyRow(fixtures.historicalLateMirror);
  assert.equal(result.order_classification, CLASSIFICATIONS.HISTORICAL_LATE_MIRROR);
  assert.equal(result.native_primary_eligible, false);
  assert.ok(result.blockers.includes('historical_late_mirror_not_new_customer_activity'));
});

test('native missing with Hub available falls back', () => {
  assertClass(fixtures.nativeMissingHubAvailable, CLASSIFICATIONS.NATIVE_MISSING_HUB_AVAILABLE);
});

test('Hub-only valid order is retained', () => {
  assertClass(fixtures.hubOnlyValid, CLASSIFICATIONS.HUB_ONLY_VALID_ORDER);
});

test('refund remains Hub/payment source of truth', () => {
  assertClass(fixtures.refundHold, CLASSIFICATIONS.REFUND_PAYMENT_HOLD);
});

test('cancelled/payment-risk remains held', () => {
  assertClass(fixtures.cancelledRisk, CLASSIFICATIONS.CANCELLED_PAYMENT_RISK);
});

test('subscription remains Hub source of truth', () => {
  assertClass(fixtures.subscriptionHold, CLASSIFICATIONS.SUBSCRIPTION_HOLD);
});

test('delivery schedule mismatch holds native-first', () => {
  assertClass(fixtures.deliveryMismatch, CLASSIFICATIONS.DELIVERY_SCHEDULE_MISMATCH);
});

test('status mismatch holds native-first', () => {
  assertClass(fixtures.statusMismatch, CLASSIFICATIONS.STATUS_MISMATCH);
});

test('payment mismatch holds native-first', () => {
  assertClass(fixtures.paymentMismatch, CLASSIFICATIONS.PAYMENT_MISMATCH);
});

test('fulfillment mismatch holds native-first', () => {
  assertClass(fixtures.fulfillmentMismatch, CLASSIFICATIONS.FULFILLMENT_MISMATCH);
});

test('review queue hold blocks native-first', () => {
  assertClass(fixtures.reviewHold, CLASSIFICATIONS.REVIEW_QUEUE_HOLD);
});

test('repair/replay hold blocks native-first', () => {
  assertClass(fixtures.repairHold, CLASSIFICATIONS.REPAIR_REPLAY_HOLD);
});

test('no valid order is hidden', () => {
  const preview = buildPreview(Object.values(fixtures));
  assert.equal(preview.hidden_valid_order_count, 0);
  assert.equal(preview.customer_response_sample.length, Object.values(fixtures).length);
});

test('response shape remains customer-compatible', () => {
  const preview = buildPreview([fixtures.activePilot]);
  const row = preview.customer_response_sample[0];
  assert.deepEqual(Object.keys(row).filter(key => !CUSTOMER_RESPONSE_KEYS.includes(key)), []);
});

test('debug metadata is not exposed to customer response sample', () => {
  const preview = buildPreview(Object.values(fixtures));
  assert.equal(JSON.stringify(preview.customer_response_sample).includes('diagnostics'), false);
  assert.equal(JSON.stringify(preview.customer_response_sample).includes('debug_lookup_path'), false);
  assert.equal(JSON.stringify(preview.customer_response_sample).includes('source_of_truth'), false);
});

test('no new PII is exposed in diagnostics', () => {
  const preview = buildPreview(Object.values(fixtures));
  const serialized = JSON.stringify(preview.diagnostics);
  assert.equal(/customer_email|customer_phone|address_line|delivery_address|@/.test(serialized), false);
});

test('no raw payload is exposed', () => {
  const preview = buildPreview(Object.values(fixtures));
  const serialized = JSON.stringify(preview);
  assert.equal(/raw_payload|shopify_raw_payload|stripe_raw|provider_payload|incoming_payload/.test(serialized), false);
});

test('preview reports no writes', () => {
  assert.equal(buildPreview(Object.values(fixtures)).writes_performed, false);
});

test('preview reports no provider calls', () => {
  assert.equal(buildPreview(Object.values(fixtures)).provider_call_impact, false);
});

test('preview reports no notifications', () => {
  assert.equal(buildPreview(Object.values(fixtures)).notifications_sent, false);
});

test('preview reports no Hub mutation', () => {
  assert.equal(buildPreview(Object.values(fixtures)).hub_mutation_performed, false);
});

test('script source contains no write/provider/action calls', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL(import.meta.url), 'utf8'));
  for (const pattern of WRITE_METHOD_PATTERNS) {
    assert.equal(pattern.test(source.replace(/const WRITE_METHOD_PATTERNS[\s\S]*?\];/, '')), false, `unexpected pattern ${pattern}`);
  }
});

let failures = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

if (failures > 0) {
  console.error(`G43A customer order history/tracker parity tests failed: ${failures}`);
  process.exit(1);
}

const preview = buildPreview(Object.values(fixtures));
console.log(JSON.stringify({
  suite: 'g43a-customer-order-history-tracker-parity',
  tests: tests.length,
  safe_native_first_subset_count: preview.safe_native_first_subset_count,
  fallback_required_count: preview.fallback_required_count,
  review_required_count: preview.review_required_count,
  classifications: preview.classifications,
}, null, 2));
console.log('G43A customer order history/tracker parity tests passed');
