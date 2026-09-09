import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as ledger from '../../base44/functions/enrollNewCustomerInLoyalty/pointsAccount.js';

// All records, outcomes, SDK calls and concurrency are in-memory. No network,
// customer records, Stripe, emails, push, inventory or production writes.
const customer = 'points-test@example.test';
const hash = 'a'.repeat(64);
const transaction = (key, amount, type = 'earned') => ({ id: `tx_${key}`, idempotency_key: key,
  customer_email: customer, amount, transaction_type: type, description: 'Synthetic transaction',
  source_id: 'synthetic', occurred_at: '2026-09-08T16:00:00Z' });
const hold = (id = 'checkout_attempt_one', points = 1000) => ({ reservation_id: id, points, context_hash: hash });
function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(clause => matches(row, clause));
    if (value && typeof value === 'object') {
      if ('$exists' in value) return (row[key] !== undefined) === value.$exists;
      throw new Error(`Unsupported test operator ${key}`);
    }
    return row[key] === value;
  });
}
function fixture({ balance = 2000, duplicate = false, empty = false, history = [], memberFail = false } = {}) {
  const points = { id: 'points-test', customer_email: customer, total_points: balance,
    lifetime_points: balance, redeemed_points: 0, points_history: history, claimed_rewards: [] };
  const rows = { UserPoints: empty ? [] : [points, ...(duplicate ? [{ ...points, id: 'duplicate-test' }] : [])],
    LoyaltyMember: [{ id: 'member-test', email: customer, total_points: balance }], LoyaltyTransaction: [], CheckoutSession: [], Order: [],
    RewardTier: [{ id: 'reward-test', points_required: 1000, is_active: true }] };
  const writes = []; const entities = {};
  const faults = { memberFail, rejectCas: false, uncertainWrite: false, badResponse: false };
  for (const [name, records] of Object.entries(rows)) entities[name] = {
    filter: async (query, sort, limit = 250) => structuredClone(records.filter(row => matches(row, query)).slice(0, limit)),
    create: async data => { const row = { ...structuredClone(data), id: `${name}-${records.length}` }; records.push(row); return structuredClone(row); },
    update: async (id, data) => {
      // Balances may only be changed by the conditional API under test.
      assert.equal(name, 'LoyaltyTransaction');
      const row = records.find(item => item.id === id); assert.ok(row); Object.assign(row, structuredClone(data));
      return structuredClone(row);
    },
    updateMany: async (query, data) => {
      assert.equal(typeof query.id, 'string'); assert.deepEqual(Object.keys(data), ['$set']);
      if (name === 'LoyaltyMember' && faults.memberFail) throw new Error('Synthetic member storage outage');
      if (faults.rejectCas) return { success: true, updated: 0, has_more: false };
      if (faults.badResponse) return { success: true, updated: 2, has_more: true };
      const selected = records.filter(row => matches(row, query)); assert.ok(selected.length <= 1);
      if (!(faults.ignoreAccountWrite && name === 'UserPoints') && !(faults.ignoreMemberWrite && name === 'LoyaltyMember')) {
        selected.forEach(row => Object.assign(row, structuredClone(data.$set)));
      }
      writes.push({ name, query: structuredClone(query), data: structuredClone(data) });
      if (faults.uncertainWrite) { faults.uncertainWrite = false; throw new Error('Synthetic lost response after write'); }
      return { success: true, updated: selected.length, has_more: false };
    },
  };
  const payment = { id: 'pi_synthetic', livemode: true, currency: 'usd', status: 'requires_payment_method',
    metadata: { checkout_mode: 'account', checkout_version: '3.0_embedded', customer_email: customer,
      reward_reservation_id: hold().reservation_id, checkout_context_hash: hash } };
  return { rows, entities, writes, faults, payment, account: () => rows.UserPoints[0] };
}
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const rejects = (fn, code) => assert.rejects(fn, error => error.code === code);

