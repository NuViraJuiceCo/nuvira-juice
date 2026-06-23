#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback = null) => { const idx = args.indexOf(name); return idx >= 0 ? args[idx + 1] : fallback; };
const outPath = arg('--out');
const evidenceDir = arg('--evidence-dir', 'release-evidence');
const releaseInputPath = arg('--release-input', 'config/release/native-release-range.json');

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 50, ...options });
  if (result.status !== 0 && !options.allowFailure) throw new Error(`${command} ${commandArgs.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
function shaBuffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function shaFile(relativePath) {
  const absolute = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolute)) return null;
  return shaBuffer(fs.readFileSync(absolute));
}
function readJson(relativePath) { return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')); }
function activeEntry(indexPath) {
  const absolute = path.join(repoRoot, indexPath);
  if (!fs.existsSync(absolute)) return null;
  const html = fs.readFileSync(absolute, 'utf8');
  return [...html.matchAll(/src=["']\/?(assets\/[^"']+\.js)["']/g)].map((m) => m[1]).at(-1) || null;
}
function fail(message, extra = {}) {
  console.error(JSON.stringify({ ok: false, suite: 'g50c-native-release-manifest', message, ...extra }, null, 2));
  process.exit(1);
}
function validateEvidence(head) {
  const required = [
    'source-policy.json',
    'secret-scan.json',
    'diagnostics.json',
    'critical-regressions.json',
    'bundle-parity.json',
    'simulator-build.json',
    'critical-prs.json'
  ];
  const evidence = [];
  for (const name of required) {
    const rel = `${evidenceDir}/${name}`;
    const absolute = path.join(repoRoot, rel);
    if (!fs.existsSync(absolute)) fail('Required evidence file missing', { evidence_file: rel });
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(absolute, 'utf8')); } catch { fail('Evidence file is malformed JSON', { evidence_file: rel }); }
    if (parsed.ok !== true) fail('Evidence file did not report ok=true', { evidence_file: rel, ok: parsed.ok, message: parsed.message });
    if (parsed.git_commit !== head) fail('Evidence file is stale or for another commit', { evidence_file: rel, evidence_commit: parsed.git_commit, manifest_commit: head });
    evidence.push({ file: rel, suite: parsed.suite || name.replace(/\.json$/, ''), sha256: shaFile(rel), generated_at_utc: parsed.generated_at_utc || null });
  }
  return evidence;
}
function xcodeBuildSettings() {
  if (process.env.G50C_XCODE_BUILD_SETTINGS_FIXTURE) {
    const fixture = JSON.parse(fs.readFileSync(path.resolve(repoRoot, process.env.G50C_XCODE_BUILD_SETTINGS_FIXTURE), 'utf8'));
    for (const key of ['marketing_version', 'build_number', 'product_bundle_identifier', 'sdkroot', 'configuration']) {
      if (!fixture[key]) fail('Required Xcode build setting missing', { key });
    }
    return fixture;
  }
  const output = run('xcodebuild', ['-showBuildSettings', '-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Release', '-sdk', 'iphonesimulator'], { allowFailure: false });
  const settings = {};
  for (const line of output.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match) settings[match[1]] = match[2].trim();
  }
  for (const key of ['MARKETING_VERSION', 'CURRENT_PROJECT_VERSION', 'PRODUCT_BUNDLE_IDENTIFIER', 'SDKROOT', 'CONFIGURATION']) {
    if (!settings[key]) fail('Required Xcode build setting missing', { key });
  }
  return {
    marketing_version: settings.MARKETING_VERSION,
    build_number: settings.CURRENT_PROJECT_VERSION,
    product_bundle_identifier: settings.PRODUCT_BUNDLE_IDENTIFIER,
    sdkroot: settings.SDKROOT,
    configuration: settings.CONFIGURATION,
  };
}
function pathMatchesPattern(filePath, pattern) {
  if (pattern.endsWith('/**')) return filePath.startsWith(pattern.slice(0, -3));
  if (pattern.includes('**')) {
    const escaped = pattern.split('**').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${escaped}$`).test(filePath);
  }
  if (pattern.endsWith('*')) return filePath.startsWith(pattern.slice(0, -1));
  return filePath === pattern;
}
function criticalPathMatch(files) {
  const config = readJson('config/release/critical-paths.json');
  return files.some((file) => config.critical_paths.some((pattern) => pathMatchesPattern(file, pattern)));
}
function deriveIncludedPrs(head, rangeHead = head) {
  const input = readJson(releaseInputPath);
  const previous = input.previous_released_commit;
  if (!previous) fail('Release input missing previous_released_commit', { releaseInputPath });
  const reachable = spawnSync('git', ['merge-base', '--is-ancestor', previous, rangeHead], { cwd: repoRoot }).status === 0;
  if (!reachable) fail('previous_released_commit is not an ancestor of release range head', { previous_released_commit: previous, release_range_head: rangeHead, manifest_commit: head });
  const log = run('git', ['log', '--merges', '--pretty=%H%x00%s', `${previous}..${rangeHead}`], { allowFailure: false });
  const merges = log ? log.split('\n').filter(Boolean).map((line) => {
    const [mergeCommit, title] = line.split('\0');
    const prMatch = title.match(/#(\d+)/);
    return { merge_commit: mergeCommit, title, number: prMatch ? Number(prMatch[1]) : null };
  }) : [];
  const explicit = new Map((input.included_prs || []).map((item) => [item.merge_commit, item]));
  const included = [];
  const unrepresented = [];
  for (const merge of merges) {
    const files = run('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', merge.merge_commit], { allowFailure: true }).split('\n').filter(Boolean);
    const fromInput = explicit.get(merge.merge_commit);
    if (!merge.number && !fromInput) unrepresented.push(merge);
    included.push({
      number: merge.number || fromInput?.number || null,
      merge_commit: merge.merge_commit,
      title: merge.title || fromInput?.title || '',
      critical_path_match: criticalPathMatch(files),
    });
  }
  if (merges.length && !included.length) fail('Manifest included_prs cannot remain empty when release range has merge commits', { previous_released_commit: previous, release_range_head: rangeHead, manifest_commit: head });
  if (unrepresented.length) fail('Release range has merge commits that cannot be represented as PRs without explicit release input', { unrepresented });
  if (!merges.length && input.allow_empty_included_prs_when_no_merge_commits !== true) fail('Release range has no merge commits but empty included_prs is not explicitly allowed', { previous_released_commit: previous, release_range_head: rangeHead, manifest_commit: head });
  return { previous_released_commit: previous, release_range_head: rangeHead, included_prs: included, merge_commit_count: merges.length };
}

