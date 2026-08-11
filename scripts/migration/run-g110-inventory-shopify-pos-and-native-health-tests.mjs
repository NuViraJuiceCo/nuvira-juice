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
const alertHandlerSource = read('base44/functions/getAdminOperationsDashboardSummary/handlers/updateAdminOpsAlertStatus/entry.ts');
const alertUiSource = read('src/pages/admin/OpsAlerts.jsx');

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
assert.match(handlerSource, /activate_shopify_inventory_item/);
assert.match(handlerSource, /create_shopify_bag_product/);
assert.match(handlerSource, /sync_shopify_inventory_quantity/);
assert.match(handlerSource, /inventorySetQuantities/);
assert.match(handlerSource, /compareQuantity/);
assert.match(handlerSource, /Idempotency-Key/);
assert.match(handlerSource, /SHOPIFY_CLIENT_SECRET/);
assert.match(handlerSource, /SHOPIFY_SHARED_SECRET/);
assert.match(handlerSource, /seenSecrets/);
assert.match(handlerSource, /publication_access: publicationAccess/);
assert.match(handlerSource, /shopify_publication_scope_required/);
assert.match(handlerSource, /inventoryItemUpdate/);
assert.match(handlerSource, /ACTIVATE SHOPIFY POS BAG/);
assert.match(handlerSource, /shopify_inventory_authority: 'shopify_pos'/);
assert.match(handlerSource, /customer_notifications_sent: false/);
assert.match(handlerSource, /Use the Shopify POS quantity control/);

assert.match(uiSource, /Add item/);
assert.match(uiSource, /Product label/);
assert.match(uiSource, /Physical count completed/);
assert.match(uiSource, /Shopify POS Bag Inventory/);
assert.match(uiSource, /guarded compare-and-set/);
assert.match(uiSource, /Create and publish to Shopify POS/);
assert.match(uiSource, /preview\.publication_warning/);
assert.match(uiSource, /Activate with \$\{Number\(item\.stock\)\} bags/);
assert.match(uiSource, /operation: 'activate_shopify_inventory_item'/);
assert.doesNotMatch(uiSource, /stock_authoritative === false \|\| item\?\.status === 'demand_based'/);
assert.match(uiSource, /item\?\.stock_tracking_policy === 'food_make_to_order' \|\| item\?\.status === 'demand_based'/);

