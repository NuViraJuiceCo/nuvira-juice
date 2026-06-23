#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const scanRoots = ['src', 'scripts', 'docs', 'config', '.github'];
const binaryExtensions = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tgz', '.mp4', '.mov', '.woff', '.woff2', '.ttf', '.otf', '.lockb'
]);

const patterns = [
  ['stripe_secret_key', /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ['stripe_publishable_key', /\bpk_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ['stripe_webhook_secret', /\bwhsec_[A-Za-z0-9]{16,}\b/g],
  ['stripe_checkout_session', /\bcs_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ['stripe_payment_intent', /\bpi_[A-Za-z0-9]{16,}\b/g],
  ['stripe_account_id', /\bacct_[A-Za-z0-9]{12,}\b/g],
  ['client_secret_value', /\bclient_secret\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{16,}/gi],
  ['authorization_bearer_token', /\bBearer\s+[A-Za-z0-9._\-]{24,}\b/g],
  ['private_key_block', /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g],
];

function runGit(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });
  if (result.status !== 0 && !allowFailure) {
    process.stderr.write(result.stderr || `git ${args.join(' ')} failed\n`);
    process.exit(result.status || 1);
  }
  return result;
}

function gitTrackedFiles() {
  return runGit(['ls-files', ...scanRoots]).stdout.split('\n').filter(Boolean);
}

function changedFiles() {
  const explicitBase = process.env.G50C_SECRET_SCAN_BASE;
  const mode = process.env.G50C_SECRET_SCAN_MODE || 'changed';
  if (mode === 'all') return gitTrackedFiles();

  let range = '';
  if (explicitBase) {
    range = `${explicitBase}...HEAD`;
  } else if (process.env.GITHUB_BASE_REF) {
    range = `origin/${process.env.GITHUB_BASE_REF}...HEAD`;
  } else {
    const parent = runGit(['rev-parse', 'HEAD^'], { allowFailure: true });
    if (parent.status === 0) range = 'HEAD^...HEAD';
  }

  if (!range) return gitTrackedFiles();
  const result = runGit(['diff', '--name-only', range], { allowFailure: true });
  if (result.status !== 0) return gitTrackedFiles();
  const rootSet = new Set(scanRoots);
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .filter((file) => scanRoots.some((root) => file === root || file.startsWith(`${root}/`)));
}

function isTextCandidate(file) {
  const ext = path.extname(file).toLowerCase();
  return !binaryExtensions.has(ext);
}

const files = [...new Set(changedFiles())].filter(isTextCandidate).filter((file) => fs.existsSync(path.join(repoRoot, file)));
const findings = [];
for (const file of files) {
  const absolute = path.join(repoRoot, file);
  const text = fs.readFileSync(absolute, 'utf8');
  for (const [name, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const before = text.slice(0, match.index ?? 0);
      const line = before.split('\n').length;
      findings.push({ file, line, type: name, sample: match[0].slice(0, 12) + '…' });
    }
  }
}

if (findings.length) {
  console.error(JSON.stringify({ ok: false, suite: 'g50c-secret-scan', scope: process.env.G50C_SECRET_SCAN_MODE || 'changed', scanned_file_count: files.length, findings }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  suite: 'g50c-secret-scan',
  scope: process.env.G50C_SECRET_SCAN_MODE || 'changed',
  scanned_file_count: files.length,
  policy: 'no_new_secret_or_provider_id_values_in_changed_files_full_repo_cleanup_separate',
  findings: 0,
}, null, 2));
