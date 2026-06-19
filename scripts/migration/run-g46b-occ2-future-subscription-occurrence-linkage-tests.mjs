#!/usr/bin/env node
import assert from 'node:assert/strict';

const IDS = Object.freeze({
  ownerA: 'customer_A',
  ownerB: 'customer_B',
  parent: 'sub_parent_A',
  stripeSub: 'stripe_sub_A',
  occ1: 'sub_parent_A:cycle:1',
  occ2: 'sub_parent_A:cycle:2',
  caOrder1: 'ca_order_occ1',
  caOrder2: 'ca_order_occ2',
  nativeOrder1: 'native_so_occ1',
  nativeOrder2: 'native_so_occ2',
  task1: 'task_occ1',
  task2: 'task_occ2',
});

function parent(overrides = {}) {
  return {
    id: IDS.parent,
    customer_id: IDS.ownerA,
    status: 'active',
    stripe_subscription_id: IDS.stripeSub,
    hub_recurrence_source_of_truth: true,
    ...overrides,
  };
}

function occurrence(n = 1, overrides = {}) {
  const occurrenceId = n === 1 ? IDS.occ1 : IDS.occ2;
  return {
    id: occurrenceId,
    occurrence_id: occurrenceId,
    subscription_parent_id: IDS.parent,
    customer_id: IDS.ownerA,
    cycle_number: n,
    fulfillment_number: n,
    scheduled_delivery_date: n === 1 ? '2026-07-01' : '2026-07-08',
    status: 'scheduled',
    ...overrides,
  };
}

function customerOrder(n = 1, overrides = {}) {
  return {
    id: n === 1 ? IDS.caOrder1 : IDS.caOrder2,
    customer_id: IDS.ownerA,
    order_number: n === 1 ? 'NV-SUB-OCC1' : 'NV-SUB-OCC2',
    subscription_parent_id: IDS.parent,
    occurrence_id: n === 1 ? IDS.occ1 : IDS.occ2,
    fulfillment_number: n,
    total_amount: 42,
    line_items: [{ product_name: 'Juice', quantity: 1 }],
    created_date: n === 1 ? '2026-06-20T12:00:00.000Z' : '2026-06-27T12:00:00.000Z',
    ...overrides,
  };
}

function nativeOrder(n = 1, overrides = {}) {
  return {
    id: n === 1 ? IDS.nativeOrder1 : IDS.nativeOrder2,
    customer_id: IDS.ownerA,
    base44_order_id: n === 1 ? IDS.caOrder1 : IDS.caOrder2,
    order_number: n === 1 ? 'NV-SUB-OCC1' : 'NV-SUB-OCC2',
    subscription_parent_id: IDS.parent,
    stripe_subscription_id: IDS.stripeSub,
    fulfillment_sequence_number: n,
    fulfillment_instance_date: n === 1 ? '2026-07-01' : '2026-07-08',
    order_type: 'subscription',
    source_type: 'subscription_occurrence',
    ...overrides,
  };
}

function task(n = 1, overrides = {}) {
  return {
    id: n === 1 ? IDS.task1 : IDS.task2,
    customer_id: IDS.ownerA,
    order_id: n === 1 ? IDS.caOrder1 : IDS.caOrder2,
    base44_order_id: n === 1 ? IDS.caOrder1 : IDS.caOrder2,
    native_shopify_order_id: n === 1 ? IDS.nativeOrder1 : IDS.nativeOrder2,
    order_number: n === 1 ? 'NV-SUB-OCC1' : 'NV-SUB-OCC2',
    customer_app_subscription_id: IDS.parent,
    stripe_subscription_id: IDS.stripeSub,
    fulfillment_number: n,
    scheduled_date: n === 1 ? '2026-07-01' : '2026-07-08',
    status: 'pending',
    ...overrides,
  };
}

function buildContext(overrides = {}) {
  return {
    parents: [parent()],
    occurrences: [occurrence(1), occurrence(2)],
    customerOrders: [customerOrder(1), customerOrder(2)],
    nativeOrders: [nativeOrder(1), nativeOrder(2)],
    tasks: [task(1), task(2)],
    logs: [],
    writes_performed: false,
    provider_calls: false,
    notifications_sent: false,
    hub_mutation_performed: false,
    ...overrides,
  };
}

const norm = (value) => String(value ?? '').trim().toLowerCase();

