import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const resolver = read('src/lib/order-item-images.js');
const thumbnail = read('src/components/orders/OrderItemThumbnail.jsx');
const tracker = read('src/pages/OrderTracker.jsx');
const history = read('src/pages/OrderHistory.jsx');
const programDetail = read('src/pages/ProgramDetail.jsx');

const tests = [
  ['catalog-aware resolver preserves safe stored images', () => {
    assert.match(resolver, /safeImageUrl\(item\.image_url \|\| item\.image \|\| item\.product_image_url\)/);
    assert.match(resolver, /findPublicProductFallback\(identifier\)/);
  }],
  ['resolver covers products, programs, bundle, and tote aliases', () => {
    for (const marker of ['radiance', 'hydration', 'reset', 'nuvira\\s+trio', 'Radiance Shot', 'Hydration Shot', 'Reset Shot', 'RE-NU', 'OASIS', 'AURA', 'Orange Juice', 'Pineapple Juice', 'Watermelon Juice', 'Large NuVira Tote Bag']) {
      assert.match(resolver, new RegExp(marker, 'i'));
    }
  }],
  ['thumbnail fails safely to a neutral package icon', () => {
    assert.match(thumbnail, /onError=\{\(\) => setFailedImageUrl\(imageUrl\)\}/);
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
