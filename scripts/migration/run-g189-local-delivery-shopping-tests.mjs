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
import { deliveryLandingProducts, deliveryLandingPrice } from '../../src/lib/localDeliveryShopping.js';
import { productPath } from '../../src/lib/seo-slugs.js';
import { orderMinimumStatus } from '../../src/lib/orderMinimums.js';
import { DELIVERY_POLICY_CONTENT, DELIVERY_ZONE_SUMMARY } from '../../src/lib/delivery-policy.js';
import { classifyPreliminaryDeliveryAvailability, restorePreliminaryDeliveryAvailability, PRELIMINARY_DELIVERY_CHECK_VERSION } from '../../src/lib/preliminaryDeliveryAvailability.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
// The in-memory JSX bundle is CommonJS: use the same provider instances instead
// of mixing the packages' independent ESM and CJS context exports.
const { StaticRouter } = require('react-router-dom');
const { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const landing = read('src/pages/LocalSeoLanding.jsx');
const shopping = read('src/components/landing/LocalDeliveryShopping.jsx');
const eligibility = read('src/components/delivery/DeliveryAvailabilityCard.jsx');
const firstOrder = read('base44/functions/createPaymentIntent/firstOrderEligibility.js');
const cardImages = read('src/lib/product-card-images.js');
let assertions = 0;
const check = (name, callback) => { callback(); assertions += 1; };

check('only paid delivery page uses new layout', () => {
  assert.match(landing, /const isDeliveryShopping = page\.path === '\/cold-pressed-juice-delivery'/);
  assert.match(landing, /isDeliveryShopping \? <LocalDeliveryShopping page=\{page\} \/> : <section/);
  assert.match(landing, /!isDeliveryShopping && <section/);
});
check('SEO architecture stays shared', () => {
  for (const marker of ['title={page.title}', 'description={page.metaDescription}', 'canonicalPath={page.path}', 'structuredData={buildStructuredData(page)}']) assert.ok(landing.includes(marker), marker);
  assert.ok(shopping.includes('{page.h1}'));
  assert.ok(!shopping.includes('application/ld+json'));
});

const featured = deliveryLandingProducts();
check('four exact identities, Trio first', () => assert.deepEqual(featured.map(p => p.slug), ['the-nuvira-trio', 'oasis', 'aura', 're-nu']));
check('catalog Trio is 36 and contains three bottles', () => {
  assert.equal(deliveryLandingPrice(featured[0]), '$36.00');
  assert.equal(featured[0].bottle_count, 3);
  assert.equal(orderMinimumStatus([{ ...featured[0], quantity: 1, bottles_per_unit: featured[0].bottle_count }]).meetsMinimum, true);
});
check('current live price supersedes fallback, no literal price in JSX', () => {
  assert.equal(deliveryLandingPrice(deliveryLandingProducts([{ ...featured[0], price: 37.25 }])[0]), '$37.25');
  assert.ok(!shopping.includes('$36'));
});
check('invalid prices are not manufactured', () => {
  for (const price of [0, -1, null, undefined, '', 'bad', Infinity]) assert.equal(deliveryLandingPrice({ price }), null);
});
check('live missing/empty/unavailable catalog does not advertise fallback stock', () => {
  assert.deepEqual(deliveryLandingProducts([]), []);
  assert.deepEqual(deliveryLandingProducts(null), []);
  assert.deepEqual(deliveryLandingProducts([{ ...featured[0], is_available: false }]), []);
  assert.deepEqual(deliveryLandingProducts([featured[2]]).map(p => p.slug), ['aura']);
});
check('identity match cannot substitute another product', () => {
  assert.deepEqual(deliveryLandingProducts([{ id: 'other', slug: 'wrong', title: 'AURA Lookalike' }]), []);
  assert.equal(deliveryLandingProducts([{ id: featured[1].id, title: 'OASIS', price: 14 }])[0].slug, 'oasis');
  const drifted = deliveryLandingProducts([{ id: featured[1].id, slug: 'aura', title: 'AURA', price: 14 }]);
  assert.deepEqual(drifted.map(product => product.slug), ['oasis']);
  assert.equal(drifted[0].title, 'OASIS');
});
check('canonical product links and exact local photos exist', () => {
  for (const product of featured) {
    assert.equal(productPath(product), `/product/${product.slug}.html`);
    assert.ok(cardImages.includes(`/images/products/cards/${product.slug}.webp`));
    assert.ok(fs.existsSync(path.join(root, `public/images/products/cards/${product.slug}.webp`)));
  }
});
check('read-only shared catalog and checkout navigation, no new purchase path', () => {
  assert.ok(shopping.includes("queryKey: ['products']"));
  assert.ok(shopping.includes("base44.entities.Product.filter({ is_available: true }, 'sort_order', 100)"));
  assert.ok(shopping.includes('placeholderData: PUBLIC_PRODUCT_FALLBACKS'));
  assert.ok(!/\.create\(|\.update\(|\.delete\(|createPaymentIntent|addItem\(|useCart/.test(shopping));
});
check('shared consent-gated selection measurement used', () => {
  assert.match(shopping, /trackGoogleSelectItem\(product, 'local_delivery_featured'/);
  assert.ok(!/gtag\(|fbq\(|snaptr\(|purchase['"]/.test(shopping));
});
check('delivery reuses existing preliminary check and policy, never ZIP guarantee', () => {
  assert.ok(shopping.includes('<DeliveryAvailabilityCard />'));
  for (const name of ['DELIVERY_POLICY_CONTENT.addressCheck', 'DELIVERY_POLICY_CONTENT.routeReview', 'DELIVERY_POLICY_CONTENT.waitlist', 'DELIVERY_ZONE_SUMMARY.map', 'DELIVERY_WINDOWS.map']) assert.ok(shopping.includes(name), name);
  assert.match(eligibility, /zip_only_check: true/);
  assert.match(eligibility, /Your full delivery address will be confirmed at checkout/);
  assert.match(DELIVERY_POLICY_CONTENT.addressCheck, /ZIP-code check is preliminary/);
});
check('normal eligible service areas remain qualified ZIP previews', () => {
  for (const zone_type of ['core', 'extended', 'route_review']) {
    const preview = classifyPreliminaryDeliveryAvailability({ checkout_allowed: true, zone_type, reason_code: 'ELIGIBLE', minimum_order: null });
    assert.equal(preview.status, 'eligible');
    assert.equal(preview.routeReview, zone_type === 'route_review');
    assert.equal(preview.minimumOrder, null);
    assert.equal(preview.checkout_allowed, undefined);
  }
});
check('15–35 mile subtotal failures show area eligibility with exact minimum/review', () => {
  for (const [zone_type, minimum_order, miles] of [['extended', 49.99, 15.01], ['extended', 49.99, 25], ['route_review', 59.99, 25.01], ['route_review', 59.99, 30], ['route_review', 72, 30.01], ['route_review', 72, 35]]) {
    const input = { checkout_allowed: false, zone_type, minimum_order, estimated_distance_miles: miles, reason_code: 'MINIMUM_ORDER_NOT_MET' };
    const preview = classifyPreliminaryDeliveryAvailability(input);
    assert.equal(preview.status, 'eligible');
    assert.equal(preview.minimumOrder, minimum_order);
    assert.equal(preview.routeReview, zone_type === 'route_review');
    assert.equal(input.checkout_allowed, false, 'server checkout authority must not be mutated');
    assert.equal(preview.checkout_allowed, undefined);
  }
});
check('route-review restrictions are visible, not treated as automatic delivery', () => {
  assert.equal(classifyPreliminaryDeliveryAvailability({ zone_type: 'route_review', checkout_allowed: false, reason_code: 'ROUTE_REVIEW_REQUIRED', minimum_order: 72 }).routeReview, true);
  assert.match(eligibility, /requires sign-in and route review/);
  assert.match(eligibility, /Delivery is not confirmed until the route is approved/);
  assert.match(eligibility, /areaDetails\.minimumOrder\.toFixed\(2\)/);
});
check('only confirmed out-of-area responses become waitlist results', () => {
  assert.equal(classifyPreliminaryDeliveryAvailability({ zone_type: 'waitlist_only', checkout_allowed: false, reason_code: 'WAITLIST_ONLY' }).status, 'ineligible');
  assert.equal(classifyPreliminaryDeliveryAvailability({ zone_type: 'core', checkout_allowed: false, reason_code: 'ZONE_BLOCKED' }).status, 'error');
  assert.equal(classifyPreliminaryDeliveryAvailability({ zone_type: 'waitlist_only', checkout_allowed: true, reason_code: 'WAITLIST_ONLY' }).status, 'error');
});
check('lookup, unknown, invalid and internal failures remain retryable', () => {
  for (const input of [null, {}, { checkout_allowed: false }, ...['ADDRESS_LOOKUP_FAILED', 'INVALID_ADDRESS', 'INTERNAL_ERROR', 'UNKNOWN'].map(reason_code => ({ zone_type: null, checkout_allowed: false, reason_code })), { zone_type: 'core', checkout_allowed: true, reason_code: 'ADDRESS_LOOKUP_FAILED' }, { zone_type: 'core', checkout_allowed: true, error: 'temporary failure' }]) {
    assert.equal(classifyPreliminaryDeliveryAvailability(input).status, 'error');
  }
  assert.ok(eligibility.indexOf("preview.status === 'error'") < eligibility.indexOf('setDeliveryAvailability({'));
  assert.match(eligibility, /We could not confirm this ZIP right now\. Please try again/);
});
check('legacy cached rejections are not restored and current caveats persist', () => {
  assert.equal(restorePreliminaryDeliveryAvailability({ delivery_eligibility_status: 'ineligible' }), null);
  const saved = { preliminary_check_version: PRELIMINARY_DELIVERY_CHECK_VERSION, delivery_eligibility_status: 'eligible', preliminary_minimum_order: 72, preliminary_route_review: true };
  assert.deepEqual(restorePreliminaryDeliveryAvailability(saved), { status: 'eligible', minimumOrder: 72, routeReview: true });
  assert.equal(restorePreliminaryDeliveryAvailability({ ...saved, delivery_eligibility_status: 'error' }), null);
});
check('preliminary result cannot bypass the unchanged full-address payment gate', () => {
  assert.match(eligibility, /cart_subtotal: 0/);
  assert.doesNotMatch(eligibility, /createPaymentIntent|paymentIntents|\.update\(|\.create\(/);
  const checkout = read('src/pages/Checkout.jsx');
  assert.match(checkout, /zoneEligibility\.zone_type === 'route_review' && \(routeAcknowledged !== true \|\| !user\?\.id\)/);
  assert.doesNotMatch(checkout, /classifyPreliminaryDeliveryAvailability|PRELIMINARY_DELIVERY_CHECK_VERSION/);
});
check('Trio count minimum never presented as universal area eligibility', () => {
  assert.ok(shopping.includes('Meets the 3-juice count minimum. Delivery-area dollar minimums, delivery fees and applicable taxes still apply.'));
  assert.ok(shopping.includes('at least 3 juices, 6 shots, or an equivalent mix'));
  assert.match(shopping, /not a straight-line radius/);
});
check('WELCOME10 offer retains explicit first order/nonstacking/minimum terms', () => {
  for (const text of ['Your first order, 10% off.', 'WELCOME10', 'First orders only, once per customer.', 'WELCOME10 cannot be combined with other discounts or reward redemptions.', 'Eligibility is verified at checkout.']) assert.ok(shopping.includes(text), text);
  assert.match(firstOrder, /once_per_customer === true/);
  assert.match(firstOrder, /FIRST_ORDER_OFFER_NOT_COMBINABLE/);
  assert.ok(!/September|ends tonight|limited.time|free delivery/i.test(shopping));
  assert.ok(shopping.indexOf('First order? Take 10% off with') < shopping.indexOf('Featured NuVira Trio bundle'));
  assert.ok(shopping.includes('href="#first-order-offer-details"'));
  assert.ok(!shopping.includes('No account required'));
  assert.ok(shopping.includes('Guest checkout is available for standard delivery. Extended routes require review.'));
});
check('mobile layout preserves bottles and concise navigation', () => {
  assert.ok(shopping.includes('object-contain'));
  assert.ok(!shopping.includes('object-cover'));
  assert.ok(shopping.includes('scroll-mt-24'));
  assert.ok(shopping.includes('sm:grid-cols-3'));
  assert.ok(shopping.includes('[&_.flex-1]:min-w-0'));
  assert.ok(!shopping.includes('min-h-[calc(100svh'));
});

// Exercise actual JSX rendering in memory. Only external integration boundaries
// are stubbed; no live API, browser, provider event, cart or payment is invoked.
const bundle = await build({
  entryPoints: [path.join(root, 'src/components/landing/LocalDeliveryShopping.jsx')],
  bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-router-dom', '@tanstack/react-query'],
  mainFields: ['module', 'main'],
  logLevel: 'silent',
  plugins: [{ name: 'isolated-landing-boundaries', setup(builder) {
    builder.onResolve({ filter: /^@\/api\/base44Client$/ }, () => ({ path: 'catalog', namespace: 'mock' }));
    builder.onResolve({ filter: /^@\/components\/delivery\/DeliveryAvailabilityCard$/ }, () => ({ path: 'delivery', namespace: 'mock' }));
    builder.onResolve({ filter: /^@\/lib\/googleAnalytics$/ }, () => ({ path: 'measurement', namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'catalog'
      ? 'export const base44 = { entities: { Product: { filter: () => { throw new Error("unexpected network request"); } } } };'
      : args.path === 'measurement' ? 'export const trackGoogleSelectItem = () => {};' : 'export default function DeliveryAvailabilityCard() { return null; }', loader: 'js' }));
    builder.onResolve({ filter: /^@\// }, args => {
      const base = path.join(root, 'src', args.path.slice(2));
      return { path: [base, `${base}.js`, `${base}.jsx`].find(candidate => fs.existsSync(candidate)) };
    });
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const Shopping = module.exports.default;
function render(products) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['products'], products);
  return renderToStaticMarkup(React.createElement(QueryClientProvider, { client },
    React.createElement(StaticRouter, { location: '/cold-pressed-juice-delivery' }, React.createElement(Shopping, { page: { h1: 'Cold-Pressed Juice Delivery in Wentzville & St. Louis' } }))));
}
const html = render(PUBLIC_PRODUCT_FALLBACKS);
check('actual JSX renders one H1 and all canonical product paths', () => {
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  for (const product of featured) assert.ok(html.includes(`href="${productPath(product)}"`));
  assert.ok(html.includes('$36.00'));
  assert.ok(html.indexOf('Featured NuVira Trio bundle') < html.indexOf('choose-juice-heading'));
});
check('all six delivery tiers render from shared source with route-review caveat', () => {
  for (const zone of DELIVERY_ZONE_SUMMARY) {
    assert.ok(html.includes(zone.distance));
    assert.ok(html.includes(zone.fee));
    assert.ok(html.includes(zone.minimum));
  }
  assert.ok(html.includes('Route review required'));
  assert.ok(html.includes('temporary authorization hold'));
});
check('live price change reaches rendered CTA card', () => {
  const updated = render(PUBLIC_PRODUCT_FALLBACKS.map(p => p.slug === 'the-nuvira-trio' ? { ...p, price: 37.25 } : p));
  assert.ok(updated.includes('$37.25'));
  assert.ok(!updated.includes('$36.00'));
});
check('live empty and unavailable catalogs render safe shop fallback', () => {
  for (const products of [[], PUBLIC_PRODUCT_FALLBACKS.map(p => ({ ...p, is_available: false }))]) {
    const empty = render(products);
    assert.ok(empty.includes('Explore the currently available juices'));
    assert.ok(!empty.includes('Featured NuVira Trio bundle'));
    assert.ok(!empty.includes('$36.00'));
  }
});

console.log(JSON.stringify({ suite: 'G189 local delivery shopping', ok: true, assertions, rendered_cases: 4, provider_calls: 0, writes_performed: false }, null, 2));
