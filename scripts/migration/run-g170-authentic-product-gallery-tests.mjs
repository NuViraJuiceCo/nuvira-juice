#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

import { PUBLIC_PRODUCT_FALLBACKS } from '../../src/lib/public-product-catalog.js';
import { productAdditionalImageUrls } from '../../src/lib/product-gallery-images.js';

const provenance = JSON.parse(fs.readFileSync('scripts/media/authentic-product-photo-provenance.json', 'utf8'));
const gallerySource = fs.readFileSync('src/lib/product-gallery-images.js', 'utf8');
const merchantSources = [
  fs.readFileSync('base44/functions/googleMerchantFeed/entry.ts', 'utf8'),
  fs.readFileSync('base44/functions/syncProductsToGMC/entry.ts', 'utf8'),
];
const criticalSource = fs.readFileSync('scripts/ci/run-critical-regressions.mjs', 'utf8');

const expectedHashes = Object.freeze({
  'public/images/authentic-products/aura/aura-bench.jpg': 'a635f07853af50507af415c94d028d81999bbcd62f517332da1540c9532b1a3c',
  'public/images/authentic-products/aura/aura-conversation.jpg': '7fe8ba87988521228a917b56a58ba4099fbbc9d77d62bb8abd3b93def5d44f16',
  'public/images/authentic-products/aura/aura-drinking.jpg': 'c99339dbb293b06f31ebf6b37a052592f007d6e97f2458707bb1ca497a41602a',
  'public/images/authentic-products/oasis/oasis-event-cooler.jpg': 'e32b87db2b52e3057f3f6167d7da922846f188568b6e263b78171f87e748907d',
  'public/images/authentic-products/oasis/oasis-sunset-bottle.jpg': '0450ca8496e7450154230f62c787e50d1375069cffbcc0d13fceb4c0829846b1',
  'public/images/authentic-products/oasis/oasis-sunset-trio.jpg': '598bf76dbc5e682f481f31bed2e858298a9284be61b9b5c5c71d102598b8b5e9',
  'public/images/authentic-products/re-nu/re-nu-bench.jpg': 'ae4bf562f119bea5a00800be07cb5449262dbd35441ddb0c60518a46c10f0229',
  'public/images/authentic-products/re-nu/re-nu-conversation.jpg': '6e414c2163654c7f8922a6a6e9406ba8b94e86211adb9e14b7454d0c55baf378',
  'public/images/authentic-products/re-nu/re-nu-shared-drink.jpg': '468ecbc73820b0f2e8f5e0eafa0908e454d28d321775918284a98df50a8ef158',
  'public/images/authentic-products/trio/trio-outdoor-bag.jpg': '5fbd168bedb92588cc6d48fd54d10399dd11081b4add830e03007df7c29c1c13',
  'public/images/authentic-products/trio/trio-outdoor-lineup.jpg': '401c1ad5bbe4cfc49b3a07b4faaecb6186eddc7fa3f1209bd5fbc32f116cf7a1',
  'public/images/authentic-products/trio/trio-sunset-lineup.jpg': 'e5ca0c3d9767e802b1790fb58258c494168c4cdf215794da82e00bb9ead98bd9',
});

function readJpegDimensions(buffer) {
  assert.equal(buffer[0], 0xff, 'JPEG must begin with an FF marker');
  assert.equal(buffer[1], 0xd8, 'JPEG must begin with SOI');
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = buffer.readUInt16BE(offset);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    assert.ok(length >= 2, 'JPEG segment length must be valid');
    offset += length;
  }
  throw new Error('JPEG dimensions were not found');
}

assert.match(provenance.policy, /No AI generation, compositing, relabeling, bottle replacement/);
assert.deepEqual(Object.keys(provenance.assets).sort(), Object.keys(expectedHashes).sort());

for (const [filePath, expectedHash] of Object.entries(expectedHashes)) {
  const record = provenance.assets[filePath];
  assert.ok(record, `${filePath} needs a provenance record`);
  assert.equal(record.transform, 'resize-only', `${filePath} must remain a resize-only export`);
  assert.match(record.source_file, /^DSC\d+\.jpg$/, `${filePath} needs its original capture filename`);
  const buffer = fs.readFileSync(filePath);
  const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
  assert.equal(actualHash, expectedHash, `${filePath} changed outside the approved photo set`);
  const { width, height } = readJpegDimensions(buffer);
  assert.ok(width >= 500 && height >= 500, `${filePath} must meet Merchant image dimensions`);
  assert.ok(buffer.length <= 16 * 1024 * 1024, `${filePath} must remain under Google's image limit`);
  assert.equal(buffer.includes(Buffer.from('trainedAlgorithmicMedia')), false, `${filePath} must not be AI-tagged`);
}

const supported = new Set(['AURA', 'OASIS', 'RE-NU', 'The NuVira Trio']);
const consumables = PUBLIC_PRODUCT_FALLBACKS.filter(product => product.category !== 'merch');
for (const product of consumables) {
  const images = productAdditionalImageUrls(product);
  assert.equal(images.length, supported.has(product.title) ? 3 : 0, `${product.title} has the wrong supplemental-photo policy`);
}

for (const source of [gallerySource, ...merchantSources]) {
  assert.doesNotMatch(source, /\/images\/google-merchant\//, 'rejected generated assets must not be active');
  assert.doesNotMatch(source, /trainedAlgorithmicMedia/, 'active image mappings must not claim AI origin');
}

assert.match(criticalSource, /run-g170-authentic-product-gallery-tests\.mjs/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g170-authentic-product-gallery',
  authentic_assets: Object.keys(expectedHashes).length,
  enriched_products: supported.size,
  resize_only_provenance_locked: true,
  generated_assets_active: false,
  provider_calls_performed: false,
  production_writes_performed: false,
}, null, 2));
