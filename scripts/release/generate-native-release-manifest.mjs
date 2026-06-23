#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outPath = outIndex >= 0 ? args[outIndex + 1] : null;

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 10, ...options });
  if (result.status !== 0 && !options.allowFailure) throw new Error(`${command} ${commandArgs.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function shaFile(relativePath) {
  const absolute = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolute)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
}

function activeEntry(indexPath) {
  const absolute = path.join(repoRoot, indexPath);
  if (!fs.existsSync(absolute)) return null;
  const html = fs.readFileSync(absolute, 'utf8');
  const js = [...html.matchAll(/src=["']\/?(assets\/[^"']+\.js)["']/g)].map((m) => m[1]).at(-1) || null;
  return js;
}

function projectSetting(name) {
  const pbx = fs.existsSync(path.join(repoRoot, 'ios/App/App.xcodeproj/project.pbxproj'))
    ? fs.readFileSync(path.join(repoRoot, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8')
    : '';
  const match = pbx.match(new RegExp(`${name} = ([^;]+);`));
  return match ? match[1].trim() : 'unknown';
}

const webEntry = activeEntry('dist/index.html');
const nativeEntry = activeEntry('ios/App/App/public/index.html');
const acknowledgementPath = path.join(repoRoot, 'config/release/critical-pr-acknowledgements.json');
const acknowledgements = fs.existsSync(acknowledgementPath)
  ? JSON.parse(fs.readFileSync(acknowledgementPath, 'utf8')).acknowledged_excluded_critical_prs || []
  : [];

const manifest = {
  schema_version: 1,
  generated_at_utc: new Date().toISOString(),
  git_commit: run('git', ['rev-parse', 'HEAD']),
  origin_main_commit: run('git', ['rev-parse', 'origin/main'], { allowFailure: true }) || null,
  included_prs: [],
  acknowledged_excluded_critical_prs: acknowledgements.map(({ number, reason, status }) => ({ number, reason, status })),
  marketing_version: projectSetting('MARKETING_VERSION'),
  build_number: projectSetting('CURRENT_PROJECT_VERSION'),
  node_version: process.version,
  npm_lock_hash: shaFile('package-lock.json'),
  web_index_hash: shaFile('dist/index.html'),
  web_entry_asset: webEntry,
  web_entry_hash: webEntry ? shaFile(`dist/${webEntry}`) : null,
  native_index_hash: shaFile('ios/App/App/public/index.html'),
  native_entry_asset: nativeEntry,
  native_entry_hash: nativeEntry ? shaFile(`ios/App/App/public/${nativeEntry}`) : null,
  capacitor_config_hash: shaFile('capacitor.config.json'),
  startup_marker_result: 'verified_by_verify_web_native_bundle_parity',
  checkout_marker_result: 'verified_by_verify_web_native_bundle_parity',
  critical_suite_result: 'verified_by_ci_run_critical_regressions',
  simulator_build_result: 'verified_by_native_quality_gate',
  contains_credentials: false,
  contains_customer_information: false,
};

const body = `${JSON.stringify(manifest, null, 2)}\n`;
if (outPath) {
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outPath), body);
}
console.log(body);
