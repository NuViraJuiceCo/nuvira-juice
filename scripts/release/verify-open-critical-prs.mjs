#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const criticalConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config/release/critical-paths.json'), 'utf8'));
const acknowledgementConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config/release/critical-pr-acknowledgements.json'), 'utf8'));
const acknowledged = new Map((acknowledgementConfig.acknowledged_excluded_critical_prs || []).map((item) => [Number(item.number), item]));

function fail(message, extra = {}) {
  console.error(JSON.stringify({ ok: false, suite: 'g50c-open-critical-prs', message, ...extra }, null, 2));
  process.exit(1);
}

function currentPullRequestNumber() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return null;
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    return event.pull_request?.number || null;
  } catch {
    return null;
  }
}

function pathMatchesPattern(filePath, pattern) {
  if (pattern.endsWith('/**')) {
    return filePath.startsWith(pattern.slice(0, -3));
  }
  if (pattern.includes('**')) {
    const [prefix, suffix] = pattern.split('**');
    return filePath.startsWith(prefix) && filePath.endsWith(suffix || '');
  }
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

function runGh(args) {
  const result = spawnSync('gh', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });
  if (result.status !== 0) fail('GitHub CLI command failed', { args, stderr: result.stderr });
  return result.stdout;
}

function loadOpenPrs() {
  const fixture = loadFixture();
  if (fixture) return fixture.pull_requests || [];

  const list = JSON.parse(runGh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,title,isDraft,headRefName,url']));
  return list.map((pr) => {
    const detail = JSON.parse(runGh(['pr', 'view', String(pr.number), '--json', 'files']));
    return { ...pr, files: (detail.files || []).map((file) => file.path) };
  });
}

const currentPr = currentPullRequestNumber();
const openPrs = loadOpenPrs();
const criticalPrs = [];
const unacknowledged = [];
const acknowledgedExcluded = [];

for (const pr of openPrs) {
  if (currentPr && Number(pr.number) === Number(currentPr)) continue;
  const files = (pr.files || []).map((file) => typeof file === 'string' ? file : file.path).filter(Boolean);
  const matches = criticalMatches(files);
  if (!matches.length) continue;
  const entry = { number: Number(pr.number), title: pr.title, url: pr.url, isDraft: Boolean(pr.isDraft), matched_files: matches };
  criticalPrs.push(entry);
  if (acknowledged.has(Number(pr.number))) {
    acknowledgedExcluded.push({ ...entry, acknowledgement: acknowledged.get(Number(pr.number)) });
  } else {
    unacknowledged.push(entry);
  }
}

if (unacknowledged.length) {
  fail('Open release-critical PRs require explicit inclusion or exclusion acknowledgement', {
    unacknowledged_open_critical_prs: unacknowledged,
    acknowledged_excluded_critical_prs: acknowledgedExcluded,
  });
}

console.log(JSON.stringify({
  ok: true,
  suite: 'g50c-open-critical-prs',
  open_critical_pr_count: criticalPrs.length,
  unacknowledged_open_critical_prs: 0,
  acknowledged_excluded_critical_prs: acknowledgedExcluded,
  critical_paths: criticalConfig.critical_paths,
}, null, 2));
