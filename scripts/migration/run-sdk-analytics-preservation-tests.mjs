#!/usr/bin/env node
// Preserve the approved SDK runtime until its new attribution behavior receives
// a separate consent review. No browser, network, provider or storage calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const manifest = read('package.json');
const lock = read('package-lock.json');
const installed = read('node_modules/@base44/sdk/package.json');
const approved = {
  version: '0.8.52',
  resolved: 'https://registry.npmjs.org/@base44/sdk/-/sdk-0.8.52.tgz',
  integrity: 'sha512-zb8ULyt06xWZxYzrNQTgy4QsObWVUh2758W9GhAB/G7KmLGG2sAVjfTyS/iw+fmSL9lR5uGlorXwSY5HwpwMHQ==',
};
function verify(manifestPin, lockPin, entry, installedVersion) {
  assert.equal(manifestPin, approved.version, 'SDK must remain exact-pinned pending separate consent review');
  assert.equal(lockPin, approved.version);
  for (const [key, value] of Object.entries(approved)) assert.equal(entry[key], value);
  assert.equal(installedVersion, approved.version);
}
verify(manifest.dependencies['@base44/sdk'], lock.packages[''].dependencies['@base44/sdk'],
  lock.packages['node_modules/@base44/sdk'], installed.version);
const analytics = fs.readFileSync('node_modules/@base44/sdk/dist/modules/analytics.js');
assert.equal(crypto.createHash('sha256').update(analytics).digest('hex'),
  '0cd53da66859712b25cf18d9b6bb4ea949db6b9f0bca645459cff896bc48994f',
  'Installed analytics runtime differs from the reviewed published 0.8.52 source');
assert.doesNotMatch(analytics.toString(), /ATTRIBUTION_PARAM_KEYS|getAttributionParams/);
for (const pin of ['^0.8.52', '0.8.53', '^0.8.53']) {
  assert.throws(() => verify(pin, approved.version, approved, approved.version));
}
assert.throws(() => verify(approved.version, '0.8.53', approved, approved.version));
assert.throws(() => verify(approved.version, approved.version, { ...approved, integrity: 'changed' }, approved.version));
assert.throws(() => verify(approved.version, approved.version, approved, '0.8.53'));
console.log(JSON.stringify({ ok: true, suite: 'sdk-analytics-preservation',
  exact_sdk_version: approved.version, installed_runtime_hash_verified: true,
  negative_cases_rejected: 6, provider_calls: false, writes: false,
  limitation: 'Preserves prior SDK behavior; not a certification of existing analytics consent.' }, null, 2));
