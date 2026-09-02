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

const generatedScenes = {
  aura: ['aura-kitchen.jpg', 'aura-ingredients.jpg', 'aura-outdoor.jpg'],
  oasis: ['oasis-kitchen.jpg', 'oasis-ingredients.jpg', 'oasis-wellness.jpg'],
  're-nu': ['re-nu-kitchen.jpg', 're-nu-ingredients.jpg', 're-nu-outdoor.jpg'],
  'the nuvira trio': ['nuvira-trio-kitchen.jpg', 'nuvira-trio-ingredients.jpg', 'nuvira-trio-lifestyle.jpg'],
  'pineapple juice': ['pineapple-juice-kitchen.jpg', 'pineapple-juice-ingredients.jpg', 'pineapple-juice-lifestyle.jpg'],
  'orange juice': ['orange-juice-kitchen.jpg', 'orange-juice-ingredients.jpg', 'orange-juice-lifestyle.jpg'],
  'watermelon juice': ['watermelon-juice-kitchen.jpg', 'watermelon-juice-ingredients.jpg', 'watermelon-juice-lifestyle.jpg'],
  'reset shot': ['reset-shot-kitchen.jpg', 'reset-shot-ingredients.jpg', 'reset-shot-lifestyle.jpg'],
  'hydration shot': ['hydration-shot-kitchen.jpg', 'hydration-shot-ingredients.jpg', 'hydration-shot-lifestyle.jpg'],
  'radiance shot': ['radiance-shot-kitchen.jpg', 'radiance-shot-ingredients.jpg', 'radiance-shot-lifestyle.jpg'],
};

const directoryByProduct = {
  aura: 'aura',
  oasis: 'oasis',
  're-nu': 're-nu',
  'the nuvira trio': 'nuvira-trio',
  'pineapple juice': 'pineapple-juice',
  'orange juice': 'orange-juice',
  'watermelon juice': 'watermelon-juice',
  'reset shot': 'reset-shot',
  'hydration shot': 'hydration-shot',
  'radiance shot': 'radiance-shot',
};

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
const generatedUrls = [];

for (const [product, scenes] of Object.entries(generatedScenes)) {
  const imageSet = imageSets[product];
  assert.ok(imageSet, `${product} must have a curated image set`);
  assert.ok(imageSet.primary, `${product} must retain a primary image`);
  assert.doesNotMatch(imageSet.primary, /\/images\/google-merchant\//, `${product} primary must remain real catalog photography`);
  assert.ok(imageSet.additional.length <= 10, `${product} exceeds Google's additional-image limit`);

  const directory = directoryByProduct[product];
  for (const scene of scenes) {
    const url = `${SITE_URL}/images/google-merchant/${directory}/${scene}`;
    assert.ok(imageSet.additional.includes(url), `${product} is missing ${scene}`);
    generatedUrls.push(url);

    const filePath = path.join('public', new URL(url).pathname);
    assert.ok(fs.existsSync(filePath), `${filePath} must exist`);
    const buffer = fs.readFileSync(filePath);
    assert.ok(buffer.length > 0 && buffer.length <= 16 * 1024 * 1024, `${filePath} must be within Google's file-size limit`);
    const { width, height } = readJpegDimensions(buffer);
    assert.ok(width >= 500 && height >= 500, `${filePath} must meet the current Merchant image dimensions`);
    assert.ok(
      buffer.includes(Buffer.from('http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia')),
      `${filePath} must retain AI-origin metadata`,
    );
  }
}

assert.equal(generatedUrls.length, 30, 'ten consumables need three new images each');
assert.equal(new Set(generatedUrls).size, 30, 'all generated image URLs must be unique');
assert.equal(imageSets['large nuvira tote bag'].additional.length, 1, 'tote media must remain outside the juice-image change');
assert.match(sources[0], /GOOGLE_MERCHANT_FEED_DEPLOYMENT_REVISION = '2026-09-02\.g168-additional-images'/);
assert.match(criticalSource, /run-g168-google-merchant-additional-image-tests\.mjs/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g168-google-merchant-additional-images',
  consumable_products: Object.keys(generatedScenes).length,
  generated_additional_images: generatedUrls.length,
  merchant_api_and_xml_parity: true,
  real_primary_images_preserved: true,
  ai_origin_metadata_present: true,
  provider_calls_performed: false,
  production_writes_performed: false,
}, null, 2));
