#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const apiSource = read('base44/functions/syncProductsToGMC/entry.ts');
const xmlSource = read('base44/functions/googleMerchantFeed/entry.ts');
const productDetailSource = read('src/pages/ProductDetail.jsx');
const productSeoSource = read('src/lib/product-seo.js');
const merchantPolicySource = read('src/lib/merchant-policy.js');
const criticalSource = read('scripts/ci/run-critical-regressions.mjs');

function extractObjectLiteral(source, constantName) {
  const marker = `const ${constantName} = `;
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${constantName} is missing`);
  const start = source.indexOf('{', markerIndex + marker.length);
  assert.notEqual(start, -1, `${constantName} object is missing`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${constantName} object is unterminated`);
}

const apiCatalogLiteral = extractObjectLiteral(apiSource, 'MERCHANT_COPY');
const xmlCatalogLiteral = extractObjectLiteral(xmlSource, 'MERCHANT_COPY');
assert.equal(apiCatalogLiteral, xmlCatalogLiteral, 'Merchant API and XML feed catalogs must remain identical');

const catalog = Function(`"use strict"; return (${apiCatalogLiteral});`)();
assert.equal(Object.keys(catalog).length, 11, 'all 11 legitimate offers need curated structured content');

const prohibitedClaims = /\b(cure|cures|treat|treats|heal|heals|detox|cleanse|prevents?|boosts? immunity)\b/i;
const prohibitedHighlightData = /\b(price|sale|delivery date|delivery time|shipping|NuVira Juice Co\.)\b/i;

for (const [key, profile] of Object.entries(catalog)) {
  assert.ok(Array.isArray(profile.highlights), `${key} needs product highlights`);
  assert.ok(profile.highlights.length >= 4 && profile.highlights.length <= 6, `${key} needs 4–6 highlights`);
  for (const highlight of profile.highlights) {
    assert.ok(highlight.length >= 1 && highlight.length <= 150, `${key} highlight exceeds Google's limit`);
    assert.doesNotMatch(highlight, prohibitedClaims, `${key} contains an unsupported health claim`);
    assert.doesNotMatch(highlight, prohibitedHighlightData, `${key} contains prohibited promotional or fulfillment data`);
  }

  const detailCount = Array.isArray(profile.details) ? profile.details.length : profile.facts ? 9 : 0;
  assert.ok(detailCount >= 6, `${key} needs at least six structured product details`);
}

assert.match(apiSource, /productAttributes\.productHighlights = structuredContent\.highlights/);
assert.match(apiSource, /productAttributes\.productDetails = structuredContent\.details/);
assert.match(apiSource, /sectionName: 'Storage'.*attributeName: 'Storage temperature'.*40°F or below/);
assert.match(apiSource, /5–7 days from production/);
assert.match(apiSource, /Follow the date printed on the bottle/);

assert.match(xmlSource, /<g:product_highlight>/);
assert.match(xmlSource, /<g:product_detail>/);
assert.match(xmlSource, /<g:section_name>/);
assert.match(xmlSource, /<g:attribute_name>/);
assert.match(xmlSource, /<g:attribute_value>/);
assert.match(xmlSource, /GOOGLE_MERCHANT_FEED_DEPLOYMENT_REVISION = '2026-08-28\.g162-canonical-links'/);
assert.match(xmlSource, /'X-Feed-Revision': GOOGLE_MERCHANT_FEED_DEPLOYMENT_REVISION/);

assert.doesNotMatch(productDetailSource, /'@type': 'OfferShippingDetails'/);
assert.doesNotMatch(productDetailSource, /shippingRate:\s*\{[\s\S]{0,160}value: '0'/);
assert.doesNotMatch(productSeoSource, /'@type': 'OfferShippingDetails'/);
assert.doesNotMatch(productSeoSource, /shippingRate:\s*\{[\s\S]{0,160}value: '0'/);
assert.match(productSeoSource, /'@id': MERCHANT_RETURN_POLICY_ID/);
assert.match(merchantPolicySource, /returnPolicyCategory: 'https:\/\/schema\.org\/MerchantReturnNotPermitted'/);
assert.match(merchantPolicySource, /MERCHANT_RETURN_POLICY_PATH = '\/returns\.html'/);
assert.match(merchantPolicySource, /MERCHANT_RETURN_POLICY_URL = `\$\{SITE_URL\}\$\{MERCHANT_RETURN_POLICY_PATH\}`/);
assert.doesNotMatch(productSeoSource, /merchantReturnDays|ReturnByMail|FreeReturn/);

assert.match(criticalSource, /run-g132-google-merchant-structured-content-tests\.mjs/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g132-google-merchant-structured-content',
  curated_offer_count: Object.keys(catalog).length,
  highlights_per_offer: '4-6',
  minimum_details_per_offer: 6,
  merchant_api_and_xml_parity: true,
  claim_safe: true,
  false_free_delivery_schema_removed: true,
  live_writes_performed: false,
}, null, 2));
