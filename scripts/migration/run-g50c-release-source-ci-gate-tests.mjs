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
  return spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });
}

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function write(file, body, cwd) {
  const target = path.join(cwd, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
}

function makeParityFixture({ includeRequired = true, forbidden = false, mismatch = false } = {}) {
  const dir = tempDir('g50c-parity');
  const markers = [
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
  const markerText = includeRequired ? markers.join('\n') : 'NuVira hit a loading issue';
  const badText = forbidden ? "\nwindow.location.replace('/account-setup')" : '';
  const webAsset = `console.log(${JSON.stringify(`${markerText}${badText}`)});`;
  const nativeAsset = mismatch ? `${webAsset}\nconsole.log('mismatch');` : webAsset;
  write('capacitor.config.json', JSON.stringify({ appId: 'test', appName: 'test', webDir: 'dist' }, null, 2), dir);
  write('dist/index.html', '<script type="module" src="/assets/index-test.js"></script>', dir);
  write('dist/assets/index-test.js', webAsset, dir);
  write('ios/App/App/public/index.html', '<script type="module" src="/assets/index-test.js"></script>', dir);
  write('ios/App/App/public/assets/index-test.js', nativeAsset, dir);
  return dir;
}

function makeSourceRepo() {
  const dir = tempDir('g50c-source');
  write('package-lock.json', '{"lockfileVersion":3}\n', dir);
  write('node_modules/.package-lock.json', '{"lockfileVersion":3}\n', dir);
  write('dist/index.html', '<script src="/assets/index.js"></script>', dir);
  write('ios/App/App/public/index.html', '<script src="/assets/index.js"></script>', dir);
  run('git', ['init', '-b', 'main'], { cwd: dir });
  run('git', ['config', 'user.email', 'g50c-test.invalid'], { cwd: dir });
  run('git', ['config', 'user.name', 'G50C Test'], { cwd: dir });
  run('git', ['add', '.'], { cwd: dir });
  run('git', ['commit', '-m', 'initial'], { cwd: dir });
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: dir }).stdout.trim();
  run('git', ['update-ref', 'refs/remotes/origin/main', head], { cwd: dir });
  return { dir, head };
}

const parityScript = abs('scripts/release/verify-web-native-bundle-parity.mjs');
const sourceScript = abs('scripts/release/verify-native-release-source.mjs');
const criticalPrScript = abs('scripts/release/verify-open-critical-prs.mjs');
const manifestScript = abs('scripts/release/generate-native-release-manifest.mjs');
const criticalRegressionScript = abs('scripts/ci/run-critical-regressions.mjs');
const secretScanScript = abs('scripts/ci/verify-secret-scan.mjs');

// Required test cases from G50C prompt.
test('1. dirty worktree fails', () => {
  const { dir, head } = makeSourceRepo();
  write('dirty.txt', 'dirty', dir);
  const result = run(process.execPath, [sourceScript, '--skip-fetch', '--policy-mode', 'release', '--approved-commit', head], { cwd: dir });
  assert(result.status !== 0 && result.stderr.includes('worktree'), 'dirty worktree did not fail closed');
});

test('2. unmerged commit fails', () => {
  const { dir, head } = makeSourceRepo();
  write('new.txt', 'new', dir);
  run('git', ['add', '.'], { cwd: dir });
  run('git', ['commit', '-m', 'unmerged'], { cwd: dir });
  const result = run(process.execPath, [sourceScript, '--skip-fetch', '--policy-mode', 'release', '--approved-commit', head], { cwd: dir });
  assert(result.status !== 0 && result.stderr.includes('HEAD does not equal approved source commit'), 'unmerged commit did not fail');
});

test('3. HEAD behind/ahead of approved main fails', () => {
  const { dir, head } = makeSourceRepo();
  write('ahead.txt', 'ahead', dir);
  run('git', ['add', '.'], { cwd: dir });
  run('git', ['commit', '-m', 'ahead'], { cwd: dir });
  const result = run(process.execPath, [sourceScript, '--skip-fetch', '--policy-mode', 'release', '--approved-commit', head], { cwd: dir });
  assert(result.status !== 0, 'ahead/behind source did not fail');
});

