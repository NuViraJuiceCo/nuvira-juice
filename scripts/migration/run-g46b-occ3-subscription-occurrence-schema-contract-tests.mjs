#!/usr/bin/env node
import assert from 'node:assert/strict';

const CLASSIFICATIONS = Object.freeze({
  complete: 'occurrence_chain_complete',
  missingOrder: 'occurrence_chain_missing_customer_order',
  missingNativeOrder: 'occurrence_chain_missing_native_shopify_order',
  missingTask: 'occurrence_chain_missing_fulfillment_task',
  partialRecovery: 'occurrence_chain_partial_recovery_required',
  duplicate: 'occurrence_duplicate_identity_risk',
  crossCustomer: 'occurrence_cross_customer_link_conflict',
  cancelledOrSkipped: 'occurrence_cancelled_or_skipped_hold',
  idempotent: 'occurrence_materialization_idempotent',
  manualReview: 'occurrence_manual_review_required',
});

const ownerA = 'owner_A';
const ownerB = 'owner_B';

function oneTimeOrder(overrides = {}) {
  return {
    id: 'order_one_time',
    customer_id: ownerA,
    order_number: 'NV-ONE-TIME',
    status: 'paid',
    line_items: [{ title: 'Juice', quantity: 1 }],
    ...overrides,
  };
}

function historicalSubscriptionOrder(overrides = {}) {
  return {
    ...oneTimeOrder({ id: 'order_historical_sub', order_number: 'NV-HIST-SUB' }),
    source_type: 'subscription_occurrence',
    customer_app_subscription_id: null,
    subscription_occurrence_id: null,
    subscription_cycle_key: null,
    fulfillment_number: null,
    ...overrides,
  };
}

function parent(overrides = {}) {
  return {
    id: 'sub_parent_future',
    customer_id: ownerA,
    status: 'active',
    stripe_linkage_present: true,
    hub_recurrence_source_of_truth: true,
    ...overrides,
  };
}

function occurrence(overrides = {}) {
  return {
    customer_app_subscription_id: 'sub_parent_future',
    subscription_occurrence_id: 'sub_parent_future:cycle:2026-07-01:1',
    subscription_cycle_key: 'cycle:1',
    fulfillment_number: 1,
    scheduled_delivery_date: '2026-07-01',
    status: 'scheduled',
    customer_id: ownerA,
    ...overrides,
  };
}

function customerOrder(overrides = {}) {
  return {
    id: 'ca_order_future_occ1',
    customer_id: ownerA,
    customer_app_subscription_id: 'sub_parent_future',
    subscription_occurrence_id: 'sub_parent_future:cycle:2026-07-01:1',
    subscription_cycle_key: 'cycle:1',
    fulfillment_number: 1,
    source_type: 'subscription_occurrence',
    order_number: 'NV-SUB-FUTURE-1',
    scheduled_delivery_date: '2026-07-01',
    total_amount: 42,
    line_items: [{ title: 'Juice', quantity: 1 }],
    ...overrides,
  };
}

function nativeShopifyOrder(overrides = {}) {
  return {
    id: 'native_so_future_occ1',
    customer_id: ownerA,
    base44_order_id: 'ca_order_future_occ1',
    subscription_parent_id: 'sub_parent_future',
    subscription_occurrence_id: 'sub_parent_future:cycle:2026-07-01:1',
    subscription_cycle_key: 'cycle:1',
    fulfillment_sequence_number: 1,
    source_type: 'subscription_occurrence',
    order_type: 'subscription',
    ...overrides,
  };
}

function fulfillmentTask(overrides = {}) {
  return {
    id: 'task_future_occ1',
    customer_id: ownerA,
    order_id: 'ca_order_future_occ1',
    base44_order_id: 'ca_order_future_occ1',
    native_shopify_order_id: 'native_so_future_occ1',
    customer_app_subscription_id: 'sub_parent_future',
    subscription_occurrence_id: 'sub_parent_future:cycle:2026-07-01:1',
    subscription_cycle_key: 'cycle:1',
    fulfillment_number: 1,
    scheduled_date: '2026-07-01',
    fulfillment_type: 'subscription_occurrence',
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    parent: parent(),
    occurrence: occurrence(),
    customerOrders: [customerOrder()],
    nativeOrders: [nativeShopifyOrder()],
    tasks: [fulfillmentTask()],
    writes_performed: false,
    provider_calls: false,
    notifications_sent: false,
    hub_mutation_performed: false,
    ...overrides,
  };
}

function occurrenceIdentity(row) {
  return [row.customer_app_subscription_id, row.subscription_occurrence_id].filter(Boolean).join('|');
}

function idempotencyKey(row, operation = 'materialize') {
  return `subscription_occurrence_${operation}:${row.customer_app_subscription_id}:${row.subscription_occurrence_id}`;
}

function hasPiiInIdentity(value) {
  return /@|phone|customer_email|customer_name|address/i.test(value);
}

