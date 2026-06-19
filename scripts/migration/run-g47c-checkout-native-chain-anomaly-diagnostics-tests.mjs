#!/usr/bin/env node
import assert from 'node:assert/strict';

const CLASSIFICATIONS = Object.freeze({
  COMPLETE_HUB_REQUIRED: 'checkout_chain_complete_hub_write_required',
  NATIVE_ORDER_MISSING: 'checkout_chain_native_order_missing',
  TASK_MISSING: 'checkout_chain_task_missing',
  HUB_FAILED_NATIVE_COMPLETE: 'checkout_chain_hub_sync_failed_native_complete',
  HUB_FAILED_NATIVE_INCOMPLETE: 'checkout_chain_hub_sync_failed_native_incomplete',
  PAYMENT_MISMATCH: 'checkout_chain_payment_order_mismatch',
  REPAIR_REPLAY_HOLD: 'checkout_chain_repair_replay_hold',
  REVIEW_QUEUE_HOLD: 'checkout_chain_review_queue_hold',
  HISTORICAL_LATE_MIRROR: 'checkout_chain_historical_late_mirror_hold',
  DUPLICATE_IDENTITY: 'checkout_chain_duplicate_identity_risk',
  MANUAL_REVIEW: 'checkout_chain_manual_review_required',
});

const BUCKETS = Object.freeze({
  NO_ACTION: 'no_action_retain_current_behavior',
  NATIVE_ORDER_PACKET: 'exact_native_shopify_order_packet_candidate',
  TASK_PACKET: 'exact_fulfillment_task_packet_candidate',
  HUB_RETRY_DIAGNOSTICS: 'hub_retry_diagnostics_candidate',
  PAYMENT_RECONCILIATION: 'payment_reconciliation_hold',
  REPAIR_REPLAY_MANUAL_REVIEW: 'repair_replay_manual_review',
});

