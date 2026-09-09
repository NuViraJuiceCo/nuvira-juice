#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build, version as esbuildVersion} from 'esbuild';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const destination = process.argv[2];
assert.ok(destination && path.isAbsolute(destination), 'Provide an absolute, new staging directory.');
assert.ok(!fs.existsSync(destination), 'Refusing to overwrite an existing staging directory.');
assert.equal(execFileSync('git', ['status', '--porcelain'], {cwd: repo, encoding: 'utf8'}).trim(), '', 'Package only a clean source tree.');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim();
const entry = 'base44/functions/getAdminOperationsDashboardSummary/entry.ts';
const source = fs.readFileSync(path.join(repo, entry), 'utf8');
const revision = source.match(/const ADMIN_PACKAGE_REVISION = '([^']+)'/)?.[1];
assert.ok(revision, 'Missing admin deployment revision.');
const result = await build({
  absWorkingDir: repo, entryPoints: [entry], bundle: true, format: 'esm',
  platform: 'neutral', target: 'es2022', external: ['npm:*', 'node:*'],
  banner: {js: '// @ts-nocheck'}, outfile: 'entry.ts', write: false, metafile: true,
});
assert.equal(result.outputFiles.length, 1, 'Expected one bundled entrypoint.');
const content = result.outputFiles[0].text;
assert.equal((content.match(/Deno\.serve\(/g) || []).length, 1, 'Expected exactly one request listener.');
assert.ok(content.includes(revision), 'Deployment revision must survive bundling.');
const inputs = Object.keys(result.metafile.inputs).sort().map(file => {
  assert.ok(file.startsWith('base44/functions/') || file.startsWith('base44/shared/'), `Unexpected bundle input: ${file}`);
  return {path: file, sha256: sha(fs.readFileSync(path.join(repo, file)))};
});
fs.mkdirSync(destination);
const output = path.join(destination, 'base44/functions/getAdminOperationsDashboardSummary');
fs.mkdirSync(output, {recursive: true});
fs.writeFileSync(path.join(output, 'entry.ts'), content);
fs.writeFileSync(path.join(output, 'function.jsonc'), JSON.stringify({name: 'getAdminOperationsDashboardSummary', entry: 'entry.ts'}, null, 2));
fs.writeFileSync(path.join(destination, 'base44/config.jsonc'), JSON.stringify({name: 'NuVira canonical admin gateway release'}, null, 2));
const manifest = {commit, revision, esbuildVersion, entry, entrySha256: sha(content), inputs,
  scope: 'One existing admin gateway only. This script performs no deployment or provider calls.'};
fs.writeFileSync(path.join(destination, 'admin-package-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({destination, commit, revision, esbuildVersion, entrySha256: manifest.entrySha256, inputCount: inputs.length}, null, 2));
