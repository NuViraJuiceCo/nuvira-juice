#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as inventoryPolicy from '../../base44/functions/getAdminOperationsDashboardSummary/inventoryPolicy.js';

const read = file => fs.readFileSync(file, 'utf8');
const checks = [];
const gateway = 'base44/functions/getAdminOperationsDashboardSummary/handlers';
function load(file, imports, globals = {}) {
  const module = { exports: {} };
  const { code } = transformSync(read(file), { loader: file.endsWith('.ts') ? 'ts' : 'js', format: 'cjs' });
  vm.runInNewContext(code, { module, exports: module.exports, console, Date, Intl, URL, URLSearchParams, Response,
    ...globals, require: name => {
      assert.ok(name in imports, `Unexpected import ${name}`);
      return imports[name];
    },
  });
  return module.exports;
}
const envelope = load('src/lib/base44-result.js', {});
const { requireConfirmedAdminWrite } = load('src/lib/confirmedAdminWrite.js', { './base44-result': envelope });
for (const response of [null, undefined, {}, { data: {} }, { success: false }, { success: 'true' }, { data: '{"success":false}' }, { data: 'invalid' }]) {
  assert.throws(() => requireConfirmedAdminWrite(response), /could not be confirmed/);
}
for (const response of [{ success: true }, { data: { success: true } }, { data: '{"success":true}' }]) {
  assert.equal(requireConfirmedAdminWrite(response).success, true);
}
checks.push('Explicit successful save required, including SDK string envelopes');
const events = read('src/pages/admin/AdminEvents.jsx');
const inventoryUi = read('src/pages/admin/InventoryStatus.jsx');
assert.match(events.slice(events.indexOf('const eventMutation')), /return requireConfirmedAdminWrite\(result\)/);
assert.equal((inventoryUi.match(/return requireConfirmedAdminWrite\(result\)/g) || []).length, 3);
for (const source of [events, inventoryUi]) {
  assert.match(source, /role="alert"[^>]*>\{error\}/);
  assert.match(source, /if \(error\) errorRef.current\?\.focus\(\)/);
  assert.match(source, /role="alert" tabIndex=\{-1\}/);
  assert.match(source, /Your entries are still here/);
  assert.match(source, /before retrying to avoid a duplicate/);
}
checks.push('Event, inventory item, import and Shopify responses require confirmation; editor errors remain inside dialogs');

const alertsUi = read('src/pages/admin/OpsAlerts.jsx');
assert.match(alertsUi, /\[statusFilter, setStatusFilter\] = useState\('active'\)/);
assert.match(alertsUi, /<option value="active">Active Inbox<\/option>/);
assert.match(alertsUi, /<option value="all">All Statuses<\/option>/);
assert.match(alertsUi, /if \(statusFilter !== 'all'\) payload.status = statusFilter/);
checks.push('Active Inbox sends active status while All Statuses deliberately omits the filter');

const rows = [
  ...Array.from({ length: 10 }, (_, index) => ({ id: `pending_${index}`, ingredient: `Label ${index}`, category: 'Packaging', inventory_kind: 'label', stock: 0, count_status: 'pending_count' })),
  { id: 'honey', ingredient: ' Honey! ', category: 'Other', stock: 0 },
  { id: 'produce', ingredient: 'Carrot', category: 'Produce', stock: 0 },
];
for (const row of rows.slice(0, 10)) assert.equal(inventoryPolicy.deriveInventoryStatus(row), 'count_required');
for (const row of rows.slice(10)) assert.equal(inventoryPolicy.deriveInventoryStatus(row), 'demand_based');
for (const stock of [undefined, null, '', ' ', 'invalid']) {
  assert.equal(inventoryPolicy.deriveInventoryStatus({ stock }), 'count_required');
  assert.equal(inventoryPolicy.deriveInventoryStatus({ stock, count_status: 'verified' }), 'count_required');
  assert.equal(inventoryPolicy.countStatus({ stock, count_status: 'verified' }), 'pending_count');
}
for (const [stock, expected] of [[0, 'out_of_stock'], [2, 'critical'], [7, 'low'], [11, 'ok']]) {
  assert.equal(inventoryPolicy.deriveInventoryStatus({ stock, reorder_point: 10, count_status: 'verified' }), expected);
}
assert.equal(inventoryPolicy.deriveInventoryStatus({ stock: 10, count_status: 'verified', shopify_sync_status: 'error' }), 'sync_error');
checks.push('One inventory policy distinguishes pending counts, food, verified stock thresholds and sync failures');

