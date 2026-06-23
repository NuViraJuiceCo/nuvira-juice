#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
};
const outPath = arg('--out');
const now = new Date();
const criticalConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config/release/critical-paths.json'), 'utf8'));
const acknowledgementConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config/release/critical-pr-acknowledgements.json'), 'utf8'));
const allowedStatuses = new Set(['blocked_excluded_from_release', 'stale_release_candidate_excluded_from_release', 'stale_build_metadata_branch_excluded_from_release', 'manual_release_exclusion_acknowledged']);
const acknowledged = new Map((acknowledgementConfig.acknowledged_excluded_critical_prs || []).map((item) => [Number(item.number), item]));

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 40, ...options });
}
function gitHead() { const r = run('git', ['rev-parse', 'HEAD']); return r.status === 0 ? r.stdout.trim() : 'unknown'; }
function writeEvidence(result) {
  if (!outPath) return;
  const absolute = path.resolve(repoRoot, outPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(result, null, 2)}\n`);
}
function fail(message, extra = {}) {
  const result = { ok: false, suite: 'g50c-open-critical-prs', git_commit: gitHead(), generated_at_utc: now.toISOString(), message, ...extra };
  writeEvidence(result);
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
function currentPullRequestNumber() {
  if (process.env.G50C_CURRENT_PR_NUMBER) return Number(process.env.G50C_CURRENT_PR_NUMBER);
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && fs.existsSync(eventPath)) {
    try { return JSON.parse(fs.readFileSync(eventPath, 'utf8')).pull_request?.number || null; } catch { return null; }
  }
  const local = run('gh', ['pr', 'view', '--json', 'number'], { allowFailure: true });
  if (local.status === 0) {
    try { return JSON.parse(local.stdout || '{}').number || null; } catch { return null; }
  }
  return null;
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
function criticalMatches(files) {
  return files.filter((file) => criticalConfig.critical_paths.some((pattern) => pathMatchesPattern(file, pattern)));
}
function loadFixture() {
  const fixturePath = process.env.G50C_OPEN_PR_FIXTURE;
  if (!fixturePath) return null;
  return JSON.parse(fs.readFileSync(path.resolve(fixturePath), 'utf8'));
}
function parseOwnerRepo() {
  const remote = run('git', ['remote', 'get-url', 'origin']);
  if (remote.status !== 0) fail('Unable to read origin remote', { stderr: remote.stderr });
  const url = remote.stdout.trim();
  const match = url.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
  if (!match) fail('Unable to parse GitHub owner/repo from origin remote', { url });
  return { owner: match[1], repo: match[2] };
}
function ghApiGraphql(query, variables) {
  const input = JSON.stringify({ query, variables });
  const result = run('gh', ['api', 'graphql', '--input', '-'], { input });
  if (result.status !== 0) fail('GitHub GraphQL query failed', { stderr: result.stderr });
  return JSON.parse(result.stdout);
}
function loadOpenPrs() {
  const fixture = loadFixture();
  if (fixture) {
    if (fixture.pagination_completed === false) fail('Open PR fixture indicates pagination was not completed', { page_limit: fixture.page_limit || 100 });
    return fixture.pull_requests || [];
  }
  const { owner, repo } = parseOwnerRepo();
  const query = `query($owner:String!, $repo:String!, $after:String) {
    repository(owner:$owner, name:$repo) {
      pullRequests(states:OPEN, first:100, after:$after, orderBy:{field:UPDATED_AT, direction:DESC}) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number title isDraft headRefName headRefOid baseRefName url
          files(first:100) { pageInfo { hasNextPage } nodes { path } }
        }
      }
    }
  }`;
  const prs = [];
  let after = null;
  let pages = 0;
  do {
    pages += 1;
    const response = ghApiGraphql(query, { owner, repo, after });
    const conn = response.data?.repository?.pullRequests;
    if (!conn) fail('Malformed GitHub GraphQL response for open PRs');
    for (const node of conn.nodes || []) {
      if (node.files?.pageInfo?.hasNextPage) fail('Critical PR verifier refuses incomplete PR file pagination', { number: node.number, file_page_limit: 100 });
      prs.push({
        number: node.number,
        title: node.title,
        isDraft: node.isDraft,
        headRefName: node.headRefName,
        headRefOid: node.headRefOid,
        baseRefName: node.baseRefName,
        url: node.url,
        files: (node.files?.nodes || []).map((file) => file.path),
      });
    }
    after = conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after);
  return { prs, pages_completed: pages };
}
function validateAcknowledgements(openPrsByNumber) {
  const invalid = [];
  for (const [number, ack] of acknowledged) {
    for (const key of ['number', 'head_sha', 'base_branch', 'reason', 'status', 'acknowledged_by', 'acknowledged_at', 'expires_at']) {
      if (!ack[key]) invalid.push({ number, missing: key });
    }
    if (ack.expires_at && new Date(ack.expires_at).getTime() <= now.getTime()) invalid.push({ number, reason: 'acknowledgement_expired', expires_at: ack.expires_at });
    if (ack.status && !allowedStatuses.has(ack.status)) invalid.push({ number, reason: 'unknown_status', status: ack.status });
    if (!String(ack.reason || '').trim()) invalid.push({ number, reason: 'blank_reason' });
    const pr = openPrsByNumber.get(Number(number));
    if (pr) {
      if (pr.headRefOid !== ack.head_sha) invalid.push({ number, reason: 'head_sha_changed', acknowledged_head_sha: ack.head_sha, current_head_sha: pr.headRefOid });
      if (pr.baseRefName !== ack.base_branch) invalid.push({ number, reason: 'base_branch_changed', acknowledged_base_branch: ack.base_branch, current_base_branch: pr.baseRefName });
    }
  }
  if (invalid.length) fail('Critical PR acknowledgement validation failed', { invalid_acknowledgements: invalid });
}

const currentPr = currentPullRequestNumber();
const loaded = loadOpenPrs();
const openPrs = Array.isArray(loaded) ? loaded : loaded.prs;
const pagesCompleted = Array.isArray(loaded) ? 1 : loaded.pages_completed;
const openPrsByNumber = new Map(openPrs.map((pr) => [Number(pr.number), pr]));
validateAcknowledgements(openPrsByNumber);

const criticalPrs = [];
const unacknowledged = [];
const acknowledgedExcluded = [];
for (const pr of openPrs) {
  if (currentPr && Number(pr.number) === Number(currentPr)) continue;
  const files = (pr.files || []).map((file) => typeof file === 'string' ? file : file.path).filter(Boolean);
  const matches = criticalMatches(files);
  if (!matches.length) continue;
  const entry = { number: Number(pr.number), title: pr.title, url: pr.url, isDraft: Boolean(pr.isDraft), head_sha: pr.headRefOid, base_branch: pr.baseRefName, matched_files: matches };
  criticalPrs.push(entry);
  const ack = acknowledged.get(Number(pr.number));
  if (ack) acknowledgedExcluded.push({ ...entry, acknowledgement: ack });
  else unacknowledged.push(entry);
}
if (unacknowledged.length) {
  fail('Open release-critical PRs require explicit inclusion or pinned exclusion acknowledgement', {
    unacknowledged_open_critical_prs: unacknowledged,
    acknowledged_excluded_critical_prs: acknowledgedExcluded,
    pages_completed: pagesCompleted,
  });
}
const result = {
  ok: true,
  suite: 'g50c-open-critical-prs',
  git_commit: gitHead(),
  generated_at_utc: now.toISOString(),
  open_pr_count: openPrs.length,
  pages_completed: pagesCompleted,
  open_critical_pr_count: criticalPrs.length,
  unacknowledged_open_critical_prs: 0,
  acknowledged_excluded_critical_prs: acknowledgedExcluded,
  critical_paths: criticalConfig.critical_paths,
};
writeEvidence(result);
console.log(JSON.stringify(result, null, 2));
