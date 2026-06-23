#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
};
const outPath = arg('--out');
const allowlistPath = arg('--allowlist', 'config/release/secret-scan-allowlist.json');
const fixturePath = arg('--fixture');
const policyMode = arg('--untracked-policy', 'ignored');
const today = new Date();
const todayIso = today.toISOString();

const generatedOrVendorPatterns = [
  /^node_modules\//,
  /^dist\//,
  /^build\//,
  /^coverage\//,
  /^\.git\//,
  /^ios\/App\/App\/public\//,
  /^ios\/App\/DerivedData\//,
  /^ios\/App\/build\//,
  /^ios\/App\/CapApp-SPM\//,
  /^android\/app\/build\//,
  /^android\/.+\/build\//,
  /^\.DS_Store$/,
];
const lockfilePatterns = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)npm-shrinkwrap\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)Podfile\.lock$/,
  /(^|\/)Package\.resolved$/,
];
const binaryExtensions = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tgz', '.mp4', '.mov', '.m4v', '.woff', '.woff2', '.ttf', '.otf', '.lockb', '.sqlite', '.db', '.a', '.framework', '.xcarchive', '.ipa'
]);
const scannerSourceFiles = new Set(['scripts/ci/scan-tracked-secrets.mjs', 'scripts/ci/verify-secret-scan.mjs']);

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 40, ...options });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}
function git(args, options = {}) { return run('git', args, options).stdout.trim(); }
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function shortHash(value) { return sha(value).slice(0, 16); }
function redactedFingerprint(secret) { return `sha256:${shortHash(secret)}`; }
function contentFingerprint(file, detector, lineText) { return sha(`${file}\0${detector}\0${lineText.trim()}`); }
function lineOf(text, index) { return text.slice(0, index).split('\n').length; }
function writeEvidence(result) {
  if (outPath) {
    const absolute = path.resolve(repoRoot, outPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, `${JSON.stringify(result, null, 2)}\n`);
  }
}
function fail(message, extra = {}) {
  const result = {
    ok: false,
    suite: 'g50c-secret-scan',
    git_commit: safeHead(),
    generated_at_utc: todayIso,
    message,
    ...extra,
  };
  writeEvidence(result);
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
function safeHead() { try { return git(['rev-parse', 'HEAD']); } catch { return 'unknown'; } }
function isExcludedPath(file) {
  return generatedOrVendorPatterns.some((pattern) => pattern.test(file)) || lockfilePatterns.some((pattern) => pattern.test(file));
}
function isBinaryCandidate(file, buffer) {
  const ext = path.extname(file).toLowerCase();
  if (binaryExtensions.has(ext)) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  return sample.includes(0);
}
function trackedFiles() {
  if (fixturePath) {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(repoRoot, fixturePath), 'utf8'));
    return parsed.files || [];
  }
  return git(['ls-files', '-z']).split('\0').filter(Boolean);
}
function loadAllowlist() {
  const absolute = path.resolve(repoRoot, allowlistPath);
  if (!fs.existsSync(absolute)) return [];
  const parsed = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  return parsed.allowlist || [];
}
function validateAllowlist(entries) {
  const expired = [];
  const invalid = [];
  for (const entry of entries) {
    const required = ['file', 'detector', 'content_fingerprint', 'reason', 'expires_at'];
    for (const key of required) if (!entry[key]) invalid.push({ entry, missing: key });
    if (entry.expires_at && new Date(entry.expires_at).getTime() <= today.getTime()) expired.push({ file: entry.file, detector: entry.detector, expires_at: entry.expires_at });
  }
  if (invalid.length) fail('Secret scan allowlist contains invalid entries', { invalid });
  if (expired.length) fail('Secret scan allowlist contains expired entries', { expired });
}
function isAllowlisted(finding, allowlist) {
  return allowlist.some((entry) => entry.file === finding.file && entry.detector === finding.detector && entry.content_fingerprint === finding.content_fingerprint);
}

