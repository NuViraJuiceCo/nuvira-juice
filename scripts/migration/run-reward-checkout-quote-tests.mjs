import assert from 'node:assert/strict';
import * as creditReservation from '../../base44/shared/checkoutCredit.js';
import * as birthdayCheckout from '../../base44/functions/createPaymentIntent/birthdayCheckout.js';
import * as birthdayEntitlement from '../../base44/shared/birthdayEntitlement.js';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as checkout from '../../base44/functions/createPaymentIntent/rewardCheckout.js';
import * as noPaymentCheckout from '../../base44/functions/createPaymentIntent/noPaymentCheckout.js';
import * as paidRecovery from '../../base44/functions/createPaymentIntent/paidCheckoutRecovery.js';
import * as offers from '../../base44/functions/createPaymentIntent/firstOrderEligibility.js';

// Synthetic in-memory fixtures only. Entity writes and external/provider calls throw.
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS', name); }
const product = (id, extra = {}) => ({ id, title: id.toUpperCase(), category: 'juice', size: '12 oz',
  price: 13, is_available: true, image_url: `https://images.example.test/${id}.png`, ...extra });
const products = [product('oasis'), product('aura'), product('renu'),
  product('shot', { category: 'shot', size: '2 oz', price: 6 }),
  product('large', { size: '32 oz', price: 15 }),
  product('trio', { category: 'bundle', size: '3 x 12 oz', bottle_count: 3, price: 36 }),
  product('tote', { category: 'merch', size: '', price: 10 })];
const costs = { free_shot: 500, free_bottle: 1000, double_points: 1500,
  discount_10pct: 2500, bundle_upgrade: 4000, vip_box: 6000, discount: 2500, free_delivery: 1000 };
const reward = type => ({ id: `reward-${type}`, title: type, reward_type: type,
  points_required: costs[type], is_active: true });
const paid = (id, quantity = 1) => ({ product_id: id, quantity, price: 0.01, title: 'UNTRUSTED', category: 'merch' });
const earned = (type, id, quantity = 1) => ({ ...paid(id, quantity), reward_id: reward(type).id, isFreeReward: true });
function quote(type, items, patch = {}) {
  return checkout.quoteRewardCheckout({ items, products, reward: reward(type), requestedReward: reward(type),
    availablePoints: costs[type], ...patch });
}
const fails = (fn, code) => assert.throws(fn, error => error instanceof checkout.RewardCheckoutError && error.code === code);

