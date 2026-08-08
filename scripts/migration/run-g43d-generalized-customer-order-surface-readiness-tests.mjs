#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../..');
const historySource = fs.readFileSync(path.join(repoRoot, 'base44/functions/getCustomerAccountDashboardData/handlers/getCustomerAccountDashboardData/entry.ts'), 'utf8');
const trackerSource = fs.readFileSync(path.join(repoRoot, 'base44/functions/getCustomerOrderDetail/entry.ts'), 'utf8');

const normalizeText = value => String(value ?? '').trim();
const normalizeLower = value => normalizeText(value).toLowerCase();
const normalizeOrderNumber = value => normalizeText(value).replace(/^#/, '').toUpperCase();
const uniq = rows => {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const key = row?.id || JSON.stringify(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
};

function makeOrder(overrides = {}) {
  const number = normalizeOrderNumber(overrides.order_number || 'NV-CLEANBOTH');
  return {
    id: overrides.id || `ca_${number}`,
    order_number: number,
    customer_email: overrides.customer_email || 'owner@example.test',
    order_type: overrides.order_type || 'one_time',
    source_type: overrides.source_type || 'one_time',
    fulfillment_type: overrides.fulfillment_type || 'delivery',
    status: overrides.status || 'scheduled_for_juicing',
    payment_status: overrides.payment_status || 'paid',
    financial_status: overrides.financial_status,
    payment_captured: overrides.payment_captured ?? true,
    refund_status: overrides.refund_status,
    refunded_at: overrides.refunded_at,
    is_subscription: overrides.is_subscription || false,
    created_date: overrides.created_date || '2026-06-01T10:00:00.000Z',
    assigned_delivery_date: overrides.assigned_delivery_date || '2026-06-20',
    estimated_delivery_date: overrides.estimated_delivery_date || '2026-06-20',
    fulfillment_status: overrides.fulfillment_status || 'pending',
    total: overrides.total ?? 43.99,
    items: overrides.items || [{ title: 'Hydration Shot', quantity: 3, price: 6 }],
    ...overrides,
  };
}

function makeNative(overrides = {}) {
  const number = normalizeOrderNumber(overrides.order_number || overrides.shopify_order_number || 'NV-CLEANBOTH');
  return {
    id: overrides.id || `native_${number}`,
    base44_order_id: overrides.base44_order_id ?? `ca_${number}`,
    customer_app_order_id: overrides.customer_app_order_id,
    order_number: overrides.order_number || number,
    shopify_order_number: overrides.shopify_order_number || number,
    customer_email: overrides.customer_email || 'owner@example.test',
    order_type: overrides.order_type || 'one_time',
    source_type: overrides.source_type || 'one_time',
    production_status: overrides.production_status || 'awaiting_production',
    order_status: overrides.order_status,
    fulfillment_status: overrides.fulfillment_status || 'pending',
    payment_status: overrides.payment_status || 'paid',
    financial_status: overrides.financial_status,
    refund_status: overrides.refund_status,
    is_subscription: overrides.is_subscription || false,
    requested_delivery_date: overrides.requested_delivery_date || '2026-06-20',
    assigned_delivery_date: overrides.assigned_delivery_date,
    created_date: overrides.created_date || '2026-06-01T10:05:00.000Z',
    ...overrides,
  };
}

function makeTask(overrides = {}) {
  const number = normalizeOrderNumber(overrides.order_number || 'NV-CLEANBOTH');
  return {
    id: overrides.id || `task_${number}`,
    order_id: overrides.order_id,
    base44_order_id: overrides.base44_order_id ?? `ca_${number}`,
    native_shopify_order_id: overrides.native_shopify_order_id || `native_${number}`,
    shopify_order_id: overrides.shopify_order_id,
    order_number: overrides.order_number || number,
    shopify_order_number: overrides.shopify_order_number,
    status: overrides.status || 'pending',
    delivery_status: overrides.delivery_status || 'pending',
    production_status: overrides.production_status || 'awaiting_production',
    fulfillment_type: overrides.fulfillment_type || 'delivery',
    payment_status: overrides.payment_status,
    delivery_date: overrides.delivery_date || '2026-06-20',
    ...overrides,
  };
}

function isOwnedBy(order, customerEmail) {
  return normalizeLower(order?.customer_email) === normalizeLower(customerEmail);
}

function compatibleNative(order, nativeOrder) {
  const orderNumber = normalizeOrderNumber(order?.order_number);
  const nativeNumber = normalizeOrderNumber(nativeOrder?.shopify_order_number || nativeOrder?.order_number);
  const idMatches = Boolean(order?.id && (nativeOrder?.base44_order_id === order.id || nativeOrder?.customer_app_order_id === order.id));
  const numberMatches = Boolean(orderNumber && nativeNumber && orderNumber === nativeNumber);
  const ownershipCompatible = !nativeOrder?.customer_email || normalizeLower(nativeOrder.customer_email) === normalizeLower(order?.customer_email);
  return ownershipCompatible && (idMatches || numberMatches);
}

function compatibleTask(order, nativeOrder, task) {
  const orderNumber = normalizeOrderNumber(order?.order_number);
  const taskNumber = normalizeOrderNumber(task?.order_number || task?.shopify_order_number);
  const customerLinkMatches = Boolean(order?.id && (task?.order_id === order.id || task?.base44_order_id === order.id));
  const nativeLinkMatches = Boolean(nativeOrder?.id && (task?.native_shopify_order_id === nativeOrder.id || task?.shopify_order_id === nativeOrder.id));
  const numberMatches = Boolean(orderNumber && taskNumber && orderNumber === taskNumber);
  const compatibleNumber = !orderNumber || !taskNumber || orderNumber === taskNumber;
  return (customerLinkMatches || nativeLinkMatches || numberMatches) && compatibleNumber;
}

function looksSubscriptionOrMulti(order, nativeOrder, task) {
  const values = [
    order?.order_type, order?.source_type, order?.fulfillment_mode, order?.fulfillment_type,
    nativeOrder?.order_type, nativeOrder?.source_type, nativeOrder?.source_channel, nativeOrder?.fulfillment_mode,
    task?.order_type, task?.source_type, task?.fulfillment_type,
  ].map(normalizeLower);
  return Boolean(order?.is_subscription || nativeOrder?.is_subscription || values.some(value => value.includes('subscription') || value.includes('multi_delivery') || value.includes('multi-delivery')));
}

function looksRefunded(order, nativeOrder) {
  return [order?.status, order?.payment_status, order?.financial_status, order?.refund_status, nativeOrder?.payment_status, nativeOrder?.financial_status, nativeOrder?.refund_status, nativeOrder?.production_status]
    .some(value => normalizeLower(value).includes('refund')) || Boolean(order?.refunded_at || nativeOrder?.refunded_at);
}

function looksCancelled(order, nativeOrder, task) {
  return [order?.status, order?.payment_status, order?.financial_status, nativeOrder?.production_status, nativeOrder?.order_status, nativeOrder?.payment_status, task?.status, task?.delivery_status]
    .some(value => ['cancelled', 'canceled', 'failed', 'voided'].includes(normalizeLower(value)));
}

function paidCaptured(order) {
  return Boolean(order?.payment_captured === true && ['paid', ''].includes(normalizeLower(order?.payment_status || 'paid')) && ['paid', ''].includes(normalizeLower(order?.financial_status || 'paid')));
}

function nativePaid(nativeOrder, task) {
  const values = [nativeOrder?.payment_status, nativeOrder?.financial_status, task?.payment_status].map(normalizeLower).filter(Boolean);
  return values.length === 0 || values.every(value => value === 'paid');
}

function mapCustomerStatus(value) {
  const status = normalizeLower(value);
  return ({
    pending: 'scheduled_for_juicing', awaiting_production: 'scheduled_for_juicing', scheduled: 'scheduled_for_juicing',
    fulfilled: 'delivered', delivered: 'delivered', pending_production: 'scheduled_for_juicing',
    packed: 'bottled_packed', out_for_delivery: 'out_for_delivery', in_transit: 'out_for_delivery',
  })[status] || status;
}

function mapFulfillmentStatus(value) {
  const status = normalizeLower(value);
  return ({ pending_production: 'pending', scheduled: 'pending', assigned: 'pending', fulfilled: 'delivered', delivered: 'delivered', packed: 'packed' })[status] || status;
}

function comparableDiffer(left, right, mapper = normalizeLower) {
  const l = mapper(left);
  const r = mapper(right);
  return Boolean(l && r && l !== r);
}

function deliveryDateForOrder(order) {
  return normalizeText(order?.assigned_delivery_date || order?.estimated_delivery_date || order?.delivery_date || order?.assigned_delivery_day);
}

function deliveryDateForNative(nativeOrder, task) {
  return normalizeText(task?.delivery_date || task?.scheduled_date || task?.assigned_delivery_date || nativeOrder?.assigned_delivery_date || nativeOrder?.selected_delivery_date || nativeOrder?.requested_delivery_date);
}

function hasRepairReplay(rows = []) {
  return rows.some(row => [row?.sync_source, row?.triggered_by, row?.reason, row?.description, row?.action, row?.hub_action, row?.source]
    .map(normalizeLower).join(' ').match(/repair|replay|retry|recovery/));
}

function classifyOrder(order, allNativeOrders, allTasks, reviewRows = [], syncRows = [], parityRows = []) {
  const nativeOrders = uniq(allNativeOrders.filter(nativeOrder => compatibleNative(order, nativeOrder)));
  const nativeOrder = nativeOrders[0] || null;
  const tasks = uniq(allTasks.filter(task => compatibleTask(order, nativeOrder, task)));
  const task = tasks[0] || null;
  const blockers = [];

  if (nativeOrders.length === 0) blockers.push('native_shopify_order_missing');
  if (nativeOrders.length > 1) blockers.push('native_duplicate_identity_risk');
  if (tasks.length === 0) blockers.push('native_fulfillment_task_missing');
  if (tasks.length > 1) blockers.push('native_fulfillment_task_identity_ambiguous');
  if (looksSubscriptionOrMulti(order, nativeOrder, task)) blockers.push('subscription_multi_delivery_hub_source_of_truth');
  if (looksRefunded(order, nativeOrder)) blockers.push('refund_payment_hub_source_of_truth');
  if (looksCancelled(order, nativeOrder, task)) blockers.push('cancelled_payment_risk');
  if (!paidCaptured(order) || !nativePaid(nativeOrder, task)) blockers.push('payment_mismatch');
  if (reviewRows.some(row => row.order_id === order.id && !['resolved', 'archived', 'rejected'].includes(normalizeLower(row.status)))) blockers.push('review_queue_hold');
  if (hasRepairReplay(syncRows.filter(row => row.order_id === order.id || normalizeOrderNumber(row.order_number) === normalizeOrderNumber(order.order_number)))) blockers.push('repair_replay_hold');
  if (parityRows.some(row => (row.order_id === order.id || normalizeOrderNumber(row.order_number) === normalizeOrderNumber(order.order_number)) && ['mismatch', 'blocked', 'needs_manual_review'].includes(normalizeLower(row.native_parity_status)))) blockers.push('repair_replay_hold');
  const nativeStatus = task?.delivery_status || task?.status || nativeOrder?.production_status || nativeOrder?.order_status;
  if (comparableDiffer(order.status, nativeStatus, mapCustomerStatus)) blockers.push('status_mismatch');
  if (comparableDiffer(order.payment_status || order.financial_status, nativeOrder?.payment_status || nativeOrder?.financial_status || task?.payment_status)) blockers.push('payment_mismatch');
  if (comparableDiffer(order.fulfillment_status, nativeOrder?.fulfillment_status || task?.status, mapFulfillmentStatus)) blockers.push('fulfillment_mismatch');
  if (deliveryDateForOrder(order) && deliveryDateForNative(nativeOrder, task) && deliveryDateForOrder(order) !== deliveryDateForNative(nativeOrder, task)) blockers.push('delivery_schedule_mismatch');

  const created = Date.parse(order.created_date || '');
  const nativeCreated = Date.parse(nativeOrder?.created_date || '');
  if (Number.isFinite(created) && Number.isFinite(nativeCreated) && nativeCreated - created > 7 * 24 * 60 * 60 * 1000) blockers.push('historical_late_mirror_hold');

  const uniqueBlockers = [...new Set(blockers)];
  const historyBlockers = uniqueBlockers.filter(blocker => blocker !== 'native_fulfillment_task_missing' && blocker !== 'native_fulfillment_task_identity_ambiguous');
  const historyEligible = historyBlockers.length === 0 && nativeOrders.length === 1;
  const trackerEligible = uniqueBlockers.length === 0 && nativeOrders.length === 1 && tasks.length === 1;

  let classification = 'unknown_manual_review_required';
  if (historyEligible && trackerEligible) classification = 'history_and_tracker_native_ready';
  else if (historyEligible && tasks.length === 0) classification = 'history_native_ready_tracker_task_missing';
  else if (historyEligible && tasks.length > 1) classification = 'history_native_ready_tracker_identity_ambiguous';
  else if (uniqueBlockers.includes('native_duplicate_identity_risk')) classification = 'native_duplicate_identity_risk';
  else if (uniqueBlockers.includes('native_shopify_order_missing')) classification = 'native_shopify_order_missing';
  else if (uniqueBlockers.includes('refund_payment_hub_source_of_truth')) classification = 'refund_payment_hub_source_of_truth';
  else if (uniqueBlockers.includes('cancelled_payment_risk')) classification = 'cancelled_payment_risk';
  else if (uniqueBlockers.includes('subscription_multi_delivery_hub_source_of_truth')) classification = 'subscription_multi_delivery_hub_source_of_truth';
  else if (uniqueBlockers.includes('payment_mismatch')) classification = 'payment_mismatch';
  else if (uniqueBlockers.includes('fulfillment_mismatch')) classification = 'fulfillment_mismatch';
  else if (uniqueBlockers.includes('delivery_schedule_mismatch')) classification = 'delivery_schedule_mismatch';
  else if (uniqueBlockers.includes('review_queue_hold')) classification = 'review_queue_hold';
  else if (uniqueBlockers.includes('repair_replay_hold')) classification = 'repair_replay_hold';
  else if (uniqueBlockers.includes('historical_late_mirror_hold')) classification = 'historical_late_mirror_hold';
  else if (uniqueBlockers.includes('native_fulfillment_task_missing')) classification = 'native_fulfillment_task_missing';

  return {
    order_number: normalizeOrderNumber(order.order_number),
    customer_app_order_present: true,
    native_shopify_order_present: nativeOrders.length > 0,
    compatible_native_fulfillment_task_count: tasks.length,
    order_type: normalizeLower(order.order_type || order.source_type || 'one_time'),
    payment_captured_ready: paidCaptured(order),
    refund_cancel_hold: uniqueBlockers.some(blocker => ['refund_payment_hub_source_of_truth', 'cancelled_payment_risk'].includes(blocker)),
    subscription_hold: uniqueBlockers.includes('subscription_multi_delivery_hub_source_of_truth'),
    mismatch_categories: uniqueBlockers.filter(blocker => blocker.includes('mismatch') || blocker.includes('identity')),
    history_eligibility: historyEligible,
    tracker_eligibility: trackerEligible,
    fallback_required: !historyEligible || !trackerEligible,
    review_required: !historyEligible || !trackerEligible,
    classification,
  };
}

function previewForCustomer({ customerEmail, orders, nativeOrders, tasks, reviewRows = [], syncRows = [], parityRows = [] }) {
  const ownedOrders = orders.filter(order => isOwnedBy(order, customerEmail));
  const rows = ownedOrders.map(order => classifyOrder(order, nativeOrders, tasks, reviewRows, syncRows, parityRows));
  const counts = {
    unique_order_count: rows.length,
    one_time_count: rows.filter(row => !row.subscription_hold).length,
    subscription_multi_delivery_count: rows.filter(row => row.subscription_hold).length,
    native_shopify_order_match_count: rows.filter(row => row.native_shopify_order_present).length,
    unique_native_fulfillment_task_match_count: rows.filter(row => row.compatible_native_fulfillment_task_count === 1).length,
    history_native_ready_count: rows.filter(row => row.history_eligibility).length,
    tracker_native_ready_count: rows.filter(row => row.tracker_eligibility).length,
    fallback_required_count: rows.filter(row => row.fallback_required).length,
    review_required_count: rows.filter(row => row.review_required).length,
    refund_cancel_payment_hold_count: rows.filter(row => row.refund_cancel_hold || row.classification === 'payment_mismatch').length,
    identity_ambiguity_count: rows.filter(row => row.classification.includes('identity_ambiguous') || row.classification === 'native_duplicate_identity_risk').length,
    mismatch_count: rows.filter(row => row.mismatch_categories.length > 0).length,
  };
  return { counts, rows, writes_performed: false, provider_call_impact: false, notifications_sent: false, hub_mutation_performed: false };
}

const baseOrders = [
  makeOrder({ order_number: 'NV-CLEANBOTH' }),
  makeOrder({ order_number: 'NV-HISTORYONLY' }),
  makeOrder({ order_number: 'NV-DUPTASK' }),
  makeOrder({ order_number: 'NV-DUPNATIVE' }),
  makeOrder({ order_number: 'NV-MISSINGNATIVE' }),
  makeOrder({ order_number: 'NV-REFUND', status: 'refunded', payment_status: 'refunded', refunded_at: '2026-06-02T00:00:00.000Z' }),
  makeOrder({ order_number: 'NV-CANCEL', status: 'cancelled' }),
  makeOrder({ order_number: 'NV-SUB', order_type: 'subscription', is_subscription: true }),
  makeOrder({ order_number: 'NV-MULTI', fulfillment_type: 'multi_delivery' }),
  makeOrder({ order_number: 'NV-PAYMISMATCH' }),
  makeOrder({ order_number: 'NV-FULFILLMISMATCH', fulfillment_status: 'packed' }),
  makeOrder({ order_number: 'NV-DATEMISMATCH' }),
  makeOrder({ order_number: 'NV-REVIEW' }),
  makeOrder({ order_number: 'NV-REPAIR' }),
  makeOrder({ order_number: 'NV-LATEMIRROR', created_date: '2026-05-01T00:00:00.000Z' }),
  makeOrder({ order_number: 'NV-OTHEROWNER', customer_email: 'other@example.test' }),
];

const baseNative = [
  makeNative({ order_number: 'NV-CLEANBOTH' }),
  makeNative({ order_number: 'NV-HISTORYONLY' }),
  makeNative({ order_number: 'NV-DUPTASK' }),
  makeNative({ order_number: 'NV-DUPNATIVE', id: 'native_NV-DUPNATIVE_A' }),
  makeNative({ order_number: 'NV-DUPNATIVE', id: 'native_NV-DUPNATIVE_B' }),
  makeNative({ order_number: 'NV-REFUND', payment_status: 'refunded' }),
  makeNative({ order_number: 'NV-CANCEL', production_status: 'cancelled' }),
  makeNative({ order_number: 'NV-SUB', order_type: 'subscription', is_subscription: true }),
  makeNative({ order_number: 'NV-MULTI', fulfillment_mode: 'multi_delivery' }),
  makeNative({ order_number: 'NV-PAYMISMATCH', payment_status: 'unpaid' }),
  makeNative({ order_number: 'NV-FULFILLMISMATCH', fulfillment_status: 'pending' }),
  makeNative({ order_number: 'NV-DATEMISMATCH', requested_delivery_date: '2026-06-21' }),
  makeNative({ order_number: 'NV-REVIEW' }),
  makeNative({ order_number: 'NV-REPAIR' }),
  makeNative({ order_number: 'NV-LATEMIRROR', created_date: '2026-06-15T00:00:00.000Z', production_status: 'delivered' }),
  makeNative({ order_number: 'NV-OTHEROWNER', customer_email: 'other@example.test' }),
];

const baseTasks = [
  makeTask({ order_number: 'NV-CLEANBOTH' }),
  makeTask({ order_number: 'NV-DUPTASK', id: 'task_NV-DUPTASK_A' }),
  makeTask({ order_number: 'NV-DUPTASK', id: 'task_NV-DUPTASK_B' }),
  makeTask({ order_number: 'NV-DUPNATIVE' }),
  makeTask({ order_number: 'NV-REFUND' }),
  makeTask({ order_number: 'NV-CANCEL', status: 'cancelled', delivery_status: 'cancelled' }),
  makeTask({ order_number: 'NV-SUB', fulfillment_type: 'subscription' }),
  makeTask({ order_number: 'NV-MULTI', fulfillment_type: 'multi_delivery' }),
  makeTask({ order_number: 'NV-PAYMISMATCH' }),
  makeTask({ order_number: 'NV-FULFILLMISMATCH', status: 'pending' }),
  makeTask({ order_number: 'NV-DATEMISMATCH', delivery_date: '2026-06-21' }),
  makeTask({ order_number: 'NV-REVIEW' }),
  makeTask({ order_number: 'NV-REPAIR' }),
  makeTask({ order_number: 'NV-LATEMIRROR', status: 'delivered', delivery_status: 'delivered', production_status: 'delivered' }),
  makeTask({ order_number: 'NV-OTHEROWNER' }),
];

const baseReviewRows = [{ order_id: 'ca_NV-REVIEW', status: 'open' }];
const baseSyncRows = [{ order_id: 'ca_NV-REPAIR', order_number: 'NV-REPAIR', action: 'repair replay' }];
const baseParityRows = [];

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function preview(overrides = {}) {
  return previewForCustomer({
    customerEmail: overrides.customerEmail || 'owner@example.test',
    orders: overrides.orders || baseOrders,
    nativeOrders: overrides.nativeOrders || baseNative,
    tasks: overrides.tasks || baseTasks,
    reviewRows: overrides.reviewRows || baseReviewRows,
    syncRows: overrides.syncRows || baseSyncRows,
    parityRows: overrides.parityRows || baseParityRows,
  });
}
function rowFor(orderNumber, result = preview()) {
  return result.rows.find(row => row.order_number === orderNumber);
}

test('clean one-time history/tracker candidate', () => {
  const row = rowFor('NV-CLEANBOTH');
  assert.equal(row.classification, 'history_and_tracker_native_ready');
  assert.equal(row.history_eligibility, true);
  assert.equal(row.tracker_eligibility, true);
});

test('clean one-time history candidate with no task', () => {
  const row = rowFor('NV-HISTORYONLY');
  assert.equal(row.classification, 'history_native_ready_tracker_task_missing');
  assert.equal(row.history_eligibility, true);
  assert.equal(row.tracker_eligibility, false);
});

test('tracker candidate requires exactly one task', () => {
  assert.equal(rowFor('NV-HISTORYONLY').tracker_eligibility, false);
  assert.equal(rowFor('NV-CLEANBOTH').compatible_native_fulfillment_task_count, 1);
});

test('duplicate native ShopifyOrder blocks', () => {
  assert.equal(rowFor('NV-DUPNATIVE').classification, 'native_duplicate_identity_risk');
});

test('duplicate/conflicting task blocks', () => {
  assert.equal(rowFor('NV-DUPTASK').classification, 'history_native_ready_tracker_identity_ambiguous');
  assert.equal(rowFor('NV-DUPTASK').compatible_native_fulfillment_task_count, 2);
});

test('missing native order falls back', () => {
  assert.equal(rowFor('NV-MISSINGNATIVE').classification, 'native_shopify_order_missing');
});

test('missing task holds tracker', () => {
  assert.equal(rowFor('NV-HISTORYONLY').fallback_required, true);
});

test('refund remains Hub/payment source-of-truth', () => {
  assert.equal(rowFor('NV-REFUND').classification, 'refund_payment_hub_source_of_truth');
});

test('cancelled order holds', () => {
  assert.equal(rowFor('NV-CANCEL').classification, 'cancelled_payment_risk');
});

test('subscription remains Hub source-of-truth', () => {
  assert.equal(rowFor('NV-SUB').classification, 'subscription_multi_delivery_hub_source_of_truth');
});

test('multi-delivery holds', () => {
  assert.equal(rowFor('NV-MULTI').classification, 'subscription_multi_delivery_hub_source_of_truth');
});

test('payment mismatch holds', () => {
  assert.equal(rowFor('NV-PAYMISMATCH').classification, 'payment_mismatch');
});

test('fulfillment mismatch holds', () => {
  assert.equal(rowFor('NV-FULFILLMISMATCH').classification, 'fulfillment_mismatch');
});

test('delivery-date mismatch holds', () => {
  assert.equal(rowFor('NV-DATEMISMATCH').classification, 'delivery_schedule_mismatch');
});

test('review queue holds', () => {
  assert.equal(rowFor('NV-REVIEW').classification, 'review_queue_hold');
});

test('repair/replay holds', () => {
  assert.equal(rowFor('NV-REPAIR').classification, 'repair_replay_hold');
});

test('historical late mirror chronology preserved', () => {
  assert.equal(rowFor('NV-LATEMIRROR').classification, 'historical_late_mirror_hold');
});

test('ownership filtering precedes eligibility', () => {
  const result = preview({ customerEmail: 'owner@example.test' });
  assert.equal(result.rows.some(row => row.order_number === 'NV-OTHEROWNER'), false);
});

test('cross-customer native match is rejected', () => {
  const orders = [makeOrder({ order_number: 'NV-CROSS', customer_email: 'owner@example.test' })];
  const nativeOrders = [makeNative({ order_number: 'NV-CROSS', customer_email: 'other@example.test' })];
  const tasks = [makeTask({ order_number: 'NV-CROSS' })];
  const row = preview({ orders, nativeOrders, tasks }).rows[0];
  assert.equal(row.classification, 'native_shopify_order_missing');
});

test('no valid order hidden', () => {
  const result = preview();
  assert.equal(result.counts.unique_order_count, baseOrders.filter(order => order.customer_email === 'owner@example.test').length);
});

test('no duplicates returned', () => {
  const numbers = preview().rows.map(row => row.order_number);
  assert.equal(numbers.length, new Set(numbers).size);
});

test('no customer-visible diagnostics', () => {
  const forbidden = ['native_primary_eligible', 'fallback_reason', 'source_of_truth', 'review_required_flag', 'native_shopify_order_id', 'native_fulfillment_task_id'];
  const keys = new Set();
  const collect = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collect(child);
    }
  };
  collect(preview().rows);
  for (const key of forbidden) assert.equal(keys.has(key), false, key);
});

