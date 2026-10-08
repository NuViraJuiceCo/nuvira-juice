import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { orderMinimumStatus } from '../../src/lib/orderMinimums.js';
import { rewardDeliveryMinimumSubtotal, rewardDeliveryErrorMessage } from '../../src/lib/rewardDeliveryMinimum.js';
import { replaceEarnedRewardItems } from '../../src/lib/rewardSelection.js';
import { quoteRewardCheckout } from '../../base44/functions/createPaymentIntent/rewardCheckout.js';

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
const begin = checkout.indexOf('const handlePlaceOrder = async (routeAcknowledged = false) => {');
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
assert.equal(await rewardDeliveryMinimumSubtotal({ ...previewInput, items: [juice(3)], activeReward: null, subtotal: 39 }), 39);
assert.equal(previewCalls, 1);
await assert.rejects(rewardDeliveryMinimumSubtotal({ ...previewInput, activeReward: null }), { code: 'REWARD_SELECTION_REQUIRED' });
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

// The reported paid-only cart must not be trapped by a hidden saved bottle reward.
const paid = { ...juice(3), product_id: 'aura', title: 'AURA' };
const savedReward = { id: 'saved-bottle', title: 'Free Bottle', reward_type: 'free_bottle', points_required: 1000, is_active: true };
let rewardRejection;
try {
  quoteRewardCheckout({ items: [paid], products: [{ ...paid, id: 'aura', is_available: true, size: '12oz' }],
    reward: savedReward, requestedReward: savedReward, availablePoints: 1500 });
} catch (error) { rewardRejection = error; }
assert.equal(rewardRejection?.code, 'REWARD_QUANTITY_MISMATCH');
assert.match(rewardDeliveryErrorMessage(rewardRejection), /own product selection/);
assert.match(rewardDeliveryErrorMessage({ response: { data: { error_code: 'INSUFFICIENT_REWARD_POINTS' } } }), /not enough available points/);
assert.doesNotMatch(rewardDeliveryErrorMessage({ message: 'private server details', response: { data: { error: 'private server details' } } }), /private/);
assert.match(rewardDeliveryErrorMessage(new Error('offline')), /Try again/);

