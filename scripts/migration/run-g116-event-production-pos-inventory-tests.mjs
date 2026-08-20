#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const helperPath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/executeNativeProductionBatchLifecycle/eventPosInventory.ts';
const lifecyclePath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/executeNativeProductionBatchLifecycle/entry.ts';
const previewPath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/previewNativeProductionBatchLifecycle/entry.ts';
const queuePath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminProductionQueueSummary/entry.ts';
const managePath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/manageEventPosInventory/entry.ts';
const uiPath = 'src/pages/admin/ProductionQueueSummary.jsx';
const clientPath = 'src/api/base44Client.js';
const gatewayPath = 'base44/functions/getAdminOperationsDashboardSummary/entry.ts';
const criticalPath = 'scripts/ci/run-critical-regressions.mjs';

const helperSource = read(helperPath);
const lifecycleSource = read(lifecyclePath);
const previewSource = read(previewPath);
const queueSource = read(queuePath);
const manageSource = read(managePath);
const uiSource = read(uiPath);
const clientSource = read(clientPath);
const gatewaySource = read(gatewayPath);
const criticalSource = read(criticalPath);
const eventSchema = JSON.parse(read('base44/entities/Event.jsonc'));
const productSchema = JSON.parse(read('base44/entities/Product.jsonc'));
const batchSchema = JSON.parse(read('base44/entities/ProductionBatch.jsonc'));

for (const field of [
  'shopify_pos_inventory_sync_enabled',
  'shopify_pos_location_id',
  'shopify_pos_location_name',
  'shopify_pos_inventory_mode',
]) assert.ok(eventSchema.properties[field], `missing Event.${field}`);
for (const field of ['shopify_pos_product_id', 'shopify_pos_variant_id']) {
  assert.ok(productSchema.properties[field], `missing Product.${field}`);
}
for (const field of [
  'shopify_pos_inventory_sync_status',
  'shopify_pos_inventory_sync_quantity',
  'shopify_pos_inventory_synced_at',
  'shopify_pos_inventory_command_id',
  'shopify_pos_location_id',
  'shopify_pos_inventory_sync_error',
]) assert.ok(batchSchema.properties[field], `missing ProductionBatch.${field}`);

assert.match(helperSource, /mixed_event_and_customer_demand_requires_allocation/);
assert.match(helperSource, /event_pos_inventory_requires_future_event_date/);
assert.match(helperSource, /single_event_product_batch_required/);
assert.match(helperSource, /fulfillsOnlineOrders: false/);
assert.match(helperSource, /inventoryPolicy: 'CONTINUE'/);
assert.match(helperSource, /@idempotent\(key: \$idempotencyKey\)/);
assert.match(helperSource, /compareQuantity: 0/);
assert.match(helperSource, /customer_notifications_sent: false/);
assert.doesNotMatch(helperSource, /entities\.InventoryItem\.(create|update)/);
assert.match(lifecycleSource, /syncVerifiedEventBatchToShopifyPos/);
assert.match(lifecycleSource, /event_final_usable_quantity_required_for_pos/);
assert.match(previewSource, /Shopify\.POS\.available_quantity/);
assert.match(queueSource, /shopify_pos_inventory_sync_quantity/);
assert.match(uiSource, /Shopify POS opening stock/);
assert.match(uiSource, /Retry POS Stock Sync/);
assert.match(manageSource, /previewEventPosInventoryReadiness/);
assert.match(manageSource, /retry_verified_event_pos_inventory/);
assert.match(clientSource, /'manageEventPosInventory'/);
assert.match(gatewaySource, /"manageEventPosInventory"/);
assert.match(gatewaySource, /g116b-preisolated-event-location-scope/);
assert.match(gatewaySource, /g116-verified-event-production-shopify-pos-inventory-20260820/);
assert.match(criticalSource, /run-g116-event-production-pos-inventory-tests\.mjs/);

let moduleSource = helperSource
  .replaceAll('export async function', 'async function')
  .replaceAll('export function', 'function');
