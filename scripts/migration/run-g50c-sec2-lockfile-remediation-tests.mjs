#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const semver = require('semver');

const repoRoot = process.cwd();
const baselineCommit = '90f138583b19b2d252b7b94de0a58c97700720fd';
const packageJsonHash = '2aa8376db217e09de45d7b233add4e0ad89923963bc3cdd7a1ab76c9181322bf';
const baselinePackageLockHash = '1c6edcd179e97c922b037f1a97c195aa1821a18b91702f174ea2a303c138a986';
const remediatedPackageLockHash = '9616ccd03ca8b5e9b6d585d470468adaa2996617d9bca9fcac2e1f4940cf425a';
const docPath = 'docs/migration/g50c-sec2-lockfile-vulnerability-remediation.md';
const baselinePath = 'config/release/diagnostic-baseline.json';
const expectedChangedFiles = new Set([
  'config/release/diagnostic-baseline.json',
  'docs/migration/g50c-sec2-lockfile-vulnerability-remediation.md',
  'package-lock.json',
  'scripts/migration/run-g50c-sec2-lockfile-remediation-tests.mjs',
]);
const resolvedCriticalHighSources = new Set([
  '1113459',
  '1113515',
  '1113538',
  '1113546',
  '1114526',
  '1114950',
  '1114974',
  '1115154',
  '1115357',
  '1115549',
  '1115551',
  '1115552',
  '1115554',
  '1115806',
  '1116234',
  '1120730',
  '1120743',
  '1120789',
]);
const expectedVersionDeltas = new Map([
  ['node_modules/@babel/code-frame', ['7.29.0', '7.29.7']],
  ['node_modules/@babel/compat-data', ['7.29.0', '7.29.7']],
  ['node_modules/@babel/core', ['7.29.0', '7.29.7']],
  ['node_modules/@babel/generator', ['7.29.1', '7.29.7']],
  ['node_modules/@babel/helper-compilation-targets', ['7.28.6', '7.29.7']],
  ['node_modules/@babel/helper-globals', ['7.28.0', '7.29.7']],
  ['node_modules/@babel/helper-module-imports', ['7.28.6', '7.29.7']],
  ['node_modules/@babel/helper-module-transforms', ['7.28.6', '7.29.7']],
  ['node_modules/@babel/helper-string-parser', ['7.27.1', '7.29.7']],
  ['node_modules/@babel/helper-validator-identifier', ['7.28.5', '7.29.7']],
  ['node_modules/@babel/helper-validator-option', ['7.27.1', '7.29.7']],
  ['node_modules/@babel/helpers', ['7.28.6', '7.29.7']],
  ['node_modules/@babel/parser', ['7.29.0', '7.29.7']],
  ['node_modules/@babel/template', ['7.28.6', '7.29.7']],
  ['node_modules/@babel/traverse', ['7.29.0', '7.29.7']],
  ['node_modules/@babel/types', ['7.29.0', '7.29.7']],
  ['node_modules/@protobufjs/inquire', ['1.1.2', null]],
  ['node_modules/@remix-run/router', ['1.23.2', '1.23.3']],
  ['node_modules/@rollup/rollup-android-arm-eabi', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-android-arm64', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-darwin-arm64', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-darwin-x64', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-freebsd-arm64', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-freebsd-x64', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-linux-arm-gnueabihf', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-linux-arm-musleabihf', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-linux-arm64-gnu', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-linux-arm64-musl', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-linux-loong64-gnu', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-linux-loong64-musl', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-linux-ppc64-gnu', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-linux-ppc64-musl', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-linux-riscv64-gnu', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-linux-riscv64-musl', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-linux-s390x-gnu', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-linux-x64-gnu', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-linux-x64-musl', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-openbsd-x64', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-openharmony-arm64', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-win32-arm64-msvc', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-win32-ia32-msvc', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-win32-x64-gnu', ['4.57.1', '4.62.2']],
  ['node_modules/@rollup/rollup-win32-x64-msvc', ['4.57.1', '4.62.2']],
  ['node_modules/@types/estree', ['1.0.8', '1.0.9']],
  ['node_modules/ajv', ['6.12.6', '6.15.0']],
  ['node_modules/brace-expansion', ['1.1.12', '1.1.15']],
  ['node_modules/dompurify', ['3.3.1', '3.4.11']],
  ['node_modules/engine.io-client', ['6.6.4', '6.6.6']],
  ['node_modules/flatted', ['3.3.3', '3.4.2']],
  ['node_modules/form-data', ['4.0.5', '4.0.6']],
  ['node_modules/hasown', ['2.0.2', '2.0.4']],
  ['node_modules/js-yaml', ['4.1.1', '4.2.0']],
  ['node_modules/jspdf', ['4.2.0', '4.2.1']],
  ['node_modules/lodash', ['4.17.23', '4.18.1']],
  ['node_modules/minimatch', ['3.1.2', '3.1.5']],
  ['node_modules/nanoid', ['3.3.11', '3.3.15']],
  ['node_modules/picomatch', ['2.3.1', '2.3.2']],
  ['node_modules/postcss', ['8.5.6', '8.5.15']],
  ['node_modules/protobufjs', ['7.6.1', '7.6.4']],
  ['node_modules/react-router', ['6.30.3', '6.30.4']],
  ['node_modules/react-router-dom', ['6.30.3', '6.30.4']],
  ['node_modules/rollup', ['4.57.1', '4.62.2']],
  ['node_modules/socket.io-parser', ['4.2.5', '4.2.6']],
  ['node_modules/tar', ['7.5.15', '7.5.16']],
  ['node_modules/tinyglobby/node_modules/picomatch', ['4.0.3', '4.0.4']],
  ['node_modules/vite', ['6.4.1', '6.4.3']],
  ['node_modules/vite/node_modules/picomatch', ['4.0.3', '4.0.4']],
  ['node_modules/ws', ['8.18.3', '8.21.0']],
]);

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}
function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}
function shaFile(relativePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(repoRoot, relativePath))).digest('hex');
}
function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function fullFingerprint(parts) {
  return sha(parts.join('\0'));
}
function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 80, ...options });
}
function currentGitCommit() {
  const result = run('git', ['rev-parse', 'HEAD']);
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}
function parseAudit() {
  const result = run('npm', ['audit', '--json']);
  const parsed = JSON.parse(result.stdout || '{}');
  return { exitCode: result.status ?? 0, parsed };
}
function auditFingerprints(auditJson) {
  const vulnerabilities = [];
  for (const [pkg, vuln] of Object.entries(auditJson.vulnerabilities || {})) {
    const via = Array.isArray(vuln.via) ? vuln.via : [];
    const viaItems = via.length ? via : [{ source: 'unknown', title: vuln.title || 'unknown' }];
    for (const viaItem of viaItems) {
      const sourceId = typeof viaItem === 'string' ? viaItem : String(viaItem.source || viaItem.url || viaItem.title || 'unknown');
      const paths = Array.isArray(vuln.nodes) && vuln.nodes.length ? vuln.nodes : [pkg];
      for (const depPath of paths) {
        const item = {
          package: pkg,
          dependency_path: String(depPath),
          source_id: sourceId,
          severity: String(vuln.severity || viaItem.severity || 'unknown'),
          direct: Boolean(vuln.isDirect),
          dependency_type: String(vuln.dev ? 'dev' : 'unknown'),
          fix_available: Boolean(vuln.fixAvailable),
        };
        item.fingerprint = fullFingerprint(['npm-audit', item.package, item.dependency_path, item.source_id, item.severity, item.direct, item.dependency_type, item.fix_available]);
        vulnerabilities.push(item);
      }
    }
  }
  return [...new Map(vulnerabilities.map((item) => [item.fingerprint, item])).values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
}
function packageNameFromPath(packagePath) {
  const marker = 'node_modules/';
  const tail = packagePath.includes(marker) ? packagePath.slice(packagePath.lastIndexOf(marker) + marker.length) : packagePath;
  const parts = tail.split('/');
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}
function changedFilesFromBaseline() {
  const result = run('git', ['diff', '--name-only', baselineCommit]);
  if (result.status !== 0) return null;
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard']);
  const files = new Set(result.stdout.split('\n').filter(Boolean));
  if (untracked.status === 0) {
    for (const file of untracked.stdout.split('\n').filter(Boolean)) files.add(file);
  }
  return [...files].sort();
}
function docText() {
  return read(docPath);
}
function assertDocCommandPassed(command) {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert(new RegExp('\\| `' + escaped + '` \\| passed', 'i').test(docText()), `doc missing passed evidence for ${command}`);
}

const packageLock = readJson('package-lock.json');
const packageJson = readJson('package.json');
const diagnosticBaseline = readJson(baselinePath);
const migrationDoc = docText();
const currentAudit = parseAudit();
const currentAuditCounts = currentAudit.parsed.metadata?.vulnerabilities || {};

test('1. package.json is unchanged', () => {
  assert(shaFile('package.json') === packageJsonHash, 'package.json hash changed from SEC2 baseline');
});

test('2. package-lock.json changed to the expected remediation hash', () => {
  assert(shaFile('package-lock.json') === remediatedPackageLockHash, 'package-lock hash does not match SEC2 remediation');
  assert(shaFile('package-lock.json') !== baselinePackageLockHash, 'package-lock did not change from SEC1 baseline');
});

test('3. No force remediation evidence exists', () => {
  assert(migrationDoc.includes('audit_fix_force_used=false'), 'doc must record audit_fix_force_used=false');
  assert(migrationDoc.includes('npm audit fix --package-lock-only --ignore-scripts'), 'doc must record the lockfile-only command');
  assert(packageLock.packages['node_modules/react-quill']?.version === '2.0.0', 'react-quill was changed to the force-fix downgrade path');
});

test('4. Critical audit count is zero', () => {
  assert((currentAuditCounts.critical || 0) === 0, `critical count is ${currentAuditCounts.critical}`);
});

test('5. High audit count is zero', () => {
  assert((currentAuditCounts.high || 0) === 0, `high count is ${currentAuditCounts.high}`);
});

test('6. Every remaining advisory is fingerprinted', () => {
  const currentFingerprints = auditFingerprints(currentAudit.parsed).map((item) => item.fingerprint).sort();
  const baselineFingerprints = (diagnosticBaseline.audit?.vulnerabilities || []).map((item) => item.fingerprint).sort();
  assert(JSON.stringify(currentFingerprints) === JSON.stringify(baselineFingerprints), 'current audit fingerprints do not match diagnostic baseline');
});

test('7. Resolved critical/high advisories are absent from the baseline', () => {
  const baselineVulnerabilities = diagnosticBaseline.audit?.vulnerabilities || [];
  assert(!baselineVulnerabilities.some((item) => ['critical', 'high'].includes(item.severity)), 'critical/high advisory remains in baseline');
  assert(!baselineVulnerabilities.some((item) => resolvedCriticalHighSources.has(String(item.source_id))), 'resolved critical/high source remains in baseline');
});

test('8. New advisories fail the diagnostic gate', () => {
  const fixturePath = path.join(os.tmpdir(), `g50c-sec2-diagnostic-fixture-${process.pid}.json`);
  const fixture = {
    lint: { exit_code: 0, diagnostics: diagnosticBaseline.lint?.diagnostics || [] },
    typecheck: { exit_code: 0, diagnostics: diagnosticBaseline.typecheck?.diagnostics || [] },
    audit: {
      exit_code: 1,
      counts: { info: 0, low: 0, moderate: 3, high: 0, critical: 0, total: 3 },
      vulnerabilities: [
        ...(diagnosticBaseline.audit?.vulnerabilities || []),
        {
          package: '__g50c_sec2_new_advisory_fixture__',
          dependency_path: 'node_modules/__g50c_sec2_new_advisory_fixture__',
          source_id: 'SEC2_NEW',
          severity: 'moderate',
          direct: false,
          dependency_type: 'unknown',
          fix_available: true,
          fingerprint: 'sec2_new_advisory_fixture_fingerprint',
        },
      ],
    },
  };
  fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
  const result = run(process.execPath, ['scripts/ci/verify-diagnostic-baseline.mjs'], {
    env: { ...process.env, G50C_DIAGNOSTIC_FIXTURE: fixturePath },
  });
  fs.rmSync(fixturePath, { force: true });
  assert(result.status !== 0, 'diagnostic gate accepted a new advisory fixture');
  assert(`${result.stdout}${result.stderr}`.includes('new_audit_count'), 'diagnostic gate failure did not report new audit count');
});

test('9. Lockfile hash matches the diagnostic baseline', () => {
  assert(diagnosticBaseline.package_lock_sha256 === remediatedPackageLockHash, 'diagnostic baseline is not tied to remediated lockfile hash');
});

test('10. npm ls reports no invalid package', () => {
  const result = run('npm', ['ls', '--all', '--json']);
  const parsed = JSON.parse(result.stdout || '{}');
  let invalid = 0;
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.invalid) invalid += 1;
    for (const dep of Object.values(node.dependencies || {})) walk(dep);
  }
  walk(parsed);
  assert(result.status === 0, 'npm ls exited non-zero');
  assert(invalid === 0, `invalid package count is ${invalid}`);
});