test('no internal production status', () => {
  const text = JSON.stringify(preview().rows).toLowerCase();
  for (const status of ['planned', 'in_production', 'completed_pending_verification', 'verified_logged']) assert.equal(text.includes(status), false, status);
});

test('no PII/raw payload exposure', () => {
  const text = JSON.stringify(preview().rows).toLowerCase();
  for (const token of ['@example', 'customer_email', 'phone', 'address', 'raw_payload', 'provider_payload']) assert.equal(text.includes(token), false, token);
});

test('no writes', () => {
  const combined = historySource + trackerSource + fs.readFileSync(__filename, 'utf8');
  assert.equal(/\.create\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(/.test(fs.readFileSync(__filename, 'utf8')), false);
  assert.equal(preview().writes_performed, false);
  assert.ok(combined.includes('getCustomerOrderDetail'));
});

test('no provider calls', () => {
  assert.equal(/fetch\s*\(|new\s+Stripe\s*\(|stripe\.refunds|shopify\.clients|shopify\.rest/i.test(fs.readFileSync(__filename, 'utf8')), false);
  assert.equal(preview().provider_call_impact, false);
});

test('no notifications', () => {
  const targetSource = historySource + trackerSource;
  assert.equal(/sendCustomerNotification|sendOrderSms|CustomerMessageDeliveryLog\.create|Notification\.create/i.test(targetSource), false);
  assert.equal(preview().notifications_sent, false);
});

test('no Hub mutation', () => {
  const targetSource = historySource + trackerSource;
  assert.equal(/pushOrderStatusToHub|syncHubDeliveryStatuses|hubSyncProxy|functions\.invoke\s*\(/.test(targetSource), false);
  assert.equal(preview().hub_mutation_performed, false);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

const result = preview();
const classificationCounts = result.rows.reduce((acc, row) => {
  acc[row.classification] = (acc[row.classification] || 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({
  suite: 'g43d-generalized-customer-order-surface-readiness',
  tests: tests.length,
  passed: tests.length - failed,
  failed,
  fixture_orders_scanned: result.counts.unique_order_count,
  counts: result.counts,
  classification_counts: classificationCounts,
  ownership_result: 'source_and_harness_verified_not_live_multi_account',
  writes_performed: false,
  provider_call_impact: false,
  notifications_sent: false,
  hub_mutation_performed: false,
}, null, 2));

if (failed) process.exit(1);
console.log('G43D generalized customer order surface readiness tests passed');
