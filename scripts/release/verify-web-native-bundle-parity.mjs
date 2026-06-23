#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
};
const outPath = arg('--out');
const budgetPath = arg('--budget', 'config/release/bundle-size-budget.json');
const jsonOnly = args.includes('--json');
function gitHead() { const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : 'unknown'; }
function read(relativePath) { return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'); }
function exists(relativePath) { return fs.existsSync(path.join(repoRoot, relativePath)); }
function hashBuffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function hashFile(relativePath) { return hashBuffer(fs.readFileSync(path.join(repoRoot, relativePath))); }
function writeEvidence(result) {
  if (!outPath) return;
  const absolute = path.resolve(repoRoot, outPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(result, null, 2)}\n`);
}
function fail(message, extra = {}) {
  const result = { ok: false, suite: 'g50c-web-native-bundle-parity', git_commit: gitHead(), generated_at_utc: new Date().toISOString(), message, ...extra };
  writeEvidence(result);
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
function activeAssets(indexHtml) {
  const assets = new Set();
  for (const match of indexHtml.matchAll(/(?:src|href)=["']\/?(assets\/[^"']+\.(?:js|css))["']/g)) assets.add(match[1]);
  return [...assets].sort();
}
function sizes(relativePath) {
  const buffer = fs.readFileSync(path.join(repoRoot, relativePath));
  return { raw_bytes: buffer.length, gzip_bytes: zlib.gzipSync(buffer).length, brotli_bytes: zlib.brotliCompressSync(buffer).length };
}
function loadBudget() {
  const absolute = path.resolve(repoRoot, budgetPath);
  if (!fs.existsSync(absolute)) fail('Bundle-size budget config missing', { budgetPath });
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
}
function assertBudget(assetResults) {
  const budget = loadBudget();
  const js = assetResults.filter((asset) => asset.asset.endsWith('.js'));
  const css = assetResults.filter((asset) => asset.asset.endsWith('.css'));
  const totals = {
    initial_js_raw_bytes: js.reduce((sum, asset) => sum + asset.raw_bytes, 0),
    initial_js_gzip_bytes: js.reduce((sum, asset) => sum + asset.gzip_bytes, 0),
    initial_js_brotli_bytes: js.reduce((sum, asset) => sum + asset.brotli_bytes, 0),
    initial_css_raw_bytes: css.reduce((sum, asset) => sum + asset.raw_bytes, 0),
    initial_css_gzip_bytes: css.reduce((sum, asset) => sum + asset.gzip_bytes, 0),
    initial_css_brotli_bytes: css.reduce((sum, asset) => sum + asset.brotli_bytes, 0),
  };
  const failures = [];
  const checks = [
    ['initial_js_raw_bytes', totals.initial_js_raw_bytes, budget.max_initial_js_raw_bytes],
    ['initial_js_gzip_bytes', totals.initial_js_gzip_bytes, budget.max_initial_js_gzip_bytes],
    ['initial_js_brotli_bytes', totals.initial_js_brotli_bytes, budget.max_initial_js_brotli_bytes],
    ['initial_css_raw_bytes', totals.initial_css_raw_bytes, budget.max_initial_css_raw_bytes],
    ['initial_css_gzip_bytes', totals.initial_css_gzip_bytes, budget.max_initial_css_gzip_bytes],
    ['initial_css_brotli_bytes', totals.initial_css_brotli_bytes, budget.max_initial_css_brotli_bytes],
  ];
  for (const [name, actual, max] of checks) if (Number.isFinite(max) && actual > max) failures.push({ name, actual, max });
  for (const asset of assetResults) {
    const maxRaw = asset.asset.endsWith('.js') ? budget.max_single_js_chunk_raw_bytes : budget.max_single_css_chunk_raw_bytes;
    if (Number.isFinite(maxRaw) && asset.raw_bytes > maxRaw) failures.push({ name: 'single_chunk_raw_bytes', asset: asset.asset, actual: asset.raw_bytes, max: maxRaw });
  }
  if (failures.length) fail('Bundle-size budget exceeded', { failures, totals, budget });
  return { budget, totals };
}

const capacitor = JSON.parse(read('capacitor.config.json'));
if (capacitor.webDir !== 'dist') fail('Capacitor webDir must be dist', { webDir: capacitor.webDir });
if (Object.prototype.hasOwnProperty.call(capacitor, 'server')) fail('Unexpected Capacitor server configuration found', { server: capacitor.server });
for (const required of ['dist/index.html', 'ios/App/App/public/index.html']) if (!exists(required)) fail('Required built index file missing', { required });
const webIndex = read('dist/index.html');
const nativeIndex = read('ios/App/App/public/index.html');
const webAssets = activeAssets(webIndex);
const nativeAssets = activeAssets(nativeIndex);
if (!webAssets.length) fail('No active Web entry assets found in dist/index.html');
if (!nativeAssets.length) fail('No active native entry assets found in ios/App/App/public/index.html');
if (JSON.stringify(webAssets) !== JSON.stringify(nativeAssets)) fail('Web and native active asset references differ', { webAssets, nativeAssets });
const assetResults = [];
for (const asset of webAssets) {
  const webPath = `dist/${asset}`;
  const nativePath = `ios/App/App/public/${asset}`;
  if (!exists(webPath) || !exists(nativePath)) fail('Referenced asset missing', { webPath, nativePath });
  const webHash = hashFile(webPath);
  const nativeHash = hashFile(nativePath);
  if (webHash !== nativeHash) fail('Web/native active asset hash mismatch', { asset, webHash, nativeHash });
  assetResults.push({ asset, sha256: webHash, ...sizes(webPath) });
}
const combinedNativeText = [nativeIndex, ...webAssets.map((asset) => read(`ios/App/App/public/${asset}`))].join('\n');
const requiredMarkers = ['PAYMENT_ATTEMPT_STATE_UNKNOWN','Still checking your checkout','We couldn','NuVira hit a loading issue','Try Again','Return Home','Reset Sign-In','reset_sign_in','logout_request_timeout'];
const forbiddenMarkers = ["window.location.replace('/account-setup')",'scheduleAutomaticRecovery','MAX_IMMEDIATE_RECOVERY_ATTEMPTS','native_reopen','clearNativeBootstrapState'];
const missingRequiredMarkers = requiredMarkers.filter((marker) => !combinedNativeText.includes(marker));
if (missingRequiredMarkers.length) fail('Required startup/checkout markers missing from native bundle', { missingRequiredMarkers });
const forbiddenMarkerHits = forbiddenMarkers.filter((marker) => combinedNativeText.includes(marker));
if (forbiddenMarkerHits.length) fail('Forbidden legacy startup markers found in native bundle', { forbiddenMarkerHits });
const budgetEvidence = assertBudget(assetResults);
const result = {
  ok: true,
  suite: 'g50c-web-native-bundle-parity',
  git_commit: gitHead(),
  generated_at_utc: new Date().toISOString(),
  webDir: capacitor.webDir,
  server_url_present: false,
  web_index_hash: hashFile('dist/index.html'),
  native_index_hash: hashFile('ios/App/App/public/index.html'),
  active_assets: assetResults,
  bundle_size: budgetEvidence,
  required_markers_present: requiredMarkers,
  forbidden_markers_absent: forbiddenMarkers,
  web_native_bundle_parity: true,
};
writeEvidence(result);
console.log(JSON.stringify(result, null, jsonOnly ? 0 : 2));