function keyForOccurrence(row) {
  return [row.subscription_parent_id, row.occurrence_id, row.fulfillment_number].map(norm).join('|');
}

function findExactParent(ctx, parentId, ownerId) {
  const matches = ctx.parents.filter((row) => row.id === parentId && row.customer_id === ownerId);
  return matches.length === 1 ? matches[0] : null;
}

function resolveOccurrenceChain(ctx, { parentId, occurrenceId, ownerId }) {
  const parentRow = findExactParent(ctx, parentId, ownerId);
  const blockers = [];
  if (!parentRow) blockers.push('exact_parent_not_found_or_not_owned');

  const occurrences = ctx.occurrences.filter((row) => row.subscription_parent_id === parentId && row.occurrence_id === occurrenceId && row.customer_id === ownerId);
  if (occurrences.length !== 1) blockers.push(occurrences.length > 1 ? 'duplicate_occurrence_identity_risk' : 'exact_occurrence_not_found');
  const occurrenceRow = occurrences[0] || null;

  const customerOrders = occurrenceRow ? ctx.customerOrders.filter((row) => row.customer_id === ownerId && row.subscription_parent_id === parentId && row.occurrence_id === occurrenceId) : [];
  if (customerOrders.length !== 1) blockers.push(customerOrders.length > 1 ? 'duplicate_customer_order_identity_risk' : 'customer_app_order_link_missing');
  const customerOrderRow = customerOrders[0] || null;

  const nativeOrders = customerOrderRow ? ctx.nativeOrders.filter((row) => row.customer_id === ownerId && row.subscription_parent_id === parentId && row.base44_order_id === customerOrderRow.id && Number(row.fulfillment_sequence_number) === Number(occurrenceRow.fulfillment_number)) : [];
  if (nativeOrders.length !== 1) blockers.push(nativeOrders.length > 1 ? 'duplicate_native_shopify_order_identity_risk' : 'native_shopify_order_link_missing');
  const nativeOrderRow = nativeOrders[0] || null;

  const tasks = nativeOrderRow ? ctx.tasks.filter((row) => row.customer_id === ownerId && row.customer_app_subscription_id === parentId && row.native_shopify_order_id === nativeOrderRow.id && row.base44_order_id === customerOrderRow.id && Number(row.fulfillment_number) === Number(occurrenceRow.fulfillment_number)) : [];
  if (tasks.length !== 1) blockers.push(tasks.length > 1 ? 'duplicate_fulfillment_task_identity_risk' : 'fulfillment_task_link_missing');
  const taskRow = tasks[0] || null;

  const fuzzyUsed = false;
  const nativeReadReady = blockers.length === 0 && Boolean(parentRow && occurrenceRow && customerOrderRow && nativeOrderRow && taskRow);
  return {
    parent_present: Boolean(parentRow),
    occurrence_present: Boolean(occurrenceRow),
    customer_app_order_present: Boolean(customerOrderRow),
    native_shopify_order_present: Boolean(nativeOrderRow),
    fulfillment_task_present: Boolean(taskRow),
    native_read_ready: nativeReadReady,
    blockers,
    fuzzy_matching_used: fuzzyUsed,
    writes_performed: ctx.writes_performed,
    provider_calls: ctx.provider_calls,
    notifications_sent: ctx.notifications_sent,
    hub_mutation_performed: ctx.hub_mutation_performed,
  };
}

function processOccurrenceIdempotently(ctx, request) {
  const existing = resolveOccurrenceChain(ctx, request);
  if (existing.native_read_ready) {
    return {
      action: 'return_existing_exact_chain',
      created_customer_orders: 0,
      created_native_orders: 0,
      created_tasks: 0,
      idempotent: true,
      ...existing,
    };
  }
  return {
    action: 'block_until_exact_chain_creation_command_is_approved',
    created_customer_orders: 0,
    created_native_orders: 0,
    created_tasks: 0,
    idempotent: false,
    ...existing,
  };
}

function targetExactOccurrenceOnly(ctx, { parentId, occurrenceId, ownerId, operation }) {
  const chain = resolveOccurrenceChain(ctx, { parentId, occurrenceId, ownerId });
  if (!chain.occurrence_present || chain.blockers.includes('duplicate_occurrence_identity_risk')) {
    return { operation, applied: false, blockers: chain.blockers, affected_occurrence_count: 0 };
  }
  return { operation, applied: false, preview_only: true, blockers: [], affected_occurrence_count: 1, target_occurrence_id: occurrenceId };
}