test('Concurrent earnings preserve both deltas, histories and lifetime points', async () => {
  const f = fixture();
  await Promise.all([ledger.applyPointsTransaction(f.entities, customer, transaction('one', 100)),
    ledger.applyPointsTransaction(f.entities, customer, transaction('two', 200))]);
  assert.equal(f.account().total_points, 2300); assert.equal(f.account().lifetime_points, 2300);
  assert.equal(f.account().points_history.length, 2); assert.equal(f.account().points_ledger_revision, 2);
});
test('Concurrent identical redemption applies one delta and one canonical receipt', async () => {
  const f = fixture();
  const results = await Promise.all([ledger.applyPointsTransaction(f.entities, customer, transaction('same', -1000, 'redeemed')),
    ledger.applyPointsTransaction(f.entities, customer, { ...transaction('same', -1000, 'redeemed'), id: 'tx_other' })]);
  assert.equal(f.account().total_points, 1000); assert.equal(f.account().redeemed_points, 1000);
  assert.equal(f.account().points_history.length, 1); assert.equal(results.filter(r => r.idempotent).length, 1);
  assert.equal(results[0].receipt.transaction_id, results[1].receipt.transaction_id);
});
test('Retry after a committed but lost response does not debit twice', async () => {
  const f = fixture(); f.faults.uncertainWrite = true;
  const tx = transaction('lost', -1000, 'redeemed');
  await assert.rejects(() => ledger.applyPointsTransaction(f.entities, customer, tx), /lost response/);
  const replay = await ledger.applyPointsTransaction(f.entities, customer, tx);
  assert.equal(replay.idempotent, true); assert.equal(f.account().total_points, 1000);
});
test('Pending legacy replay never restores a stale saved balance', async () => {
  const f = fixture({ balance: 1700, history: [{ idempotency_key: 'legacy', amount: -1000, type: 'redeemed' }] });
  const result = await ledger.applyPointsTransaction(f.entities, customer,
    { ...transaction('legacy', -1000, 'redeemed'), balance_after: 1000 });
  assert.equal(result.idempotent, true); assert.equal(f.account().total_points, 1700); assert.equal(f.writes.length, 0);
});
test('Replay rejects a changed transaction type or amount', async () => {
  const f = fixture(); await ledger.applyPointsTransaction(f.entities, customer, transaction('same', 100));
  await rejects(() => ledger.applyPointsTransaction(f.entities, customer, transaction('same', 101)), 'idempotency_key_conflict');
  await rejects(() => ledger.applyPointsTransaction(f.entities, customer, transaction('same', 100, 'bonus')), 'idempotency_key_conflict');
});
test('Two simultaneous reward checkouts cannot reserve the same points', async () => {
  const f = fixture({ balance: 1000 });
  const results = await Promise.allSettled([
    ledger.reserveRewardPoints(f.entities, customer, hold()),
    ledger.reserveRewardPoints(f.entities, customer, hold('checkout_attempt_two')),
  ]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.code, 'insufficient_points');
  assert.equal(f.account().reserved_points, 1000); assert.equal(f.account().total_points, 1000);
});
test('Same hold replay is stable and does not reserve again', async () => {
  const f = fixture(); await Promise.all([
    ledger.reserveRewardPoints(f.entities, customer, hold()), ledger.reserveRewardPoints(f.entities, customer, hold()),
  ]);
  assert.equal(f.account().reserved_points, 1000); assert.equal(f.account().reward_reservations.length, 1);
});
test('A reservation binds the exact cost and checkout context', async () => {
  const f = fixture(); await ledger.reserveRewardPoints(f.entities, customer, hold());
  await rejects(() => ledger.reserveRewardPoints(f.entities, customer, { ...hold(), points: 500 }), 'reservation_context_conflict');
  await rejects(() => ledger.reserveRewardPoints(f.entities, customer, { ...hold(), context_hash: 'b'.repeat(64) }), 'reservation_context_conflict');
});
test('Ordinary redemption cannot spend reserved points', async () => {
  const f = fixture({ balance: 1000 }); await ledger.reserveRewardPoints(f.entities, customer, hold());
  await rejects(() => ledger.applyPointsTransaction(f.entities, customer, transaction('other', -1, 'redeemed')), 'insufficient_points');
  assert.equal(f.account().total_points, 1000);
});
test('Earnings and holds coexist under simultaneous writes', async () => {
  const f = fixture({ balance: 1000 }); await Promise.all([
    ledger.reserveRewardPoints(f.entities, customer, hold()), ledger.applyPointsTransaction(f.entities, customer, transaction('earn', 250)),
  ]);
  assert.equal(f.account().total_points, 1250); assert.equal(f.account().reserved_points, 1000);
});
const settle = (status = 'succeeded') => ({ ...hold(), provider_status: status,
  payment_intent_id: 'pi_synthetic', settled_at: '2026-09-08T16:01:00Z' });