function part(...segments) { return segments.join(''); }
const detectors = [
  { name: 'stripe_secret_key', regex: new RegExp(`\\b${part('sk_', '(?:live|test)', '_')}[A-Za-z0-9]{16,}\\b`, 'g') },
  { name: 'stripe_publishable_key', regex: new RegExp(`\\b${part('pk_', '(?:live|test)', '_')}[A-Za-z0-9]{16,}\\b`, 'g') },
  { name: 'stripe_webhook_secret', regex: new RegExp(`\\b${part('wh', 'sec_')}[A-Za-z0-9]{16,}\\b`, 'g') },
  { name: 'bearer_token', regex: /\bBearer\s+[A-Za-z0-9._~+\/-]{24,}\b/g },
  { name: 'base44_token', regex: /\b(?:base44|b44)[_-]?(?:api|access|auth)?[_-]?(?:key|token)[\s:=]+['"]?[A-Za-z0-9._~+\/-]{24,}/gi },
  { name: 'private_key_block', regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/g },
  { name: 'apple_private_key_material', regex: /-----BEGIN PRIVATE KEY-----|APNS_AUTH_KEY_B64\s*[=:]\s*['"]?[A-Za-z0-9+/=]{80,}/g },
  { name: 'oauth_client_secret', regex: /\b(?:client_secret|oauth_client_secret|GOOGLE_CLIENT_SECRET|FIREBASE_CLIENT_SECRET)\b\s*[:=]\s*['"]?[A-Za-z0-9._~+\/-]{16,}/gi },
  { name: 'env_credential_assignment', regex: /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY)[A-Z0-9_]*\s*=\s*(?!['"]?(?:true|false|null|undefined|changeme|change_me|example|placeholder|redacted|REDACTED|xxxxx|\*\*\*|<[^>]+>)['"]?$)['"]?[A-Za-z0-9._~+\/-]{24,}/g },
];

const allowlist = loadAllowlist();
validateAllowlist(allowlist);
const files = trackedFiles();
const untrackedPolicy = policyMode;
let scanned = 0;
let skippedBinary = 0;
let skippedGenerated = 0;
const findings = [];

for (const file of files) {
  if (isExcludedPath(file)) { skippedGenerated += 1; continue; }
  const absolute = path.resolve(repoRoot, file);
  if (!absolute.startsWith(repoRoot) || !fs.existsSync(absolute)) continue;
  const buffer = fs.readFileSync(absolute);
  if (isBinaryCandidate(file, buffer)) { skippedBinary += 1; continue; }
  let text;
  try { text = buffer.toString('utf8'); } catch { skippedBinary += 1; continue; }
  scanned += 1;
  for (const detector of detectors) {
    if (scannerSourceFiles.has(file)) continue;
    detector.regex.lastIndex = 0;
    for (const match of text.matchAll(detector.regex)) {
      const index = match.index ?? 0;
      const line = lineOf(text, index);
      const lineText = text.split('\n')[line - 1] || '';
      const matched = match[0];
      const finding = {
        file,
        line,
        detector: detector.name,
        redacted_fingerprint: redactedFingerprint(matched),
        content_fingerprint: contentFingerprint(file, detector.name, lineText),
      };
      if (!isAllowlisted(finding, allowlist)) findings.push(finding);
    }
  }
}

const result = {
  ok: findings.length === 0,
  suite: 'g50c-secret-scan',
  git_commit: safeHead(),
  generated_at_utc: todayIso,
  source: 'git_ls_files_tracked_files',
  untracked_policy: untrackedPolicy,
  scanned_file_count: scanned,
  skipped_binary_file_count: skippedBinary,
  skipped_generated_vendor_lockfile_count: skippedGenerated,
  allowlist_entry_count: allowlist.length,
  findings,
  policy: 'tracked_text_files_only_with_documented_generated_vendor_lockfile_exclusions_redacted_findings',
};
writeEvidence(result);
if (!result.ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