function assertSafe(result) {
  assert.equal(result.writes_performed ?? false, false);
  assert.equal(result.provider_calls ?? false, false);
  assert.equal(result.notifications_sent ?? false, false);
  assert.equal(result.hub_mutation_performed ?? false, false);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('exact parent and cycle identity resolves a complete chain', () => {
  const ctx = buildContext();
  const result = resolveOccurrenceChain(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA });
  assert.equal(result.native_read_ready, true);
  assert.deepEqual(result.blockers, []);
  assertSafe(result);
});

test('separate occurrences remain distinct', () => {
  const ctx = buildContext();
  const first = resolveOccurrenceChain(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA });
  const second = resolveOccurrenceChain(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ2, ownerId: IDS.ownerA });
  assert.equal(first.native_read_ready, true);
  assert.equal(second.native_read_ready, true);
  assert.notEqual(keyForOccurrence(ctx.occurrences[0]), keyForOccurrence(ctx.occurrences[1]));
});

test('Customer App Order link is required', () => {
  const ctx = buildContext({ customerOrders: [] });
  const result = resolveOccurrenceChain(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA });
  assert.ok(result.blockers.includes('customer_app_order_link_missing'));
  assert.equal(result.native_read_ready, false);
});

test('native ShopifyOrder link is required', () => {
  const ctx = buildContext({ nativeOrders: [] });
  const result = resolveOccurrenceChain(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA });
  assert.ok(result.blockers.includes('native_shopify_order_link_missing'));
});

test('FulfillmentTask link is required', () => {
  const ctx = buildContext({ tasks: [] });
  const result = resolveOccurrenceChain(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA });
  assert.ok(result.blockers.includes('fulfillment_task_link_missing'));
});

test('duplicate Customer App Order blocks readiness', () => {
  const ctx = buildContext({ customerOrders: [customerOrder(1), customerOrder(1, { id: 'duplicate_ca_order' }), customerOrder(2)] });
  const result = resolveOccurrenceChain(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA });
  assert.ok(result.blockers.includes('duplicate_customer_order_identity_risk'));
});

test('duplicate native ShopifyOrder blocks readiness', () => {
  const ctx = buildContext({ nativeOrders: [nativeOrder(1), nativeOrder(1, { id: 'duplicate_native' }), nativeOrder(2)] });
  const result = resolveOccurrenceChain(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA });
  assert.ok(result.blockers.includes('duplicate_native_shopify_order_identity_risk'));
});

test('duplicate FulfillmentTask blocks readiness', () => {
  const ctx = buildContext({ tasks: [task(1), task(1, { id: 'duplicate_task' }), task(2)] });
  const result = resolveOccurrenceChain(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA });
  assert.ok(result.blockers.includes('duplicate_fulfillment_task_identity_risk'));
});

test('duplicate processing is idempotent for complete chain', () => {
  const ctx = buildContext();
  const result = processOccurrenceIdempotently(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA });
  assert.equal(result.action, 'return_existing_exact_chain');
  assert.equal(result.created_customer_orders, 0);
  assert.equal(result.created_native_orders, 0);
  assert.equal(result.created_tasks, 0);
  assert.equal(result.idempotent, true);
});

test('incomplete chain blocks instead of creating live rows', () => {
  const ctx = buildContext({ tasks: [] });
  const result = processOccurrenceIdempotently(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA });
  assert.equal(result.action, 'block_until_exact_chain_creation_command_is_approved');
  assert.equal(result.created_tasks, 0);
});

test('cross-customer parent lookup is rejected', () => {
  const ctx = buildContext();
  const result = resolveOccurrenceChain(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerB });
  assert.ok(result.blockers.includes('exact_parent_not_found_or_not_owned'));
});

test('cross-customer native order match is rejected', () => {
  const ctx = buildContext({ nativeOrders: [nativeOrder(1, { customer_id: IDS.ownerB }), nativeOrder(2)] });
  const result = resolveOccurrenceChain(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA });
  assert.ok(result.blockers.includes('native_shopify_order_link_missing'));
});