try {
  const head = run('git', ['rev-parse', 'HEAD']);
  const originMain = run('git', ['rev-parse', 'origin/main'], { allowFailure: true }) || null;
  const evidence = validateEvidence(head);
  const xcode = xcodeBuildSettings();
  const webEntry = activeEntry('dist/index.html');
  const nativeEntry = activeEntry('ios/App/App/public/index.html');
  const releaseRangeHead = process.env.G50C_RELEASE_RANGE_HEAD || head;
  const range = deriveIncludedPrs(head, releaseRangeHead);
  const acknowledgementPath = 'config/release/critical-pr-acknowledgements.json';
  const acknowledgements = fs.existsSync(path.join(repoRoot, acknowledgementPath)) ? readJson(acknowledgementPath).acknowledged_excluded_critical_prs || [] : [];
  const manifest = {
    schema_version: 2,
    generated_at_utc: new Date().toISOString(),
    git_commit: head,
    origin_main_commit: originMain,
    previous_released_commit: range.previous_released_commit,
    release_range_head: range.release_range_head,
    included_prs: range.included_prs,
    release_range_merge_commit_count: range.merge_commit_count,
    acknowledged_excluded_critical_prs: acknowledgements.map(({ number, head_sha, base_branch, reason, status, acknowledged_by, acknowledged_at, expires_at }) => ({ number, head_sha, base_branch, reason, status, acknowledged_by, acknowledged_at, expires_at })),
    ...xcode,
    node_version: process.version,
    safe_hashes: {
      package_lock: shaFile('package-lock.json'),
      podfile_lock: shaFile('ios/App/Podfile.lock'),
      project_pbxproj: shaFile('ios/App/App.xcodeproj/project.pbxproj'),
      info_plist: shaFile('ios/App/App/Info.plist'),
      entitlements: shaFile('ios/App/App/Entitlements.plist'),
      capacitor_config: shaFile('capacitor.config.json'),
    },
    web_index_hash: shaFile('dist/index.html'),
    web_entry_asset: webEntry,
    web_entry_hash: webEntry ? shaFile(`dist/${webEntry}`) : null,
    native_index_hash: shaFile('ios/App/App/public/index.html'),
    native_entry_asset: nativeEntry,
    native_entry_hash: nativeEntry ? shaFile(`ios/App/App/public/${nativeEntry}`) : null,
    validated_evidence: evidence,
    critical_suite_result: evidence.find((item) => item.file.endsWith('critical-regressions.json'))?.suite || null,
    simulator_build_result: evidence.find((item) => item.file.endsWith('simulator-build.json'))?.suite || null,
    contains_credentials: false,
    contains_customer_information: false,
    release_archive_created: false,
    app_store_upload_performed: false,
  };
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(repoRoot, outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(repoRoot, outPath), body);
  }
  console.log(body);
} catch (error) {
  fail(error.message);
}
