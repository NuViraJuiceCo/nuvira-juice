#!/usr/bin/env node
// Local packaging only. No API, deployment, workflow, or provider operation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build, version as esbuildVersion } from 'esbuild';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const [base, destination] = process.argv.slice(2);
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const sha = value => createHash('sha256').update(value).digest('hex');
assert.match(base || '', /^[a-f0-9]{40}$/, 'Supply exact previously published base SHA.');
assert.ok(destination && path.isAbsolute(destination) && !fs.existsSync(destination), 'Supply a new absolute staging directory.');
assert.equal(git(['status', '--porcelain']), '', 'Package only clean committed source.');
git(['merge-base', '--is-ancestor', base, 'HEAD']);
const commit = git(['rev-parse', 'HEAD']);
const changed = new Set(git(['diff', '--name-only', base, commit]).split('\n'));
const manifest = { base, commit, esbuildVersion, functions: [], entities: [],
  scope: 'Reviewed dependency changes only; existing-name verification is required before deployment. No automations are included.' };
const packages = [];
for (const directory of fs.readdirSync(path.join(repo, 'base44/functions'), { withFileTypes: true }).filter(item => item.isDirectory())) {
  const name = directory.name;
  const entry = `base44/functions/${name}/entry.ts`;
  if (!fs.existsSync(path.join(repo, entry))) continue;
  const result = await build({ absWorkingDir: repo, entryPoints: [entry], bundle: true, format: 'esm',
    platform: 'neutral', target: 'es2022', external: ['npm:*', 'node:*'],
    banner: { js: '// @ts-nocheck' }, outfile: 'entry.ts', write: false, metafile: true });
  const inputs = Object.keys(result.metafile.inputs).sort();
  if (!inputs.some(input => changed.has(input)) && !changed.has(`base44/functions/${name}/function.jsonc`)) continue;
  assert.equal(result.outputFiles.length, 1);
  const content = result.outputFiles[0].text;
  assert.equal((content.match(/Deno\.serve\(/g) || []).length, 1, `${name}: must retain one listener.`);
  assert.ok(inputs.every(file => file.startsWith('base44/')), `${name}: unexpected dependency.`);
  manifest.functions.push({ name, entry, entrySha256: sha(content), inputs: inputs.map(file => ({ path: file,
    sha256: sha(fs.readFileSync(path.join(repo, file))) })) });
  packages.push({ name, content });
}
assert.ok(packages.length > 0, 'No affected functions.');
for (const file of [...changed].filter(file => /^base44\/entities\/[^/]+\.jsonc$/.test(file)).sort()) {
  assert.ok(fs.existsSync(path.join(repo, file)), `Entity deletion is not supported: ${file}`);
  manifest.entities.push({ path: file, sha256: sha(fs.readFileSync(path.join(repo, file))) });
}
fs.mkdirSync(destination, { mode: 0o700 });
for (const { name, content } of packages) {
  const out = path.join(destination, 'base44/functions', name);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'entry.ts'), content);
  // Deliberately omit migrated automation configuration, preserving live workflows.
  fs.writeFileSync(path.join(out, 'function.jsonc'), JSON.stringify({ name, entry: 'entry.ts' }, null, 2));
}
for (const item of manifest.entities) {
  const out = path.join(destination, item.path);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(path.join(repo, item.path), out);
}
fs.writeFileSync(path.join(destination, 'base44/config.jsonc'), JSON.stringify({ name: 'NuVira reviewed functions and additive entity release' }, null, 2));
fs.writeFileSync(path.join(destination, 'release-package-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ base, commit, destination, functions: manifest.functions.map(item => item.name), entities: manifest.entities.map(item => item.path) }, null, 2));
