#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const args = process.argv.slice(2);
const arg = (name, envName, fallback = null) => {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return process.env[envName] || fallback;
};

const approvedCommit = arg('--approved-commit', 'RELEASE_APPROVED_COMMIT');
const base44DeploymentId = arg('--base44-deployment-id', 'RELEASE_BASE44_DEPLOYMENT_ID');
const base44Commit = arg('--base44-commit', 'RELEASE_BASE44_COMMIT');
const base44EntryAsset = arg('--base44-entry-asset', 'RELEASE_BASE44_ENTRY_ASSET');
const base44ObservedAt = arg('--base44-observed-at', 'RELEASE_BASE44_OBSERVED_AT_UTC');
const appflowBuildId = arg('--appflow-build-id', 'RELEASE_APPFLOW_BUILD_ID');
const appflowCommit = arg('--appflow-commit', 'RELEASE_APPFLOW_COMMIT');
const appflowStatus = arg('--appflow-status', 'RELEASE_APPFLOW_STATUS');
const appflowObservedAt = arg('--appflow-observed-at', 'RELEASE_APPFLOW_OBSERVED_AT_UTC');
const maxAgeHours = Number(arg('--max-age-hours', 'RELEASE_PROVENANCE_MAX_AGE_HOURS', '24'));
const outPath = arg('--out', 'RELEASE_PROVENANCE_OUT');

function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}
function writeEvidence(result) {
  if (!outPath) return;
  const absolute = path.resolve(repoRoot, outPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(result, null, 2)}\n`);
}
function fail(message, extra = {}) {
  const result = {
    ok: false,
    suite: 'release-deployment-provenance',
    git_commit: gitHead(),
    generated_at_utc: new Date().toISOString(),
    message,
    ...extra,
  };
  writeEvidence(result);
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
function required(label, value) {
  if (typeof value !== 'string' || !value.trim()) fail(`Required deployment provenance value missing: ${label}`);
  return value.trim();
}
function readJson(relativePath) {
  const absolute = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolute)) fail('Required release file missing', { file: relativePath });
  try {
    return JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch {
    fail('Required release file is malformed JSON', { file: relativePath });
  }
}
function activeEntry(indexPath) {
  const absolute = path.join(repoRoot, indexPath);
  if (!fs.existsSync(absolute)) fail('Built Web index is missing', { file: indexPath });
  const html = fs.readFileSync(absolute, 'utf8');
  const entry = [...html.matchAll(/src=["']\/?(assets\/[^"']+\.js)["']/g)].map((match) => match[1]).at(-1);
  if (!entry) fail('Built Web entry asset could not be resolved', { file: indexPath });
  return entry;
}
function verifyObservedAt(label, value, now = Date.now()) {
  const parsed = Date.parse(required(label, value));
  if (!Number.isFinite(parsed)) fail(`${label} must be a valid ISO timestamp`, { value });
  const ageMs = now - parsed;
  if (ageMs < -5 * 60 * 1000) fail(`${label} is unexpectedly in the future`, { value });
  if (ageMs > maxAgeHours * 60 * 60 * 1000) {
    fail(`${label} is stale; re-check the live channel before release`, { value, max_age_hours: maxAgeHours });
  }
  return new Date(parsed).toISOString();
}

if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0 || maxAgeHours > 168) {
  fail('max-age-hours must be greater than 0 and no more than 168', { max_age_hours: maxAgeHours });
}

const head = gitHead();
const expectedCommit = required('approved commit', approvedCommit).toLowerCase();
if (!/^[0-9a-f]{40}$/.test(expectedCommit)) fail('Approved commit must be a full 40-character Git SHA', { approved_commit: expectedCommit });
if (head !== expectedCommit) fail('Deployment provenance commit does not match the checked-out source', { approved_commit: expectedCommit, head });

const capacitor = readJson('capacitor.config.json');
const liveUpdates = capacitor.plugins?.LiveUpdates;
if (!liveUpdates?.appId || !liveUpdates?.channel) fail('Capacitor Live Updates appId/channel configuration is missing');
if (liveUpdates.autoUpdateMethod !== 'none') fail('Live Updates must remain app-controlled for release provenance checks', { autoUpdateMethod: liveUpdates.autoUpdateMethod });

const localEntryAsset = activeEntry('dist/index.html');
const observedBase44Asset = required('Base44 entry asset', base44EntryAsset);
if (!/^index-[A-Za-z0-9_-]+\.js$/.test(path.basename(observedBase44Asset))) fail('Base44 entry asset is not a valid built entry filename', { base44_entry_asset: observedBase44Asset });
const observedBase44Commit = required('Base44 commit', base44Commit).toLowerCase();
if (observedBase44Commit !== expectedCommit) fail('Base44 deployment commit does not match the approved commit', { base44_commit: observedBase44Commit, approved_commit: expectedCommit });

const observedAppflowCommit = required('Appflow commit', appflowCommit).toLowerCase();
if (observedAppflowCommit !== expectedCommit) {
  fail('Appflow Production commit does not match the approved commit', {
    appflow_commit: observedAppflowCommit,
    approved_commit: expectedCommit,
  });
}
const normalizedAppflowStatus = required('Appflow status', appflowStatus).toLowerCase();
if (normalizedAppflowStatus !== 'active') fail('Appflow Production build is not active', { appflow_status: normalizedAppflowStatus });

const result = {
  ok: true,
  suite: 'release-deployment-provenance',
  git_commit: head,
  generated_at_utc: new Date().toISOString(),
  approved_commit: expectedCommit,
  base44: {
    deployment_id: required('Base44 deployment ID', base44DeploymentId),
    git_commit: observedBase44Commit,
    entry_asset: observedBase44Asset,
    local_entry_asset: localEntryAsset,
    observed_at_utc: verifyObservedAt('Base44 observed-at timestamp', base44ObservedAt),
    commit_matches_approved_source: true,
  },
  appflow: {
    app_id: liveUpdates.appId,
    channel: liveUpdates.channel,
    build_id: required('Appflow build ID', appflowBuildId),
    git_commit: observedAppflowCommit,
    status: normalizedAppflowStatus,
    observed_at_utc: verifyObservedAt('Appflow observed-at timestamp', appflowObservedAt),
    commit_matches_approved_source: true,
  },
  contract: {
    one_approved_commit: true,
    base44_matches_approved_commit: true,
    appflow_matches_approved_commit: true,
    appflow_production_active: true,
    observations_within_max_age: true,
    max_age_hours: maxAgeHours,
  },
  contains_credentials: false,
  contains_customer_information: false,
  provider_mutations_performed: false,
};

writeEvidence(result);
console.log(JSON.stringify(result, null, 2));