const redemption = () => transaction('stripe_payment:pi_synthetic:redeemed', -1000, 'redeemed');
test('Successful payment consumes a hold exactly once across repeated webhooks', async () => {
  const f = fixture(); await ledger.reserveRewardPoints(f.entities, customer, hold());
  await Promise.all([ledger.settleRewardPoints(f.entities, customer, settle(), redemption()),
    ledger.settleRewardPoints(f.entities, customer, settle(), { ...redemption(), id: 'tx_second' })]);
  assert.equal(f.account().total_points, 1000); assert.equal(f.account().reserved_points, 0);
  assert.equal(f.account().redeemed_points, 1000); assert.equal(f.account().points_history.length, 1);
  assert.equal(f.account().reward_reservations[0].status, 'consumed');
});
test('Confirmed cancellation releases without redeeming or earning points', async () => {
  const f = fixture(); await ledger.reserveRewardPoints(f.entities, customer, hold());
  await ledger.settleRewardPoints(f.entities, customer, settle('canceled'));
  await ledger.settleRewardPoints(f.entities, customer, settle('canceled'));
  assert.equal(f.account().total_points, 2000); assert.equal(f.account().reserved_points, 0);
  assert.equal(f.account().points_history.length, 0); assert.equal(f.account().redeemed_points, 0);
});
test('Declined, unconfirmed and locally timed-out payments retain the hold', async () => {
  const f = fixture(); await ledger.reserveRewardPoints(f.entities, customer, hold());
  for (const status of ['payment_failed', 'requires_payment_method', 'processing', 'expired', 'timeout', undefined]) {
    await rejects(() => ledger.settleRewardPoints(f.entities, customer, { ...settle(), provider_status: status }), 'confirmed_payment_outcome_required');
  }
  assert.equal(f.account().reserved_points, 1000);
});
test('A settled reservation cannot be moved to another payment or opposite outcome', async () => {
  const f = fixture(); await ledger.reserveRewardPoints(f.entities, customer, hold());
  await ledger.settleRewardPoints(f.entities, customer, settle(), redemption());
  await rejects(() => ledger.settleRewardPoints(f.entities, customer, settle('canceled')), 'reservation_outcome_conflict');
  await rejects(() => ledger.settleRewardPoints(f.entities, customer, { ...settle(), payment_intent_id: 'pi_other' }, redemption()), 'reservation_payment_conflict');
});
test('Released reservations cannot be reactivated by a delayed checkout', async () => {
  const f = fixture(); await ledger.reserveRewardPoints(f.entities, customer, hold());
  await ledger.settleRewardPoints(f.entities, customer, settle('canceled'));
  await rejects(() => ledger.reserveRewardPoints(f.entities, customer, hold()), 'reservation_already_released');
});
test('A refund reversal cannot silently consume another payment hold', async () => {
  const f = fixture({ balance: 1000 }); await ledger.reserveRewardPoints(f.entities, customer, hold());
  await rejects(() => ledger.applyPointsTransaction(f.entities, customer, transaction('refund', -100, 'reversal')), 'points_debit_conflicts_with_reservation');
});
test('Reconciliation cannot overwrite balances with an active payment hold', async () => {
  const f = fixture(); await ledger.reserveRewardPoints(f.entities, customer, hold());
  await rejects(() => ledger.applyPointsTransaction(f.entities, customer, transaction('reconcile', 0, 'adjustment'),
    { balanceAfter: 0, lifetimeAfter: 2000, redeemedAfter: 2000 }), 'points_reconciliation_has_active_reservations');
});
test('Missing and duplicate accounts cannot redeem or create a hold', async () => {
  for (const options of [{ empty: true }, { duplicate: true }]) {
    const f = fixture(options);
    await rejects(() => ledger.reserveRewardPoints(f.entities, customer, hold()), options.empty ? 'points_account_missing' : 'duplicate_points_accounts');
    assert.equal(f.writes.length, 0);
  }
});
test('Unsupported conditional API never falls back to an unconditional update', async () => {
  const f = fixture(); delete f.entities.UserPoints.updateMany;
  await rejects(() => ledger.reserveRewardPoints(f.entities, customer, hold()), 'conditional_points_updates_unavailable');
});
test('Unexpected conditional response is not reported as success', async () => {
  const f = fixture(); f.faults.badResponse = true;
  await rejects(() => ledger.reserveRewardPoints(f.entities, customer, hold()), 'conditional_points_update_unconfirmed');
});
test('CAS contention has a bounded retry and leaves balances intact', async () => {
  const f = fixture(); f.faults.rejectCas = true;
  await rejects(() => ledger.reserveRewardPoints(f.entities, customer, hold()), 'points_account_busy_retry');
  assert.equal(f.account().total_points, 2000);
});
test('Malformed and contradictory balances fail closed', async () => {
  for (const value of [null, '', true, -1, 0.5, 'bad', Number.MAX_SAFE_INTEGER + 1]) {
    const f = fixture(); f.account().total_points = value;
    await rejects(() => ledger.reserveRewardPoints(f.entities, customer, hold()), 'invalid_points_account');
  }
  const f = fixture(); f.account().reserved_points = 1;
  await rejects(() => ledger.reserveRewardPoints(f.entities, customer, hold()), 'invalid_points_reservations');
});
test('Projection repair reads current balance rather than stale transaction balance', async () => {
  const f = fixture(); await ledger.applyPointsTransaction(f.entities, customer, transaction('one', 100));
  await ledger.applyPointsTransaction(f.entities, customer, transaction('two', 200));
  await ledger.syncPointsMemberProjection(f.entities, customer);
  assert.equal(f.rows.LoyaltyMember[0].total_points, 2300);
  assert.equal(f.rows.LoyaltyMember[0].points_ledger_revision, 2);
  assert.deepEqual(f.rows.LoyaltyMember[0].points_history, f.account().points_history);
});
test('Concurrent mirrors converge without rolling a newer balance back', async () => {
  const f = fixture(); await ledger.applyPointsTransaction(f.entities, customer, transaction('one', 100));
  await Promise.all([ledger.syncPointsMemberProjection(f.entities, customer), (async () => {
    await ledger.applyPointsTransaction(f.entities, customer, transaction('two', 200));
    await ledger.syncPointsMemberProjection(f.entities, customer);
  })()]);
  assert.equal(f.rows.LoyaltyMember[0].total_points, 2300);
});

