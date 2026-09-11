#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { PUBLIC_PRODUCT_FALLBACKS } from '../../src/lib/public-product-catalog.js';
import { orderMinimumStatus } from '../../src/lib/orderMinimums.js';
import { DELIVERY_POLICY_PATH, DELIVERY_WINDOWS } from '../../src/lib/delivery-policy.js';
import { buildProductGallery } from '../../src/lib/product-gallery-images.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
// Use the same CommonJS router context as the in-memory component bundle.
const { StaticRouter } = require('react-router-dom');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const checkout = read('src/pages/Checkout.jsx');
const detail = read('src/pages/ProductDetail.jsx');
const cart = read('src/pages/Cart.jsx');
const offerSource = read('src/components/shop/FirstOrderOffer.jsx');
const detailsSource = read('src/components/shop/ProductOrderDetails.jsx');
let checks = 0;
const check = async (name, run) => { await run(); checks += 1; console.log(`PASS ${name}`); };
const coreSlugs = ['aura', 'oasis', 're-nu'];
const coreProducts = coreSlugs.map(slug => PUBLIC_PRODUCT_FALLBACKS.find(product => product.slug === slug));
assert.ok(coreProducts.every(Boolean));

// Extract the actual existing coupon input/button JSX and email helpers. The
// real UI primitives and normalizer are bundled; only the provider is stubbed.
const emailHelpers = checkout.slice(checkout.indexOf('const normalizeCheckoutEmail ='), checkout.indexOf('const BAG_RETURN_COMPLETED_STATUSES'));
assert.match(emailHelpers, /const isValidCheckoutEmail/);
const couponMarker = checkout.indexOf('id="discount-code"');
const inputStart = checkout.lastIndexOf('<Input', couponMarker);
const couponInput = checkout.slice(inputStart, checkout.indexOf('/>', couponMarker) + 2);
const buttonStart = checkout.indexOf('<Button', couponMarker);
const couponButton = checkout.slice(buttonStart, checkout.indexOf('</Button>', buttonStart) + '</Button>'.length);
assert.match(couponInput, /id="discount-code"/);
assert.match(couponButton, /validate_discount_code/);
const offerSlot = detail.match(/\{\['juice', 'shot', 'bundle'\]\.includes\(normalizeCategory\(product\.category\)\) && \([\s\S]*?<FirstOrderOffer[\s\S]*?<ProductOrderDetails[\s\S]*?\n\s*\)\}/)?.[0];
assert.ok(offerSlot, 'Exercise the actual category-scoped product offer slot');
const normalizedCategory = detail.match(/function normalizeCategory\(value\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(normalizedCategory);
const vars = ['discountCodeInput', 'setDiscountCodeInput', 'setAppliedDiscountCode', 'appliedDiscountCode', 'isApplyingDiscountCode', 'setIsApplyingDiscountCode', 'isGuestCheckout', 'normalizedCustomerEmail', 'base44', 'merchandiseTotalBeforePromotion', 'pointsDiscount', 'rewardDiscountAmt', 'creditsDiscount', 'activeReward', 'pointsUsed', 'items', 'toast'];
const compiled = await build({
  stdin: { contents: `
    import FirstOrderOffer from './src/components/shop/FirstOrderOffer.jsx';
    import ProductOrderDetails from './src/components/shop/ProductOrderDetails.jsx';
    import { Input } from './src/components/ui/input.jsx';
    import { Button } from './src/components/ui/button.jsx';
    import { normalizeValidatedCheckoutCode } from './src/lib/checkoutPromotions.js';
    export { FirstOrderOffer, ProductOrderDetails };
    ${emailHelpers}
    ${normalizedCategory}
    export function productOfferSlot(product) { return (<>${offerSlot}</>); }
    export function couponInput(env) { const { ${vars.join(', ')} } = env; return (${couponInput}); }
    export function couponButton(env) { const { ${vars.join(', ')} } = env; return (${couponButton}); }
    export { isValidCheckoutEmail, normalizeCheckoutEmail };
  `, resolveDir: root, sourcefile: 'shopping-offer-contract.jsx', loader: 'jsx' },
  bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-router-dom'], logLevel: 'silent',
  plugins: [{ name: 'real-local-source-aliases', setup(builder) {
    builder.onResolve({ filter: /^@\// }, args => {
      const candidate = path.join(root, 'src', args.path.slice(2));
      const found = [candidate, `${candidate}.js`, `${candidate}.jsx`].find(file => fs.existsSync(file));
      assert.ok(found, `Missing local alias ${args.path}`); return { path: found };
    });
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', 'window', compiled.outputFiles[0].text)(require, module, module.exports, { self: null, top: null });
const components = module.exports;
const render = element => renderToStaticMarkup(React.createElement(StaticRouter, { location: '/' }, element));
const renderDetails = product => render(React.createElement(components.ProductOrderDetails, { product }));
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const trioHref = 'href="/product/the-nuvira-trio.html"';
const previousFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('External requests are forbidden in this regression harness'); };

try {
  await check('shared offer really renders evergreen first-order terms without claiming eligibility', () => {
    const html = render(React.createElement(components.FirstOrderOffer));
    assert.match(html, /aria-label="First-order offer"/);
    for (const phrase of ['10% off', 'WELCOME10', 'Enter WELCOME10 at checkout', 'First orders only, once per customer', 'Cannot be combined with other discounts or reward redemptions', 'Order minimums, delivery fees and applicable taxes apply', 'Eligibility is verified at checkout']) assert.ok(text(html).includes(phrase), phrase);
    assert.doesNotMatch(html, /<button|<input|<form|<details|<summary|\shidden(?:=|\s|>)/);
    assert.doesNotMatch(text(html), /September|October|expires|automatically applied|already applied|free delivery|no minimum/i);
  });

  await check('offer and ordering components cannot set codes, change carts, or call providers', () => {
    for (const source of [offerSource, detailsSource]) {
      assert.doesNotMatch(source, /use(?:State|Effect|LayoutEffect)\s*\(|onClick=|onSubmit=|fetch\s*\(|functions\.invoke|localStorage|sessionStorage|setDiscountCode|setAppliedDiscount|addToCart|updateQuantity/);
    }
    assert.match(offerSource, /className = ''/);
    assert.match(render(React.createElement(components.FirstOrderOffer, { className: 'test-spacing' })), /test-spacing/);
  });

  await check('real ProductDetail offer slot is limited to juice, shot and bundle categories', () => {
    for (const category of ['juice', 'shot', 'bundle', ' JUICE ']) {
      const html = render(components.productOfferSlot({ category, title: 'Synthetic product', bottle_count: 3 }));
      assert.match(html, /First-order offer/); assert.match(html, /Ordering and delivery details/);
    }
    for (const category of ['merch', 'bag', 'wellness_pack', 'program', 'other', '', undefined]) {
      assert.equal(render(components.productOfferSlot({ category, title: 'Synthetic product' })), '');
      assert.equal(renderDetails({ category }), '');
    }
    assert.equal(renderDetails(null), '');
    assert.ok(detail.indexOf('<FirstOrderOffer') > detail.indexOf('product.price?.toFixed(2)'));
    assert.ok(detail.indexOf('<ProductOrderDetails') < detail.indexOf('{productBadges.map'));
  });

  await check('all three core juices show the canonical Trio shortcut and exact minimum explanation', () => {
    for (const product of coreProducts) {
      const html = renderDetails(product);
      assert.ok(html.includes(trioHref), product.title);
      assert.match(text(html), /at least 3 juices, 6 shots, or an equivalent mix/);
      assert.doesNotMatch(text(html), /meets the juice-and-shot count minimum/);
    }
  });

  await check('Trio shortcut does not leak to shots, seasonal singles, other bundles or spoofed identities', () => {
    for (const product of PUBLIC_PRODUCT_FALLBACKS.filter(product => !coreSlugs.includes(product.slug))) assert.ok(!renderDetails(product).includes(trioHref), product.title);
    for (const product of [
      { id: 'unrelated', category: 'juice', slug: 'oasis' },
      { id: 'unrelated', category: 'juice', title: 'AURA' },
      { product_id: 'unrelated', category: 'juice', slug: 're-nu' },
      { id: coreProducts[0].id, category: 'shot', slug: 'aura' },
      { category: 'juice', slug: 'seasonal-watermelon' },
    ]) assert.ok(!renderDetails(product).includes(trioHref), JSON.stringify(product));
    for (const slug of coreSlugs) assert.ok(renderDetails({ category: 'juice', slug }).includes(trioHref), 'Known slug fallback remains available when ID is absent');
  });

  await check('delivery copy comes from the existing policy and does not promise a date or free delivery', () => {
    const html = renderDetails(coreProducts[0]);
    assert.ok(html.includes(`href="${DELIVERY_POLICY_PATH}"`));
    for (const window of DELIVERY_WINDOWS) {
      assert.ok(text(html).includes(window.deliveryDay)); assert.ok(text(html).includes(window.deliveryWindow));
    }
    assert.match(text(html), /Regular local delivery/);
    assert.match(text(html), /Fees and area minimums depend on your address/);
    assert.match(text(html), /Checkout confirms your available date and full total/);
    assert.doesNotMatch(text(html), /guaranteed|same.day|free delivery|every address|ZIP.*eligible/i);
  });

  await check('displayed count minimum matches the real helper for juices, shots and mixed orders', () => {
    for (const [items, expected] of [
      [[{ category: 'juice', quantity: 2 }], false], [[{ category: 'juice', quantity: 3 }], true],
      [[{ category: 'shot', quantity: 5 }], false], [[{ category: 'shot', quantity: 6 }], true],
      [[{ category: 'juice', quantity: 2 }, { category: 'shot', quantity: 2 }], true],
      [[{ category: 'juice', quantity: 1 }, { category: 'shot', quantity: 3 }], false],
    ]) assert.equal(orderMinimumStatus(items).meetsMinimum, expected);
    assert.match(detailsSource, /import \{ orderMinimumStatus \} from '@\/lib\/orderMinimums'/);
  });

  await check('Trio count qualification never promises delivery-area dollar eligibility', () => {
    const trio = PUBLIC_PRODUCT_FALLBACKS.find(product => product.slug === 'the-nuvira-trio'); assert.ok(trio);
    const html = renderDetails(trio);
    assert.match(text(html), /The Trio meets the juice-and-shot count minimum/);
    assert.match(text(html), /Delivery-area dollar minimums still apply/);
    assert.ok(!html.includes(trioHref), 'No redundant Trio self-link');
  });

  await check('bundle count copy follows actual nullish/default rules, including malformed counts', () => {
    for (const count of [0, 1, 2, 3, 4, 100, 101, -1, 2.5, '', 'bad', '3', null, undefined]) {
      const product = { category: 'bundle', title: 'Synthetic bundle', bottle_count: count };
      const expected = orderMinimumStatus([{ category: 'bundle', quantity: 1, bottles_per_unit: count ?? 3 }]).meetsMinimum;
      assert.equal(/meets the juice-and-shot count minimum/.test(text(renderDetails(product))), expected, `bottle_count=${String(count)}`);
    }
    assert.match(text(renderDetails({ category: 'bundle', bottles_per_unit: 4 })), /meets the juice-and-shot count minimum/);
    assert.doesNotMatch(text(renderDetails({ category: 'bundle', bottle_count: 0, bottles_per_unit: 4 })), /meets the juice-and-shot count minimum/);
    assert.doesNotMatch(text(renderDetails({ category: 'bundle', bottles_per_unit: 0 })), /meets the juice-and-shot count minimum/);
  });

  await check('Cart and Checkout reuse one informational component without changing purchase/footer controls', () => {
    for (const source of [detail, cart, checkout]) assert.equal((source.match(/<FirstOrderOffer\b/g) || []).length, 1);
    assert.ok(cart.indexOf('<FirstOrderOffer') < cart.indexOf('<CartDeliveryCheckPrompt'));
    assert.ok(cart.indexOf('<FirstOrderOffer') < cart.indexOf('{!meetsMinimum &&'));
    assert.ok(checkout.indexOf('<FirstOrderOffer') > checkout.indexOf('benefits={<>'));
    assert.ok(checkout.indexOf('<FirstOrderOffer') < checkout.indexOf('id="discount-code"'));
    assert.match(checkout, /const \[discountCodeInput, setDiscountCodeInput\] = useState\(''\)/);
    assert.match(checkout, /const \[appliedDiscountCode, setAppliedDiscountCode\] = useState\(null\)/);
    assert.match(checkout, /const normalizedCustomerEmail = normalizeCheckoutEmail\(user\?\.email \|\| checkoutEmail\)/);
  });

  const createEnv = (overrides = {}) => {
    const state = { calls: [], code: '', applied: null, busy: [], notices: [] };
    const env = {
      discountCodeInput: '', appliedDiscountCode: null, isApplyingDiscountCode: false, isGuestCheckout: true,
      normalizedCustomerEmail: 'buyer@example.test', merchandiseTotalBeforePromotion: 36,
      pointsDiscount: 5, rewardDiscountAmt: 6, creditsDiscount: 7, activeReward: { id: 'synthetic-reward' }, pointsUsed: 500,
      items: [{ product_id: coreProducts[0].id, quantity: 3 }],
      setDiscountCodeInput: value => { state.code = value; }, setAppliedDiscountCode: value => { state.applied = value; },
      setIsApplyingDiscountCode: value => state.busy.push(value),
      toast: { success: value => state.notices.push({ type: 'success', value }), error: value => state.notices.push({ type: 'error', value }) },
      base44: { functions: { invoke: async (name, payload) => {
        state.calls.push({ name, payload });
        return { data: { ok: true, discount: { code: 'WELCOME10', type: 'promotion', label: 'Welcome discount', amount: 3.6, percent: 10, eligible_subtotal: 36 } } };
      } } }, ...overrides,
    };
    return { env, state };
  };

  await check('rendering new offer and actual coupon controls never auto-applies or contacts the provider', () => {
    const { env, state } = createEnv();
    render(React.createElement(components.FirstOrderOffer)); render(components.couponInput(env)); render(components.couponButton(env));
    assert.deepEqual(state.calls, []); assert.equal(state.applied, null); assert.equal(state.code, '');
    assert.equal(components.couponInput(env).props.value, '');
    assert.equal(components.couponButton(env).props.disabled, true);
    assert.equal(components.couponButton(env).props.type, 'button');
  });

  await check('guest email validation remains mandatory before explicit coupon application', () => {
    for (const value of ['', 'bad', 'name@domain', 'name @domain.test', `${'a'.repeat(250)}@example.test`]) {
      const { env } = createEnv({ discountCodeInput: 'WELCOME10', normalizedCustomerEmail: value });
      assert.equal(components.isValidCheckoutEmail(value), false);
      assert.equal(components.couponButton(env).props.disabled, true, value);
    }
    assert.equal(components.normalizeCheckoutEmail(' BUYER@EXAMPLE.TEST '), 'buyer@example.test');
    for (const value of ['buyer@example.test', 'buyer+tag@example.test']) {
      const { env } = createEnv({ discountCodeInput: 'WELCOME10', normalizedCustomerEmail: value });
      assert.equal(components.isValidCheckoutEmail(value), true); assert.equal(components.couponButton(env).props.disabled, false);
    }
  });

  await check('explicit guest Apply invokes only existing validation and preserves guest discount isolation', async () => {
    const { env, state } = createEnv({ discountCodeInput: 'WELCOME10' });
    await components.couponButton(env).props.onClick();
    assert.equal(state.calls.length, 1); const call = state.calls[0];
    assert.equal(call.name, 'createPaymentIntent');
    assert.equal(call.payload.mode, 'validate_discount_code'); assert.equal(call.payload.discount_code, 'WELCOME10');
    assert.equal(call.payload.customer_email, 'buyer@example.test'); assert.equal(call.payload.guest_checkout, true);
    assert.equal(call.payload.eligible_subtotal, 36);
    for (const key of ['points_discount', 'reward_discount', 'credits_discount', 'points_used']) assert.equal(call.payload[key], 0);
    assert.equal(call.payload.active_reward, null);
    assert.deepEqual(state.busy, [true, false]); assert.equal(state.applied.code, 'WELCOME10'); assert.equal(state.applied.amount, 3.6);
  });

  await check('member explicit Apply keeps existing reward context available for server non-stacking enforcement', async () => {
    const { env, state } = createEnv({ isGuestCheckout: false, discountCodeInput: 'WELCOME10' });
    await components.couponButton(env).props.onClick(); const payload = state.calls[0].payload;
    assert.equal(payload.guest_checkout, false); assert.equal(payload.points_discount, 5); assert.equal(payload.reward_discount, 6);
    assert.equal(payload.credits_discount, 7); assert.equal(payload.points_used, 500); assert.deepEqual(payload.active_reward, { id: 'synthetic-reward' });
  });

  await check('provider rejection, unavailable validation and malformed responses cannot apply the displayed offer', async () => {
    for (const response of [{ data: { ok: false } }, { data: { ok: true, discount: { code: 'WELCOME10', amount: -1 } } }, null]) {
      const { env, state } = createEnv({ discountCodeInput: 'WELCOME10', base44: { functions: { invoke: async () => response } } });
      await components.couponButton(env).props.onClick(); assert.equal(state.applied, null); assert.equal(state.code, '');
      assert.equal(state.notices.at(-1).type, 'error'); assert.deepEqual(state.busy, [true, false]);
    }
    const { env, state } = createEnv({ discountCodeInput: 'WELCOME10', base44: { functions: { invoke: async () => { throw new Error('Synthetic unavailable validator'); } } } });
    await components.couponButton(env).props.onClick(); assert.equal(state.applied, null); assert.equal(state.notices.at(-1).type, 'error'); assert.deepEqual(state.busy, [true, false]);
  });

  await check('coupon edit, remove and in-flight disabled states remain unchanged', async () => {
    const { env, state } = createEnv({ appliedDiscountCode: { code: 'WELCOME10' }, discountCodeInput: 'WELCOME10' });
    assert.equal(components.couponInput(env).props.disabled, true);
    assert.match(render(components.couponButton(env)), /Remove/);
    await components.couponButton(env).props.onClick(); assert.equal(state.applied, null); assert.equal(state.code, ''); assert.deepEqual(state.calls, []);
    components.couponInput({ ...env, appliedDiscountCode: null }).props.onChange({ target: { value: 'OTHER' } });
    assert.equal(state.code, 'OTHER'); assert.equal(state.applied, null);
    assert.equal(components.couponButton({ ...env, isApplyingDiscountCode: true }).props.disabled, true);
  });

  await check('existing approved galleries keep all four photos and never restore the retired original', () => {
    const scenes = {
      aura: ['aura-drinking', 'aura-conversation', 'aura-bench'],
      oasis: ['oasis-event-cooler', 'oasis-sunset-bottle', 'oasis-sunset-trio'],
      're-nu': ['re-nu-shared-drink', 're-nu-conversation', 're-nu-bench'],
    };
    for (const product of coreProducts) {
      const gallery = buildProductGallery({ ...product, secondary_images: [product.image_url] });
      assert.deepEqual(gallery.map(item => item.src), [
        `/images/approved-lifestyle/20260910/${product.slug}-primary.webp`,
        ...scenes[product.slug].map(name => `/images/authentic-products/${product.slug}/${name}.jpg`),
      ]);
      assert.equal(gallery[0].thumbnail, `/images/approved-lifestyle/20260910/${product.slug}-card.webp`);
      assert.equal(gallery[0].fit, 'contain'); assert.equal(gallery.length, 4);
    }
    assert.match(detail, /aspect-\[4\/5\]/); assert.match(detail, /buildProductGallery\(product/);
  });
} finally {
  globalThis.fetch = previousFetch;
}

console.log(`Shopping offer continuity: ${checks} checks passed; real component/coupon rendering, no external network or provider writes.`);
