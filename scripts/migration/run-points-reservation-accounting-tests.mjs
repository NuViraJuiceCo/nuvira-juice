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
    LoyaltyMember: [{ id: 'member-test', email: customer, total_points: balance }], LoyaltyTransaction: [],
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
      selected.forEach(row => Object.assign(row, structuredClone(data.$set)));
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
      } }; };
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

let passed = 0;
for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}
console.log(`Points reservation/accounting: ${passed}/${tests.length}; in-memory conditional-write model only, no provider traffic.`);
