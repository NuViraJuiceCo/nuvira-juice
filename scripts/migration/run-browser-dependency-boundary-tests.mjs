#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyException, verifyBrowserModules, browserDependencyBoundary } from '../ci/browser-dependency-boundary.mjs';

const policy = JSON.parse(fs.readFileSync('config/release/website-dependency-exception.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const validTime = new Date('2026-10-06T00:00:00Z');
verifyException(policy, lock, validTime);
for (const patch of [{ expires_at: 'invalid' }, { expires_at: '2026-10-06T00:00:00Z' },
  { expires_at: '2027-01-01T00:00:00Z' }, { scope: 'native' }, { approved_by: '' },
  { created_at: '2026-10-07T00:00:00Z' }]) {
  assert.throws(() => verifyException({ ...policy, ...patch }, lock, validTime));
}
assert.throws(() => verifyException(policy, { packages: {} }, validTime));
const changed = structuredClone(lock);
changed.packages['node_modules/braces'].version = '3.0.4';
assert.throws(() => verifyException(policy, changed, validTime));
const nested = structuredClone(lock);
nested.packages['node_modules/example/node_modules/braces'] = { version: '3.0.2' };
assert.throws(() => verifyException(policy, nested, validTime));
const bundle = id => ({ 'example.js': { type: 'chunk', modules: { [id]: { renderedLength: 1 } } } });
verifyBrowserModules(bundle('/repo/node_modules/@capacitor-firebase/messaging/dist/esm/index.js'), policy.excluded_browser_packages);
for (const name of policy.excluded_browser_packages) {
  assert.throws(() => verifyBrowserModules(bundle(`/repo/node_modules/${name}/index.js`), policy.excluded_browser_packages));
  assert.throws(() => verifyBrowserModules(bundle(`C:\\repo\\node_modules\\${name.replaceAll('/', '\\')}\\index.js`), policy.excluded_browser_packages));
}
verifyBrowserModules({ 'asset.css': { type: 'asset' } }, policy.excluded_browser_packages);
const plugin = browserDependencyBoundary();
assert.equal(plugin.apply, 'build');
plugin.configResolved({ root: process.cwd() });
plugin.buildStart();
plugin.generateBundle({}, bundle('/repo/src/App.jsx'));
assert.throws(() => plugin.generateBundle({}, bundle('/repo/node_modules/@grpc/grpc-js/build/src/index.js')));
assert.match(fs.readFileSync('vite.config.js', 'utf8'), /browserDependencyBoundary\(\)/);
const baseline = JSON.parse(fs.readFileSync('config/release/diagnostic-baseline.json', 'utf8'));
for (const waiver of baseline.audit.vulnerability_waivers) {
  assert.equal(waiver.scope, 'website-only');
  assert.equal(waiver.expires_at, policy.expires_at);
  assert.equal(waiver.owner, policy.approved_by);
}
console.log(JSON.stringify({ ok: true, suite: 'browser-dependency-boundary', writes: false, provider_calls: false,
  checks: ['valid scoped exception', 'expiry and invalid dates fail closed', 'version drift rejected',
    'nested versions reviewed', 'all excluded browser modules rejected on POSIX and Windows',
    'safe messaging bridge allowed', 'real Vite plugin hooks wired', 'waiver metadata aligned'] }, null, 2));
