#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const handlersRoot = path.join(repoRoot, 'base44/functions/getAdminOperationsDashboardSummary/handlers');

function loadHandler(relativePath, { env = {}, fetchImpl } = {}) {
  const filePath = path.join(handlersRoot, relativePath, 'entry.ts');
  let source = fs.readFileSync(filePath, 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/: Request/g, '')
    .replace('export default async function handler', 'globalThis.__handler = async function handler');
  const context = vm.createContext({
    console,
    URL,
    URLSearchParams,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    RegExp,
    JSON,
    Error,
    Response,
    Promise,
    Intl,
    createClientFromRequest: req => req.__base44,
    handleAdminDataSummary: () => { throw new Error('unexpected admin data summary dispatch'); },
    fetch: fetchImpl || (async () => { throw new Error('unexpected external request'); }),
    Deno: { env: { get: key => env[key] || '' } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return context.globalThis.__handler;
}

function matches(row, filter) {
  return Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
}

function createStore(seed = {}) {
  const rows = new Map(Object.entries(seed).map(([name, values]) => [name, values.map(value => ({ ...value }))]));
  const writes = [];
  let nextId = 1;
  const entity = name => ({
    list: async (_sort, limit = 500) => (rows.get(name) || []).slice(0, limit).map(value => ({ ...value })),
    filter: async (filter, _sort, limit = 500) => (rows.get(name) || []).filter(row => matches(row, filter)).slice(0, limit).map(value => ({ ...value })),
    create: async payload => {
      const record = {
        id: payload.id || `${name.toLowerCase()}_${nextId++}`,
        created_date: payload.created_date || '2026-08-08T12:00:00.000Z',
        updated_date: payload.updated_date || '2026-08-08T12:00:00.000Z',
        ...payload,
      };
      rows.set(name, [...(rows.get(name) || []), record]);
      writes.push({ entity: name, action: 'create', payload: { ...payload } });
      return { ...record };
    },
    update: async (id, payload) => {
      const currentRows = rows.get(name) || [];
      const index = currentRows.findIndex(row => row.id === id);
      if (index < 0) throw new Error(`${name} not found`);
      const record = { ...currentRows[index], ...payload, updated_date: '2026-08-08T12:01:00.000Z' };
      currentRows[index] = record;
      rows.set(name, currentRows);
      writes.push({ entity: name, action: 'update', id, payload: { ...payload } });
      return { ...record };
    },
  });
  const entities = new Proxy({}, { get: (_target, name) => entity(String(name)) });
  return { rows, writes, entities };
}

function base44For(store, user = { id: 'admin_1', email: 'admin@example.test', role: 'admin' }) {
  return {
    auth: { me: async () => user },
    asServiceRole: { entities: store.entities },
  };
}

function request(base44, body) {
  const req = {
    method: 'POST',
    __base44: base44,
    json: async () => body,
  };
  req.clone = () => req;
  return req;
}

async function invoke(handler, base44, body) {
  const response = await handler(request(base44, body));
  return { status: response.status, body: await response.json() };
}

const results = [];
function pass(name) { results.push(name); }

// Native append-only internal order notes.
{
  const store = createStore({
    Order: [{ id: 'order_1', order_number: 'NV-TEST-1' }],
    ShopifyOrder: [{ id: 'shopify_1', base44_order_id: 'order_1', shopify_order_number: 'NV-TEST-1' }],
    CommandLog: [],
  });
  const handler = loadHandler('appendAdminHubOrderNote');
  const body = { customer_app_order_id: 'order_1', note: 'Synthetic internal note', request_id: 'note_req_1' };
  const first = await invoke(handler, base44For(store), body);
  assert.equal(first.status, 200);
  assert.equal(first.body.appended, true);
  assert.deepEqual(store.writes.map(write => write.entity), ['CommandLog']);
  assert.equal((store.rows.get('CommandLog') || [])[0].notes, 'Synthetic internal note');
  const replay = await invoke(handler, base44For(store), body);
  assert.equal(replay.body.skipped, true);
  assert.equal(store.writes.length, 1);
  const forbidden = await invoke(handler, base44For(createStore(), { role: 'staff' }), body);
  assert.equal(forbidden.status, 403);
  pass('native_order_note_append_only_idempotent_admin_only');
}

// Resources are derived only from Customer App entities.
{
  let externalRequests = 0;
  const handler = loadHandler('getAdminResourcesSummary', { fetchImpl: async () => { externalRequests += 1; throw new Error('blocked'); } });
  const store = createStore({
    User: [{ id: 'user_1', first_name: 'Test', last_name: 'Operator', role: 'admin' }],
    ProductionBatch: [{ id: 'batch_1', equipment_used: ['Cold Press'], production_date: '2026-08-08' }],
    InventoryItem: [],
  });
  const response = await invoke(handler, base44For(store), { limit: 100 });
  assert.equal(response.status, 200);
  assert.equal(response.body.source, 'customer_app_native_resources');
  assert.equal(response.body.summary.team_count, 1);
  assert.equal(response.body.summary.equipment_count, 1);
  assert.equal(externalRequests, 0);
  assert.equal(store.writes.length, 0);
  pass('native_resources_no_hub_request_no_writes');
}

// Event create, update, archive, audit, validation, and replay.
{
  const handler = loadHandler('getAdminCalendarEventsSummary');
  const store = createStore({ Event: [], CommandLog: [] });
  const createBody = {
    operation: 'create_event',
    request_id: 'event_req_create',
    event: { title: 'Synthetic Community Event', date: '2026-08-20', capacity: 25, website_link: 'https://example.test/event' },
  };
  const created = await invoke(handler, base44For(store), createBody);
  assert.equal(created.status, 200);
  assert.equal(created.body.success, true);
  assert.equal(created.body.notifications_sent, false);
  assert.equal((store.rows.get('Event') || []).length, 1);
  assert.equal((store.rows.get('CommandLog') || [])[0].status, 'success');
  const eventId = created.body.event_id;
  const replay = await invoke(handler, base44For(store), createBody);
  assert.equal(replay.body.skipped, true);
  assert.equal((store.rows.get('Event') || []).length, 1);
  const invalid = await invoke(handler, base44For(store), {
    operation: 'update_event', request_id: 'event_req_invalid', event_id: eventId,
    event: { title: 'Invalid URL', date: '2026-08-20', website_link: 'http://example.test' },
  });
  assert.equal(invalid.status, 400);
  const forbidden = await invoke(handler, base44For(createStore(), { role: 'staff' }), createBody);
  assert.equal(forbidden.status, 403);
  const archived = await invoke(handler, base44For(store), { operation: 'archive_event', request_id: 'event_req_archive', event_id: eventId });
  assert.equal(archived.status, 200);
  assert.equal((store.rows.get('Event') || [])[0].is_active, false);
  pass('native_event_lifecycle_audited_validated_idempotent');
}

// Non-food inventory preview/import excludes Honey and supports audited native edits.
{
  let externalRequests = 0;
  const hubData = {
    success: true,
    items: [
      { id: 'hub_labels', ingredient: 'Bottle Labels', category: 'Packaging', unit: 'units', stock: 20, reorder_point: 10, max_stock: 100, status: 'ok' },
      { id: 'hub_honey', ingredient: 'Honey', category: 'Other', unit: 'lbs', stock: 0, reorder_point: 5, status: 'out_of_stock' },
      { id: 'hub_orange', ingredient: 'Orange', category: 'Produce', unit: 'lbs', stock: 0, reorder_point: 5, status: 'out_of_stock' },
    ],
    procurement_plan: [],
    open_purchase_orders: [],
  };
  const handler = loadHandler('getAdminInventoryStatusSummary', {
    env: { HUB_API_URL: 'https://hub.example.test/functions/inventory', CUSTOMER_APP_SYNC_SECRET: 'synthetic' },
    fetchImpl: async () => {
      externalRequests += 1;
      return new Response(JSON.stringify(hubData), { status: 200 });
    },
  });
  const store = createStore({ InventoryItem: [], PurchaseOrder: [], CommandLog: [] });
  const daily = await invoke(handler, base44For(store), { limit: 100 });
  assert.equal(daily.status, 200);
  assert.equal(daily.body.source, 'customer_app_native_inventory_authoritative');
  assert.equal(daily.body.data_sources.hub_operational_dependency, false);
  assert.equal(daily.body.data_sources.food_inventory_policy, 'food_and_juice_make_to_order');
  assert.equal(externalRequests, 0);
  const forbidden = await invoke(handler, base44For(createStore(), { role: 'staff' }), { operation: 'preview_non_food_import', limit: 100 });
  assert.equal(forbidden.status, 403);
  const preview = await invoke(handler, base44For(store), { operation: 'preview_non_food_import', limit: 100 });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.candidate_count, 1);
  assert.equal(externalRequests, 1);
  assert.equal(preview.body.candidates[0].ingredient, 'Bottle Labels');
  assert.equal(store.writes.length, 0);

  const executeBody = { operation: 'execute_non_food_import', request_id: 'inventory_import_1', expected_count: 1, confirm: true, limit: 100 };
  const imported = await invoke(handler, base44For(store), executeBody);
  assert.equal(imported.status, 200);
  assert.equal(imported.body.imported_count, 1);
  assert.equal((store.rows.get('InventoryItem') || []).length, 1);
  assert.equal((store.rows.get('CommandLog') || [])[0].status, 'success');
  const replay = await invoke(handler, base44For(store), executeBody);
  assert.equal(replay.body.skipped, true);
  assert.equal((store.rows.get('InventoryItem') || []).length, 1);

  const current = (store.rows.get('InventoryItem') || [])[0];
  const updateBody = {
    operation: 'update_native_item', item_id: current.id, expected_updated_date: current.updated_date,
    request_id: 'inventory_update_1', confirm: true,
    item: { ...current, stock: 35, reorder_point: 10, max_stock: 100, category: 'Packaging', unit: 'units' },
  };
  const updated = await invoke(handler, base44For(store), updateBody);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.item.stock, 35);
  assert.equal(updated.body.customer_notifications, false);
  const stale = await invoke(handler, base44For(store), { ...updateBody, request_id: 'inventory_update_stale', expected_updated_date: '2026-01-01T00:00:00.000Z' });
  assert.equal(stale.status, 409);
  pass('non_food_inventory_cutover_and_edit_audited_idempotent');
}

// The operator UI cannot expose legacy source mutation controls.
{
  const productionUi = fs.readFileSync(path.join(repoRoot, 'src/pages/admin/ProductionQueueSummary.jsx'), 'utf8');
  const deliveryUi = fs.readFileSync(path.join(repoRoot, 'src/pages/admin/DeliveryQueue.jsx'), 'utf8');
  assert.match(productionUi, /const HISTORICAL_SOURCE_ACTIONS_RETIRED = true/);
  assert.match(productionUi, /legacy Start, Complete, Verify, correction, cascade, and inventory actions are retired/);
  assert.match(deliveryUi, /const HISTORICAL_DELIVERY_ACTIONS_RETIRED = true/);
  assert.match(deliveryUi, /Assignment and delivery changes must use a Customer App fulfillment task/);
  pass('historical_production_delivery_mutations_retired');
}

console.log(JSON.stringify({
  suite: 'G93 Customer App operator retirement',
  passed: results.length,
  failed: 0,
  results,
  production_invocations: 0,
  provider_calls: 0,
}, null, 2));
