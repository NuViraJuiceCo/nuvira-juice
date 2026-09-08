import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as offers from '../../base44/functions/createPaymentIntent/firstOrderEligibility.js';
import * as rewards from '../../base44/functions/createPaymentIntent/rewardCheckout.js';

const source = fs.readFileSync('base44/functions/createPaymentIntent/entry.ts', 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
const email = 'buyer@example.test';
const body = {
  items: [{ product_id: 'oasis-test', title: 'OASIS', price: 13, quantity: 3, category: 'juice', size: '12 oz' }],
  subtotal: 39, delivery_fee: 3.99, total: 42.99, fulfillment_type: 'delivery',
  customer_email: email, customer_first_name: 'Test', customer_last_name: 'Buyer', contact_phone: '2025550100',
  address_line1: '123 Example St', address_city: 'Wentzville', address_state: 'MO', address_postal_code: '63385',
  health_advisory_acknowledged: true, health_advisory_version: '2026-05-13-v1',
  checkout_idempotency_key: 'synthetic-checkout-key-not-real-123456',
  guest_order_token: 'synthetic-order-token-not-real-123456',
};
const option = { option_id: 'synthetic-saturday', production_date: '2026-09-11', delivery_date: '2026-09-12',
  delivery_window_label: 'Saturday 12 PM - 3 PM', delivery_window_start: '12:00', delivery_window_end: '15:00', is_default: true };
function fixture({ guest = false, failOrder = false, failSession = false, failCancel = false, failReserve = false,
  failRelease = false, missingId = '', strictStripe = false, seed = {}, noRewardSecret = false } = {}) {
  const rows = { Order: [], CheckoutSession: [], Product: [{ id: 'oasis-test', title: 'OASIS', price: 13,
    category: 'juice', size: '12 oz', is_available: true }], Subscription: [], SubscriptionPlan: [], UserProfile: [],
    RewardTier: [{ id: 'reward-test', title: 'Double Points', reward_type: 'double_points', points_required: 1500, is_active: true }],
    UserPoints: [{ id: 'balance-test', customer_email: email, total_points: 7000, reserved_points: 0, reward_reservations: [] }],
    NuViraCredit: [], ...structuredClone(seed) };
  const effects = []; const entities = {};
  for (const [name, values] of Object.entries(rows)) entities[name] = {
    filter: async query => values.filter(row => Object.entries(query).every(([key, value]) => row[key] === value)),
    list: async () => values,
    create: async data => {
      effects.push(`${name}.create`);
      if ((name === 'Order' && failOrder) || (name === 'CheckoutSession' && failSession)) throw new Error('Synthetic persistence failure');
      if (missingId === name) return {};
      const row = { id: `${name}-${values.length}`, ...structuredClone(data) }; values.push(row); return row;
    },
  };
  let served; let storedIntent; let originalParameters;
  let clock = Date.parse('2026-09-08T15:00:00Z');
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const db = { auth: { me: async () => guest ? null : { id: 'test-user', email } },
    asServiceRole: { entities, functions: { invoke: async (name, payload) => {
      if (name === 'enrollNewCustomerInLoyalty') {
        assert.equal(payload.internal_secret, 'synthetic-ledger-secret');
        assert.equal(payload.customer_email, email);
        assert.equal(payload.stripe_payment_intent_id, storedIntent.id);
        const balance = rows.UserPoints[0];
        const id = storedIntent.metadata.reward_reservation_id;
        let hold = balance.reward_reservations.find(row => row.reservation_id === id);
        if (payload.action === 'reserve_reward_checkout') {
          effects.push('reward.reserve');
          const tier = rows.RewardTier.find(row => row.id === payload.reward_id);
          assert.equal(payload.points, tier.points_required + payload.direct_points);
          if (failReserve) return { data: { success: false } };
          if (hold) assert.equal(hold.context_hash, storedIntent.metadata.checkout_context_hash);
          else {
            hold = { reservation_id: id, context_hash: storedIntent.metadata.checkout_context_hash,
              payment_intent_id: storedIntent.id, points: payload.points, status: 'held' };
            balance.reward_reservations.push(hold); balance.reserved_points += hold.points;
          }
          return { data: { success: true, reservation_status: hold.status } };
        }
        assert.equal(payload.action, 'settle_reward_checkout'); effects.push('reward.release');
        if (failRelease) throw new Error('Synthetic release unavailable');
        assert.equal(storedIntent.status, 'canceled');
        if (hold?.status === 'held') { hold.status = 'released'; balance.reserved_points -= hold.points; }
        return { data: { success: true, reservation_status: 'released' } };
      }
      if (name !== 'calculateNuViraFulfillmentSchedule') throw new Error(`Unexpected function ${name}`);
      return { data: { options: [option] } };
    } } } };
  const module = { exports: {} };
  const env = { GOOGLE_MAPS_API_KEY: 'synthetic-maps-key', STRIPE_PUBLISHABLE_KEY: 'pk_test_synthetic',
    LOYALTY_LEDGER_SECRET: noRewardSecret ? undefined : 'synthetic-ledger-secret' };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Request, Response, URL, URLSearchParams, TextEncoder, TextDecoder, Date: FixtureDate,
    crypto: globalThis.crypto, console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: name => env[name] }, serve: fn => { served = fn; } },
    fetch: async url => {
      assert.match(url, /^https:\/\/maps.googleapis.com\/maps\/api\/distancematrix\/json\?/);
      return { json: async () => ({ status: 'OK', rows: [{ elements: [{ status: 'OK', distance: { value: 3218 }, duration: { value: 300 } }] }] }) };
    },
    require: name => {
      if (name.includes('@base44/sdk')) return { createClientFromRequest: () => db };
      if (name.includes('firstOrderEligibility')) return offers;
      if (name.includes('rewardCheckout')) return rewards;
      if (name.includes('stripe')) return class {
        constructor() { this.paymentIntents = {
          create: async (data, options) => {
            effects.push('PI.create');
            const parameters = JSON.stringify({ data, options });
            if (strictStripe && originalParameters && parameters !== originalParameters) {
              const error = new Error('Keys for idempotent requests require the same parameters');
              error.type = 'StripeIdempotencyError'; throw error;
            }
            originalParameters ||= parameters;
            storedIntent ||= { id: 'pi_test_synthetic', client_secret: 'unit-test',
              status: 'requires_payment_method', ...structuredClone(data) }; return storedIntent;
          },
          cancel: async id => { effects.push('PI.cancel'); assert.equal(id, 'pi_test_synthetic'); if (failCancel) throw new Error('Synthetic cancellation unavailable'); storedIntent.status = 'canceled'; return { id, status: 'canceled' }; },
        }; }
      };
      throw new Error(`Unexpected module ${name}`);
    },
  });
  return { rows, effects, intent: () => storedIntent, advance: () => { clock += 12000; }, handle: patch => served(new Request('https://unit.test/checkout', {
    method: 'POST', body: JSON.stringify({ ...body, guest_checkout: guest, ...patch }),
  })) };
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS', name); }
for (const guest of [false, true]) await test(`${guest ? 'guest' : 'member'} persists both records before returning a payment secret`, async () => {
  const ctx = fixture({ guest }); const response = await ctx.handle(); const result = await response.json();
  assert.equal(response.status, 200); assert.ok(result.clientSecret);
  assert.equal(ctx.rows.Order.length, 1, 'pending order must exist');
  assert.equal(ctx.rows.CheckoutSession.length, 1, 'checkout context must exist');
  assert.equal(ctx.rows.Order[0].status, 'pending_payment');
  assert.equal(ctx.rows.Order[0].payment_captured, false);
  assert.equal(ctx.rows.CheckoutSession[0].checkout_data.items[0].product_id, 'oasis-test');
  assert.equal(ctx.rows.CheckoutSession[0].checkout_data.customer_email, email);
  assert.equal(ctx.rows.CheckoutSession[0].checkout_data.guest_checkout, guest);
  assert.deepEqual(ctx.effects, ['PI.create', 'Order.create', 'CheckoutSession.create']);
});
for (const [name, options] of [
  ['order storage failure', { failOrder: true }], ['session storage failure', { failSession: true }],
  ['order response missing ID', { missingId: 'Order' }], ['session response missing ID', { missingId: 'CheckoutSession' }],
  ['cancellation unavailable', { failSession: true, failCancel: true }],
]) await test(`${name} never exposes a usable payment secret`, async () => {
  const ctx = fixture(options); const response = await ctx.handle(); const result = await response.json();
  assert.equal(response.status, 503); assert.equal(result.error_code, 'CHECKOUT_RECORDS_NOT_READY');
  assert.equal(result.clientSecret, undefined); assert.equal(result.payment_confirmation_attempted, false);
  assert.ok(ctx.effects.includes('PI.cancel'));
});
await test('provider replay does not duplicate records or omit session context', async () => {
  const ctx = fixture(); const first = await (await ctx.handle()).json();
  const second = await (await ctx.handle()).json();
  assert.equal(second.orderNumber, first.orderNumber); assert.equal(second.idempotent_replay, true);
  assert.equal(ctx.rows.Order.length, 1); assert.equal(ctx.rows.CheckoutSession.length, 1);
});
await test('replay repairs an absent session before returning the secret', async () => {
  const ctx = fixture(); await ctx.handle(); ctx.rows.CheckoutSession.splice(0);
  const response = await ctx.handle(); const result = await response.json();
  assert.equal(response.status, 200); assert.ok(result.clientSecret); assert.equal(ctx.rows.CheckoutSession.length, 1);
});
await test('cross-customer pending record fails closed', async () => {
  const ctx = fixture({ seed: { Order: [{ id: 'foreign', stripe_payment_intent_id: 'pi_test_synthetic',
    customer_email: 'other@example.test', order_number: 'NV-FOREIGN' }] } });
  const response = await ctx.handle(); const result = await response.json();
  assert.equal(response.status, 503); assert.equal(result.clientSecret, undefined);
  assert.equal(ctx.rows.CheckoutSession.length, 0);
});
await test('duplicate pending records fail closed', async () => {
  const row = { stripe_payment_intent_id: 'pi_test_synthetic', customer_email: email, order_number: 'NV-DUPLICATE' };
  const ctx = fixture({ seed: { Order: [{ id: 'a', ...row }, { id: 'b', ...row }] } });
  const response = await ctx.handle(); assert.equal(response.status, 503);
});
await test('session ownership mismatch fails closed', async () => {
  const ctx = fixture(); await ctx.handle(); ctx.rows.CheckoutSession[0].customer_email = 'other@example.test';
  const response = await ctx.handle(); const result = await response.json();
  assert.equal(response.status, 503); assert.equal(result.clientSecret, undefined);
});
for (const guest of [false, true]) await test(`${guest ? 'guest' : 'member'} retry satisfies Stripe parameter equality after time advances`, async () => {
  const ctx = fixture({ guest, strictStripe: true });
  const first = await ctx.handle(); assert.equal(first.status, 200);
  ctx.advance();
  const retry = await ctx.handle(); const result = await retry.json();
  assert.equal(retry.status, 200, JSON.stringify(result));
  assert.equal(result.idempotent_replay, true);
  assert.equal(ctx.rows.Order.length, 1); assert.equal(ctx.rows.CheckoutSession.length, 1);
});
for (const [name, patch, guest] of [
  ['same-price cart contents', { items: [{ ...body.items[0], product_id: 'aura-test', title: 'AURA' }] }, false],
  ['selected reward at the same total', { active_reward: { id: 'reward-test', reward_type: 'double_points', points_required: 1500 } }, false],
  ['guest ownership token', { guest_order_token: 'another-synthetic-order-token-1234567890' }, true],
  ['receipt address', { address_line1: '456 Example St' }, false],
]) await test(`${name} cannot reuse a prepared payment with stale checkout context`, async () => {
  const ctx = fixture({ guest, strictStripe: true }); await ctx.handle(); ctx.advance();
  const response = await ctx.handle(patch); const result = await response.json();
  assert.equal(response.status, 409); assert.equal(result.error_code, 'CHECKOUT_ATTEMPT_CHANGED');
  assert.equal(result.clientSecret, undefined);
  assert.equal(ctx.rows.Order.length, 1); assert.equal(ctx.rows.CheckoutSession.length, 1);
  assert.equal(ctx.effects.filter(effect => effect === 'PI.cancel').length, 0, 'leave the original attempt intact');
});
const selected = { id: 'reward-test', title: 'Forged title', points_required: 1, reward_type: 'vip_box' };
await test('actual reward payment uses canonical prices, tier and combined points reservation before exposing secret', async () => {
  const ctx = fixture(); const response = await ctx.handle({ active_reward: selected,
    items: [{ ...body.items[0], price: 0.01 }], subtotal: 0.03, total: 4.02, points_used: 500, points_discount: 5 });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.effectiveTotal, 37.99); assert.equal(ctx.intent().amount, 3799);
  assert.deepEqual(ctx.effects, ['PI.create', 'reward.reserve', 'Order.create', 'CheckoutSession.create']);
  const data = ctx.rows.CheckoutSession[0].checkout_data;
  assert.equal(data.subtotal, 39); assert.equal(data.active_reward.points_required, 1500);
  assert.equal(data.active_reward.reward_type, 'double_points'); assert.equal(data.reward_checkout.points_multiplier, 2);
  assert.equal(data.reward_reservation_points, 2000); assert.equal(data.points_used, 500);
  assert.equal(ctx.rows.UserPoints[0].reserved_points, 2000); assert.equal(ctx.rows.UserPoints[0].total_points, 7000);
  assert.equal(Object.keys(ctx.intent().metadata).length <= 50, true);
});
await test('reward retry includes its own held balance without reserving again or changing Stripe parameters', async () => {
  const ctx = fixture({ strictStripe: true, seed: { UserPoints: [{ id: 'balance', customer_email: email,
    total_points: 1500, reserved_points: 0, reward_reservations: [] }] } });
  const first = await ctx.handle({ active_reward: selected }); assert.equal(first.status, 200);
  ctx.advance(); const retry = await ctx.handle({ active_reward: selected }); const result = await retry.json();
  assert.equal(retry.status, 200, JSON.stringify(result)); assert.equal(result.idempotent_replay, true);
  assert.equal(ctx.rows.UserPoints[0].reserved_points, 1500); assert.equal(ctx.rows.UserPoints[0].reward_reservations.length, 1);
  assert.equal(ctx.rows.Order.length, 1); assert.equal(ctx.rows.CheckoutSession.length, 1);
});
await test('a six-bottle VIP reward creates real product lines and charges delivery only', async () => {
  const tier = { id: 'vip', title: 'VIP', reward_type: 'vip_box', points_required: 6000, is_active: true };
  const ctx = fixture({ seed: { RewardTier: [tier] } });
  const response = await ctx.handle({ active_reward: tier, subtotal: 0, total: 3.99,
    items: [{ ...body.items[0], quantity: 6, price: 0, reward_id: 'vip', isFreeReward: true }] });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.effectiveTotal, 3.99); assert.equal(ctx.intent().amount, 399);
  assert.equal(ctx.rows.Order[0].items[0].product_id, 'oasis-test'); assert.equal(ctx.rows.Order[0].items[0].quantity, 6);
  assert.equal(ctx.rows.Order[0].items[0].reward_id, 'vip'); assert.equal(ctx.rows.Order[0].items[0].price, 0);
});
await test('reward checkout retains validated wellness-shot program lineage in both checkout and order', async () => {
  const ctx = fixture({ seed: { Product: [{ id: 'shot-test', title: 'Hydration Shot', category: 'shot',
    size: '2 oz', price: 6, is_available: true }] } });
  const response = await ctx.handle({ active_reward: selected, items: [{ product_id: 'shot-test', title: 'Untrusted',
    category: 'juice', size: '32 oz', price: 0.01, quantity: 6, program_addon_for: 'hydration',
    program_addon_days: 2, program_addon_schedule_version: 'untrusted' }] });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
  for (const item of [ctx.rows.Order[0].items[0], ctx.rows.CheckoutSession[0].checkout_data.items[0]]) {
    assert.equal(item.price, 6); assert.equal(item.category, 'shot'); assert.equal(item.size, '2 oz');
    assert.equal(item.program_addon_for, 'hydration'); assert.equal(item.program_addon_days, 2);
    assert.ok(item.program_addon_schedule_version); assert.notEqual(item.program_addon_schedule_version, 'untrusted');
  }
});
await test('order schema explicitly retains reward identity, actual quantities and canonical pricing lineage', () => {
  const schema = JSON.parse(fs.readFileSync('base44/entities/Order.jsonc', 'utf8'));
  const fields = schema.properties.items.items.properties;
  for (const key of ['product_id', 'quantity', 'price', 'cart_line_key', 'reward_id', 'reward_type', 'isFreeReward',
    'catalog_unit_price', 'reward_discount_amount', 'program_addon_for', 'program_addon_days']) assert.ok(fields[key], key);
});
for (const [name, options, patch, code] of [
  ['no internal reservation credential', { noRewardSecret: true }, {}, 'REWARD_CHECKOUT_NOT_READY'],
  ['no stable attempt key', {}, { checkout_idempotency_key: null }, 'REWARD_CHECKOUT_NOT_READY'],
  ['tampered points cash value', {}, { points_used: 1, points_discount: 10 }, 'INVALID_POINTS_SELECTION'],
  ['points beyond remaining merchandise', {}, { points_used: 4000, points_discount: 40 }, 'POINTS_EXCEED_ORDER_VALUE'],
  ['credits without a verified account', {}, { credits_discount: 1 }, 'CREDIT_BALANCE_UNAVAILABLE'],
]) await test(`${name} stops before payment creation`, async () => {
  const ctx = fixture(options); const response = await ctx.handle({ active_reward: selected, ...patch });
  const result = await response.json(); assert.equal(result.error_code, code); assert.equal(result.clientSecret, undefined);
  assert.equal(ctx.effects.length, 0); assert.equal(ctx.rows.Order.length, 0);
});
await test('fully covered reward order never becomes a fabricated 50-cent payment', async () => {
  const tier = { id: 'vip', title: 'VIP', reward_type: 'vip_box', points_required: 6000, is_active: true };
  const ctx = fixture({ seed: { RewardTier: [tier], Subscription: [{ customer_email: email, status: 'active', plan_id: 'plan' }],
    SubscriptionPlan: [{ id: 'plan', discount_percent: 10 }] } });
  const response = await ctx.handle({ active_reward: tier,
    items: [{ ...body.items[0], quantity: 6, price: 0, reward_id: 'vip', isFreeReward: true }] });
  const result = await response.json(); assert.equal(result.error_code, 'REWARD_NO_PAYMENT_FINALIZATION_REQUIRED');
  assert.equal(ctx.effects.length, 0); assert.equal(result.clientSecret, undefined);
});
await test('unconfirmed reward reserve cancels only its PI and never exposes secret', async () => {
  const ctx = fixture({ failReserve: true }); const response = await ctx.handle({ active_reward: selected });
  const result = await response.json(); assert.equal(result.error_code, 'REWARD_PAYMENT_NOT_READY');
  assert.equal(result.clientSecret, undefined); assert.equal(result.payment_attempt_canceled, true);
  assert.equal(ctx.rows.Order.length, 0); assert.deepEqual(ctx.effects, ['PI.create', 'reward.reserve', 'PI.cancel', 'reward.release']);
});
await test('storage failure cancels the reward PI and releases its hold before retry', async () => {
  const ctx = fixture({ failSession: true }); const response = await ctx.handle({ active_reward: selected });
  const result = await response.json(); assert.equal(result.error_code, 'CHECKOUT_RECORDS_NOT_READY');
  assert.equal(result.clientSecret, undefined); assert.equal(ctx.rows.UserPoints[0].reserved_points, 0);
  assert.equal(ctx.rows.UserPoints[0].reward_reservations[0].status, 'released');
});
await test('uncertain provider cancellation preserves the reward hold and withholds secret', async () => {
  const ctx = fixture({ failSession: true, failCancel: true }); const response = await ctx.handle({ active_reward: selected });
  const result = await response.json(); assert.equal(result.error_code, 'CHECKOUT_RECORDS_NOT_READY');
  assert.equal(result.clientSecret, undefined); assert.equal(result.payment_attempt_canceled, false);
  assert.equal(ctx.rows.UserPoints[0].reserved_points, 1500); assert.equal(ctx.effects.includes('reward.release'), false);
});
console.log(`Checkout record persistence: ${passed}/${passed} passed. Real handler, synthetic storage/Maps/Stripe only; no external calls or production writes.`);