await test('free bottle plus two paid bottles counts three and charges only paid catalog prices', () => {
  const result = quote('free_bottle', [paid('oasis', 2), earned('free_bottle', 'oasis')]);
  assert.equal(result.physical_units, 3); assert.equal(result.catalog_subtotal, 39);
  assert.equal(result.subtotal, 26); assert.equal(result.reward_item_discount, 13);
  assert.equal(result.merchandise_total, 26); assert.equal(result.points_required, 1000);
  assert.equal(result.items[1].product_id, 'oasis'); assert.equal(result.items[1].price, 0);
  assert.equal(result.items[0].title, 'OASIS'); assert.equal(result.items[0].category, 'juice');
});
await test('free shot plus five paid shots meets minimum and uses canonical shot price', () => {
  const result = quote('free_shot', [paid('shot', 5), earned('free_shot', 'shot')]);
  assert.equal(result.physical_units, 3); assert.equal(result.merchandise_total, 30);
});
await test('discount_10pct matches the live catalog identifier and takes exactly ten percent', () => {
  const result = quote('discount_10pct', [paid('oasis', 3)]);
  assert.equal(result.reward_discount, 3.9); assert.equal(result.merchandise_total, 35.1);
});
await test('double points is an explicit fulfillment instruction, not a fake price discount', () => {
  const result = quote('double_points', [paid('oasis', 3)]);
  assert.equal(result.points_multiplier, 2); assert.equal(result.merchandise_total, 39);
  assert.equal(result.reward_discount, 0); assert.equal(result.points_required, 1500);
});
await test('bundle upgrade discounts exactly three additional bottles by half', () => {
  const result = quote('bundle_upgrade', [paid('oasis', 3), earned('bundle_upgrade', 'aura', 3)]);
  assert.equal(result.physical_units, 6); assert.equal(result.catalog_subtotal, 78);
  assert.equal(result.reward_item_discount, 19.5); assert.equal(result.merchandise_total, 58.5);
  assert.equal(result.items[1].price, 6.5); assert.equal(result.items[1].isFreeReward, false);
});
await test('a real paid Trio supports the upgrade without inventing three paid cart lines', () => {
  const result = quote('bundle_upgrade', [paid('trio'), earned('bundle_upgrade', 'aura', 3)]);
  assert.equal(result.physical_units, 6); assert.equal(result.merchandise_total, 55.5);
  assert.equal(result.items[0].bottles_per_unit, 3);
});
await test('earned six-bottle VIP quote requires no paid merchandise and stays exactly zero before separate charges', () => {
  const result = quote('vip_box', [earned('vip_box', 'oasis', 2), earned('vip_box', 'aura', 2), earned('vip_box', 'renu', 2)]);
  assert.equal(result.physical_units, 6); assert.equal(result.subtotal, 0);
  assert.equal(result.merchandise_total, 0); assert.equal(result.reward_item_discount, 78);
  assert.equal(result.free_delivery, false); assert.equal(result.points_required, 6000);
});
await test('VIP box can include optional paid items without losing earned bottle counts', () => {
  const result = quote('vip_box', [earned('vip_box', 'oasis', 6), paid('aura', 2)]);
  assert.equal(result.physical_units, 8); assert.equal(result.merchandise_total, 26);
});
await test('legacy percentage and delivery catalog types retain defined behavior', () => {
  assert.equal(quote('discount', [paid('oasis', 3)]).merchandise_total, 35.1);
  assert.equal(quote('free_delivery', [paid('oasis', 3)]).free_delivery, true);
});
await test('canonical catalog overrides client reward cost type title price and size', () => {
  const result = quote('discount_10pct', [paid('oasis', 3)], { requestedReward: { id: reward('discount_10pct').id,
    title: 'Forged', points_required: 1, reward_type: 'vip_box' } });
  assert.equal(result.active_reward.reward_type, 'discount_10pct'); assert.equal(result.points_required, 2500);
  assert.equal(result.items[0].size, '12 oz'); assert.equal(result.items[0].price, 13);
});
for (const [name, patch, code] of [
  ['inactive', { reward: { ...reward('discount_10pct'), is_active: false } }, 'REWARD_UNAVAILABLE'],
  ['unknown reward', { reward: reward('unknown') }, 'REWARD_UNAVAILABLE'],
  ['wrong ID', { requestedReward: { id: 'other' } }, 'REWARD_UNAVAILABLE'],
  ['no selection', { requestedReward: null }, 'REWARD_UNAVAILABLE'],
  ['not enough points', { availablePoints: 2499 }, 'INSUFFICIENT_REWARD_POINTS'],
  ['negative balance', { availablePoints: -1 }, 'INVALID_REWARD_BALANCE'],
  ['fractional balance', { availablePoints: 2500.5 }, 'INVALID_REWARD_BALANCE'],
  ['missing balance', { availablePoints: undefined }, 'INVALID_REWARD_BALANCE'],
  ['zero cost', { reward: { ...reward('discount_10pct'), points_required: 0 } }, 'INVALID_REWARD_COST'],
  ['duplicate catalog', { products: [...products, products[0]] }, 'INVALID_REWARD_CATALOG'],
  ['missing product', { products: [] }, 'REWARD_PRODUCT_UNAVAILABLE'],
  ['unavailable product', { products: [{ ...products[0], is_available: false }] }, 'REWARD_PRODUCT_UNAVAILABLE'],
  ['bad catalog price', { products: [{ ...products[0], price: 'invalid' }] }, 'INVALID_CATALOG_PRICE'],
  ['fractional cents', { products: [{ ...products[0], price: 13.001 }] }, 'INVALID_CATALOG_PRICE'],
]) await test(name + ' fails closed', () => fails(() => quote('discount_10pct', [paid('oasis', 3)], patch), code));
for (const quantity of [0, -1, 1.5, 101, NaN, null, '', true]) {
  await test(`invalid quantity ${quantity} cannot become a valid order`, () => {
    fails(() => quote('discount_10pct', [paid('oasis', quantity)]), 'INVALID_REWARD_QUANTITY');
  });
}
for (const type of ['free_bottle', 'free_shot']) await test(type + ' alone cannot bypass the ordinary count minimum', () => {
  fails(() => quote(type, [earned(type, type === 'free_shot' ? 'shot' : 'oasis')]), 'ORDER_MINIMUM_NOT_MET');
});
for (const type of ['free_bottle', 'bundle_upgrade', 'vip_box']) await test(type + ' cannot obtain larger bottles', () => {
  fails(() => quote(type, [paid('oasis', 3), earned(type, 'large', type === 'vip_box' ? 6 : type === 'bundle_upgrade' ? 3 : 1)]), 'REWARD_PRODUCT_INELIGIBLE');
});
await test('invalid free products cannot be hidden behind paid merchandise', () => {
  fails(() => quote('free_shot', [paid('oasis', 3), earned('free_shot', 'tote')]), 'REWARD_PRODUCT_INELIGIBLE');
  fails(() => quote('discount_10pct', [paid('oasis', 3), earned('discount_10pct', 'oasis')]), 'REWARD_PRODUCT_INELIGIBLE');
});
await test('earned quantity is exact, not unlimited or silently partial', () => {
  for (const [type, number] of [['free_bottle', 2], ['bundle_upgrade', 2], ['bundle_upgrade', 4], ['vip_box', 5], ['vip_box', 7]]) {
    fails(() => quote(type, [paid('oasis', 3), earned(type, 'aura', number)]), 'REWARD_QUANTITY_MISMATCH');
  }
  fails(() => quote('free_bottle', [paid('oasis', 3)]), 'REWARD_QUANTITY_MISMATCH');
});
await test('old synthetic IDs, duplicate reward rows and mismatched reward IDs are rejected', () => {
  for (const patch of [{ product_id: '__free_reward_old' }, { reward_id: 'another-reward' }, { product_id: 123 }]) {
    fails(() => quote('free_bottle', [paid('oasis', 3), { ...earned('free_bottle', 'aura'), ...patch }]), 'REWARD_ITEM_MISMATCH');
  }
  fails(() => quote('vip_box', [earned('vip_box', 'oasis', 3), earned('vip_box', 'oasis', 3)]), 'REWARD_ITEM_MISMATCH');
});
await test('shots, totes and earned items cannot substitute for the three paid upgrade bottles', () => {
  for (const base of [[paid('shot', 6)], [paid('tote', 3)], [], [paid('oasis', 2)]]) {
    fails(() => quote('bundle_upgrade', [...base, earned('bundle_upgrade', 'aura', 3)]), 'REWARD_UPGRADE_BASE_REQUIRED');
  }
});
await test('unknown bundle count fails instead of fabricating physical bottles', () => {
  fails(() => quote('double_points', [paid('trio')], { products: [{ ...products[5], bottle_count: undefined }] }), 'BUNDLE_COUNT_UNAVAILABLE');
});
await test('known program count and identity come from trusted program resolver', () => {
  const result = quote('free_bottle', [paid('program_hydration_2day'), earned('free_bottle', 'oasis')], {
    resolveProgram: item => item.product_id === 'program_hydration_2day' ? {
      product_id: 'program_hydration_2day', title: 'Hydration Program (2-Day)', price: 104,
      category: 'bundle', bottles_per_unit: 8, program_key: 'hydration', program_days: 2,
      program_schedule_version: 'trusted', bundle_composition: [{ product_id: 'oasis', product_name: 'OASIS', quantity: 6 }, { product_id: 'aura', product_name: 'AURA', quantity: 2 }],
    } : null,
  });
  assert.equal(result.physical_units, 9); assert.equal(result.subtotal, 104);
  assert.equal(result.items[0].program_days, 2); assert.equal(result.items[0].bundle_composition.length, 2);
});
await test('currency rounds once to cents and never exceeds catalog totals', () => {
  const result = quote('discount_10pct', [paid('oasis', 3)], { products: [{ ...products[0], price: 13.05 }] });
  assert.equal(result.subtotal, 39.15); assert.equal(result.reward_discount, 3.92); assert.equal(result.merchandise_total, 35.23);
});

