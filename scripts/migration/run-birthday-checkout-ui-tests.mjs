import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { readBirthdayEligibility, birthdayEligibilityMessage, BIRTHDAY_CHECKOUT_REVISION } from '../../src/lib/birthdayCheckoutEligibility.js';
import { verifyCheckoutCatalog } from '../../src/lib/checkoutCatalogPreflight.js';
import { rewardDeliveryMinimumSubtotal } from '../../src/lib/rewardDeliveryMinimum.js';
import { quoteBirthdayCatalogCheckout } from '../../base44/functions/createPaymentIntent/birthdayCheckout.js';
import { birthdayWindow } from '../../base44/shared/birthdayEntitlement.js';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
const read = path => fs.readFileSync(path, 'utf8');
const response = () => ({ ok: true, revision: BIRTHDAY_CHECKOUT_REVISION,
  eligibility: { eligible: true, status: 'available', month_day: '09-08' },
  writes_performed: false, provider_calls_performed: false });
await test('UI reads only authenticated eligibility, and retains no DOB or claim binding', async () => {
  let calls = 0;
  const result = await readBirthdayEligibility(async (name, body) => {
    calls++; assert.equal(name, 'createPaymentIntent'); assert.deepEqual(body, { mode: 'birthday_checkout_eligibility' });
    return { data: response() };
  });
  assert.equal(calls, 1); assert.deepEqual(result, { eligible: true, status: 'available' });
});
await test('stale versions, missing read-only flags and contradictory eligibility never promise a gift', async () => {
  for (const patch of [{ ok: false }, { revision: 'old' }, { writes_performed: true }, { provider_calls_performed: true },
    { eligibility: { eligible: true, status: 'already_redeemed' } }, { eligibility: { status: 'available' } }]) {
    await assert.rejects(() => readBirthdayEligibility(async () => ({ ...response(), ...patch })), /could not confirm/);
  }
});
await test('provider errors and late responses fail without leaking payloads or changing state', async () => {
  await assert.rejects(() => readBirthdayEligibility(async () => { throw new Error('PRIVATE_SECRET'); }),
    error => /could not confirm/.test(error.message) && !error.message.includes('PRIVATE'));
  let finish; const pending = new Promise(resolve => { finish = resolve; });
  await assert.rejects(() => readBirthdayEligibility(() => pending, { timeoutMs: 5 }), /could not confirm/);
  finish(response());
});
await test('actual hook isolates account keys and hides stale availability during refetch/error/logout', () => {
  let options; let query = { data: { eligible: true, status: 'available' } };
  const module = { exports: {} };
  const compiled = transformSync(read('src/lib/useBirthdayCheckoutEligibility.js'), { loader: 'js', format: 'cjs' }).code;
  vm.runInNewContext(compiled, { module, exports: module.exports, require: name => {
    if (name === '@tanstack/react-query') return { useQuery: input => { options = input; return query; } };
    if (name.includes('base44Client')) return { base44: { functions: { invoke: () => { throw new Error('Network forbidden'); } } } };
    if (name.includes('birthdayCheckoutEligibility')) return { readBirthdayEligibility };
    throw new Error(`Unexpected dependency ${name}`);
  } });
  const use = module.exports.useBirthdayCheckoutEligibility;
  const user = { id: 'synthetic-a', email: 'a@example.test' };
  assert.equal(use(user).eligible, true); assert.deepEqual(Array.from(options.queryKey), ['birthday-checkout-eligibility', user.id, user.email]);
  for (const patch of [{ isFetching: true }, { isPending: true }, { error: new Error('offline') }]) {
    query = { data: { eligible: true, status: 'available' }, ...patch }; assert.equal(use(user).eligible, false);
  }
  assert.equal(use(null).eligible, false); assert.equal(options.enabled, false);
  use({ id: 'synthetic-b', email: 'b@example.test' }); assert.equal(options.queryKey[1], 'synthetic-b');
});

