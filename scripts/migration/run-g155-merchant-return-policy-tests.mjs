#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { renderReturnPolicyCrawlerHtml } from '../seo/product-crawler-pages.mjs';
import {
  MERCHANT_RETURN_POLICY,
  MERCHANT_RETURN_POLICY_CONTENT,
  MERCHANT_RETURN_POLICY_ID,
  MERCHANT_RETURN_POLICY_SCHEMA,
  MERCHANT_RETURN_POLICY_URL,
} from '../../src/lib/merchant-policy.js';
import { PUBLIC_PRODUCT_FALLBACKS } from '../../src/lib/public-product-catalog.js';
import { buildProductStructuredData } from '../../src/lib/product-seo.js';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function returnPolicySchema(html) {
  const match = html.match(/<script type="application\/ld\+json" data-nuvira-return-policy-schema>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'crawler HTML must contain the return-policy JSON-LD block');
  return JSON.parse(match[1]);
}

test('one stable public return-policy identity is shared by organization and product offers', () => {
  assert.equal(MERCHANT_RETURN_POLICY_URL, 'https://nuvirajuice.com/returns.html');
  assert.equal(MERCHANT_RETURN_POLICY_ID, 'https://nuvirajuice.com/returns.html#policy');
  assert.equal(MERCHANT_RETURN_POLICY['@id'], MERCHANT_RETURN_POLICY_ID);
  assert.equal(MERCHANT_RETURN_POLICY.returnPolicyCategory, 'https://schema.org/MerchantReturnNotPermitted');
  assert.equal(MERCHANT_RETURN_POLICY.merchantReturnLink, MERCHANT_RETURN_POLICY_URL);
  assert.deepEqual(MERCHANT_RETURN_POLICY_SCHEMA.hasMerchantReturnPolicy, MERCHANT_RETURN_POLICY);

  for (const product of PUBLIC_PRODUCT_FALLBACKS) {
    const schema = buildProductStructuredData(product);
    assert.deepEqual(schema.offers?.hasMerchantReturnPolicy, { '@id': MERCHANT_RETURN_POLICY_ID });
  }
});

test('dedicated policy route is public, lazy-loaded, discoverable, and linked from customer trust surfaces', () => {
  const app = read('src/App.jsx');
  assert.match(app, /const Returns = React\.lazy\(\(\) => import\('@\/pages\/Returns'\)\)/);
  assert.match(app, /<Route path="\/returns" element={<Returns \/>} \/>/);
  assert.match(app, /<Route path="\/returns\.html" element={<Returns \/>} \/>/);
  assert.match(read('public/sitemap.xml'), /<loc>https:\/\/nuvirajuice\.com\/returns\.html<\/loc>/);
  assert.match(read('src/pages/Home.jsx'), /to="\/returns\.html"[^>]*>Returns<\/Link>/);
  assert.match(read('src/components/layout/SideNav.jsx'), /to="\/returns\.html"[^>]*>Returns<\/Link>/);
  assert.match(read('src/pages/ProductDetail.jsx'), /to="\/returns\.html"[\s\S]*?Refund & return policy/);
  assert.match(read('src/pages/Legal.jsx'), /to="\/returns\.html"[\s\S]*?dedicated refund & return policy/);
});

test('policy page preserves NuVira refund, food-safety, cancellation, and support terms', () => {
  const returnsPage = read('src/pages/Returns.jsx');
  const merchantPolicy = read('src/lib/merchant-policy.js');
  const legal = read('src/pages/Legal.jsx');

  assert.match(returnsPage, /MERCHANT_RETURN_POLICY_CONTENT\.qualityIssues/);
  assert.match(returnsPage, /MERCHANT_RETURN_POLICY_CONTENT\.refundTiming/);
  assert.match(returnsPage, /MERCHANT_RETURN_POLICY_CONTENT\.noPhysicalReturns/);
  assert.match(returnsPage, /MERCHANT_RETURN_POLICY_CONTENT\.cancellations/);
  assert.match(merchantPolicy, /within 24 hours of delivery/);
  assert.match(merchantPolicy, /original payment method within 5-10 business days/);
  assert.match(merchantPolicy, /cannot accept physical returns of consumable food or juice products once delivered/);
  assert.match(merchantPolicy, /cancelled before production begins/);
  assert.match(returnsPage, /mailto:support@nuvirajuice\.com/);
  assert.match(legal, /within 24 hours of delivery/);
  assert.match(legal, /original payment method within 5–10 business days/);
  assert.match(legal, /cannot accept returns on consumable products once delivered/);
});

test('crawler HTML exposes the complete policy without requiring JavaScript', () => {
  const html = renderReturnPolicyCrawlerHtml(read('index.html'));
  const schema = returnPolicySchema(html);

  assert.equal((html.match(/<link rel="canonical"/g) || []).length, 1);
  assert.match(html, /<link rel="canonical" href="https:\/\/nuvirajuice\.com\/returns\.html" \/>/);
  assert.match(html, /<title>Refund &amp; Return Policy \| NuVira Juice Co\.<\/title>/);
  assert.match(html, /<noscript>[\s\S]*?<h1>Refund &amp; Return Policy<\/h1>/);
  for (const text of Object.values(MERCHANT_RETURN_POLICY_CONTENT)) {
    assert.ok(html.includes(text.replace(/&/g, '&amp;').replace(/'/g, '&#39;')), `crawler snapshot missing: ${text}`);
  }
  assert.deepEqual(schema, MERCHANT_RETURN_POLICY_SCHEMA);
});

test('build plugin emits an explicit Base44-host-compatible policy document', () => {
  const source = read('scripts/seo/product-crawler-pages.mjs');
  assert.match(source, /fileName: 'returns\.html'/);
  assert.match(source, /fileName: 'returns\/index\.html'/);
  assert.match(source, /renderReturnPolicyCrawlerHtml\(canonicalIndexHtml\)/);
  assert.match(read('vite.config.js'), /productCrawlerSeoPages\(\)/);
});

test('static and runtime LocalBusiness schemas expose the same no-physical-return policy', () => {
  const staticIndex = read('index.html');
  const seoSource = read('src/components/SEO.jsx');
  assert.match(staticIndex, /"@id": "https:\/\/nuvirajuice\.com\/returns\.html#policy"/);
  assert.match(staticIndex, /"returnPolicyCategory": "https:\/\/schema\.org\/MerchantReturnNotPermitted"/);
  assert.match(staticIndex, /"merchantReturnLink": "https:\/\/nuvirajuice\.com\/returns\.html"/);
  assert.match(seoSource, /"hasMerchantReturnPolicy": MERCHANT_RETURN_POLICY/);
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

console.log(`${passed}/${tests.length} G155 merchant return-policy tests passed`);
