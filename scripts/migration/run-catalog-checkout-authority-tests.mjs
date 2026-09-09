import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { quoteCatalogCheckout, loadCatalogCheckoutQuote, CATALOG_CHECKOUT_REVISION } from '../../base44/functions/createPaymentIntent/rewardCheckout.js';
import { verifyCheckoutCatalog } from '../../src/lib/checkoutCatalogPreflight.js';

// Synthetic contracts only. There are no network, customer or provider calls.
const products = [
  { id: 'oasis', title: 'OASIS', price: 13, category: 'juice', size: '12 oz', is_available: true,
    image_url: '/fixture-oasis.webp', shopify_product_id: 'product-fixture', shopify_variant_id: 'variant-fixture', meta_catalog_content_id: 'meta-fixture' },
  { id: 'shot', title: 'Hydration', price: 6, category: 'shot', size: '2 oz', is_available: true },
  { id: 'trio', title: 'NuVira Trio', price: 36, category: 'bundle', bottle_count: 3, is_available: true },
  { id: 'tote', title: 'Small tote', price: 5, category: 'merchandise', is_available: true },
];
const items = [{ product_id: 'oasis', title: 'OASIS', price: 13, quantity: 3 }];
const quote = (patch = {}) => quoteCatalogCheckout({ items, products, ...patch });
const rejectsCode = (run, code) => assert.throws(run, error => error.code === code);
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS', name); }

