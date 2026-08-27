#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const browserMeta = read('src/lib/metaPixel.js');
const serverMeta = read('base44/functions/stripeWebhook/metaConversions.js');
const cartContext = read('src/lib/cartContext.jsx');
const programDetail = read('src/pages/ProgramDetail.jsx');
const critical = read('scripts/ci/run-critical-regressions.mjs');

const verifiedCatalog = Object.freeze({
  '69d490ce699b5f1ac4dde495': '43220774813786',
  '69d490ce699b5f1ac4dde496': '43220774846554',
  '69d490ce699b5f1ac4dde497': '43220774944858',
  '69d490ce699b5f1ac4dde498': '43222070198362',
  '69d5b9df48ee4ce27d9eb8fa': '43255063445594',
  '69d5b9df48ee4ce27d9eb8fb': '43222071181402',
  '69d5b9df48ee4ce27d9eb8fc': '43222071115866',
  '69e95a6b3b4d04fb9b9599d5': '43296833044570',
  '69e95a6b3b4d04fb9b9599d6': '43296833011802',
  '69e95a6b3b4d04fb9b9599d7': '43296833077338',
  '6a511e652e19910e6f789c2c': '43629081722970',
});

for (const [productId, catalogId] of Object.entries(verifiedCatalog)) {
  const mappingPattern = new RegExp(`['"]${productId}['"]\\s*:\\s*['"]${catalogId}['"]`);
  assert.match(browserMeta, mappingPattern, `browser mapping missing for ${productId}`);
  assert.match(serverMeta, mappingPattern, `server mapping missing for ${productId}`);
}

assert.match(browserMeta, /shopify_variant_id/);
assert.match(browserMeta, /ProductVariant\\\//);
assert.match(serverMeta, /shopify_variant_id/);
assert.match(serverMeta, /ProductVariant\\\//);
assert.match(cartContext, /shopify_variant_id: product\.shopify_variant_id \|\| null/);
assert.match(programDetail, /bundle_composition: option\.bundleComposition/);
assert.match(serverMeta, /buildMetaCatalogContents/);
assert.match(serverMeta, /componentQuantity/);
assert.doesNotMatch(browserMeta, /['"]Purchase['"]/);
assert.doesNotMatch(browserMeta, /product_group/);
assert.ok((browserMeta.match(/content_type: 'product'/g) || []).length >= 4);
assert.match(critical, /run-g140-meta-catalog-match-tests\.mjs/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g140-meta-catalog-match',
  verified_catalog_items: Object.keys(verifiedCatalog).length,
  browser_and_server_maps_match: true,
  program_composition_supported: true,
  browser_purchase_enabled: false,
  provider_calls_performed: false,
}, null, 2));
