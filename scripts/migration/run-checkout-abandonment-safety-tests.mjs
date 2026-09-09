import assert from 'node:assert/strict';
import * as checkoutCredit from '../../base44/shared/checkoutCredit.js';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as pointsLedger from '../../base44/functions/enrollNewCustomerInLoyalty/pointsAccount.js';

// Execute the actual handler with isolated fake SDK/Stripe implementations.
// This file has no network access, credentials, real identities or provider writes.
const source = fs.readFileSync('base44/functions/cancelAbandonedCheckouts/entry.ts', 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
const ledgerCompiled = transformSync(fs.readFileSync('base44/functions/enrollNewCustomerInLoyalty/entry.ts', 'utf8'),
  { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
const email = 'checkout-cancel@example.test';
function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(clause => matches(row, clause));
    if (value && typeof value === 'object') {
      if ('$exists' in value) return (row[key] !== undefined) === value.$exists;
      if ('$ne' in value) return row[key] !== value.$ne;
      if ('$nin' in value) return !value.$nin.includes(row[key]);
      throw new Error(`Unexpected query operator ${key}`);
    }
    return row[key] === value;
  });
}
function fixture({ role = 'admin', noPayment = false, reward = false, realLedger = false, credit = false, directPoints = false, faults = {} } = {}) {
  const order = { id: 'synthetic-order', order_number: 'NV-SYNTHETIC-CANCEL', customer_email: email,
    status: 'pending_payment', payment_status: 'pending', financial_status: 'pending', payment_captured: false,
    created_date: '2026-09-07T00:00:00Z', updated_date: '2026-09-07T00:00:00Z', status_history: [],
    ...(noPayment ? { stripe_checkout_session_id: 'cs_synthetic' } : { stripe_payment_intent_id: 'pi_synthetic' }),
    ...(directPoints ? { total: 42 } : {}) };
  const provider = { id: noPayment ? 'cs_synthetic' : 'pi_synthetic', livemode: true, currency: 'usd',
    amount: 4200, amount_received: 0,
    status: noPayment ? 'open' : 'requires_payment_method',
    ...(noPayment ? { mode: 'payment', amount_total: 0, payment_intent: null, payment_status: 'unpaid' } : {}),
    metadata: { order_number: order.order_number, customer_email: email,
      checkout_version: noPayment ? '4.0_reward_no_payment' : '3.0_embedded',
      checkout_mode: 'account', checkout_context_hash: 'b'.repeat(64),
      ...(credit ? { credit_reservation_id: `credit:${'b'.repeat(64)}`, credit_reservation_cents: '200' } : {}),
      ...(reward ? { reward_reservation_id: directPoints ? `points:${'b'.repeat(64)}` : 'synthetic-reservation' } : {}) } };
  const effects = []; let releases = 0; let serve;
  const read = async id => {
    effects.push('provider.retrieve'); assert.equal(id, provider.id);
    if (faults.retrieve) throw new Error('Synthetic retrieve outage');
    return structuredClone(provider);
  };
  const cancel = async id => {
    effects.push('provider.cancel'); assert.equal(id, provider.id);
    if (faults.cancel) throw new Error('Synthetic cancellation outage');
    provider.status = noPayment ? 'expired' : 'canceled';
    if (faults.lostCancelResponse) { faults.lostCancelResponse = false; throw new Error('Synthetic response lost after cancellation'); }
    return { id, status: faults.wrongCancelStatus ? 'processing' : provider.status };
  };
  const entities = { Order: {
    filter: async query => matches(order, query) ? [structuredClone(order)] : [],
    update: async () => { throw new Error('Unconditional order writes forbidden'); },
    updateMany: async (query, update) => {
      effects.push('order.cas'); assert.deepEqual(Object.keys(update), ['$set']);
      if (faults.racePaid) { order.payment_captured = true; order.payment_status = 'paid'; }
      if (faults.raceHistory) { order.updated_date = '2026-09-08T01:00:00Z'; order.status_history.push({ message: 'Concurrent update' }); }
      if (faults.orderWrite) throw new Error('Synthetic order store outage');
      if (faults.badCasResponse) return { success: true, has_more: true, updated: 2 };
      const match = matches(order, query);
      if (match) Object.assign(order, structuredClone(update.$set));
      return { success: true, has_more: false, updated: match ? 1 : 0 };
    },
  } };
  if (faults.noCas) delete entities.Order.updateMany;
  const ledgerRows = { UserPoints: [{ id: 'points-synthetic', customer_email: email,
    total_points: 2000, lifetime_points: 2000, redeemed_points: 0, reserved_points: reward ? 1000 : 0,
    points_ledger_revision: 1, points_history: [],
    reward_reservations: reward ? [{ reservation_id: provider.metadata.reward_reservation_id, context_hash: 'b'.repeat(64),
      points: 1000, status: 'held', [noPayment ? 'checkout_session_id' : 'payment_intent_id']: provider.id }] : [] }],
    LoyaltyMember: [{ id: 'member-synthetic', email, total_points: 2000, reserved_points: reward ? 1000 : 0 }],
    LoyaltyTransaction: [],
    CheckoutSession: directPoints ? [{ id: 'checkout-synthetic', customer_email: email, order_number: order.order_number,
      stripe_session_id: provider.id, checkout_data: { customer_email: email, order_number: order.order_number,
        total: 42, points_used: 1000, points_discount: 10, reward_reservation_id: provider.metadata.reward_reservation_id,
        reward_reservation_points: 1000, checkout_context_hash: 'b'.repeat(64),
        points_reservation_revision: pointsLedger.DIRECT_POINTS_CHECKOUT_REVISION } }] : [],
    NuViraCredit: [{ id: 'credit_synthetic', customer_email: email, balance: 10, reserved_balance: credit ? 2 : 0,
      lifetime_used: 0, history: [], checkout_reservations: credit ? [{ reservation_id: `credit:${'b'.repeat(64)}`,
        context_hash: 'b'.repeat(64), payment_intent_id: 'pi_synthetic', amount_cents: 200, status: 'held' }] : [] }] };
  for (const [name, records] of Object.entries(ledgerRows)) entities[name] = {
    filter: async query => structuredClone(records.filter(row => matches(row, query))),
    create: async () => { throw new Error('Cancellation may not create a loyalty transaction'); },
    updateMany: async (query, update) => {
      if (name === 'NuViraCredit') {
        effects.push('credit.cas');
        if (faults.creditRelease) throw new Error('SYNTHETIC_ONLY credit release unavailable');
      }
      const selected = records.filter(row => matches(row, query)); assert.ok(selected.length <= 1);
      selected.forEach(row => Object.assign(row, structuredClone(update.$set)));
      return { success: true, has_more: false, updated: selected.length };
    },
  };
  let ledgerHandler;
  const db = { auth: { me: async () => role ? { role, email } : null }, asServiceRole: {
    entities, functions: { invoke: async (name, payload) => {
      effects.push('reward.release'); assert.equal(name, 'enrollNewCustomerInLoyalty');
      assert.equal(payload.action, 'settle_reward_checkout'); assert.equal(payload.customer_email, email);
      assert.equal(payload.internal_secret, 'synthetic-internal-secret');
      assert.equal(payload[noPayment ? 'stripe_checkout_session_id' : 'stripe_payment_intent_id'], provider.id);
      assert.equal(payload[noPayment ? 'stripe_payment_intent_id' : 'stripe_checkout_session_id'], undefined);
      assert.equal(provider.status, noPayment ? 'expired' : 'canceled');
      if (faults.release) throw new Error('Synthetic release unavailable');
      if (faults.releasePending) return { data: { success: true, reservation_status: 'held' } };
      if (realLedger) {
        const response = await ledgerHandler(new Request('https://test.invalid/ledger', { method: 'POST', body: JSON.stringify(payload) }));
        const result = await response.json();
        assert.equal(response.status, 200, JSON.stringify(result));
        return { data: result };
      }
      releases = 1; return { data: { success: true, reservation_status: 'released' } };
    } },
  } };
  if (realLedger) {
    const ledgerModule = { exports: {} };
    vm.runInNewContext(ledgerCompiled, {
      module: ledgerModule, exports: ledgerModule.exports, Request, Response, Date,
      console: { log() {}, warn() {}, error() {} },
      Deno: { serve: fn => { ledgerHandler = fn; }, env: { get: name => name === 'STRIPE_SECRET_KEY'
        ? 'synthetic-stripe-secret' : name === 'LOYALTY_LEDGER_SECRET' ? 'synthetic-internal-secret' : undefined } },
      require: name => {
        if (name.includes('@base44/sdk')) return { createClientFromRequest: () => db };
        if (name.includes('pointsAccount')) return pointsLedger;
        if (name.includes('stripe')) return class { paymentIntents = { retrieve: read };
          checkout = { sessions: { retrieve: read } }; };
        throw new Error(`Unexpected import ${name}`);
      },
    });
  }
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Request, Response, Date, console: { log() {}, warn() {}, error() {} },
    Deno: { serve: fn => { serve = fn; }, env: { get: name => name === 'LOYALTY_LEDGER_SECRET' && !faults.noSecret
      ? 'synthetic-internal-secret' : undefined } },
    require: name => {
      if (name.includes('@base44/sdk')) return { createClientFromRequest: () => db };
      if (name.includes('checkoutCredit')) return checkoutCredit;
      if (name.includes('stripe')) return class { paymentIntents = { retrieve: read, cancel };
        checkout = { sessions: { retrieve: read, expire: cancel } }; };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return { order, provider, effects, faults, ledgerRows, releases: () => releases,
    run: async (exact = false, patch = {}) => {
      const body = exact ? { action: 'cancel_exact_pending_checkout', order_number: order.order_number,
        expected_order_id: order.id, confirmation: 'cancel_unpaid_checkout', ...patch } : patch;
      const response = await serve(new Request('https://test.invalid/cancel', { method: 'POST', body: JSON.stringify(body) }));
      return { status: response.status, body: await response.json() };
    } };
}
const tests = []; const test = (name, fn) => tests.push([name, fn]);
for (const exact of [false, true]) {
  const label = exact ? 'Exact action' : 'Batch job';
  test(`${label}: confirm Stripe cancellation before conditional local cancellation`, async () => {
    const f = fixture(); const r = await f.run(exact);
    assert.equal(r.status, 200); assert.equal(f.order.status, 'cancelled');
    assert.deepEqual(f.effects, ['provider.retrieve', 'provider.cancel', 'order.cas']);
    assert.equal(f.order.do_not_recover, true); assert.equal(f.order.payment_captured, false);
  });
  test(`${label}: provider retrieval outage cannot cancel a local order`, async () => {
    const f = fixture({ faults: { retrieve: true } }); await f.run(exact);
    assert.equal(f.order.status, 'pending_payment'); assert.deepEqual(f.effects, ['provider.retrieve']);
  });
  test(`${label}: unconfirmed cancellation cannot cancel a local order`, async () => {
    for (const faults of [{ cancel: true }, { wrongCancelStatus: true }]) {
      const f = fixture({ faults }); await f.run(exact);
      assert.equal(f.order.status, 'pending_payment'); assert.ok(!f.effects.includes('order.cas'));
    }
  });
  test(`${label}: success, processing and authorization holds remain untouched`, async () => {
    for (const status of ['succeeded', 'processing', 'requires_capture', 'unknown']) {
      const f = fixture(); f.provider.status = status; await f.run(exact);
      assert.equal(f.order.status, 'pending_payment'); assert.deepEqual(f.effects, ['provider.retrieve']);
    }
  });
  test(`${label}: wrong customer, order, currency or mode cannot be canceled`, async () => {
    for (const patch of [{ livemode: false }, { currency: 'eur' },
      { metadata: { customer_email: 'someoneelse@example.test', order_number: 'NV-SYNTHETIC-CANCEL' } },
      { metadata: { customer_email: email, order_number: 'NV-OTHER' } }]) {
      const f = fixture(); Object.assign(f.provider, patch); await f.run(exact);
      assert.equal(f.order.status, 'pending_payment'); assert.deepEqual(f.effects, ['provider.retrieve']);
    }
  });
  test(`${label}: missing/ambiguous provider ID cannot silently abandon an order`, async () => {
    for (const kind of ['missing', 'both', 'invalid']) {
      const f = fixture();
      if (kind === 'missing') delete f.order.stripe_payment_intent_id;
      if (kind === 'both') f.order.stripe_checkout_session_id = 'cs_other';
      if (kind === 'invalid') f.order.stripe_payment_intent_id = 'not-a-pi';
      await f.run(exact); assert.equal(f.order.status, 'pending_payment'); assert.equal(f.effects.length, 0);
    }
  });
  test(`${label}: reward release must succeed before local cancellation`, async () => {
    const f = fixture({ reward: true }); await f.run(exact);
    assert.deepEqual(f.effects, ['provider.retrieve', 'provider.cancel', 'reward.release', 'order.cas']);
    assert.equal(f.releases(), 1); assert.equal(f.order.status, 'cancelled');
    for (const faults of [{ release: true }, { releasePending: true }]) {
      const failed = fixture({ reward: true, faults }); await failed.run(exact);
      assert.equal(failed.order.status, 'pending_payment'); assert.ok(!failed.effects.includes('order.cas'));
    }
  });
  test(`${label}: missing internal release credential stops before provider mutation`, async () => {
    const f = fixture({ reward: true, faults: { noSecret: true } }); await f.run(exact);
    assert.deepEqual(f.effects, ['provider.retrieve']); assert.equal(f.order.status, 'pending_payment');
  });
  test(`${label}: no-cost Session expiration uses the real Session ID and releases its hold`, async () => {
    const f = fixture({ noPayment: true, reward: true }); await f.run(exact);
    assert.equal(f.provider.status, 'expired'); assert.equal(f.releases(), 1); assert.equal(f.order.status, 'cancelled');
    assert.equal(f.order.stripe_payment_intent_id, undefined);
  });
  test(`${label}: completed/no-payment-required Session is never abandoned while webhook catches up`, async () => {
    const f = fixture({ noPayment: true, reward: true });
    f.provider.status = 'complete'; f.provider.payment_status = 'no_payment_required'; await f.run(exact);
    assert.equal(f.order.status, 'pending_payment'); assert.equal(f.releases(), 0);
    assert.deepEqual(f.effects, ['provider.retrieve']);
  });
  test(`${label}: no-cost identity cannot hide a real charge or subscription`, async () => {
    for (const patch of [{ amount_total: 100 }, { payment_intent: 'pi_paid' }, { mode: 'subscription' }, { payment_status: 'paid' }]) {
      const f = fixture({ noPayment: true }); Object.assign(f.provider, patch); await f.run(exact);
      assert.equal(f.order.status, 'pending_payment'); assert.deepEqual(f.effects, ['provider.retrieve']);
    }
  });
  test(`${label}: concurrent paid state or audit edit wins over stale cancellation`, async () => {
    for (const faults of [{ racePaid: true }, { raceHistory: true }]) {
      const f = fixture({ faults }); await f.run(exact);
      assert.equal(f.order.status, 'pending_payment'); assert.notEqual(f.order.do_not_recover, true);
      if (faults.racePaid) assert.equal(f.order.payment_status, 'paid');
      else assert.equal(f.order.status_history[0].message, 'Concurrent update');
    }
  });
  test(`${label}: provider response lost after cancellation safely recovers on retry`, async () => {
    const f = fixture({ reward: true, faults: { lostCancelResponse: true } }); await f.run(exact);
    assert.equal(f.provider.status, 'canceled'); assert.equal(f.order.status, 'pending_payment');
    await f.run(exact); assert.equal(f.order.status, 'cancelled'); assert.equal(f.releases(), 1);
    assert.equal(f.effects.filter(e => e === 'provider.cancel').length, 1);
  });
  test(`${label}: release or order-store interruption remains recoverable`, async () => {
    for (const fault of ['release', 'orderWrite']) {
      const f = fixture({ reward: true, faults: { [fault]: true } }); await f.run(exact);
      assert.equal(f.order.status, 'pending_payment'); f.faults[fault] = false;
      await f.run(exact); assert.equal(f.order.status, 'cancelled'); assert.equal(f.releases(), 1);
    }
  });
  test(`${label}: no conditional API stops before provider mutation`, async () => {
    const f = fixture({ faults: { noCas: true } }); assert.equal((await f.run(exact)).status, 503);
    assert.equal(f.effects.length, 0);
  });
  test(`${label}: already paid/refunded/terminal local states never contact Stripe`, async () => {
    for (const patch of [{ payment_captured: true }, { payment_status: 'paid' }, { financial_status: 'paid' },
      { payment_status: 'refunded' }, { do_not_recover: true }, { is_abandoned_checkout: true }]) {
      const f = fixture(); Object.assign(f.order, patch); await f.run(exact); assert.equal(f.effects.length, 0);
    }
  });
}
test('Unauthorized/customer callers cannot run either cancellation mode', async () => {
  for (const role of [null, 'user']) for (const exact of [true, false]) {
    const f = fixture({ role }); assert.equal((await f.run(exact)).status, role ? 403 : 401);
    assert.equal(f.effects.length, 0);
  }
});
test('Exact cancellation requires the precise identity and confirmation phrase', async () => {
  for (const patch of [{ confirmation: '' }, { expected_order_id: 'other' }, { order_number: 'OTHER' }]) {
    const f = fixture(); assert.ok((await f.run(true, patch)).status >= 400); assert.equal(f.effects.length, 0);
  }
});
test('Recent pending checkouts are not abandoned by the batch job', async () => {
  const f = fixture(); f.order.created_date = new Date().toISOString(); const r = await f.run();
  assert.equal(r.body.cancelled, 0); assert.equal(f.effects.length, 0);
});
test('Unexpected conditional-write response is not reported as a completed cancellation', async () => {
  for (const exact of [false, true]) {
    const f = fixture({ faults: { badCasResponse: true } }); const r = await f.run(exact);
    if (exact) assert.equal(r.status, 500);
    else assert.equal(r.body.results[0].action, 'skipped_unconfirmed_cancellation');
    assert.equal(f.order.status, 'pending_payment');
  }
});
for (const noPayment of [false, true]) {
  test(`Connected actual cancellation -> actual central ledger -> account/member release (${noPayment ? 'no-cost Session' : 'PaymentIntent'})`, async () => {
    const f = fixture({ noPayment, reward: true, realLedger: true });
    const result = await f.run(); assert.equal(result.body.cancelled, 1);
    assert.deepEqual(f.effects, ['provider.retrieve', 'provider.cancel', 'reward.release', 'provider.retrieve', 'order.cas']);
    assert.equal(f.ledgerRows.UserPoints[0].reserved_points, 0);
    assert.equal(f.ledgerRows.UserPoints[0].total_points, 2000);
    assert.equal(f.ledgerRows.UserPoints[0].reward_reservations[0].status, 'released');
    assert.equal(f.ledgerRows.LoyaltyMember[0].reserved_points, 0);
    assert.equal(f.ledgerRows.LoyaltyMember[0].total_points, 2000);
    assert.equal(f.ledgerRows.LoyaltyTransaction.length, 0);
  });
  test(`Connected release receipt survives an interrupted Order write and retry (${noPayment ? 'Session' : 'PaymentIntent'})`, async () => {
    const f = fixture({ noPayment, reward: true, realLedger: true, faults: { orderWrite: true } });
    await f.run(); assert.equal(f.order.status, 'pending_payment');
    assert.equal(f.ledgerRows.UserPoints[0].reward_reservations[0].status, 'released');
    f.faults.orderWrite = false;
    assert.equal((await f.run()).body.cancelled, 1);
    assert.equal(f.ledgerRows.UserPoints[0].total_points, 2000);
    assert.equal(f.ledgerRows.UserPoints[0].points_ledger_revision, 2);
    assert.equal(f.effects.filter(effect => effect === 'provider.cancel').length, 1);
  });
}
for (const exact of [false, true]) {
  test(`${exact ? 'Exact' : 'Batch'} cancellation connects direct-point context, provider truth and both balance projections`, async () => {
    const f = fixture({ directPoints: true, reward: true, realLedger: true, credit: true });
    assert.equal((await f.run(exact)).status, 200); assert.equal(f.order.status, 'cancelled');
    assert.equal(f.ledgerRows.UserPoints[0].reserved_points, 0); assert.equal(f.ledgerRows.UserPoints[0].total_points, 2000);
    assert.equal(f.ledgerRows.LoyaltyMember[0].reserved_points, 0); assert.equal(f.ledgerRows.LoyaltyTransaction.length, 0);
    assert.equal(f.ledgerRows.NuViraCredit[0].reserved_balance, 0); assert.equal(f.ledgerRows.NuViraCredit[0].balance, 10);
    assert.ok(f.effects.indexOf('reward.release') < f.effects.indexOf('order.cas'));
    const revisions = f.ledgerRows.UserPoints[0].points_ledger_revision;
    await f.run(exact); assert.equal(f.ledgerRows.UserPoints[0].points_ledger_revision, revisions);
  });
  test(`${exact ? 'Exact' : 'Batch'} direct-point context mismatch preserves balances until context is restored`, async () => {
    const f = fixture({ directPoints: true, reward: true, realLedger: true });
    const saved = f.ledgerRows.CheckoutSession[0].checkout_data; saved.points_used = 999;
    await f.run(exact); assert.equal(f.provider.status, 'canceled'); assert.equal(f.order.status, 'pending_payment');
    assert.equal(f.ledgerRows.UserPoints[0].reserved_points, 1000);
    saved.points_used = 1000; await f.run(exact);
    assert.equal(f.order.status, 'cancelled'); assert.equal(f.ledgerRows.UserPoints[0].reserved_points, 0);
    assert.equal(f.effects.filter(e => e === 'provider.cancel').length, 1);
  });
  test(`${exact ? 'Exact' : 'Batch'} cancellation releases actual credit hold before local order cancellation`, async () => {
    const f = fixture({ credit: true, reward: true, realLedger: true }); const result = await f.run(exact);
    assert.equal(result.status, 200); assert.equal(f.order.status, 'cancelled');
    assert.equal(f.ledgerRows.NuViraCredit[0].reserved_balance, 0); assert.equal(f.ledgerRows.NuViraCredit[0].balance, 10);
    assert.equal(f.ledgerRows.UserPoints[0].reserved_points, 0);
    assert.ok(f.effects.indexOf('credit.cas') < f.effects.indexOf('order.cas'));
  });
  test(`${exact ? 'Exact' : 'Batch'} uncertain credit release keeps the order recoverable and retries once`, async () => {
    const f = fixture({ credit: true, faults: { creditRelease: true } }); await f.run(exact);
    assert.equal(f.provider.status, 'canceled'); assert.equal(f.order.status, 'pending_payment');
    assert.equal(f.ledgerRows.NuViraCredit[0].reserved_balance, 2);
    f.faults.creditRelease = false; await f.run(exact);
    assert.equal(f.order.status, 'cancelled'); assert.equal(f.ledgerRows.NuViraCredit[0].reserved_balance, 0);
    assert.equal(f.effects.filter(e => e === 'provider.cancel').length, 1);
  });
}
let passed = 0;
for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}
console.log(`Checkout abandonment safety: ${passed}/${tests.length}; actual handler, synthetic provider/storage only.`);
