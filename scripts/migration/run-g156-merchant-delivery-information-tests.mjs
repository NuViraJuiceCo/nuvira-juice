#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { renderDeliveryPolicyCrawlerHtml } from '../seo/product-crawler-pages.mjs';
import {
  DELIVERY_POLICY_CONTENT,
  DELIVERY_POLICY_SCHEMA,
  DELIVERY_POLICY_URL,
  DELIVERY_WINDOWS,
  DELIVERY_ZONE_SUMMARY,
} from '../../src/lib/delivery-policy.js';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const expectedZones = [
  { min: 0, max: 5, fee: 3.99, minimum: null, review: false },
  { min: 5.01, max: 10, fee: 5.99, minimum: null, review: false },
  { min: 10.01, max: 15, fee: 7.99, minimum: null, review: false },
  { min: 15.01, max: 25, fee: 9.99, minimum: 49.99, review: false },
  { min: 25.01, max: 30, fee: 12.99, minimum: 59.99, review: true },
  { min: 30.01, max: 35, fee: 15.99, minimum: 72, review: true },
];

function deliveryPolicySchema(html) {
  const match = html.match(/<script type="application\/ld\+json" data-nuvira-delivery-policy-schema>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'crawler HTML must contain the delivery-policy JSON-LD block');
  return JSON.parse(match[1]);
}

test('public delivery tiers match checkout and eligibility authorities', () => {
  const checkout = read('base44/functions/createPaymentIntent/entry.ts');
  const eligibility = read('base44/functions/validateDeliveryEligibility/entry.ts');
  assert.equal(DELIVERY_ZONE_SUMMARY.length, expectedZones.length);

  expectedZones.forEach((zone, index) => {
    const publicZone = DELIVERY_ZONE_SUMMARY[index];
    assert.equal(publicZone.fee, `$${zone.fee.toFixed(2)}`);
    assert.equal(publicZone.review, zone.review);
    assert.equal(publicZone.minimum, zone.minimum == null ? 'No additional minimum' : `$${zone.minimum.toFixed(2)} order minimum`);
    for (const source of [checkout, eligibility]) {
      assert.ok(source.includes(`min: ${zone.min}`), `missing ${zone.min}-mile lower bound`);
      assert.ok(source.includes(`max: ${zone.max}`), `missing ${zone.max}-mile upper bound`);
      assert.ok(source.includes(`delivery_fee: ${zone.fee}`), `missing $${zone.fee} fee`);
      if (zone.minimum != null) {
        assert.ok(source.includes(`minimum_order: ${zone.minimum}`) || (zone.minimum === 72 && source.includes('minimum_order: 72.0')), `missing $${zone.minimum} minimum`);
      }
    }
  });

  assert.match(checkout, /min: 35\.01[\s\S]{0,220}checkout_allowed: false/);
  assert.match(eligibility, /min: 35\.01[\s\S]{0,360}checkout_allowed: false/);
});

test('public delivery windows match the canonical Central Time schedule', () => {
  const checkout = read('base44/functions/createPaymentIntent/entry.ts');
  const schedule = read('base44/functions/calculateNuViraFulfillmentSchedule/entry.ts');
  assert.deepEqual(DELIVERY_WINDOWS, [
    { productionDay: 'Tuesday', deliveryDay: 'Wednesday', deliveryWindow: '5 PM - 8 PM', cutoff: 'Tuesday at 2 PM Central' },
    { productionDay: 'Friday', deliveryDay: 'Saturday', deliveryWindow: '12 PM - 3 PM', cutoff: 'Friday at 2 PM Central' },
  ]);
  for (const label of ['Wednesday 5 PM - 8 PM', 'Saturday 12 PM - 3 PM']) {
    assert.ok(checkout.includes(label));
    assert.ok(schedule.includes(label));
  }
  assert.match(schedule, /cutoffInSeconds = 14 \* 3600/);
  assert.match(schedule, /TIMEZONE = 'America\/Chicago'/);
});