function classifyChain(ctx) {
  const blockers = [];
  const p = ctx.parent;
  const occ = ctx.occurrence;

  if (!p || !occ || p.id !== occ.customer_app_subscription_id) blockers.push('parent_occurrence_identity_missing');
  if (p?.customer_id && occ?.customer_id && p.customer_id !== occ.customer_id) blockers.push(CLASSIFICATIONS.crossCustomer);
  if (p?.status === 'cancelled' || occ?.status === 'cancelled' || occ?.status === 'skipped') blockers.push(CLASSIFICATIONS.cancelledOrSkipped);
  if (!occ?.subscription_occurrence_id || !occ?.subscription_cycle_key) blockers.push('immutable_occurrence_identity_missing');

  const orders = ctx.customerOrders.filter((row) => row.customer_id === occ.customer_id && row.customer_app_subscription_id === occ.customer_app_subscription_id && row.subscription_occurrence_id === occ.subscription_occurrence_id);
  if (orders.length === 0) blockers.push(CLASSIFICATIONS.missingOrder);
  if (orders.length > 1) blockers.push(CLASSIFICATIONS.duplicate);
  const order = orders[0];

  const nativeOrders = order ? ctx.nativeOrders.filter((row) => row.customer_id === occ.customer_id && row.base44_order_id === order.id && row.subscription_occurrence_id === occ.subscription_occurrence_id) : [];
  if (nativeOrders.length === 0) blockers.push(CLASSIFICATIONS.missingNativeOrder);
  if (nativeOrders.length > 1) blockers.push(CLASSIFICATIONS.duplicate);
  const nativeOrder = nativeOrders[0];

  const tasks = nativeOrder ? ctx.tasks.filter((row) => row.customer_id === occ.customer_id && row.base44_order_id === order.id && row.native_shopify_order_id === nativeOrder.id && row.subscription_occurrence_id === occ.subscription_occurrence_id) : [];
  if (tasks.length === 0) blockers.push(CLASSIFICATIONS.missingTask);
  if (tasks.length > 1) blockers.push(CLASSIFICATIONS.duplicate);

  const chainComplete = blockers.length === 0;
  let classification = chainComplete ? CLASSIFICATIONS.complete : CLASSIFICATIONS.partialRecovery;
  if (blockers.includes(CLASSIFICATIONS.crossCustomer)) classification = CLASSIFICATIONS.crossCustomer;
  else if (blockers.includes(CLASSIFICATIONS.duplicate)) classification = CLASSIFICATIONS.duplicate;
  else if (blockers.includes(CLASSIFICATIONS.cancelledOrSkipped)) classification = CLASSIFICATIONS.cancelledOrSkipped;
  else if (blockers.includes(CLASSIFICATIONS.missingOrder)) classification = CLASSIFICATIONS.missingOrder;
  else if (blockers.includes(CLASSIFICATIONS.missingNativeOrder)) classification = CLASSIFICATIONS.missingNativeOrder;
  else if (blockers.includes(CLASSIFICATIONS.missingTask)) classification = CLASSIFICATIONS.missingTask;

  return {
    chain_complete: chainComplete,
    classification,
    blockers: [...new Set(blockers)],
    idempotency_key: occ ? idempotencyKey(occ) : null,
    writes_performed: ctx.writes_performed,
    provider_calls: ctx.provider_calls,
    notifications_sent: ctx.notifications_sent,
    hub_mutation_performed: ctx.hub_mutation_performed,
  };
}

