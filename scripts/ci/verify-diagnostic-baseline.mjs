#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const baselinePath = path.join(repoRoot, 'config/release/diagnostic-baseline.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 30,
    ...options,
  });
}

function fail(message, extra = {}) {
  console.error(JSON.stringify({ ok: false, suite: 'g50c-diagnostic-baseline', message, ...extra }, null, 2));
  process.exit(1);
}

function verifyLint() {
  const result = run('npx', ['eslint', '.', '--quiet', '-f', 'json']);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout || '[]');
  } catch (error) {
    fail('Unable to parse ESLint JSON output', { stderr: result.stderr, stdout_excerpt: result.stdout?.slice(0, 1000) });
  }
  const totals = parsed.reduce((acc, item) => {
    acc.errors += item.errorCount || 0;
    acc.warnings += item.warningCount || 0;
    if ((item.errorCount || 0) + (item.warningCount || 0) > 0) acc.files_with_messages += 1;
    return acc;
  }, { errors: 0, warnings: 0, files_with_messages: 0 });
  const limits = baseline.lint;
  if (totals.errors > limits.max_errors || totals.warnings > limits.max_warnings || totals.files_with_messages > limits.max_files_with_messages) {
    fail('ESLint diagnostics exceed approved baseline', { totals, limits });
  }
  return { ...totals, exit_code: result.status };
}

function verifyTypecheck() {
  const result = run('npx', ['tsc', '-p', './jsconfig.json', '--pretty', 'false']);
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const diagnostics = output.split('\n').filter((line) => /error TS\d+/.test(line)).length;
  const limit = baseline.typecheck.max_diagnostics;
  if (diagnostics > limit) {
    fail('TypeScript diagnostics exceed approved baseline', { diagnostics, limit });
  }
  return { diagnostics, exit_code: result.status };
}

function verifyAudit() {
  const result = run('npm', ['audit', '--json']);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout || '{}');
  } catch {
    fail('Unable to parse npm audit JSON output', { stderr: result.stderr, stdout_excerpt: result.stdout?.slice(0, 1000) });
  }
  const vulnerabilities = parsed.metadata?.vulnerabilities || {};
  const limits = baseline.audit;
  const mapped = {
    total: vulnerabilities.total || 0,
    low: vulnerabilities.low || 0,
    moderate: vulnerabilities.moderate || 0,
    high: vulnerabilities.high || 0,
    critical: vulnerabilities.critical || 0,
  };
  for (const key of Object.keys(mapped)) {
    const limitKey = `max_${key}`;
    if (mapped[key] > limits[limitKey]) {
      fail('npm audit vulnerabilities exceed approved baseline', { vulnerabilities: mapped, limits });
    }
  }
  return { vulnerabilities: mapped, exit_code: result.status };
}

const lint = verifyLint();
const typecheck = verifyTypecheck();
const audit = verifyAudit();

console.log(JSON.stringify({
  ok: true,
  suite: 'g50c-diagnostic-baseline',
  baseline_commit: baseline.generated_from_commit,
  lint,
  typecheck,
  audit,
  policy: 'no_new_regressions_against_recorded_baseline',
}, null, 2));
