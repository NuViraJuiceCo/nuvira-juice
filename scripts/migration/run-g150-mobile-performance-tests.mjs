#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const productImages = [
  'aura',
  're-nu',
  'oasis',
  'the-nuvira-trio',
  'orange-juice',
  'pineapple-juice',
  'watermelon-juice',
  'radiance-shot',
  'hydration-shot',
  'reset-shot',
].map((name) => `public/images/products/cards/${name}.webp`);
const programImages = ['radiance', 'hydration', 'reset']
  .map((name) => `public/images/programs/${name}-card.webp`);

function assertWebP(file, maxBytes) {
  const fullPath = path.join(root, file);
  assert.equal(fs.existsSync(fullPath), true, `${file} is missing`);
  const contents = fs.readFileSync(fullPath);
  assert.equal(contents.subarray(0, 4).toString('ascii'), 'RIFF', `${file} is not RIFF WebP`);
  assert.equal(contents.subarray(8, 12).toString('ascii'), 'WEBP', `${file} is not WebP`);
  assert.ok(contents.length < maxBytes, `${file} exceeds ${maxBytes} bytes`);
}

test('optimized product card assets are valid and bounded', () => {
  productImages.forEach((file) => assertWebP(file, 80_000));
});

test('optimized program and wordmark assets are valid and bounded', () => {
  programImages.forEach((file) => assertWebP(file, 100_000));
  assertWebP('public/images/brand/nuvira-wordmark.webp', 30_000);
});

test('product card surfaces use local optimized images without changing product records', () => {
  const component = read('src/components/shop/ProductCard.jsx');
  const helper = read('src/lib/product-card-images.js');
  const products = read('src/lib/public-products.js');
  const catalog = read('src/lib/public-product-catalog.js');
  assert.match(component, /productCardImage\(product\)/);
  assert.match(component, /src=\{cardImage\}/);
  assert.match(helper, /product\?\.image_url \|\| ''/);
  assert.match(products, /public-product-catalog/);
  assert.match(catalog, /image_url: 'https:\/\/media\.base44\.com/);
});

test('program cards use local optimized images', () => {
  const catalog = read('src/lib/program-catalog.js');
  programImages.forEach((file) => {
    assert.ok(catalog.includes(file.replace(/^public/, '')));
  });
});

test('initial home and side navigation branding use the local wordmark', () => {
  const home = read('src/pages/Home.jsx');
  const sideNav = read('src/components/layout/SideNav.jsx');
  const brandImages = read('src/lib/brandImages.js');
  assert.match(brandImages, /wordmark: '\/images\/brand\/nuvira-wordmark\.webp'/);
  assert.match(home, /src=\{BRAND_IMAGES\.wordmark\}/);
  assert.match(sideNav, /src=\{BRAND_IMAGES\.wordmark\}/);
});

test('compact quick add and carousel dots expose 44px tap targets', () => {
  const productCard = read('src/components/shop/ProductCard.jsx');
  const hero = read('src/components/home/HeroBanner.jsx');
  assert.match(productCard, /bottom-2 right-2[^"\n]*h-11 w-11/);
  assert.match(hero, /className="group flex h-11 w-11 items-center justify-center rounded-full"/);
});

let passed = 0;
for (const entry of tests) {
  try {
    await entry.fn();
    passed += 1;
    console.log(`PASS ${entry.name}`);
  } catch (error) {
    console.error(`FAIL ${entry.name}`);
    console.error(error);
    process.exit(1);
  }
}

console.log(`G150 mobile performance tests passed (${passed}/${tests.length}).`);
