import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { orderMinimumStatus } from '../../src/lib/orderMinimums.js';
import { rewardDeliveryMinimumSubtotal } from '../../src/lib/rewardDeliveryMinimum.js';

const juice = (quantity, extra = {}) => ({ category: 'juice', quantity, price: 13, ...extra });
const shot = (quantity, extra = {}) => ({ category: 'shot', quantity, price: 6, ...extra });
const rewardBundle = count => ({ category: 'bundle', quantity: 1, bottles_per_unit: count,
  price: 0, isFreeReward: true, reward_id: 'synthetic-reward' });
const cases = [
  ['empty cart', [], false],
  ['single earned bottle alone', [juice(1, { price: 0, isFreeReward: true })], false],
  ['single earned shot alone', [shot(1, { price: 0, isFreeReward: true })], false],
  ['earned bottle plus two paid bottles', [juice(1, { price: 0, isFreeReward: true }), juice(2)], true],
  ['earned shot plus five paid shots', [shot(1, { price: 0, isFreeReward: true }), shot(5)], true],
  ['earned three-bottle bundle alone', [rewardBundle(3)], true],
  ['earned six-bottle bundle alone', [rewardBundle(6)], true],
  ['earned bundle plus optional paid items', [rewardBundle(6), juice(2)], true],
  ['undersized earned bundle', [rewardBundle(2)], false],
  ['earned bundle with missing count', [{ ...rewardBundle(6), bottles_per_unit: undefined }], false],
  ['paid three-bottle order unchanged', [juice(3)], true],
  ['paid six-shot order unchanged', [shot(6)], true],
  ['paid mixed minimum unchanged', [juice(2), shot(2)], true],
  ['paid mixed below minimum unchanged', [juice(2), shot(1)], false],
  ['merchandise-only rule unchanged', [{ category: 'merchandise', quantity: 1, price: 20 }], true],
  ['merchandise cannot pad a juice minimum', [{ category: 'merchandise', quantity: 1, price: 100 }, juice(1)], false],
  ['zero quantity cannot qualify', [rewardBundle(6), juice(0)], false],
  ['negative quantity cannot qualify', [juice(-3)], false],
  ['fractional quantity cannot qualify', [juice(3.5)], false],
];
for (const [name, items, expected] of cases) {
  assert.equal(orderMinimumStatus(items).meetsMinimum, expected, name);
}
for (const price of [0, 0.01, 39, 78]) {
  assert.equal(orderMinimumStatus([{ ...rewardBundle(6), price }]).units, 6);
}

// Execute the actual checkout preflight with all external effects prohibited.
const checkout = fs.readFileSync('src/pages/Checkout.jsx', 'utf8');
const begin = checkout.indexOf('const handlePlaceOrder = async () => {');
const end = checkout.indexOf('// Block checkout if running inside an iframe', begin);
assert.ok(begin >= 0 && end > begin);
const prefix = checkout.slice(begin, end);
for (const [name, items, allowed] of cases.filter(([, items]) => items.length)) {
  let progressed = false;
  let blocked = false;
  const context = { orderMinimumStatus, items,
    checkoutAttemptInFlightRef: { current: false }, checkoutStartLockedRef: { current: false },
    toast: { error() { blocked = true; } }, progress() { progressed = true; } };
  vm.runInNewContext(prefix + 'progress(); }; this.run = handlePlaceOrder;', context);
  await context.run();
  assert.equal(progressed, allowed, name + ' checkout preflight');
  assert.equal(blocked, !allowed, name + ' checkout feedback');
}
assert.match(fs.readFileSync('src/pages/Cart.jsx', 'utf8'), /orderMinimumStatus\(items\)/);
// Owner-approved dollar minimum: qualified rewards count at catalog retail
// value, not their zero/discounted cart price. The browser reads a server quote.
let previewCalls = 0;
const approvedQuote = { ok: true, preview_only: true, writes_performed: false,
  quote: { revision: '2026-09-08.reward-checkout-v1', active_reward: { id: 'vip' }, catalog_subtotal: 78 } };
const previewInput = { subtotal: 0, items: [rewardBundle(6)], activeReward: { id: 'vip' },
  preview: async payload => { previewCalls++; assert.equal(payload.mode, 'preview_reward_checkout');
    assert.deepEqual(payload.active_reward, { id: 'vip' }); return { data: approvedQuote }; } };
assert.equal(await rewardDeliveryMinimumSubtotal(previewInput), 78);
assert.equal(await rewardDeliveryMinimumSubtotal({ ...previewInput, activeReward: null, subtotal: 39 }), 39);
assert.equal(previewCalls, 1);
for (const value of [null, -1, '78', NaN, Infinity]) {
  await assert.rejects(rewardDeliveryMinimumSubtotal({ ...previewInput,
    preview: async () => ({ data: { ...approvedQuote, quote: { ...approvedQuote.quote, catalog_subtotal: value } } }) }));
}
for (const patch of [{ ok: false }, { preview_only: false }, { writes_performed: true },
  { quote: { ...approvedQuote.quote, revision: 'old' } }, { quote: { ...approvedQuote.quote, active_reward: { id: 'other' } } }]) {
  await assert.rejects(rewardDeliveryMinimumSubtotal({ ...previewInput, preview: async () => ({ data: { ...approvedQuote, ...patch } }) }));
}
assert.match(checkout, /cart_subtotal: qualifyingSubtotal/);
assert.match(checkout, /rewardDeliveryMinimumSubtotal\(\{ subtotal, items, activeReward/);
// Manual authorization still has no reward settlement contract. Test its actual
// preflight in both bundles: no new eligibility rule may create an unreserved
// discounted authorization while that integration is unfinished.
const routeFiles = ['base44/functions/createZone3AuthorizationIntent/entry.ts',
  'base44/functions/getCustomerAccountDashboardData/handlers/createZone3AuthorizationIntent/entry.ts'];
let routeGuardCases = 0;
for (const file of routeFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const begin = source.indexOf('const items = body.items ?? body.cart_items ?? [];');
  const end = source.indexOf('const subtotal =', begin); assert.ok(begin > 0 && end > begin);
  const guard = source.slice(begin, end);
  for (const body of [{ active_reward: { id: 'vip' } }, { items: [{ isFreeReward: true }] },
    { items: [{ reward_id: 'vip' }] }, { cart_items: [{ product_id: '__free_reward_old' }] }, { items: [juice(3)] }]) {
    const run = vm.runInNewContext(`(async () => { ${guard} return 'continue'; })`, { body, Response });
    const result = await run();
    if (body.items?.[0]?.price === 13) assert.equal(result, 'continue');
    else { assert.equal(result.status, 409); assert.equal((await result.json()).error_code, 'REWARD_ROUTE_REVIEW_NOT_READY'); }
    routeGuardCases++;
  }
}
console.log(JSON.stringify({ ok: true, suite: 'reward-order-minimum', policy_cases: cases.length,
  checkout_preflight_cases: cases.length - 1, price_independence_cases: 4,
  retail_preview_cases: 12, route_guard_cases: routeGuardCases,
  provider_calls: false, production_writes: false,
  limitation: 'Synthetic count/retail-preview and fail-closed manual-route guards. Live redemption and route-review integration remain pending.' }, null, 2));
