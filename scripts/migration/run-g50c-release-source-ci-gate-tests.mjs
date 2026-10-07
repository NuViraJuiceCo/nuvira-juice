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
function makeProvenanceFixture() {
  const dir = tempDir('g50c-provenance');
  makePackage(dir);
  write('dist/index.html', '<script type="module" src="/assets/index-approved.js"></script>', dir);
  write('dist/assets/index-approved.js', 'console.log("approved")\n', dir);
  write('capacitor.config.json', JSON.stringify({
    appId: 'com.example.app',
    appName: 'Example',
    webDir: 'dist',
    plugins: {
      LiveUpdates: {
        appId: 'appflow-example',
        channel: 'Production',
        autoUpdateMethod: 'none',
      },
    },
  }, null, 2), dir);
  initGit(dir);
  const head = commitAll(dir, 'approved release');
  return { dir, head, observedAt: new Date().toISOString() };
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
const provenanceScript = abs('scripts/release/verify-deployment-provenance.mjs');

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
test('16b. current PR validation can represent a branch-local merge commit', () => {
  const { dir } = makeManifestRepo({ mergeWithoutPr: true });
  const result = run(process.execPath, [manifestScript, '--evidence-dir', 'release-evidence'], {
    cwd: dir,
    env: {
      G50C_XCODE_BUILD_SETTINGS_FIXTURE: path.join(dir, 'xcode-settings.json'),
      G50C_CURRENT_PR_NUMBER: '585',
    },
  });
  assert(result.status === 0, `current PR merge representation failed: ${result.stderr}`);
  const manifest = JSON.parse(result.stdout);
  const representedMerge = manifest.included_prs.find((item) => item.number === 585);
  assert(representedMerge?.current_pr_validation_branch_merge === true, 'current PR branch merge marker missing');
});
test('16c. explicit historical mapping passes push context without changing the release baseline', () => {
  const { dir, head, previous } = makeManifestRepo({ mergeWithoutPr: true });
  const inputPath = 'config/release/native-release-range.json';
  const input = JSON.parse(fs.readFileSync(path.join(dir, inputPath), 'utf8'));
  input.included_prs = [{ number: 804, merge_commit: head, title: 'Audited historical internal merge' }];
  write(inputPath, JSON.stringify(input, null, 2), dir);
  const result = run(process.execPath, [manifestScript, '--evidence-dir', 'release-evidence'], {
    cwd: dir,
    env: {
      G50C_XCODE_BUILD_SETTINGS_FIXTURE: path.join(dir, 'xcode-settings.json'),
      G50C_CURRENT_PR_NUMBER: '',
      GITHUB_EVENT_PATH: '',
      G50C_RELEASE_RANGE_HEAD: head,
    },
  });
  assert(result.status === 0, `explicit push mapping failed: ${result.stderr}`);
  const manifest = JSON.parse(result.stdout);
  assert(manifest.previous_released_commit === previous, 'historical mapping changed the release baseline');
  assert(manifest.included_prs.length === 1, 'historical merge was omitted from the release range');
  assert(manifest.included_prs[0].number === 804 && manifest.included_prs[0].merge_commit === head, 'explicit historical PR attribution was lost');
  assert(!manifest.included_prs[0].current_pr_validation_branch_merge, 'push mapping incorrectly relied on current-PR fallback');
});
test('16d. explicit historical mapping keeps its original PR in current-PR validation', () => {
  const { dir, head } = makeManifestRepo({ mergeWithoutPr: true });
  const inputPath = 'config/release/native-release-range.json';
  const input = JSON.parse(fs.readFileSync(path.join(dir, inputPath), 'utf8'));
  input.included_prs = [{ number: 804, merge_commit: head, title: 'Audited historical internal merge' }];
  write(inputPath, JSON.stringify(input, null, 2), dir);
  const result = run(process.execPath, [manifestScript, '--evidence-dir', 'release-evidence'], {
    cwd: dir,
    env: {
      G50C_XCODE_BUILD_SETTINGS_FIXTURE: path.join(dir, 'xcode-settings.json'),
      G50C_CURRENT_PR_NUMBER: '809',
      GITHUB_EVENT_PATH: '',
      G50C_RELEASE_RANGE_HEAD: head,
    },
  });
  assert(result.status === 0, `explicit PR mapping failed: ${result.stderr}`);
  const manifest = JSON.parse(result.stdout);
  assert(manifest.included_prs[0].number === 804, 'historical merge was incorrectly relabeled as the current PR');
  assert(!manifest.included_prs[0].current_pr_validation_branch_merge, 'historical explicit mapping used current-PR fallback');
});
test('16e. an unrelated explicit mapping does not waive an unrepresented merge in push context', () => {
  const { dir, head } = makeManifestRepo({ mergeWithoutPr: true });
  const inputPath = 'config/release/native-release-range.json';
  const input = JSON.parse(fs.readFileSync(path.join(dir, inputPath), 'utf8'));
  input.included_prs = [{ number: 804, merge_commit: '0'.repeat(40), title: 'Unrelated merge' }];
  write(inputPath, JSON.stringify(input, null, 2), dir);
  const result = run(process.execPath, [manifestScript, '--evidence-dir', 'release-evidence'], {
    cwd: dir,
    env: {
      G50C_XCODE_BUILD_SETTINGS_FIXTURE: path.join(dir, 'xcode-settings.json'),
      G50C_CURRENT_PR_NUMBER: '',
      GITHUB_EVENT_PATH: '',
      G50C_RELEASE_RANGE_HEAD: head,
    },
  });
  assert(result.status !== 0, 'unrepresented merge was allowed by an unrelated mapping');
  const failure = JSON.parse(result.stderr);
  assert(failure.message.includes('cannot be represented') && failure.unrepresented?.[0]?.merge_commit === head, 'failure did not identify the actual unmapped historical merge');
});
test('16f. audited historical mappings retain traceable containing-PR ancestry', () => {
  const input = JSON.parse(read('config/release/native-release-range.json'));
  const expectedMappings = [
    { number: 808, merge_commit: '306a8dbfda4f456a3d486c4ad9608ffa8ab662cd', head: '306a8dbfda4f456a3d486c4ad9608ffa8ab662cd', merged: 'cbb224c81197dd5efd141c968e6d195bd9212522' },
    { number: 805, merge_commit: '60463a3442663901642883ea64cb3e1fdb61219c', head: '4f07088b388cddbaf1b47df47925d4022ceb5049', merged: 'b0127bdca0c1de2127b41966e2203571346eeecf' },
    { number: 804, merge_commit: '8bc2dcf0236107ac6f8a7b244cfa5f98e7abc610', head: '8bc2dcf0236107ac6f8a7b244cfa5f98e7abc610', merged: 'c16a90d5f2b243817559e48c746b4fb36d9d0f06' },
  ];
  for (const expected of expectedMappings) {
    const records = input.included_prs.filter((item) => item.merge_commit === expected.merge_commit);
    assert(records.length === 1, `historical merge mapping missing or duplicated: ${expected.merge_commit}`);
    const record = records[0];
    assert(record.number === expected.number, `incorrect historical PR for ${expected.merge_commit}`);
    assert(record.source_pr_url === `https://github.com/NuViraJuiceCo/nuvira-juice/pull/${expected.number}`, 'historical PR URL mismatch');
    assert(record.source_pr_head_commit === expected.head && record.source_pr_merge_commit === expected.merged, 'historical PR source identity mismatch');
    const merge = run('git', ['show', '-s', '--format=%P%n%s', record.source_pr_merge_commit]);
    assert(merge.status === 0, `missing historical PR merge object: ${record.source_pr_merge_commit}`);
    const [parentLine, subject] = merge.stdout.trim().split('\n');
    const parents = parentLine.split(' ');
    assert(parents.length === 2 && parents[1] === record.source_pr_head_commit, 'historical PR head is not the recorded merge second parent');
    assert(subject.startsWith(`Merge pull request #${record.number} `), 'recorded containing merge does not identify its PR');
    assert(run('git', ['merge-base', '--is-ancestor', record.merge_commit, parents[1]]).status === 0, 'internal merge is not contained in the recorded PR head');
    assert(run('git', ['merge-base', '--is-ancestor', record.merge_commit, parents[0]]).status === 1, 'internal merge was already in main before the recorded PR');
  }
});

test('16g. PR 810 integration mapping pins its observed open-PR head and exact parents', () => {
  const inputPath = 'config/release/native-release-range.json';
  const input = JSON.parse(read(inputPath));
  const integration = 'b60d465c3ea68b95648a21bdd4f25305f5aaed8c';
  const expected = {
    number: 810,
    merge_commit: integration,
    title: 'Represent the PR #810 branch integration of released browser sign-in fixes',
    source_pr_url: 'https://github.com/NuViraJuiceCo/nuvira-juice/pull/810',
    source_pr_head_commit: integration,
    integration_parent_commits: ['2dc3ae7538215d5c141a203a810e0ca322bbb2f8', 'dec1d650d1d2b4cbe4d063f30171aae4a7a4cb40'],
  };
  const records = input.included_prs.filter((item) => item.merge_commit === integration);
  assert(records.length === 1, 'PR 810 integration mapping missing or duplicated');
  assert(Object.keys(records[0]).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => JSON.stringify(records[0][key]) === JSON.stringify(value)), 'PR 810 integration record differs from verified open-PR evidence');
  assert(!Object.hasOwn(records[0], 'source_pr_merge_commit'), 'open PR integration must not invent a containing PR merge');
  const parents = run('git', ['show', '-s', '--format=%P', integration]);
  assert(parents.status === 0 && parents.stdout.trim() === expected.integration_parent_commits.join(' '), 'PR 810 actual integration parents differ from recorded evidence');
  for (const parent of expected.integration_parent_commits) {
    assert(run('git', ['merge-base', '--is-ancestor', parent, records[0].source_pr_head_commit]).status === 0, 'integration parent is not contained in the observed PR 810 head');
  }
  assert(run('git', ['merge-base', '--is-ancestor', integration, 'HEAD']).status === 0, 'PR 810 integration is not contained in current source');
  const original = run('git', ['show', `${integration}:${inputPath}`]);
  assert(original.status === 0, 'pre-mapping release input is unavailable');
  const baseline = JSON.parse(original.stdout).previous_released_commit;
  assert(baseline === 'e1dcdc5f2adcc788251c0f1dbd33fe3e932397aa' && input.previous_released_commit === baseline, 'integration mapping changed the previous released baseline');
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
  const combined = ['scripts/ci/run-critical-regressions.mjs','scripts/ci/verify-diagnostic-baseline.mjs','scripts/ci/scan-tracked-secrets.mjs','scripts/release/verify-web-native-bundle-parity.mjs','scripts/release/verify-deployment-provenance.mjs','scripts/release/verify-open-critical-prs.mjs','scripts/release/verify-native-release-source.mjs','scripts/release/generate-native-release-manifest.mjs'].map(read).join('\n');
  assert(!/entities\.[A-Za-z]+\.(create|update|delete|upsert)|stripe\.|shopify\.|sendNotification|Hub\.(create|update|delete)/.test(combined), 'release scripts contain runtime/provider mutation calls');
});

