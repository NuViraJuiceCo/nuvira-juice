#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('src/index.css', 'utf8');
const criticalRunner = fs.readFileSync('scripts/ci/run-critical-regressions.mjs', 'utf8');
const fontPath = 'public/fonts/inter-latin.woff2';
const licensePath = 'public/fonts/OFL-Inter.txt';

const checks = [
  ['Inter is delivered from one local preloaded asset', () => {
    assert.match(html, /<link rel="preload" href="\/fonts\/inter-latin\.woff2" as="font" type="font\/woff2" crossorigin \/>/);
    assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
    assert.match(css, /font-family: 'Inter';[\s\S]*?font-weight: 400 600;[\s\S]*?src: url\('\/fonts\/inter-latin\.woff2'\) format\('woff2'\);/);
  }],
  ['the local asset is the verified official Inter Latin WOFF2', () => {
    const font = fs.readFileSync(fontPath);
    assert.equal(font.subarray(0, 4).toString('ascii'), 'wOF2');
    assert.equal(font.length, 48_432);
    assert.equal(
      crypto.createHash('sha256').update(font).digest('hex'),
      'c940764593d0fe5d596be327ca7558855e018039fb78509aa21921fd3644c3e4',
    );
  }],
  ['the Inter license travels with the font', () => {
    const license = fs.readFileSync(licensePath, 'utf8');
    assert.match(license, /Copyright \(c\) 2016 The Inter Project Authors/);
    assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
  }],
  ['G154 remains in the critical regression suite', () => {
    assert.match(criticalRunner, /run-g154-local-font-delivery-tests\.mjs/);
  }],
];

let passed = 0;
for (const [name, check] of checks) {
  try {
    check();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`G154 local font delivery tests passed (${passed}/${checks.length}).`);
