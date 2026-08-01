#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const packageLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const capacitor = JSON.parse(fs.readFileSync('capacitor.config.json', 'utf8'));
const iosPackage = fs.readFileSync('ios/App/CapApp-SPM/Package.swift', 'utf8');
const androidSettings = fs.readFileSync('android/capacitor.settings.gradle', 'utf8');
const androidDependencies = fs.readFileSync('android/app/capacitor.build.gradle', 'utf8');

const liveUpdates = capacitor.plugins?.LiveUpdates;
const lockedPackage = packageLock.packages?.['node_modules/@capacitor/live-updates'];

assert.equal(packageJson.dependencies?.['@capacitor/live-updates'], '0.5.0');
assert.equal(lockedPackage?.version, '0.5.0');
assert.equal(lockedPackage?.peerDependencies?.['@capacitor/core'], '>=8.0.0');

assert.equal(capacitor.webDir, 'dist');
assert.equal(Object.prototype.hasOwnProperty.call(capacitor, 'server'), false);
assert.equal(liveUpdates?.appId, '044c03e1');
assert.equal(liveUpdates?.channel, 'Production');
assert.equal(liveUpdates?.autoUpdateMethod, 'background');
assert.equal(liveUpdates?.maxVersions, 2);

assert.deepEqual(
  capacitor.plugins?.FirebaseMessaging?.presentationOptions,
  ['alert', 'badge', 'sound'],
);

assert.match(iosPackage, /\.package\(name: "CapacitorLiveUpdates"/);
assert.match(iosPackage, /\.product\(name: "CapacitorLiveUpdates"/);
assert.match(androidSettings, /include ':capacitor-live-updates'/);
assert.match(androidDependencies, /implementation project\(':capacitor-live-updates'\)/);

console.log(JSON.stringify({
  success: true,
  suite: 'g63-capacitor-live-update-bootstrap',
  cases: 14,
  appflow_app_id: liveUpdates.appId,
  channel: liveUpdates.channel,
  update_method: liveUpdates.autoUpdateMethod,
  cached_versions: liveUpdates.maxVersions,
  server_url_present: false,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