moduleSource += '\nexport { eventPosInventoryEligibility, previewEventPosInventoryReadiness, syncVerifiedEventBatchToShopifyPos };\n';
const helperModule = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);
const { eventPosInventoryEligibility, previewEventPosInventoryReadiness, syncVerifiedEventBatchToShopifyPos } = helperModule;

function matches(row, filter) {
  return Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
}

function store(seed = {}) {
  const rows = new Map(Object.entries(seed).map(([name, values]) => [name, values.map(value => ({ ...value }))]));
  const writes = [];
  let nextId = 1;
  const entity = name => ({
    list: async (_sort, limit = 500) => (rows.get(name) || []).slice(0, limit).map(value => ({ ...value })),
    filter: async (filter, _sort, limit = 500) => (rows.get(name) || [])
      .filter(row => matches(row, filter)).slice(0, limit).map(value => ({ ...value })),
    create: async payload => {
      const record = {
        id: `${name.toLowerCase()}_${nextId++}`,
        created_date: '2026-08-20T12:00:00.000Z',
        updated_date: '2026-08-20T12:00:00.000Z',
        ...payload,
      };
      rows.set(name, [...(rows.get(name) || []), record]);
      writes.push({ entity: name, action: 'create', payload });
      return { ...record };
    },
    update: async (id, payload) => {
      const values = rows.get(name) || [];
      const index = values.findIndex(row => row.id === id);
      if (index < 0) throw new Error(`${name} not found`);
      values[index] = { ...values[index], ...payload, updated_date: '2026-08-20T12:01:00.000Z' };
      writes.push({ entity: name, action: 'update', id, payload });
      return { ...values[index] };
    },
  });
  const entities = new Proxy({}, { get: (_target, name) => entity(String(name)) });
  return { rows, writes, base44: { asServiceRole: { entities } } };
}

const event = {
  id: 'event_s2',
  title: 'S2 Customer Appreciation BBQ',
  date: '2099-08-22',
  shopify_pos_inventory_sync_enabled: true,
  shopify_pos_location_id: 'gid://shopify/Location/86197370970',
  shopify_pos_location_name: 'S2 Customer Appreciation BBQ - Aug 22',
  shopify_pos_inventory_mode: 'verified_event_production',
};
const batch = {
  id: 'batch_oasis',
  batch_id: 'EVENT-20990821-S2-OASIS',
  product_name: 'OASIS',
  production_date: '2099-08-21',
  planned_units: 40,
  status: 'verified_logged',
  final_usable_quantity: 40,
  source_system: 'customer_app_native_event_stock',
  native_owner_status: 'native_owned_event_stock',
  is_test_batch: false,
  order_sources: [{ order_id: event.id, source_type: 'event_stock', source_item: 'OASIS', quantity: 40 }],
};
const product = {
  id: 'product_oasis',
  title: 'OASIS',
  shopify_pos_product_id: '7868010987610',
  shopify_pos_variant_id: '43220774944858',
};

assert.deepEqual(eventPosInventoryEligibility({ product_name: 'OASIS' }), { applicable: false, reason: 'not_event_stock' });
assert.equal(eventPosInventoryEligibility({ ...batch, final_usable_quantity: null }).blocker, 'verified_final_usable_quantity_required');
assert.equal(eventPosInventoryEligibility({
  ...batch,
  order_sources: [...batch.order_sources, { order_id: 'customer_order', source_type: 'direct', quantity: 1 }],
}).blocker, 'mixed_event_and_customer_demand_requires_allocation');
assert.equal(eventPosInventoryEligibility(batch).quantity, 40);

const originalFetch = globalThis.fetch;
const originalDeno = globalThis.Deno;
globalThis.Deno = {
  env: {
    get: key => ({
      SHOPIFY_STORE_URL: 'shop.example.test',
      SHOPIFY_API_TOKEN: 'synthetic-token',
    }[key] || ''),
  },
};