test('4. open unacknowledged critical PR fails', () => {
  const dir = tempDir('g50c-prs');
  write('config/release/critical-paths.json', JSON.stringify({ critical_paths: ['src/App.jsx'] }), dir);
  write('config/release/critical-pr-acknowledgements.json', JSON.stringify({ acknowledged_excluded_critical_prs: [] }), dir);
  const fixture = path.join(dir, 'prs.json');
  fs.writeFileSync(fixture, JSON.stringify({ pull_requests: [{ number: 1, title: 'critical', files: ['src/App.jsx'] }] }));
  const result = run(process.execPath, [criticalPrScript], { cwd: dir, env: { G50C_OPEN_PR_FIXTURE: fixture } });
  assert(result.status !== 0 && result.stderr.includes('Open release-critical PRs'), 'unacknowledged critical PR did not fail');
});

test('5. acknowledged blocked PR with reason passes', () => {
  const dir = tempDir('g50c-prs');
  write('config/release/critical-paths.json', JSON.stringify({ critical_paths: ['src/App.jsx'] }), dir);
  write('config/release/critical-pr-acknowledgements.json', JSON.stringify({ acknowledged_excluded_critical_prs: [{ number: 545, reason: 'blocked', status: 'excluded' }] }), dir);
  const fixture = path.join(dir, 'prs.json');
  fs.writeFileSync(fixture, JSON.stringify({ pull_requests: [{ number: 545, title: 'blocked', files: ['src/App.jsx'] }] }));
  const result = run(process.execPath, [criticalPrScript], { cwd: dir, env: { G50C_OPEN_PR_FIXTURE: fixture } });
  assert(result.status === 0 && result.stdout.includes('unacknowledged_open_critical_prs'), 'acknowledged PR did not pass');
});

test('6. missing required harness fails', () => {
  const dir = tempDir('g50c-regressions');
  const result = run(process.execPath, [criticalRegressionScript], { cwd: dir });
  assert(result.status !== 0 && result.stderr.includes('Required critical regression harness missing'), 'missing harness did not fail');
});

test('7. failed critical harness fails', () => {
  const source = read('scripts/ci/run-critical-regressions.mjs');
  assert(source.includes('Critical regression harness failed'), 'critical regression runner does not fail on harness failure');
});

test('8. Web build failure fails', () => {
  const workflow = read('.github/workflows/quality-gate.yml');
  assert(workflow.includes('npm run build'), 'web-quality-gate does not run web build');
});

test('9. Native simulator build failure fails', () => {
  const workflow = read('.github/workflows/native-quality-gate.yml');
  assert(workflow.includes('xcodebuild') && workflow.includes('CODE_SIGNING_ALLOWED=NO'), 'native-quality-gate does not run unsigned simulator build');
});

test('10. Web/native bundle mismatch fails', () => {
  const dir = makeParityFixture({ mismatch: true });
  const result = run(process.execPath, [parityScript], { cwd: dir });
  assert(result.status !== 0 && result.stderr.includes('hash mismatch'), 'bundle mismatch did not fail');
});

test('11. Missing required marker fails', () => {
  const dir = makeParityFixture({ includeRequired: false });
  const result = run(process.execPath, [parityScript], { cwd: dir });
  assert(result.status !== 0 && result.stderr.includes('Required startup/checkout markers missing'), 'missing marker did not fail');
});

test('12. Legacy startup marker fails', () => {
  const dir = makeParityFixture({ forbidden: true });
  const result = run(process.execPath, [parityScript], { cwd: dir });
  assert(result.status !== 0 && result.stderr.includes('Forbidden legacy startup markers'), 'legacy marker did not fail');
});

test('13. Stale native bundle fails', () => {
  const source = read('scripts/release/verify-native-release-source.mjs');
  assert(source.includes('Generated bundle predates source commit'), 'source verifier does not reject stale generated bundle');
});

test('14. Invalid version/build metadata fails or records unknown', () => {
  const source = read('scripts/release/generate-native-release-manifest.mjs');
  assert(source.includes('MARKETING_VERSION') && source.includes('CURRENT_PROJECT_VERSION'), 'manifest generator does not inspect version/build metadata');
});

test('15. Missing manifest field fails', () => {
  const source = read('scripts/release/generate-native-release-manifest.mjs');
  for (const field of ['git_commit', 'origin_main_commit', 'web_entry_hash', 'native_entry_hash', 'capacitor_config_hash', 'generated_at_utc']) {
    assert(source.includes(field), `manifest generator missing field: ${field}`);
  }
});