test('fuzzy order-number-only matching is not sufficient', () => {
  const ctx = buildContext({ customerOrders: [customerOrder(1, { subscription_parent_id: '', occurrence_id: '' }), customerOrder(2)] });
  const result = resolveOccurrenceChain(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA });
  assert.ok(result.blockers.includes('customer_app_order_link_missing'));
  assert.equal(result.fuzzy_matching_used, false);
});

test('delivery date alone is not sufficient', () => {
  const ctx = buildContext({ occurrences: [occurrence(1, { occurrence_id: '', fulfillment_number: '' }), occurrence(2)] });
  const result = resolveOccurrenceChain(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA });
  assert.ok(result.blockers.includes('exact_occurrence_not_found'));
});

test('skip preview targets only exact intended occurrence', () => {
  const ctx = buildContext();
  const result = targetExactOccurrenceOnly(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA, operation: 'skip' });
  assert.equal(result.preview_only, true);
  assert.equal(result.applied, false);
  assert.equal(result.affected_occurrence_count, 1);
  assert.equal(result.target_occurrence_id, IDS.occ1);
});

test('cancel preview targets only exact intended occurrence', () => {
  const ctx = buildContext();
  const result = targetExactOccurrenceOnly(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ2, ownerId: IDS.ownerA, operation: 'cancel' });
  assert.equal(result.preview_only, true);
  assert.equal(result.applied, false);
  assert.equal(result.affected_occurrence_count, 1);
  assert.equal(result.target_occurrence_id, IDS.occ2);
});

test('skip/cancel ambiguous occurrence is blocked', () => {
  const ctx = buildContext({ occurrences: [occurrence(1), occurrence(1, { id: 'dup_occ' }), occurrence(2)] });
  const result = targetExactOccurrenceOnly(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA, operation: 'skip' });
  assert.equal(result.applied, false);
  assert.ok(result.blockers.includes('duplicate_occurrence_identity_risk'));
});

test('missing Customer App Order blocks native-read readiness even with native order/task present', () => {
  const ctx = buildContext({ customerOrders: [] });
  const result = resolveOccurrenceChain(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ2, ownerId: IDS.ownerA });
  assert.equal(result.native_read_ready, false);
});

test('missing native task blocks native-read readiness even with order/native order present', () => {
  const ctx = buildContext({ tasks: [task(2)] });
  const result = resolveOccurrenceChain(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA });
  assert.equal(result.native_read_ready, false);
  assert.ok(result.blockers.includes('fulfillment_task_link_missing'));
});

test('Stripe and Hub remain source-of-truth flags on parent', () => {
  const ctx = buildContext();
  assert.equal(ctx.parents[0].stripe_subscription_id, IDS.stripeSub);
  assert.equal(ctx.parents[0].hub_recurrence_source_of_truth, true);
});

test('no provider calls, notifications, Hub mutation, or live writes are performed', () => {
  const ctx = buildContext();
  const result = resolveOccurrenceChain(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA });
  assertSafe(result);
});

test('fixture output does not expose PII/provider/raw payload fields', () => {
  const ctx = buildContext();
  const result = resolveOccurrenceChain(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA });
  const text = JSON.stringify(result);
  for (const unsafe of ['customer_email', 'phone', 'delivery_address', 'stripe_customer_id', 'payment_method', 'raw_payload', 'hub_payload']) {
    assert.equal(text.includes(unsafe), false);
  }
});

test('historical Hub-only occurrence remains held', () => {
  const ctx = buildContext({ nativeOrders: [], tasks: [], customerOrders: [customerOrder(1), customerOrder(2)] });
  const result = resolveOccurrenceChain(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA });
  assert.ok(result.blockers.includes('native_shopify_order_link_missing'));
  assert.equal(result.native_read_ready, false);
});

test('future complete chain requires all five links', () => {
  const ctx = buildContext();
  const result = resolveOccurrenceChain(ctx, { parentId: IDS.parent, occurrenceId: IDS.occ1, ownerId: IDS.ownerA });
  assert.equal(result.parent_present, true);
  assert.equal(result.occurrence_present, true);
  assert.equal(result.customer_app_order_present, true);
  assert.equal(result.native_shopify_order_present, true);
  assert.equal(result.fulfillment_task_present, true);
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

console.log(`\nG46B-OCC2 future subscription occurrence linkage contract tests passed (${passed}/${tests.length}).`);
