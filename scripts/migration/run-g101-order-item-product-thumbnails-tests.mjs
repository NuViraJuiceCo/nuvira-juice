import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const resolver = read('src/lib/order-item-images.js');
const publicProducts = read('src/lib/public-products.js');
const thumbnail = read('src/components/orders/OrderItemThumbnail.jsx');
const tracker = read('src/pages/OrderTracker.jsx');
const history = read('src/pages/OrderHistory.jsx');
const programDetail = read('src/pages/ProgramDetail.jsx');

const tests = [
  ['catalog-aware resolver prefers current offering images and preserves stored fallback', () => {
    assert.match(resolver, /addCandidate\(item\.image_url \|\| item\.image \|\| item\.product_image_url\)/);
    assert.match(resolver, /findPublicProductFallback\(identifier\)/);
    assert.match(resolver, /resolveOrderItemImageCandidates/);
    assert.match(resolver, /!candidates\.includes\(imageUrl\)/);
    assert.ok(
      resolver.indexOf('findPublicProductFallback(identifier)') < resolver.indexOf('addCandidate(item.image_url || item.image || item.product_image_url)'),
      'current catalog image must precede historical stored image'
    );
  }],
  ['resolver covers products, programs, bundle, and tote aliases', () => {
    for (const marker of ['radiance', 'hydration', 'reset', 'nuvira\\s+trio', 'Radiance Shot', 'Hydration Shot', 'Reset Shot', 'RE-NU', 'OASIS', 'AURA', 'Orange Juice', 'Pineapple Juice', 'Watermelon Juice', 'Large NuVira Tote Bag']) {
      assert.match(resolver, new RegExp(marker, 'i'));
    }
  }],
  ['catalog lookup normalizes human-readable titles to product slugs', () => {
    assert.match(publicProducts, /slugifyProductTitle\(normalizedIdentifier\)/);
    assert.match(publicProducts, /keys\.includes\(normalizedIdentifier\) \|\| keys\.includes\(slugIdentifier\)/);
  }],
  ['thumbnail retries catalog candidates before a neutral package icon', () => {
    assert.match(thumbnail, /imageCandidates\.find\(candidate => !failedImageUrls\.includes\(candidate\)\)/);
    assert.match(thumbnail, /setFailedImageUrls/);
    assert.match(thumbnail, /\{imageUrl \? \(/);
    assert.doesNotMatch(thumbnail, /failedImageUrl\s*!==/);
    assert.match(thumbnail, /<Package className=\{iconClass\}/);
    assert.doesNotMatch(thumbnail, /🍊/);
  }],
  ['tracker uses shared thumbnails in both item-detail views', () => {
    assert.equal((tracker.match(/<OrderItemThumbnail item=\{item\}/g) || []).length, 2);
    assert.doesNotMatch(tracker, /🍊/);
    assert.match(tracker, /image_url: li\.image_url \|\| null/);
  }],
  ['order history uses shared compact thumbnails', () => {
    assert.match(history, /<OrderItemThumbnail key=\{i\} item=\{item\} size="compact"/);
    assert.match(history, /Delivery proof/);
    assert.match(history, /order\.delivery_photo_url/);
    assert.doesNotMatch(history, /🍊/);
  }],
  ['future program orders retain their product image', () => {
    assert.match(programDetail, /image_url: program\.image/);
  }],
];

let passed = 0;
for (const [name, test] of tests) {
  try {
    test();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

console.log(`G101 order item product thumbnails: ${passed}/${tests.length} passed`);
