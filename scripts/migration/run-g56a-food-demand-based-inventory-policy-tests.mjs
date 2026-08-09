#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminInventoryStatusSummary/entry.ts');

function loadHandler({ env = {}, hubData = hubInventoryResponse() } = {}) {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source = source.replace('export default async function handler(req: Request)', 'globalThis.__handler = async function handler(req)');

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
    createClientFromRequest: req => req.__base44,
    fetch: async () => new Response(JSON.stringify(hubData), { status: 200 }),
    Deno: {
      env: { get: key => env[key] || '' },
    },
    globalThis: {},
  });

  vm.runInContext(source, context, { filename: functionPath });
  return context.globalThis.__handler;
}

function hubInventoryResponse() {
  return {
    success: true,
    items: [
      {
        id: 'hub_watermelon',
        ingredient: 'Watermelon',
        category: 'Produce',
        unit: 'lbs',
        stock: 0,
        reorder_point: 10,
        max_stock: 40,
        supplier: 'Produce Supplier',
        status: 'out_of_stock',
      },
    ],
    procurement_plan: [
      {
        inventory_item_id: 'hub_watermelon',
        ingredient: 'Watermelon',
        category: 'Produce',
        unit: 'lbs',
        stock: 0,
        reorder_point: 10,
        max_stock: 40,
        supplier: 'Produce Supplier',
        status: 'out_of_stock',
        net_suggested_quantity: 40,
      },
    ],
    open_purchase_orders: [],
    summary: {
      total_items: 1,
      out_of_stock_count: 1,
      procurement_item_count: 1,
      net_procurement_item_count: 1,
    },
  };
}

function makeBase44({ inventoryItems = [], purchaseOrders = [] } = {}) {
  const writes = [];
  const rowsByName = {
    InventoryItem: inventoryItems,
    PurchaseOrder: purchaseOrders,
  };
  const api = name => ({
    list: async (_sort, limit = 500) => (rowsByName[name] || []).slice(0, limit),
    filter: async () => { throw new Error(`unexpected filter ${name}`); },
    create: async payload => { writes.push({ entity: name, action: 'create', payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, payload) => { writes.push({ entity: name, action: 'update', id, payload }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { writes.push({ entity: name, action: 'delete', id }); throw new Error(`unexpected delete ${name}`); },
    upsert: async payload => { writes.push({ entity: name, action: 'upsert', payload }); throw new Error(`unexpected upsert ${name}`); },
  });

  return {
    writes,
    base44: {
      auth: { me: async () => ({ id: 'synthetic_admin', role: 'admin' }) },
      asServiceRole: {
        entities: Object.fromEntries(Object.keys(rowsByName).map(name => [name, api(name)])),
      },
    },
  };
}

async function invoke({ body = {}, hubData = hubInventoryResponse(), store = {} } = {}) {
  const { base44, writes } = makeBase44(store);
  const handler = loadHandler({
    env: { HUB_API_URL: 'https://hub.example.test/functions/getInventoryStatusSummaryForCustomerApp', CUSTOMER_APP_SYNC_SECRET: 'synthetic-secret' },
    hubData,
  });
  const req = {
    method: 'POST',
    __base44: base44,
    json: async () => ({ limit: 100, ...body }),
  };
  const response = await handler(req);
  const payload = await response.json();
  return { status: response.status, payload, writes };
}

const trackedPackaging = {
  id: 'native_bottle_cases',
  ingredient: 'Bottle Cases',
  category: 'Packaging',
  unit: 'cases',
  stock: 2,
  reorder_point: 10,
  max_stock: 25,
  supplier: 'Packaging Supplier',
};

const { status, payload, writes } = await invoke({
  store: { inventoryItems: [trackedPackaging], purchaseOrders: [] },
});

assert.equal(status, 200);
assert.equal(payload.success, true);
assert.equal(payload.data_sources.food_inventory_policy, 'food_and_juice_make_to_order');
assert.equal(payload.data_sources.food_stock_warnings_suppressed, true);
assert.equal(payload.data_sources.non_food_inventory_counts_enabled, true);
assert.equal(payload.summary.total_items, 1);
assert.equal(payload.summary.demand_based_food_count, 0);
assert.equal(payload.summary.stock_tracked_item_count, 1);
assert.equal(payload.summary.food_stock_warnings_suppressed_count, 0);
assert.equal(payload.summary.low_stock_count, 0);
assert.equal(payload.summary.critical_count, 1);
assert.equal(payload.summary.out_of_stock_count, 0);
assert.equal(payload.summary.net_procurement_item_count, 1);
assert.equal(payload.items.find(item => item.ingredient === 'Watermelon'), undefined);
assert.equal(payload.items.find(item => item.ingredient === 'Bottle Cases')?.status, 'critical');
assert.equal(payload.procurement_plan.length, 1);
assert.equal(payload.procurement_plan[0].ingredient, 'Bottle Cases');
assert.equal(payload.procurement_plan[0].stock_tracking_policy, 'stock_tracked');
assert.equal(writes.length, 0);

const demandOnly = await invoke({
  body: { status: 'demand_based' },
  store: { inventoryItems: [trackedPackaging], purchaseOrders: [] },
});
assert.equal(demandOnly.status, 200);
assert.equal(demandOnly.payload.summary.total_items, 0);
assert.equal(demandOnly.payload.items.length, 0);
assert.equal(demandOnly.payload.procurement_plan.length, 0);
assert.equal(demandOnly.writes.length, 0);

const duplicateHiddenFromFilteredView = await invoke({
  body: { status: 'out_of_stock' },
  hubData: {
    ...hubInventoryResponse(),
    items: [
      {
        id: 'hub_bottle_cases',
        ingredient: 'Bottle Cases',
        category: 'Packaging',
        unit: 'cases',
        stock: 12,
        reorder_point: 10,
        max_stock: 25,
        supplier: 'Packaging Supplier',
        status: 'ok',
      },
    ],
    procurement_plan: [],
  },
  store: {
    inventoryItems: [{
      ...trackedPackaging,
      stock: 0,
    }],
    purchaseOrders: [],
  },
});
assert.equal(duplicateHiddenFromFilteredView.status, 200);
assert.equal(duplicateHiddenFromFilteredView.payload.summary.total_items, 1);
assert.equal(duplicateHiddenFromFilteredView.payload.items.length, 1);
assert.equal(duplicateHiddenFromFilteredView.payload.items[0].ingredient, 'Bottle Cases');
assert.equal(duplicateHiddenFromFilteredView.payload.procurement_plan.length, 1);
assert.equal(duplicateHiddenFromFilteredView.writes.length, 0);

console.log(JSON.stringify({
  suite: 'g56a_food_demand_based_inventory_policy',
  passed: 3,
  failed: 0,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
