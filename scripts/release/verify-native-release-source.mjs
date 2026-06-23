#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const args = process.argv.slice(2);
const argValue = (name) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : null;
};
const policyMode = argValue('--policy-mode') || 'release';
const approvedArg = argValue('--approved-commit');
const skipFetch = args.includes('--skip-fetch');

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 10, ...options });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

function git(commandArgs, options = {}) {
  return run('git', commandArgs, options).stdout.trim();
}

function fail(message, extra = {}) {
  console.error(JSON.stringify({ ok: false, suite: 'g50c-native-release-source', message, policy_mode: policyMode, ...extra }, null, 2));
  process.exit(1);
}

function assertCleanWorktree() {
  const status = git(['status', '--porcelain']);
  if (status) fail('Git worktree is not clean', { status: status.split('\n') });
}

function assertNoGitOperationInProgress() {
  const gitDir = git(['rev-parse', '--git-dir']);
  const markers = ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'];
  const active = markers.filter((marker) => fs.existsSync(path.join(repoRoot, gitDir, marker)));
  if (active.length) fail('Git merge/rebase/cherry-pick/revert operation is in progress', { active });
}

function verifyPackageLockInstalledTree() {
  if (!fs.existsSync(path.join(repoRoot, 'package-lock.json'))) fail('package-lock.json is missing');
  if (!fs.existsSync(path.join(repoRoot, 'node_modules/.package-lock.json'))) {
    fail('Installed dependency tree missing; run npm ci before release verification');
  }
}

function verifyGeneratedBundleFresh(headCommit) {
  for (const required of ['dist/index.html', 'ios/App/App/public/index.html']) {
    const absolute = path.join(repoRoot, required);
    if (!fs.existsSync(absolute)) fail('Generated bundle file missing', { required });
    const fileTimestamp = Math.floor(fs.statSync(absolute).mtimeMs / 1000);
    const commitTimestamp = Number(git(['show', '-s', '--format=%ct', headCommit]));
    if (fileTimestamp < commitTimestamp) {
      fail('Generated bundle predates source commit', { required, fileTimestamp, commitTimestamp });
    }
  }
}

try {
  if (!skipFetch) run('git', ['fetch', 'origin', 'main']);
  assertNoGitOperationInProgress();
  assertCleanWorktree();

  const head = git(['rev-parse', 'HEAD']);
  const originMain = git(['rev-parse', 'origin/main']);
  const approvedCommit = approvedArg || originMain;
  const mergeBaseIsAncestor = run('git', ['merge-base', '--is-ancestor', head, 'origin/main'], { allowFailure: true }).status === 0;

  if (policyMode === 'release') {
    const approvedReachable = run('git', ['merge-base', '--is-ancestor', approvedCommit, 'origin/main'], { allowFailure: true }).status === 0;
    if (!approvedReachable) fail('Approved source commit is not reachable from origin/main', { approvedCommit, originMain });
    if (head !== approvedCommit) fail('HEAD does not equal approved source commit', { head, approvedCommit });
    if (head !== originMain) fail('HEAD does not match origin/main', { head, originMain });
    if (!mergeBaseIsAncestor) fail('HEAD is not reachable from origin/main', { head, originMain });
  } else if (policyMode === 'pr') {
    if (!approvedArg) fail('PR policy mode requires explicit --approved-commit');
    if (head !== approvedCommit) fail('PR policy HEAD does not equal supplied approved commit', { head, approvedCommit });
  } else {
    fail('Unknown policy mode', { policyMode });
  }

  verifyPackageLockInstalledTree();
  if (fs.existsSync(path.join(repoRoot, 'dist/index.html')) || fs.existsSync(path.join(repoRoot, 'ios/App/App/public/index.html'))) {
    verifyGeneratedBundleFresh(head);
  }

  console.log(JSON.stringify({
    ok: true,
    suite: 'g50c-native-release-source',
    policy_mode: policyMode,
    worktree_clean: true,
    head_is_exact_approved_commit: head === approvedCommit,
    head_reachable_from_origin_main: mergeBaseIsAncestor,
    head_matches_origin_main: head === originMain,
    approved_commit: approvedCommit,
    head,
    origin_main: originMain,
    package_lock_installed_tree_present: true,
    release_archive_created: false,
    app_store_upload_performed: false,
  }, null, 2));
} catch (error) {
  fail(error.message);
}