let providerCalls = [];
let scopeHandles = ['write_inventory', 'write_products', 'write_locations'];
let locationFulfillsOnlineOrders = true;
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://shop.example.test/admin/api/2026-07/graphql.json');
  assert.equal(options.headers['X-Shopify-Access-Token'], 'synthetic-token');
  const request = JSON.parse(options.body);
  providerCalls.push(request);
  if (/EventPosInventoryScopes/.test(request.query)) {
    return new Response(JSON.stringify({ data: { currentAppInstallation: { accessScopes:
      scopeHandles.map(handle => ({ handle })),
    } } }), { status: 200 });
  }
  if (/EventPosInventoryTarget/.test(request.query)) {
    return new Response(JSON.stringify({ data: {
      product: { id: 'gid://shopify/Product/7868010987610', title: 'OASIS', handle: 'oasis', status: 'ACTIVE' },
      productVariant: {
        id: 'gid://shopify/ProductVariant/43220774944858', inventoryPolicy: 'DENY',
        product: { id: 'gid://shopify/Product/7868010987610', title: 'OASIS', handle: 'oasis', status: 'ACTIVE' },
        inventoryItem: { id: 'gid://shopify/InventoryItem/oasis', tracked: false, inventoryLevels: { nodes: [] } },
      },
      location: {
        id: event.shopify_pos_location_id, name: event.shopify_pos_location_name,
        isActive: true, fulfillsOnlineOrders: locationFulfillsOnlineOrders, fulfillmentService: null,
      },
    } }), { status: 200 });
  }
  if (/IsolateEventPosLocation/.test(request.query)) {
    assert.equal(request.variables.input.fulfillsOnlineOrders, false);
    return new Response(JSON.stringify({ data: { locationEdit: {
      location: { id: event.shopify_pos_location_id, name: event.shopify_pos_location_name, isActive: true, fulfillsOnlineOrders: false, fulfillmentService: null },
      userErrors: [],
    } } }), { status: 200 });
  }
  if (/PreserveDemandBasedOnlineSales/.test(request.query)) {
    assert.equal(request.variables.variants[0].inventoryPolicy, 'CONTINUE');
    return new Response(JSON.stringify({ data: { productVariantsBulkUpdate: {
      productVariants: [{ id: 'gid://shopify/ProductVariant/43220774944858', inventoryPolicy: 'CONTINUE' }],
      userErrors: [],
    } } }), { status: 200 });
  }
  if (/TrackVerifiedEventInventory/.test(request.query)) {
    assert.equal(request.variables.input.tracked, true);
    return new Response(JSON.stringify({ data: { inventoryItemUpdate: {
      inventoryItem: { id: 'gid://shopify/InventoryItem/oasis', tracked: true }, userErrors: [],
    } } }), { status: 200 });
  }
  if (/EventPosInventoryLevel/.test(request.query)) {
    return new Response(JSON.stringify({ data: { inventoryItem: {
      id: 'gid://shopify/InventoryItem/oasis', tracked: true, inventoryLevels: { nodes: [] },
    } } }), { status: 200 });
  }
  assert.match(request.query, /ActivateVerifiedEventInventory/);
  assert.equal(request.variables.available, 40);
  return new Response(JSON.stringify({ data: { inventoryActivate: {
    inventoryLevel: { id: 'level_oasis', quantities: [{ name: 'available', quantity: 40 }] },
    userErrors: [],
  } } }), { status: 200 });
};

const state = store({ Event: [event], ProductionBatch: [batch], Product: [product], CommandLog: [] });
const readiness = await previewEventPosInventoryReadiness({
  base44: state.base44,
  eventId: event.id,
  batchKeys: [batch.id],
});
assert.equal(readiness.success, true);
assert.equal(readiness.ready, true);
assert.equal(readiness.provider_writes_performed, false);
assert.deepEqual(readiness.blockers, []);
assert.equal(readiness.rows[0].planned_quantity, 40);
assert.ok(readiness.warnings.includes('inventory_tracking_will_be_enabled'));

scopeHandles = ['write_inventory', 'write_products'];
providerCalls = [];
const onlineLocationWithoutIsolationScope = await previewEventPosInventoryReadiness({
  base44: state.base44,
  eventId: event.id,
  batchKeys: [batch.id],
});
assert.equal(onlineLocationWithoutIsolationScope.ready, false);
assert.ok(onlineLocationWithoutIsolationScope.blockers.includes('shopify_location_isolation_scope_required'));
assert.equal(onlineLocationWithoutIsolationScope.provider_writes_performed, false);

