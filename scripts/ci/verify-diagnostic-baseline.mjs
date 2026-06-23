#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
};
const outPath = arg('--out');
const baselinePath = path.resolve(repoRoot, arg('--baseline', 'config/release/diagnostic-baseline.json'));
const writeBaselinePath = arg('--write-baseline');
const now = new Date();
const diagnosticFixture = process.env.G50C_DIAGNOSTIC_FIXTURE ? JSON.parse(fs.readFileSync(path.resolve(repoRoot, process.env.G50C_DIAGNOSTIC_FIXTURE), 'utf8')) : null;

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 80, ...options });
}
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function gitHead() { const r = run('git', ['rev-parse', 'HEAD']); return r.status === 0 ? r.stdout.trim() : 'unknown'; }
function rel(filePath) { return path.relative(repoRoot, filePath).replaceAll(path.sep, '/'); }
function messageFingerprint(message) { return sha(String(message || '').replace(/\s+/g, ' ').trim()).slice(0, 24); }
function fullFingerprint(parts) { return sha(parts.join('\0')); }
function writeEvidence(result) {
  if (outPath) {
    const absolute = path.resolve(repoRoot, outPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, `${JSON.stringify(result, null, 2)}\n`);
  }
}
function fail(message, extra = {}) {
  const result = { ok: false, suite: 'g50c-diagnostic-baseline', git_commit: gitHead(), generated_at_utc: now.toISOString(), message, ...extra };
  writeEvidence(result);
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
function uniqueSorted(items, key = (item) => item.fingerprint) {
  const map = new Map();
  for (const item of items) map.set(key(item), item);
  return [...map.values()].sort((a, b) => key(a).localeCompare(key(b)));
}

function collectLint() {
  if (diagnosticFixture?.lint) return { exit_code: diagnosticFixture.lint.exit_code || 0, diagnostics: uniqueSorted(diagnosticFixture.lint.diagnostics || []) };
  const result = run('npx', ['eslint', '.', '--quiet', '-f', 'json']);
  let parsed;
  try { parsed = JSON.parse(result.stdout || '[]'); } catch { fail('Unable to parse ESLint JSON output', { stderr: result.stderr, stdout_excerpt: result.stdout?.slice(0, 1000) }); }
  const diagnostics = [];
  for (const file of parsed) {
    const filePath = rel(file.filePath);
    for (const message of file.messages || []) {
      const item = {
        file: filePath,
        rule_id: message.ruleId || 'eslint-parser',
        severity: message.severity === 2 ? 'error' : 'warning',
        line: Number(message.line || 0),
        column: Number(message.column || 0),
        message_fingerprint: messageFingerprint(message.message),
      };
      item.fingerprint = fullFingerprint(['eslint', item.file, item.rule_id, item.severity, item.line, item.column, item.message_fingerprint]);
      diagnostics.push(item);
    }
  }
  return { exit_code: result.status ?? 0, diagnostics: uniqueSorted(diagnostics) };
}

function collectTypecheck() {
  if (diagnosticFixture?.typecheck) return { exit_code: diagnosticFixture.typecheck.exit_code || 0, diagnostics: uniqueSorted(diagnosticFixture.typecheck.diagnostics || []) };
  const result = run('npx', ['tsc', '-p', './jsconfig.json', '--pretty', 'false']);
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const diagnostics = [];
  for (const lineText of output.split('\n')) {
    let match = lineText.match(/^(.+?)\((\d+),(\d+)\): error TS(\d+):\s*(.*)$/);
    if (!match) match = lineText.match(/^(.+?):(\d+):(\d+)\s+-\s+error TS(\d+):\s*(.*)$/);
    if (!match) continue;
    const item = {
      file: match[1].replaceAll('\\', '/'),
      ts_code: `TS${match[4]}`,
      line: Number(match[2]),
      column: Number(match[3]),
      message_fingerprint: messageFingerprint(match[5]),
    };
    item.fingerprint = fullFingerprint(['typescript', item.file, item.ts_code, item.line, item.column, item.message_fingerprint]);
    diagnostics.push(item);
  }
  return { exit_code: result.status ?? 0, diagnostics: uniqueSorted(diagnostics) };
}

function collectAudit() {
  if (diagnosticFixture?.audit) return { exit_code: diagnosticFixture.audit.exit_code || 0, vulnerabilities: uniqueSorted(diagnosticFixture.audit.vulnerabilities || []), counts: diagnosticFixture.audit.counts || {} };
  const result = run('npm', ['audit', '--json']);
  let parsed;
  try { parsed = JSON.parse(result.stdout || '{}'); } catch { fail('Unable to parse npm audit JSON output', { stderr: result.stderr, stdout_excerpt: result.stdout?.slice(0, 1000) }); }
  const vulnerabilities = [];
  const entries = parsed.vulnerabilities || {};
  for (const [pkg, vuln] of Object.entries(entries)) {
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
  const counts = parsed.metadata?.vulnerabilities || {};
  return { exit_code: result.status ?? 0, vulnerabilities: uniqueSorted(vulnerabilities), counts };
}

function assertWaiversValid(waivers = []) {
  const invalid = [];
  const expired = [];
  for (const waiver of waivers) {
    for (const key of ['fingerprint', 'reason', 'reachability_assessment', 'owner', 'created_at', 'expires_at']) {
      if (!waiver[key]) invalid.push({ fingerprint: waiver.fingerprint || null, missing: key });
    }
    if (waiver.expires_at && new Date(waiver.expires_at).getTime() <= now.getTime()) expired.push({ fingerprint: waiver.fingerprint, expires_at: waiver.expires_at });
  }
  if (invalid.length) fail('Diagnostic waiver entries are invalid', { invalid });
  if (expired.length) fail('Diagnostic waiver entries are expired', { expired });
}
function diffCurrent(currentItems, baselineItems = [], waiverItems = []) {
  const baseline = new Set((baselineItems || []).map((item) => item.fingerprint));
  const waivers = new Set((waiverItems || []).map((item) => item.fingerprint));
  return currentItems.filter((item) => !baseline.has(item.fingerprint) && !waivers.has(item.fingerprint));
}

const lint = collectLint();
const typecheck = collectTypecheck();
const audit = collectAudit();

if (writeBaselinePath) {
  const baseline = {
    schema_version: 2,
    generated_from_commit: gitHead(),
    generated_at_utc: now.toISOString(),
    policy: 'Fingerprint baseline allows resolved diagnostics and rejects new diagnostics; baseline edits are release-critical.',
    lint: { diagnostics: lint.diagnostics },
    typecheck: { diagnostics: typecheck.diagnostics },
    audit: {
      vulnerabilities: audit.vulnerabilities,
      vulnerability_waivers: [],
      g50d_triage_required: audit.vulnerabilities.some((item) => ['critical', 'high'].includes(item.severity)),
      triage_policy: 'Production-reachable critical/high vulnerabilities block G50D; dev-only or unreachable findings need explicit expiring waivers.'
    }
  };
  const absolute = path.resolve(repoRoot, writeBaselinePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, suite: 'g50c-diagnostic-baseline', wrote_baseline: path.relative(repoRoot, absolute), git_commit: gitHead(), lint_count: lint.diagnostics.length, typecheck_count: typecheck.diagnostics.length, audit_count: audit.vulnerabilities.length }, null, 2));
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
if (baseline.schema_version !== 2) fail('Diagnostic baseline must use fingerprint schema_version 2', { baselinePath: path.relative(repoRoot, baselinePath) });
assertWaiversValid(baseline.audit?.vulnerability_waivers || []);

const newLint = diffCurrent(lint.diagnostics, baseline.lint?.diagnostics || []);
const newTypecheck = diffCurrent(typecheck.diagnostics, baseline.typecheck?.diagnostics || []);
const newAudit = diffCurrent(audit.vulnerabilities, baseline.audit?.vulnerabilities || [], baseline.audit?.vulnerability_waivers || []);

if (newLint.length || newTypecheck.length || newAudit.length) {
  fail('New diagnostic fingerprints found outside approved baseline', {
    new_eslint_count: newLint.length,
    new_typecheck_count: newTypecheck.length,
    new_audit_count: newAudit.length,
    new_eslint: newLint.slice(0, 25),
    new_typecheck: newTypecheck.slice(0, 25),
    new_audit: newAudit.slice(0, 25),
  });
}

const result = {
  ok: true,
  suite: 'g50c-diagnostic-baseline',
  git_commit: gitHead(),
  generated_at_utc: now.toISOString(),
  baseline_commit: baseline.generated_from_commit,
  policy: 'fingerprint_no_new_regressions_allow_resolutions',
  lint: { exit_code: lint.exit_code, current_count: lint.diagnostics.length, baseline_count: baseline.lint?.diagnostics?.length || 0, new_count: 0 },
  typecheck: { exit_code: typecheck.exit_code, current_count: typecheck.diagnostics.length, baseline_count: baseline.typecheck?.diagnostics?.length || 0, new_count: 0 },
  audit: { exit_code: audit.exit_code, current_count: audit.vulnerabilities.length, baseline_count: baseline.audit?.vulnerabilities?.length || 0, new_count: 0, severity_counts: audit.counts, g50d_triage_required: Boolean(baseline.audit?.g50d_triage_required) },
};
writeEvidence(result);
console.log(JSON.stringify(result, null, 2));
