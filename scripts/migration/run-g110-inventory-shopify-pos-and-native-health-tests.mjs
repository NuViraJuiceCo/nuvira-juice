#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const handlerPath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminInventoryStatusSummary/entry.ts';
const handlerSource = read(handlerPath);
const schemaSource = read('base44/entities/InventoryItem.jsonc');
const uiSource = read('src/pages/admin/InventoryStatus.jsx');
const gatewaySource = read('base44/functions/getAdminOperationsDashboardSummary/entry.ts');
const clientSource = read('src/api/base44Client.js');
const healthSource = read('base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminSyncHealthSummary/entry.ts');
const healthUiSource = read('src/pages/admin/SyncHealth.jsx');
const runtimeSource = read('scripts/migration/run-g55-live-backend-readiness-runtime-check.js');
const criticalSource = read('scripts/ci/run-critical-regressions.mjs');

const schema = JSON.parse(schemaSource);
for (const field of [
  'inventory_kind', 'count_status', 'linked_product_id', 'shopify_sync_enabled',
  'shopify_inventory_item_id', 'shopify_location_id', 'shopify_available_quantity',
  'shopify_sync_status',
]) assert.ok(schema.properties[field], `missing InventoryItem.${field}`);
assert.deepEqual(schema.properties.count_status.enum, ['pending_count', 'verified']);
assert.ok(schema.properties.inventory_kind.enum.includes('label'));
assert.ok(schema.properties.inventory_kind.enum.includes('bag'));

assert.match(handlerSource, /create_native_item/);
assert.match(handlerSource, /count_required/);
assert.match(handlerSource, /preview_shopify_inventory_link/);
assert.match(handlerSource, /create_shopify_bag_product/);
assert.match(handlerSource, /sync_shopify_inventory_quantity/);
assert.match(handlerSource, /inventorySetQuantities/);
assert.match(handlerSource, /compareQuantity/);
assert.match(handlerSource, /Idempotency-Key/);
assert.match(handlerSource, /shopify_inventory_authority: 'shopify_pos'/);
assert.match(handlerSource, /customer_notifications_sent: false/);
assert.match(handlerSource, /Use the Shopify POS quantity control/);

assert.match(uiSource, /Add item/);
assert.match(uiSource, /Product label/);
assert.match(uiSource, /Physical count completed/);
assert.match(uiSource, /Shopify POS Bag Inventory/);
assert.match(uiSource, /guarded compare-and-set/);
assert.match(uiSource, /Create and publish to Shopify POS/);

assert.match(gatewaySource, /g110-native-inventory-shopify-pos-and-health-20260810/);
assert.match(gatewaySource, /"getAdminNativeSystemHealth": handler24/);
assert.match(gatewaySource, /"maintainAdminOperationalNotices": handler46/);
assert.match(clientSource, /'getAdminNativeSystemHealth'/);
assert.match(clientSource, /'maintainAdminOperationalNotices'/);
assert.doesNotMatch(healthSource, /getSyncHealthSummaryForCustomerApp|HUB_API_URL|CUSTOMER_APP_SYNC_SECRET/);
assert.match(healthSource, /authority: 'customer_app_native'/);
assert.match(healthSource, /provider_calls_performed: false/);
assert.match(healthUiSource, /getAdminNativeSystemHealth/);
assert.match(healthUiSource, /Customer App authoritative/);
assert.match(runtimeSource, /gateway_action: name/);
assert.match(criticalSource, /run-g110-inventory-shopify-pos-and-native-health-tests\.mjs/);

