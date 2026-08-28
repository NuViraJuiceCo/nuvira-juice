#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const tests = [
  ['login recovery and registration links expose a 44px target', () => {
    const source = read('src/pages/Login.jsx');
    assert.match(source, /inline-flex min-h-11 items-center text-primary font-medium[\s\S]{0,180}Create one/);
    assert.match(source, /inline-flex min-h-11 items-center text-xs text-primary[\s\S]{0,120}Forgot password/);
  }],
  ['shop search and category filters expose a 44px target', () => {
    const source = read('src/pages/Shop.jsx');
    assert.match(source, /className="pl-9 h-11 rounded-xl/);
    assert.match(source, /className=\{`shrink-0 min-h-11 px-4 rounded-full/);
  }],
  ['desktop shop discovery links expose a 44px target', () => {
    const source = read('src/pages/Shop.jsx');
    assert.equal((source.match(/flex min-h-11 items-center rounded-lg border border-border\/45/g) || []).length, 8);
  }],
  ['empty-cart action uses one accessible 44px control', () => {
    const source = read('src/pages/Cart.jsx');
    assert.match(source, /<Button asChild className="h-11 min-h-11 rounded-full px-6 nuvira-gradient-button">[\s\S]{0,100}<Link to="\/shop">Browse Juices<\/Link>/);
    assert.doesNotMatch(source, /<Link to="\/shop">\s*<Button[^>]*>Browse Juices/);
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

console.log(`G158 core conversion touch targets passed (${passed}/${tests.length}).`);
