#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const jsonOnly = args.has('--json');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function hashFile(relativePath) {
  return hashBuffer(fs.readFileSync(path.join(repoRoot, relativePath)));
}

function activeAssets(indexHtml) {
  const assets = new Set();
  for (const match of indexHtml.matchAll(/(?:src|href)=["']\/?(assets\/[^"']+\.(?:js|css))["']/g)) {
    assets.add(match[1]);
  }
  return [...assets].sort();
}

function fail(message, extra = {}) {
  console.error(JSON.stringify({ ok: false, suite: 'g50c-web-native-bundle-parity', message, ...extra }, null, 2));
  process.exit(1);
}

const capacitor = JSON.parse(read('capacitor.config.json'));
if (capacitor.webDir !== 'dist') fail('Capacitor webDir must be dist', { webDir: capacitor.webDir });
if (Object.prototype.hasOwnProperty.call(capacitor, 'server')) fail('Unexpected Capacitor server configuration found', { server: capacitor.server });

for (const required of ['dist/index.html', 'ios/App/App/public/index.html']) {
  if (!exists(required)) fail('Required built index file missing', { required });
}

const webIndex = read('dist/index.html');
const nativeIndex = read('ios/App/App/public/index.html');
const webAssets = activeAssets(webIndex);
const nativeAssets = activeAssets(nativeIndex);
if (!webAssets.length) fail('No active Web entry assets found in dist/index.html');
if (!nativeAssets.length) fail('No active native entry assets found in ios/App/App/public/index.html');
if (JSON.stringify(webAssets) !== JSON.stringify(nativeAssets)) {
  fail('Web and native active asset references differ', { webAssets, nativeAssets });
}

const assetResults = [];
for (const asset of webAssets) {
  const webPath = `dist/${asset}`;
  const nativePath = `ios/App/App/public/${asset}`;
  if (!exists(webPath) || !exists(nativePath)) fail('Referenced asset missing', { webPath, nativePath });
  const webHash = hashFile(webPath);
  const nativeHash = hashFile(nativePath);
  if (webHash !== nativeHash) fail('Web/native active asset hash mismatch', { asset, webHash, nativeHash });
  assetResults.push({ asset, sha256: webHash });
}

const combinedNativeText = [nativeIndex, ...webAssets.map((asset) => read(`ios/App/App/public/${asset}`))].join('\n');
const requiredMarkers = [
  'PAYMENT_ATTEMPT_STATE_UNKNOWN',
  'Still checking your checkout',
  'We couldn',
  'NuVira hit a loading issue',
  'Try Again',
  'Return Home',
  'Reset Sign-In',
  'reset_sign_in',
  'logout_request_timeout',
];
const forbiddenMarkers = [
  "window.location.replace('/account-setup')",
  'scheduleAutomaticRecovery',
  'MAX_IMMEDIATE_RECOVERY_ATTEMPTS',
  'native_reopen',
  'clearNativeBootstrapState',
];

const missingRequiredMarkers = requiredMarkers.filter((marker) => !combinedNativeText.includes(marker));
if (missingRequiredMarkers.length) fail('Required startup/checkout markers missing from native bundle', { missingRequiredMarkers });
const forbiddenMarkerHits = forbiddenMarkers.filter((marker) => combinedNativeText.includes(marker));
if (forbiddenMarkerHits.length) fail('Forbidden legacy startup markers found in native bundle', { forbiddenMarkerHits });

const result = {
  ok: true,
  suite: 'g50c-web-native-bundle-parity',
  webDir: capacitor.webDir,
  server_url_present: false,
  web_index_hash: hashFile('dist/index.html'),
  native_index_hash: hashFile('ios/App/App/public/index.html'),
  active_assets: assetResults,
  required_markers_present: requiredMarkers,
  forbidden_markers_absent: forbiddenMarkers,
  web_native_bundle_parity: true,
};
console.log(JSON.stringify(result, null, jsonOnly ? 0 : 2));