const recoverySource = checkout.slice(checkout.indexOf('  const resetRewardDeliveryValidation ='), checkout.indexOf('  const {\n    data: scheduleOptionsPayload'));
assert.ok(recoverySource.includes('handleRemoveCheckoutReward'));
for (const blockedBy of [null, 'rewardSelectionLocked', 'checkoutAttemptInFlightRef', 'checkoutStartLockedRef', 'storage']) {
  const effects = [];
  let cart = [paid, { ...juice(1), product_id: 'aura', reward_id: savedReward.id, isFreeReward: true, price: 0 }];
  let revision = 0;
  const context = { user: { email: 'synthetic@example.invalid' }, rewardSelectionLocked: blockedBy === 'rewardSelectionLocked',
    checkoutAttemptInFlightRef: { current: blockedBy === 'checkoutAttemptInFlightRef' },
    checkoutStartLockedRef: { current: blockedBy === 'checkoutStartLockedRef' },
    addressValidationRequestRef: { current: 3 }, addressDebounceRef: { current: 2 },
    clearTimeout: () => effects.push('cancel-timer'),
    localStorage: { removeItem(key) { if (blockedBy === 'storage') throw new Error('blocked'); effects.push(key); } },
    clearEarnedRewardItems: () => { cart = replaceEarnedRewardItems(cart); },
    setRewardSelectionRevision: fn => { revision = fn(revision); },
    requestAnimationFrame: () => {}, toast: { success: () => effects.push('success'), error: () => effects.push('error') },
  };
  for (const setter of ['setAddressValidated', 'setZoneEligibility', 'setDeliveryZone', 'setAddressValidationError', 'setRewardValidationError', 'setUsePoints', 'setUseCredits', 'setAppliedDiscountCode']) {
    context[setter] = value => effects.push([setter, value]);
  }
  vm.runInNewContext(recoverySource + 'this.remove = handleRemoveCheckoutReward; this.retry = handleRetryCheckoutReward;', context);
  context.remove();
  if (!blockedBy) {
    assert.deepEqual(cart, [paid], 'Paid AURA line is retained, even when the reward uses the same product ID');
    assert.equal(revision, 1);
    assert.equal(context.addressValidationRequestRef.current, 4, 'Stale async response invalidated synchronously');
    assert.ok(effects.includes('activeReward_synthetic@example.invalid'));
    assert.ok(effects.some(effect => Array.isArray(effect) && effect[0] === 'setAddressValidated' && effect[1] === false));
    assert.equal(await rewardDeliveryMinimumSubtotal({ items: cart, subtotal: 39, activeReward: null,
      preview: () => { throw new Error('Paid cart must not call reward preview'); } }), 39);
    assert.equal(orderMinimumStatus(cart).meetsMinimum, true);
    effects.length = 0;
    context.retry();
    assert.equal(revision, 2);
    assert.equal(context.addressValidationRequestRef.current, 5);
    assert.ok(!effects.some(effect => typeof effect === 'string' && effect.startsWith('activeReward_')), 'Retry never removes a reward');
  } else {
    assert.equal(cart.length, 2);
    assert.equal(revision, 0);
    assert.equal(context.addressValidationRequestRef.current, 3);
    assert.deepEqual(effects, blockedBy === 'storage' ? ['error'] : []);
  }
}
assert.match(checkout, /const rewardSelectionLocked = Boolean\(isSubmitting \|\| checkoutStartLocked \|\| clientSecret \|\| rewardCheckoutSessionId \|\| rewardCheckoutRecovery \|\| paidAttemptRef.current\)/);
assert.match(checkout, /user\?\.email, rewardSelectionRevision/);
assert.match(checkout, /addressValidationRequestRef.current === validationRequestId\) addressValidationRequestRef.current \+= 1/);
const deliveryReadySource = checkout.match(/const deliveryReady = (.*);/)[1];
for (const quantity of [2, 3]) {
  const context = { checkoutMinimum: orderMinimumStatus([juice(quantity)]), routeReview: false,
    addressValidated: true, zoneEligibility: { checkout_allowed: true }, selectedDeliveryOption: { option_id: 'synthetic' } };
  assert.equal(vm.runInNewContext(deliveryReadySource, context), quantity === 3, 'Removing an earned bottle cannot bypass the remaining cart minimum');
}
// Both retained route entrypoints delegate unchanged benefit selections to the
// authoritative root. Runtime qualification/hold/decision cases are exercised
// in run-checkout-record-persistence-tests.mjs.
const routeFiles = ['base44/functions/createZone3AuthorizationIntent/entry.ts',
  'base44/functions/getCustomerAccountDashboardData/handlers/createZone3AuthorizationIntent/entry.ts'];
let routeGuardCases = 0;
for (const file of routeFiles) {
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /base44.functions.invoke\('createPaymentIntent'/);
  assert.match(source, /\.\.\.body, mode: 'prepare_route_review', guest_checkout: false/);
  assert.match(source, /customer_acknowledged_hold !== true/);
  assert.doesNotMatch(source, /paymentIntents.create|DeliveryApprovalRequest.create/);
  routeGuardCases += 4;
}
console.log(JSON.stringify({ ok: true, suite: 'reward-order-minimum', policy_cases: cases.length,
  checkout_preflight_cases: cases.length - 1, price_independence_cases: 4,
  retail_preview_cases: 12, route_guard_cases: routeGuardCases,
  checkout_reward_recovery_cases: 5,
  provider_calls: false, production_writes: false,
  limitation: 'Synthetic count/retail-preview and shared route entrypoint contracts. Runtime integration is tested separately; this is not live provider evidence.' }, null, 2));
