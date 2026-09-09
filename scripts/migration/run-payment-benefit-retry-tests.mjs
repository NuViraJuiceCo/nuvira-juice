import assert from 'node:assert/strict';
import * as creditReservation from '../../base44/shared/checkoutCredit.js';
import * as birthdayCheckout from '../../base44/functions/createPaymentIntent/birthdayCheckout.js';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as benefits from '../../base44/functions/stripeWebhook/paymentBenefits.js';
import * as rewardWebhook from '../../base44/functions/stripeWebhook/rewardWebhook.js';
import { applyPointsTransaction, syncPointsMemberProjection } from '../../base44/functions/enrollNewCustomerInLoyalty/pointsAccount.js';
import * as pointsLedger from '../../base44/functions/enrollNewCustomerInLoyalty/pointsAccount.js';

// Execute the actual webhook with simulated signed events and in-memory stores.
// The test Stripe class cannot send requests; no provider credentials are used.
const email = 'payment-retry@example.test';
const payment = { id: 'pi_synthetic_retry', status: 'succeeded', currency: 'usd', amount_received: 4299,
  metadata: { customer_email: email, order_number: 'SYNTHETIC-RETRY', checkout_version: '3.0_embedded' } };
function match(row, query) {
  return Object.entries(query).every(([key, value]) => key === '$or' ? value.some(q => match(row, q))
    : value && typeof value === 'object' && '$exists' in value ? (row[key] !== undefined) === value.$exists : row[key] === value);
}
function fixture({ paid = false, reward = false, credit = 0, terminal = '', balance = 2000, directPoints = 0 } = {}) {
  const order = { id: 'order_synthetic', order_number: 'SYNTHETIC-RETRY', customer_email: email,
    stripe_payment_intent_id: payment.id, status: terminal || (paid ? 'scheduled_for_juicing' : 'pending_payment'),
    payment_status: paid ? 'paid' : 'pending', payment_captured: paid, total: 42.99,
    items: [{ product_id: 'oasis_synthetic', quantity: 3, price: 13 }], status_history: [] };
  const checkout = { customer_email: email, customer_name: 'Synthetic Buyer', points_used: 0, credits_discount: credit,
    active_reward: reward ? { id: 'reward_synthetic', points_required: 1000, title: 'Free bottle' } : null,
    assigned_production_day: '2026-09-11', assigned_delivery_date: '2026-09-12',
    assigned_delivery_window_start: '12:00', assigned_delivery_window_end: '15:00',
    delivery_window_label: 'Saturday 12 PM - 3 PM', final_schedule_source: 'backend_cadence', items: order.items };
  const rows = { Order: [order], CheckoutSession: [{ id: 'checkout_synthetic', stripe_session_id: payment.id, checkout_data: checkout }],
    UserPoints: [{ id: 'points_synthetic', customer_email: email, total_points: balance, lifetime_points: balance, redeemed_points: 0, points_history: [] }],
    LoyaltyMember: [{ id: 'member_synthetic', email, total_points: balance }],
    NuViraCredit: [{ id: 'credit_synthetic', customer_email: email, balance: 10, lifetime_used: 0, lifetime_issued: 10, history: [] }],
    OperationalAlert: [], OrderSyncLog: [], LoyaltyTransaction: [] };
  const provider = { ...structuredClone(payment), amount: 4299, livemode: true,
    metadata: { ...payment.metadata, checkout_mode: 'account', checkout_context_hash: 'a'.repeat(64),
      ...(directPoints ? { reward_reservation_id: `points:${'a'.repeat(64)}` } : {}) } };
  if (directPoints) {
    Object.assign(checkout, { order_number: order.order_number, total: 42.99, points_used: directPoints,
      points_discount: directPoints / 100, reward_reservation_id: provider.metadata.reward_reservation_id,
      reward_reservation_points: directPoints, checkout_context_hash: provider.metadata.checkout_context_hash,
      points_reservation_revision: pointsLedger.DIRECT_POINTS_CHECKOUT_REVISION });
    Object.assign(rows.CheckoutSession[0], { customer_email: email, order_number: order.order_number });
    Object.assign(rows.UserPoints[0], { reserved_points: directPoints, points_ledger_revision: 1,
      reward_reservations: [{ reservation_id: provider.metadata.reward_reservation_id,
        context_hash: provider.metadata.checkout_context_hash, payment_intent_id: payment.id,
        points: directPoints, status: 'held' }] });
    rows.LoyaltyMember[0].reserved_points = directPoints;
  }
  const entities = {}; const calls = []; const faults = { award: false, credit: false, member: false };
  for (const [name, list] of Object.entries(rows)) entities[name] = {
    filter: async query => structuredClone(list.filter(row => match(row, query))),
    create: async data => { const row = { ...structuredClone(data), id: `${name}_${list.length}` }; list.push(row); calls.push(`${name}.create`); return structuredClone(row); },
    update: async (id, data) => { const row = list.find(row => row.id === id); assert.ok(row);
      Object.assign(row, structuredClone(data)); calls.push(`${name}.update`); return structuredClone(row); },
    updateMany: async (query, data) => {
      if ((name === 'NuViraCredit' && faults.credit) || (name === 'LoyaltyMember' && faults.member)) throw new Error('Synthetic storage outage');
      const selected = list.filter(row => match(row, query)); assert.ok(selected.length <= 1);
      selected.forEach(row => Object.assign(row, structuredClone(data.$set))); calls.push(`${name}.CAS`);
      return { success: true, updated: selected.length, has_more: false };
    },
  };
  const postLoyalty = async data => {
    calls.push(`loyalty.${data.transaction_type}`);
    if (faults.award && data.transaction_type === 'earned') throw new Error('Synthetic award outage');
    const result = await applyPointsTransaction(entities, email, { ...data, id: `tx_${data.idempotency_key}` });
    await syncPointsMemberProjection(entities, email);
    return { success: true, idempotent: result.idempotent };
  };
  let ledgerHandler;
  const db = { auth: { me: async () => null }, asServiceRole: { entities, functions: { invoke: async (name, data) => {
    if (name === 'enrollNewCustomerInLoyalty') {
      if (directPoints && data.action === 'settle_reward_checkout') {
        calls.push('loyalty.settle_reservation');
        const response = await ledgerHandler(new Request('https://test.invalid/ledger', { method: 'POST', body: JSON.stringify(data) }));
        const body = await response.json();
        if (response.status !== 200) throw new Error(JSON.stringify(body));
        return { data: body };
      }
      assert.equal(data.action, 'post'); return { data: await postLoyalty(data) };
    }
    assert.ok(['pushOrderToShopify', 'syncOrderToHub', 'sendOrderReceivedNotification', 'getAdminOperationsDashboardSummary', 'sendCustomerNotification'].includes(name), name);
    calls.push(name); return { data: { success: true } };
  } } } };
  if (directPoints) {
    const ledgerModule = { exports: {} };
    vm.runInNewContext(transformSync(fs.readFileSync('base44/functions/enrollNewCustomerInLoyalty/entry.ts', 'utf8'),
      { loader: 'ts', format: 'cjs', target: 'es2022' }).code, {
      module: ledgerModule, exports: ledgerModule.exports, Request, Response, Date,
      console: { log() {}, warn() {}, error() {} },
      Deno: { serve: fn => { ledgerHandler = fn; }, env: { get: name =>
        name === 'STRIPE_SECRET_KEY' ? 'synthetic-stripe-secret' : name === 'LOYALTY_LEDGER_SECRET' ? 'synthetic-ledger-secret' : undefined } },
      require: name => {
        if (name.includes('@base44/sdk')) return { createClientFromRequest: () => db };
        if (name.includes('pointsAccount')) return pointsLedger;
        if (name.includes('stripe')) return class { paymentIntents = { retrieve: async id => {
          assert.equal(id, provider.id); calls.push('ledger.provider.read'); return structuredClone(provider);
        } }; };
        throw new Error(`Unexpected import ${name}`);
      },
    });
  }
  return { rows, order, checkout, entities, db, calls, faults, postLoyalty, provider };
}
const source = fs.readFileSync('base44/functions/stripeWebhook/entry.ts', 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
function serve(f) {
  let handler; const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, Request, Response, URL, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} }, Deno: { env: { get: name => name === 'LOYALTY_LEDGER_SECRET'
      ? 'synthetic-ledger-secret' : '' }, serve: fn => { handler = fn; } },
    require: name => {
      if (name.includes('@base44/sdk')) return { createClientFromRequest: () => f.db };
      if (name.includes('paymentBenefits')) return benefits;
      if (name.includes('checkoutCredit')) return creditReservation;
      if (name.includes('birthdayCheckout')) return birthdayCheckout;
      if (name.includes('rewardWebhook')) return rewardWebhook;
      if (name.includes('metaConversions')) return { sendMetaPurchaseConversion: async () => ({ sent: false, reason: 'synthetic' }) };
      if (name.includes('googleMeasurement')) return { sendGooglePurchaseMeasurement: async () => ({ sent: false, reason: 'synthetic' }) };
      if (name.includes('stripe')) return class { webhooks = { constructEventAsync: async raw => JSON.parse(raw) };
        paymentIntents = { retrieve: async id => {
          if (!f.providerRead) throw new Error('SYNTHETIC_ONLY unexpected provider read'); return f.providerRead(id);
        } }; };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return async (type = 'payment_intent.succeeded', changes = {}) => {
    const event = { id: `evt_synthetic_${type}`, type, created: 1788883200, livemode: true,
      data: { object: { ...structuredClone(payment), ...changes } } };
    const response = await handler(new Request('https://test.invalid/webhook', { method: 'POST',
      headers: { 'stripe-signature': 'synthetic-signature-not-a-provider-signature' }, body: JSON.stringify(event) }));
    return { status: response.status, body: await response.json() };
  };
}
const tests = []; const test = (name, fn) => tests.push([name, fn]);
test('Actual webhook decline preserves a retryable unpaid order without side effects', async () => {
  const f = fixture(); const before = structuredClone(f.rows); const result = await serve(f)('payment_intent.payment_failed', { status: 'requires_payment_method', amount_received: 0 });
  assert.equal(result.status, 200); assert.equal(result.body.action, 'payment_attempt_failed_retry_allowed');
  assert.deepEqual(f.rows, before); assert.equal(f.calls.length, 0);
});
test('Actual decline then retry succeeds and reaches normal fulfillment handoff', async () => {
  const f = fixture(); const invoke = serve(f);
  await invoke('payment_intent.payment_failed', { status: 'requires_payment_method', amount_received: 0 });
  const result = await invoke(); assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(f.order.payment_captured, true); assert.equal(f.order.status, 'scheduled_for_juicing');
  assert.equal(f.rows.UserPoints[0].total_points, 2429);
  assert.ok(f.calls.includes('syncOrderToHub')); assert.ok(f.calls.includes('sendOrderReceivedNotification'));
});
test('Delayed decline cannot cancel or abandon an already paid order', async () => {
  const f = fixture({ paid: true }); const before = structuredClone(f.rows);
  await serve(f)('payment_intent.payment_failed', { status: 'requires_payment_method', amount_received: 0 });
  assert.deepEqual(f.rows, before);
});
test('Failed award after redemption keeps order retryable and completes exactly once', async () => {
  const f = fixture({ reward: true, credit: 2 }); const invoke = serve(f); f.faults.award = true;
  assert.equal((await invoke()).status, 500); assert.equal(f.order.payment_captured, false);
  assert.equal(f.rows.UserPoints[0].total_points, 1000); assert.equal(f.rows.NuViraCredit[0].balance, 8);
  f.faults.award = false; assert.equal((await invoke()).status, 200);
  assert.equal(f.order.payment_captured, true); assert.equal(f.rows.UserPoints[0].total_points, 1429);
  assert.equal(f.rows.UserPoints[0].redeemed_points, 1000); assert.equal(f.rows.NuViraCredit[0].lifetime_used, 2);
  assert.equal(f.rows.NuViraCredit[0].history.length, 1);
});
test('Already-paid replay repairs missing benefit accounting without repeating communications', async () => {
  const f = fixture({ paid: true, reward: true, credit: 2 }); const invoke = serve(f);
  assert.equal((await invoke()).status, 200); const balance = f.rows.UserPoints[0].total_points;
  assert.equal((await invoke()).status, 200); assert.equal(f.rows.UserPoints[0].total_points, balance);
  assert.equal(balance, 1429); assert.equal(f.rows.NuViraCredit[0].balance, 8);
  assert.equal(f.calls.includes('sendOrderReceivedNotification'), false); assert.equal(f.calls.includes('syncOrderToHub'), false);
});
test('Terminal refunded order cannot be reactivated or awarded on old success replay', async () => {
  const f = fixture({ paid: true, terminal: 'refunded' }); const before = structuredClone(f.rows);
  assert.equal((await serve(f)()).body.action, 'skipped_terminal_state'); assert.deepEqual(f.rows, before);
});
test('Duplicate cancellation does not repeat alerts and cannot cancel a captured order', async () => {
  const f = fixture(); const invoke = serve(f);
  assert.equal((await invoke('payment_intent.canceled', { status: 'canceled', amount_received: 0 })).status, 200);
  assert.equal((await invoke('payment_intent.canceled', { status: 'canceled', amount_received: 0 })).body.action, 'skipped_terminal_state');
  assert.equal(f.rows.OperationalAlert.length, 1);
  const paid = fixture({ paid: true }); const before = structuredClone(paid.rows);
  await serve(paid)('payment_intent.canceled', { status: 'canceled', amount_received: 0 }); assert.deepEqual(paid.rows, before);
});
test('Credit redemption is atomic and repeat-safe for simultaneous webhook retries', async () => {
  const f = fixture(); const args = { email, orderId: f.order.id, orderNumber: f.order.order_number, paymentId: payment.id, amount: 2 };
  await Promise.all([benefits.applyCheckoutCredit(f.entities, args), benefits.applyCheckoutCredit(f.entities, args)]);
  assert.equal(f.rows.NuViraCredit[0].balance, 8); assert.equal(f.rows.NuViraCredit[0].history.length, 1);
});
test('Separate simultaneous credit debits preserve both movements', async () => {
  const f = fixture(); const args = { email, orderId: f.order.id, orderNumber: f.order.order_number, paymentId: payment.id, amount: 2 };
  await Promise.all([benefits.applyCheckoutCredit(f.entities, args), benefits.applyCheckoutCredit(f.entities,
    { ...args, orderId: 'other_order', paymentId: 'pi_other', amount: 3 })]);
  assert.equal(f.rows.NuViraCredit[0].balance, 5); assert.equal(f.rows.NuViraCredit[0].lifetime_used, 5);
});
test('Legacy order-bound credit receipts are recognized without repeat deductions', async () => {
  const f = fixture(); f.rows.NuViraCredit[0].history = [{ order_id: f.order.id, type: 'used', amount: 2 }];
  const result = await benefits.applyCheckoutCredit(f.entities, { email, orderId: f.order.id, paymentId: payment.id, amount: 2 });
  assert.equal(result.idempotent, true); assert.equal(f.rows.NuViraCredit[0].balance, 10);
});
test('Credit conflicts, insufficient balance and storage outage do not report success', async () => {
  const f = fixture(); const args = { email, orderId: f.order.id, paymentId: payment.id, amount: 2 };
  await assert.rejects(() => benefits.applyCheckoutCredit(f.entities, { ...args, amount: 11 }), /insufficient_checkout_credit/);
  f.faults.credit = true; await assert.rejects(() => benefits.applyCheckoutCredit(f.entities, args), /outage/);
  f.faults.credit = false; await benefits.applyCheckoutCredit(f.entities, args);
  await assert.rejects(() => benefits.applyCheckoutCredit(f.entities, { ...args, amount: 3 }), /checkout_credit_replay_conflict/);
});
test('A canonical double-points quote grants multiplier only after hold consumption', async () => {
  const f = fixture(); const paid = { ...payment, metadata: { ...payment.metadata, reward_reservation_id: 'synthetic_hold' } };
  const checkout = { ...f.checkout, active_reward: { id: 'double', points_required: 1500 },
    reward_checkout: { revision: '2026-09-08.reward-checkout-v1', points_multiplier: 2, active_reward: { id: 'double', reward_type: 'double_points' } } };
  let consumed = false;
  const result = await benefits.settleEmbeddedPaymentBenefits({ entities: f.entities, order: f.order,
    checkoutData: checkout, paymentIntent: paid, event: { id: 'evt_synthetic', created: 1788883200 },
    settleReservation: async () => { consumed = true; return { success: true, reservation_status: 'consumed' }; },
    postLoyalty: async tx => { assert.equal(consumed, true); await f.postLoyalty(tx); } });
  assert.equal(result.points_earned, 858);
});
test('Unvalidated legacy double-points text cannot grant a multiplier', async () => {
  const f = fixture(); const result = await benefits.settleEmbeddedPaymentBenefits({ entities: f.entities, order: f.order,
    checkoutData: { ...f.checkout, active_reward: { id: 'double', reward_type: 'double_points' } }, paymentIntent: payment,
    event: { id: 'evt_synthetic', created: 1788883200 }, postLoyalty: f.postLoyalty });
  assert.equal(result.points_earned, 429);
});
test('Incomplete hold settlement cannot award points', async () => {
  const f = fixture(); await assert.rejects(() => benefits.settleEmbeddedPaymentBenefits({ entities: f.entities, order: f.order,
    checkoutData: f.checkout, paymentIntent: { ...payment, metadata: { ...payment.metadata, reward_reservation_id: 'synthetic_hold' } },
    event: { id: 'evt_synthetic', created: 1788883200 }, postLoyalty: f.postLoyalty }), /reward_payment_settlement_unavailable/);
  assert.equal(f.rows.UserPoints[0].total_points, 2000);
});
test('Wrong customer and mismatched intent fail before benefit writes', async () => {
  for (const change of [{ customer_email: 'other@example.test' }, { stripe_payment_intent_id: 'pi_other' }]) {
    const f = fixture(); await assert.rejects(() => benefits.settleEmbeddedPaymentBenefits({ entities: f.entities,
      order: { ...f.order, ...change }, paymentIntent: payment, checkoutData: f.checkout,
      event: { id: 'evt_synthetic', created: 1788883200 }, postLoyalty: f.postLoyalty }), /payment_benefit_identity_mismatch/);
    assert.equal(f.calls.length, 0);
  }
});
const bagSource = fs.readFileSync('base44/functions/getBagReturnsForSync/entry.ts', 'utf8');
const bagModule = { exports: {} };
vm.runInNewContext(transformSync(bagSource, { loader: 'ts', format: 'cjs' }).code + '\nmodule.exports.issueReturnCredit = issueReturnCredit;', {
  module: bagModule, exports: bagModule.exports, console: { error() {} },
  Deno: { serve() {}, env: { get: () => '' } }, require: name => {
    assert.ok(name.includes('@base44/sdk')); return { createClientFromRequest: () => { throw new Error('No request context in helper test'); } };
  },
});
test('A simultaneous bag-credit issue cannot overwrite a checkout debit', async () => {
  const f = fixture(); await Promise.all([
    bagModule.exports.issueReturnCredit(f.entities, email, 1, 'bag_return:synthetic'),
    benefits.applyCheckoutCredit(f.entities, { email, orderId: f.order.id, paymentId: payment.id, amount: 2 }),
  ]);
  const credit = f.rows.NuViraCredit[0];
  assert.equal(credit.balance, 9); assert.equal(credit.lifetime_issued, 11); assert.equal(credit.lifetime_used, 2);
  assert.equal(credit.history.length, 2);
});
test('Concurrent bag verification issues credit once and rejects a changed replay', async () => {
  const f = fixture(); await Promise.all([
    bagModule.exports.issueReturnCredit(f.entities, email, 1, 'bag_return:synthetic'),
    bagModule.exports.issueReturnCredit(f.entities, email, 1, 'bag_return:synthetic'),
  ]);
  assert.equal(f.rows.NuViraCredit[0].balance, 11); assert.equal(f.rows.NuViraCredit[0].history.length, 1);
  await assert.rejects(() => bagModule.exports.issueReturnCredit(f.entities, email, 2, 'bag_return:synthetic'), /bag_credit_replay_conflict/);
});
test('Bag verification preserves old payment replay receipts beyond 200 entries', async () => {
  const f = fixture(); const credit = f.rows.NuViraCredit[0];
  credit.history = Array.from({ length: 220 }, (_, i) => ({ amount: 1, type: 'used', order_id: `old_order_${i}` }));
  await bagModule.exports.issueReturnCredit(f.entities, email, 1, 'bag_return:synthetic');
  assert.equal(credit.history.length, 221); assert.equal(credit.history[0].order_id, 'old_order_0');
});
test('Actual cancellation webhook rereads provider and releases credit before canceling order', async () => {
  const f = fixture(); const hash = 'a'.repeat(64); const holdId = `credit:${hash}`;
  const changes = { status: 'canceled', amount: 4299, amount_received: 0, livemode: true,
    metadata: { ...payment.metadata, checkout_mode: 'account', credit_reservation_id: holdId,
      credit_reservation_cents: '200', checkout_context_hash: hash } };
  f.rows.NuViraCredit[0].reserved_balance = 2;
  f.rows.NuViraCredit[0].checkout_reservations = [{ reservation_id: holdId, context_hash: hash,
    payment_intent_id: payment.id, amount_cents: 200, status: 'held' }];
  f.providerRead = id => { assert.equal(id, payment.id); return { ...structuredClone(payment), ...changes }; };
  const invoke = serve(f); assert.equal((await invoke('payment_intent.canceled', changes)).status, 200);
  assert.equal(f.rows.NuViraCredit[0].reserved_balance, 0); assert.equal(f.rows.NuViraCredit[0].balance, 10);
  assert.equal(f.rows.NuViraCredit[0].history.length, 0);
  assert.ok(f.calls.indexOf('NuViraCredit.CAS') < f.calls.indexOf('Order.update'));
  assert.equal((await invoke('payment_intent.canceled', changes)).status, 200);
  assert.equal(f.rows.NuViraCredit[0].checkout_reservations.length, 1);
});
test('Connected success webhook consumes direct-point hold once before award and normal handoff', async () => {
  const f = fixture({ directPoints: 500 }); const invoke = serve(f);
  assert.equal((await invoke('payment_intent.succeeded', f.provider)).status, 200);
  assert.equal(f.order.payment_captured, true); assert.equal(f.rows.UserPoints[0].total_points, 1929);
  assert.equal(f.rows.UserPoints[0].reserved_points, 0); assert.equal(f.rows.UserPoints[0].redeemed_points, 500);
  assert.equal(f.rows.LoyaltyMember[0].total_points, 1929);
  assert.equal(f.rows.LoyaltyTransaction.filter(row => row.status === 'posted').length, 1);
  assert.ok(f.calls.indexOf('loyalty.settle_reservation') < f.calls.indexOf('loyalty.earned'));
  assert.ok(f.calls.indexOf('loyalty.earned') < f.calls.indexOf('sendOrderReceivedNotification'));
  const notifications = f.calls.filter(call => call === 'sendOrderReceivedNotification').length;
  assert.equal((await invoke('payment_intent.succeeded', f.provider)).status, 200);
  assert.equal(f.rows.UserPoints[0].total_points, 1929); assert.equal(f.rows.LoyaltyTransaction.length, 1);
  assert.equal(f.calls.filter(call => call === 'sendOrderReceivedNotification').length, notifications);
});
test('Connected direct-point consumption survives failed award and recovers on webhook retry', async () => {
  const f = fixture({ directPoints: 500 }); const invoke = serve(f); f.faults.award = true;
  assert.equal((await invoke('payment_intent.succeeded', f.provider)).status, 500);
  assert.equal(f.order.payment_captured, false); assert.equal(f.rows.UserPoints[0].total_points, 1500);
  assert.equal(f.calls.includes('sendOrderReceivedNotification'), false);
  f.faults.award = false; assert.equal((await invoke('payment_intent.succeeded', f.provider)).status, 200);
  assert.equal(f.rows.UserPoints[0].total_points, 1929); assert.equal(f.rows.LoyaltyTransaction.length, 1);
});
test('Connected direct-point cancellation releases without earning or customer notifications', async () => {
  const f = fixture({ directPoints: 500 }); f.provider.status = 'canceled'; f.provider.amount_received = 0;
  const result = await serve(f)('payment_intent.canceled', f.provider);
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(f.order.status, 'cancelled');
  assert.equal(f.rows.UserPoints[0].total_points, 2000); assert.equal(f.rows.UserPoints[0].reserved_points, 0);
  assert.equal(f.rows.LoyaltyMember[0].reserved_points, 0); assert.equal(f.rows.LoyaltyTransaction.length, 0);
  assert.ok(f.calls.indexOf('loyalty.settle_reservation') < f.calls.indexOf('Order.update'));
  assert.equal(f.calls.includes('sendOrderReceivedNotification'), false);
});
test('Connected webhook rejects stale success when provider still processing and keeps points held', async () => {
  const f = fixture({ directPoints: 500 }); f.provider.status = 'processing'; f.provider.amount_received = 0;
  const result = await serve(f)('payment_intent.succeeded', { ...f.provider, status: 'succeeded', amount_received: 4299 });
  assert.equal(result.status, 500); assert.equal(f.order.payment_captured, false);
  assert.equal(f.rows.UserPoints[0].reserved_points, 500); assert.equal(f.rows.UserPoints[0].total_points, 2000);
  assert.equal(f.rows.LoyaltyTransaction.length, 0); assert.equal(f.calls.includes('sendOrderReceivedNotification'), false);
});
test('Actual webhook cannot release credit from an unconfirmed cancellation payload', async () => {
  const f = fixture(); const hash = 'a'.repeat(64); const changes = { status: 'canceled', amount: 4299,
    metadata: { ...payment.metadata, checkout_mode: 'account', credit_reservation_id: `credit:${hash}`,
      credit_reservation_cents: '200', checkout_context_hash: hash } };
  f.providerRead = () => ({ ...payment, status: 'processing' });
  const before = structuredClone(f.rows); const result = await serve(f)('payment_intent.canceled', changes);
  assert.ok(result.status >= 400); assert.deepEqual(f.rows, before);
});
function birthdayFixture() {
  const f = fixture(); const orderNumber = `NV-${'A'.repeat(24)}`;
  const gift = { product_id: 'oasis_synthetic', title: 'OASIS', price: 0, quantity: 1, category: 'juice', size: '12oz',
    isBirthdayReward: true, birthday_product_id: 'oasis_synthetic', catalog_unit_price: 13, birthday_discount_amount: 13 };
  Object.assign(f.order, { order_number: orderNumber, total: 29.99,
    items: [{ ...gift, isBirthdayReward: false, birthday_product_id: undefined, birthday_discount_amount: undefined, price: 13, quantity: 2 }, gift] });
  const snapshot = { revision: '2026-09-08.birthday-entitlement-v1', product_id: gift.product_id, retail_value_cents: 1300,
    cycle_year: 2026, month_day: '09-08', window_start: '2026-09-08', window_end: '2026-10-08' };
  Object.assign(f.provider, { amount: 2999, amount_received: 2999 });
  Object.assign(f.provider.metadata, { order_number: orderNumber, birthday_reservation_id: `birthday:${'a'.repeat(64)}` });
  Object.assign(f.checkout, { customer_app_user_id: 'synthetic-user', guest_checkout: false, total: 29.99, subtotal: 26,
    order_number: orderNumber, checkout_context_hash: 'a'.repeat(64), items: structuredClone(f.order.items),
    birthday_checkout: snapshot, birthday_reservation_id: f.provider.metadata.birthday_reservation_id, birthday_discount: 13 });
  Object.assign(f.rows.CheckoutSession[0], { customer_email: email, order_number: orderNumber });
  f.rows.UserPoints[0].birthday_reservations = [{ ...snapshot, status: 'held', created_at: '2026-09-08T05:01:00Z',
    reservation_id: f.provider.metadata.birthday_reservation_id, customer_app_user_id: 'synthetic-user',
    context_hash: 'a'.repeat(64), payment_intent_id: f.provider.id }];
  f.providerRead = id => { assert.equal(id, f.provider.id); f.calls.push('birthday.provider.read'); return structuredClone(f.provider); };
  return f;
}
test('Actual birthday success consumes annual gift before points and mocked normal handoff, replayed once', async () => {
  const f = birthdayFixture(); const invoke = serve(f);
  const result = await invoke('payment_intent.succeeded', f.provider); assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(f.rows.UserPoints[0].birthday_reservations[0].status, 'consumed');
  assert.equal(f.rows.UserPoints[0].total_points, 2299); assert.equal(f.order.payment_captured, true);
  assert.ok(f.calls.indexOf('UserPoints.CAS') < f.calls.indexOf('loyalty.earned'));
  assert.ok(f.calls.indexOf('loyalty.earned') < f.calls.indexOf('sendOrderReceivedNotification'));
  assert.ok(f.calls.includes('syncOrderToHub')); assert.ok(f.calls.includes('pushOrderToShopify'));
  const sent = f.calls.filter(name => name === 'sendOrderReceivedNotification').length;
  assert.equal((await invoke('payment_intent.succeeded', f.provider)).status, 200);
  assert.equal(f.rows.UserPoints[0].total_points, 2299);
  assert.equal(f.calls.filter(name => name === 'sendOrderReceivedNotification').length, sent);
});
test('Birthday consumption survives interrupted points award, then resumes the existing paid handoff', async () => {
  const f = birthdayFixture(); const invoke = serve(f); f.faults.award = true;
  assert.equal((await invoke('payment_intent.succeeded', f.provider)).status, 500);
  assert.equal(f.rows.UserPoints[0].birthday_reservations[0].status, 'consumed');
  assert.equal(f.order.payment_captured, false); assert.equal(f.calls.includes('sendOrderReceivedNotification'), false);
  f.faults.award = false; assert.equal((await invoke('payment_intent.succeeded', f.provider)).status, 200);
  assert.equal(f.order.payment_captured, true); assert.equal(f.rows.UserPoints[0].total_points, 2299);
});
test('Missing annual hold or stale provider success cannot fulfill a birthday order or send confirmation', async () => {
  for (const mode of ['hold', 'provider']) {
    const f = birthdayFixture(); const eventPayment = structuredClone(f.provider);
    if (mode === 'hold') f.rows.UserPoints[0].birthday_reservations = [];
    else { f.provider.status = 'processing'; f.provider.amount_received = 0; }
    assert.equal((await serve(f)('payment_intent.succeeded', eventPayment)).status, 500);
    assert.equal(f.order.payment_captured, false); assert.equal(f.rows.UserPoints[0].total_points, 2000);
    assert.equal(f.calls.includes('sendOrderReceivedNotification'), false); assert.equal(f.calls.includes('syncOrderToHub'), false);
  }
});
let passed = 0;
for (const [name, fn] of tests) { try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); throw error; } }
console.log(`Payment benefit retry: ${passed}/${tests.length}; actual handler with simulated Stripe and no network.`);
