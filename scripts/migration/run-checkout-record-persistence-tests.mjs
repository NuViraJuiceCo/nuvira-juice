import assert from 'node:assert/strict';
import * as creditReservation from '../../base44/shared/checkoutCredit.js';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as offers from '../../base44/functions/createPaymentIntent/firstOrderEligibility.js';
import * as rewards from '../../base44/functions/createPaymentIntent/rewardCheckout.js';
import * as noPayment from '../../base44/functions/createPaymentIntent/noPaymentCheckout.js';
import * as pointsLedger from '../../base44/functions/enrollNewCustomerInLoyalty/pointsAccount.js';

const source = fs.readFileSync('base44/functions/createPaymentIntent/entry.ts', 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
const compiledLedger = transformSync(fs.readFileSync('base44/functions/enrollNewCustomerInLoyalty/entry.ts', 'utf8'),
  { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
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
  failRelease = false, missingId = '', strictStripe = false, seed = {}, noRewardSecret = false, distanceMiles = 2,
  failCredit = false, loseCreditAck = false, ignoreCreditWrite = false,
  realLedger = false, ignorePointsWrite = false, losePointsAck = false, failCatalog = false } = {}) {
  const rows = { Order: [], CheckoutSession: [], Product: [{ id: 'oasis-test', title: 'OASIS', price: 13,
    category: 'juice', size: '12 oz', is_available: true }], Subscription: [], SubscriptionPlan: [], UserProfile: [],
    RewardTier: [{ id: 'reward-test', title: 'Double Points', reward_type: 'double_points', points_required: 1500, is_active: true }],
    UserPoints: [{ id: 'balance-test', customer_email: email, total_points: 7000, reserved_points: 0, reward_reservations: [] }],
    NuViraCredit: [], LoyaltyMember: [], LoyaltyTransaction: [], ...structuredClone(seed) };
  const effects = []; const entities = {};
  let lostCreditAck = false;
  let lostPointsAck = false;
  let ledgerServed;
  const match = (row, query) => Object.entries(query).every(([key, value]) => key === '$or' ? value.some(q => match(row, q))
    : value && typeof value === 'object' && '$exists' in value ? (row[key] !== undefined) === value.$exists : row[key] === value);
  for (const [name, values] of Object.entries(rows)) entities[name] = {
    filter: async query => {
      if (name === 'Product' && failCatalog) throw new Error('SYNTHETIC_ONLY catalog outage');
      return structuredClone(values.filter(row => match(row, query)));
    },
    list: async () => values,
    create: async data => {
      effects.push(`${name}.create`);
      if ((name === 'Order' && failOrder) || (name === 'CheckoutSession' && failSession)) throw new Error('Synthetic persistence failure');
      if (missingId === name) return {};
      const row = { id: `${name}-${values.length}`, ...structuredClone(data) }; values.push(row); return row;
    },
    update: async (id, patch) => {
      assert.equal(name, 'LoyaltyTransaction'); const row = values.find(row => row.id === id); assert.ok(row);
      Object.assign(row, structuredClone(patch)); return structuredClone(row);
    },
    updateMany: async (query, update) => {
      assert.ok(['NuViraCredit', 'UserPoints', 'LoyaltyMember'].includes(name));
      effects.push(name === 'NuViraCredit' ? 'credit.CAS' : `${name}.CAS`);
      if (name === 'NuViraCredit' && failCredit) throw new Error('SYNTHETIC_ONLY credit outage');
      const found = values.filter(row => match(row, query)); assert.ok(found.length <= 1);
      if (!(name === 'NuViraCredit' && ignoreCreditWrite) && !(name === 'UserPoints' && ignorePointsWrite)) found.forEach(row => Object.assign(row, structuredClone(update.$set)));
      if (name === 'NuViraCredit' && loseCreditAck && !lostCreditAck) { lostCreditAck = true; throw new Error('SYNTHETIC_ONLY lost credit acknowledgement'); }
      if (name === 'UserPoints' && losePointsAck && !lostPointsAck) { lostPointsAck = true; throw new Error('SYNTHETIC_ONLY lost points acknowledgement'); }
      return { success: true, updated: found.length, has_more: false };
    },
  };
  let served; let storedIntent; let storedSession; let originalParameters; let sessionParameters;
  let clock = Date.parse('2026-09-08T15:00:00Z');
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const db = { auth: { me: async () => guest ? null : { id: 'test-user', email } },
    asServiceRole: { entities, functions: { invoke: async (name, payload) => {
      if (name === 'enrollNewCustomerInLoyalty') {
        if (realLedger) {
          effects.push(`ledger.${payload.action}`);
          const result = await ledgerServed(new Request('https://unit.test/ledger', { method: 'POST', body: JSON.stringify(payload) }));
          return { data: await result.json() };
        }
        assert.equal(payload.internal_secret, 'synthetic-ledger-secret');
        assert.equal(payload.customer_email, email);
        const provider = payload.stripe_checkout_session_id ? storedSession : storedIntent;
        assert.equal(payload.stripe_checkout_session_id || payload.stripe_payment_intent_id, provider.id);
        const balance = rows.UserPoints[0];
        const id = provider.metadata.reward_reservation_id;
        let hold = balance.reward_reservations.find(row => row.reservation_id === id);
        if (payload.action === 'reserve_reward_checkout') {
          effects.push('reward.reserve');
          const tier = rows.RewardTier.find(row => row.id === payload.reward_id);
          assert.equal(payload.points, (tier?.points_required || 0) + payload.direct_points);
          if (failReserve) return { data: { success: false } };
          if (hold) assert.equal(hold.context_hash, provider.metadata.checkout_context_hash);
          else {
            hold = { reservation_id: id, context_hash: provider.metadata.checkout_context_hash,
              [payload.stripe_checkout_session_id ? 'checkout_session_id' : 'payment_intent_id']: provider.id,
              ...(payload.preparation_attempt_id ? { preparation_attempt_id: payload.preparation_attempt_id } : {}),
              points: payload.points, status: 'held' };
            balance.reward_reservations.push(hold); balance.reserved_points += hold.points;
          }
          return { data: { success: true, reservation_status: hold.status, preparation_attempt_id: hold.preparation_attempt_id } };
        }
        assert.equal(payload.action, 'settle_reward_checkout'); effects.push('reward.release');
        if (failRelease) throw new Error('Synthetic release unavailable');
        assert.equal(provider.status, payload.stripe_checkout_session_id ? 'expired' : 'canceled');
        if (hold?.status === 'held') { hold.status = 'released'; balance.reserved_points -= hold.points; }
        return { data: { success: true, reservation_status: 'released' } };
      }
      if (name !== 'calculateNuViraFulfillmentSchedule') throw new Error(`Unexpected function ${name}`);
      return { data: { options: [option] } };
    } } } };
  const module = { exports: {} };
  const env = { GOOGLE_MAPS_API_KEY: 'synthetic-maps-key', STRIPE_PUBLISHABLE_KEY: 'pk_test_synthetic',
    STRIPE_SECRET_KEY: 'synthetic-only-provider-key',
    LOYALTY_LEDGER_SECRET: noRewardSecret ? undefined : 'synthetic-ledger-secret' };
  const runtime = {
    module, exports: module.exports, Request, Response, URL, URLSearchParams, TextEncoder, TextDecoder, Date: FixtureDate,
    crypto: globalThis.crypto, console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: name => env[name] }, serve: fn => { served = fn; } },
    fetch: async url => {
      assert.match(url, /^https:\/\/maps.googleapis.com\/maps\/api\/distancematrix\/json\?/);
      return { json: async () => ({ status: 'OK', rows: [{ elements: [{ status: 'OK', distance: { value: distanceMiles * 1609.344 }, duration: { value: 300 } }] }] }) };
    },
    require: name => {
      if (name.includes('@base44/sdk')) return { createClientFromRequest: () => db };
      if (name.includes('firstOrderEligibility')) return offers;
      if (name.includes('rewardCheckout')) return rewards;
      if (name.includes('checkoutCredit')) return creditReservation;
      if (name.includes('noPaymentCheckout')) return noPayment;
      if (name.includes('pointsAccount')) return pointsLedger;
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
              livemode: true, status: 'requires_payment_method', ...structuredClone(data) }; return structuredClone(storedIntent);
          },
          retrieve: async id => { effects.push('PI.retrieve'); assert.equal(id, storedIntent.id); return structuredClone(storedIntent); },
          cancel: async id => { effects.push('PI.cancel'); assert.equal(id, 'pi_test_synthetic'); if (failCancel) throw new Error('Synthetic cancellation unavailable'); storedIntent.status = 'canceled'; return structuredClone(storedIntent); },
        }; this.checkout = { sessions: {
          create: async (data, options) => {
            effects.push('Session.create');
            const parameters = JSON.stringify({ data, options });
            if (strictStripe && sessionParameters && sessionParameters !== parameters) throw new Error('Synthetic session idempotency conflict');
            sessionParameters ||= parameters;
            storedSession ||= { id: 'cs_live_synthetic', client_secret: ['cs_live_synthetic', 'secret', 'synthetic'].join('_'),
              currency: 'usd', amount_total: 0, payment_intent: null, status: 'open', payment_status: 'unpaid',
              livemode: true, expires_at: Math.floor(clock / 1000) + 86400, ...structuredClone(data) };
            return structuredClone(storedSession);
          },
          retrieve: async id => { assert.equal(id, storedSession.id); return structuredClone(storedSession); },
          expire: async id => { assert.equal(id, storedSession.id); effects.push('Session.expire');
            if (failCancel) throw new Error('Synthetic expiry failure'); storedSession.status = 'expired'; return structuredClone(storedSession); },
        } }; }
      };
      throw new Error(`Unexpected module ${name}`);
    },
  };
  vm.runInNewContext(compiled, runtime);
  const ledgerModule = { exports: {} };
  vm.runInNewContext(compiledLedger, { ...runtime, module: ledgerModule, exports: ledgerModule.exports,
    Deno: { ...runtime.Deno, serve: fn => { ledgerServed = fn; } } });
  return { rows, effects, intent: () => storedIntent, session: () => storedSession,
    settle: async () => {
      const response = await ledgerServed(new Request('https://unit.test/ledger', { method: 'POST', body: JSON.stringify({
        action: 'settle_reward_checkout', customer_email: email, stripe_payment_intent_id: storedIntent.id,
        internal_secret: env.LOYALTY_LEDGER_SECRET,
      }) })); return { status: response.status, body: await response.json() };
    }, advance: () => { clock += 12000; }, handle: patch => served(new Request('https://unit.test/checkout', {
    method: 'POST', body: JSON.stringify({ ...body, guest_checkout: guest, ...patch }),
  })) };
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS', name); }
for (const guest of [false, true]) {
  await test(`${guest ? 'guest' : 'member'} ignores submitted subtotal and restores catalog metadata before payment`, async () => {
    const ctx = fixture({ guest }); Object.assign(ctx.rows.Product[0], {
      image_url: '/fixture-oasis.webp', shopify_product_id: 'fixture-product', shopify_variant_id: 'fixture-variant',
    });
    const response = await ctx.handle({ subtotal: 0, total: 0,
      items: [{ ...body.items[0], title: 'Wrong title', category: 'merchandise', size: '99 oz',
        image_url: '/wrong.webp', shopify_variant_id: 'wrong', bottles_per_unit: 99 }] });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(ctx.intent().amount, 4299);
    const saved = ctx.rows.CheckoutSession[0].checkout_data;
    assert.equal(saved.subtotal, 39); assert.equal(saved.items[0].title, 'OASIS');
    assert.equal(saved.items[0].category, 'juice'); assert.equal(saved.items[0].image_url, '/fixture-oasis.webp');
    assert.equal(saved.items[0].shopify_variant_id, 'fixture-variant'); assert.equal(saved.items[0].bottles_per_unit, undefined);
  });
  for (const [label, patch, code] of [
    ['lowered unit price', { items: [{ ...body.items[0], price: 1 }] }, 'PRODUCT_PRICE_OR_AVAILABILITY_CHANGED'],
    ['stale higher unit price', { items: [{ ...body.items[0], price: 15 }] }, 'PRODUCT_PRICE_OR_AVAILABILITY_CHANGED'],
    ['fabricated bottle count', { items: [{ ...body.items[0], quantity: 1, category: 'bundle', bottles_per_unit: 99 }] }, 'ORDER_MINIMUM_NOT_MET'],
    ['unknown product', { items: [{ ...body.items[0], product_id: 'absent' }] }, 'PRODUCT_PRICE_OR_AVAILABILITY_CHANGED'],
  ]) await test(`${guest ? 'guest' : 'member'} rejects ${label} before any preparation write`, async () => {
    const ctx = fixture({ guest }); const response = await ctx.handle(patch); const result = await response.json();
    assert.equal(response.status, 409); assert.equal(result.error_code, code);
    assert.equal(result.clientSecret, undefined); assert.equal(ctx.effects.length, 0);
    assert.equal(ctx.rows.Order.length, 0); assert.equal(ctx.rows.CheckoutSession.length, 0);
  });
  await test(`${guest ? 'guest' : 'member'} catalog preflight is read-only and detects catalog outages`, async () => {
    for (const failCatalog of [false, true]) {
      const ctx = fixture({ guest, failCatalog });
      const response = await ctx.handle({ mode: 'preview_catalog_checkout' }); const result = await response.json();
      assert.equal(response.status, failCatalog ? 409 : 200);
      assert.equal(result.ok, !failCatalog); assert.equal(result.preview_only, true);
      for (const key of ['writes_performed', 'provider_calls_performed', 'payment_intent_created', 'order_created']) assert.equal(result[key], false);
      assert.equal(ctx.effects.length, 0); assert.equal(ctx.rows.Order.length, 0);
      if (!failCatalog) { assert.equal(result.quote.subtotal, 39); assert.equal(result.quote.revision, rewards.CATALOG_CHECKOUT_REVISION); }
      else assert.equal(result.error_code, 'CATALOG_UNAVAILABLE');
    }
  });
  await test(`${guest ? 'guest' : 'member'} Trio uses the catalog count without an invalid empty composition`, async () => {
    const ctx = fixture({ guest, seed: { Product: [{ id: 'trio', title: 'NuVira Trio', price: 36,
      category: 'bundle', bottle_count: 3, is_available: true }] } });
    const response = await ctx.handle({ items: [{ product_id: 'trio', title: 'NuVira Trio', price: 36, quantity: 1 }] });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(ctx.intent().amount, 3999);
    const saved = ctx.rows.CheckoutSession[0].checkout_data.items[0];
    assert.equal(saved.bottles_per_unit, 3); assert.equal(Object.hasOwn(saved, 'bundle_composition'), false);
  });
}
for (const [key, days, price, bottles] of [['hydration', 2, 104, 8], ['hydration', 3, 144, 12],
  ['radiance', 2, 104, 8], ['radiance', 3, 144, 12], ['reset', 3, 144, 12]]) {
  await test(`actual ${key} ${days}-day checkout retains canonical program composition and media`, async () => {
    const ctx = fixture();
    const response = await ctx.handle({ items: [{ product_id: `program_${key}_${days}day`, title: 'Wrong program title',
      price, quantity: 1, category: 'juice', bottles_per_unit: 999, bundle_composition: [], image_url: '/wrong.webp' }] });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
    const saved = ctx.rows.CheckoutSession[0].checkout_data.items[0];
    assert.equal(saved.program_key, key); assert.equal(saved.program_days, days); assert.equal(saved.bottles_per_unit, bottles);
    assert.equal(saved.bundle_composition.reduce((sum, item) => sum + item.quantity, 0), bottles);
    assert.equal(saved.image_url, `/images/programs/${key}-card.webp`); assert.equal(saved.price, price);
  });
}
await test('program shot add-on lineage survives canonical pricing without accepting a forged price', async () => {
  const ctx = fixture({ seed: { Product: [{ id: 'shot', title: 'Hydration Shot', category: 'shot', size: '2 oz',
    price: 6, is_available: true }] } });
  const response = await ctx.handle({ items: [
    { product_id: 'program_hydration_2day', title: 'Hydration Program (2-Day)', price: 104, quantity: 1 },
    { product_id: 'shot', title: 'Hydration Shot', price: 6, quantity: 2, program_addon_for: 'hydration', program_addon_days: 2 },
  ] });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
  const saved = ctx.rows.CheckoutSession[0].checkout_data.items[1];
  assert.equal(saved.program_addon_for, 'hydration'); assert.equal(saved.program_addon_days, 2); assert.equal(saved.price, 6);
});
await test('birthday markers are never silently made into a paid or unverified free line', async () => {
  for (const active_reward of [null, { id: 'reward-test' }]) {
    const ctx = fixture(); const response = await ctx.handle({ active_reward,
      items: [{ ...body.items[0], isBirthdayReward: true, birthday_product_id: 'oasis-test' }] });
    assert.equal(response.status, 409); assert.equal((await response.json()).error_code, 'BIRTHDAY_REWARD_REQUIRES_VERIFICATION');
    assert.equal(ctx.effects.length, 0);
  }
});
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
  ctx.rows.Product.push({ ...ctx.rows.Product[0], id: 'aura-test', title: 'AURA' });
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
await test('earned six-bottle retail value meets the extended-area minimum and charges only the unchanged delivery fee', async () => {
  const tier = { id: 'vip', title: 'VIP', reward_type: 'vip_box', points_required: 6000, is_active: true };
  const ctx = fixture({ distanceMiles: 20, seed: { RewardTier: [tier] } });
  const response = await ctx.handle({ subtotal: 0, active_reward: tier,
    items: [{ ...body.items[0], quantity: 6, price: 0, reward_id: 'vip', isFreeReward: true }] });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.effectiveTotal, 9.99); assert.equal(ctx.intent().amount, 999);
  assert.equal(ctx.intent().metadata.delivery_zone_minimum, '49.99');
  assert.equal(ctx.rows.CheckoutSession[0].checkout_data.reward_checkout.catalog_subtotal, 78);
  assert.equal(ctx.rows.Order[0].subtotal, 0); assert.equal(ctx.rows.Order[0].delivery_fee, 9.99);
});
await test('caller-inflated earned retail value cannot qualify for a delivery minimum', async () => {
  const tier = { id: 'vip', title: 'VIP', reward_type: 'vip_box', points_required: 6000, is_active: true };
  const ctx = fixture({ distanceMiles: 20, seed: { RewardTier: [tier], Product: [{ id: 'oasis-test', title: 'OASIS',
    category: 'juice', size: '12 oz', is_available: true, price: 6 }] } });
  const response = await ctx.handle({ subtotal: 1000, catalog_subtotal: 1000, active_reward: tier,
    items: [{ ...body.items[0], quantity: 6, price: 1000, catalog_unit_price: 1000, reward_id: 'vip', isFreeReward: true }] });
  const result = await response.json(); assert.equal(response.status, 400);
  assert.equal(result.reason_code, 'MINIMUM_ORDER_NOT_MET'); assert.equal(result.amount_needed, 13.99);
  assert.equal(ctx.effects.length, 0); assert.equal(ctx.rows.Order.length, 0);
});
for (const distanceMiles of [27, 32]) await test(`earned retail value does not bypass ${distanceMiles}-mile route review`, async () => {
  const tier = { id: 'vip', title: 'VIP', reward_type: 'vip_box', points_required: 6000, is_active: true };
  const ctx = fixture({ distanceMiles, seed: { RewardTier: [tier] } });
  const response = await ctx.handle({ subtotal: 0, active_reward: tier,
    items: [{ ...body.items[0], quantity: 6, price: 0, reward_id: 'vip', isFreeReward: true }] });
  const result = await response.json(); assert.equal(response.status, 400);
  assert.equal(result.reason_code, 'ZONE_3_REQUIRES_APPROVAL_FLOW');
  assert.equal(ctx.effects.length, 0); assert.equal(ctx.rows.Order.length, 0);
});
await test('earned retail value never bypasses the 35-mile delivery boundary', async () => {
  const tier = { id: 'vip', title: 'VIP', reward_type: 'vip_box', points_required: 6000, is_active: true };
  const ctx = fixture({ distanceMiles: 36, seed: { RewardTier: [tier] } });
  const response = await ctx.handle({ active_reward: tier,
    items: [{ ...body.items[0], quantity: 6, price: 0, reward_id: 'vip', isFreeReward: true }] });
  assert.equal(response.status, 400); assert.equal(ctx.effects.length, 0); assert.equal(ctx.rows.Order.length, 0);
});
await test('ordinary extended-area paid minimum is unchanged', async () => {
  const ctx = fixture({ distanceMiles: 20 }); const response = await ctx.handle(); const result = await response.json();
  assert.equal(response.status, 400); assert.equal(result.reason_code, 'MINIMUM_ORDER_NOT_MET');
  assert.equal(result.amount_needed, 10.99); assert.equal(ctx.effects.length, 0);
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
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.effectiveTotal, 0); assert.equal(result.checkoutKind, 'reward_no_payment');
  assert.equal(result.checkoutSessionId, 'cs_live_synthetic'); assert.ok(result.clientSecret);
  assert.equal(ctx.intent(), undefined); assert.equal(ctx.session().amount_total, 0);
  assert.equal(ctx.session().payment_intent, null); assert.equal(ctx.session().ui_mode, 'embedded');
  assert.equal(ctx.session().redirect_on_completion, 'never');
  assert.equal(ctx.session().line_items[0].price_data.unit_amount, 0);
  assert.equal(ctx.session().line_items[0].quantity, 6);
  assert.deepEqual(ctx.effects, ['Session.create', 'reward.reserve', 'Order.create', 'CheckoutSession.create']);
  assert.equal(ctx.rows.Order[0].status, 'pending_payment'); assert.equal(ctx.rows.Order[0].payment_captured, false);
  assert.equal(ctx.rows.Order[0].assigned_delivery_date, option.delivery_date);
  assert.equal(ctx.rows.Order[0].contact_phone, body.contact_phone);
  assert.equal(ctx.rows.CheckoutSession[0].checkout_data.reward_reservation_points, 6000);
  const retry = await (await ctx.handle({ active_reward: tier,
    items: [{ ...body.items[0], quantity: 6, price: 0, reward_id: 'vip', isFreeReward: true }] })).json();
  assert.equal(retry.checkoutSessionId, result.checkoutSessionId); assert.equal(retry.idempotent_replay, true);
  assert.equal(ctx.rows.Order.length, 1); assert.equal(ctx.rows.CheckoutSession.length, 1);
  assert.equal(ctx.rows.UserPoints[0].reserved_points, 6000);
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
const creditSeed = { NuViraCredit: [{ id: 'credit-test', customer_email: email, balance: 10,
  lifetime_used: 0, history: [] }] };
await test('legacy and current referral clients both receive one canonical discount, not a double discount', async () => {
  const seed = { DiscountCode: [{ id: 'referral-synthetic', code: 'SYNTHETICREF', active: true,
    discount_type: 'fixed_amount', discount_value: 5, discount_kind: 'referral', once_per_customer: false }] };
  for (const patch of [{ referral_code: 'SYNTHETICREF', referral_discount: 5, total: 37.99 },
    { discount_contract_version: 2, discount_code: 'SYNTHETICREF', total: 42.99 }]) {
    const ctx = fixture({ seed }); const response = await ctx.handle(patch); const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(result.effectiveTotal, 37.99);
    assert.equal(ctx.intent().amount, 3799); assert.equal(ctx.rows.CheckoutSession[0].checkout_data.referral_discount, 5);
  }
});
await test('member total and direct points value are recomputed rather than trusting the submitted final total', async () => {
  const ctx = fixture(); const response = await ctx.handle({ total: 0.01 }); const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.effectiveTotal, 42.99);
  const forged = fixture(); const rejected = await forged.handle({ points_used: 1, points_discount: 10 });
  assert.equal((await rejected.json()).error_code, 'INVALID_POINTS_SELECTION'); assert.equal(forged.effects.length, 0);
});
await test('ordinary member credits are price-checked, persisted and held before payment secret', async () => {
  const ctx = fixture({ seed: creditSeed }); const response = await ctx.handle({ credits_discount: 6, total: 0.01 });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
  assert.ok(result.clientSecret); assert.equal(ctx.intent().amount, 3699); assert.equal(result.effectiveTotal, 36.99);
  assert.equal(ctx.rows.NuViraCredit[0].reserved_balance, 6); assert.equal(ctx.rows.NuViraCredit[0].balance, 10);
  assert.ok(ctx.effects.indexOf('credit.CAS') > ctx.effects.indexOf('CheckoutSession.create'));
  assert.equal(ctx.rows.CheckoutSession[0].checkout_data.credit_reservation_id, ctx.intent().metadata.credit_reservation_id);
  assert.ok(Object.keys(ctx.intent().metadata).length <= 50);
});
await test('earned reward plus credits reserves both benefits without exceeding Stripe metadata capacity', async () => {
  const ctx = fixture({ seed: creditSeed }); const response = await ctx.handle({ active_reward: selected, credits_discount: 6 });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(ctx.rows.UserPoints[0].reserved_points, 1500); assert.equal(ctx.rows.NuViraCredit[0].reserved_balance, 6);
  assert.ok(Object.keys(ctx.intent().metadata).length <= 50); assert.equal(ctx.intent().amount, 3699);
});
await test('retry recognizes its existing credit hold without changing provider parameters', async () => {
  const ctx = fixture({ seed: creditSeed, strictStripe: true });
  assert.equal((await ctx.handle({ credits_discount: 6 })).status, 200); ctx.advance();
  const response = await ctx.handle({ credits_discount: 6 }); assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(ctx.rows.NuViraCredit[0].checkout_reservations.length, 1);
  assert.equal(ctx.rows.NuViraCredit[0].reserved_balance, 6); assert.equal(ctx.effects.filter(e => e === 'credit.CAS').length, 1);
});
await test('unacknowledged hold safely cancels and releases both points and credits without exposing secret', async () => {
  const ctx = fixture({ seed: creditSeed, loseCreditAck: true });
  const response = await ctx.handle({ credits_discount: 6, active_reward: selected }); const result = await response.json();
  assert.equal(result.error_code, 'CREDIT_PAYMENT_NOT_READY'); assert.equal(result.clientSecret, undefined);
  assert.equal(result.payment_attempt_canceled, true); assert.equal(result.credit_reservation_released, true);
  assert.equal(ctx.rows.NuViraCredit[0].reserved_balance, 0); assert.equal(ctx.rows.NuViraCredit[0].balance, 10);
  assert.equal(ctx.rows.UserPoints[0].reserved_points, 0);
});
await test('unconfirmed credit cancellation keeps its hold and payment secret withheld', async () => {
  const ctx = fixture({ seed: creditSeed, loseCreditAck: true, failCancel: true });
  const result = await (await ctx.handle({ credits_discount: 6 })).json();
  assert.equal(result.error_code, 'CREDIT_PAYMENT_NOT_READY'); assert.equal(result.clientSecret, undefined);
  assert.equal(result.payment_attempt_canceled, false); assert.equal(ctx.rows.NuViraCredit[0].reserved_balance, 6);
});
await test('a false successful credit storage acknowledgement fails independent readback', async () => {
  const ctx = fixture({ seed: creditSeed, ignoreCreditWrite: true });
  const result = await (await ctx.handle({ credits_discount: 6 })).json();
  assert.equal(result.error_code, 'CREDIT_PAYMENT_NOT_READY'); assert.equal(result.clientSecret, undefined);
  assert.equal(result.credit_reservation_released, false);
});
await test('unsecured, malformed and excessive credit selections fail before provider writes', async () => {
  for (const patch of [{ credits_discount: 11 }, { credits_discount: -1 }, { credits_discount: 0.001 },
    { credits_discount: 1, checkout_idempotency_key: null }]) {
    const ctx = fixture({ seed: creditSeed }); const response = await ctx.handle(patch);
    assert.equal(response.status, 409); assert.equal((await response.json()).clientSecret, undefined); assert.equal(ctx.effects.length, 0);
  }
});
await test('credits reducing the provider charge below its minimum are not silently charged extra', async () => {
  const ctx = fixture({ distanceMiles: 2, seed: { NuViraCredit: [{ ...creditSeed.NuViraCredit[0], balance: 50 }],
    Subscription: [{ customer_email: email, status: 'active', plan_id: 'plan' }], SubscriptionPlan: [{ id: 'plan', discount_percent: 10 }] } });
  const result = await (await ctx.handle({ credits_discount: 35.1 })).json();
  assert.equal(result.error_code, 'CREDIT_BALANCE_REQUIRES_REVIEW'); assert.equal(ctx.effects.length, 0);
});
await test('direct-point checkout connects actual preparation, ledger CAS and mirror before exposing secret', async () => {
  const ctx = fixture({ realLedger: true });
  const response = await ctx.handle({ points_used: 1000, points_discount: 10, total: 0 });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(ctx.intent().amount, 3299); assert.ok(result.clientSecret);
  assert.match(ctx.intent().metadata.reward_reservation_id, /^points:[a-f0-9]{64}$/);
  assert.equal(ctx.rows.UserPoints[0].reserved_points, 1000); assert.equal(ctx.rows.UserPoints[0].total_points, 7000);
  assert.equal(ctx.rows.LoyaltyMember[0].reserved_points, 1000);
  assert.ok(ctx.effects.indexOf('CheckoutSession.create') < ctx.effects.indexOf('UserPoints.CAS'));
  assert.equal(ctx.rows.CheckoutSession[0].checkout_data.points_reservation_revision, pointsLedger.DIRECT_POINTS_CHECKOUT_REVISION);
});
await test('direct points and credits reserve independently and settle both once', async () => {
  const ctx = fixture({ realLedger: true, seed: creditSeed });
  const response = await ctx.handle({ points_used: 1000, points_discount: 10, credits_discount: 6 });
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.ok(Object.keys(ctx.intent().metadata).length <= 50);
  assert.equal(ctx.rows.UserPoints[0].reserved_points, 1000); assert.equal(ctx.rows.NuViraCredit[0].reserved_balance, 6);
  ctx.intent().status = 'succeeded'; ctx.intent().amount_received = ctx.intent().amount;
  for (let i = 0; i < 2; i++) {
    assert.equal((await ctx.settle()).body.reservation_status, 'consumed');
    // The shared actual credit settlement uses the same saved payment/context.
    const entities = {};
    for (const name of ['Order', 'CheckoutSession', 'NuViraCredit']) entities[name] = {
      filter: async query => structuredClone(ctx.rows[name].filter(row => Object.entries(query).every(([key, value]) => row[key] === value))),
      updateMany: async (query, update) => {
        const rows = ctx.rows[name].filter(row => row.id === query.id && (query.credit_ledger_revision === undefined || row.credit_ledger_revision === query.credit_ledger_revision));
        rows.forEach(row => Object.assign(row, structuredClone(update.$set)));
        return { success: true, updated: rows.length, has_more: false };
      },
    };
    assert.equal((await creditReservation.settleCheckoutCredit({ entities, payment: ctx.intent(), email })).reservation_status, 'consumed');
  }
  assert.equal(ctx.rows.UserPoints[0].total_points, 6000); assert.equal(ctx.rows.UserPoints[0].reserved_points, 0);
  assert.equal(ctx.rows.LoyaltyTransaction.filter(row => row.status === 'posted').length, 1);
  assert.equal(ctx.rows.NuViraCredit[0].balance, 4); assert.equal(ctx.rows.NuViraCredit[0].reserved_balance, 0);
});
await test('direct-point retry restores only its own hold and keeps exact Stripe parameters', async () => {
  const ctx = fixture({ realLedger: true, strictStripe: true, seed: { UserPoints: [{
    id: 'points', customer_email: email, total_points: 1000, reserved_points: 0, reward_reservations: [],
  }] } });
  const input = { points_used: 1000, points_discount: 10 };
  assert.equal((await ctx.handle(input)).status, 200); ctx.advance();
  assert.equal((await ctx.handle(input)).status, 200); assert.equal(ctx.rows.UserPoints[0].reserved_points, 1000);
  assert.equal(ctx.rows.UserPoints[0].reward_reservations.length, 1);
  ctx.intent().status = 'succeeded'; ctx.intent().amount_received = ctx.intent().amount;
  assert.equal((await ctx.settle()).status, 200);
  assert.equal((await ctx.handle(input)).status, 200); assert.equal(ctx.rows.UserPoints[0].total_points, 0);
});
await test('direct-point cancellation releases the hold and mirror without awarding anything', async () => {
  const ctx = fixture({ realLedger: true }); assert.equal((await ctx.handle({ points_used: 1000, points_discount: 10 })).status, 200);
  ctx.intent().status = 'canceled';
  assert.equal((await ctx.settle()).body.reservation_status, 'released');
  assert.equal((await ctx.settle()).body.reservation_status, 'released');
  assert.equal(ctx.rows.UserPoints[0].total_points, 7000); assert.equal(ctx.rows.LoyaltyMember[0].reserved_points, 0);
  assert.equal(ctx.rows.LoyaltyTransaction.length, 0);
});
await test('lost direct-points hold acknowledgement cancels and releases without exposing secret', async () => {
  const ctx = fixture({ realLedger: true, losePointsAck: true });
  const response = await ctx.handle({ points_used: 1000, points_discount: 10 }); const result = await response.json();
  assert.equal(response.status, 503); assert.equal(result.clientSecret, undefined);
  assert.equal(result.payment_attempt_canceled, true); assert.equal(result.reward_reservation_released, true);
  assert.equal(ctx.rows.UserPoints[0].total_points, 7000); assert.equal(ctx.rows.UserPoints[0].reserved_points, 0);
});
await test('uncertain cancellation preserves direct-points hold for recovery', async () => {
  const ctx = fixture({ realLedger: true, losePointsAck: true, failCancel: true });
  const result = await (await ctx.handle({ points_used: 1000, points_discount: 10 })).json();
  assert.equal(result.clientSecret, undefined); assert.equal(result.payment_attempt_canceled, false);
  assert.equal(ctx.rows.UserPoints[0].reserved_points, 1000);
});
await test('false direct-points CAS acknowledgement cannot expose a payment secret', async () => {
  const ctx = fixture({ realLedger: true, ignorePointsWrite: true });
  const result = await (await ctx.handle({ points_used: 1000, points_discount: 10 })).json();
  assert.equal(result.error_code, 'REWARD_PAYMENT_NOT_READY'); assert.equal(result.clientSecret, undefined);
  assert.equal(result.reward_reservation_released, false);
});
await test('unsecured direct-points attempts stop before provider and record writes', async () => {
  for (const [options, patch] of [[{ noRewardSecret: true }, {}], [{}, { checkout_idempotency_key: null }]]) {
    const ctx = fixture({ realLedger: true, ...options });
    const response = await ctx.handle({ points_used: 1000, points_discount: 10, ...patch });
    assert.equal(response.status, 409); assert.equal((await response.json()).error_code, 'POINTS_CHECKOUT_NOT_READY');
    assert.equal(ctx.effects.length, 0);
  }
});
await test('points-only zero-cash checkout never becomes a fabricated fifty-cent payment', async () => {
  const ctx = fixture({ realLedger: true, seed: {
    Subscription: [{ customer_email: email, status: 'active', plan_id: 'plan' }], SubscriptionPlan: [{ id: 'plan', discount_percent: 10 }],
  } });
  const result = await (await ctx.handle({ points_used: 3510, points_discount: 35.1 })).json();
  assert.equal(result.error_code, 'POINTS_BALANCE_REQUIRES_REVIEW'); assert.equal(ctx.effects.length, 0);
});
console.log(`Checkout record persistence: ${passed}/${passed} passed. Real handler, synthetic storage/Maps/Stripe only; no external calls or production writes.`);