const entry = fs.readFileSync('base44/functions/enrollNewCustomerInLoyalty/entry.ts', 'utf8');
const compiled = transformSync(entry, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
function serve(f, role = 'admin') {
  let handler;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, Request, Response,
    console: { error() {} }, Deno: { env: { get: key => key === 'STRIPE_SECRET_KEY' ? 'synthetic-key-not-a-secret' : '' }, serve: fn => { handler = fn; } },
    require: name => {
      if (name.includes('@base44/sdk')) return { createClientFromRequest: () => ({
        auth: { me: async () => role ? { email: customer, role } : null }, asServiceRole: { entities: f.entities },
      }) };
      if (name.includes('pointsAccount')) return ledger;
      if (name.includes('stripe')) return class { paymentIntents = { retrieve: async id => {
        assert.equal(id, f.payment.id); return structuredClone(f.payment);
      } }; checkout = { sessions: { retrieve: async id => {
        assert.equal(id, f.session.id); return structuredClone(f.session);
      } } }; };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return async body => {
    const response = await handler(new Request('https://test.invalid/ledger', { method: 'POST', body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  };
}
test('Actual central handler rejects unauthenticated and customer balance writes', async () => {
  for (const [role, status] of [[null, 401], ['user', 403]]) {
    const f = fixture(); assert.equal((await serve(f, role)(transaction('one', 100))).status, status);
    assert.equal(f.writes.length, 0);
  }
});
test('Actual central handler repairs a member failure on paid transaction retry', async () => {
  const f = fixture({ memberFail: true }); const invoke = serve(f); const tx = transaction('one', 100);
  assert.equal((await invoke(tx)).status, 500); assert.equal(f.account().total_points, 2100);
  f.faults.memberFail = false; const replay = await invoke(tx);
  assert.equal(replay.status, 200); assert.equal(replay.body.idempotent, true);
  assert.equal(f.account().total_points, 2100); assert.equal(f.rows.LoyaltyMember[0].total_points, 2100);
  assert.equal(f.rows.LoyaltyTransaction[0].status, 'posted');
});
test('Actual concurrent central posts mark one canonical transaction posted', async () => {
  const f = fixture(); const invoke = serve(f);
  const responses = await Promise.all([invoke(transaction('one', 100)), invoke(transaction('one', 100))]);
  assert.ok(responses.every(r => r.status === 200));
  assert.equal(f.account().total_points, 2100); assert.equal(f.rows.LoyaltyTransaction.filter(row => row.status === 'posted').length, 1);
  assert.equal((await invoke(transaction('one', 100))).status, 200);
});
test('Crashed identical pending duplicates recover to one posted transaction', async () => {
  const f = fixture(); const tx = transaction('interrupted', 100);
  f.rows.LoyaltyTransaction.push({ ...tx, id: 'pending_one', status: 'pending' }, { ...tx, id: 'pending_two', status: 'pending' });
  assert.equal((await serve(f)(tx)).status, 200);
  assert.equal(f.account().total_points, 2100); assert.equal(f.account().points_history.length, 1);
  assert.equal(f.rows.LoyaltyTransaction.filter(row => row.status === 'posted').length, 1);
  assert.equal(f.rows.LoyaltyTransaction.filter(row => row.status === 'voided').length, 1);
});
test('Actual central handler rejects fractional point changes instead of truncating', async () => {
  const f = fixture(); assert.equal((await serve(f)(transaction('fraction', 1.5))).status, 400);
  assert.equal(f.writes.length, 0);
});
test('Existing first enrollment initializes once and records its signup receipt', async () => {
  const f = fixture({ empty: true }); const invoke = serve(f);
  assert.equal((await invoke(transaction('signup', 250, 'bonus'))).status, 200);
  assert.equal((await invoke(transaction('signup', 250, 'bonus'))).status, 200);
  assert.equal(f.rows.UserPoints.length, 1); assert.equal(f.account().total_points, 250);
});
test('Actual reservation endpoint verifies provider identity and canonical reward cost', async () => {
  const f = fixture(); const invoke = serve(f);
  const body = { action: 'reserve_reward_checkout', customer_email: customer,
    stripe_payment_intent_id: f.payment.id, reward_id: 'reward-test', points: 1000 };
  assert.equal((await invoke({ ...body, points: 1 })).body.error, 'reward_cost_changed');
  assert.equal(f.writes.length, 0);
  const reserved = await invoke(body); assert.equal(reserved.status, 200, JSON.stringify(reserved.body));
  assert.equal(f.account().reserved_points, 1000); assert.equal(f.account().reward_reservations[0].payment_intent_id, f.payment.id);
  assert.equal((await invoke(body)).body.idempotent, true);
});
test('Actual settlement ignores forged caller status and retains retryable hold', async () => {
  const f = fixture(); const invoke = serve(f);
  await invoke({ action: 'reserve_reward_checkout', customer_email: customer,
    stripe_payment_intent_id: f.payment.id, reward_id: 'reward-test', points: 1000 });
  const result = await invoke({ action: 'settle_reward_checkout', customer_email: customer,
    stripe_payment_intent_id: f.payment.id, provider_status: 'canceled' });
  assert.equal(result.body.deferred, true); assert.equal(f.account().reserved_points, 1000);
});
test('Actual settlement consumes provider-confirmed success exactly once', async () => {
  const f = fixture(); const invoke = serve(f);
  await invoke({ action: 'reserve_reward_checkout', customer_email: customer,
    stripe_payment_intent_id: f.payment.id, reward_id: 'reward-test', points: 1000 });
  f.payment.status = 'succeeded';
  const body = { action: 'settle_reward_checkout', customer_email: customer, stripe_payment_intent_id: f.payment.id };
  assert.equal((await invoke(body)).body.reservation_status, 'consumed');
  assert.equal((await invoke(body)).body.idempotent, true);
  assert.equal(f.account().total_points, 1000); assert.equal(f.account().reserved_points, 0);
  assert.equal(f.rows.LoyaltyTransaction.length, 1); assert.equal(f.rows.LoyaltyTransaction[0].status, 'posted');
  assert.equal(f.rows.LoyaltyMember[0].total_points, 1000);
});
test('Actual settlement releases provider-confirmed cancellation without a points transaction', async () => {
  const f = fixture(); const invoke = serve(f);
  await invoke({ action: 'reserve_reward_checkout', customer_email: customer,
    stripe_payment_intent_id: f.payment.id, reward_id: 'reward-test', points: 1000 });
  f.payment.status = 'canceled';
  assert.equal((await invoke({ action: 'settle_reward_checkout', customer_email: customer,
    stripe_payment_intent_id: f.payment.id })).body.reservation_status, 'released');
  assert.equal(f.account().total_points, 2000); assert.equal(f.account().reserved_points, 0);
  assert.equal(f.rows.LoyaltyTransaction.length, 0);
});
test('Actual endpoint rejects guest, test and mismatched provider payments', async () => {
  for (const change of [{ livemode: false }, { currency: 'eur' }, { metadata: { ...fixture().payment.metadata, checkout_mode: 'guest' } },
    { metadata: { ...fixture().payment.metadata, customer_email: 'other@example.test' } }]) {
    const f = fixture(); Object.assign(f.payment, change);
    const result = await serve(f)({ action: 'reserve_reward_checkout', customer_email: customer,
      stripe_payment_intent_id: f.payment.id, reward_id: 'reward-test', points: 1000 });
    assert.equal(result.body.error, 'reward_payment_identity_mismatch'); assert.equal(f.writes.length, 0);
  }
});

test('Actual checkout reserves the tier and direct-points discount as one indivisible hold', async () => {
  const f = fixture(); const invoke = serve(f);
  const body = { action: 'reserve_reward_checkout', customer_email: customer,
    stripe_payment_intent_id: f.payment.id, reward_id: 'reward-test', points: 1500, direct_points: 500 };
  assert.equal((await invoke(body)).body.reservation_status, 'held');
  assert.equal(f.account().reserved_points, 1500);
  f.payment.status = 'succeeded';
  assert.equal((await invoke(body)).body.idempotent, true, 'success retry only reuses its existing hold');
  assert.equal((await invoke({ action: 'settle_reward_checkout', customer_email: customer,
    stripe_payment_intent_id: f.payment.id })).body.reservation_status, 'consumed');
  assert.equal(f.account().total_points, 500); assert.equal(f.account().redeemed_points, 1500);
  assert.equal((await invoke(body)).body.reservation_status, 'consumed');
});
test('Actual reserve rejects malformed combined cost and cannot bootstrap a hold after payment', async () => {
  for (const patch of [{ direct_points: -1, points: 999 }, { direct_points: 0.5, points: 1000.5 },
    { direct_points: 500, points: 1000 }, { direct_points: '500', points: 1500 }]) {
    const f = fixture(); const result = await serve(f)({ action: 'reserve_reward_checkout', customer_email: customer,
      stripe_payment_intent_id: f.payment.id, reward_id: 'reward-test', ...patch });
    assert.equal(result.body.error, 'reward_cost_changed'); assert.equal(f.writes.length, 0);
  }
  const f = fixture(); f.payment.status = 'succeeded';
  const result = await serve(f)({ action: 'reserve_reward_checkout', customer_email: customer,
    stripe_payment_intent_id: f.payment.id, reward_id: 'reward-test', points: 1000 });
  assert.equal(result.body.error, 'reward_payment_not_reservable'); assert.equal(f.writes.length, 0);
});
test('Actual reward settlement recovers identical pending transactions left by a crashed retry', async () => {
  const f = fixture(); const invoke = serve(f);
  await invoke({ action: 'reserve_reward_checkout', customer_email: customer,
    stripe_payment_intent_id: f.payment.id, reward_id: 'reward-test', points: 1000 });
  const pending = { idempotency_key: `stripe_payment:${f.payment.id}:redeemed`,
    customer_email: customer, amount: -1000, transaction_type: 'redeemed', status: 'pending' };
  f.rows.LoyaltyTransaction.push({ id: 'pending-a', ...pending }, { id: 'pending-b', ...pending });
  f.payment.status = 'succeeded';
  const result = await invoke({ action: 'settle_reward_checkout', customer_email: customer, stripe_payment_intent_id: f.payment.id });
  assert.equal(result.body.reservation_status, 'consumed'); assert.equal(f.account().total_points, 1000);
  assert.equal(f.rows.LoyaltyTransaction.filter(row => row.status === 'posted').length, 1);
  assert.equal(f.rows.LoyaltyTransaction.filter(row => row.status === 'voided').length, 1);
});

function noPaymentFixture(options) {
  const f = fixture(options);
  f.session = { id: 'cs_synthetic_no_cost', livemode: true, currency: 'usd', mode: 'payment',
    amount_total: 0, payment_intent: null, status: 'open', payment_status: 'unpaid',
    metadata: { ...f.payment.metadata, checkout_version: '4.0_reward_no_payment', order_number: 'NV-SYNTHETIC-REWARD' } };
  f.rows.CheckoutSession.push({ id: 'context-no-cost', stripe_session_id: f.session.id,
    customer_email: customer, order_number: f.session.metadata.order_number,
    checkout_data: { customer_email: customer, order_number: f.session.metadata.order_number, total: 0,
      checkout_context_hash: hash, reward_reservation_id: hold().reservation_id, reward_reservation_points: 1000,
      reward_checkout: { revision: '2026-09-08.reward-checkout-v1' }, items: [{ product_id: 'synthetic-oasis', quantity: 6 }] } });
  f.reserve = { action: 'reserve_reward_checkout', customer_email: customer,
    stripe_checkout_session_id: f.session.id, reward_id: 'reward-test', points: 1000 };
  f.settle = { action: 'settle_reward_checkout', customer_email: customer, stripe_checkout_session_id: f.session.id };
  return f;
}
test('Zero-price Checkout reserves against the real Session, not a fabricated PaymentIntent', async () => {
  const f = noPaymentFixture(); const invoke = serve(f);
  assert.equal((await invoke(f.reserve)).body.reservation_status, 'held');
  assert.equal((await invoke(f.reserve)).body.idempotent, true);
  const reservation = f.account().reward_reservations[0];
  assert.equal(reservation.checkout_session_id, f.session.id);
  assert.equal(reservation.payment_intent_id, undefined);
  assert.equal(f.account().total_points, 2000); assert.equal(f.account().reserved_points, 1000);
});
test('No-payment completion consumes once and records no cash earnings or fictitious charge', async () => {
  const f = noPaymentFixture(); const invoke = serve(f); await invoke(f.reserve);
  f.session.status = 'complete'; f.session.payment_status = 'no_payment_required';
  const replies = await Promise.all([invoke(f.settle), invoke(f.settle)]);
  assert.ok(replies.every(r => r.body.reservation_status === 'consumed'), JSON.stringify(replies));
  assert.equal((await invoke(f.settle)).body.idempotent, true);
  assert.equal(f.account().total_points, 1000); assert.equal(f.account().lifetime_points, 2000);
  assert.equal(f.account().reserved_points, 0); assert.equal(f.account().redeemed_points, 1000);
  assert.equal(f.account().points_history.length, 1);
  assert.equal(f.account().points_history[0].idempotency_key, `stripe_checkout:${f.session.id}:redeemed`);
  assert.equal(f.rows.LoyaltyTransaction.filter(row => row.status === 'posted').length, 1);
  assert.equal(f.rows.LoyaltyMember[0].total_points, 1000);
  assert.equal((await invoke(f.reserve)).body.reservation_status, 'consumed');
});
test('Only provider-confirmed expiration releases a no-cost Session hold', async () => {
  const f = noPaymentFixture(); const invoke = serve(f); await invoke(f.reserve);
  assert.equal((await invoke({ ...f.settle, provider_status: 'expired' })).body.deferred, true);
  assert.equal(f.account().reserved_points, 1000);
  f.session.status = 'expired';
  assert.equal((await invoke(f.settle)).body.reservation_status, 'released');
  assert.equal((await invoke(f.settle)).body.idempotent, true);
  assert.equal(f.account().reserved_points, 0); assert.equal(f.account().total_points, 2000);
  assert.equal(f.rows.LoyaltyTransaction.length, 0);
  f.session.status = 'open';
  assert.equal((await invoke(f.reserve)).body.error, 'reservation_already_released');
});
test('Unpaid, nonzero, recurring, paid or PI-backed Sessions cannot settle a zero-price order', async () => {
  for (const patch of [{ status: 'complete', payment_status: 'unpaid' }, { amount_total: 1 },
    { amount_total: null }, { amount_total: '0' }, { mode: 'subscription' }, { payment_status: 'paid' },
    { payment_intent: 'pi_an_actual_charge' }, { payment_intent: undefined }, { status: 'canceled' }]) {
    const f = noPaymentFixture(); Object.assign(f.session, patch);
    const response = await serve(f)(f.reserve);
    assert.equal(response.body.error, 'no_payment_session_not_verified', JSON.stringify(patch));
    assert.equal(f.writes.length, 0);
  }
});
test('No-payment endpoint rejects customer, mode, currency, version and test mismatches', async () => {
  for (const patch of [{ livemode: false }, { currency: 'eur' },
    ...[{ customer_email: 'someoneelse@example.test' }, { checkout_mode: 'guest' },
      { checkout_version: '3.0_embedded' }, { is_test_order: 'true' }, { internal_sandbox_checkout: 'true' }]
      .map(metadata => ({ metadata: { ...noPaymentFixture().session.metadata, ...metadata } }))]) {
    const f = noPaymentFixture(); Object.assign(f.session, patch);
    assert.equal((await serve(f)(f.reserve)).body.error, 'reward_payment_identity_mismatch');
    assert.equal(f.writes.length, 0);
  }
});
test('A no-payment Session and a PaymentIntent cannot both identify the same request', async () => {
  const f = noPaymentFixture();
  assert.equal((await serve(f)({ ...f.reserve, stripe_payment_intent_id: f.payment.id })).body.error, 'reward_payment_identity_required');
  assert.equal(f.writes.length, 0);
});
test('No-payment completion needs the unique exact persisted priced context', async () => {
  const mutations = [rows => rows.splice(0), rows => rows.push({ ...rows[0], id: 'duplicate' }),
    ...['total', 'customer_email', 'order_number', 'checkout_context_hash', 'reward_reservation_id', 'reward_reservation_points', 'items', 'reward_checkout']
      .map(key => rows => { delete rows[0].checkout_data[key]; }),
    rows => { rows[0].customer_email = 'not-owner@example.test'; }];
  for (const mutate of mutations) {
    const f = noPaymentFixture(); const invoke = serve(f); await invoke(f.reserve);
    f.session.status = 'complete'; f.session.payment_status = 'no_payment_required';
    mutate(f.rows.CheckoutSession);
    assert.equal((await invoke(f.settle)).body.error, 'no_payment_checkout_context_missing');
    assert.equal(f.account().total_points, 2000); assert.equal(f.account().reserved_points, 1000);
    assert.equal(f.rows.LoyaltyTransaction.length, 0);
  }
});
test('Zero-price settlement recovers after the member projection is temporarily unavailable', async () => {
  const f = noPaymentFixture(); const invoke = serve(f); await invoke(f.reserve);
  f.session.status = 'complete'; f.session.payment_status = 'no_payment_required'; f.faults.memberFail = true;
  assert.equal((await invoke(f.settle)).status, 500);
  assert.equal(f.account().total_points, 1000);
  f.faults.memberFail = false;
  assert.equal((await invoke(f.settle)).body.reservation_status, 'consumed');
  assert.equal(f.account().total_points, 1000); assert.equal(f.rows.LoyaltyMember[0].total_points, 1000);
  assert.equal(f.rows.LoyaltyTransaction.filter(row => row.status === 'posted').length, 1);
});
test('A completed or expired Session cannot bootstrap a new hold', async () => {
  for (const status of ['complete', 'expired']) {
    const f = noPaymentFixture(); f.session.status = status; f.session.payment_status = 'no_payment_required';
    assert.equal((await serve(f)(f.reserve)).body.error, 'reward_payment_not_reservable');
    assert.equal(f.writes.length, 0);
  }
});
test('Session-bound holds cannot be swapped to another Session or PaymentIntent', async () => {
  const f = noPaymentFixture(); const invoke = serve(f); await invoke(f.reserve);
  const request = { ...hold(), checkout_session_id: f.session.id, no_payment_required: true, provider_status: 'expired' };
  await rejects(() => ledger.reserveRewardPoints(f.entities, customer, { ...hold(), payment_intent_id: f.payment.id }), 'reservation_payment_conflict');
  await rejects(() => ledger.settleRewardPoints(f.entities, customer, { ...request, checkout_session_id: 'cs_other' }), 'reservation_payment_conflict');
  await rejects(() => ledger.settleRewardPoints(f.entities, customer, settle('canceled')), 'reservation_payment_conflict');
  await rejects(() => ledger.settleRewardPoints(f.entities, customer, { ...request, no_payment_required: false }), 'confirmed_payment_outcome_required');
  assert.equal(f.account().reserved_points, 1000);
});
test('No-payment completion and expiration cannot overwrite each others terminal accounting', async () => {
  for (const first of ['complete', 'expired']) {
    const f = noPaymentFixture(); const invoke = serve(f); await invoke(f.reserve);
    f.session.status = first; f.session.payment_status = 'no_payment_required';
    const result = await invoke(f.settle); assert.equal(result.status, 200, JSON.stringify(result.body));
    f.session.status = first === 'complete' ? 'expired' : 'complete';
    assert.equal((await invoke(f.settle)).body.error, 'reservation_outcome_conflict');
    assert.equal(f.account().total_points, first === 'complete' ? 1000 : 2000);
  }
});
test('Nullable new schema field does not break an existing PaymentIntent hold', async () => {
  const f = fixture();
  const request = { ...hold(), payment_intent_id: f.payment.id };
  await ledger.reserveRewardPoints(f.entities, customer, request);
  f.account().reward_reservations[0].checkout_session_id = null;
  assert.equal((await ledger.reserveRewardPoints(f.entities, customer, request)).idempotent, true);
  assert.equal((await ledger.settleRewardPoints(f.entities, customer, settle(), redemption())).reservation.status, 'consumed');
  assert.equal(f.account().total_points, 1000);
});
test('Corrupt double-bound and malformed provider holds are rejected before settlement writes', async () => {
  for (const patch of [{ payment_intent_id: 'pi_one', checkout_session_id: 'cs_two' },
    { payment_intent_id: 'cs_not_a_payment' }, { checkout_session_id: 'pi_not_a_session' }]) {
    const f = fixture(); await ledger.reserveRewardPoints(f.entities, customer, hold());
    Object.assign(f.account().reward_reservations[0], patch);
    await rejects(() => ledger.settleRewardPoints(f.entities, customer, settle(), redemption()), 'invalid_points_reservations');
    assert.equal(f.account().total_points, 2000);
  }
});

function directFixture() {
  const f = fixture();
  f.payment.amount = 2999;
  f.payment.metadata.order_number = 'NV-SYNTHETIC-POINTS';
  f.payment.metadata.reward_reservation_id = `points:${'c'.repeat(64)}`;
  f.rows.Order.push({ id: 'order-points', stripe_payment_intent_id: f.payment.id, customer_email: customer,
    order_number: f.payment.metadata.order_number, total: 29.99, status: 'pending_payment' });
  f.rows.CheckoutSession.push({ id: 'context-points', stripe_session_id: f.payment.id, customer_email: customer,
    order_number: f.payment.metadata.order_number, checkout_data: {
      customer_email: customer, order_number: f.payment.metadata.order_number, total: 29.99,
      points_used: 1000, points_discount: 10, reward_discount: 0, active_reward: null,
      points_reservation_revision: ledger.DIRECT_POINTS_CHECKOUT_REVISION,
      reward_reservation_points: 1000, reward_reservation_id: f.payment.metadata.reward_reservation_id,
      checkout_context_hash: hash,
    } });
  f.reserve = { action: 'reserve_reward_checkout', customer_email: customer, stripe_payment_intent_id: f.payment.id,
    reward_id: null, direct_points: 1000, points: 1000 };
  f.settle = { action: 'settle_reward_checkout', customer_email: customer, stripe_payment_intent_id: f.payment.id };
  return f;
}
test('Direct-point cancellation before reservation persists a tombstone against delayed reserve', async () => {
  const f = directFixture(); f.payment.status = 'canceled'; const invoke = serve(f);
  assert.equal((await invoke(f.settle)).body.reservation_status, 'released');
  assert.equal(f.account().reserved_points ?? 0, 0); assert.equal(f.account().total_points, 2000);
  const request = { reservation_id: f.payment.metadata.reward_reservation_id, context_hash: hash, points: 1000, payment_intent_id: f.payment.id };
  await rejects(() => ledger.reserveRewardPoints(f.entities, customer, request), 'reservation_already_released');
  assert.equal((await invoke(f.settle)).body.reservation_status, 'released'); assert.equal(f.rows.LoyaltyTransaction.length, 0);
});
test('Direct-point provider and saved context bind both reserve and successful settlement', async () => {
  const f = directFixture(); const invoke = serve(f);
  assert.equal((await invoke(f.reserve)).body.reservation_status, 'held');
  f.payment.status = 'succeeded'; f.payment.amount_received = f.payment.amount;
  assert.equal((await invoke(f.settle)).body.reservation_status, 'consumed');
  assert.equal((await invoke(f.settle)).body.reservation_status, 'consumed');
  assert.equal(f.account().total_points, 1000); assert.equal(f.rows.LoyaltyMember[0].total_points, 1000);
  assert.equal(f.rows.LoyaltyTransaction.filter(row => row.status === 'posted').length, 1);
});
for (const [name, change] of [
  ['missing order', f => { f.rows.Order.length = 0; }],
  ['duplicate order', f => f.rows.Order.push({ ...f.rows.Order[0], id: 'other' })],
  ['missing context', f => { f.rows.CheckoutSession.length = 0; }],
  ['duplicate context', f => f.rows.CheckoutSession.push({ ...f.rows.CheckoutSession[0], id: 'other' })],
  ['foreign order', f => { f.rows.Order[0].customer_email = 'other@example.test'; }],
  ['foreign context', f => { f.rows.CheckoutSession[0].checkout_data.customer_email = 'other@example.test'; }],
  ['changed context hash', f => { f.rows.CheckoutSession[0].checkout_data.checkout_context_hash = 'd'.repeat(64); }],
  ['changed point value', f => { f.rows.CheckoutSession[0].checkout_data.points_discount = 1; }],
  ['changed point cost', f => { f.rows.CheckoutSession[0].checkout_data.reward_reservation_points = 1; }],
  ['fractional points', f => { f.rows.CheckoutSession[0].checkout_data.points_used = 1000.5; }],
  ['changed charge', f => { f.payment.amount = 100; }],
  ['subminimum charge', f => { f.payment.amount = 0; }],
  ['tier reward mixing', f => { f.rows.CheckoutSession[0].checkout_data.active_reward = { id: 'reward-test' }; }],
  ['missing revision', f => { delete f.rows.CheckoutSession[0].checkout_data.points_reservation_revision; }],
  ['refunded order', f => { f.rows.Order[0].payment_status = 'refunded'; }],
  ['test order', f => { f.rows.Order[0].is_test_order = true; }],
]) test(`Direct-point ${name} rejects reservation before any balance or projection write`, async () => {
  const f = directFixture(); change(f); const result = await serve(f)(f.reserve);
  assert.notEqual(result.status, 200); assert.equal(f.writes.length, 0); assert.equal(f.account().total_points, 2000);
});
test('Direct-point cost cannot be changed through an internal caller or a tier selector', async () => {
  for (const patch of [{ points: 1 }, { direct_points: 1 }, { reward_id: 'reward-test' }]) {
    const f = directFixture(); const result = await serve(f)({ ...f.reserve, ...patch });
    assert.equal(result.body.error, 'reward_cost_changed'); assert.equal(f.writes.length, 0);
  }
});
test('Direct-point underpayment and changed snapshot cannot consume a held balance', async () => {
  const f = directFixture(); const invoke = serve(f);
  assert.equal((await invoke(f.reserve)).body.reservation_status, 'held');
  f.payment.status = 'succeeded'; f.payment.amount_received = 1;
  assert.notEqual((await invoke(f.settle)).status, 200); assert.equal(f.account().reserved_points, 1000);
  f.payment.amount_received = f.payment.amount; f.rows.CheckoutSession[0].checkout_data.points_used = 999;
  assert.notEqual((await invoke(f.settle)).status, 200); assert.equal(f.account().total_points, 2000);
});
test('False account write acknowledgement is rejected by independent readback', async () => {
  const f = fixture(); f.faults.ignoreAccountWrite = true;
  await rejects(() => ledger.reserveRewardPoints(f.entities, customer, hold()), 'conditional_points_readback_unconfirmed');
  assert.equal(f.account().reserved_points ?? 0, 0);
});
test('False member acknowledgement cannot report a current projection', async () => {
  const f = fixture(); f.faults.ignoreMemberWrite = true;
  await rejects(() => ledger.syncPointsMemberProjection(f.entities, customer), 'loyalty_projection_busy_retry');
});

let passed = 0;
for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}
console.log(`Points reservation/accounting: ${passed}/${tests.length}; in-memory conditional-write model only, no provider traffic.`);
