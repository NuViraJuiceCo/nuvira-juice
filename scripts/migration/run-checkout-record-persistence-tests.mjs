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
function fixture({ guest = false, failOrder = false, failSession = false, failCancel = false, missingId = '', strictStripe = false, seed = {} } = {}) {
  const rows = { Order: [], CheckoutSession: [], Product: [{ id: 'oasis-test', title: 'OASIS', price: 13,
    category: 'juice', size: '12 oz', is_available: true }], Subscription: [], SubscriptionPlan: [], UserProfile: [], ...structuredClone(seed) };
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
    asServiceRole: { entities, functions: { invoke: async name => {
      if (name !== 'calculateNuViraFulfillmentSchedule') throw new Error(`Unexpected function ${name}`);
      return { data: { options: [option] } };
    } } } };
  const module = { exports: {} };
  const env = { GOOGLE_MAPS_API_KEY: 'synthetic-maps-key', STRIPE_PUBLISHABLE_KEY: 'pk_test_synthetic' };
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
          cancel: async id => { effects.push('PI.cancel'); assert.equal(id, 'pi_test_synthetic'); if (failCancel) throw new Error('Synthetic cancellation unavailable'); return { id, status: 'canceled' }; },
        }; }
      };
      throw new Error(`Unexpected module ${name}`);
    },
  });
  return { rows, effects, advance: () => { clock += 12000; }, handle: patch => served(new Request('https://unit.test/checkout', {
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
console.log(`Checkout record persistence: ${passed}/${passed} passed. Real handler, synthetic storage/Maps/Stripe only; no external calls or production writes.`);
