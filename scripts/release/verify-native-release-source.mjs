#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const args = process.argv.slice(2);
const argValue = (name, fallback = null) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
};
const policyMode = argValue('--policy-mode', 'release');
const approvedArg = argValue('--approved-commit');
const outPath = argValue('--out');
const phase = argValue('--phase', 'prebuild');
const skipFetch = args.includes('--skip-fetch');

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 50, ...options });
  if (result.status !== 0 && !options.allowFailure) throw new Error(`${command} ${commandArgs.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result;
}
function git(commandArgs, options = {}) { return run('git', commandArgs, options).stdout.trim(); }
function shaFile(relativePath) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(repoRoot, relativePath))).digest('hex'); }
function writeEvidence(result) {
  if (!outPath) return;
  const absolute = path.resolve(repoRoot, outPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(result, null, 2)}\n`);
}
function fail(message, extra = {}) {
  const result = { ok: false, suite: 'g50c-native-release-source', git_commit: safeHead(), generated_at_utc: new Date().toISOString(), message, policy_mode: policyMode, phase, ...extra };
  writeEvidence(result);
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
function safeHead() { try { return git(['rev-parse', 'HEAD']); } catch { return 'unknown'; } }
function loadGeneratedAllowlist() {
  const p = path.join(repoRoot, 'config/release/generated-output-allowlist.json');
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8')).generated_output_paths || [];
}
function patternMatches(file, pattern) {
  if (pattern.endsWith('/**')) return file.startsWith(pattern.slice(0, -3));
  if (pattern.includes('**')) {
    const escaped = pattern.split('**').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${escaped}$`).test(file);
  }
  return file === pattern;
}
function statusEntries() {
  const status = git(['status', '--porcelain=v1']);
  if (!status) return [];
  return status.split('\n').filter(Boolean).map((line) => ({ code: line.slice(0, 2), path: line.slice(3) }));
}
function assertCleanWorktree() {
  const entries = statusEntries();
  if (entries.length) fail('Git worktree is not clean', { status: entries });
}
function assertPostBuildSourceClean() {
  const entries = statusEntries();
  if (!entries.length) return { clean: true, generated_changes: [] };
  const patterns = loadGeneratedAllowlist();
  const disallowed = entries.filter((entry) => !patterns.some((pattern) => patternMatches(entry.path, pattern)));
  if (disallowed.length) fail('Post-build source mutation outside generated-output allowlist', { disallowed, generated_output_allowlist: patterns, all_changes: entries });
  return { clean: false, generated_changes: entries, generated_output_allowlist: patterns };
}
function assertNoGitOperationInProgress() {
  const gitDir = git(['rev-parse', '--git-dir']);
  const markers = ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'];
  const active = markers.filter((marker) => fs.existsSync(path.join(repoRoot, gitDir, marker)));
  if (active.length) fail('Git merge/rebase/cherry-pick/revert operation is in progress', { active });
}
function verifyPackageLockInstalledTree() {
  if (!fs.existsSync(path.join(repoRoot, 'package-lock.json'))) fail('package-lock.json is missing');
  if (!fs.existsSync(path.join(repoRoot, 'node_modules/.package-lock.json'))) fail('Installed dependency tree missing; run npm ci before release verification');
  const lockHashBefore = shaFile('package-lock.json');
  const npmLs = run('npm', ['ls', '--all', '--json'], { allowFailure: true });
  let parsed = {};
  try { parsed = JSON.parse(npmLs.stdout || '{}'); } catch { fail('npm ls --all did not return parseable JSON', { stderr: npmLs.stderr, stdout_excerpt: npmLs.stdout?.slice(0, 1000) }); }
  if (npmLs.status !== 0 || parsed.problems?.length) {
    fail('Installed dependency tree contains invalid/extraneous/missing packages', { exit_code: npmLs.status, problems: parsed.problems || [], stderr_excerpt: npmLs.stderr?.slice(0, 2000) });
  }
  const lockHashAfter = shaFile('package-lock.json');
  if (lockHashBefore !== lockHashAfter) fail('package-lock.json changed during dependency verification', { lockHashBefore, lockHashAfter });
  return { package_lock_hash: lockHashAfter, npm_ls_all_ok: true };
}

try {
  if (!skipFetch) run('git', ['fetch', 'origin', 'main']);
  assertNoGitOperationInProgress();
  if (phase === 'prebuild') assertCleanWorktree();
  else if (phase !== 'postbuild') fail('Unknown source verification phase', { phase });

  const head = git(['rev-parse', 'HEAD']);
  const originMain = git(['rev-parse', 'origin/main']);
  const approvedCommit = approvedArg || originMain;
  const headReachable = run('git', ['merge-base', '--is-ancestor', head, 'origin/main'], { allowFailure: true }).status === 0;

  if (policyMode === 'release') {
    const approvedReachable = run('git', ['merge-base', '--is-ancestor', approvedCommit, 'origin/main'], { allowFailure: true }).status === 0;
    if (!approvedReachable) fail('Approved source commit is not reachable from origin/main', { approvedCommit, originMain });
    if (head !== approvedCommit) fail('HEAD does not equal approved source commit', { head, approvedCommit });
    if (head !== originMain) fail('HEAD does not match origin/main', { head, originMain });
    if (!headReachable) fail('HEAD is not reachable from origin/main', { head, originMain });
  } else if (policyMode === 'pr') {
    if (!approvedArg) fail('PR policy mode requires explicit --approved-commit');
    if (head !== approvedCommit) fail('PR policy HEAD does not equal supplied approved commit', { head, approvedCommit });
  } else {
    fail('Unknown policy mode', { policyMode });
  }

  const dependency = verifyPackageLockInstalledTree();
  const postBuild = phase === 'postbuild' ? assertPostBuildSourceClean() : { clean: true, generated_changes: [] };
  const result = {
    ok: true,
    suite: 'g50c-native-release-source',
    git_commit: head,
    generated_at_utc: new Date().toISOString(),
    policy_mode: policyMode,
    phase,
    worktree_clean_or_generated_only: postBuild.clean || postBuild.generated_changes.length >= 0,
    generated_changes: postBuild.generated_changes,
    head_is_exact_approved_commit: head === approvedCommit,
    head_reachable_from_origin_main: headReachable,
    head_matches_origin_main: head === originMain,
    approved_commit: approvedCommit,
    head,
    origin_main: originMain,
    ...dependency,
    release_archive_created: false,
    app_store_upload_performed: false,
  };
  writeEvidence(result);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  fail(error.message);
}