test('delivery page is public, discoverable, and linked at the decision points', () => {
  const app = read('src/App.jsx');
  assert.match(app, /const Delivery = React\.lazy\(\(\) => import\('@\/pages\/Delivery'\)\)/);
  assert.match(app, /<Route path="\/delivery" element={<Delivery \/>} \/>/);
  assert.match(app, /<Route path="\/delivery\.html" element={<Delivery \/>} \/>/);
  assert.match(read('public/sitemap.xml'), /<loc>https:\/\/nuvirajuice\.com\/delivery\.html<\/loc>/);
  assert.match(read('src/pages/Home.jsx'), /to="\/delivery\.html"[^>]*>Delivery<\/Link>/);
  assert.match(read('src/components/layout/SideNav.jsx'), /to="\/delivery\.html"[^>]*>Delivery<\/Link>/);
  assert.match(read('src/components/delivery/DeliveryAvailabilityCard.jsx'), /to="\/delivery\.html"[\s\S]*?delivery windows, fees, and route details/);
  assert.match(read('src/pages/ProductDetail.jsx'), /to="\/delivery\.html"[\s\S]*?Delivery details/);
});

test('policy copy discloses address validation, route-review authorization, and waitlist limits', () => {
  assert.match(DELIVERY_POLICY_CONTENT.addressCheck, /full delivery address/);
  assert.match(DELIVERY_POLICY_CONTENT.addressCheck, /ZIP-code check is preliminary/);
  assert.match(DELIVERY_POLICY_CONTENT.routeReview, /temporary authorization hold/);
  assert.match(DELIVERY_POLICY_CONTENT.routeReview, /not captured unless NuVira approves/);
  assert.match(DELIVERY_POLICY_CONTENT.waitlist, /beyond 35 driving miles/);
  assert.match(DELIVERY_POLICY_CONTENT.exceptions, /date and window confirmed with the order are authoritative/);
});

test('crawler HTML exposes the complete delivery contract without JavaScript', () => {
  const html = renderDeliveryPolicyCrawlerHtml(read('index.html'));
  const schema = deliveryPolicySchema(html);
  assert.equal(DELIVERY_POLICY_URL, 'https://nuvirajuice.com/delivery.html');
  assert.equal((html.match(/<link rel="canonical"/g) || []).length, 1);
  assert.match(html, /<title>Local Delivery Information \| NuVira Juice Co\.<\/title>/);
  assert.match(html, /<noscript>[\s\S]*?<h1>Local Delivery Information<\/h1>/);
  assert.equal((html.match(/<tr><td>/g) || []).length, 6);
  for (const window of DELIVERY_WINDOWS) assert.ok(html.includes(window.deliveryWindow));
  for (const zone of DELIVERY_ZONE_SUMMARY) assert.ok(html.includes(zone.fee));
  for (const copy of Object.values(DELIVERY_POLICY_CONTENT)) {
    assert.ok(html.includes(copy.replace(/&/g, '&amp;').replace(/'/g, '&#39;')));
  }
  assert.deepEqual(schema, DELIVERY_POLICY_SCHEMA);
});

test('build emits explicit Base44-host-compatible delivery HTML without inventing fixed Offer shipping schema', () => {
  const buildPlugin = read('scripts/seo/product-crawler-pages.mjs');
  const productSeo = read('src/lib/product-seo.js');
  assert.match(buildPlugin, /fileName: 'delivery\.html'/);
  assert.match(buildPlugin, /fileName: 'delivery\/index\.html'/);
  assert.match(buildPlugin, /renderDeliveryPolicyCrawlerHtml\(canonicalIndexHtml\)/);
  assert.doesNotMatch(productSeo, /OfferShippingDetails|shippingRate|shippingDestination|deliveryTime/);
  assert.equal(DELIVERY_POLICY_SCHEMA['@type'], 'WebPage');
  assert.equal(DELIVERY_POLICY_SCHEMA.about?.['@type'], 'Service');
});

let passed = 0;
for (const current of tests) {
  try {
    current.fn();
    passed += 1;
    console.log(`PASS ${current.name}`);
  } catch (error) {
    console.error(`FAIL ${current.name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

console.log(`${passed}/${tests.length} G156 merchant delivery-information tests passed`);
