#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function loadFunctions(relativePath, exportNames, env = {}) {
  const filePath = path.join(repoRoot, relativePath);
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  const serveIndex = source.indexOf('Deno.serve');
  if (serveIndex >= 0) source = source.slice(0, serveIndex);
  source += `\nglobalThis.__exports = { ${exportNames.join(', ')} };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response,
    Deno: { env: { get: key => env[key] || '' } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return context.globalThis.__exports;
}

const fns = loadFunctions('base44/functions/importNativeProductionMasterDataForCustomerApp/entry.ts', [
  'validateImportPreview',
  'gateFailure',
  'exactTargetBlockers',
  'entityCounts',
]);

function row(target_entity, match_value, payload, extra = {}) {
  const matchField = target_entity === 'Recipe'
    ? 'product_name'
    : target_entity === 'Bundle'
      ? 'bundle_name'
      : target_entity === 'InventoryItem'
        ? 'ingredient'
        : 'ingredient_name';
  return {
    target_entity,
    operation: 'create_if_missing',
    match_field: matchField,
    match_value,
    import_ready: true,
    source_hub_id: `hub_${target_entity}_${match_value}`.replace(/\s+/g, '_'),
    payload,
    ...extra,
  };
}

const createRows = [
  row('Bundle', 'The NuVira Trio', {
    bundle_name: 'The NuVira Trio',
    components: [
      { product_name: 'Pineapple Juice', quantity: 1 },
      { product_name: 'Reset Shot', quantity: 1 },
      { product_name: 'Radiance Shot', quantity: 1 },
    ],
    fulfillment_count: 1,
    is_active: true,
    notes: 'Mirrored from Hub Bundle "NuVira Trio" via owner-approved alias "The NuVira Trio".',
  }, { source_hub_id: '69e8f55b06e17fbd88dbbc0c' }),
  ...['Pineapple Juice', 'Reset Shot', 'Radiance Shot'].map(name => row('Recipe', name, {
    product_name: name,
    bottle_size_oz: 12,
    yield_factor: 1.05,
    ingredients: [{ ingredient_name: name === 'Pineapple Juice' ? 'Pineapple' : 'Ginger', quantity_oz: 1, unit: 'oz' }],
    is_active: true,
  })),
  ...['Pineapple', 'Lemon', 'Ginger', 'Black Salt', 'Beetroot', 'Red Apple'].map(name => row('InventoryItem', name, {
    ingredient: name,
    unit: 'lbs',
    stock: 0,
    reorder_point: 0,
    max_stock: 0,
    supplier: 'Hub Vendor',
    category: name === 'Black Salt' ? 'Spices & Herbs' : 'Produce',
    notes: 'Seeded under NON_STOCK_MASTER_DATA_ONLY. Hub stock was not mirrored as authoritative.',
  })),
  ...['Pineapple', 'Lemon', 'Ginger', 'Red Apple'].map(name => row('IngredientYield', name, {
    ingredient_name: name,
    purchase_unit: 'case',
    oz_per_purchase_unit: 160,
    trim_waste_factor: 1,
    units_per_case: 1,
    split_case_allowed: true,
    rounding_rule: 'round_up_unit',
    supplier: 'Hub Vendor',
  })),
];

const preview = {
  success: true,
  order_number: 'NV-MPZNKGNT',
  customer_app_order_id: '6a219a3f4adcda5856c3d579',
  native_shopify_order_id: '6a22ffda400eb806eb3ca945',
  native_fulfillment_task_id: '6a22ffdaf675ea79e30575aa',
  production_master_data_ready: true,
  non_stock_import_preview_ready: true,
  inventory_seed_policy: 'NON_STOCK_MASTER_DATA_ONLY',
  yield_policy: 'DEFER_DETAILED_PURCHASE_CONVERSION_VALUES',
  procurement_conversion_ready: false,
  inventory_deduction_ready: false,
  customer_app_non_stock_master_data_import_preview: {
    import_ready: true,
    inventory_seed_policy: 'NON_STOCK_MASTER_DATA_ONLY',
    yield_policy: 'DEFER_DETAILED_PURCHASE_CONVERSION_VALUES',
    procurement_conversion_ready: false,
    inventory_deduction_ready: false,
    create_row_count: 14,
    create_rows: createRows,
    deferred_row_count: 2,
    deferred_rows: [
      { target_entity: 'IngredientYield', match_value: 'Black Salt', reason: 'yield_details_deferred_by_policy' },
      { target_entity: 'IngredientYield', match_value: 'Beetroot', reason: 'yield_details_deferred_by_policy' },
    ],
    blocked_rows: [],
    blockers: [],
    warnings: ['preview_only_no_master_data_import_performed'],
  },
};

const validation = fns.validateImportPreview(preview);
assert.equal(validation.ready, true);
assert.equal(validation.createRows.length, 14);
const counts = fns.entityCounts(validation.createRows);
assert.equal(counts.Bundle, 1);
assert.equal(counts.Recipe, 3);
assert.equal(counts.InventoryItem, 6);
assert.equal(counts.IngredientYield, 4);
assert.equal(validation.createRows.some(item => item.target_entity === 'IngredientYield' && ['Black Salt', 'Beetroot'].includes(item.match_value)), false);
assert.equal(validation.createRows.filter(item => item.target_entity === 'InventoryItem').every(item => item.payload.stock === 0), true);

const badStock = structuredClone(preview);
badStock.customer_app_non_stock_master_data_import_preview.create_rows = structuredClone(createRows);
badStock.customer_app_non_stock_master_data_import_preview.create_rows.find(item => item.target_entity === 'InventoryItem').payload.stock = 42;
assert.equal(fns.validateImportPreview(badStock).ready, false);
assert.ok(fns.validateImportPreview(badStock).blockers.some(item => item.includes('inventory_stock_must_seed_zero')));

const badYield = structuredClone(preview);
badYield.customer_app_non_stock_master_data_import_preview.create_rows = structuredClone(createRows);
badYield.customer_app_non_stock_master_data_import_preview.create_rows.push(row('IngredientYield', 'Black Salt', {
  ingredient_name: 'Black Salt',
  purchase_unit: 'bag',
  oz_per_purchase_unit: 16,
}));
badYield.customer_app_non_stock_master_data_import_preview.create_row_count = 15;
assert.equal(fns.validateImportPreview(badYield).ready, false);
assert.ok(fns.validateImportPreview(badYield).blockers.some(item => item.includes('deferred_yield_would_be_created')));

const extraField = structuredClone(preview);
extraField.customer_app_non_stock_master_data_import_preview.create_rows = structuredClone(createRows);
extraField.customer_app_non_stock_master_data_import_preview.create_rows.find(item => item.target_entity === 'Recipe').payload.raw_payload = { unsafe: true };
assert.equal(fns.validateImportPreview(extraField).ready, false);
assert.ok(fns.validateImportPreview(extraField).blockers.some(item => item.includes('unapproved_Recipe_field:raw_payload')));

assert.equal(fns.exactTargetBlockers({
  orderNumber: 'NV-MPZNKGNT',
  customerAppOrderId: '6a219a3f4adcda5856c3d579',
  nativeShopifyOrderId: '6a22ffda400eb806eb3ca945',
  nativeFulfillmentTaskId: '6a22ffdaf675ea79e30575aa',
}).length, 0);
assert.ok(fns.exactTargetBlockers({ orderNumber: 'OTHER' }).includes('target_order_number_mismatch'));

const gated = loadFunctions('base44/functions/importNativeProductionMasterDataForCustomerApp/entry.ts', ['gateFailure'], {
  ENABLE_NATIVE_PRODUCTION_MASTER_DATA_IMPORT: 'true',
  NATIVE_PRODUCTION_MASTER_DATA_IMPORT_KILL_SWITCH: 'false',
  NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ALLOWED_EMAILS: 'owner@example.com',
  NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ORDER_ALLOWLIST: 'NV-MPZNKGNT',
  NATIVE_PRODUCTION_MASTER_DATA_IMPORT_POLICY: 'NON_STOCK_MASTER_DATA_ONLY',
});
assert.equal(gated.gateFailure({ actorEmail: 'owner@example.com', lookup: { orderNumber: 'NV-MPZNKGNT' } }), null);
assert.equal(gated.gateFailure({ actorEmail: 'other@example.com', lookup: { orderNumber: 'NV-MPZNKGNT' } }), 'actor_email_not_allowlisted');


const invokeFns = loadFunctions('base44/functions/importNativeProductionMasterDataForCustomerApp/entry.ts', ['fetchFreshPreview'], {
  CUSTOMER_APP_SYNC_SECRET: 'preview-secret',
});
let invokedName = null;
let invokedPayload = null;
const previewResult = await invokeFns.fetchFreshPreview({
  asServiceRole: {
    functions: {
      invoke: async (name, payload) => {
        invokedName = name;
        invokedPayload = payload;
        return { data: { success: true, order_number: 'NV-MPZNKGNT' } };
      },
    },
  },
}, { requestId: 'req_123' });
assert.equal(previewResult.ok, true);
assert.equal(invokedName, 'previewNativeProductionMasterDataParity');
assert.equal(invokedPayload._internal_secret, 'preview-secret');
assert.equal(invokedPayload.order_number, 'NV-MPZNKGNT');

const failedInvoke = await invokeFns.fetchFreshPreview({
  asServiceRole: {
    functions: {
      invoke: async () => ({ data: { success: false, error_code: 'preview_failed' } }),
    },
  },
}, { requestId: 'req_124' });
assert.equal(failedInvoke.ok, false);
assert.equal(failedInvoke.error_code, 'preview_failed');

console.log('G31G non-stock master-data import tests passed');