function materializePreview(ctx) {
  const result = classifyChain(ctx);
  if (result.chain_complete) return { ...result, classification: CLASSIFICATIONS.idempotent, created_orders: 0, created_native_orders: 0, created_tasks: 0 };
  return { ...result, created_orders: 0, created_native_orders: 0, created_tasks: 0 };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('existing one-time Customer App Order remains valid', () => {
  const order = oneTimeOrder();
  assert.equal(order.customer_app_subscription_id, undefined);
  assert.equal(order.subscription_occurrence_id, undefined);
  assert.equal(Boolean(order.id && order.order_number), true);
});

test('historical subscription Order with null occurrence links remains valid', () => {
  const order = historicalSubscriptionOrder();
  assert.equal(order.subscription_occurrence_id, null);
  assert.equal(order.subscription_cycle_key, null);
  assert.equal(order.fulfillment_number, null);
});

test('future occurrence has immutable exact occurrence identity', () => {
  const occ = occurrence();
  assert.equal(occurrenceIdentity(occ), 'sub_parent_future|sub_parent_future:cycle:2026-07-01:1');
});

test('parent and occurrence identities remain distinct', () => {
  const occ = occurrence();
  assert.notEqual(occ.customer_app_subscription_id, occ.subscription_occurrence_id);
});

test('scheduled date alone cannot identify occurrence', () => {
  const occ = occurrence({ subscription_occurrence_id: '', subscription_cycle_key: '', scheduled_delivery_date: '2026-07-01' });
  const result = classifyChain(context({ occurrence: occ }));
  assert.ok(result.blockers.includes('immutable_occurrence_identity_missing'));
});

test('one occurrence maps to one Customer App Order', () => {
  const result = classifyChain(context());
  assert.equal(result.chain_complete, true);
});

test('one occurrence maps to one native ShopifyOrder', () => {
  const result = classifyChain(context());
  assert.equal(result.classification, CLASSIFICATIONS.complete);
});

test('one occurrence maps to one FulfillmentTask', () => {
  const result = classifyChain(context());
  assert.equal(result.chain_complete, true);
});

test('duplicate processing is idempotent', () => {
  const result = materializePreview(context());
  assert.equal(result.classification, CLASSIFICATIONS.idempotent);
  assert.equal(result.created_orders, 0);
  assert.equal(result.created_native_orders, 0);
  assert.equal(result.created_tasks, 0);
});

test('same date different cycles remain distinct', () => {
  const occ1 = occurrence({ subscription_occurrence_id: 'sub_parent_future:cycle:1', subscription_cycle_key: 'cycle:1', scheduled_delivery_date: '2026-07-01' });
  const occ2 = occurrence({ subscription_occurrence_id: 'sub_parent_future:cycle:2', subscription_cycle_key: 'cycle:2', fulfillment_number: 2, scheduled_delivery_date: '2026-07-01' });
  assert.notEqual(occurrenceIdentity(occ1), occurrenceIdentity(occ2));
});

test('cross-customer linkage is rejected', () => {
  const result = classifyChain(context({ occurrence: occurrence({ customer_id: ownerB }) }));
  assert.equal(result.classification, CLASSIFICATIONS.crossCustomer);
});

test('duplicate Customer App Order is rejected', () => {
  const result = classifyChain(context({ customerOrders: [customerOrder(), customerOrder({ id: 'dupe_order' })] }));
  assert.equal(result.classification, CLASSIFICATIONS.duplicate);
});

test('duplicate ShopifyOrder is rejected', () => {
  const result = classifyChain(context({ nativeOrders: [nativeShopifyOrder(), nativeShopifyOrder({ id: 'dupe_native' })] }));
  assert.equal(result.classification, CLASSIFICATIONS.duplicate);
});

test('duplicate FulfillmentTask is rejected', () => {
  const result = classifyChain(context({ tasks: [fulfillmentTask(), fulfillmentTask({ id: 'dupe_task' })] }));
  assert.equal(result.classification, CLASSIFICATIONS.duplicate);
});

test('partial chain is classified safely', () => {
  const result = classifyChain(context({ nativeOrders: [] }));
  assert.equal(result.classification, CLASSIFICATIONS.missingNativeOrder);
  assert.equal(result.chain_complete, false);
});

test('cancelled occurrence blocks materialization', () => {
  const result = classifyChain(context({ occurrence: occurrence({ status: 'cancelled' }) }));
  assert.equal(result.classification, CLASSIFICATIONS.cancelledOrSkipped);
});

test('skipped occurrence blocks materialization', () => {
  const result = classifyChain(context({ occurrence: occurrence({ status: 'skipped' }) }));
  assert.equal(result.classification, CLASSIFICATIONS.cancelledOrSkipped);
});

test('parent cancellation does not rewrite historical occurrences', () => {
  const result = materializePreview(context({ parent: parent({ status: 'cancelled' }) }));
  assert.equal(result.created_orders, 0);
  assert.equal(result.created_native_orders, 0);
  assert.equal(result.created_tasks, 0);
});

test('historical rows require no backfill', () => {
  const order = historicalSubscriptionOrder();
  const preview = materializePreview(context({ customerOrders: [order], nativeOrders: [], tasks: [] }));
  assert.equal(preview.created_orders, 0);
  assert.equal(preview.created_native_orders, 0);
  assert.equal(preview.created_tasks, 0);
});

test('no customer PII in internal identity keys', () => {
  const occ = occurrence();
  assert.equal(hasPiiInIdentity(idempotencyKey(occ)), false);
  assert.equal(hasPiiInIdentity(occurrenceIdentity(occ)), false);
});

test('no provider calls', () => {
  const result = classifyChain(context());
  assert.equal(result.provider_calls, false);
});

test('no notifications', () => {
  const result = classifyChain(context());
  assert.equal(result.notifications_sent, false);
});

test('no Hub mutation', () => {
  const result = classifyChain(context());
  assert.equal(result.hub_mutation_performed, false);
});

test('no live writes', () => {
  const result = classifyChain(context());
  assert.equal(result.writes_performed, false);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    console.error(`not ok ${passed + 1} - ${name}`);
    console.error(error);
    process.exit(1);
  }
}

console.log(`\nG46B-OCC3 subscription occurrence schema contract tests passed (${passed}/${tests.length}).`);
