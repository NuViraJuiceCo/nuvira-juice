#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('hero primary action is one link rather than a nested link and button', () => {
  const source = read('src/components/home/HeroBanner.jsx');
  assert.match(source, /<Button asChild[\s\S]*?<Link to=\{banner\.link_to \|\| '\/shop'\}[\s\S]*?Order Now[\s\S]*?<\/Link>[\s\S]*?<\/Button>/);
  assert.doesNotMatch(source, /<Link[^>]*>[\s\S]{0,200}<Button/);
});

test('product card detail links and quick-add buttons are sibling controls', () => {
  const source = read('src/components/shop/ProductCard.jsx');
  const links = source.match(/<Link[\s\S]*?\/>/g) || [];
  assert.equal((source.match(/<Link/g) || []).length, 2);
  assert.equal(links.length, 2);
  assert.match(source, /aria-label=\{`View \$\{product\.title\}`\}/);
  assert.equal((source.match(/z-20 flex h-11 w-11/g) || []).length, 2);
  assert.equal((source.match(/absolute inset-0 z-10/g) || []).length, 2);
});

test('program and merch images expose intrinsic dimensions', () => {
  const programs = read('src/lib/program-catalog.js');
  const cards = read('src/components/home/ProgramCards.jsx');
  const teaser = read('src/components/home/MerchTeaser.jsx');
  const merch = read('src/pages/Merch.jsx');
  assert.equal((programs.match(/imageWidth: 720/g) || []).length, 3);
  assert.equal((programs.match(/imageHeight:/g) || []).length, 3);
  assert.equal((cards.match(/width=\{program\.imageWidth\}/g) || []).length, 2);
  assert.equal((cards.match(/height=\{program\.imageHeight\}/g) || []).length, 2);
  assert.match(teaser, /width="640"[\s\S]*?height="960"/);
  assert.match(merch, /width="640" height="960"/);
});

test('home navigation and discovery controls meet a 44px target floor', () => {
  const home = read('src/pages/Home.jsx');
  const row = read('src/components/home/ProductRow.jsx');
  const sideNav = read('src/components/layout/SideNav.jsx');
  assert.match(home, /aria-label="View notifications" className="relative flex h-11 w-11/);
  assert.equal((home.match(/min-h-11/g) || []).length >= 13, true);
  assert.match(row, /min-h-11 items-center/);
  assert.equal((sideNav.match(/inline-flex min-h-11 items-center/g) || []).length, 5);
  for (const label of ['About', 'Contact', 'FAQ', 'Delivery', 'Returns']) {
    assert.match(sideNav, new RegExp(`inline-flex min-h-11 items-center justify-center min-w-11[^>]*>${label}<\\/Link>`));
  }
});

test('consent choices and actions expose 44px controls', () => {
  const source = read('src/components/AnalyticsConsent.jsx');
  assert.equal((source.match(/relative h-11 w-11 border-0/g) || []).length, 2);
  assert.equal((source.match(/className="[^"]*h-11[^"]*"/g) || []).length >= 4, true);
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

console.log(`G152 mobile accessibility structure tests passed (${passed}/${tests.length}).`);