const email = 'buyer@example.test';
const defaultBody = { mode: 'preview_reward_checkout', customer_email: email,
  active_reward: reward('discount_10pct'), items: [paid('oasis', 3)] };
function fakeDb({ rewards = [reward('discount_10pct')], balances = [{ total_points: 2500 }], catalog = products,
  user = { email }, error = false } = {}) {
  const reads = [];
  const forbidden = () => { throw new Error('Forbidden write/provider/network effect'); };
  const table = (name, rows) => ({ filter: async (...args) => {
    reads.push({ name, args }); if (error) throw new Error('PRIVATE DB DETAIL'); return structuredClone(rows);
  }, create: forbidden, update: forbidden, delete: forbidden, updateMany: forbidden });
  return { reads, auth: { me: async () => user }, asServiceRole: { functions: { invoke: forbidden }, entities: {
    RewardTier: table('RewardTier', rewards), UserPoints: table('UserPoints', balances), Product: table('Product', catalog),
  } } };
}
function handler(db) {
  let served;
  const module = { exports: {} };
  const code = transformSync(fs.readFileSync('base44/functions/createPaymentIntent/entry.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, Request, Response, URL, URLSearchParams, crypto: globalThis.crypto,
    console: { log() {}, warn() {}, error() {} }, Deno: { env: { get: () => undefined }, serve: fn => { served = fn; } },
    fetch: () => { throw new Error('Network forbidden'); }, require: name => {
      if (name.includes('@base44/sdk')) return { createClientFromRequest: () => db };
      if (name.includes('rewardCheckout')) return checkout;
      if (name.includes('checkoutCredit')) return creditReservation;
      if (name.includes('birthdayCheckout')) return birthdayCheckout;
      if (name.includes('birthdayEntitlement')) return birthdayEntitlement;
      if (name.includes('noPaymentCheckout')) return noPaymentCheckout;
      if (name.includes('paidCheckoutRecovery')) return paidRecovery;
      if (name.includes('firstOrderEligibility')) return offers;
      if (name.includes('stripe')) return class { constructor() { return new Proxy({}, { get() { throw new Error('Stripe use forbidden'); } }); } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return served;
}
const request = body => new Request('https://unit.test/preview', { method: 'POST', body: JSON.stringify(body) });
await test('actual handler preview is authenticated, catalog-backed and strictly read-only', async () => {
  const db = fakeDb(); const result = await handler(db)(request(defaultBody)); const body = await result.json();
  assert.equal(result.status, 200); assert.equal(body.quote.merchandise_total, 35.1);
  assert.equal(body.quote.revision, checkout.REWARD_CHECKOUT_REVISION); assert.equal(body.preview_only, true);
  for (const key of ['writes_performed', 'provider_calls_performed', 'payment_intent_created', 'order_created']) assert.equal(body[key], false);
  assert.deepEqual(db.reads.map(read => read.name).sort(), ['Product', 'RewardTier', 'UserPoints']);
  assert.equal(db.reads.find(read => read.name === 'UserPoints').args[0].customer_email, email);
});
for (const [name, config, bodyPatch, expected, code] of [
  ['anonymous', { user: null }, {}, 401, 'REWARD_AUTH_REQUIRED'],
  ['cross customer', {}, { customer_email: 'other@example.test' }, 409, 'REWARD_AUTH_REQUIRED'],
  ['database error', { error: true }, {}, 409, 'REWARD_QUOTE_UNAVAILABLE'],
  ['duplicate balance', { balances: [{ total_points: 2500 }, { total_points: 2500 }] }, {}, 409, 'REWARD_DATA_UNAVAILABLE'],
  ['missing balance', { balances: [] }, {}, 409, 'REWARD_DATA_UNAVAILABLE'],
  ['reserved elsewhere', { balances: [{ total_points: 3000, reserved_points: 1000 }] }, {}, 409, 'INSUFFICIENT_REWARD_POINTS'],
  ['malformed reservation list', { balances: [{ total_points: 3000, reward_reservations: {} }] }, {}, 409, 'INVALID_REWARD_BALANCE'],
  ['malformed reservation row', { balances: [{ total_points: 3000, reward_reservations: [null] }] }, {}, 409, 'INVALID_REWARD_BALANCE'],
  ['truncated catalog', { catalog: Array.from({ length: 250 }, (_, i) => product(String(i))) }, {}, 409, 'REWARD_DATA_UNAVAILABLE'],
]) await test(`actual handler: ${name} fails safely before any effects`, async () => {
  const result = await handler(fakeDb(config))(request({ ...defaultBody, ...bodyPatch })); const body = await result.json();
  assert.equal(result.status, expected); assert.equal(body.error_code, code); assert.equal(body.writes_performed, false);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE DB DETAIL|buyer@example/);
});
await test('preview does not claim points reservation or debit, payment, or fulfillment completion', async () => {
  const body = await (await handler(fakeDb())(request(defaultBody))).json();
  assert.equal(body.quote.reservation_id, undefined); assert.equal(body.clientSecret, undefined);
  assert.equal(body.quote.order_id, undefined); assert.equal(body.quote.transaction_id, undefined);
});
await test('admin runtime marker is read-only and explicitly reports unfinished reward payment integration', async () => {
  const db = fakeDb({ user: { email, role: 'admin' } });
  const response = await handler(db)(request({ mode: 'checkout_runtime_status' })); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.checkout_record_revision, '2026-09-09.no-payment-direct-points-v5');
  assert.equal(body.catalog_quote_revision, checkout.CATALOG_CHECKOUT_REVISION);
  assert.equal(body.reward_payment_integration_complete, false); assert.equal(body.writes_performed, false);
  assert.equal(db.reads.length, 0);
});
await test('runtime status is not exposed to ordinary customers or guests', async () => {
  for (const user of [null, { email }]) {
    const response = await handler(fakeDb({ user }))(request({ mode: 'checkout_runtime_status' }));
    assert.equal(response.status, 403);
  }
});
console.log(`Reward checkout pricing: ${passed}/${passed} passed; synthetic-only, no network, provider or customer writes. NOT payment/redemption/live validation.`);
