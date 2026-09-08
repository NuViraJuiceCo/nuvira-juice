import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { prepareNoPaymentCheckout, cancelNoPaymentCheckout } from '../../base44/functions/createPaymentIntent/noPaymentCheckout.js';
import { handleRewardCheckoutEvent } from '../../base44/functions/stripeWebhook/rewardWebhook.js';
import * as ledger from '../../base44/functions/enrollNewCustomerInLoyalty/pointsAccount.js';
import { readRewardCheckoutRecovery, cancelRewardCheckoutRecovery } from '../../src/lib/rewardCheckoutRecovery.js';

// Actual preparation, central ledger, and settlement code; all I/O simulated.
// No network, real credentials, customer orders, email, events, or inventory.
const email = 'reward-checkout@example.test';
const secret = 'synthetic-internal-ledger';
const ledgerCode = transformSync(fs.readFileSync('base44/functions/enrollNewCustomerInLoyalty/entry.ts', 'utf8'),
  { loader: 'ts', format: 'cjs' }).code;
const matches = (row, query) => Object.entries(query).every(([key, value]) => {
  if (key === '$or') return value.some(clause => matches(row, clause));
  if (value && typeof value === 'object') {
    if ('$ne' in value) return row[key] !== value.$ne;
    if ('$exists' in value) return (row[key] !== undefined) === value.$exists;
    throw new Error(`Unsupported query ${key}`);
  }
  return row[key] === value;
});
function fixture() {
  const schedule = { assigned_delivery_date: '2026-09-12', assigned_production_day: '2026-09-11',
    assigned_delivery_window_start: '12:00', assigned_delivery_window_end: '15:00', delivery_window_label: 'Saturday 12 PM - 3 PM' };
  const tier = { id: 'vip-test', is_active: true, reward_type: 'vip_box', points_required: 6000, title: 'VIP Box' };
  const quote = { revision: '2026-09-08.reward-checkout-v1', points_required: 6000, active_reward: tier };
  const pricing = { reservation_points: 6000, points_used: 0, credits_discount: 0, merchandise_total: 0 };
  const data = { order_number: 'NV-SYNTHETIC', customer_email: email, customer_name: 'Synthetic Buyer',
    items: ['OASIS', 'AURA', 'RE-NU'].map(title => ({ product_id: `synthetic-${title}`, title, quantity: 2,
      price: 0, size: '12 oz', category: 'juice', reward_id: tier.id, isFreeReward: true })),
    total: 0, subtotal: 0, delivery_fee: 0, credits_discount: 0, total_discounts: 78,
    points_used: 0, reward_reservation_points: 6000, reward_reservation_id: `reward:${'a'.repeat(64)}`,
    checkout_context_hash: 'b'.repeat(64), reward_checkout: quote, active_reward: tier,
    guest_checkout: false, internal_sandbox_checkout: false, health_advisory_acknowledged: true,
    health_advisory_version: 'synthetic', health_advisory_acknowledged_at: '2026-09-08T09:00:00Z',
    address_line1: '123 Example St', address_line2: '', address_city: 'Wentzville', address_state: 'MO',
    address_postal_code: '63385', contact_phone: '2025550100', ...schedule };
  const metadata = { checkout_version: '3.0_embedded', checkout_mode: 'account', customer_email: email,
    order_number: data.order_number, reward_reservation_id: data.reward_reservation_id,
    checkout_context_hash: data.checkout_context_hash, is_test_order: 'false', internal_sandbox_checkout: 'false' };
  const rows = { Order: [], CheckoutSession: [], RewardTier: [tier],
    BagReturn: [{ id: 'synthetic-bag', customer_email: email, order_id: 'pending', verification_status: 'requested' }],
    UserPoints: [{ id: 'points', customer_email: email, total_points: 7000, lifetime_points: 7000,
      redeemed_points: 0, reserved_points: 0, points_history: [], reward_reservations: [] }],
    LoyaltyMember: [{ id: 'member', email, total_points: 7000, reserved_points: 0 }], LoyaltyTransaction: [] };
  const effects = []; const faults = {}; const entities = {};
  let session; let parameters; let reserveCalls = 0;
  for (const [name, values] of Object.entries(rows)) entities[name] = {
    filter: async query => {
      if (faults[`${name}.read`]) throw new Error('synthetic-read-failure');
      return structuredClone(values.filter(row => matches(row, query)));
    },
    create: async data => {
      effects.push(`${name}.create`);
      if (faults[`${name}.create`]) throw new Error('synthetic-create-failure');
      const row = { ...structuredClone(data), id: `${name}-${values.length}`, updated_date: '2026-09-08T09:00:00Z' };
      values.push(row);
      if (faults[`${name}.lostResponse`]) throw new Error('synthetic-lost-response');
      return structuredClone(row);
    },
    update: async (id, patch) => {
      effects.push(`${name}.update`); assert.notEqual(name, 'Order', 'Order mutations must be conditional');
      const row = values.find(row => row.id === id); assert.ok(row); Object.assign(row, structuredClone(patch)); return structuredClone(row);
    },
    updateMany: async (query, patch) => {
      effects.push(`${name}.cas`);
      if (faults[`${name}.cas`]) throw new Error('synthetic-cas-failure');
      if (name === 'Order' && faults.cancelRace) values[0].updated_date = '2026-09-08T09:01:00Z';
      const selected = values.filter(row => matches(row, query)); assert.ok(selected.length <= 1);
      selected.forEach(row => Object.assign(row, structuredClone(patch.$set)));
      return { success: true, updated: selected.length, has_more: false };
    },
  };
  const stripe = { checkout: { sessions: {
    create: async (request, options) => {
      effects.push('Stripe.create');
      if (faults.create) throw new Error('synthetic secret must not appear in response');
      if (parameters) assert.equal(JSON.stringify({ request, options }), parameters, 'Stripe requires identical retry parameters');
      parameters ||= JSON.stringify({ request, options });
      session ||= { id: 'cs_live_SYNTHETIC', client_secret: ['cs_live_SYNTHETIC', 'secret', 'TEST_ONLY'].join('_'), livemode: true,
        status: 'open', currency: 'usd', mode: 'payment', amount_total: 0, payment_intent: null,
        payment_status: 'unpaid', expires_at: 1788901200, ...structuredClone(request) };
      if (faults.createdPatch) Object.assign(session, faults.createdPatch);
      return structuredClone(session);
    },
    retrieve: async id => { assert.equal(id, session.id); effects.push('Stripe.retrieve');
      if (faults.retrieve) throw new Error('synthetic-retrieve-failure'); return structuredClone(session); },
    expire: async id => { assert.equal(id, session.id); effects.push('Stripe.expire');
      if (faults.expire) throw new Error('synthetic-expire-failure');
      if (faults.expireRace) { session.status = 'complete'; session.payment_status = 'no_payment_required'; }
      else session.status = 'expired';
      return structuredClone(session);
    },
  } } };
  let ledgerHandler;
  const module = { exports: {} };
  vm.runInNewContext(ledgerCode, { module, exports: module.exports, Request, Response, Date,
    console: { log() {}, warn() {}, error() {} }, fetch: () => { throw new Error('Network forbidden'); },
    Deno: { serve: fn => { ledgerHandler = fn; }, env: { get: key => key === 'STRIPE_SECRET_KEY' ? 'synthetic-stripe'
      : key === 'LOYALTY_LEDGER_SECRET' ? secret : undefined } },
    require: name => {
      if (name.includes('@base44/sdk')) return { createClientFromRequest: () => ({ auth: { me: async () => null }, asServiceRole: { entities } }) };
      if (name.includes('pointsAccount')) return ledger;
      if (name.includes('stripe')) return class { checkout = stripe.checkout; };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const invoke = async (name, payload) => {
    assert.equal(name, 'enrollNewCustomerInLoyalty');
    effects.push(payload.action);
    if (payload.action === 'reserve_reward_checkout') reserveCalls++;
    if (faults.ledger) throw new Error('synthetic-ledger-failure');
    const response = await ledgerHandler(new Request('https://test.invalid/ledger', { method: 'POST', body: JSON.stringify(payload) }));
    const data = await response.json();
    if (faults.lostReserve && payload.action === 'reserve_reward_checkout') throw new Error('synthetic-reserve-response-lost');
    return { data };
  };
  const base44 = { asServiceRole: { entities, functions: { invoke } } };
  const options = { base44, stripe, data, metadata, quote, pricing, secret };
  const complete = () => { session.status = 'complete'; session.payment_status = 'no_payment_required'; };
  const webhook = type => handleRewardCheckoutEvent({ entities, stripe,
    event: { id: 'evt_SYNTHETIC', created: 1788865200, livemode: true, type, data: { object: structuredClone(session) } },
    internalSecretAvailable: true, runHandoff: null, verifySchedule: () => schedule,
    settleReservation: async payload => (await invoke('enrollNewCustomerInLoyalty', {
      ...payload, action: 'settle_reward_checkout', internal_secret: secret })).data,
  });
  return { options, data, metadata, quote, pricing, effects, faults, rows, complete, webhook,
    session: () => session, reserveCalls: () => reserveCalls,
    run: () => prepareNoPaymentCheckout(options),
    cancel: (customerEmail = email) => cancelNoPaymentCheckout({ base44, stripe, sessionId: session?.id, customerEmail, secret }) };
}
let count = 0;
async function test(name, fn) { await fn(); count++; console.log('PASS', name); }
await test('three actual flavors, six bottles, zero charge, exact held points before a usable secret', async () => {
  const f = fixture(); const result = await f.run(); assert.ok(result.clientSecret, JSON.stringify(result));
  assert.equal(result.checkoutKind, 'reward_no_payment'); assert.equal(result.effectiveTotal, 0);
  assert.equal(f.rows.UserPoints[0].reserved_points, 6000); assert.equal(f.rows.UserPoints[0].total_points, 7000);
  assert.equal(f.rows.LoyaltyTransaction.length, 0); assert.equal(f.rows.Order[0].payment_captured, false);
  assert.equal(f.rows.Order[0].status, 'pending_payment');
  assert.equal(f.rows.CheckoutSession[0].checkout_data.customer_email, email);
  assert.deepEqual(f.session().line_items.map(item => [item.price_data.product_data.name, item.quantity]), [['OASIS', 2], ['AURA', 2], ['RE-NU', 2]]);
  assert.ok(f.session().line_items.every(item => item.price_data.unit_amount === 0));
  assert.equal(f.session().payment_method_collection, undefined); assert.equal(f.session().success_url, undefined);
  assert.equal(f.session().return_url, undefined); assert.equal(f.session().redirect_on_completion, 'never');
});
await test('exact retry preserves provider parameters, reservation, original acknowledgment and record IDs', async () => {
  const f = fixture(); const first = await f.run(); f.data.health_advisory_acknowledged_at = '2026-09-08T09:00:30Z';
  const second = await f.run(); assert.equal(second.clientSecret, first.clientSecret); assert.equal(second.idempotent_replay, true);
  assert.equal(f.rows.Order.length, 1); assert.equal(f.rows.CheckoutSession.length, 1);
  assert.equal(f.rows.UserPoints[0].reserved_points, 6000); assert.equal(f.rows.UserPoints[0].reward_reservations.length, 1);
  assert.equal(f.rows.CheckoutSession[0].checkout_data.health_advisory_acknowledged_at, '2026-09-08T09:00:00Z');
});
await test('requested bag return survives no-cost order/context/provider preparation and settlement', async () => {
  const f = fixture(); f.data.bag_return_request_id = 'synthetic-bag'; f.metadata.bag_return_request_id = 'synthetic-bag';
  const response = await f.run(); assert.ok(response.clientSecret);
  assert.equal(f.rows.Order[0].bag_return_request_id, 'synthetic-bag');
  assert.equal(f.rows.CheckoutSession[0].checkout_data.bag_return_request_id, 'synthetic-bag');
  assert.equal(f.session().metadata.bag_return_request_id, 'synthetic-bag');
  const schema = JSON.parse(fs.readFileSync('base44/entities/Order.jsonc', 'utf8'));
  assert.equal(schema.properties.bag_return_request_id.type, 'string');
  f.complete(); assert.equal((await f.webhook('checkout.session.completed')).body.error, 'reward_checkout_handoff_pending');
  assert.equal(f.rows.Order[0].bag_return_request_id, 'synthetic-bag');
});
await test('changed bag-return reference in the pending order cannot expose a replay secret', async () => {
  const f = fixture(); f.data.bag_return_request_id = 'synthetic-bag'; f.metadata.bag_return_request_id = 'synthetic-bag';
  await f.run(); f.rows.Order[0].bag_return_request_id = 'foreign-bag';
  assert.equal((await f.run()).clientSecret, undefined);
});
for (const target of ['order', 'provider']) await test(`changed ${target} bag-return reference cannot settle or debit the reward`, async () => {
  const f = fixture(); f.data.bag_return_request_id = 'synthetic-bag'; f.metadata.bag_return_request_id = 'synthetic-bag';
  await f.run(); f.complete();
  if (target === 'order') f.rows.Order[0].bag_return_request_id = 'foreign-bag';
  else f.session().metadata.bag_return_request_id = 'foreign-bag';
  assert.equal((await f.webhook('checkout.session.completed')).body.error, 'reward_checkout_processing_unconfirmed');
  assert.equal(f.rows.UserPoints[0].total_points, 7000); assert.equal(f.rows.UserPoints[0].reserved_points, 6000);
  assert.equal(f.rows.LoyaltyTransaction.length, 0);
});
await test('bag-return metadata mismatch fails before any provider Session or points hold is created', async () => {
  const f = fixture(); f.data.bag_return_request_id = 'synthetic-bag';
  await assert.rejects(f.run, /reward_zero_checkout_invalid/); assert.deepEqual(f.effects, []);
});
for (const [name, mutate] of [
  ['foreign customer', f => { f.rows.BagReturn[0].customer_email = 'foreign@example.test'; }],
  ['other order', f => { f.rows.BagReturn[0].order_id = 'foreign-order'; }],
  ['unlinked verified bag', f => { f.rows.BagReturn[0].verification_status = 'verified'; }],
  ['missing record', f => { f.rows.BagReturn.length = 0; }],
  ['duplicate record', f => { f.rows.BagReturn.push({ ...f.rows.BagReturn[0] }); }],
  ['read error', f => { f.faults['BagReturn.read'] = true; }],
]) await test(`bag request ${name} fails before provider creation or reserving points`, async () => {
  const f = fixture(); f.data.bag_return_request_id = 'synthetic-bag'; f.metadata.bag_return_request_id = 'synthetic-bag';
  mutate(f); await assert.rejects(f.run); assert.deepEqual(f.effects, []);
  assert.equal(f.rows.UserPoints[0].reserved_points, 0);
});
await test('same settled checkout can replay after its exact bag return was linked and verified', async () => {
  const f = fixture(); f.data.bag_return_request_id = 'synthetic-bag'; f.metadata.bag_return_request_id = 'synthetic-bag';
  await f.run(); f.complete(); await f.webhook('checkout.session.completed');
  f.rows.BagReturn[0].order_id = f.rows.Order[0].id; f.rows.BagReturn[0].verification_status = 'verified';
  const result = await f.run(); assert.equal(result.checkoutCompleted, true); assert.equal(result.clientSecret, undefined);
  assert.equal(f.rows.LoyaltyTransaction.length, 1);
});
await test('prepare -> real central hold -> signed-event dispatcher -> real central redemption, no false full handoff', async () => {
  const f = fixture(); await f.run(); f.complete(); const response = await f.webhook('checkout.session.completed');
  assert.equal(response.status, 503); assert.equal(response.body.error, 'reward_checkout_handoff_pending');
  assert.equal(f.rows.UserPoints[0].reserved_points, 0); assert.equal(f.rows.UserPoints[0].total_points, 1000);
  assert.equal(f.rows.LoyaltyTransaction.length, 1); assert.equal(f.rows.LoyaltyTransaction[0].status, 'posted');
  assert.equal(f.rows.Order[0].payment_captured, false); assert.equal(f.rows.Order[0].reward_settlement.points_redeemed, 6000);
  await f.webhook('checkout.session.completed'); assert.equal(f.rows.LoyaltyTransaction.length, 1);
  const retry = await f.run(); assert.equal(retry.checkoutCompleted, true); assert.equal(retry.clientSecret, undefined);
  assert.equal(f.rows.UserPoints[0].total_points, 1000);
});
await test('cancel expires then independently retrieves and releases exactly once before making order inactive', async () => {
  const f = fixture(); await f.run(); const result = await f.cancel(); assert.equal(result.ok, true);
  assert.equal(f.rows.UserPoints[0].reserved_points, 0); assert.equal(f.rows.UserPoints[0].total_points, 7000);
  assert.equal(f.rows.Order[0].status, 'cancelled'); assert.equal(f.rows.Order[0].do_not_recover, true);
  const history = f.rows.Order[0].status_history.length;
  await f.cancel(); assert.equal(f.rows.Order[0].status_history.length, history);
  assert.equal(f.rows.LoyaltyTransaction.length, 0);
});
await test('natural expiration after preparation releases the same hold and cancels the pending order', async () => {
  const f = fixture(); await f.run(); f.session().status = 'expired';
  const result = await f.webhook('checkout.session.expired'); assert.equal(result.status, 200);
  assert.equal(f.rows.UserPoints[0].reserved_points, 0); assert.equal(f.rows.Order[0].status, 'cancelled');
});
for (const [name, mutation] of [
  ['nonzero total', f => { f.data.total = 0.01; }], ['delivery fee', f => { f.data.delivery_fee = 3.99; }],
  ['unreserved credit', f => { f.data.credits_discount = 1; }], ['credit pricing', f => { f.pricing.credits_discount = 1; }],
  ['guest', f => { f.data.guest_checkout = true; }], ['internal sandbox', f => { f.data.internal_sandbox_checkout = true; }],
  ['missing secret', f => { f.options.secret = ''; }], ['wrong hash', f => { f.metadata.checkout_context_hash = 'c'.repeat(64); }],
  ['wrong reservation', f => { f.data.reward_reservation_id = 'wrong'; }], ['wrong owner', f => { f.metadata.customer_email = 'foreign@example.test'; }],
  ['quantity zero', f => { f.data.items[0].quantity = 0; }], ['fractional quantity', f => { f.data.items[0].quantity = 1.5; }],
  ['empty title', f => { f.data.items[0].title = ''; }], ['empty cart', f => { f.data.items = []; }],
  ['unbound points', f => { f.pricing.reservation_points = 5999; }], ['wrong quote revision', f => { f.quote.revision = 'old'; }],
]) await test(`${name} is rejected before any I/O`, async () => {
  const f = fixture(); mutation(f); await assert.rejects(f.run()); assert.deepEqual(f.effects, []);
});
for (const [name, patch] of [
  ['nonzero provider total', { amount_total: 50 }], ['unexpected PI', { payment_intent: 'pi_SYNTHETIC' }],
  ['test provider mode', { livemode: false }], ['wrong currency', { currency: 'eur' }],
  ['wrong provider owner', { customer_email: 'foreign@example.test' }], ['missing expiry', { expires_at: null }],
  ['invalid secret', { client_secret: ['cs_other', 'secret', 'BAD'].join('_') }],
]) await test(`${name} never exposes a client secret`, async () => {
  const f = fixture(); f.faults.createdPatch = patch; const result = await f.run();
  assert.equal(result.ok, false); assert.equal(result.clientSecret, undefined);
});
for (const fault of ['Order.create', 'CheckoutSession.create', 'Order.lostResponse', 'CheckoutSession.lostResponse']) {
  await test(`${fault}: confirmed expiry releases the hold, no secret or success`, async () => {
    const f = fixture(); f.faults[fault] = true; const result = await f.run();
    assert.equal(result.ok, false); assert.equal(result.clientSecret, undefined);
    assert.equal(result.reward_reservation_released, true); assert.equal(f.rows.UserPoints[0].reserved_points, 0);
    if (f.rows.Order.length) assert.equal(f.rows.Order[0].status, 'cancelled');
  });
}
await test('lost reserve acknowledgment never expires another request claim; explicit cancellation safely recovers', async () => {
  const f = fixture(); f.faults.lostReserve = true; const result = await f.run();
  assert.equal(result.ok, false); assert.equal(result.clientSecret, undefined); assert.equal(result.reward_reservation_released, false);
  assert.equal(f.rows.UserPoints[0].reserved_points, 6000); assert.equal(f.effects.includes('Stripe.expire'), false);
  f.faults.lostReserve = false; const retry = await f.run(); assert.equal(retry.error_code, 'REWARD_CHECKOUT_PREPARING');
  assert.equal(f.rows.Order.length, 0); assert.equal(f.rows.CheckoutSession.length, 0);
  await f.cancel(); assert.equal(f.rows.UserPoints[0].reserved_points, 0);
});
await test('lost reservation response supplies only an owned recovery hint and customer cancellation proves release', async () => {
  const f = fixture(); f.faults.lostReserve = true;
  const response = await f.run(); const recovery = readRewardCheckoutRecovery(response);
  assert.deepEqual(recovery, { kind: 'reward_no_payment', checkout_session_id: f.session().id,
    order_number: f.data.order_number });
  assert.doesNotMatch(JSON.stringify(response), /TEST_ONLY|customer_email|clientSecret|client_secret/);
  const cancelled = await cancelRewardCheckoutRecovery(async (name, payload) => {
    assert.equal(name, 'createPaymentIntent'); assert.equal(payload.mode, 'cancel_reward_checkout');
    assert.equal(payload.checkout_session_id, f.session().id);
    return { data: await f.cancel() };
  }, recovery);
  assert.equal(cancelled, true); assert.equal(f.rows.UserPoints[0].reserved_points, 0);
  assert.equal(f.rows.LoyaltyTransaction.length, 0);
});
await test('recovery hint cannot authorize cancellation after a concurrent completion', async () => {
  const f = fixture(); f.faults.lostReserve = true; const result = await f.run(); f.complete();
  await assert.rejects(cancelRewardCheckoutRecovery(async () => ({ data: await f.cancel() }),
    readRewardCheckoutRecovery(result)));
  assert.equal(f.rows.UserPoints[0].reserved_points, 6000); assert.equal(f.effects.includes('Stripe.expire'), false);
});
await test('concurrent preparation has one durable record writer and cannot expire the winning Session', async () => {
  const f = fixture(); const responses = await Promise.all([f.run(), f.run(), f.run()]);
  assert.ok(responses.some(result => result.clientSecret));
  assert.equal(f.rows.Order.length, 1); assert.equal(f.rows.CheckoutSession.length, 1);
  assert.equal(f.effects.filter(value => value === 'Order.create').length, 1);
  assert.equal(f.effects.filter(value => value === 'CheckoutSession.create').length, 1);
  assert.equal(f.effects.includes('Stripe.expire'), false);
  assert.equal(f.rows.UserPoints[0].reward_reservations.length, 1);
  assert.equal(f.rows.UserPoints[0].reserved_points, 6000);
});
for (const fault of ['expire', 'expireRace', 'retrieve', 'ledger']) await test(`uncertain cancel ${fault} leaves no permission to start a duplicate`, async () => {
  const f = fixture(); await f.run(); f.faults[fault] = true;
  await assert.rejects(f.cancel()); assert.equal(f.rows.UserPoints[0].reserved_points, 6000);
  assert.equal(f.rows.Order[0].status, 'pending_payment');
});
await test('another account cannot expire this customer Session or release their points', async () => {
  const f = fixture(); await f.run(); const before = f.effects.length;
  await assert.rejects(f.cancel('foreign@example.test')); assert.deepEqual(f.effects.slice(before), ['Stripe.retrieve']);
  assert.equal(f.rows.UserPoints[0].reserved_points, 6000);
});
await test('already completed Session cannot be cancelled or release earned points', async () => {
  const f = fixture(); await f.run(); f.complete(); await assert.rejects(f.cancel());
  assert.equal(f.rows.UserPoints[0].reserved_points, 6000); assert.equal(f.rows.Order[0].status, 'pending_payment');
});
await test('concurrent local order change is not overwritten during cancellation', async () => {
  const f = fixture(); await f.run(); f.faults.cancelRace = true; await assert.rejects(f.cancel());
  assert.equal(f.rows.Order[0].status, 'pending_payment'); assert.equal(f.rows.Order[0].status_history.length, 1);
});
for (const target of ['Order', 'CheckoutSession']) await test(`duplicate ${target} records stop instead of choosing one`, async () => {
  const f = fixture(); await f.run(); f.rows[target].push({ ...structuredClone(f.rows[target][0]), id: 'duplicate' });
  const retry = await f.run(); assert.equal(retry.clientSecret, undefined); assert.equal(retry.ok, false);
});
for (const target of ['Order', 'CheckoutSession']) await test(`tampered ${target} address cannot pass as the saved checkout`, async () => {
  const f = fixture(); await f.run(); const row = target === 'Order' ? f.rows.Order[0] : f.rows.CheckoutSession[0].checkout_data;
  row.address_line1 = 'Different address'; const result = await f.run(); assert.equal(result.clientSecret, undefined);
  assert.equal(result.ok, false);
});
await test('provider creation errors do not leak provider text or create records', async () => {
  const f = fixture(); f.faults.create = true; const result = await f.run(); assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /synthetic secret/); assert.equal(f.rows.Order.length, 0);
  assert.equal(result.reward_checkout_recovery, undefined);
});
await test('unverified foreign provider identity never exposes a recovery hint', async () => {
  const f = fixture(); f.faults.createdPatch = { customer_email: 'foreign@example.test' };
  assert.equal((await f.run()).reward_checkout_recovery, undefined);
});
console.log(`No-payment checkout start: ${count}/${count} passed. Local synthetic I/O only; not live/provider-release evidence.`);
