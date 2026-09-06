#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const apk = process.argv[2] || 'android/app/build/outputs/apk/release/app-release-unsigned.apk';
const mappingFile = 'android/app/build/outputs/mapping/release/mapping.txt';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const unzip = entry => execFileSync('unzip', ['-p', apk, entry], { maxBuffer: 100 * 1024 * 1024 });
const mapping = fs.readFileSync(mappingFile, 'utf8');
assert.match(mapping, /# compiler: R8/);
assert.match(mapping, /# compiler_version: 8\.13\.19/);
const classes = [...mapping.matchAll(/^([^\s#][^\n]+) -> ([^:\n]+):$/gm)];
assert.ok(classes.length > 1000, 'A real R8 mapping is required');
const renamed = classes.filter(match => match[1] !== match[2]).length;
assert.ok(renamed / classes.length > 0.25, 'Too few mapped classes are renamed');

const required = {
  'com.nuvirajuice.app.NativeGooglePayPlugin': ['isAvailable', 'confirmPayment', 'handleGooglePayResult'],
  'com.nuvirajuice.app.DeliveryLiveActivityPlugin': ['isAvailable', 'sync', 'end', 'startRouteTracking', 'stopRouteTracking'],
  'com.capacitorjs.plugins.app.AppPlugin': ['getInfo', 'getLaunchUrl', 'getState'],
  'com.capacitorjs.plugins.browser.BrowserPlugin': ['open', 'close'],
  'com.capacitorjs.liveupdates.LiveUpdatesPlugin': ['sync', 'reload'],
  'io.capawesome.capacitorjs.plugins.firebase.messaging.FirebaseMessagingPlugin': ['checkPermissions', 'getToken'],
};
for (const [className, methods] of Object.entries(required)) {
  const start = mapping.indexOf(`\n${className} -> ${className}:\n`);
  assert.ok(start >= 0, `Native plugin class renamed or removed: ${className}`);
  const end = mapping.slice(start + 1).search(/\n[^\s#][^\n]* -> [^\n]+:/);
  const block = mapping.slice(start + 1, end < 0 ? undefined : start + 1 + end);
  for (const method of methods) {
    assert.match(block, new RegExp(`\\b${method}\\([^\\n]* -> ${method}$`, 'm'), `Native entry point removed/renamed: ${className}.${method}`);
  }
}
// Kept annotation interfaces can omit unchanged method lines from mapping.txt.
// Verify class retention here and exercise their nested/default members in the
// offline installed-release permission test instead of trusting mapping alone.
for (const annotation of ['CapacitorPlugin', 'Permission', 'PermissionCallback', 'ActivityCallback']) {
  const name = `com.getcapacitor.annotation.${annotation}`;
  assert.ok(mapping.includes(`\n${name} -> ${name}:\n`), `Annotation removed/renamed: ${name}`);
}

function walk(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? walk(path.join(directory, entry.name), relative) : [relative];
  });
}
// Domain association documents are served by HTTPS, never by the app's local
// origin. Android's established AAPT dot-directory rule intentionally omits them.
const assets = walk('dist').filter(asset => !asset.startsWith('.well-known/'));
for (const asset of assets) {
  assert.equal(hash(unzip(`assets/public/${asset}`)), hash(fs.readFileSync(path.join('dist', asset))), `Packaged web asset differs: ${asset}`);
}
const config = JSON.parse(unzip('assets/capacitor.config.json').toString());
assert.equal(config.plugins.LiveUpdates.appId, '044c03e1');
assert.equal(config.plugins.LiveUpdates.channel, 'Production');
assert.equal(config.server, undefined);
const output = {
  ok: true, apk, apk_sha256: hash(fs.readFileSync(apk)), apk_bytes: fs.statSync(apk).size,
  r8_version: '8.13.19', mapped_classes: classes.length, renamed_classes: renamed,
  mapped_class_rename_percent: Number((renamed / classes.length * 100).toFixed(2)),
  google_play_proprietary_optimization_score: 'not measured; requires Play processing',
  native_plugins_checked: Object.keys(required), exact_web_assets_checked: assets.length,
  live_update_channel: 'Production', provider_calls: false,
};
console.log(JSON.stringify(output, null, 2));