await test('catalog identity, price, image and provider mapping replace submitted metadata', () => {
  const result = quote({ items: [{ ...items[0], title: 'Fake', category: 'merchandise', size: '99 oz', image_url: 'wrong',
    shopify_variant_id: 'wrong', is_program: true, bottles_per_unit: 99, bundle_composition: [{ product_id: 'wrong', quantity: 99 }] }] });
  assert.equal(result.subtotal, 39); assert.equal(result.physical_units, 3); assert.equal(result.revision, CATALOG_CHECKOUT_REVISION);
  assert.deepEqual(result.items[0], { product_id: 'oasis', title: 'OASIS', price: 13, quantity: 3, category: 'juice', size: '12 oz',
    image_url: '/fixture-oasis.webp', shopify_product_id: 'product-fixture', shopify_variant_id: 'variant-fixture', meta_catalog_content_id: 'meta-fixture' });
});
for (const price of [0, 1, 12.99, 13.01, 999]) await test(`changed or forged price ${price} cannot create an unseen charge`, () => {
  rejectsCode(() => quote({ items: [{ ...items[0], price }] }), 'PRODUCT_PRICE_OR_AVAILABILITY_CHANGED');
});
await test('malformed prices and quantities fail closed', () => {
  for (const price of [null, '', false, -1, NaN, Infinity, 13.001]) {
    rejectsCode(() => quote({ items: [{ ...items[0], price }] }), 'INVALID_CATALOG_PRICE');
  }
  for (const quantity of [null, '', false, 0, -1, 1.5, 101, Infinity]) {
    rejectsCode(() => quote({ items: [{ ...items[0], quantity }] }), 'INVALID_ORDER_ITEMS');
  }
});
await test('one juice cannot bypass minimum by claiming a different category or bottle count', () => {
  rejectsCode(() => quote({ items: [{ ...items[0], quantity: 1, category: 'bundle', bottles_per_unit: 100 }] }), 'ORDER_MINIMUM_NOT_MET');
});
await test('six shots and equivalent mixed orders satisfy the existing bottle-count minimum', () => {
  assert.equal(quote({ items: [{ product_id: 'shot', price: 6, quantity: 6 }] }).physical_units, 3);
  assert.equal(quote({ items: [{ ...items[0], quantity: 2 }, { product_id: 'shot', price: 6, quantity: 2 }] }).physical_units, 3);
  rejectsCode(() => quote({ items: [{ product_id: 'shot', price: 6, quantity: 5 }] }), 'ORDER_MINIMUM_NOT_MET');
});
await test('non-beverage merchandise does not fabricate bottles or require juice additions', () => {
  const result = quote({ items: [{ product_id: 'tote', price: 5, quantity: 1 }] });
  assert.equal(result.physical_units, 0); assert.equal(result.subtotal, 5);
});
await test('a catalog Trio counts as three bottles and preserves legacy composition resolution', () => {
  const result = quote({ items: [{ product_id: 'trio', price: 36, quantity: 1, bottles_per_unit: 99, bundle_composition: [] }] });
  assert.equal(result.physical_units, 3); assert.equal(result.subtotal, 36);
  assert.equal(result.items[0].bottles_per_unit, 3);
  assert.equal(Object.hasOwn(result.items[0], 'bundle_composition'), false, 'Do not persist an empty authoritative snapshot');
});
await test('trusted bundle snapshots are strict and are not multiplied twice by line quantity', () => {
  const composition = [{ product_id: 'oasis', product_name: 'OASIS', quantity: 3 }];
  const result = quote({ products: [{ ...products[2], bundle_composition: composition }],
    items: [{ product_id: 'trio', price: 36, quantity: 2 }] });
  assert.equal(result.physical_units, 6); assert.deepEqual(result.items[0].bundle_composition, composition);
  for (const bundle_composition of [[], [{ ...composition[0], quantity: 2 }], [composition[0], composition[0]],
    [{ ...composition[0], product_id: '../wrong' }], [{ ...composition[0], product_name: '' }]]) {
    rejectsCode(() => quote({ products: [{ ...products[2], bundle_composition }],
      items: [{ product_id: 'trio', price: 36, quantity: 1 }] }), 'BUNDLE_COMPOSITION_UNAVAILABLE');
  }
  rejectsCode(() => quote({ products: [{ ...products[2], bottle_count: undefined }],
    items: [{ product_id: 'trio', price: 36, quantity: 1 }] }), 'BUNDLE_COUNT_UNAVAILABLE');
});
await test('missing, unavailable, duplicate and potentially truncated catalog rows are rejected', () => {
  rejectsCode(() => quote({ products: [] }), 'PRODUCT_PRICE_OR_AVAILABILITY_CHANGED');
  rejectsCode(() => quote({ products: [{ ...products[0], is_available: false }] }), 'PRODUCT_PRICE_OR_AVAILABILITY_CHANGED');
  rejectsCode(() => quote({ products: [{ ...products[0], is_available: undefined }] }), 'PRODUCT_PRICE_OR_AVAILABILITY_CHANGED');
  rejectsCode(() => quote({ products: [products[0], products[0]] }), 'CATALOG_UNAVAILABLE');
  rejectsCode(() => quote({ products: Array.from({ length: 250 }, (_, i) => ({ ...products[0], id: `p${i}` })) }), 'CATALOG_UNAVAILABLE');
  for (const bad of [null, {}, [{ id: '' }]]) rejectsCode(() => quote({ products: bad }), 'CATALOG_UNAVAILABLE');
});
await test('empty, oversized, unknown and malformed carts are rejected', () => {
  for (const bad of [null, {}, [], Array(51).fill(items[0])]) rejectsCode(() => quote({ items: bad }), 'INVALID_ORDER_ITEMS');
  for (const product_id of ['', null, '__free_fake', 'unknown']) {
    rejectsCode(() => quote({ items: [{ ...items[0], product_id }] }), 'PRODUCT_PRICE_OR_AVAILABILITY_CHANGED');
  }
});
await test('real catalog IDs win over client-supplied program identity and decorators cannot override money', () => {
  const result = quote({ resolveProgram: () => { throw new Error('Must not resolve a catalog row as a program'); },
    decorateItem: () => ({ title: 'Fake', price: 0, quantity: 99, isFreeReward: true, program_addon_for: 'hydration' }) });
  assert.equal(result.items[0].price, 13); assert.equal(result.items[0].title, 'OASIS');
  assert.equal(result.items[0].program_addon_for, undefined); assert.equal(result.items[0].isFreeReward, undefined);
});
await test('birthday and earned markers cannot masquerade as ordinary merchandise', () => {
  for (const marker of [{ isBirthdayReward: true }, { birthday_product_id: 'oasis' }, { product_id: '__birthday_reward__' }]) {
    rejectsCode(() => quote({ items: [{ ...items[0], ...marker }] }), 'BIRTHDAY_REWARD_REQUIRES_VERIFICATION');
  }
  for (const marker of [{ isFreeReward: true }, { reward_id: 'earned' }, { product_id: '__free_reward_fake' }]) {
    rejectsCode(() => quote({ items: [{ ...items[0], ...marker }] }), 'REWARD_SELECTION_REQUIRED');
  }
});
await test('loader requests only available public catalog rows and turns read errors into retryable errors', async () => {
  const db = { asServiceRole: { entities: { Product: { filter: async (...args) => {
    assert.deepEqual(args, [{ is_available: true }, 'sort_order', 250]); return products;
  } } } } };
  assert.equal((await loadCatalogCheckoutQuote(db, items)).subtotal, 39);
  db.asServiceRole.entities.Product.filter = async () => { throw new Error('private database error'); };
  await assert.rejects(() => loadCatalogCheckoutQuote(db, items), error => error.code === 'CATALOG_UNAVAILABLE' && !error.message.includes('private'));
});

const envelope = () => ({ ok: true, quote: quote(), preview_only: true, writes_performed: false,
  provider_calls_performed: false, payment_intent_created: false, order_created: false });
