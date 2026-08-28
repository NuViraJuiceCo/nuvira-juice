#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'src/pages/ProductDetail.jsx'), 'utf8');

const tests = [
  ['mobile back control meets the 44px target floor', () => {
    assert.match(source, /className="md:hidden absolute left-4 w-11 h-11[\s\S]{0,260}aria-label="Go back"/);
  }],
  ['quantity controls meet the 44px target floor', () => {
    assert.equal((source.match(/className="flex h-11 w-11 items-center justify-center rounded-lg/g) || []).length, 2);
    assert.match(source, /aria-label="Decrease quantity"/);
    assert.match(source, /aria-label="Increase quantity"/);
  }],
  ['sticky add-to-cart action meets the 44px target floor', () => {
    assert.match(source, /className="nuvira-gradient-button h-11 min-h-11 flex-1/);
  }],
  ['desktop back control meets the 44px target floor', () => {
    assert.match(source, /className="inline-flex min-h-11 min-w-11 items-center gap-1\.5/);
  }],
  ['product policy links preserve accessible target height', () => {
    assert.equal((source.match(/inline-flex min-h-11 items-center text-xs font-bold text-primary/g) || []).length, 2);
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
    console.error(error);
    process.exit(1);
  }
}

console.log(`G157 product detail touch targets passed (${passed}/${tests.length}).`);