function normalizeOrderNumber(value) {
  return String(value || '').trim().replace(/^#/, '').toUpperCase();
}

function exactOrderMatch(order, candidate) {
  return Boolean(order && candidate && (
    (candidate.customer_app_order_id && order.id === candidate.customer_app_order_id) ||
    (candidate.order_number && normalizeOrderNumber(order.order_number) === normalizeOrderNumber(candidate.order_number))
  ));
}

function exactNativeMatch(order, nativeOrder) {
  if (!order || !nativeOrder) return false;
  return Boolean(
    nativeOrder.base44_order_id === order.id ||
    nativeOrder.customer_app_order_id === order.id ||
    normalizeOrderNumber(nativeOrder.order_number || nativeOrder.shopify_order_number) === normalizeOrderNumber(order.order_number)
  );
}

function exactTaskMatch(order, nativeOrder, task) {
  if (!order || !task) return false;
  return Boolean(
    task.order_id === order.id ||
    task.base44_order_id === order.id ||
    (nativeOrder?.id && (task.native_shopify_order_id === nativeOrder.id || task.shopify_order_id === nativeOrder.id)) ||
    normalizeOrderNumber(task.order_number) === normalizeOrderNumber(order.order_number)
  );
}

function isOneTime(order) {
  const type = String(order?.order_type || order?.source_type || 'one_time').toLowerCase();
  const fulfillment = String(order?.fulfillment_type || order?.fulfillment_mode || '').toLowerCase();
  return type !== 'subscription' && type !== 'multi_delivery' && fulfillment !== 'multi_delivery';
}

function paymentReady(order) {
  return order?.payment_status === 'paid' && order?.payment_captured === true;
}

function classifyCheckoutChain(candidate, ctx) {
  const customerOrders = (ctx.orders || []).filter(order => exactOrderMatch(order, candidate));
  const customerOrder = customerOrders.length === 1 ? customerOrders[0] : null;
  const nativeOrders = customerOrder ? (ctx.nativeOrders || []).filter(row => exactNativeMatch(customerOrder, row)) : [];
  const nativeOrder = nativeOrders.length === 1 ? nativeOrders[0] : null;
  const tasks = customerOrder ? (ctx.tasks || []).filter(row => exactTaskMatch(customerOrder, nativeOrder, row)) : [];
  const hubRows = customerOrder ? (ctx.orderSyncLogs || []).filter(row => normalizeOrderNumber(row.order_number) === normalizeOrderNumber(customerOrder.order_number) || row.base44_order_id === customerOrder.id || row.order_id === customerOrder.id) : [];
  const repairReplayHold = hubRows.some(row => /repair|replay|retry|manual_review/i.test(`${row.status || ''} ${row.description || ''}`));
  const reviewHold = customerOrder ? (ctx.reviewRows || []).some(row => normalizeOrderNumber(row.order_number || row.existing_order_number) === normalizeOrderNumber(customerOrder.order_number) || row.order_id === customerOrder.id) : false;
  const hubFailed = hubRows.some(row => /failed|error|failure/i.test(`${row.status || ''} ${row.sync_status || ''} ${row.description || ''}`));
  const hubPending = hubRows.some(row => /pending|queued/i.test(`${row.status || ''} ${row.sync_status || ''} ${row.description || ''}`));
  const hubSucceeded = hubRows.some(row => /success|synced|created|updated/i.test(`${row.status || ''} ${row.sync_status || ''} ${row.description || ''}`));
  const nativeChainComplete = Boolean(customerOrder && nativeOrders.length === 1 && tasks.length === 1);
  const paymentMismatch = Boolean(customerOrder && (
    (customerOrder.payment_captured === true && customerOrder.payment_status !== 'paid') ||
    (nativeOrder && nativeOrder.payment_status && nativeOrder.payment_status !== customerOrder.payment_status)
  ));
  const refundCancelHold = Boolean(customerOrder?.refunded || customerOrder?.refund_status || /cancel|refund/i.test(`${customerOrder?.status || ''} ${customerOrder?.payment_status || ''}`));
  const subscriptionHold = customerOrder ? !isOneTime(customerOrder) : false;
  const historicalHold = Boolean(candidate.historical_late_mirror || customerOrder?.historical_late_mirror);

  let classification = CLASSIFICATIONS.MANUAL_REVIEW;
  if (customerOrders.length !== 1 || nativeOrders.length > 1 || tasks.length > 1) classification = CLASSIFICATIONS.DUPLICATE_IDENTITY;
  else if (!customerOrder) classification = CLASSIFICATIONS.MANUAL_REVIEW;
  else if (refundCancelHold || subscriptionHold) classification = CLASSIFICATIONS.MANUAL_REVIEW;
  else if (historicalHold) classification = CLASSIFICATIONS.HISTORICAL_LATE_MIRROR;
  else if (paymentMismatch) classification = CLASSIFICATIONS.PAYMENT_MISMATCH;
  else if (reviewHold) classification = CLASSIFICATIONS.REVIEW_QUEUE_HOLD;
  else if (repairReplayHold) classification = CLASSIFICATIONS.REPAIR_REPLAY_HOLD;
  else if (!paymentReady(customerOrder)) classification = CLASSIFICATIONS.MANUAL_REVIEW;
  else if (nativeOrders.length === 0) classification = CLASSIFICATIONS.NATIVE_ORDER_MISSING;
  else if (tasks.length === 0) classification = CLASSIFICATIONS.TASK_MISSING;
  else if (nativeChainComplete && hubFailed) classification = CLASSIFICATIONS.HUB_FAILED_NATIVE_COMPLETE;
  else if (!nativeChainComplete && hubFailed) classification = CLASSIFICATIONS.HUB_FAILED_NATIVE_INCOMPLETE;
  else if (nativeChainComplete) classification = CLASSIFICATIONS.COMPLETE_HUB_REQUIRED;

  const remediationBucket = (() => {
    switch (classification) {
      case CLASSIFICATIONS.NATIVE_ORDER_MISSING: return BUCKETS.NATIVE_ORDER_PACKET;
      case CLASSIFICATIONS.TASK_MISSING: return BUCKETS.TASK_PACKET;
      case CLASSIFICATIONS.HUB_FAILED_NATIVE_COMPLETE: return BUCKETS.HUB_RETRY_DIAGNOSTICS;
      case CLASSIFICATIONS.PAYMENT_MISMATCH: return BUCKETS.PAYMENT_RECONCILIATION;
      case CLASSIFICATIONS.REPAIR_REPLAY_HOLD:
      case CLASSIFICATIONS.REVIEW_QUEUE_HOLD:
      case CLASSIFICATIONS.DUPLICATE_IDENTITY:
      case CLASSIFICATIONS.MANUAL_REVIEW: return BUCKETS.REPAIR_REPLAY_MANUAL_REVIEW;
      default: return BUCKETS.NO_ACTION;
    }
  })();

  const chainOrigin = historicalHold
    ? 'historical_late_mirror'
    : candidate.native_born ? 'native_born_checkout_chain'
      : candidate.controlled_mirror ? 'controlled_native_mirror_chain'
        : 'unknown_chain_origin';

  return {
    order_number: normalizeOrderNumber(candidate.order_number),
    customer_app_order_match_count: customerOrders.length,
    native_shopify_order_match_count: nativeOrders.length,
    compatible_fulfillment_task_count: tasks.length,
    native_chain_complete: nativeChainComplete,
    hub_sync_status: hubFailed ? 'failed' : hubPending ? 'pending' : hubSucceeded ? 'success' : 'not_available',
    confirmation_ready: Boolean(customerOrder),
    history_ready: Boolean(customerOrder),
    tracker_ready: nativeChainComplete,
    primary_classification: classification,
    remediation_bucket: remediationBucket,
    chain_origin: chainOrigin,
    writes_performed: false,
    provider_call_impact: false,
    stripe_calls: false,
    shopify_calls: false,
    hub_calls: false,
    notifications_sent: false,
    hub_mutation_performed: false,
    repair_replay_invoked: false,
    logs_queues_created: false,
    pii_returned: false,
    raw_payloads_returned: false,
  };
}

function order(overrides = {}) {
  const number = overrides.order_number || 'NV-CLEAN';
  return {
    id: overrides.id || `ca_${number}`,
    order_number: number,
    order_type: 'one_time',
    status: 'scheduled_for_juicing',
    payment_status: 'paid',
    payment_captured: true,
    total: 42,
    line_item_count: 2,
    ...overrides,
  };
}

function native(overrides = {}) {
  const number = overrides.order_number || 'NV-CLEAN';
  return {
    id: overrides.id || `native_${number}`,
    base44_order_id: overrides.base44_order_id || `ca_${number}`,
    order_number: number,
    payment_status: 'paid',
    ...overrides,
  };
}

function task(overrides = {}) {
  const number = overrides.order_number || 'NV-CLEAN';
  return {
    id: overrides.id || `task_${number}`,
    base44_order_id: overrides.base44_order_id || `ca_${number}`,
    native_shopify_order_id: overrides.native_shopify_order_id || `native_${number}`,
    order_number: number,
    status: 'pending',
    fulfillment_status: 'pending',
    delivery_status: 'pending',
    ...overrides,
  };
}

function syncLog(overrides = {}) {
  return { id: overrides.id || 'sync_1', order_number: overrides.order_number || 'NV-CLEAN', status: overrides.status || 'success', description: overrides.description || '', ...overrides };
}

function baseCtx(number = 'NV-CLEAN') {
  return {
    orders: [order({ order_number: number, id: `ca_${number}` })],
    nativeOrders: [native({ order_number: number, id: `native_${number}`, base44_order_id: `ca_${number}` })],
    tasks: [task({ order_number: number, id: `task_${number}`, base44_order_id: `ca_${number}`, native_shopify_order_id: `native_${number}` })],
    orderSyncLogs: [syncLog({ order_number: number, status: 'success' })],
    reviewRows: [],
  };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function run(candidate, ctx) { return classifyCheckoutChain(candidate, ctx); }

// Required cases.
test('paid captured Customer App Order with missing native order', () => {
  const ctx = baseCtx('NV-NONATIVE'); ctx.nativeOrders = []; ctx.tasks = [];
  assert.equal(run({ order_number: 'NV-NONATIVE' }, ctx).primary_classification, CLASSIFICATIONS.NATIVE_ORDER_MISSING);
});

test('native order present with missing task', () => {
  const ctx = baseCtx('NV-NOTASK'); ctx.tasks = [];
  assert.equal(run({ order_number: 'NV-NOTASK' }, ctx).primary_classification, CLASSIFICATIONS.TASK_MISSING);
});

test('complete native chain with Hub success', () => {
  assert.equal(run({ order_number: 'NV-CLEAN' }, baseCtx()).primary_classification, CLASSIFICATIONS.COMPLETE_HUB_REQUIRED);
});

test('complete native chain with Hub failure', () => {
  const ctx = baseCtx('NV-HUBFAIL'); ctx.orderSyncLogs = [syncLog({ order_number: 'NV-HUBFAIL', status: 'failed' })];
  assert.equal(run({ order_number: 'NV-HUBFAIL' }, ctx).primary_classification, CLASSIFICATIONS.HUB_FAILED_NATIVE_COMPLETE);
});

test('incomplete native chain with Hub failure', () => {
  const ctx = baseCtx('NV-HUBFAIL-INCOMPLETE'); ctx.nativeOrders = []; ctx.tasks = []; ctx.orderSyncLogs = [syncLog({ order_number: 'NV-HUBFAIL-INCOMPLETE', status: 'failed' })];
  assert.equal(run({ order_number: 'NV-HUBFAIL-INCOMPLETE' }, ctx).primary_classification, CLASSIFICATIONS.NATIVE_ORDER_MISSING);
});

test('payment/order mismatch', () => {
  const ctx = baseCtx('NV-PAYMIS'); ctx.orders[0].payment_status = 'pending'; ctx.orders[0].payment_captured = true;
  assert.equal(run({ order_number: 'NV-PAYMIS' }, ctx).primary_classification, CLASSIFICATIONS.PAYMENT_MISMATCH);
});

test('repair/replay hold', () => {
  const ctx = baseCtx('NV-REPAIR'); ctx.orderSyncLogs = [syncLog({ order_number: 'NV-REPAIR', status: 'failed', description: 'repair replay required' })];
  assert.equal(run({ order_number: 'NV-REPAIR' }, ctx).primary_classification, CLASSIFICATIONS.REPAIR_REPLAY_HOLD);
});

test('review queue hold', () => {
  const ctx = baseCtx('NV-REVIEW'); ctx.reviewRows = [{ order_number: 'NV-REVIEW', status: 'pending' }];
  assert.equal(run({ order_number: 'NV-REVIEW' }, ctx).primary_classification, CLASSIFICATIONS.REVIEW_QUEUE_HOLD);
});

test('historical late mirror', () => {
  const ctx = baseCtx('NV-HIST'); ctx.orders[0].historical_late_mirror = true;
  assert.equal(run({ order_number: 'NV-HIST', historical_late_mirror: true }, ctx).primary_classification, CLASSIFICATIONS.HISTORICAL_LATE_MIRROR);
});

test('duplicate Customer App identity', () => {
  const ctx = baseCtx('NV-DUPCA'); ctx.orders.push(order({ id: 'ca_dup', order_number: 'NV-DUPCA' }));
  assert.equal(run({ order_number: 'NV-DUPCA' }, ctx).primary_classification, CLASSIFICATIONS.DUPLICATE_IDENTITY);
});

test('duplicate native ShopifyOrder identity', () => {
  const ctx = baseCtx('NV-DUPNATIVE'); ctx.nativeOrders.push(native({ id: 'native_dup', order_number: 'NV-DUPNATIVE', base44_order_id: 'ca_NV-DUPNATIVE' }));
  assert.equal(run({ order_number: 'NV-DUPNATIVE' }, ctx).primary_classification, CLASSIFICATIONS.DUPLICATE_IDENTITY);
});

test('duplicate/conflicting task identity', () => {
  const ctx = baseCtx('NV-DUPTASK'); ctx.tasks.push(task({ id: 'task_dup', order_number: 'NV-DUPTASK', base44_order_id: 'ca_NV-DUPTASK', native_shopify_order_id: 'native_NV-DUPTASK' }));
  assert.equal(run({ order_number: 'NV-DUPTASK' }, ctx).primary_classification, CLASSIFICATIONS.DUPLICATE_IDENTITY);
});

test('refund/cancel row excluded from remediation', () => {
  const ctx = baseCtx('NV-REFUND'); ctx.orders[0].payment_status = 'refunded';
  const result = run({ order_number: 'NV-REFUND' }, ctx);
  assert.equal(result.remediation_bucket, BUCKETS.REPAIR_REPLAY_MANUAL_REVIEW);
});

test('subscription/multi-delivery excluded', () => {
  const ctx = baseCtx('SUB-ONE'); ctx.orders[0].order_type = 'subscription';
  assert.equal(run({ order_number: 'SUB-ONE' }, ctx).primary_classification, CLASSIFICATIONS.MANUAL_REVIEW);
});

test('exact native-order packet candidate', () => {
  const ctx = baseCtx('NV-PACKET'); ctx.nativeOrders = []; ctx.tasks = [];
  assert.equal(run({ order_number: 'NV-PACKET' }, ctx).remediation_bucket, BUCKETS.NATIVE_ORDER_PACKET);
});

test('exact task packet candidate', () => {
  const ctx = baseCtx('NV-TASKPACKET'); ctx.tasks = [];
  assert.equal(run({ order_number: 'NV-TASKPACKET' }, ctx).remediation_bucket, BUCKETS.TASK_PACKET);
});

test('Hub retry diagnostics candidate', () => {
  const ctx = baseCtx('NV-HUBRETRY'); ctx.orderSyncLogs = [syncLog({ order_number: 'NV-HUBRETRY', status: 'failed' })];
  assert.equal(run({ order_number: 'NV-HUBRETRY' }, ctx).remediation_bucket, BUCKETS.HUB_RETRY_DIAGNOSTICS);
});

test('payment reconciliation hold', () => {
  const ctx = baseCtx('NV-PAYHOLD'); ctx.nativeOrders[0].payment_status = 'pending';
  assert.equal(run({ order_number: 'NV-PAYHOLD' }, ctx).remediation_bucket, BUCKETS.PAYMENT_RECONCILIATION);
});

test('native-born versus mirror classification', () => {
  assert.equal(run({ order_number: 'NV-BORN', native_born: true }, baseCtx('NV-BORN')).chain_origin, 'native_born_checkout_chain');
  assert.equal(run({ order_number: 'NV-MIRROR', controlled_mirror: true }, baseCtx('NV-MIRROR')).chain_origin, 'controlled_native_mirror_chain');
});

test('no fuzzy identity matching', () => {
  const ctx = baseCtx('NV-EXACT');
  ctx.orders[0].customer_email = 'owner@example.test';
  const result = run({ order_number: 'NV-WRONG', customer_email: 'owner@example.test' }, ctx);
  assert.equal(result.customer_app_order_match_count, 0);
});

test('no PII returned', () => {
  const ctx = baseCtx('NV-PII'); ctx.orders[0].customer_email = 'owner@example.test'; ctx.orders[0].phone = '555-0000';
  const result = run({ order_number: 'NV-PII' }, ctx);
  assert.equal(JSON.stringify(result).includes('owner@example.test'), false);
  assert.equal(result.pii_returned, false);
});

test('no raw payload returned', () => {
  const ctx = baseCtx('NV-RAW'); ctx.orders[0].raw_payload = { unsafe: true };
  const result = run({ order_number: 'NV-RAW' }, ctx);
  assert.equal(JSON.stringify(result).includes('unsafe'), false);
  assert.equal(result.raw_payloads_returned, false);
});

test('no writes', () => assert.equal(run({ order_number: 'NV-CLEAN' }, baseCtx()).writes_performed, false));
test('no provider calls', () => assert.equal(run({ order_number: 'NV-CLEAN' }, baseCtx()).provider_call_impact, false));
test('no notifications', () => assert.equal(run({ order_number: 'NV-CLEAN' }, baseCtx()).notifications_sent, false));
test('no Hub mutation', () => assert.equal(run({ order_number: 'NV-CLEAN' }, baseCtx()).hub_mutation_performed, false));
test('no repair/replay invocation', () => assert.equal(run({ order_number: 'NV-CLEAN' }, baseCtx()).repair_replay_invoked, false));
test('no logs/queues created', () => assert.equal(run({ order_number: 'NV-CLEAN' }, baseCtx()).logs_queues_created, false));

let passed = 0;
const failures = [];
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    failures.push({ name, error: error.message });
  }
}

if (failures.length) {
  console.error(JSON.stringify({ suite: 'g47c-checkout-native-chain-anomaly-diagnostics', passed, failed: failures.length, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  suite: 'g47c-checkout-native-chain-anomaly-diagnostics',
  passed,
  failed: 0,
  classifications: Object.values(CLASSIFICATIONS),
  remediation_buckets: Object.values(BUCKETS),
  writes_performed: false,
  provider_call_impact: false,
  notifications_sent: false,
  hub_mutation_performed: false,
}, null, 2));
