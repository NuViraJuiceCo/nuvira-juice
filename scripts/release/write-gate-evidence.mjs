#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const repoRoot = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback = null) => { const idx = args.indexOf(name); return idx >= 0 ? args[idx + 1] : fallback; };
const outPath = arg('--out');
const suite = arg('--suite', 'generic-gate');
const status = arg('--status', 'ok');
if (!outPath) throw new Error('--out is required');
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
const result = {
  ok: status === 'ok',
  suite,
  git_commit: git.status === 0 ? git.stdout.trim() : 'unknown',
  generated_at_utc: new Date().toISOString(),
  release_archive_created: false,
  app_store_upload_performed: false,
};
const absolute = path.resolve(repoRoot, outPath);
fs.mkdirSync(path.dirname(absolute), { recursive: true });
fs.writeFileSync(absolute, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
