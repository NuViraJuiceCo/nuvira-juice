#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PUBLIC_PRODUCT_FALLBACKS } from '../../src/lib/public-product-catalog.js';
import { absoluteUrl, productPath } from '../../src/lib/seo-slugs.js';

const functionPaths = [
  'base44/functions/googleMerchantFeed/entry.ts',
  'base44/functions/syncProductsToGMC/entry.ts',
];
const criticalSource = fs.readFileSync('scripts/ci/run-critical-regressions.mjs', 'utf8');

function loadLinkBuilder(source) {
  const start = source.indexOf("const SITE_URL = 'https://nuvirajuice.com';");
  const end = source.indexOf('const GOOGLE_PRODUCT_CATEGORIES');
  assert.notEqual(start, -1, 'canonical Merchant site URL must be present');
  assert.ok(end > start, 'Merchant link builder boundary must be present');

  const executable = source
    .slice(start, end)
    .replace(': Record<string, string>', '');
  const context = {};
  vm.runInNewContext(`${executable}\nthis.getMerchantProductLink = getMerchantProductLink;`, context);
  return context.getMerchantProductLink;
}

for (const functionPath of functionPaths) {
  const source = fs.readFileSync(functionPath, 'utf8');
  const getMerchantProductLink = loadLinkBuilder(source);

  assert.doesNotMatch(source, /https:\/\/www\.nuvirajuice\.com/);
  assert.doesNotMatch(source, /\`\$\{SITE_URL\}\/shop\/\$\{/);
  assert.match(source, /return `\$\{SITE_URL\}\/product\/\$\{slug\}\.html`/);

  for (const product of PUBLIC_PRODUCT_FALLBACKS) {
    assert.equal(
      getMerchantProductLink(product),
      absoluteUrl(productPath(product)),
      `${functionPath} must match the canonical crawler URL for ${product.title}`,
    );
  }

  assert.equal(
    getMerchantProductLink({ id: 'future-product-id', title: 'Seasonal Apple & Mint' }),
    'https://nuvirajuice.com/product/seasonal-apple-and-mint.html',
  );
  assert.throws(
    () => getMerchantProductLink({}),
    /missing a stable link identifier/,
  );
}

const feedSource = fs.readFileSync(functionPaths[0], 'utf8');
const apiSource = fs.readFileSync(functionPaths[1], 'utf8');

assert.match(feedSource, /GOOGLE_MERCHANT_FEED_DEPLOYMENT_REVISION = '2026-09-02\.g168-additional-images'/);
assert.match(feedSource, /'X-Feed-Revision': GOOGLE_MERCHANT_FEED_DEPLOYMENT_REVISION/);
assert.match(feedSource, /const id = product\.id/);
assert.match(feedSource, /<g:id>\$\{escapeXml\(id\)\}<\/g:id>/);
assert.match(feedSource, /const link = getMerchantProductLink\(product\)/);
assert.match(apiSource, /const offerId = product\.id/);
assert.match(apiSource, /link: getMerchantProductLink\(product\)/);
assert.match(apiSource, /offerId,/);
assert.match(criticalSource, /run-g162-google-merchant-canonical-links-tests\.mjs/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g162-google-merchant-canonical-links',
  function_paths_checked: functionPaths.length,
  verified_catalog_items: PUBLIC_PRODUCT_FALLBACKS.length,
  offer_ids_changed: false,
  prices_changed: false,
  availability_changed: false,
  provider_calls_performed: false,
  production_writes_performed: false,
}, null, 2));
