#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const checks = [];
const read = file => fs.readFileSync(file, 'utf8');
function load(file, imports = {}) {
  const module = { exports: {} };
  const { code } = transformSync(read(file), { loader: file.endsWith('.jsx') ? 'jsx' : 'js', format: 'cjs' });
  vm.runInNewContext(code, { module, exports: module.exports, Intl, Date, require: name => {
    assert.ok(name in imports, `Unexpected import ${name}`);
    return imports[name];
  } });
  return module.exports;
}
const dates = load('src/lib/businessDate.js');
for (const [instant, date, time] of [
  ['2026-10-08T00:30:00Z', '2026-10-07', '19:30'],
  ['2026-01-01T05:59:00Z', '2025-12-31', '23:59'],
  ['2026-01-01T06:00:00Z', '2026-01-01', '00:00'],
  ['2026-03-08T07:59:00Z', '2026-03-08', '01:59'],
  ['2026-03-08T08:00:00Z', '2026-03-08', '03:00'],
  ['2026-11-01T07:00:00Z', '2026-11-01', '01:00'],
]) {
  const actual = dates.businessDateTime(new Date(instant));
  assert.equal(actual.date, date);
  assert.equal(actual.time, time);
  assert.equal(dates.businessDate(new Date(instant)), date);
}
checks.push('Chicago date/time defaults handle UTC rollover, New Year and both DST transitions');

const envelope = load('src/lib/base44-result.js');
const { requireConfirmedAdminWrite } = load('src/lib/confirmedAdminWrite.js', { './base44-result': envelope });
for (const response of [{ success: true }, { data: { success: true } }, { data: '{"success":true}' }]) {
  assert.equal(requireConfirmedAdminWrite(response).success, true);
}
for (const response of [undefined, null, {}, { data: {} }, { data: { success: false } }, { data: 'invalid' }, { success: 'true' }]) {
  assert.throws(() => requireConfirmedAdminWrite(response), /could not be confirmed/);
}
checks.push('Only explicit successful saves close compliance forms, including SDK string envelopes');

const { adminStatusTone, AdminStatusPill } = load('src/components/admin/AdminStatusPill.jsx', { react: React });
for (const status of ['unpaid', 'unverified', 'inactive', 'unknown', 'unavailable', 'not_ready']) {
  assert.equal(adminStatusTone(status), 'warning');
}
for (const status of ['paid', 'verified', 'ready', 'delivered']) assert.equal(adminStatusTone(status), 'success');
assert.match(renderToStaticMarkup(React.createElement(AdminStatusPill, { value: 'unpaid' })), /data-admin-tone="warning"/);
checks.push('Negative and unavailable states cannot inherit positive status styling');

const Icon = () => React.createElement('svg', { 'aria-hidden': true });
const icons = new Proxy({}, { get: () => Icon });
const QueryState = load('src/components/admin/AdminQueryState.jsx', { react: React, 'lucide-react': icons }).default;
const errorHtml = renderToStaticMarkup(React.createElement(QueryState, { error: true, retry: () => {} }));
assert.match(errorHtml, /role="alert"/);
assert.match(errorHtml, /Counts and readiness are unknown/);
assert.match(errorHtml, /Retry/);
assert.doesNotMatch(errorHtml, /No blockers|Clear|Ready/);
assert.match(renderToStaticMarkup(React.createElement(QueryState, { loading: true })), /role="status"/);
checks.push('Read failures are accessible, retryable and never represented as clear or zero activity');

const { browserAdminGroups } = load('src/components/admin/BrowserAdminNav.jsx', {
  react: React, 'react-router-dom': {}, 'lucide-react': icons,
  '@/components/ui/dialog': {}, '@/lib/brandImages': {},
});
const navPaths = browserAdminGroups.flatMap(group => group.items.map(([, slug]) => `/admin/${slug}`));
const routedPaths = [...read('src/App.jsx').matchAll(/path="(\/admin\/[^\"]+)"\s+element=\{<AdminProtectedRoute element=\{<(\w+)/g)]
  .filter(match => match[2] !== 'Navigate').map(match => match[1]);
assert.equal(navPaths.length, 25);
assert.equal(new Set(navPaths).size, 25);
assert.deepEqual([...navPaths].sort(), routedPaths.sort());
checks.push('All 25 protected admin routes have unique navigation destinations');

const layout = read('src/components/layout/AppLayout.jsx');
assert.match(layout, /adminShell && !isNativeAppRuntime\(\)/);
assert.match(layout, /removeAttribute\('data-browser-admin'\)/);
assert.match(layout, /<BrowserAdminNav\s*\/>/);
const css = read('src/styles/browser-admin.css');
assert.match(css, /html\[data-browser-admin="true"\]/);
assert.match(css, /\.nv-browser-admin/);
assert.doesNotMatch(read('src/index.css'), /\.dark\s/);
checks.push('Admin palette is explicitly scoped and global dark overrides exclude the browser admin root');

for (const form of ['TemperatureLogForm', 'pHLogForm', 'CCPLogForm', 'SanitationLogForm', 'CorrectiveActionForm', 'DailyChecklistForm']) {
  const source = read(`src/components/compliance/${form}.jsx`);
  assert.match(source, /businessDateTime/);
  assert.match(source, /requireConfirmedAdminWrite\(await base44\.functions\.invoke/);
  assert.match(source, /setSaveError/);
  assert.match(source, /role="alert"/);
}
for (const file of ['src/pages/admin/AdminEvents.jsx', 'src/pages/admin/DiscountCodes.jsx', 'src/components/admin/BrowserAdminNav.jsx']) {
  const source = read(file);
  assert.match(source, /DialogTitle/);
  assert.match(source, /onCloseAutoFocus/);
}
assert.match(read('src/pages/admin/AdminEvents.jsx'), /timingFilter === 'past'/);
checks.push('Compliance failure feedback and keyboard dialog focus restoration remain wired');
console.log(JSON.stringify({ ok: true, suite: 'browser-admin-refresh', checks, protected_routes: navPaths.length, network_requests: 0, production_writes: false }, null, 2));