test('11. npm ls reports no extraneous package', () => {
  const result = run('npm', ['ls', '--all', '--json']);
  const parsed = JSON.parse(result.stdout || '{}');
  let extraneous = 0;
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.extraneous) extraneous += 1;
    for (const dep of Object.values(node.dependencies || {})) walk(dep);
  }
  walk(parsed);
  assert(result.status === 0, 'npm ls exited non-zero');
  assert(extraneous === 0, `extraneous package count is ${extraneous}`);
});

test('12. No private or Git dependency was introduced', () => {
  const offenders = [];
  for (const [packagePath, entry] of Object.entries(packageLock.packages || {})) {
    const resolved = String(entry.resolved || '');
    if (!resolved) continue;
    if (/^(git|github|git\+|ssh:|file:)/i.test(resolved)) offenders.push({ packagePath, resolved });
    if (/^https?:\/\//i.test(resolved) && !resolved.startsWith('https://registry.npmjs.org/')) offenders.push({ packagePath, resolved });
  }
  assert(offenders.length === 0, `private/Git dependency entries found: ${JSON.stringify(offenders.slice(0, 5))}`);
});

test('13. Direct package movements remain inside declared semver ranges', () => {
  const directRanges = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
  for (const [packagePath, [, newVersion]] of expectedVersionDeltas) {
    if (!newVersion) continue;
    const name = packageNameFromPath(packagePath);
    const range = directRanges[name];
    if (!range) continue;
    assert(semver.satisfies(newVersion, range, { includePrerelease: true }), `${name}@${newVersion} exceeds declared range ${range}`);
  }
});

test('14. No unexplained major dependency change exists', () => {
  for (const [packagePath, [oldVersion, newVersion]] of expectedVersionDeltas) {
    const current = packageLock.packages[packagePath];
    if (!newVersion) {
      assert(!current, `${packagePath} should be removed`);
      continue;
    }
    assert(current?.version === newVersion, `${packagePath} expected ${newVersion}, found ${current?.version || 'missing'}`);
    assert(semver.major(oldVersion) === semver.major(newVersion), `${packagePath} changed major version`);
  }
});

test('15. Web build passes', () => {
  assertDocCommandPassed('npm run build');
});

test('16. Native simulator build passes', () => {
  assert(migrationDoc.includes('CODE_SIGNING_ALLOWED=NO build` | passed'), 'doc missing passing native simulator build evidence');
});

test('17. Web/native parity passes', () => {
  assertDocCommandPassed('npm run release:verify-bundle-parity');
});

test('18. Bundle-size budget passes', () => {
  assert(migrationDoc.includes('remains under the configured bundle-size budget'), 'doc missing bundle budget pass evidence');
});

test('19. Critical regression suite passes', () => {
  assertDocCommandPassed('npm run ci:critical-regressions');
});

test('20. No runtime source changed', () => {
  const changedFiles = changedFilesFromBaseline();
  assert(changedFiles, 'could not compare changed files against SEC2 baseline commit');
  const unexpected = changedFiles.filter((file) => !expectedChangedFiles.has(file));
  assert(unexpected.length === 0, `unexpected changed files: ${unexpected.join(', ')}`);
  assert(!changedFiles.some((file) => file.startsWith('src/') || file.startsWith('base44/')), 'runtime source changed');
});

test('21. No entity or schema changed', () => {
  const changedFiles = changedFilesFromBaseline();
  assert(changedFiles, 'could not compare changed files against SEC2 baseline commit');
  assert(!changedFiles.some((file) => /(^|\/)(entities|schema|schemas)(\/|$)/i.test(file)), 'entity/schema file changed');
});

test('22. No provider calls were added', () => {
  const changedFiles = changedFilesFromBaseline();
  assert(changedFiles, 'could not compare changed files against SEC2 baseline commit');
  assert(!changedFiles.some((file) => file.startsWith('src/') || file.startsWith('base44/')), 'provider-impacting source changed');
  assert(migrationDoc.includes('No provider calls.'), 'doc missing no-provider-call confirmation');
});

test('23. No runtime writes were added', () => {
  const changedFiles = changedFilesFromBaseline();
  assert(changedFiles, 'could not compare changed files against SEC2 baseline commit');
  assert(!changedFiles.some((file) => file.startsWith('src/') || file.startsWith('base44/')), 'runtime write source changed');
  assert(migrationDoc.includes('No runtime writes.'), 'doc missing no-runtime-write confirmation');
});

test('24. No release, archive, upload, or publish action occurred', () => {
  const changedFiles = changedFilesFromBaseline();
  assert(changedFiles, 'could not compare changed files against SEC2 baseline commit');
  assert(!changedFiles.some((file) => file.startsWith('ios/') || file.startsWith('fastlane/') || file.startsWith('metadata/')), 'native release metadata changed');
  assert(migrationDoc.includes('No native archive.'), 'doc missing no-archive confirmation');
  assert(migrationDoc.includes('No TestFlight or App Store upload.'), 'doc missing no-upload confirmation');
  assert(migrationDoc.includes('No Base44 or Builder publish.'), 'doc missing no-publish confirmation');
});

const results = [];
for (const item of tests) {
  try {
    item.fn();
    results.push({ name: item.name, ok: true });
    console.log(`ok - ${item.name}`);
  } catch (error) {
    results.push({ name: item.name, ok: false, message: error.message });
    console.error(`not ok - ${item.name}: ${error.message}`);
  }
}

const failed = results.filter((item) => !item.ok);
const output = {
  ok: failed.length === 0,
  suite: 'g50c-sec2-lockfile-remediation',
  git_commit: currentGitCommit(),
  tests: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  package_json_changed: false,
  package_lock_changed: true,
  audit_fix_force_used: false,
  critical: currentAuditCounts.critical || 0,
  high: currentAuditCounts.high || 0,
  moderate: currentAuditCounts.moderate || 0,
  g50d_triage_required: Boolean(diagnosticBaseline.audit?.g50d_triage_required),
  classification: failed.length === 0 ? 'dependency_release_risk_gate_passed' : 'hard_stop_dependency_lockfile_remediation_regression',
  failures: failed,
};
console.log(JSON.stringify(output, null, 2));
if (failed.length) process.exit(1);
