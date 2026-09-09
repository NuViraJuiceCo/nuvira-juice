import assert from 'node:assert/strict';
import { createRefundFixture } from './run-full-refund-loyalty-recovery-tests.mjs';
const copy = value => structuredClone(value);
const tests = []; const test = (name, fn) => tests.push([name, fn]);
function setRefunds(f, amounts, approved = false) {
  f.charge.refunds.data = amounts.map((amount, index) => ({ id: `re_synthetic_${index}`, amount, status: 'succeeded',
    charge: f.charge.id, payment_intent: f.payment.id, currency: 'usd', created: 1788883200 + index,
    metadata: approved && index === 0 ? { operation: 'customer_order_adjustment_oasis_refund' } : {} }));
  f.charge.amount_refunded = amounts.reduce((a, b) => a + b, 0);
  f.charge.refunded = f.charge.amount_refunded === f.charge.amount;
  f.event.data.object = copy(f.charge);
}
function updated(f, index = 0, type = 'refund.updated') {
  return { type, data: { object: copy(f.charge.refunds.data[index]) } };
}
const noSideEffects = f => assert.ok(!f.effects.some(effect => /CAS|\.update|\.create|ledger\.|syncRefund|sendOrder/.test(effect)));
const noFullHandoff = f => {
  assert.ok(!f.effects.includes('syncRefundToHub'));
  assert.ok(!f.effects.includes('ledger.reversal'));
  assert.ok(!f.effects.includes('sendOrderStatusNotification'));
};
for (const approved of [true, false]) test(`${approved ? 'approved OASIS' : 'generic'} partial preserves fulfillment and replay is write-free`, async () => {
  const f = await createRefundFixture(); setRefunds(f, [1200], approved);
  const result = await f.run(); assert.equal(result.status, 200);
  assert.equal(result.body.action, approved ? 'customer_adjustment_partial_refund_recorded' : 'partial_refund_review_required');
  assert.equal(f.order.refund_amount, 12); assert.equal(f.order.refund_review_required, !approved);
  assert.equal(f.order.refund_review_status, approved ? 'resolved' : 'pending');
  assert.equal(f.order.status, 'scheduled_for_juicing'); assert.equal(f.order.payment_status, 'paid');
  assert.equal(f.order.financial_status, 'paid'); assert.equal(f.order.payment_captured, true); noFullHandoff(f);
  const before = copy(f.rows); await f.run({ id: 'evt_synthetic_replay' }); assert.deepEqual(f.rows, before);
});
for (const type of ['refund.created', 'refund.updated', 'charge.refund.updated']) test(`${type} uses cumulative successful refunds, not one refund or order total`, async () => {
  const f = await createRefundFixture(); setRefunds(f, [500, 700]); f.order.total = 1;
  const result = await f.run(updated(f, 0, type)); assert.equal(result.status, 200);
  assert.equal(f.order.refund_amount, 12); assert.equal(f.order.refund_type, 'partial');
  assert.equal(f.order.status, 'scheduled_for_juicing'); noFullHandoff(f);
});
test('a second generic partial cannot inherit an earlier approved OASIS exemption', async () => {
  const f = await createRefundFixture(); setRefunds(f, [500, 700], true);
  assert.equal((await f.run()).status, 200); assert.equal(f.order.refund_review_required, true);
});
test('two partial refunds reaching the full charge complete native, loyalty and communication stages', async () => {
  const f = await createRefundFixture(); setRefunds(f, [1200]); await f.run();
  setRefunds(f, [1200, f.charge.amount - 1200]);
  const result = await f.run(updated(f, 1)); assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(f.order.refund_type, 'full'); assert.equal(f.order.refund_status, 'fully_refunded');
  assert.equal(f.order.is_partial_refund, false); assert.equal(f.order.status, 'refunded');
  assert.equal(f.order.do_not_recover, true); assert.equal(result.body.communications_confirmed, true);
  assert.equal(f.rows.UserPoints[0].total_points, 2000);
  assert.equal(f.effects.filter(x => x === 'syncRefundToHub').length, 1);
  assert.equal(f.effects.filter(x => x === 'sendOrderStatusNotification').length, 1);
});
test('an old partial event arriving after full refund never regresses or repeats communication', async () => {
  const f = await createRefundFixture(); setRefunds(f, [100]); const old = copy(f.event); await f.run();
  setRefunds(f, [100, f.charge.amount - 100]); await f.run();
  const before = copy(f.order); const messages = f.effects.filter(x => x === 'sendOrderStatusNotification').length;
  assert.equal((await f.run(old)).status, 200); assert.deepEqual(f.order, before);
  assert.equal(f.effects.filter(x => x === 'sendOrderStatusNotification').length, messages);
});
test('fresh full provider state wins over an old partial event before any local refund record', async () => {
  const f = await createRefundFixture(); f.event.data.object.amount_refunded = 100;
  assert.equal((await f.run()).status, 200); assert.equal(f.order.status, 'refunded');
});
test('expanded Stripe references resolve the same unique paid order', async () => {
  const f = await createRefundFixture(); setRefunds(f, [1200]);
  f.charge.refunds.data[0].payment_intent = { id: f.payment.id };
  f.charge.refunds.data[0].charge = { id: f.charge.id };
  const result = await f.run(updated(f)); assert.equal(result.status, 200); assert.equal(f.order.refund_amount, 12);
});
for (const status of ['pending', 'failed', 'canceled', 'requires_action']) test(`${status} refund object never claims completed money movement`, async () => {
  const f = await createRefundFixture(); f.charge.refunds.data[0].status = status;
  const result = await f.run(updated(f)); assert.equal(result.status, 200);
  assert.equal(result.body.action, 'refund_not_succeeded'); noSideEffects(f);
});
for (const [name, mutate] of [
  ['refund list outage', f => { f.faults.refundList = true; }],
  ['wrong refund owner', f => { f.charge.refunds.data[0].payment_intent = 'pi_foreign'; }],
  ['wrong refund charge', f => { f.charge.refunds.data[0].charge = 'ch_foreign'; }],
  ['wrong refund currency', f => { f.charge.refunds.data[0].currency = 'cad'; }],
  ['pending amount included in charge total', f => { f.charge.refunds.data[0].status = 'pending'; }],
  ['unconfirmed sum', f => { f.charge.refunds.data[0].amount--; }],
  ['duplicate refund rows', f => { f.charge.refunds.data.push(copy(f.charge.refunds.data[0])); }],
]) test(`${name} rejects before local writes`, async () => {
  const f = await createRefundFixture(); mutate(f);
  assert.ok((await f.run()).status >= 400); noSideEffects(f);
});
test('provider amount lower than stored cumulative refund requires review and cannot overwrite it', async () => {
  const f = await createRefundFixture(); setRefunds(f, [100]); f.order.refund_amount = 12;
  const before = copy(f.rows); assert.equal((await f.run()).status, 500); assert.deepEqual(f.rows, before);
});
for (const fault of ['native', 'nativeFalse']) test(`terminal-order retry repairs ${fault} before claiming completion`, async () => {
  const f = await createRefundFixture(); f.faults[fault] = true;
  assert.equal((await f.run()).status, 500); assert.equal(f.order.status, 'refunded');
  assert.equal(f.order.refund_processing.native_confirmed, false);
  assert.ok(!f.effects.includes('sendOrderStatusNotification')); f.faults[fault] = false;
  assert.equal((await f.run()).status, 200); assert.equal(f.order.refund_processing.native_confirmed, true);
});
test('legacy terminal orders repair native and loyalty but require review before an untracked refund email is resent', async () => {
  const f = await createRefundFixture(); f.order.status = 'cancelled'; f.order.payment_status = 'refunded';
  assert.equal((await f.run()).status, 500); assert.equal(f.order.refund_processing.communication.state, 'legacy_review_required');
  assert.equal(f.order.refund_processing.native_confirmed, true); assert.equal(f.rows.UserPoints[0].total_points, 2000);
  assert.ok(!f.effects.includes('sendOrderStatusNotification'));
  assert.equal(f.rows.OrderReviewQueue.filter(row => row.incident_type === 'refund_communication_unconfirmed').length, 1);
  assert.equal((await f.run()).status, 500); assert.equal(f.rows.OrderReviewQueue.length, 1);
});
test('missing communication configuration is safely retryable before dispatch', async () => {
  const f = await createRefundFixture(); f.faults.communicationConfig = true;
  assert.equal((await f.run()).status, 500); assert.equal(f.order.refund_processing.communication.state, 'pending');
  f.faults.communicationConfig = false; assert.equal((await f.run()).status, 200);
  assert.equal(f.effects.filter(x => x === 'sendOrderStatusNotification').length, 1);
});
test('lost communication reply is recovered from channel and in-app receipts without resending', async () => {
  const f = await createRefundFixture(); f.faults.lostCommunication = true;
  assert.equal((await f.run()).status, 200); assert.equal((await f.run()).status, 200);
  assert.equal(f.effects.filter(x => x === 'sendOrderStatusNotification').length, 1);
});
test('unknown communication outcome remains unresolved and is never blindly resent', async () => {
  const f = await createRefundFixture(); f.faults.communication = true;
  assert.equal((await f.run()).status, 500); f.faults.communication = false;
  assert.equal((await f.run()).status, 500); assert.equal(f.order.refund_processing.communication.state, 'dispatching');
  assert.equal(f.effects.filter(x => x === 'sendOrderStatusNotification').length, 1);
  assert.equal(f.rows.OrderReviewQueue.length, 1);
  assert.equal(f.rows.OrderReviewQueue[0].status, 'pending');
  assert.equal(f.rows.OrderReviewQueue[0].incident_type, 'refund_communication_unconfirmed');
  assert.match(f.rows.OrderReviewQueue[0].recommended_action, /Do not refund the payment again/);
  assert.equal((await f.reviewInbox()).summary.open, 1);
});
for (const fault of ['OrderReviewQueue.read', 'OrderReviewQueue.create', 'OrderReviewQueue.ignoredCreate', 'OrderReviewQueue.lostCreate']) {
  test(`communication review ${fault} recovers the alert without a second message`, async () => {
    const f = await createRefundFixture(); f.faults.communication = true; f.faults[fault] = true;
    assert.equal((await f.run()).status, 500); f.faults[fault] = false;
    assert.equal((await f.run()).status, 500);
    assert.equal(f.effects.filter(x => x === 'sendOrderStatusNotification').length, 1);
    assert.equal(f.rows.OrderReviewQueue.length, 1);
  });
}
test('closing a communication alert never authorizes a resend', async () => {
  const f = await createRefundFixture(); f.faults.communication = true; await f.run();
  const review = f.rows.OrderReviewQueue[0]; review.status = 'resolved'; review.admin_notes = 'Synthetic operator disposition';
  const before = copy(review); f.faults.communication = false;
  assert.equal((await f.run()).status, 500); assert.deepEqual(review, before);
  assert.equal(f.effects.filter(x => x === 'sendOrderStatusNotification').length, 1);
});
test('confirmed late receipts recover a held communication without resending or erasing its review history', async () => {
  const f = await createRefundFixture(); await f.run();
  f.order.refund_processing.communication.state = 'dispatching';
  assert.equal((await f.run()).status, 200); assert.equal(f.order.refund_processing.communication.state, 'complete');
  assert.equal(f.effects.filter(x => x === 'sendOrderStatusNotification').length, 1);
});
test('legacy full-refund status missing a refund marker is recovered to review rather than duplicate delivery', async () => {
  const f = await createRefundFixture(); Object.assign(f.order, { status: 'refunded', payment_status: 'refunded',
    financial_status: 'refunded', payment_captured: false, do_not_recover: true,
    refund_type: 'full', refund_status: 'fully_refunded', refund_amount: f.charge.amount / 100 });
  delete f.order.stripe_refund_id;
  assert.equal((await f.run()).status, 500); assert.equal(f.order.stripe_refund_id, 're_synthetic_full');
  assert.equal(f.order.refund_processing.native_confirmed, true);
  assert.equal(f.rows.OrderReviewQueue.length, 1); assert.ok(!f.effects.includes('sendOrderStatusNotification'));
});
test('foreign delivery log never authorizes dispatch or completion', async () => {
  const f = await createRefundFixture(); f.rows.CustomerMessageDeliveryLog.push({
    id: 'foreign', idempotency_key: `txn:${f.order.id}:refunded:email:re_synthetic_full`,
    channel: 'email', order_id: 'foreign', customer_email: 'foreign@example.test' });
  assert.equal((await f.run()).status, 500); assert.ok(!f.effects.includes('sendOrderStatusNotification'));
});
let passed = 0;
for (const [name, fn] of tests) { try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`, error); process.exitCode = 1; } }
console.log(`Refund recovery: ${passed}/${tests.length}; actual webhook with simulated Stripe/storage, zero external calls.`);
