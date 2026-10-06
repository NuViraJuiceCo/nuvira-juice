#!/usr/bin/env node
// Observational build receipt: no waiver, provider call, deployment or native sync.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';

const root = fileURLToPath(new URL('../../', import.meta.url));
assert.equal(process.cwd(), root.replace(/\/$/, ''), 'Run from this checkout root');
assert.equal(process.env.DISABLE_BASE44_VITE_PLUGIN, 'true', 'Disable provider build integrations for this local inspection');
const args = process.argv.slice(2);
let out;
let compareDist;
for (let i = 0; i < args.length; i += 1) {
  assert.ok(['--out', '--compare-dist'].includes(args[i]) && args[i + 1], 'Usage: --out receipt.json [--compare-dist /absolute/dist]');
  const flag = args[i];
  const value = path.resolve(args[++i]);
  if (flag === '--out') out = value;
  else compareDist = value;
}
const packages = [
  '@capacitor/android', '@capacitor/ios', 'postcss-selector-parser',
  'postcss-nested', 'tailwindcss', 'tailwindcss-animate', 'source-map-js',
];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const modules = new Set();
const files = {};
const result = await build({
  build: { write: false },
});
// Vite's final hooks rewrite preload dependencies after user generateBundle hooks.
// Hash the completed output, not an intermediate representation of each chunk.
for (const output of (Array.isArray(result) ? result : [result])) {
  for (const item of output.output) {
    if (item.type === 'chunk') Object.keys(item.modules).forEach(id => modules.add(id.replaceAll('\\', '/')));
    if (/\.(?:js|css)$/.test(item.fileName)) files[item.fileName] = sha(item.type === 'chunk' ? item.code : item.source);
  }
}
assert.ok(modules.size > 0 && Object.keys(files).length > 0, 'Expected actual emitted browser modules and assets');
const included = Object.fromEntries(packages.map(name => [name,
  [...modules].filter(id => id.includes(`/node_modules/${name}/`)).length,
]));
const mismatches = [];
if (compareDist) {
  for (const [file, hash] of Object.entries(files)) {
    const previous = path.join(compareDist, file);
    if (!fs.existsSync(previous)) mismatches.push({ file, reason: 'asset missing from comparison' });
    else if (sha(fs.readFileSync(previous)) !== hash) mismatches.push({ file, reason: 'bytes differ' });
  }
  function compareFiles(dir, prefix = '') {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = path.join(prefix, item.name).replaceAll(path.sep, '/');
      if (item.isDirectory()) compareFiles(path.join(dir, item.name), relative);
      else if (/\.(?:js|css)$/.test(relative) && !Object.hasOwn(files, relative)) {
        // Static public files are copied by writeBundle, not emitted Rollup assets.
        if (relative.startsWith('assets/')) mismatches.push({ file: relative, reason: 'comparison bundle has an additional asset' });
      }
    }
  }
  compareFiles(compareDist);
}
const receipt = {
  ok: Object.values(included).every(count => count === 0) && (!compareDist || mismatches.length === 0),
  generated_at: new Date().toISOString(),
  source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  worktree_patch_sha256: sha(execFileSync('git', ['diff', 'HEAD', '--', 'src', 'package.json', 'package-lock.json'])),
  lock_sha256: sha(fs.readFileSync('package-lock.json')),
  installed_versions: Object.fromEntries([...packages, '@capacitor/core', '@capacitor/cli'].map(name => [name,
    JSON.parse(fs.readFileSync(`node_modules/${name}/package.json`, 'utf8')).version,
  ])),
  observed_browser_modules: modules.size,
  excluded_package_module_counts: included,
  emitted_js_css_files: Object.keys(files).length,
  emitted_js_css_sha256: files,
  comparison_directory: compareDist || null,
  comparison_mismatches: mismatches,
  native_projects_synced: false,
  deployed: false,
  limitation: 'Absence from browser modules does not fix native installations or make hostile build inputs safe. No security exception is granted by this receipt.',
};
if (out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
}
console.log(JSON.stringify({ ...receipt, emitted_js_css_sha256: undefined }, null, 2));
if (!receipt.ok) process.exitCode = 1;
