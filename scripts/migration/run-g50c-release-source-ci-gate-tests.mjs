#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const abs = (relativePath) => path.join(repoRoot, relativePath);
const read = (relativePath) => fs.readFileSync(abs(relativePath), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: options.cwd || repoRoot, env: { ...process.env, ...(options.env || {}) }, encoding: 'utf8', maxBuffer: 1024 * 1024 * 40 });
}
function tempDir(name) { return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`)); }
function write(file, body, cwd) { const target = path.join(cwd, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, body); }
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function lineFingerprint(file, detector, lineText) { return sha(`${file}\0${detector}\0${lineText.trim()}`); }
function initGit(dir) { run('git', ['init', '-b', 'main'], { cwd: dir }); run('git', ['config', 'user.email', 'g50c-test.invalid'], { cwd: dir }); run('git', ['config', 'user.name', 'G50C Test'], { cwd: dir }); }
function commitAll(dir, message = 'commit') { run('git', ['add', '.'], { cwd: dir }); run('git', ['commit', '-m', message], { cwd: dir }); return run('git', ['rev-parse', 'HEAD'], { cwd: dir }).stdout.trim(); }
function makePackage(dir, { installed = true } = {}) {
  write('package.json', '{"name":"g50c-fixture","version":"1.0.0"}\n', dir);
  const lock = '{"name":"g50c-fixture","version":"1.0.0","lockfileVersion":3,"packages":{"":{"name":"g50c-fixture","version":"1.0.0"}}}\n';
  write('package-lock.json', lock, dir);
  if (installed) write('node_modules/.package-lock.json', lock, dir);
}
function makeSourceRepo({ installed = true } = {}) {
  const dir = tempDir('g50c-source');
  makePackage(dir, { installed });
  write('src/App.jsx', 'export default function App(){return null}\n', dir);
  initGit(dir);
  const head = commitAll(dir, 'initial');
  run('git', ['update-ref', 'refs/remotes/origin/main', head], { cwd: dir });
  return { dir, head };
}
function makeSecretRepo(files, allowlist = []) {
  const dir = tempDir('g50c-secret');
  for (const [file, body] of Object.entries(files)) write(file, body, dir);
  write('config/release/secret-scan-allowlist.json', JSON.stringify({ allowlist }, null, 2), dir);
  initGit(dir); commitAll(dir, 'secret fixture');
  return dir;
}
function makeParityFixture({ assetSize = 64, budget = null, mismatch = false } = {}) {
  const dir = tempDir('g50c-parity');
  const markers = ['PAYMENT_ATTEMPT_STATE_UNKNOWN','Still checking your checkout','We couldn','NuVira hit a loading issue','Try Again','Return Home','Reset Sign-In','reset_sign_in','logout_request_timeout'].join('\n');
  const webAsset = `console.log(${JSON.stringify(markers)});\n${'x'.repeat(assetSize)}`;
  const nativeAsset = mismatch ? `${webAsset}\nconsole.log('mismatch')` : webAsset;
  write('capacitor.config.json', JSON.stringify({ appId: 'test', appName: 'test', webDir: 'dist' }, null, 2), dir);
  write('dist/index.html', '<script type="module" src="/assets/index-test.js"></script>', dir);
  write('dist/assets/index-test.js', webAsset, dir);
  write('ios/App/App/public/index.html', '<script type="module" src="/assets/index-test.js"></script>', dir);
  write('ios/App/App/public/assets/index-test.js', nativeAsset, dir);
  write('config/release/bundle-size-budget.json', JSON.stringify(budget || { max_initial_js_raw_bytes: 100000, max_initial_js_gzip_bytes: 100000, max_initial_js_brotli_bytes: 100000, max_initial_css_raw_bytes: 100000, max_initial_css_gzip_bytes: 100000, max_initial_css_brotli_bytes: 100000, max_single_js_chunk_raw_bytes: 100000, max_single_css_chunk_raw_bytes: 100000 }, null, 2), dir);
  return dir;
}
function makeManifestRepo({ staleEvidence = false, missingEvidence = false, mergeWithoutPr = false } = {}) {
  const dir = tempDir('g50c-manifest');
  makePackage(dir);
  write('dist/index.html', '<script type="module" src="/assets/index.js"></script>', dir);
  write('dist/assets/index.js', 'console.log("web")', dir);
  write('ios/App/App/public/index.html', '<script type="module" src="/assets/index.js"></script>', dir);
  write('ios/App/App/public/assets/index.js', 'console.log("web")', dir);
  write('capacitor.config.json', '{"webDir":"dist"}\n', dir);
  write('config/release/critical-paths.json', JSON.stringify({ critical_paths: ['src/App.jsx'] }), dir);
  write('config/release/critical-pr-acknowledgements.json', JSON.stringify({ acknowledged_excluded_critical_prs: [] }), dir);
  initGit(dir);
  const previous = commitAll(dir, 'previous release');
  if (mergeWithoutPr) {
    run('git', ['checkout', '-b', 'feature'], { cwd: dir });
    write('src/App.jsx', 'changed\n', dir); commitAll(dir, 'feature commit');
    run('git', ['checkout', 'main'], { cwd: dir });
    run('git', ['merge', '--no-ff', 'feature', '-m', 'manual merge without pr number'], { cwd: dir });
  } else {
    write('src/App.jsx', 'current\n', dir); commitAll(dir, 'current');
  }
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: dir }).stdout.trim();
  run('git', ['update-ref', 'refs/remotes/origin/main', head], { cwd: dir });
  write('config/release/native-release-range.json', JSON.stringify({ previous_released_commit: previous, allow_empty_included_prs_when_no_merge_commits: true }, null, 2), dir);
  const evidenceCommit = staleEvidence ? '0000000000000000000000000000000000000000' : head;
  const evidenceNames = ['source-policy.json','secret-scan.json','diagnostics.json','critical-regressions.json','bundle-parity.json','simulator-build.json','critical-prs.json'];
  if (!missingEvidence) for (const name of evidenceNames) write(`release-evidence/${name}`, JSON.stringify({ ok: true, suite: name.replace('.json',''), git_commit: evidenceCommit, generated_at_utc: '2026-06-23T00:00:00Z' }, null, 2), dir);
  write('xcode-settings.json', JSON.stringify({ marketing_version: '2.0.0', build_number: '3', product_bundle_identifier: 'com.example.app', sdkroot: 'iphonesimulator', configuration: 'Release' }, null, 2), dir);
  return { dir, head, previous };
}
function diagFixture(dir, current, baseline) {
  write('fixture.json', JSON.stringify(current, null, 2), dir);
  write('baseline.json', JSON.stringify({ schema_version: 2, generated_from_commit: 'fixture', lint: { diagnostics: baseline.lint || [] }, typecheck: { diagnostics: baseline.typecheck || [] }, audit: { vulnerabilities: baseline.audit || [], vulnerability_waivers: baseline.waivers || [] } }, null, 2), dir);
}

const secretScanScript = abs('scripts/ci/scan-tracked-secrets.mjs');
const diagnosticsScript = abs('scripts/ci/verify-diagnostic-baseline.mjs');
const criticalPrScript = abs('scripts/release/verify-open-critical-prs.mjs');
const manifestScript = abs('scripts/release/generate-native-release-manifest.mjs');
const sourceScript = abs('scripts/release/verify-native-release-source.mjs');
const parityScript = abs('scripts/release/verify-web-native-bundle-parity.mjs');

// 1-8 secret scanner coverage.
test('1. secret scanner does not self-match', () => {
  const dir = makeSecretRepo({ 'scripts/ci/scan-tracked-secrets.mjs': read('scripts/ci/scan-tracked-secrets.mjs') });
  const result = run(process.execPath, [secretScanScript], { cwd: dir });
  assert(result.status === 0, `scanner self-matched: ${result.stderr}`);
});
test('2. real fixture secret fails', () => {
  const fake = `sk_live_${'A'.repeat(24)}`;
  const dir = makeSecretRepo({ 'src/leak.txt': `leak=${fake}\n` });
  const result = run(process.execPath, [secretScanScript], { cwd: dir });
  assert(result.status !== 0 && result.stderr.includes('stripe_secret_key'), 'fake Stripe secret did not fail');
});
test('3. redacted output contains no full secret', () => {
  const fake = `whsec_${'B'.repeat(24)}`;
  const dir = makeSecretRepo({ 'base44/functions/leak/entry.ts': fake });
  const result = run(process.execPath, [secretScanScript], { cwd: dir });
  assert(result.status !== 0 && !result.stderr.includes(fake), 'secret scan printed full secret');
});
test('4. expired exception fails', () => {
  const fake = `Bearer ${'C'.repeat(32)}`;
  const line = `auth='${fake}'`;
  const file = 'src/allowed.txt';
  const allow = [{ file, detector: 'bearer_token', content_fingerprint: lineFingerprint(file, 'bearer_token', line), reason: 'test', expires_at: '2020-01-01T00:00:00Z' }];
  const dir = makeSecretRepo({ [file]: `${line}\n` }, allow);
  const result = run(process.execPath, [secretScanScript], { cwd: dir });
  assert(result.status !== 0 && result.stderr.includes('expired'), 'expired secret allowlist did not fail');
});
test('5. valid exact exception passes', () => {
  const fake = `Bearer ${'D'.repeat(32)}`;
  const line = `auth='${fake}'`;
  const file = 'src/allowed.txt';
  const allow = [{ file, detector: 'bearer_token', content_fingerprint: lineFingerprint(file, 'bearer_token', line), reason: 'test placeholder', expires_at: '2099-01-01T00:00:00Z' }];
  const dir = makeSecretRepo({ [file]: `${line}\n` }, allow);
  const result = run(process.execPath, [secretScanScript], { cwd: dir });
  assert(result.status === 0, `valid exact allowlist did not pass: ${result.stderr}`);
});
test('6. similar content outside exception still fails', () => {
  const fake = `Bearer ${'E'.repeat(32)}`;
  const line = `auth='${fake}'`;
  const allow = [{ file: 'src/allowed.txt', detector: 'bearer_token', content_fingerprint: lineFingerprint('src/allowed.txt', 'bearer_token', line), reason: 'test placeholder', expires_at: '2099-01-01T00:00:00Z' }];
  const dir = makeSecretRepo({ 'src/allowed.txt': `${line}\n`, 'src/other.txt': `${line}\n` }, allow);
  const result = run(process.execPath, [secretScanScript], { cwd: dir });
  assert(result.status !== 0 && result.stderr.includes('src/other.txt'), 'non-exact allowlist allowed another file');
});
test('7. base44 and ios paths are scanned', () => {
  const fake = `client_secret=${'F'.repeat(24)}`;
  const dir = makeSecretRepo({ 'base44/functions/x/entry.ts': `${fake}\n`, 'ios/App/App/Info.plist': '<plist></plist>\n' });
  const result = run(process.execPath, [secretScanScript], { cwd: dir });
  assert(result.status !== 0 && result.stderr.includes('base44/functions/x/entry.ts'), 'base44 path was not scanned');
});
test('8. untracked files ignored and binary files skipped safely', () => {
  const dir = makeSecretRepo({ 'src/clean.txt': 'clean\n', 'public/logo.png': Buffer.from([0, 1, 2, 3]).toString('binary') });
  write('src/untracked.txt', `sk_live_${'G'.repeat(24)}\n`, dir);
  const result = run(process.execPath, [secretScanScript], { cwd: dir });
  assert(result.status === 0, `untracked/binary policy failed: ${result.stderr}`);
});

// 9-11 diagnostic fingerprints.
test('9. new ESLint issue at unchanged total count fails', () => {
  const dir = tempDir('g50c-diag');
  const oldItem = { fingerprint: 'old-eslint', file: 'a.js', rule_id: 'no-old', severity: 'error', line: 1, column: 1, message_fingerprint: 'old' };
  const newItem = { ...oldItem, fingerprint: 'new-eslint', rule_id: 'no-new' };
  diagFixture(dir, { lint: { diagnostics: [newItem] }, typecheck: { diagnostics: [] }, audit: { vulnerabilities: [] } }, { lint: [oldItem] });
  const result = run(process.execPath, [diagnosticsScript, '--baseline', 'baseline.json'], { cwd: dir, env: { G50C_DIAGNOSTIC_FIXTURE: path.join(dir, 'fixture.json') } });
  assert(result.status !== 0 && result.stderr.includes('New diagnostic fingerprints'), 'new ESLint fingerprint did not fail');
});
test('10. new TypeScript issue at unchanged total count fails', () => {
  const dir = tempDir('g50c-diag');
  const oldItem = { fingerprint: 'old-ts', file: 'a.ts', ts_code: 'TS1', line: 1, column: 1, message_fingerprint: 'old' };
  const newItem = { ...oldItem, fingerprint: 'new-ts', ts_code: 'TS2' };
  diagFixture(dir, { lint: { diagnostics: [] }, typecheck: { diagnostics: [newItem] }, audit: { vulnerabilities: [] } }, { typecheck: [oldItem] });
  const result = run(process.execPath, [diagnosticsScript, '--baseline', 'baseline.json'], { cwd: dir, env: { G50C_DIAGNOSTIC_FIXTURE: path.join(dir, 'fixture.json') } });
  assert(result.status !== 0 && result.stderr.includes('new_typecheck_count'), 'new TS fingerprint did not fail');
});
test('11. new npm advisory at unchanged severity count fails and expired waiver fails', () => {
  const dir = tempDir('g50c-diag');
  const oldVuln = { fingerprint: 'old-vuln', package: 'a', dependency_path: 'a', source_id: '1', severity: 'high' };
  const newVuln = { ...oldVuln, fingerprint: 'new-vuln', source_id: '2' };
  diagFixture(dir, { lint: { diagnostics: [] }, typecheck: { diagnostics: [] }, audit: { vulnerabilities: [newVuln], counts: { high: 1, total: 1 } } }, { audit: [oldVuln], waivers: [{ fingerprint: 'waived', reason: 'x', reachability_assessment: 'x', owner: 'x', created_at: '2026-01-01T00:00:00Z', expires_at: '2020-01-01T00:00:00Z' }] });
  const result = run(process.execPath, [diagnosticsScript, '--baseline', 'baseline.json'], { cwd: dir, env: { G50C_DIAGNOSTIC_FIXTURE: path.join(dir, 'fixture.json') } });
  assert(result.status !== 0 && result.stderr.includes('expired'), 'expired vulnerability waiver did not fail');
});

// 12-13 PR acknowledgement and pagination.
test('12. acknowledged PR with changed head SHA and expired acknowledgement fail', () => {
  const dir = tempDir('g50c-prs');
  write('config/release/critical-paths.json', JSON.stringify({ critical_paths: ['src/App.jsx'] }), dir);
  write('config/release/critical-pr-acknowledgements.json', JSON.stringify({ acknowledged_excluded_critical_prs: [{ number: 1, head_sha: 'old', base_branch: 'main', reason: 'x', status: 'manual_release_exclusion_acknowledged', acknowledged_by: 'x', acknowledged_at: '2026-01-01T00:00:00Z', expires_at: '2020-01-01T00:00:00Z' }] }), dir);
  write('prs.json', JSON.stringify({ pull_requests: [{ number: 1, title: 'x', headRefOid: 'new', baseRefName: 'main', files: ['src/App.jsx'] }] }), dir);
  const result = run(process.execPath, [criticalPrScript], { cwd: dir, env: { G50C_OPEN_PR_FIXTURE: path.join(dir, 'prs.json') } });
  assert(result.status !== 0 && result.stderr.includes('acknowledgement'), 'changed/expired acknowledgement did not fail');
});
test('13. more than 100 open PRs require completed pagination', () => {
  const dir = tempDir('g50c-prs');
  write('config/release/critical-paths.json', JSON.stringify({ critical_paths: ['src/App.jsx'] }), dir);
  write('config/release/critical-pr-acknowledgements.json', JSON.stringify({ acknowledged_excluded_critical_prs: [] }), dir);
  write('prs.json', JSON.stringify({ page_limit: 100, pagination_completed: false, pull_requests: [] }), dir);
  const result = run(process.execPath, [criticalPrScript], { cwd: dir, env: { G50C_OPEN_PR_FIXTURE: path.join(dir, 'prs.json') } });
  assert(result.status !== 0 && result.stderr.includes('pagination'), 'incomplete pagination did not fail');
});

// 14-16 manifest evidence.
test('14. missing gate evidence prevents manifest generation', () => {
  const { dir } = makeManifestRepo({ missingEvidence: true });
  const result = run(process.execPath, [manifestScript, '--evidence-dir', 'release-evidence'], { cwd: dir, env: { G50C_XCODE_BUILD_SETTINGS_FIXTURE: path.join(dir, 'xcode-settings.json') } });
  assert(result.status !== 0 && result.stderr.includes('Required evidence file missing'), 'missing evidence did not fail');
});
test('15. evidence from a different commit fails', () => {
  const { dir } = makeManifestRepo({ staleEvidence: true });
  const result = run(process.execPath, [manifestScript, '--evidence-dir', 'release-evidence'], { cwd: dir, env: { G50C_XCODE_BUILD_SETTINGS_FIXTURE: path.join(dir, 'xcode-settings.json') } });
  assert(result.status !== 0 && result.stderr.includes('another commit'), 'stale evidence did not fail');
});
test('16. manifest included PRs cannot remain empty when release range has unrepresented merges', () => {
  const { dir } = makeManifestRepo({ mergeWithoutPr: true });
  const result = run(process.execPath, [manifestScript, '--evidence-dir', 'release-evidence'], { cwd: dir, env: { G50C_XCODE_BUILD_SETTINGS_FIXTURE: path.join(dir, 'xcode-settings.json') } });
  assert(result.status !== 0 && result.stderr.includes('cannot be represented'), 'unrepresented merge did not fail');
});

// 17-20 source/dependency/xcode/bundle/no-side-effect coverage.
test('17. filesystem mtime alone cannot prove bundle freshness', () => {
  const source = read('scripts/release/verify-native-release-source.mjs');
  assert(!/mtime|mtimeMs|fileTimestamp|commitTimestamp/.test(source), 'source verifier still uses mtime freshness');
  assert(source.includes('--phase') && source.includes('Post-build source mutation'), 'source verifier does not use post-build mutation policy');
});
test('18. post-build source mutation outside generated allowlist and missing package tree fail', () => {
  const dirty = makeSourceRepo();
  write('config/release/generated-output-allowlist.json', JSON.stringify({ generated_output_paths: ['dist/**'] }), dirty.dir);
  write('src/App.jsx', 'dirty source\n', dirty.dir);
  const dirtyResult = run(process.execPath, [sourceScript, '--skip-fetch', '--phase', 'postbuild', '--policy-mode', 'release', '--approved-commit', dirty.head], { cwd: dirty.dir });
  assert(dirtyResult.status !== 0 && dirtyResult.stderr.includes('outside generated-output allowlist'), 'post-build source mutation did not fail');
  const missing = makeSourceRepo({ installed: false });
  const missingResult = run(process.execPath, [sourceScript, '--skip-fetch', '--policy-mode', 'release', '--approved-commit', missing.head], { cwd: missing.dir });
  assert(missingResult.status !== 0 && missingResult.stderr.includes('Installed dependency tree missing'), 'missing package tree did not fail');
});
test('19. inconsistent Xcode version/build settings and bundle-size regression fail', () => {
  const manifest = makeManifestRepo();
  write('bad-xcode.json', JSON.stringify({ marketing_version: '2.0.0', build_number: '3' }), manifest.dir);
  const badXcode = run(process.execPath, [manifestScript, '--evidence-dir', 'release-evidence'], { cwd: manifest.dir, env: { G50C_XCODE_BUILD_SETTINGS_FIXTURE: path.join(manifest.dir, 'bad-xcode.json') } });
  assert(badXcode.status !== 0 && badXcode.stderr.includes('Required Xcode build setting missing'), 'bad Xcode settings did not fail');
  const parity = makeParityFixture({ assetSize: 4096, budget: { max_initial_js_raw_bytes: 100, max_initial_js_gzip_bytes: 100, max_initial_js_brotli_bytes: 100, max_initial_css_raw_bytes: 100, max_initial_css_gzip_bytes: 100, max_initial_css_brotli_bytes: 100, max_single_js_chunk_raw_bytes: 100, max_single_css_chunk_raw_bytes: 100 } });
  const budgetResult = run(process.execPath, [parityScript], { cwd: parity });
  assert(budgetResult.status !== 0 && budgetResult.stderr.includes('Bundle-size budget exceeded'), 'bundle budget regression did not fail');
});
test('20. clean exact-main release evidence passes and no runtime writes/provider calls exist', () => {
  const sourceRepo = makeSourceRepo();
  const sourceResult = run(process.execPath, [sourceScript, '--skip-fetch', '--policy-mode', 'release', '--approved-commit', sourceRepo.head], { cwd: sourceRepo.dir });
  assert(sourceResult.status === 0, `clean source did not pass: ${sourceResult.stderr}`);
  const manifest = makeManifestRepo();
  const manifestResult = run(process.execPath, [manifestScript, '--evidence-dir', 'release-evidence'], { cwd: manifest.dir, env: { G50C_XCODE_BUILD_SETTINGS_FIXTURE: path.join(manifest.dir, 'xcode-settings.json') } });
  assert(manifestResult.status === 0 && manifestResult.stdout.includes('validated_evidence'), `clean manifest did not pass: ${manifestResult.stderr}`);
  const combined = ['scripts/ci/run-critical-regressions.mjs','scripts/ci/verify-diagnostic-baseline.mjs','scripts/ci/scan-tracked-secrets.mjs','scripts/release/verify-web-native-bundle-parity.mjs','scripts/release/verify-open-critical-prs.mjs','scripts/release/verify-native-release-source.mjs','scripts/release/generate-native-release-manifest.mjs'].map(read).join('\n');
  assert(!/entities\.[A-Za-z]+\.(create|update|delete|upsert)|stripe\.|shopify\.|sendNotification|Hub\.(create|update|delete)/.test(combined), 'release scripts contain runtime/provider mutation calls');
});

for (const { name, fn } of tests) {
  fn();
  console.log(`ok - ${name}`);
}

for (const file of [
  '.github/workflows/quality-gate.yml',
  '.github/workflows/native-quality-gate.yml',
  '.github/workflows/native-release-gate.yml',
  'config/release/critical-paths.json',
  'config/release/critical-pr-acknowledgements.json',
  'config/release/diagnostic-baseline.json',
  'config/release/secret-scan-allowlist.json',
  'config/release/bundle-size-budget.json',
  'config/release/generated-output-allowlist.json',
  'config/release/native-release-range.json',
  'scripts/ci/run-critical-regressions.mjs',
  'scripts/ci/scan-tracked-secrets.mjs',
  'scripts/ci/verify-diagnostic-baseline.mjs',
  'scripts/release/verify-native-release-source.mjs',
  'scripts/release/verify-open-critical-prs.mjs',
  'scripts/release/verify-web-native-bundle-parity.mjs',
  'scripts/release/generate-native-release-manifest.mjs',
  'scripts/release/write-gate-evidence.mjs'
]) assert(fs.existsSync(abs(file)), `Expected G50C file missing: ${file}`);

console.log(JSON.stringify({ ok: true, suite: 'g50c-release-source-ci-gate', tests: tests.length, writes_performed: false, provider_calls_performed: false, native_archive_created: false, app_store_upload_performed: false }, null, 2));
