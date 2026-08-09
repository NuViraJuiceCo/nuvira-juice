#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const results = [];

function loadHandler(relativePath, hubData) {
  const functionPath = path.join(root, relativePath);
  let fetchCount = 0;
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source = source.replace('export default async function handler(req: Request)', 'globalThis.__handler = async function handler(req)');
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Intl, Math, Number, String, Boolean, Array,
    Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    createClientFromRequest: req => req.__base44,
    fetch: async () => {
      fetchCount += 1;
      return new Response(JSON.stringify(hubData), { status: 200 });
    },
    Deno: { env: { get: () => 'synthetic-configured-value' } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return { handler: context.globalThis.__handler, getFetchCount: () => fetchCount };
}

function emptyBase44() {
  const writes = [];
  const entity = name => ({
    filter: async () => [],
    list: async () => [],
    create: async payload => { writes.push({ name, action: 'create', payload }); throw new Error('unexpected write'); },
    update: async (id, payload) => { writes.push({ name, action: 'update', id, payload }); throw new Error('unexpected write'); },
  });
  return {
    writes,
    client: {
      auth: { me: async () => ({ id: 'synthetic_admin', role: 'admin' }) },
      asServiceRole: {
        entities: {
          Order: entity('Order'),
          ShopifyOrder: entity('ShopifyOrder'),
          FulfillmentTask: entity('FulfillmentTask'),
          CommandLog: entity('CommandLog'),
        },
      },
    },
  };
}

async function invoke(relativePath, hubData, body) {
  const { handler, getFetchCount } = loadHandler(relativePath, hubData);
  const { client, writes } = emptyBase44();
  const response = await handler({
    method: 'POST',
    __base44: client,
    json: async () => body,
  });
  return { status: response.status, payload: await response.json(), fetchCount: getFetchCount(), writes };
}

const timelinePath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminOrderTimeline/entry.ts';
const timelineHub = {
  success: true,
  matched_by: 'historical_order_number',
  order_number: 'NV-HISTORICAL',
  events: [{ type: 'created', label: 'Historical event', timestamp: '2026-01-01T00:00:00Z', source: 'Historical source' }],
};
const timelineDefault = await invoke(timelinePath, timelineHub, { order_number: 'NV-SYNTHETIC' });
assert.equal(timelineDefault.status, 200);
assert.equal(timelineDefault.fetchCount, 0);
assert.equal(timelineDefault.payload.source, 'customer_app_native');
assert.equal(timelineDefault.payload.events.length, 0);
assert.equal(timelineDefault.payload.hub_operational_dependency, false);
assert.equal(timelineDefault.writes.length, 0);
results.push('native_order_timeline_does_not_fetch_hub_by_default');

const timelineHistory = await invoke(timelinePath, timelineHub, {
  order_number: 'NV-SYNTHETIC',
  include_hub_historical_context: true,
});
assert.equal(timelineHistory.fetchCount, 1);
assert.equal(timelineHistory.payload.source, 'hub_historical_context');
assert.equal(timelineHistory.payload.events.length, 1);
assert.equal(timelineHistory.payload.hub_operational_dependency, false);
results.push('order_timeline_hub_access_is_explicit_historical_context_only');

const detailsPath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminFulfillmentTaskDetails/entry.ts';
const detailsHub = {
  success: true,
  matched_by: 'historical_order_number',
  tasks: [{ id: 'historical_task', order_number: 'NV-HISTORICAL', status: 'delivered' }],
};
const detailsDefault = await invoke(detailsPath, detailsHub, { order_number: 'NV-SYNTHETIC' });
assert.equal(detailsDefault.status, 200);
assert.equal(detailsDefault.fetchCount, 0);
assert.equal(detailsDefault.payload.source, 'customer_app_native');
assert.equal(detailsDefault.payload.tasks.length, 0);
assert.equal(detailsDefault.payload.hub_operational_dependency, false);
assert.equal(detailsDefault.writes.length, 0);
results.push('native_fulfillment_details_do_not_fetch_hub_by_default');

const detailsHistory = await invoke(detailsPath, detailsHub, {
  order_number: 'NV-SYNTHETIC',
  include_hub_historical_context: true,
});
assert.equal(detailsHistory.fetchCount, 1);
assert.equal(detailsHistory.payload.source, 'hub_historical_context');
assert.equal(detailsHistory.payload.tasks.length, 1);
assert.equal(detailsHistory.payload.hub_operational_dependency, false);
results.push('fulfillment_detail_hub_access_is_explicit_historical_context_only');

const authorityFiles = [
  'getAdminOperationsDashboardSummary',
  'getAdminProductionQueueSummary',
  'getAdminProductionPlanningSummary',
  'getAdminDeliveryRouteSummary',
  'getAdminCalendarEventsSummary',
  'getAdminOpsAlertsSummary',
  'getAdminComplianceOpsSummary',
  'getAdminInventoryStatusSummary',
  'getAdminOrdersWithHub',
];
for (const handlerName of authorityFiles) {
  const source = fs.readFileSync(path.join(root, `base44/functions/getAdminOperationsDashboardSummary/handlers/${handlerName}/entry.ts`), 'utf8');
  assert.ok(source.includes('hub_operational_dependency: false'), `${handlerName} must declare no Hub operational dependency`);
}
results.push('daily_dashboard_production_delivery_events_alerts_compliance_inventory_and_orders_declare_native_authority');

const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
const nav = fs.readFileSync(path.join(root, 'src/components/layout/adminNavItems.js'), 'utf8');
assert.ok(app.includes('path="/admin/sync-health"'));
assert.ok(app.includes('<Navigate to="/admin/operations" replace />'));
assert.equal(nav.includes("label: 'System Health'"), false);
results.push('legacy_sync_health_surface_is_retired_with_saved_link_redirect');

console.log(JSON.stringify({
  success: true,
  suite: 'g94-hub-operational-read-retirement',
  cases: results.length,
  results,
  writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
  hub_mutation_performed: false,
}, null, 2));
