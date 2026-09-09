import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as credit from '../../base44/shared/checkoutCredit.js';
import { applyCheckoutCredit, settleEmbeddedPaymentBenefits } from '../../base44/functions/stripeWebhook/paymentBenefits.js';
import { availableCreditBalance } from '../../src/lib/creditBalance.js';

// Actual credit protocol, actual webhook benefit dispatcher and actual bag-credit
// issuer against in-memory CAS/provider fixtures. No network, credential, or live writes.
const email = 'credit-reservation@example.test';
const copy = value => structuredClone(value);
function match(row, query) {
  return Object.entries(query).every(([key, value]) => key === '$or' ? value.some(q => match(row, q))
    : value && typeof value === 'object' && '$exists' in value ? (row[key] !== undefined) === value.$exists : row[key] === value);
}
function fixture() {
  const rows = { NuViraCredit: [{ id: 'credit_synthetic', customer_email: email, balance: 10,
    lifetime_used: 0, lifetime_issued: 10, history: [] }], Order: [], CheckoutSession: [] };
  const payments = new Map(); const sessions = new Map(); const calls = [];
  const fault = { lost: false, ignored: false, outage: false, provider: false, beforeCAS: null };
  const entities = {};
  for (const [name, list] of Object.entries(rows)) entities[name] = {
    filter: async query => { if (fault.outage) throw new Error('SYNTHETIC_ONLY storage outage'); return copy(list.filter(row => match(row, query))); },
    updateMany: async (query, update) => {
      if (fault.beforeCAS) { const task = fault.beforeCAS; fault.beforeCAS = null; await task(); }
      const found = list.filter(row => match(row, query)); assert.ok(found.length <= 1);
      if (!fault.ignored) found.forEach(row => Object.assign(row, copy(update.$set)));
      calls.push(name + '.CAS');
      if (fault.lost) { fault.lost = false; throw new Error('SYNTHETIC_ONLY lost acknowledgement'); }
      return { success: true, updated: found.length, has_more: false };
    },
  };
  const stripe = { checkout: { sessions: { retrieve: async id => {
    calls.push('session.retrieve'); if (fault.provider) throw new Error('SYNTHETIC_ONLY provider outage');
    return copy(sessions.get(id));
  } } }, paymentIntents: { retrieve: async id => {
    calls.push('provider.retrieve'); if (fault.provider) throw new Error('SYNTHETIC_ONLY provider outage');
    return copy(payments.get(id));
  } } };
  function add(suffix = 'a', amount = 6) {
    const id = `pi_synthetic_${suffix}`; const hash = suffix.repeat(64);
    const meta = { customer_email: email, checkout_mode: 'account', checkout_version: '3.0_embedded',
      order_number: `SYNTHETIC-${suffix}`, credit_reservation_id: `credit:${hash}`, checkout_context_hash: hash,
      credit_reservation_cents: String(amount * 100), internal_sandbox_checkout: 'false', is_test_order: 'false' };
    const payment = { id, metadata: meta, amount: 3699, amount_received: 0, currency: 'usd', livemode: true, status: 'requires_payment_method' };
    const data = { customer_email: email, order_number: meta.order_number, total: 36.99, credits_discount: amount,
      checkout_context_hash: hash, credit_reservation_id: meta.credit_reservation_id, credit_reservation_revision: credit.CHECKOUT_CREDIT_REVISION };
    const order = { id: `order_${suffix}`, customer_email: email, order_number: meta.order_number,
      total: 36.99, stripe_payment_intent_id: id, status: 'pending_payment', payment_status: 'pending' };
    const session = { id: `context_${suffix}`, customer_email: email, order_number: meta.order_number,
      stripe_session_id: id, checkout_data: data };
    payments.set(id, payment); rows.Order.push(order); rows.CheckoutSession.push(session);
    return { payment, data, order, session };
  }
  function addNoPayment(suffix = 'c', amount = 6) {
    const id = `cs_synthetic_${suffix}`; const hash = suffix.repeat(64);
    const rid = `credit:${hash}`;
    const metadata = { checkout_version: '4.0_reward_no_payment', checkout_mode: 'account', customer_email: email,
      order_number: `SYNTHETIC-${suffix}`, credit_reservation_id: rid, reward_reservation_id: rid,
      credit_reservation_cents: String(amount * 100), checkout_context_hash: hash };
    const session = { id, metadata, customer_email: email, currency: 'usd', livemode: true, mode: 'payment',
      status: 'open', payment_status: 'unpaid', amount_total: 0, payment_intent: null };
    const data = { customer_email: email, order_number: metadata.order_number, checkout_context_hash: hash,
      credit_reservation_id: rid, reward_reservation_id: rid, credits_discount: amount,
      credit_reservation_revision: credit.CHECKOUT_CREDIT_REVISION, no_payment_credit_revision: '2026-09-09.no-payment-credit-v1',
      total: 0, delivery_fee: 0, subtotal: amount, total_discounts: amount, guest_checkout: false,
      internal_sandbox_checkout: false, points_used: 0, points_discount: 0, reward_reservation_points: 0,
      items: [{ product_id: 'synthetic-oasis', title: 'OASIS', quantity: 1, price: amount }] };
    const order = { id: `order_${suffix}`, customer_email: email, order_number: metadata.order_number,
      total: 0, payment_captured: false, items: copy(data.items), stripe_checkout_session_id: id,
      status: 'pending_payment', payment_status: 'pending' };
    const context = { id: `context_${suffix}`, customer_email: email, order_number: metadata.order_number,
      stripe_session_id: id, checkout_data: data };
    sessions.set(id, session); rows.Order.push(order); rows.CheckoutSession.push(context);
    return { session, data, order, context };
  }
  return { rows, entities, stripe, payments, sessions, calls, fault, add, addNoPayment, wallet: () => rows.NuViraCredit[0],
    reserveSession: (session, preparationAttemptId = 'synthetic-preparation') =>
      credit.reserveNoPaymentCheckoutCredit({ entities, stripe, email, sessionId: session.id, preparationAttemptId }),
    settleSession: session => credit.settleNoPaymentCheckoutCredit({ entities, stripe, email, sessionId: session.id }),
    reserve: payment => credit.reserveCheckoutCredit({ entities, stripe, email, paymentId: payment.id }),
    settle: payment => credit.settleCheckoutCredit({ entities, email, payment }) };
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS', name); }

await test('hold lowers available credit without marking it spent', async () => {
  const f = fixture(); const a = f.add(); await f.reserve(a.payment);
  assert.equal(f.wallet().balance, 10); assert.equal(f.wallet().reserved_balance, 6);
  assert.equal(f.wallet().lifetime_used, 0); assert.deepEqual(f.wallet().history, []);
  assert.equal(await credit.availableCheckoutCredit(f.entities, email), 4);
  assert.equal(await credit.availableCheckoutCredit(f.entities, email, a.payment.metadata.credit_reservation_id), 10);
});
await test('two different checkouts cannot overspend one balance', async () => {
  const f = fixture(); const a = f.add('a', 6); const b = f.add('b', 6);
  const results = await Promise.allSettled([f.reserve(a.payment), f.reserve(b.payment)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.wallet().reserved_balance, 6); assert.equal(f.wallet().checkout_reservations.length, 1);
});
await test('same-checkout simultaneous retries reserve once', async () => {
  const f = fixture(); const a = f.add(); await Promise.all([f.reserve(a.payment), f.reserve(a.payment)]);
  assert.equal(f.wallet().reserved_balance, 6); assert.equal(f.wallet().checkout_reservations.length, 1);
});
await test('settlement consumes once and removes only its own hold', async () => {
  const f = fixture(); const a = f.add('a', 6); const b = f.add('b', 3);
  await Promise.all([f.reserve(a.payment), f.reserve(b.payment)]);
  Object.assign(a.payment, { status: 'succeeded', amount_received: 3699 });
  await Promise.all([f.settle(a.payment), f.settle(a.payment)]);
  assert.equal(f.wallet().balance, 4); assert.equal(f.wallet().reserved_balance, 3);
  assert.equal(f.wallet().lifetime_used, 6); assert.equal(f.wallet().history.length, 1);
  assert.equal(await credit.availableCheckoutCredit(f.entities, email), 1);
});
await test('confirmed cancellation releases once without a spending receipt', async () => {
  const f = fixture(); const a = f.add(); await f.reserve(a.payment); a.payment.status = 'canceled';
  await Promise.all([f.settle(a.payment), f.settle(a.payment)]);
  assert.equal(f.wallet().balance, 10); assert.equal(f.wallet().reserved_balance, 0);
  assert.equal(f.wallet().history.length, 0); await assert.rejects(() => f.reserve(a.payment), /reservation_conflict/);
});
await test('cancellation racing before a hold persists a tombstone that blocks stale reservation', async () => {
  const f = fixture(); const a = f.add();
  f.fault.beforeCAS = async () => { a.payment.status = 'canceled'; await f.settle(a.payment); };
  await assert.rejects(() => f.reserve(a.payment), /reservation_conflict/);
  assert.equal(f.wallet().balance, 10); assert.equal(f.wallet().reserved_balance ?? 0, 0);
  assert.equal(f.wallet().checkout_reservations[0].status, 'released');
});
for (const status of ['requires_payment_method', 'requires_action', 'processing', 'requires_capture']) {
  await test(`${status} is never treated as permission to release`, async () => {
    const f = fixture(); const a = f.add(); await f.reserve(a.payment); a.payment.status = status;
    await assert.rejects(() => f.settle(a.payment), /terminal_payment_required/); assert.equal(f.wallet().reserved_balance, 6);
  });
}
await test('lost reserve and settlement acknowledgements recover from receipts without double spend', async () => {
  const f = fixture(); const a = f.add(); f.fault.lost = true;
  await assert.rejects(() => f.reserve(a.payment), /lost acknowledgement/);
  await f.reserve(a.payment); assert.equal(f.wallet().reserved_balance, 6);
  Object.assign(a.payment, { status: 'succeeded', amount_received: 3699 }); f.fault.lost = true;
  await assert.rejects(() => f.settle(a.payment), /lost acknowledgement/); await f.settle(a.payment);
  assert.equal(f.wallet().balance, 4); assert.equal(f.wallet().history.length, 1);
});
await test('false-positive CAS response cannot expose an unreserved payment', async () => {
  const f = fixture(); const a = f.add(); f.fault.ignored = true;
  await assert.rejects(() => f.reserve(a.payment), /readback_unconfirmed/);
  assert.equal(f.wallet().reserved_balance ?? 0, 0);
});
await test('fresh captured payment cannot create a retroactive credit hold', async () => {
  const f = fixture(); const a = f.add(); Object.assign(a.payment, { status: 'succeeded', amount_received: 3699 });
  await assert.rejects(() => f.reserve(a.payment), /not_reservable/);
  await assert.rejects(() => f.settle(a.payment), /reservation_missing/); assert.equal(f.calls.filter(c => c.endsWith('CAS')).length, 0);
});
await test('consumed/released outcomes cannot be reversed by a delayed incompatible event', async () => {
  for (const first of ['succeeded', 'canceled']) {
    const f = fixture(); const a = f.add(); await f.reserve(a.payment);
    Object.assign(a.payment, { status: first, amount_received: 3699 }); await f.settle(a.payment);
    const prior = copy(f.wallet()); a.payment.status = first === 'succeeded' ? 'canceled' : 'succeeded';
    await assert.rejects(() => f.settle(a.payment), /settlement_conflict/); assert.deepEqual(f.wallet(), prior);
  }
});
for (const [name, change] of [
  ['test payment', a => { a.payment.livemode = false; }],
  ['foreign payment', a => { a.payment.metadata.customer_email = 'other@example.test'; }],
  ['guest payment', a => { a.payment.metadata.checkout_mode = 'guest'; }],
  ['wrong currency', a => { a.payment.currency = 'cad'; }],
  ['wrong context', a => { a.data.checkout_context_hash = '0'.repeat(64); }],
  ['wrong price', a => { a.data.total = 0.5; }],
  ['wrong credit value', a => { a.data.credits_discount = 2; }],
  ['foreign order', a => { a.order.customer_email = 'other@example.test'; }],
  ['foreign session', a => { a.session.customer_email = 'other@example.test'; }],
  ['terminal order', a => { a.order.status = 'refunded'; }],
  ['partial refund', a => { a.order.payment_status = 'partially_refunded'; }],
  ['different revision', a => { a.data.credit_reservation_revision = 'stale'; }],
]) await test(`${name} cannot reserve or consume credits`, async () => {
  const f = fixture(); const a = f.add(); change(a);
  await assert.rejects(() => f.reserve(a.payment)); assert.equal(f.calls.filter(c => c.endsWith('CAS')).length, 0);
});
for (const [name, patch] of [
  ['null balance', { balance: null }], ['fractional cents', { balance: 1.999 }],
  ['held sum mismatch', { reserved_balance: 1 }], ['invalid history', { history: {} }],
  ['invalid holds', { checkout_reservations: null }], ['invalid revision', { credit_ledger_revision: -1 }],
]) await test(`${name} fails closed`, async () => {
  const f = fixture(); const a = f.add(); Object.assign(f.wallet(), patch); await assert.rejects(() => f.reserve(a.payment));
});
await test('duplicate accounts, contexts, or orders never silently choose a row', async () => {
  for (const table of ['NuViraCredit', 'CheckoutSession', 'Order']) {
    const f = fixture(); const a = f.add(); f.rows[table].push(copy(f.rows[table][0]));
    await assert.rejects(() => f.reserve(a.payment));
  }
});
await test('one provider payment cannot identify two credit reservations', async () => {
  const f = fixture(); const a = f.add(); await f.reserve(a.payment);
  f.wallet().checkout_reservations.push({ ...f.wallet().checkout_reservations[0], reservation_id: `credit:${'b'.repeat(64)}` });
  f.wallet().reserved_balance = 12; f.wallet().balance = 20;
  await assert.rejects(() => f.reserve(a.payment), /invalid_credit_reservations/);
});
await test('provider or storage outage leaves the balance unchanged', async () => {
  for (const key of ['provider', 'outage']) {
    const f = fixture(); const a = f.add(); const before = copy(f.wallet()); f.fault[key] = true;
    await assert.rejects(() => f.reserve(a.payment), /outage|account_unavailable/); assert.deepEqual(f.wallet(), before);
  }
});
await test('legacy payment debit cannot spend credits held by another checkout', async () => {
  const f = fixture(); const a = f.add(); await f.reserve(a.payment);
  await assert.rejects(() => applyCheckoutCredit(f.entities, { email, paymentId: 'pi_legacy_synthetic',
    orderId: 'legacy_order', orderNumber: 'LEGACY-SYNTHETIC', amount: 5 }), /insufficient_checkout_credit/);
  await applyCheckoutCredit(f.entities, { email, paymentId: 'pi_legacy_synthetic',
    orderId: 'legacy_order', orderNumber: 'LEGACY-SYNTHETIC', amount: 4 });
  assert.equal(f.wallet().balance, 6); assert.equal(f.wallet().reserved_balance, 6);
});
const bagModule = { exports: {} };
vm.runInNewContext(transformSync(fs.readFileSync('base44/functions/getBagReturnsForSync/entry.ts', 'utf8'),
  { loader: 'ts', format: 'cjs' }).code + '\nmodule.exports.issueReturnCredit = issueReturnCredit;', {
  module: bagModule, exports: bagModule.exports, Deno: { serve() {}, env: { get: () => '' } },
  require: () => ({ createClientFromRequest: () => { throw new Error('SYNTHETIC_ONLY request forbidden'); } }),
});
await test('bag-credit issuance and checkout hold both survive simultaneous CAS updates', async () => {
  const f = fixture(); const a = f.add(); await Promise.all([f.reserve(a.payment),
    bagModule.exports.issueReturnCredit(f.entities, email, 2, 'bag_return:synthetic_credit')]);
  assert.equal(f.wallet().balance, 12); assert.equal(f.wallet().reserved_balance, 6);
  assert.equal(await credit.availableCheckoutCredit(f.entities, email), 6);
});
await test('actual benefit dispatcher consumes reservation before awarding points; retry stays single', async () => {
  const f = fixture(); const a = f.add(); await f.reserve(a.payment);
  Object.assign(a.payment, { status: 'succeeded', amount_received: 3699 });
  const earned = new Set();
  const args = { entities: f.entities, order: a.order, checkoutData: a.data, paymentIntent: a.payment,
    event: { id: 'evt_synthetic_credit', created: 1788883200 },
    postLoyalty: async tx => { assert.equal(f.wallet().checkout_reservations[0].status, 'consumed'); earned.add(tx.idempotency_key); } };
  await settleEmbeddedPaymentBenefits(args); await settleEmbeddedPaymentBenefits(args);
  assert.equal(f.wallet().balance, 4); assert.equal(f.wallet().history.length, 1); assert.equal(earned.size, 1);
});
await test('partial provider receipt cannot consume a credit hold', async () => {
  const f = fixture(); const a = f.add(); await f.reserve(a.payment);
  Object.assign(a.payment, { status: 'succeeded', amount_received: 2000 });
  await assert.rejects(() => f.settle(a.payment), /not_fully_received/); assert.equal(f.wallet().reserved_balance, 6);
});
await test('missing consumed receipt cannot be represented as an idempotent success', async () => {
  const f = fixture(); const a = f.add(); await f.reserve(a.payment);
  Object.assign(a.payment, { status: 'succeeded', amount_received: 3699 }); await f.settle(a.payment);
  f.wallet().history = []; await assert.rejects(() => f.settle(a.payment), /receipt_mismatch/);
});
await test('customer balances show spendable value, not held value', () => {
  assert.equal(availableCreditBalance({ balance: 10, reserved_balance: 6 }), 4);
  assert.equal(availableCreditBalance({ balance: 10 }), 10);
  assert.equal(availableCreditBalance({ balance: 10, reserved_balance: 11 }), 0);
  assert.equal(availableCreditBalance(null), 0);
  for (const file of ['Checkout', 'ReturnReward']) assert.match(fs.readFileSync(`src/pages/${file}.jsx`, 'utf8'), /availableCreditBalance\(/);
});
await test('existing function names, strict schema fields and no production credit zero-charge hack', () => {
  const schema = JSON.parse(fs.readFileSync('base44/entities/NuViraCredit.jsonc', 'utf8'));
  assert.ok(schema.properties.reserved_balance); assert.ok(schema.properties.checkout_reservations);
  const entry = fs.readFileSync('base44/functions/createPaymentIntent/entry.ts', 'utf8');
  assert.match(entry, /creditReservationId && effectiveTotal < 0\.5/);
  assert.ok(entry.indexOf('await reserveCheckoutCredit(') > entry.indexOf('CHECKOUT_RECORDS_NOT_READY'));
  assert.ok(entry.indexOf('await reserveCheckoutCredit(') < entry.lastIndexOf('clientSecret:         paymentIntent.client_secret'));
});
await test('no-payment hold and receipt bind a Session, never a fake PaymentIntent', async () => {
  const f = fixture(); const a = f.addNoPayment(); await f.reserveSession(a.session);
  assert.equal(f.wallet().reserved_balance, 6); assert.equal(f.wallet().balance, 10);
  assert.equal(f.wallet().checkout_reservations[0].checkout_session_id, a.session.id);
  assert.equal(f.wallet().checkout_reservations[0].payment_intent_id, undefined);
  Object.assign(a.session, { status: 'complete', payment_status: 'no_payment_required' });
  await Promise.all([f.settleSession(a.session), f.settleSession(a.session)]);
  assert.equal(f.wallet().balance, 4); assert.equal(f.wallet().reserved_balance, 0);
  assert.equal(f.wallet().lifetime_used, 6); assert.equal(f.wallet().history.length, 1);
  assert.equal(f.wallet().history[0].checkout_session_id, a.session.id);
  assert.equal(f.wallet().history[0].payment_intent_id, undefined);
});
await test('card and no-payment checkouts compete on the same atomic credit balance', async () => {
  const f = fixture(); const a = f.add(); const b = f.addNoPayment();
  const result = await Promise.allSettled([f.reserve(a.payment), f.reserveSession(b.session)]);
  assert.equal(result.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(f.wallet().reserved_balance, 6); assert.equal(f.wallet().checkout_reservations.length, 1);
});
await test('simultaneous Session retries agree on one preparation owner', async () => {
  const f = fixture(); const a = f.addNoPayment();
  const result = await Promise.all([f.reserveSession(a.session, 'owner-one'), f.reserveSession(a.session, 'owner-two')]);
  assert.equal(result[0].preparation_attempt_id, result[1].preparation_attempt_id);
  assert.equal(f.wallet().checkout_reservations.length, 1); assert.equal(f.wallet().reserved_balance, 6);
});
await test('no-payment settlement leaves another card checkout hold intact', async () => {
  const f = fixture(); const a = f.add('a', 3); const b = f.addNoPayment();
  await Promise.all([f.reserve(a.payment), f.reserveSession(b.session)]);
  Object.assign(b.session, { status: 'complete', payment_status: 'no_payment_required' });
  await f.settleSession(b.session); assert.equal(f.wallet().balance, 4); assert.equal(f.wallet().reserved_balance, 3);
  assert.equal(await credit.availableCheckoutCredit(f.entities, email), 1);
});
await test('no-payment expiry releases once and blocks stale retry', async () => {
  const f = fixture(); const a = f.addNoPayment(); await f.reserveSession(a.session); a.session.status = 'expired';
  await Promise.all([f.settleSession(a.session), f.settleSession(a.session)]);
  assert.equal(f.wallet().balance, 10); assert.equal(f.wallet().reserved_balance, 0);
  assert.equal(f.wallet().history.length, 0); await assert.rejects(() => f.reserveSession(a.session));
});
await test('Session expiry before reserve creates a tombstone instead of a spendable race', async () => {
  const f = fixture(); const a = f.addNoPayment();
  f.fault.beforeCAS = async () => { a.session.status = 'expired'; await f.settleSession(a.session); };
  await assert.rejects(() => f.reserveSession(a.session));
  assert.equal(f.wallet().checkout_reservations[0].status, 'released');
  assert.equal(f.wallet().reserved_balance || 0, 0); assert.equal(f.wallet().balance, 10);
});
for (const phase of ['reserve', 'consume', 'release']) await test(`Session ${phase} recovers lost CAS acknowledgement once`, async () => {
  const f = fixture(); const a = f.addNoPayment();
  if (phase !== 'reserve') await f.reserveSession(a.session);
  if (phase === 'consume') Object.assign(a.session, { status: 'complete', payment_status: 'no_payment_required' });
  if (phase === 'release') a.session.status = 'expired';
  const run = () => phase === 'reserve' ? f.reserveSession(a.session) : f.settleSession(a.session);
  f.fault.lost = true; await assert.rejects(run); await run(); await run();
  assert.equal(f.wallet().balance, phase === 'consume' ? 4 : 10);
  assert.equal(f.wallet().reserved_balance, phase === 'reserve' ? 6 : 0);
  assert.equal(f.wallet().history.length, phase === 'consume' ? 1 : 0);
  assert.equal(f.wallet().checkout_reservations.length, 1);
});
await test('ignored credit CAS cannot expose a confirmed Session hold', async () => {
  const f = fixture(); const a = f.addNoPayment(); f.fault.ignored = true;
  await assert.rejects(() => f.reserveSession(a.session), /readback_unconfirmed/);
  assert.equal(f.wallet().reserved_balance || 0, 0);
});
for (const patch of [{ amount_total: 1 }, { payment_intent: 'pi_synthetic_forbidden' }, { livemode: false },
  { currency: 'eur' }, { customer_email: 'other@example.test' }, { status: 'processing' }]) {
  await test(`Session identity mutation rejected: ${JSON.stringify(patch)}`, async () => {
    const f = fixture(); const a = f.addNoPayment(); Object.assign(a.session, patch);
    await assert.rejects(() => f.reserveSession(a.session)); assert.equal(f.wallet().reserved_balance || 0, 0);
  });
}
for (const [name, mutate] of [
  ['priced total', a => { a.data.subtotal = 7; }],
  ['credit amount', a => { a.data.credits_discount = 5; }],
  ['owner', a => { a.data.customer_email = 'other@example.test'; }],
  ['items', a => { a.data.items[0].quantity = 2; }],
  ['birthday', a => { a.data.birthday_reservation_id = 'birthday:unreviewed'; }],
  ['context hash', a => { a.data.checkout_context_hash = 'f'.repeat(64); }],
  ['terminal order', a => { a.order.status = 'cancelled'; }],
  ['captured card', a => { a.order.payment_captured = true; }],
]) await test(`Session completion refuses mismatched private proof: ${name}`, async () => {
  const f = fixture(); const a = f.addNoPayment(); await f.reserveSession(a.session);
  Object.assign(a.session, { status: 'complete', payment_status: 'no_payment_required' }); mutate(a);
  await assert.rejects(() => f.settleSession(a.session));
  assert.equal(f.wallet().balance, 10); assert.equal(f.wallet().reserved_balance, 6);
  assert.equal(f.wallet().history.length, 0);
});
await test('completed Session cannot create a missing hold or debit an unreserved balance', async () => {
  const f = fixture(); const a = f.addNoPayment();
  Object.assign(a.session, { status: 'complete', payment_status: 'no_payment_required' });
  await assert.rejects(() => f.reserveSession(a.session)); await assert.rejects(() => f.settleSession(a.session));
  assert.equal(f.wallet().balance, 10); assert.equal(f.wallet().history.length, 0);
});
await test('Session consumed receipt cannot silently disappear on retry', async () => {
  const f = fixture(); const a = f.addNoPayment(); await f.reserveSession(a.session);
  Object.assign(a.session, { status: 'complete', payment_status: 'no_payment_required' }); await f.settleSession(a.session);
  f.wallet().history = []; await assert.rejects(() => f.settleSession(a.session), /receipt_mismatch/);
});
await test('provider or storage outage never releases a Session hold', async () => {
  for (const key of ['provider', 'outage']) {
    const f = fixture(); const a = f.addNoPayment(); await f.reserveSession(a.session); a.session.status = 'expired';
    f.fault[key] = true; await assert.rejects(() => f.settleSession(a.session)); f.fault[key] = false;
    assert.equal(f.wallet().reserved_balance, 6); assert.equal(f.wallet().balance, 10);
  }
});
await test('one hold cannot contain both card and Session provider identities', async () => {
  const f = fixture(); const a = f.addNoPayment(); await f.reserveSession(a.session);
  f.wallet().checkout_reservations[0].payment_intent_id = 'pi_synthetic_conflict';
  assert.throws(() => credit.creditAccountState(f.wallet()), /invalid_credit_reservations/);
});
console.log(`Credit reservation: ${passed}/${passed} passed; simulated provider/storage/CAS only, not a live release.`);