function loadHandler(fetchImpl = async () => { throw new Error('unexpected provider call'); }) {
  let source = handlerSource
    .replace(/^import .*$/gm, '')
    .replace(/: Request/g, '')
    .replace('export default async function handler', 'globalThis.__handler = async function handler');
  const context = vm.createContext({
    console, URL, URLSearchParams, Headers, Date, Math, Number, String, Boolean, Array,
    Object, Set, Map, RegExp, JSON, Error, Response, Promise, Intl,
    createClientFromRequest: req => req.__base44,
    fetch: fetchImpl,
    Deno: { env: { get: key => ({ SHOPIFY_STORE_URL: 'shop.example.test', SHOPIFY_API_TOKEN: 'synthetic-token' }[key] || '') } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: handlerPath });
  return context.globalThis.__handler;
}

function matches(row, filter) {
  return Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
}

function store(seed = {}) {
  const rows = new Map(Object.entries(seed).map(([name, values]) => [name, values.map(value => ({ ...value }))]));
  const writes = [];
  let nextId = 1;
  const entity = name => ({
    list: async (_sort, limit = 500) => (rows.get(name) || []).slice(0, limit).map(value => ({ ...value })),
    filter: async (filter, _sort, limit = 500) => (rows.get(name) || []).filter(row => matches(row, filter)).slice(0, limit).map(value => ({ ...value })),
    create: async payload => {
      const record = { id: `${name.toLowerCase()}_${nextId++}`, created_date: '2026-08-10T12:00:00.000Z', updated_date: '2026-08-10T12:00:00.000Z', ...payload };
      rows.set(name, [...(rows.get(name) || []), record]);
      writes.push({ entity: name, action: 'create', payload });
      return { ...record };
    },
    update: async (id, payload) => {
      const values = rows.get(name) || [];
      const index = values.findIndex(row => row.id === id);
      if (index < 0) throw new Error(`${name} not found`);
      values[index] = { ...values[index], ...payload, updated_date: '2026-08-10T12:01:00.000Z' };
      writes.push({ entity: name, action: 'update', id, payload });
      return { ...values[index] };
    },
  });
  const entities = new Proxy({}, { get: (_target, name) => entity(String(name)) });
  return { rows, writes, base44: { auth: { me: async () => ({ id: 'admin', email: 'admin@example.test', role: 'admin' }) }, asServiceRole: { entities } } };
}

async function invoke(handler, state, body) {
  const response = await handler({ method: 'POST', __base44: state.base44, json: async () => body });
  return { status: response.status, body: await response.json() };
}

const product = { id: 'product_aura', title: 'AURA', category: 'juice', price: 12, is_available: true };
const state = store({ InventoryItem: [], PurchaseOrder: [], Product: [product], CommandLog: [] });
const handler = loadHandler();
const created = await invoke(handler, state, {
  operation: 'create_native_item', request_id: 'create_label_1', confirm: true,
  item: {
    ingredient: 'AURA Label', inventory_kind: 'label', linked_product_id: product.id,
    unit: 'units', stock: '', count_status: 'pending_count', reorder_point: 25,
    max_stock: 200, category: 'Packaging', supplier: '', location: '', notes: '',
  },
});
assert.equal(created.status, 200);
assert.equal(created.body.item.status, 'count_required');
assert.equal(created.body.item.stock_authoritative, false);
assert.equal(created.body.customer_notifications, false);
assert.equal((state.rows.get('InventoryItem') || []).length, 1);
const summary = await invoke(handler, state, { limit: 100 });
assert.equal(summary.status, 200);
assert.equal(summary.body.summary.count_required_count, 1);
assert.equal(summary.body.summary.out_of_stock_count, 0);
assert.equal(summary.body.procurement_plan.length, 0);
assert.equal(summary.body.provider_calls_performed, false);

let providerCalls = 0;
const bag = {
  id: 'inventory_bag', ingredient: 'Large NuVira Tote Bag', inventory_kind: 'bag',
  linked_product_id: 'product_bag', linked_product_title: 'Large NuVira Tote Bag',
  unit: 'units', stock: 8, count_status: 'verified', reorder_point: 2, max_stock: 20,
  category: 'Packaging', updated_date: '2026-08-10T12:00:00.000Z',
};
const bagState = store({ InventoryItem: [bag], PurchaseOrder: [], Product: [{ id: 'product_bag', title: 'Large NuVira Tote Bag', category: 'merch', price: 18, is_available: true }], CommandLog: [] });
const previewHandler = loadHandler(async (_url, options) => {
  providerCalls += 1;
  const request = JSON.parse(options.body);
  assert.match(request.query, /InventoryConnectionPreview/);
  return new Response(JSON.stringify({ data: {
    products: { nodes: [] },
    locations: { nodes: [{ id: 'gid://shopify/Location/1', name: 'POS', isActive: true }] },
    publications: { nodes: [{ id: 'gid://shopify/Publication/1', name: 'Point of Sale' }] },
  } }), { status: 200 });
});
const preview = await invoke(previewHandler, bagState, { operation: 'preview_shopify_inventory_link', item_id: bag.id });
assert.equal(preview.status, 200);
assert.equal(preview.body.read_only, true);
assert.equal(preview.body.creation_ready, true);
assert.equal(preview.body.writes_performed, false);
assert.equal(providerCalls, 1);
assert.equal(bagState.writes.length, 0);

console.log(JSON.stringify({
  success: true,
  suite: 'g110-inventory-shopify-pos-and-native-health',
  cases: 5,
  writes_limited_to_test_store: true,
  live_provider_calls_performed: false,
  customer_notifications_sent: false,
}, null, 2));