const items = [{ product_id: 'oasis', quantity: 2, price: 13 }, { product_id: '__birthday_reward__',
  birthday_product_id: 'oasis', isBirthdayReward: true, quantity: 1, price: 0 }];
const quoted = () => quoteBirthdayCatalogCheckout({ items,
  products: [{ id: 'oasis', title: 'OASIS', price: 13, category: 'juice', size: '12 oz', is_available: true }],
  eligibility: birthdayWindow({ birthday: '1990-09-08', signupDate: '2025-01-01T00:00:00Z', now: Date.parse('2026-09-08T15:00:00Z') }) });
const envelope = () => ({ ok: true, quote: quoted(), preview_only: true, writes_performed: false,
  provider_calls_performed: false, payment_intent_created: false, order_created: false });
await test('cart preflight preserves free birthday pricing and delivery minimum uses server retail value', async () => {
  const q = await verifyCheckoutCatalog(async () => ({ data: envelope() }), items);
  assert.equal(q.subtotal, 26); assert.equal(q.items[1].price, 0);
  assert.equal(await rewardDeliveryMinimumSubtotal({ items, subtotal: 26, activeReward: null,
    preview: async body => { assert.equal(body.mode, 'preview_catalog_checkout'); return { data: envelope() }; } }), 39);
  await assert.rejects(() => rewardDeliveryMinimumSubtotal({ items, subtotal: 26, activeReward: { id: 'tier' },
    preview: () => { throw new Error('Must not invoke'); } }), /birthday_reward_combination_unavailable/);
});
await test('browser refuses silent repricing, missing gift proof and different products before checkout writes', async () => {
  for (const change of [data => { delete data.quote.birthday_checkout; }, data => { data.quote.birthday_checkout.revision = 'old'; },
    data => { data.quote.items[1].price = 13; data.quote.subtotal = 39; },
    data => { data.quote.items[1].product_id = 'aura'; }, data => { data.quote.catalog_subtotal = 26; },
    data => { data.quote.birthday_discount = 0; }, data => { data.quote.items[1].isBirthdayReward = false; }]) {
    const data = envelope(); change(data); await assert.rejects(() => verifyCheckoutCatalog(async () => data, items), /confirm your cart/);
  }
});
await test('annual claim UI distinguishes completed, reserved, unavailable and loading states', () => {
  assert.match(birthdayEligibilityMessage({ status: 'already_redeemed' }), /already enjoyed/);
  assert.match(birthdayEligibilityMessage({ status: 'checkout_in_progress' }), /Resume or cancel/);
  assert.match(birthdayEligibilityMessage({ status: 'checking' }), /Checking/);
  assert.match(birthdayEligibilityMessage({ status: 'birthday_history_review_required' }), /could not confirm/);
});
await test('Cart and Rewards use server eligibility, fixed birthday quantity and preserved offer markers', () => {
  for (const file of ['src/pages/Cart.jsx', 'src/pages/Rewards.jsx']) {
    const source = read(file); assert.match(source, /useBirthdayCheckoutEligibility\(user\)/);
    assert.doesNotMatch(source, /isBirthdayRewardActive/);
  }
  const cart = read('src/pages/Cart.jsx'); assert.doesNotMatch(cart, /containsJuiceOrderItems/);
  assert.match(cart, /if \(!birthdayActive \|\| activeReward\) return/);
  assert.match(cart, /1 birthday juice/); assert.match(cart, /birthdayActive \|\| rewardInCart/);
  const context = read('src/lib/cartContext.jsx'); assert.match(context, /if \(existing\?\.isBirthdayReward\) return/);
  const checkout = read('src/pages/Checkout.jsx'); assert.match(checkout, /isBirthdayReward: item.isBirthdayReward === true, birthday_product_id:/);
});
console.log(`Birthday checkout UI: ${passed}/${passed} synthetic contracts pass; no browser/provider/live claims.`);
