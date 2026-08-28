#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
const assetLinks = JSON.parse(fs.readFileSync('public/.well-known/assetlinks.json', 'utf8'));
const deepLinkRuntime = fs.readFileSync('src/lib/deliveryLiveActivity.js', 'utf8');
const critical = fs.readFileSync('scripts/ci/run-critical-regressions.mjs', 'utf8');

const PACKAGE_NAME = 'com.nuvirajuice.app';
const PLAY_SIGNING_SHA256 = '92:81:EE:2B:13:E7:30:0A:BD:FB:AB:18:0C:BB:83:A1:6D:09:38:F8:4E:24:8E:2D:39:FA:5E:F4:49:98:59:3A';

const checks = [
  ['Digital Asset Links uses the authoritative Play package and signing certificate', () => {
    assert.equal(assetLinks.length, 1);
    assert.deepEqual(assetLinks[0].relation, ['delegate_permission/common.handle_all_urls']);
    assert.equal(assetLinks[0].target.namespace, 'android_app');
    assert.equal(assetLinks[0].target.package_name, PACKAGE_NAME);
    assert.deepEqual(assetLinks[0].target.sha256_cert_fingerprints, [PLAY_SIGNING_SHA256]);
    assert.doesNotMatch(JSON.stringify(assetLinks), /com\.base69d48d0c39891f7945481152\.app/);
  }],
  ['Android App Links are HTTPS verified for the canonical domain', () => {
    assert.match(manifest, /<intent-filter android:autoVerify="true">/);
    assert.match(manifest, /android:host="nuvirajuice\.com"/);
    assert.match(manifest, /android:scheme="https"/);
    assert.doesNotMatch(manifest, /android:host="www\.nuvirajuice\.com"/);
  }],
  ['verified links are narrowly limited to supported order routes', () => {
    assert.match(manifest, /android:pathPrefix="\/order-tracker\/"/);
    assert.match(manifest, /android:path="\/account\/orders"/);
    assert.doesNotMatch(manifest, /android:pathPrefix="\/admin/);
    assert.doesNotMatch(manifest, /android:pathPrefix="\/"/);
  }],
  ['existing custom-scheme authentication and navigation contracts remain intact', () => {
    assert.match(manifest, /android:host="auth"[\s\S]*?android:path="\/callback"[\s\S]*?android:scheme="nuvira"/);
    assert.match(manifest, /android:host="open"[\s\S]*?android:scheme="nuvira"/);
  }],
  ['native runtime accepts canonical HTTPS routes and applies the same allowlist', () => {
    assert.match(deepLinkRuntime, /\['nuvirajuice\.com', 'www\.nuvirajuice\.com'\]\.includes\(url\.hostname\)/);
    assert.ok(deepLinkRuntime.includes(
      'const ALLOWED_DEEP_LINK = /^\\/(order-tracker\\/[^/?#]+|account\\/orders)(?:[/?#].*)?$/;',
    ));
    assert.match(deepLinkRuntime, /return safeDeepLink\(`\$\{url\.pathname\}\$\{url\.search\}\$\{url\.hash\}`\)/);
  }],
  ['G149 is permanently included in the critical regression suite', () => {
    assert.match(critical, /run-g149-android-app-links-tests\.mjs/);
  }],
];

let passed = 0;
for (const [name, check] of checks) {
  check();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

console.log(`G149 Android App Links coverage: ${passed}/${checks.length} checks passed`);