assert.match(gatewaySource, /g110d-existing-shopify-bag-inventory-activation-20260810/);
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
assert.match(alertUiSource, /invoke\('maintainAdminOperationalNotices'/);
assert.doesNotMatch(alertUiSource, /invoke\('updateAdminOpsAlertStatus'/);
assert.match(alertHandlerSource, /native_operational_alert_status_update/);
assert.match(alertHandlerSource, /entities\.OperationalAlert\.update/);
assert.match(alertHandlerSource, /hub_operational_dependency: false/);
assert.doesNotMatch(alertHandlerSource, /HUB_API_URL|CUSTOMER_APP_SYNC_SECRET|updateOpsAlertStatusForCustomerApp/);

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

function loadAlertHandler() {
  let source = alertHandlerSource
    .replace(/^import .*$/gm, '')
    .replace(/: Request/g, '')
    .replace('export default async function handler', 'globalThis.__handler = async function handler');
  const context = vm.createContext({
    console, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON,
    Error, Response, Promise, Intl,
    createClientFromRequest: req => req.__base44,
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: 'updateAdminOpsAlertStatus/entry.ts' });
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
  if (/InventoryConnectionPreview/.test(request.query)) {
    return new Response(JSON.stringify({ data: {
      products: { nodes: [] },
      locations: { nodes: [{ id: 'gid://shopify/Location/1', name: 'POS', isActive: true }] },
    } }), { status: 200 });
  }
  assert.match(request.query, /PointOfSalePublication/);
  return new Response(JSON.stringify({ data: {
    publications: { nodes: [{ id: 'gid://shopify/Publication/1', name: 'Point of Sale' }] },
  } }), { status: 200 });
});
const preview = await invoke(previewHandler, bagState, { operation: 'preview_shopify_inventory_link', item_id: bag.id });
assert.equal(preview.status, 200);
assert.equal(preview.body.read_only, true);
assert.equal(preview.body.creation_ready, true);
assert.equal(preview.body.writes_performed, false);
assert.equal(providerCalls, 2);
assert.equal(bagState.writes.length, 0);

let scopedProviderCalls = 0;
const scopedPreviewHandler = loadHandler(async (_url, options) => {
  scopedProviderCalls += 1;
  const request = JSON.parse(options.body);
  if (/InventoryConnectionPreview/.test(request.query)) {
    return new Response(JSON.stringify({ data: {
      products: { nodes: [] },
      locations: { nodes: [{ id: 'gid://shopify/Location/1', name: 'POS', isActive: true }] },
    } }), { status: 200 });
  }
  return new Response(JSON.stringify({ errors: [{ message: 'Access denied for publications field.' }] }), { status: 200 });
});
const scopedPreview = await invoke(scopedPreviewHandler, bagState, { operation: 'preview_shopify_inventory_link', item_id: bag.id });
assert.equal(scopedPreview.status, 200);
assert.equal(scopedPreview.body.read_only, true);
assert.equal(scopedPreview.body.publication_access, 'scope_required');
assert.equal(scopedPreview.body.creation_ready, false);
assert.equal(scopedPreview.body.creation_blocker, 'shopify_publication_scope_required');
assert.equal(scopedProviderCalls, 2);
assert.equal(bagState.writes.length, 0);

let activationProviderCalls = 0;
const activationState = store({
  InventoryItem: [bag],
  PurchaseOrder: [],
  Product: [{ id: 'product_bag', title: 'Large NuVira Tote Bag', category: 'merch', price: 18, is_available: true }],
  CommandLog: [],
});
const activationHandler = loadHandler(async (_url, options) => {
  activationProviderCalls += 1;
  const request = JSON.parse(options.body);
  if (/InventoryConnectionPreview/.test(request.query)) {
    return new Response(JSON.stringify({ data: {
      products: { nodes: [{
        id: 'gid://shopify/Product/1', title: 'Large NuVira Tote Bag', handle: 'large-nuvira-tote-bag', status: 'ACTIVE',
        variants: { nodes: [{
          id: 'gid://shopify/ProductVariant/1', title: 'Default', sku: '', price: '18.00',
          inventoryItem: { id: 'gid://shopify/InventoryItem/1', tracked: false, inventoryLevels: { nodes: [{ location: { id: 'gid://shopify/Location/1', name: 'POS' }, quantities: [{ name: 'available', quantity: 0 }] }] } },
        }] },
      }] },
      locations: { nodes: [{ id: 'gid://shopify/Location/1', name: 'POS', isActive: true }] },
    } }), { status: 200 });
  }
  if (/PointOfSalePublication/.test(request.query)) {
    return new Response(JSON.stringify({ errors: [{ message: 'Access denied for publications field.' }] }), { status: 200 });
  }
  if (/TrackPosBagInventory/.test(request.query)) {
    assert.equal(request.variables.id, 'gid://shopify/InventoryItem/1');
    assert.equal(request.variables.input.tracked, true);
    return new Response(JSON.stringify({ data: { inventoryItemUpdate: { inventoryItem: { id: 'gid://shopify/InventoryItem/1', tracked: true }, userErrors: [] } } }), { status: 200 });
  }
  assert.match(request.query, /SetOpeningPosBagQuantity/);
  assert.equal(request.variables.input.quantities[0].quantity, 8);
  assert.equal(request.variables.input.quantities[0].compareQuantity, 0);
  return new Response(JSON.stringify({ data: { inventorySetQuantities: { inventoryAdjustmentGroup: { changes: [{ name: 'available', delta: 8 }] }, userErrors: [] } } }), { status: 200 });
});
const activated = await invoke(activationHandler, activationState, {
  operation: 'activate_shopify_inventory_item', item_id: bag.id,
  request_id: 'activate_existing_bag_1', confirm: true,
  confirmation: 'ACTIVATE SHOPIFY POS BAG',
  shopify_product_id: 'gid://shopify/Product/1',
  shopify_variant_id: 'gid://shopify/ProductVariant/1',
  shopify_inventory_item_id: 'gid://shopify/InventoryItem/1',
  shopify_location_id: 'gid://shopify/Location/1',
});
assert.equal(activated.status, 200);
assert.equal(activated.body.success, true);
assert.equal(activated.body.item.shopify_sync_enabled, true);
assert.equal(activated.body.item.shopify_inventory_authority, 'shopify_pos');
assert.equal(activated.body.item.shopify_available_quantity, 8);
assert.equal(activationProviderCalls, 4);
assert.equal(activationState.rows.get('CommandLog')[0].status, 'success');
assert.equal(activationState.rows.get('Product')[0].shopify_variant_id, 'gid://shopify/ProductVariant/1');

const alertState = store({
  OperationalAlert: [{
    id: 'alert_1', alert_type: 'cancellation', order_number: 'ORDER-1', severity: 'warning',
    title: 'Canceled', message: 'Canceled test order', is_read: false, resolved: false,
    created_date: '2026-08-10T12:00:00.000Z', updated_date: '2026-08-10T12:00:00.000Z',
  }],
  CommandLog: [],
});
const alertHandler = loadAlertHandler();
const alertResult = await invoke(alertHandler, alertState, {
  alert_id: 'alert_1', action: 'resolve', request_id: 'resolve_alert_1',
  resolution_note: 'Terminal test order already cleared.',
});
assert.equal(alertResult.status, 200);
assert.equal(alertResult.body.success, true);
assert.equal(alertResult.body.source, 'customer_app_native');
assert.equal(alertResult.body.hub_operational_dependency, false);
assert.equal(alertState.rows.get('OperationalAlert')[0].resolved, true);
assert.equal(alertState.rows.get('OperationalAlert')[0].is_read, true);
assert.equal(alertState.rows.get('CommandLog')[0].status, 'success');
const alertReplay = await invoke(alertHandler, alertState, {
  alert_id: 'alert_1', action: 'resolve', request_id: 'resolve_alert_1',
});
assert.equal(alertReplay.status, 200);
assert.equal(alertReplay.body.skipped, true);
assert.equal(alertReplay.body.reason, 'duplicate_request_id');

console.log(JSON.stringify({
  success: true,
  suite: 'g110-inventory-shopify-pos-and-native-health',
  cases: 8,
  writes_limited_to_test_store: true,
  live_provider_calls_performed: false,
  customer_notifications_sent: false,
}, null, 2));
