#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const SITE_URL = 'https://nuvirajuice.com';
const functionPaths = [
  'base44/functions/googleMerchantFeed/entry.ts',
  'base44/functions/syncProductsToGMC/entry.ts',
];
const criticalSource = fs.readFileSync('scripts/ci/run-critical-regressions.mjs', 'utf8');

const authenticPhotos = {
  aura: [
    'aura/aura-drinking.jpg',
    'aura/aura-conversation.jpg',
    'aura/aura-bench.jpg',
  ],
  oasis: [
    'oasis/oasis-event-cooler.jpg',
    'oasis/oasis-sunset-bottle.jpg',
    'oasis/oasis-sunset-trio.jpg',
  ],
  're-nu': [
    're-nu/re-nu-shared-drink.jpg',
    're-nu/re-nu-conversation.jpg',
    're-nu/re-nu-bench.jpg',
  ],
  'the nuvira trio': [
    'trio/trio-outdoor-bag.jpg',
    'trio/trio-outdoor-lineup.jpg',
    'trio/trio-sunset-lineup.jpg',
  ],
};

const primaryOnlyProducts = [
  'pineapple juice',
  'orange juice',
  'watermelon juice',
  'reset shot',
  'hydration shot',
  'radiance shot',
];

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

function evaluateImageSets(literal) {
  const context = { SITE_URL };
  vm.runInNewContext(`this.value = (${literal});`, context);
  return JSON.parse(JSON.stringify(context.value));
}

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
    const isStartOfFrame = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
    if (isStartOfFrame) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }
    assert.ok(length >= 2, 'JPEG segment length must be valid');
    offset += length;
  }
  throw new Error('JPEG dimensions were not found');
}

const sources = functionPaths.map(file => fs.readFileSync(file, 'utf8'));
const literals = sources.map(source => extractObjectLiteral(source, 'MERCHANT_IMAGE_SETS'));
assert.equal(literals[0], literals[1], 'XML feed and Merchant API image mappings must remain identical');

const imageSets = evaluateImageSets(literals[0]);
const authenticUrls = [];

for (const [product, photos] of Object.entries(authenticPhotos)) {
  const imageSet = imageSets[product];
  assert.ok(imageSet, `${product} must have a curated image set`);
  assert.ok(imageSet.primary, `${product} must retain a primary image`);
  assert.doesNotMatch(imageSet.primary, /\/images\/authentic-products\//, `${product} primary must remain its clean catalog photo`);
  assert.ok(imageSet.additional.length <= 10, `${product} exceeds Google's additional-image limit`);

  const expectedUrls = photos.map(photo => `${SITE_URL}/images/authentic-products/${photo}`);
  assert.deepEqual(imageSet.additional, expectedUrls, `${product} must use only its approved authentic photos`);
  for (const url of expectedUrls) {
    authenticUrls.push(url);

    const filePath = path.join('public', new URL(url).pathname);
    assert.ok(fs.existsSync(filePath), `${filePath} must exist`);
    const buffer = fs.readFileSync(filePath);
    assert.ok(buffer.length > 0 && buffer.length <= 16 * 1024 * 1024, `${filePath} must be within Google's file-size limit`);
    const { width, height } = readJpegDimensions(buffer);
    assert.ok(width >= 500 && height >= 500, `${filePath} must meet the current Merchant image dimensions`);
    assert.equal(
      buffer.includes(Buffer.from('http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia')),
      false,
      `${filePath} must not carry generated-image metadata`,
    );
  }
}

for (const product of primaryOnlyProducts) {
  const imageSet = imageSets[product];
  assert.ok(imageSet?.primary, `${product} must retain its real primary image`);
  assert.deepEqual(imageSet.additional, [], `${product} must not receive an unverified supplemental image`);
}

assert.equal(authenticUrls.length, 12, 'four supported products need three authentic photos each');
assert.equal(new Set(authenticUrls).size, 12, 'all authentic image URLs must be unique');
assert.equal(imageSets['large nuvira tote bag'].additional.length, 1, 'tote media must remain outside the juice-image change');
assert.doesNotMatch(literals[0], /\/images\/google-merchant\//, 'active Merchant mappings must not use the rejected generated set');
assert.match(sources[0], /GOOGLE_MERCHANT_FEED_DEPLOYMENT_REVISION = '2026-09-02\.g170-authentic-photography'/);
assert.match(criticalSource, /run-g168-google-merchant-additional-image-tests\.mjs/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g168-google-merchant-additional-images',
  authentically_enriched_products: Object.keys(authenticPhotos).length,
  primary_only_products: primaryOnlyProducts.length,
  authentic_additional_images: authenticUrls.length,
  merchant_api_and_xml_parity: true,
  real_primary_images_preserved: true,
  generated_images_active: false,
  provider_calls_performed: false,
  production_writes_performed: false,
}, null, 2));