locationFulfillsOnlineOrders = false;
providerCalls = [];
const isolatedLocationWithoutIsolationScope = await previewEventPosInventoryReadiness({
  base44: state.base44,
  eventId: event.id,
  batchKeys: [batch.id],
});
assert.equal(isolatedLocationWithoutIsolationScope.ready, true);
assert.ok(!isolatedLocationWithoutIsolationScope.blockers.includes('shopify_location_isolation_scope_required'));
assert.ok(!isolatedLocationWithoutIsolationScope.warnings.includes('online_fulfillment_will_be_disabled_on_first_sync'));
assert.equal(isolatedLocationWithoutIsolationScope.provider_writes_performed, false);

scopeHandles = ['write_inventory', 'write_products', 'write_locations'];
locationFulfillsOnlineOrders = true;

providerCalls = [];
const result = await syncVerifiedEventBatchToShopifyPos({
  base44: state.base44,
  batch,
  requestId: 'verify_s2_oasis',
  user: { email: 'admin@example.test', role: 'admin' },
});
assert.equal(result.success, true);
assert.equal(result.status, 'in_sync');
assert.equal(result.quantity, 40);
assert.equal(result.customer_notifications_sent, false);
assert.equal(providerCalls.length, 6);
assert.equal(state.rows.get('ProductionBatch')[0].shopify_pos_inventory_sync_status, 'in_sync');
assert.equal(state.rows.get('ProductionBatch')[0].shopify_pos_inventory_sync_quantity, 40);
assert.equal(state.rows.get('CommandLog')[0].status, 'success');
assert.equal(state.rows.get('Product')[0].shopify_pos_variant_id, 'gid://shopify/ProductVariant/43220774944858');
assert.equal(state.writes.filter(write => write.entity === 'InventoryItem').length, 0);

providerCalls = [];
const replay = await syncVerifiedEventBatchToShopifyPos({
  base44: state.base44,
  batch: state.rows.get('ProductionBatch')[0],
  requestId: 'verify_s2_oasis_replay',
  user: { email: 'admin@example.test', role: 'admin' },
});
assert.equal(replay.success, true);
assert.equal(replay.idempotent, true);
assert.equal(providerCalls.length, 0, 'successful replay performs no provider request');

providerCalls = [];
const mixedState = store({
  Event: [event], Product: [product], CommandLog: [],
  ProductionBatch: [{
    ...batch,
    id: 'batch_mixed',
    order_sources: [...batch.order_sources, { order_id: 'customer_order', source_type: 'direct', quantity: 1 }],
  }],
});
const mixedResult = await syncVerifiedEventBatchToShopifyPos({
  base44: mixedState.base44,
  batch: mixedState.rows.get('ProductionBatch')[0],
  requestId: 'verify_mixed',
  user: { email: 'admin@example.test', role: 'admin' },
});
assert.equal(mixedResult.status, 'blocked');
assert.equal(mixedResult.error_code, 'mixed_event_and_customer_demand_requires_allocation');
assert.equal(providerCalls.length, 0);

providerCalls = [];
const duplicateState = store({
  Event: [event], Product: [product], CommandLog: [],
  ProductionBatch: [batch, { ...batch, id: 'batch_oasis_duplicate', batch_id: 'EVENT-20990821-S2-OASIS-2' }],
});
const duplicateResult = await syncVerifiedEventBatchToShopifyPos({
  base44: duplicateState.base44,
  batch,
  requestId: 'verify_duplicate',
  user: { email: 'admin@example.test', role: 'admin' },
});
assert.equal(duplicateResult.status, 'error');
assert.equal(duplicateResult.error_code, 'single_event_product_batch_required');
assert.equal(providerCalls.length, 0);

globalThis.fetch = originalFetch;
globalThis.Deno = originalDeno;

console.log(JSON.stringify({
  success: true,
  suite: 'g116-event-production-pos-inventory',
  cases: 20,
  live_provider_calls_performed: false,
  production_writes_performed: false,
  customer_notifications_sent: false,
}, null, 2));