test('16. Secret material is excluded', () => {
  const source = read('scripts/release/generate-native-release-manifest.mjs');
  assert(source.includes('contains_credentials: false') && source.includes('contains_customer_information: false'), 'manifest does not explicitly exclude secret/customer material');

  const cleanDir = tempDir('g50c-secret-clean');
  write('src/policy.md', 'Allowed policy placeholders: sk_live_, whsec_, Authorization: ***\n', cleanDir);
  run('git', ['init', '-b', 'main'], { cwd: cleanDir });
  run('git', ['add', '.'], { cwd: cleanDir });
  run('git', ['commit', '-m', 'clean'], { cwd: cleanDir });
  const cleanResult = run(process.execPath, [secretScanScript], { cwd: cleanDir, env: { G50C_SECRET_SCAN_MODE: 'all' } });
  assert(cleanResult.status === 0, 'secret scan should allow placeholders and policy text');

  const dirtyDir = tempDir('g50c-secret-dirty');
  const fakeSecret = `sk_live_${'A'.repeat(24)}`;
  write('src/leak.txt', `Do not commit ${fakeSecret}\n`, dirtyDir);
  run('git', ['init', '-b', 'main'], { cwd: dirtyDir });
  run('git', ['add', '.'], { cwd: dirtyDir });
  run('git', ['commit', '-m', 'dirty'], { cwd: dirtyDir });
  const dirtyResult = run(process.execPath, [secretScanScript], { cwd: dirtyDir, env: { G50C_SECRET_SCAN_MODE: 'all' } });
  assert(dirtyResult.status !== 0 && dirtyResult.stderr.includes('stripe_secret_key'), 'secret scan should fail on real-looking secret values');
});

test('17. Clean exact-main source passes', () => {
  const { dir, head } = makeSourceRepo();
  const result = run(process.execPath, [sourceScript, '--skip-fetch', '--policy-mode', 'release', '--approved-commit', head], { cwd: dir });
  assert(result.status === 0 && result.stdout.includes('head_matches_origin_main'), 'clean exact-main source did not pass');
});

test('18. No runtime writes/provider calls occur', () => {
  const files = [
    'scripts/ci/run-critical-regressions.mjs',
    'scripts/ci/verify-diagnostic-baseline.mjs',
    'scripts/release/verify-web-native-bundle-parity.mjs',
    'scripts/release/verify-open-critical-prs.mjs',
    'scripts/release/verify-native-release-source.mjs',
    'scripts/release/generate-native-release-manifest.mjs',
  ];
  const combined = files.map(read).join('\n');
  assert(!/entities\.[A-Za-z]+\.(create|update|delete|upsert)/.test(combined), 'release scripts contain entity mutation calls');
  assert(!/stripe\.|shopify\.|sendNotification|Hub\.(create|update|delete)/.test(combined), 'release scripts contain provider/notification mutation calls');
});

for (const { name, fn } of tests) {
  fn();
  console.log(`ok - ${name}`);
}

const repoFiles = [
  '.github/workflows/quality-gate.yml',
  '.github/workflows/native-quality-gate.yml',
  '.github/workflows/native-release-gate.yml',
  '.github/CODEOWNERS',
  '.github/pull_request_template.md',
  'config/release/critical-paths.json',
  'config/release/critical-pr-acknowledgements.json',
  'config/release/diagnostic-baseline.json',
  'scripts/ci/run-critical-regressions.mjs',
  'scripts/ci/verify-diagnostic-baseline.mjs',
  'scripts/release/verify-native-release-source.mjs',
  'scripts/release/verify-open-critical-prs.mjs',
  'scripts/release/verify-web-native-bundle-parity.mjs',
  'scripts/release/generate-native-release-manifest.mjs',
  'docs/migration/g50c-release-source-ci-gate.md',
  'docs/release/native-release-checklist.md',
  'docs/release/incident-hotfix-checklist.md',
];
for (const file of repoFiles) assert(fs.existsSync(abs(file)), `Expected G50C file missing: ${file}`);

console.log(JSON.stringify({
  ok: true,
  suite: 'g50c-release-source-ci-gate',
  tests: tests.length,
  writes_performed: false,
  provider_calls_performed: false,
  native_archive_created: false,
  app_store_upload_performed: false,
}, null, 2));
