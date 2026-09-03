#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const productDetailSource = fs.readFileSync('src/pages/ProductDetail.jsx', 'utf8');
const criticalSource = fs.readFileSync('scripts/ci/run-critical-regressions.mjs', 'utf8');

assert.match(
  productDetailSource,
  /failedGalleryImages, setFailedGalleryImages.*useState\(\(\) => new Set\(\)\)/,
  'Product detail should keep a per-product set of failed image URLs',
);
assert.match(
  productDetailSource,
  /setFailedGalleryImages\(new Set\(\)\);[\s\S]*?\}, \[product\?\.id\]\);/,
  'Failed image state should reset when the customer opens another product',
);
assert.match(
  productDetailSource,
  /buildProductGallery\(product\)\.filter\([\s\S]*?!failedGalleryImages\.has\(image\.src\)/,
  'Failed images should be removed from the visible gallery',
);
assert.match(
  productDetailSource,
  /onError=\{\(\) => handleGalleryImageError\(selectedProductImage\.src, selectedImageIndex\)\}/,
  'The selected product image should fail over cleanly',
);
assert.match(
  productDetailSource,
  /onError=\{\(\) => handleGalleryImageError\(image\.src, index\)\}/,
  'Each gallery thumbnail should remove its failed image URL',
);
assert.match(
  productDetailSource,
  /if \(current === failedIndex\) return 0;[\s\S]*?current > failedIndex \? current - 1 : current/,
  'Gallery selection should remain valid when an image disappears',
);
assert.match(
  criticalSource,
  /run-g171-broken-product-gallery-tests\.mjs/,
  'The broken-gallery regression must remain in the critical suite',
);

console.log(JSON.stringify({
  ok: true,
  suite: 'g171-broken-product-gallery',
  failed_image_tiles_removed: true,
  selected_image_fallback_enabled: true,
  per_product_failure_state_reset: true,
  provider_calls_performed: false,
  production_writes_performed: false,
}, null, 2));
