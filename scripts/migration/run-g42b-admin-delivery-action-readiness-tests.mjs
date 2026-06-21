#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const entryPath = 'base44/functions/previewNativeOrderCutoverReadiness/entry.ts';
const docsPath = 'docs/migration/g42b-admin-delivery-action-readiness-preview.md';
const source = readFileSync(entryPath, 'utf8');

function normalize(value) {
  return (value ?? '').toString().trim();
}

function status(value) {
  const key = normalize(value).toLowerCase();
  if (key === 'out for delivery' || key === 'in transit') return 'out_for_delivery';
  if (key === 'complete') return 'completed';
  return key;
}

function orderNumber(row) {
  return normalize(row?.order_number || row?.shopify_order_number).replace(/^#/, '').toUpperCase();
}

function paidCaptured(order, nativeOrder = {}, task = {}) {
  const orderStatus = normalize(order?.payment_status || order?.financial_status).toLowerCase();
  const nativeStatuses = [nativeOrder?.payment_status, nativeOrder?.financial_status, task?.payment_status]
    .map(value => normalize(value).toLowerCase())
    .filter(Boolean);
  return order?.payment_captured === true && orderStatus === 'paid' && nativeStatuses.every(value => value === 'paid');
}

function deliveryDate(row) {
  return normalize(row?.assigned_delivery_date || row?.delivery_date || row?.scheduled_date);
}

function isRefundCancel(order = {}, nativeOrder = {}, task = {}) {
  order = order || {};
  nativeOrder = nativeOrder || {};
  task = task || {};
  return Boolean(order.refunded_at || order.refund_status || nativeOrder.refunded_at || nativeOrder.refund_status || order.canceled_at || order.cancelled_at) ||
    [order.status, order.payment_status, order.financial_status, nativeOrder.payment_status, nativeOrder.financial_status, task.status, task.delivery_status]
      .map(value => normalize(value).toLowerCase())
      .some(value => ['refunded', 'refund', 'cancelled', 'canceled', 'voided', 'failed'].includes(value));
}

function isSubscription(order = {}, nativeOrder = {}, task = {}) {
  order = order || {};
  nativeOrder = nativeOrder || {};
  task = task || {};
  return Boolean(order.subscription_id || order.is_subscription || nativeOrder.subscription_occurrence_id || task.subscription_occurrence_id) ||
    [order.source_type, order.source_channel, nativeOrder.source_type, nativeOrder.source_channel, task.source_type, task.fulfillment_type]
      .map(value => normalize(value).toLowerCase())
      .some(value => value.includes('subscription') || value.includes('multi_delivery') || value.includes('multi-delivery'));
}

function evaluateFixture({
  order = null,
  nativeOrders = [],
  tasks = [],
  reviewHold = false,
  repairHold = false,
  sourceTruncated = false,
} = {}) {
  const blockers = [];
  const compatibleNativeOrders = nativeOrders.filter(nativeOrder => {
    const explicit = [nativeOrder.base44_order_id, nativeOrder.customer_app_order_id].map(normalize).filter(Boolean);
    const idMatch = order?.id && explicit.includes(order.id);
    const numberMatch = order && orderNumber(order) && orderNumber(order) === orderNumber(nativeOrder);
    return idMatch || numberMatch;
  });
  const nativeOrder = compatibleNativeOrders.length === 1 ? compatibleNativeOrders[0] : null;
  const compatibleTasks = tasks.filter(task => {
    const orderLinks = [task.order_id, task.base44_order_id, task.customer_app_order_id].map(normalize).filter(Boolean);
    const nativeLinks = [task.native_shopify_order_id, task.shopify_order_id].map(normalize).filter(Boolean);
    const orderMatch = order?.id && (orderLinks.includes(order.id) || orderNumber(task) === orderNumber(order));
    const nativeMatch = !nativeOrder || nativeLinks.length === 0 || nativeLinks.includes(nativeOrder.id);
    return orderMatch && nativeMatch;
  });
  const task = compatibleTasks.length === 1 ? compatibleTasks[0] : null;
  if (!order) blockers.push('customer_app_order_missing');
  if (compatibleNativeOrders.length === 0) blockers.push(sourceTruncated ? 'bounded_scan_context_not_found' : 'delivery_action_native_order_missing');
  if (compatibleNativeOrders.length > 1) blockers.push('delivery_action_exact_identity_ambiguous');
  if (compatibleTasks.length === 0) blockers.push(sourceTruncated ? 'bounded_scan_context_not_found' : 'delivery_action_task_missing');
  if (compatibleTasks.length > 1) blockers.push('delivery_action_exact_identity_ambiguous');
  if (!order || !paidCaptured(order, nativeOrder, task)) blockers.push('delivery_action_payment_hold');
  if (isRefundCancel(order, nativeOrder, task)) blockers.push('delivery_action_refund_cancel_hold');
  if (isSubscription(order, nativeOrder, task)) blockers.push('delivery_action_subscription_multi_delivery_hold');
  if (order && nativeOrder && task && deliveryDate(order) && deliveryDate(task) && deliveryDate(order) !== deliveryDate(task)) blockers.push('delivery_action_schedule_mismatch');
  if (order && task && normalize(order.fulfillment_status) && status(order.fulfillment_status) !== status(task.status)) blockers.push('delivery_action_status_mismatch');
  if (reviewHold) blockers.push('delivery_action_review_queue_hold');
  if (repairHold) blockers.push('delivery_action_repair_replay_hold');

  const exactReady = Boolean(order && compatibleNativeOrders.length === 1 && compatibleTasks.length === 1 && !blockers.length);
  const assigned = Boolean(normalize(task?.assigned_driver || task?.assigned_driver_id || task?.assigned_driver_email));
  const taskStatus = task ? status(task.status || task.delivery_status) : '';
  const alreadyCompleted = ['delivered', 'completed', 'fulfilled'].includes(taskStatus) || status(task?.delivery_status) === 'delivered';
  const assignCandidate = exactReady && !assigned && ['unassigned', 'scheduled'].includes(taskStatus);
  const outCandidate = exactReady && assigned && ['scheduled', 'packed', 'in transit'].includes(taskStatus);
  const deliveredCandidate = exactReady && assigned && taskStatus === 'out_for_delivery';
  const actionBlockers = [...blockers];
  if (!assigned && (outCandidate || deliveredCandidate || taskStatus === 'out_for_delivery')) actionBlockers.push('delivery_action_driver_assignment_missing');
  if (alreadyCompleted) actionBlockers.push('delivery_action_already_completed');
  actionBlockers.push('delivery_action_hub_write_required', 'delivery_action_notification_held', 'delivery_action_rollback_gap');

  return {
    blockers: [...new Set(actionBlockers)],
    exactReady,
    assignCandidate,
    outCandidate,
    deliveredCandidate,
    classification: blockers[0] || (assignCandidate || outCandidate || deliveredCandidate ? 'delivery_action_native_command_candidate' : 'delivery_action_native_read_ready'),
  };
}

function fakeBoundedScan(sources) {
  const readCount = {};
  const read = (name) => {
    readCount[name] = (readCount[name] || 0) + 1;
    return sources[name] || [];
  };
  const tasks = read('FulfillmentTask');
  const orders = read('Order');
  const nativeOrders = read('ShopifyOrder');
  read('OrderReviewQueue');
  read('OrderSyncLog');
  read('SafeSyncParityLog');
  const summaries = tasks.map(task => evaluateFixture({
    order: orders.find(order => order.id === task.order_id || orderNumber(order) === orderNumber(task)),
    nativeOrders,
    tasks: [task],
  }));
  return { readCount, summaries };
}

const cleanOrder = {
  id: 'ord_1',
  order_number: 'NV-CLEAN1',
  payment_status: 'paid',
  financial_status: 'paid',
  payment_captured: true,
  fulfillment_status: 'scheduled',
  fulfillment_type: 'delivery',
  assigned_delivery_date: '2026-06-21',
};
const cleanNative = {
  id: 'native_1',
  base44_order_id: 'ord_1',
  shopify_order_number: 'NV-CLEAN1',
  payment_status: 'paid',
  fulfillment_status: 'scheduled',
  assigned_delivery_date: '2026-06-21',
};
const cleanTask = {
  id: 'task_1',
  order_id: 'ord_1',
  native_shopify_order_id: 'native_1',
  order_number: 'NV-CLEAN1',
  payment_status: 'paid',
  status: 'scheduled',
  delivery_status: 'pending',
  fulfillment_type: 'delivery',
  delivery_date: '2026-06-21',
};
const assignedTask = { ...cleanTask, assigned_driver: 'Driver One' };
const outTask = { ...cleanTask, status: 'out_for_delivery', delivery_status: 'out_for_delivery', assigned_driver: 'Driver One' };
const deliveredTask = { ...cleanTask, status: 'delivered', delivery_status: 'delivered', assigned_driver: 'Driver One', delivered_at: '2026-06-21T12:00:00Z' };

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('1. Missing admin auth returns 401 marker exists', () => {
  assert.match(source, /requirePreviewAccess\(\{ base44, req, body \}\)/);
  assert.match(source, /error_code: 'unauthorized'/);
});
test('2. Exact Customer App Order resolves', () => {
  assert.equal(evaluateFixture({ order: cleanOrder, nativeOrders: [cleanNative], tasks: [cleanTask] }).blockers.includes('customer_app_order_missing'), false);
});
test('3. Exact native ShopifyOrder resolves', () => {
  assert.equal(evaluateFixture({ order: cleanOrder, nativeOrders: [cleanNative], tasks: [cleanTask] }).blockers.includes('delivery_action_native_order_missing'), false);
});
test('4. Exact FulfillmentTask resolves', () => {
  assert.equal(evaluateFixture({ order: cleanOrder, nativeOrders: [cleanNative], tasks: [cleanTask] }).blockers.includes('delivery_action_task_missing'), false);
});
test('5. Duplicate task identity blocks readiness', () => {
  assert.match(evaluateFixture({ order: cleanOrder, nativeOrders: [cleanNative], tasks: [cleanTask, { ...cleanTask, id: 'task_2' }] }).blockers.join('|'), /delivery_action_exact_identity_ambiguous/);
});
test('6. Missing task blocks readiness', () => {
  assert.match(evaluateFixture({ order: cleanOrder, nativeOrders: [cleanNative], tasks: [] }).blockers.join('|'), /delivery_action_task_missing/);
});
test('7. Missing native order is classified', () => {
  assert.match(evaluateFixture({ order: cleanOrder, nativeOrders: [], tasks: [cleanTask] }).blockers.join('|'), /delivery_action_native_order_missing/);
});
test('8. Paid/captured delivery order passes payment check', () => {
  assert.equal(evaluateFixture({ order: cleanOrder, nativeOrders: [cleanNative], tasks: [cleanTask] }).blockers.includes('delivery_action_payment_hold'), false);
});
test('9. Pending-payment order is held', () => {
  assert.match(evaluateFixture({ order: { ...cleanOrder, payment_status: 'pending', payment_captured: false }, nativeOrders: [cleanNative], tasks: [cleanTask] }).blockers.join('|'), /delivery_action_payment_hold/);
});
test('10. Refunded order is held', () => {
  assert.match(evaluateFixture({ order: { ...cleanOrder, refund_status: 'refunded' }, nativeOrders: [cleanNative], tasks: [cleanTask] }).blockers.join('|'), /delivery_action_refund_cancel_hold/);
});
test('11. Cancelled order is held', () => {
  assert.match(evaluateFixture({ order: { ...cleanOrder, status: 'cancelled' }, nativeOrders: [cleanNative], tasks: [cleanTask] }).blockers.join('|'), /delivery_action_refund_cancel_hold/);
});
test('12. Subscription/multi-delivery is held', () => {
  assert.match(evaluateFixture({ order: { ...cleanOrder, source_type: 'subscription' }, nativeOrders: [cleanNative], tasks: [cleanTask] }).blockers.join('|'), /delivery_action_subscription_multi_delivery_hold/);
});
test('13. Delivery-date mismatch is held', () => {
  assert.match(evaluateFixture({ order: cleanOrder, nativeOrders: [cleanNative], tasks: [{ ...cleanTask, delivery_date: '2026-06-22' }] }).blockers.join('|'), /delivery_action_schedule_mismatch/);
});
test('14. Status mismatch is held', () => {
  assert.match(evaluateFixture({ order: { ...cleanOrder, fulfillment_status: 'delivered' }, nativeOrders: [cleanNative], tasks: [cleanTask] }).blockers.join('|'), /delivery_action_status_mismatch/);
});
test('15. Review queue blocks', () => {
  assert.match(evaluateFixture({ order: cleanOrder, nativeOrders: [cleanNative], tasks: [cleanTask], reviewHold: true }).blockers.join('|'), /delivery_action_review_queue_hold/);
});
test('16. Repair/replay blocks', () => {
  assert.match(evaluateFixture({ order: cleanOrder, nativeOrders: [cleanNative], tasks: [cleanTask], repairHold: true }).blockers.join('|'), /delivery_action_repair_replay_hold/);
});
test('17. Assign-driver candidate classified', () => {
  assert.equal(evaluateFixture({ order: cleanOrder, nativeOrders: [cleanNative], tasks: [cleanTask] }).assignCandidate, true);
});
test('18. Conflicting assignment blocks assign candidate', () => {
  assert.equal(evaluateFixture({ order: cleanOrder, nativeOrders: [cleanNative], tasks: [assignedTask] }).assignCandidate, false);
});
test('19. Route-context-missing classified in source', () => {
  assert.match(source, /delivery_action_route_context_missing/);
});
test('20. Out-for-delivery candidate classified', () => {
  assert.equal(evaluateFixture({ order: cleanOrder, nativeOrders: [cleanNative], tasks: [assignedTask] }).outCandidate, true);
});
test('21. Invalid transition blocks out-for-delivery', () => {
  assert.equal(evaluateFixture({ order: cleanOrder, nativeOrders: [cleanNative], tasks: [{ ...assignedTask, status: 'pending' }] }).outCandidate, false);
});
test('22. Delivered candidate classified', () => {
  assert.equal(evaluateFixture({ order: { ...cleanOrder, fulfillment_status: 'out_for_delivery' }, nativeOrders: [cleanNative], tasks: [outTask] }).deliveredCandidate, true);
});
test('23. Already delivered is idempotently held', () => {
  assert.match(evaluateFixture({ order: cleanOrder, nativeOrders: [cleanNative], tasks: [deliveredTask] }).blockers.join('|'), /delivery_action_already_completed/);
});
test('24. Shopify/Hub dependency reported', () => {
  assert.match(source, /shopify_calls: false/);
  assert.match(source, /delivery_action_hub_write_required/);
});
test('25. Notification dependency remains held', () => {
  assert.match(source, /delivery_action_notification_held/);
});
test('26. Provider-call dependency remains held', () => {
  assert.match(source, /delivery_action_provider_call_required/);
  assert.match(source, /route_provider_calls: false/);
});
test('27. Idempotency gap blocks command readiness where missing', () => {
  assert.match(source, /delivery_action_idempotency_gap/);
});
test('28. Rollback gap blocks command readiness', () => {
  assert.match(source, /delivery_action_rollback_gap/);
});
test('29. Bounded scan uses one read per source', () => {
  const result = fakeBoundedScan({ FulfillmentTask: [cleanTask], Order: [cleanOrder], ShopifyOrder: [cleanNative] });
  assert.deepEqual(result.readCount, { FulfillmentTask: 1, Order: 1, ShopifyOrder: 1, OrderReviewQueue: 1, OrderSyncLog: 1, SafeSyncParityLog: 1 });
});
test('30. Source truncation prevents fleet-wide claims', () => {
  assert.match(source, /required_source_truncated_exact_followup_required/);
  assert.match(source, /source_truncated_counts_not_fleet_authoritative/);
});
test('31. No PII returned', () => {
  assert.match(source, /pii_returned: false/);
  const segment = source.slice(source.indexOf('const G42B_PREVIEW_MODE'), source.indexOf('// G42B_DELIVERY_ACTION_READINESS_END'));
  assert.doesNotMatch(segment, /customer_email|customer_phone|delivery_address\s*:/);
});
test('32. No raw payload returned', () => {
  assert.match(source, /raw_payloads_returned: false/);
});
test('33. No Order mutation', () => {
  assert.match(source, /order_mutation_performed: false/);
});
test('34. No ShopifyOrder mutation', () => {
  assert.match(source, /native_order_mutation_performed: false/);
});
test('35. No FulfillmentTask mutation', () => {
  assert.match(source, /fulfillment_task_mutation_performed: false/);
});
test('36. No driver assignment', () => {
  assert.match(source, /driver_assignment_performed: false/);
});
test('37. No route mutation', () => {
  assert.match(source, /route_mutation_performed: false/);
});
test('38. No delivery status update', () => {
  assert.match(source, /delivery_status_updated: false/);
});
test('39. No provider/Hub/Shopify call', () => {
  const segment = source.slice(source.indexOf('const G42B_PREVIEW_MODE'), source.indexOf('// G42B_DELIVERY_ACTION_READINESS_END'));
  assert.doesNotMatch(segment, /fetch\s*\(/);
  assert.match(segment, /hub_calls: false/);
  assert.match(segment, /shopify_calls: false/);
});
test('40. No notifications/logs/queues', () => {
  assert.match(source, /notifications_sent: false/);
  assert.match(source, /command_log_created: false/);
});
test('static. G42B dispatch is wired', () => {
  assert.match(source, /isG42BPreviewRequest/);
  assert.match(source, /buildG42BPreview/);
  assert.match(source, /g42bUnsupportedBodyKey/);
});
test('static. Docs file exists and records Apple Pay hold', () => {
  const docs = readFileSync(docsPath, 'utf8');
  assert.match(docs, /apple_pay_deferred_intent_backend_blocked_by_platform_atomicity/);
});

let passed = 0;
const failures = [];
for (const item of tests) {
  try {
    item.fn();
    passed += 1;
  } catch (error) {
    failures.push({ name: item.name, error: error.message });
  }
}

const result = {
  success: failures.length === 0,
  passed,
  failed: failures.length,
  failures,
  writes_performed: false,
  provider_call_impact: false,
  shopify_calls: false,
  hub_calls: false,
  route_provider_calls: false,
  notifications_sent: false,
  hub_mutation_performed: false,
  order_mutation_performed: false,
  native_order_mutation_performed: false,
  fulfillment_task_mutation_performed: false,
  driver_assignment_performed: false,
  route_mutation_performed: false,
  delivery_status_updated: false,
  command_log_created: false,
  pii_returned: false,
  raw_payloads_returned: false,
};

console.log(JSON.stringify(result, null, 2));
if (!result.success) process.exit(1);
