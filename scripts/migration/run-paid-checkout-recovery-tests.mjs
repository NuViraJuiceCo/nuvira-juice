import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as attempt from '../../src/lib/paidCheckoutAttempt.js';
import * as rewardAttempt from '../../src/lib/rewardCheckoutAttempt.js';

let count = 0;
const test = async (name, run) => { await run(); count++; console.log('PASS', name); };
const owner = 'account:synthetic-user';
const email = 'buyer@example.test';
const attemptKey = 'synthetic-attempt-key-123456789';
const guestToken = 'synthetic-guest-token-123456789';
const store = () => { const values = new Map(); return { values,
  getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
for (const who of [owner, 'guest']) await test(`${who} opaque attempt survives reload with no card, cart, name or address saved`, async () => {
  const storage = store();
  const saved = await attempt.savePaidCheckoutAttempt(storage, { owner: who, email, attemptKey, guestToken });
  assert.deepEqual(attempt.readPaidCheckoutAttempt(storage, who), saved);
  assert.equal(saved.guest_order_token, who === 'guest' ? guestToken : null);
  assert.doesNotMatch(JSON.stringify(saved), /buyer@|customer_name|address|clientSecret|items|card/);
  const again = await attempt.savePaidCheckoutAttempt(storage, { owner: who, email, attemptKey, guestToken }, 1);
  assert.equal(again.created_at, saved.created_at);
  await assert.rejects(attempt.savePaidCheckoutAttempt(storage, { owner: who, email, attemptKey: `${attemptKey}other`, guestToken }));
  assert.throws(() => attempt.clearPaidCheckoutAttempt(storage, { ...saved, attempt_key: `${attemptKey}other` }));
  attempt.clearPaidCheckoutAttempt(storage, saved); assert.equal(attempt.readPaidCheckoutAttempt(storage, who), null);
});
await test('corrupt, blocked, ignored or failed storage writes never authorize preparation', async () => {
  const storage = store(); storage.setItem(`nuvira_paid_checkout_attempt_v1:${owner}`, '{bad');
  assert.throws(() => attempt.readPaidCheckoutAttempt(storage, owner));
  await assert.rejects(attempt.savePaidCheckoutAttempt(storage, { owner, email, attemptKey }));
  await assert.rejects(attempt.savePaidCheckoutAttempt({ ...store(), setItem() {} }, { owner, email, attemptKey }));
  const valid = store(); const saved = await attempt.savePaidCheckoutAttempt(valid, { owner, email, attemptKey });
  assert.throws(() => attempt.clearPaidCheckoutAttempt({ ...valid, removeItem() {} }, saved));
  assert.throws(() => attempt.readPaidCheckoutAttempt({ getItem() { throw new Error('disabled'); } }, owner));
});
const saved = await attempt.savePaidCheckoutAttempt(store(), { owner, email, attemptKey });
const response = { ok: true, revision: attempt.PAID_RECOVERY_REVISION, order_number: saved.order_number,
  state: 'requires_payment_method', total: 42.99, currency: 'usd', guest_checkout: false,
  items: [{ title: 'OASIS', price: 13, quantity: 3 }], writes_performed: false, payment_confirmation_attempted: false,
  payment_intent_created: false, order_created: false };
await test('read-only response requires exact revision, owner, flags, amount and identity', async () => {
  assert.equal((await attempt.requestPaidRecovery(async () => ({ data: response }), saved, 'read_paid_checkout_recovery')).ok, true);
  for (const patch of [{ revision: 'old' }, { order_number: 'NV-WRONG' }, { ok: false }, { total: 0 },
    { writes_performed: true }, { order_created: true }, { payment_intent_created: true }, { currency: 'eur' },
    { guest_checkout: true }, { state: 'unknown' }, { items: [] }, { items: [{ title: {} }] },
    { clientSecret: 'unexpected' }, { delivery_window: {} }]) {
    await assert.rejects(attempt.requestPaidRecovery(async () => ({ data: { ...response, ...patch } }), saved, 'read_paid_checkout_recovery'));
  }
});
await test('cancellation response cannot unlock on partial cancellation or failed benefit release', async () => {
  const cancelled = { ...response, payment_attempt_canceled: true, benefit_reservations_released: true, order_cancelled: true };
  assert.equal((await attempt.requestPaidRecovery(async () => ({ data: cancelled }), saved, 'cancel_paid_checkout')).ok, true);
  for (const key of ['payment_attempt_canceled', 'benefit_reservations_released', 'order_cancelled']) {
    await assert.rejects(attempt.requestPaidRecovery(async () => ({ data: { ...cancelled, [key]: false } }), saved, 'cancel_paid_checkout'));
  }
});
await test('timeouts do not retry, clear or create another payment', async () => {
  let calls = 0;
  await assert.rejects(attempt.requestPaidRecovery(() => { calls++; return new Promise(() => {}); }, saved, 'read_paid_checkout_recovery', 1));
  assert.equal(calls, 1);
});

// Execute the actual recovery controller, with only UI setters and transport
// mocked. This exercises action ordering, double taps and stale completions.
const source = fs.readFileSync('src/components/checkout/PaidCheckoutRecovery.jsx', 'utf8');
const tree = ts.createSourceFile('Recovery.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
let runSource;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'run') runSource = node.initializer.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree); assert.ok(runSource);
function controller({ data = response, wait = null, failed = false } = {}) {
  const calls = []; const alive = { current: true }; const inFlight = { current: false };
  const set = key => value => calls.push([key, value]);
  const run = vm.runInNewContext(`(${runSource})`, { attempt: saved, alive, inFlight,
    setBusy: set('busy'), setProof: set('proof'), setMessage: set('message'), setPayment: set('payment'),
    unavailable: 'safe failure', requestPaidRecovery: attempt.requestPaidRecovery,
    onCancelled: async value => calls.push(['cancelled', value]),
    base44: { functions: { invoke: async (name, payload) => {
      assert.equal(name, 'createPaymentIntent'); calls.push(['invoke', payload.mode]);
      if (wait) await wait; if (failed) throw new Error('PRIVATE'); return { data };
    } } },
  });
  return { calls, alive, inFlight, run };
}
await test('actual controller reads without resuming payment or claiming fulfillment', async () => {
  const ctx = controller(); await ctx.run('read_paid_checkout_recovery');
  assert.deepEqual(ctx.calls.filter(([name]) => name === 'invoke'), [['invoke', 'read_paid_checkout_recovery']]);
  assert.equal(ctx.calls.find(([name]) => name === 'payment')[1], null);
  assert.equal(ctx.calls.some(([name]) => name === 'cancelled'), false);
});
await test('actual controller accepts a resume only after explicit verified action', async () => {
  const ctx = controller({ data: { ...response, clientSecret: 'pi_synthetic_secret_SYNTHETIC', publishableKey: 'pk_live_SYNTHETIC' } });
  await ctx.run('resume_paid_checkout');
  assert.equal(ctx.calls.find(([name]) => name === 'payment')[1].total, 42.99);
});
await test('actual controller suppresses double taps and ignores a completion after account/page change', async () => {
  let done; const waiting = new Promise(resolve => { done = resolve; });
  const ctx = controller({ wait: waiting }); const first = ctx.run('read_paid_checkout_recovery');
  await ctx.run('resume_paid_checkout'); ctx.alive.current = false; done(); await first;
  assert.equal(ctx.calls.filter(([name]) => name === 'invoke').length, 1);
  assert.equal(ctx.calls.some(([name]) => name === 'proof' || name === 'payment' || name === 'cancelled'), false);
});
await test('failed and partial cancellation keep recovery unresolved with safe copy', async () => {
  for (const options of [{ failed: true }, { data: { ...response, payment_attempt_canceled: true } }]) {
    const ctx = controller(options); await ctx.run('cancel_paid_checkout');
    assert.equal(ctx.calls.some(([name]) => name === 'cancelled'), false);
    assert.deepEqual(ctx.calls.find(([name]) => name === 'message'), ['message', 'safe failure']);
    assert.doesNotMatch(JSON.stringify(ctx.calls), /PRIVATE/);
  }
});
await test('actual controller unlock callback requires all three cancellation proofs', async () => {
  const ctx = controller({ data: { ...response, payment_attempt_canceled: true, benefit_reservations_released: true, order_cancelled: true } });
  await ctx.run('cancel_paid_checkout'); assert.equal(ctx.calls.filter(([name]) => name === 'cancelled').length, 1);
});
await test('checkout integration persists before the provider request and recovers before empty-cart redirect', () => {
  const checkout = fs.readFileSync('src/pages/Checkout.jsx', 'utf8');
  const start = checkout.slice(checkout.indexOf('paymentAttemptStarted = true;'));
  assert.ok(start.indexOf('await savePaidCheckoutAttempt') < start.indexOf("base44.functions.invoke('createPaymentIntent'"));
  assert.ok(checkout.indexOf('if (paidRecovery) return') < checkout.indexOf('items.length === 0 && !checkoutStartLocked'));
  assert.match(checkout, /if \(!rewardCheckoutSessionId && paidAttemptRef.current\)/);
  assert.match(checkout, /if \(proof.state === 'succeeded'\) forgetPaidAttempt\(\)/);
  assert.match(checkout, /readPaidCheckoutAttempt\(localStorage, 'guest'\)/);
  assert.match(checkout, /paidRecovery.attempt\?\.attempt_key/);
  const payment = fs.readFileSync('src/components/checkout/EmbeddedPayment.jsx', 'utf8');
  assert.match(payment, /recoverOnReturn \? '\/checkout' : '\/order-confirmation'/);
  assert.match(source, /<EmbeddedPayment recoverOnReturn/);
  assert.doesNotMatch(source, /clearCart\(|confirm\(|createPaymentIntent.*items:/);
});
const checkoutSource = fs.readFileSync('src/pages/Checkout.jsx', 'utf8');
const checkoutTree = ts.createSourceFile('Checkout.jsx', checkoutSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
let conversion;
function findConversion(node) {
  if (ts.isIfStatement(node) && node.expression.getText(checkoutTree) === 'validRewardSession') conversion = node.getText(checkoutTree);
  ts.forEachChild(node, findConversion);
}
findConversion(checkoutTree); assert.ok(conversion);
async function convert({ toReward, failStorage = false, changeOwner = false }) {
  const storage = store(); const user = { id: 'synthetic-user', email };
  const paidAttemptRef = { current: null }; const rewardAttemptTrackedRef = { current: !toReward };
  if (toReward) paidAttemptRef.current = await attempt.savePaidCheckoutAttempt(storage, { owner, email, attemptKey });
  else rewardAttempt.saveRewardCheckoutAttempt(storage, user.id, attemptKey);
  const identity = { current: `${user.id}:${email}` };
  const calls = [];
  const run = vm.runInNewContext(`(async () => { ${conversion} })`, {
    validRewardSession: toReward, user, isGuestCheckout: false, normalizedCustomerEmail: email, localStorage: storage,
    checkoutIdempotencyKey: { current: attemptKey }, guestOrderToken: { current: null },
    paidAttemptRef, rewardAttemptTrackedRef, checkoutAttemptInFlightRef: { current: true }, checkoutCustomerIdentityRef: identity,
    saveRewardCheckoutAttempt: (...args) => { calls.push('save_reward'); if (failStorage) throw new Error('storage blocked'); return rewardAttempt.saveRewardCheckoutAttempt(...args); },
    savePaidCheckoutAttempt: async (...args) => { calls.push('save_paid'); if (failStorage) throw new Error('storage blocked');
      const result = await attempt.savePaidCheckoutAttempt(...args); if (changeOwner) identity.current = 'other'; return result; },
    forgetPaidAttempt: () => { calls.push('clear_paid'); attempt.clearPaidCheckoutAttempt(storage, paidAttemptRef.current); paidAttemptRef.current = null; },
    forgetRewardAttempt: () => { calls.push('clear_reward'); rewardAttempt.clearRewardCheckoutAttempt(storage, user.id, attemptKey); rewardAttemptTrackedRef.current = false; },
  });
  return { storage, user, calls, run, paidAttemptRef, rewardAttemptTrackedRef };
}
for (const toReward of [true, false]) {
  await test(`actual provider-type conversion ${toReward ? 'paid to reward' : 'reward to paid'} saves replacement before clearing old marker`, async () => {
    const ctx = await convert({ toReward }); await ctx.run();
    assert.deepEqual(ctx.calls, toReward ? ['save_reward', 'clear_paid'] : ['save_paid', 'clear_reward']);
    assert.equal(Boolean(attempt.readPaidCheckoutAttempt(ctx.storage, owner)), !toReward);
    assert.equal(Boolean(rewardAttempt.readRewardCheckoutAttempt(ctx.storage, ctx.user.id)), toReward);
  });
  await test(`failed ${toReward ? 'reward' : 'paid'} marker conversion preserves previous recovery`, async () => {
    const ctx = await convert({ toReward, failStorage: true }); await assert.rejects(ctx.run());
    assert.equal(ctx.calls.length, 1);
    assert.equal(Boolean(attempt.readPaidCheckoutAttempt(ctx.storage, owner)), toReward);
    assert.equal(Boolean(rewardAttempt.readRewardCheckoutAttempt(ctx.storage, ctx.user.id)), !toReward);
  });
}
await test('account change during paid marker conversion cannot replace current refs or remove old-owner evidence', async () => {
  const ctx = await convert({ toReward: false, changeOwner: true }); await ctx.run();
  assert.equal(ctx.paidAttemptRef.current, null); assert.equal(ctx.rewardAttemptTrackedRef.current, true);
  assert.deepEqual(ctx.calls, ['save_paid']);
  assert.ok(attempt.readPaidCheckoutAttempt(ctx.storage, owner));
  assert.ok(rewardAttempt.readRewardCheckoutAttempt(ctx.storage, ctx.user.id));
});
console.log(`Paid checkout recovery: ${count}/${count} passed. Simulated browser storage/controller only; no provider calls or live writes.`);
