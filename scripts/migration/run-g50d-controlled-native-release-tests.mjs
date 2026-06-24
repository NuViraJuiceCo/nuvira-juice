#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(repoRoot, relativePath));
const run = (command, args, options = {}) => spawnSync(command, args, {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
  ...options,
});

function git(args, options = {}) {
  const result = run('git', args, options);
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

const head = git(['rev-parse', 'HEAD']);
const originMain = git(['rev-parse', 'origin/main']);
assert.equal(originMain, '90d0104f65e764a04b69533bda2560e6dc9bdeb9', 'origin/main is not the approved G50D baseline');

const project = read('ios/App/App.xcodeproj/project.pbxproj');
const docPath = 'docs/migration/g50d-controlled-native-startup-hotfix-release.md';
const doc = read(docPath);

const marketingMatches = [...project.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((match) => match[1]);
const buildMatches = [...project.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map((match) => match[1]);
assert.deepEqual(marketingMatches, ['2.117907.0', '2.117907.0'], 'MARKETING_VERSION must be 2.117907.0 in both Release/Debug settings');
assert.deepEqual(buildMatches, ['22', '22'], 'CURRENT_PROJECT_VERSION must be 22 in both Release/Debug settings');
assert.equal((project.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.base69d48d0c39891f7945481152\.app;/g) || []).length, 2, 'bundle identifier changed or is missing');

const changedFiles = git(['diff', '--name-only', 'origin/main...HEAD'], { allowFailure: true })
  .split('\n')
  .filter(Boolean)
  .sort();
const unstagedFiles = git(['diff', '--name-only'], { allowFailure: true })
  .split('\n')
  .filter(Boolean);
const stagedFiles = git(['diff', '--cached', '--name-only'], { allowFailure: true })
  .split('\n')
  .filter(Boolean);
const statusResult = run('git', ['status', '--porcelain=v1']);
if (statusResult.status !== 0) throw new Error(`git status --porcelain=v1 failed: ${statusResult.stderr || statusResult.stdout}`);
const statusFiles = statusResult.stdout
  .split('\n')
  .filter(Boolean)
  .map((line) => line.slice(3).trim())
  .map((file) => file.includes(' -> ') ? file.split(' -> ').at(-1) : file)
  .filter(Boolean);
const worktreeFiles = [...new Set([...changedFiles, ...unstagedFiles, ...stagedFiles, ...statusFiles])].sort();

const allowedFiles = new Set([
  'docs/migration/g50d-controlled-native-startup-hotfix-release.md',
  'ios/App/App.xcodeproj/project.pbxproj',
  'scripts/migration/run-g50d-controlled-native-release-tests.mjs',
]);
const disallowed = worktreeFiles.filter((file) => !allowedFiles.has(file));
assert.deepEqual(disallowed, [], `G50D metadata branch touched disallowed files: ${disallowed.join(', ')}`);

const forbiddenPrefixes = ['src/', 'base44/', 'ios/App/App/public/', 'ios/App/CapApp-SPM/', '.github/'];
const forbiddenExact = ['package.json', 'package-lock.json', 'capacitor.config.json'];
for (const file of worktreeFiles) {
  assert(!forbiddenPrefixes.some((prefix) => file.startsWith(prefix)), `forbidden runtime/generated path changed: ${file}`);
  assert(!forbiddenExact.includes(file), `forbidden dependency/config file changed: ${file}`);
}

const requiredDocPhrases = [
  'main_commit=90d0104f65e764a04b69533bda2560e6dc9bdeb9',
  'current_main_marketing_version=2.117906.0',
  'current_main_build_number=21',
  'app_store_current_version=2.117906.0',
  'proposed_marketing_version=2.117907.0',
  'proposed_build_number=22',
  'G50B startup hotfix',
  'G49A checkout processing protection',
  'critical_vulnerabilities=0',
  'high_vulnerabilities=0',
  'moderate_vulnerabilities=2',
  'g50d_triage_required=false',
  'https://github.com/NuViraJuiceCo/nuvira-juice/issues/571',
  'web_native_bundle_parity=true',
  'release_archive_created=false',
  'app_store_upload_performed=false',
  'upgrade install over the current App Store build',
  'clean install',
  'manual_release_enabled=true',
  'automatic_release_enabled=false',
  'website checkout remains the immediate customer fallback',
  'No-payment / no-write confirmation',
  'native_startup_hotfix_metadata_pr_ready',
];
for (const phrase of requiredDocPhrases) {
  assert(doc.includes(phrase), `${docPath} missing required phrase: ${phrase}`);
}

const forbiddenRuntimeMarkers = [
  "window.location.replace('/account-setup')",
  'scheduleAutomaticRecovery',
  'MAX_IMMEDIATE_RECOVERY_ATTEMPTS',
  'native_reopen',
  'automatic storage-clear/reload loop',
  'unsafe client-secret or PaymentIntent logging',
];
const sourceFiles = [
  'src/App.jsx',
  'src/components/AppErrorBoundary.jsx',
  'src/lib/AuthContext.jsx',
  'src/lib/nativeAuthRedirect.js',
  'src/pages/Checkout.jsx',
];
for (const file of sourceFiles) {
  assert(exists(file), `expected runtime file missing: ${file}`);
}
const app = read('src/App.jsx');
const boundary = read('src/components/AppErrorBoundary.jsx');
const redirect = read('src/lib/nativeAuthRedirect.js');
const checkout = read('src/pages/Checkout.jsx');
assert(!app.includes("window.location.replace('/account-setup')"), 'render-time account setup hard redirect returned');
assert(!boundary.includes('scheduleAutomaticRecovery'), 'automatic recovery scheduler returned');
assert(!boundary.includes('MAX_IMMEDIATE_RECOVERY_ATTEMPTS'), 'repeated recovery counter returned');
assert(!boundary.includes('native_reopen'), 'native reopen auto-recovery marker returned');
assert(boundary.includes('Try Again'), 'G50B Try Again copy missing');
assert(boundary.includes('Return Home'), 'G50B Return Home copy missing');
assert(boundary.includes('Reset Sign-In'), 'G50B Reset Sign-In copy missing');
assert(redirect.includes("params.set('reset_sign_in', '1')"), 'G50B reset_sign_in marker missing');
assert(redirect.includes('SIGN_IN_RESET_LOGOUT_TIMEOUT_MS = 4000'), 'G50B bounded logout timeout missing');
assert(checkout.includes('PAYMENT_ATTEMPT_STATE_UNKNOWN'), 'G49A unknown payment-attempt marker missing');
assert(checkout.includes('Still checking your checkout'), 'G49A ambiguous checkout copy missing');
assert(!checkout.includes('clientSecret prefix'), 'unsafe client-secret logging marker returned');
assert(!checkout.includes('PaymentIntent ID'), 'unsafe PaymentIntent logging marker returned');

for (const marker of forbiddenRuntimeMarkers) {
  assert(doc.includes(marker) || !project.includes(marker), `forbidden marker unexpectedly present in metadata project: ${marker}`);
}

console.log(JSON.stringify({
  ok: true,
  suite: 'g50d-controlled-native-startup-hotfix-release',
  git_commit: head,
  origin_main: originMain,
  marketing_version: '2.117907.0',
  build_number: '22',
  changed_files: worktreeFiles,
  runtime_source_changed: false,
  package_json_changed: false,
  package_lock_changed: false,
  capacitor_config_changed: false,
  base44_changed: false,
  archive_created: false,
  app_store_upload_performed: false,
  classification: 'native_startup_hotfix_metadata_pr_ready',
}, null, 2));