// 21-25 deployment provenance and manifest enforcement.
test('21. matching Base44 and active Appflow commits pass deployment provenance', () => {
  const fixture = makeProvenanceFixture();
  const result = run(process.execPath, [
    provenanceScript,
    '--approved-commit', fixture.head,
    '--base44-deployment-id', 'deployment-123',
    '--base44-commit', fixture.head,
    '--base44-entry-asset', 'index-approved.js',
    '--base44-observed-at', fixture.observedAt,
    '--appflow-build-id', '987654',
    '--appflow-commit', fixture.head,
    '--appflow-status', 'active',
    '--appflow-observed-at', fixture.observedAt,
  ], { cwd: fixture.dir });
  assert(result.status === 0 && result.stdout.includes('one_approved_commit'), `matching provenance did not pass: ${result.stderr}`);
});
test('22. stale Appflow commit blocks deployment provenance', () => {
  const fixture = makeProvenanceFixture();
  const staleCommit = '0'.repeat(40);
  const result = run(process.execPath, [
    provenanceScript,
    '--approved-commit', fixture.head,
    '--base44-deployment-id', 'deployment-123',
    '--base44-commit', fixture.head,
    '--base44-entry-asset', 'index-approved.js',
    '--base44-observed-at', fixture.observedAt,
    '--appflow-build-id', '987654',
    '--appflow-commit', staleCommit,
    '--appflow-status', 'active',
    '--appflow-observed-at', fixture.observedAt,
  ], { cwd: fixture.dir });
  assert(result.status !== 0 && result.stderr.includes('Appflow Production commit does not match'), 'stale Appflow commit did not fail');
});
test('23. stale Base44 commit blocks deployment provenance', () => {
  const fixture = makeProvenanceFixture();
  const result = run(process.execPath, [
    provenanceScript,
    '--approved-commit', fixture.head,
    '--base44-deployment-id', 'deployment-123',
    '--base44-commit', '0'.repeat(40),
    '--base44-entry-asset', 'index-approved.js',
    '--base44-observed-at', fixture.observedAt,
    '--appflow-build-id', '987654',
    '--appflow-commit', fixture.head,
    '--appflow-status', 'active',
    '--appflow-observed-at', fixture.observedAt,
  ], { cwd: fixture.dir });
  assert(result.status !== 0 && result.stderr.includes('Base44 deployment commit does not match'), 'stale Base44 commit did not fail');
});
test('24. stale channel observation blocks deployment provenance', () => {
  const fixture = makeProvenanceFixture();
  const staleObservedAt = '2020-01-01T00:00:00.000Z';
  const result = run(process.execPath, [
    provenanceScript,
    '--approved-commit', fixture.head,
    '--base44-deployment-id', 'deployment-123',
    '--base44-commit', fixture.head,
    '--base44-entry-asset', 'index-approved.js',
    '--base44-observed-at', staleObservedAt,
    '--appflow-build-id', '987654',
    '--appflow-commit', fixture.head,
    '--appflow-status', 'active',
    '--appflow-observed-at', fixture.observedAt,
  ], { cwd: fixture.dir });
  assert(result.status !== 0 && result.stderr.includes('is stale'), 'stale channel observation did not fail');
});
test('25. release manifest can require deployment provenance evidence', () => {
  const fixture = makeManifestRepo();
  const result = run(process.execPath, [manifestScript, '--require-deployment-provenance', '--evidence-dir', 'release-evidence'], {
    cwd: fixture.dir,
    env: { G50C_XCODE_BUILD_SETTINGS_FIXTURE: path.join(fixture.dir, 'xcode-settings.json') },
  });
  assert(result.status !== 0 && result.stderr.includes('deployment-provenance.json'), 'required deployment provenance was not enforced');
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
  'scripts/release/verify-deployment-provenance.mjs',
  'scripts/release/generate-native-release-manifest.mjs',
  'scripts/release/write-gate-evidence.mjs'
]) assert(fs.existsSync(abs(file)), `Expected G50C file missing: ${file}`);

console.log(JSON.stringify({ ok: true, suite: 'g50c-release-source-ci-gate', tests: tests.length, writes_performed: false, provider_calls_performed: false, native_archive_created: false, app_store_upload_performed: false }, null, 2));