let writeAttempts = 0;
let externalCalls = 0;
function backend(entityRows = {}, role = 'admin') {
  const blockWrite = () => { writeAttempts++; throw new Error('Unexpected write'); };
  return {
    auth: { me: async () => role ? ({ role, id: 'synthetic-admin' }) : null },
    asServiceRole: { entities: new Proxy({}, { get: (_, name) => ({
      list: async () => entityRows[name] || [],
      filter: async () => entityRows[name] || [],
      create: blockWrite, update: blockWrite, delete: blockWrite, upsert: blockWrite,
    }) }) },
  };
}
function handler(name) {
  return load(`${gateway}/${name}/entry.ts`, {
    'npm:@base44/sdk@0.8.25': { createClientFromRequest: req => req.__base44 },
    '../../inventoryPolicy.js': inventoryPolicy,
  }, {
    Deno: { env: { get: () => '' } },
    fetch: () => { externalCalls++; throw new Error('Unexpected external call'); },
  }).default;
}
async function call(name, body, entityRows = {}, role = 'admin') {
  const response = await handler(name)({ json: async () => body, __base44: backend(entityRows, role) });
  return { status: response.status, data: await response.json() };
}
for (const name of ['getAdminInventoryStatusSummary', 'getAdminOperationsDashboardSummary']) {
  assert.equal((await call(name, {}, {}, null)).status, 401);
  assert.equal((await call(name, {}, {}, 'member')).status, 403);
}
checks.push('Shared classification does not weaken inventory or Operations authorization');
const inv = await call('getAdminInventoryStatusSummary', { limit: 200 }, { InventoryItem: rows });
const ops = await call('getAdminOperationsDashboardSummary', { preset: 'today' }, { InventoryItem: rows });
assert.equal(inv.status, 200);
assert.equal(ops.status, 200);
assert.equal(inv.data.summary.count_required_count, 10);
assert.equal(ops.data.summary.inventory.count_required, 10);
assert.equal(ops.data.summary.inventory.out_of_stock, 0);
assert.equal(inv.data.summary.out_of_stock_count, 0);
assert.equal(ops.data.summary.inventory.stock_tracked, inv.data.summary.stock_tracked_item_count);
assert.equal(ops.data.summary.inventory.demand_based_food, 2);
checks.push('Actual inventory and Operations handlers agree on 10 pending non-food rows and exclude food stockouts');

const missingCount = await call('getAdminInventoryStatusSummary', {}, {
  InventoryItem: [{ id: 'missing', ingredient: 'Bottle', category: 'Packaging', stock: null, count_status: 'verified' }],
});
assert.equal(missingCount.data.items[0].count_status, 'pending_count');
assert.equal(missingCount.data.items[0].stock_authoritative, false);
assert.equal(missingCount.data.items[0].status, 'count_required');
checks.push('Missing quantities cannot remain authoritative even when a legacy row says verified');

const countedRows = [
  { id: 'out', ingredient: 'Bottle', category: 'Packaging', stock: 0, count_status: 'verified' },
  { id: 'critical', ingredient: 'Cap', category: 'Packaging', stock: 2, reorder_point: 10, count_status: 'verified' },
  { id: 'low', ingredient: 'Label', category: 'Packaging', stock: 7, reorder_point: 10, count_status: 'verified' },
  { id: 'sync', ingredient: 'Bag', inventory_kind: 'bag', category: 'Packaging', stock: 20, count_status: 'verified', shopify_sync_status: 'error' },
  { id: 'pending-sync', ingredient: 'Small bag', inventory_kind: 'bag', category: 'Packaging', stock: null, count_status: 'pending_count', shopify_sync_status: 'error' },
];
const countedInv = (await call('getAdminInventoryStatusSummary', { limit: 200 }, { InventoryItem: countedRows })).data.summary;
const countedOps = (await call('getAdminOperationsDashboardSummary', { preset: 'today' }, { InventoryItem: countedRows })).data.summary.inventory;
for (const [dashboard, inventory] of [['low', 'low_stock_count'], ['critical', 'critical_count'], ['out_of_stock', 'out_of_stock_count'], ['count_required', 'count_required_count'], ['sync_error', 'shopify_sync_error_count']]) {
  assert.equal(countedOps[dashboard], countedInv[inventory]);
}
checks.push('Verified low, critical, out-of-stock and bag sync-error totals stay aligned');
assert.equal(countedOps.count_required, 1);
assert.equal(countedOps.sync_error, 2);
checks.push('An uncounted bag with a sync error appears in both independent attention totals');

const operationsUi = read('src/pages/admin/Operations.jsx');
assert.match(operationsUi, /awaiting verified counts/);
assert.match(operationsUi, /label="Counts Needed" value=\{summary.inventory\?\.count_required\}/);
assert.doesNotMatch(operationsUi, /diagnostic until stock policy is approved/);
assert.match(operationsUi, /badges: \['Verified counts', 'Source-backed'\]/);
assert.match(operationsUi, /inventoryDiagnostics > 0 \? 'Inventory review' : 'Clear'/);
assert.match(operationsUi, /inventoryDiagnostics > 0 \? 'Inventory' : 'Clear'/);
assert.match(operationsUi, /tone=\{exceptionCount > 0 \|\| inventoryDiagnostics > 0 \? 'warning' : 'success'\}/);
checks.push('Operations displays pending counts separately instead of calling them stockouts');
assert.equal(writeAttempts, 0);
assert.equal(externalCalls, 0);
console.log(JSON.stringify({ ok: true, suite: 'admin-postlaunch-reliability', checks, production_writes: false, writeAttempts, externalCalls }, null, 2));