await test('browser preflight invokes only the read-only catalog mode and returns the canonical quote', async () => {
  let calls = 0;
  const result = await verifyCheckoutCatalog(async (name, payload) => {
    calls++; assert.equal(name, 'createPaymentIntent'); assert.deepEqual(payload, { mode: 'preview_catalog_checkout', items });
    return { data: envelope() };
  }, items);
  assert.equal(calls, 1); assert.equal(result.subtotal, 39);
});
await test('preflight refuses missing safety flags, stale version, malformed quotes and inconsistent totals', async () => {
  for (const key of ['preview_only', 'writes_performed', 'provider_calls_performed', 'payment_intent_created', 'order_created']) {
    const data = envelope(); delete data[key];
    await assert.rejects(() => verifyCheckoutCatalog(async () => data, items), /confirm your cart/);
  }
  for (const change of [q => { q.revision = 'old'; }, q => { q.items = []; }, q => { q.subtotal = 0; },
    q => { q.items[0].quantity = 1.5; }, q => { q.items[0].price = -13; }]) {
    const data = envelope(); change(data.quote);
    await assert.rejects(() => verifyCheckoutCatalog(async () => data, items), /confirm your cart/);
  }
});
await test('preflight shows a verified customer error but never raw network or private server errors', async () => {
  const data = { ...envelope(), ok: false, error: 'A product price changed. Please review your cart.' };
  for (const invoke of [async () => data, async () => { throw { response: { data } }; }]) {
    await assert.rejects(() => verifyCheckoutCatalog(invoke, items), /product price changed/);
  }
  for (const invoke of [async () => { throw new Error('SECRET provider stack'); },
    async () => ({ ok: false, error: 'SECRET provider stack' })]) {
    await assert.rejects(() => verifyCheckoutCatalog(invoke, items), error => /confirm your cart/.test(error.message) && !error.message.includes('SECRET'));
  }
});
await test('preflight timeout is bounded and late read completion cannot start a payment or retry', async () => {
  let resolve; let reads = 0; let paymentStarts = 0;
  const read = new Promise(done => { resolve = done; });
  await assert.rejects(async () => {
    await verifyCheckoutCatalog(() => { reads++; return read; }, items, { timeoutMs: 5 });
    paymentStarts++;
  }, /confirm your cart/);
  resolve(envelope()); await Promise.resolve();
  assert.equal(reads, 1); assert.equal(paymentStarts, 0);
});

await test('actual Checkout preflight returns before profile or payment and preserves recovery state on failure', async () => {
  const source = fs.readFileSync('src/pages/Checkout.jsx', 'utf8');
  const start = source.indexOf('      // Ordinary carts get the same server catalog authority');
  const end = source.indexOf('      // Save phone & address', start);
  assert.ok(start > 0 && end > start);
  assert.ok(end < source.indexOf('      // Save bag return request', end));
  assert.ok(end < source.indexOf('      paymentAttemptStarted = true;', end));
  const block = source.slice(start, end);
  assert.doesNotMatch(block, /forgetRewardAttempt|clearRewardCheckoutAttempt|checkoutIdempotencyKey\./);
  for (const outcome of ['success', 'error', 'left-page', 'changed-account', 'changed-account-error']) {
    const fail = outcome === 'error' || outcome === 'changed-account-error';
    const effects = []; const state = { current: true }; let uiMessage;
    const identity = { current: 'fixture:buyer@example.test' };
    await vm.runInNewContext(`(async () => { ${block}\n effects.push('profile-and-payment-path'); })()`, {
      activeReward: null, items, effects, checkoutAttemptInFlightRef: state,
      user: { id: 'fixture', email: 'buyer@example.test' }, checkoutCustomerIdentityRef: identity,
      verifyCheckoutCatalog, base44: { functions: { invoke: async () => {
        if (outcome === 'left-page') state.current = false;
        if (outcome.startsWith('changed-account')) identity.current = 'other:other@example.test';
        effects.push('catalog-read'); return fail ? { ...envelope(), ok: false, error: 'Review current prices.' } : envelope();
      } } },
      clearCheckoutProcessingWatchdog: () => effects.push('watchdog-cleared'),
      setCheckoutStartLockedSafely: value => assert.equal(value, false),
      setCheckoutStartStage: value => assert.equal(value, 'failed-before-payment'),
      CHECKOUT_START_STAGES: { FAILED_BEFORE_PAYMENT_ATTEMPT: 'failed-before-payment' },
      setCheckoutStartMessage: value => { uiMessage = value; }, setIsSubmitting: value => assert.equal(value, false),
      toast: { error: message => assert.equal(message, 'Review current prices.') },
    });
    assert.equal(effects.includes('profile-and-payment-path'), outcome === 'success');
    if (outcome === 'error') { assert.equal(state.current, false); assert.equal(uiMessage, 'Review current prices.'); }
    if (outcome.startsWith('changed-account') || outcome === 'left-page') {
      assert.equal(state.current, false); assert.equal(uiMessage, undefined, 'Old request cannot display an error for another account');
    }
  }
});
console.log(`Catalog authority and browser preflight: ${passed}/${passed} passed. Local synthetic-only; not a live/provider release verification.`);
