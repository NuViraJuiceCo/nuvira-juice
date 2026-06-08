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
    Deno: { env: { get: key => env[key] || '' } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return context.globalThis.__exports;
}

const fns = loadFunctions('base44/functions/previewNativeProductionDemandMaterialization/entry.ts', [
  'getLookup',
  'safeLineItems',
  'buildProductionReadiness',
  'buildMaterializationPreview',
  'buildProposedBatchRows',
  'buildOrderSourceRows',
  'requirePreviewAccess',
], { NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });

const lookup = fns.getLookup({
  order_number: '#NV-MPZNKGNT',
  customer_app_order_id: 'base44_order_001',
  native_shopify_order_id: 'native_order_001',
  native_fulfillment_task_id: 'task_001',
  request_id: 'g31k_test',
});

const adminAuth = await fns.requirePreviewAccess({
  base44: { auth: { me: async () => ({ role: 'admin', email: 'admin@example.test' }) } },
  req: { headers: { get: () => '' } },
  body: {},
});
assert.equal(adminAuth.ok, true);

const customerOrder = {
  id: 'base44_order_001',
  order_number: 'NV-MPZNKGNT',
  status: 'scheduled_for_juicing',
  payment_status: 'paid',
  payment_captured: true,
  fulfillment_method: 'delivery',
  line_items: [
    { title: 'Green Juice', sku: 'GREEN-16', quantity: 2, variant_title: '16 oz' },
    { title: 'Orange Juice', sku: 'ORANGE-16', quantity: 1, variant_title: '16 oz' },
  ],
};
const nativeOrder = {
  id: 'native_order_001',
  base44_order_id: 'base44_order_001',
  shopify_order_number: 'NV-MPZNKGNT',
  payment_status: 'paid',
  order_type: 'one_time',
  line_items: customerOrder.line_items,
};
const task = {
  id: 'task_001',
  native_shopify_order_id: 'native_order_001',
  base44_order_id: 'base44_order_001',
  order_number: 'NV-MPZNKGNT',
  status: 'pending',
  fulfillment_type: 'delivery',
  assigned_delivery_date: '2026-06-06',
  production_date: '2026-06-05',
};
const recipes = [
  {
    id: 'recipe_green',
    product_name: 'Green Juice',
    product_sku: 'GREEN-16',
    yield_factor: 1,
    ingredients: [
      { ingredient_name: 'Spinach', quantity_oz: 4 },
      { ingredient_name: 'Apple', quantity_oz: 6 },
    ],
  },
  {
    id: 'recipe_orange',
    product_name: 'Orange Juice',
    product_sku: 'ORANGE-16',
    yield_factor: 1,
    ingredients: [{ ingredient_name: 'Orange', quantity_oz: 12 }],
  },
  {
    id: 'recipe_radiance',
    product_name: 'Radiance Shot',
    yield_factor: 1,
    ingredients: [{ ingredient_name: 'Beetroot', quantity_oz: 0.536, unit: 'oz' }],
  },
  {
    id: 'recipe_oasis',
    product_name: 'Oasis',
    yield_factor: 1,
    ingredients: [
      { ingredient_name: 'Sea Salt', quantity_oz: 0.02, unit: 'oz' },
      { ingredient_name: 'Black Pepper', quantity_oz: 0.01, unit: 'oz' },
    ],
  },
];
const bundles = [
  {
    id: 'bundle_green_starter',
    bundle_name: 'Green Starter Pack',
    components: [
      { product_name: 'Green Juice', quantity: 2 },
      { product_name: 'Orange Juice', quantity: 1 },
    ],
  },
];
const products = [
  { id: 'product_green', title: 'Green Juice', category: 'juice', size: '16 oz' },
  { id: 'product_orange', title: 'Orange Juice', category: 'juice', size: '16 oz' },
  { id: 'product_radiance', title: 'Radiance Shot', category: 'shot' },
  { id: 'product_oasis', title: 'Oasis', category: 'juice' },
  { id: 'product_bundle', title: 'Green Starter Pack', category: 'bundle' },
];
const inventoryItems = [
  { id: 'inventory_spinach', ingredient: 'Spinach', unit: 'lbs', stock: 1 },
  { id: 'inventory_apple', ingredient: 'Apple', unit: 'lbs', stock: 0 },
  { id: 'inventory_orange', ingredient: 'Orange', unit: 'lbs', stock: 2 },
  { id: 'inventory_beetroot', ingredient: 'Beetroot', unit: 'lbs', stock: 0 },
  { id: 'inventory_sea_salt', ingredient: 'Sea Salt', unit: 'bottles', stock: 0 },
  { id: 'inventory_black_pepper', ingredient: 'Black Pepper', unit: 'bottles', stock: 0 },
];
const ingredientYields = [
  { id: 'yield_spinach', ingredient_name: 'Spinach', purchase_unit: 'case', oz_per_purchase_unit: 16, units_per_case: 1, rounding_rule: 'round_up_unit' },
  { id: 'yield_apple', ingredient_name: 'Apple', purchase_unit: 'case', oz_per_purchase_unit: 40, units_per_case: 1, rounding_rule: 'round_up_unit' },
  { id: 'yield_orange', ingredient_name: 'Orange', purchase_unit: 'case', oz_per_purchase_unit: 32, units_per_case: 1, rounding_rule: 'round_up_unit' },
  { id: 'yield_sea_salt', ingredient_name: 'Sea Salt', purchase_unit: 'lb', oz_per_purchase_unit: 16, units_per_case: 1, rounding_rule: 'exact' },
  { id: 'yield_black_pepper', ingredient_name: 'Black Pepper', purchase_unit: 'lb', oz_per_purchase_unit: 16, units_per_case: 1, rounding_rule: 'exact' },
];

function readinessFor({ order = customerOrder, native = nativeOrder, fulfillmentTask = task, lineItems = null, masterOverrides = {}, existingBatches = [] } = {}) {
  const effectiveLineItems = lineItems || fns.safeLineItems({ customerOrder: order, nativeOrder: native, task: fulfillmentTask });
  return fns.buildProductionReadiness({
    customerOrder: order,
    nativeOrder: native,
    task: fulfillmentTask,
    lookup,
    lineItems: effectiveLineItems,
    masterData: {
      recipes,
      bundles,
      products,
      inventoryItems,
      ingredientYields,
      ...masterOverrides,
    },
    existingBatches,
  });
}

const baseReadiness = readinessFor();
const basePreview = fns.buildMaterializationPreview({ readiness: baseReadiness, existingBatches: [] });
assert.equal(basePreview.success, true);
assert.equal(basePreview.dry_run, true);
assert.equal(basePreview.writes_performed, false);
assert.equal(basePreview.production_ready, true);
assert.equal(basePreview.materialization_ready, true);
assert.equal(basePreview.proposed_production_batch_rows.length, 2);
assert.equal(basePreview.proposed_order_source_rows.length, 2);
assert.ok(basePreview.proposed_production_batch_rows.every(row => row.proposed_status === 'planned'));
assert.ok(basePreview.proposed_production_batch_rows.every(row => row.would_create === true));
assert.equal(basePreview.inventory_deduction_ready, false);
assert.equal(basePreview.purchase_order_ready, false);
assert.equal(basePreview.safety.production_batches_created, false);
assert.equal(basePreview.safety.inventory_deducted, false);

const bundleItems = [{ title: 'Green Starter Pack', quantity: 1 }];
const bundleReadiness = readinessFor({
  order: { ...customerOrder, line_items: bundleItems },
  native: { ...nativeOrder, line_items: bundleItems },
  lineItems: bundleItems,
});
const bundlePreview = fns.buildMaterializationPreview({ readiness: bundleReadiness, existingBatches: [] });
assert.equal(bundlePreview.materialization_ready, true);
assert.equal(bundlePreview.bundle_decomposition_rows.length, 2);
assert.equal(bundlePreview.proposed_production_batch_rows.length, 2);
assert.equal(bundlePreview.product_demand_rows.length, 2);

const deferredYieldReadiness = readinessFor({
  lineItems: [{ title: 'Radiance Shot', quantity: 1 }],
  masterOverrides: { ingredientYields: [] },
});
const deferredYieldPreview = fns.buildMaterializationPreview({ readiness: deferredYieldReadiness, existingBatches: [] });
assert.equal(deferredYieldPreview.production_ready, true);
assert.equal(deferredYieldPreview.materialization_ready, true);
assert.equal(deferredYieldPreview.procurement_conversion_ready, false);
assert.equal(deferredYieldPreview.inventory_deduction_ready, false);
assert.ok(deferredYieldPreview.warnings.includes('yield_details_pending:Beetroot'));
assert.ok(deferredYieldPreview.warnings.includes('procurement_conversion_pending'));
assert.equal(deferredYieldPreview.materialization_blockers.includes('missing_ingredient_yield:Beetroot'), false);

const deferredStockReadiness = readinessFor({ lineItems: [{ title: 'Oasis', quantity: 1 }] });
const deferredStockPreview = fns.buildMaterializationPreview({ readiness: deferredStockReadiness, existingBatches: [] });
assert.equal(deferredStockPreview.production_ready, true);
assert.equal(deferredStockPreview.materialization_ready, true);
assert.equal(deferredStockPreview.blockers.includes('unsupported_stock_unit:Sea Salt'), false);
assert.ok(deferredStockPreview.warnings.includes('unsupported_stock_unit_deferred:Sea Salt'));
assert.equal(JSON.stringify(deferredStockPreview.deferred_stock_unit_items), JSON.stringify(['Black Pepper', 'Sea Salt']));

const missingRecipeReadiness = readinessFor({ lineItems: [{ title: 'Mystery Juice', quantity: 1 }] });
const missingRecipePreview = fns.buildMaterializationPreview({ readiness: missingRecipeReadiness, existingBatches: [] });
assert.equal(missingRecipePreview.production_ready, false);
assert.equal(missingRecipePreview.materialization_ready, false);
assert.ok(missingRecipePreview.materialization_blockers.includes('production_demand_not_ready'));
assert.ok(missingRecipePreview.materialization_blockers.includes('unknown_product_mapping:Mystery Juice'));

const unpaidReadiness = readinessFor({
  order: { ...customerOrder, payment_status: 'pending', payment_captured: false },
  native: { ...nativeOrder, payment_status: 'pending' },
});
const unpaidPreview = fns.buildMaterializationPreview({ readiness: unpaidReadiness, existingBatches: [] });
assert.equal(unpaidPreview.materialization_ready, false);
assert.ok(unpaidPreview.materialization_blockers.includes('order_not_paid'));
assert.ok(unpaidPreview.materialization_blockers.includes('payment_not_captured'));

const noProductionDateReadiness = readinessFor({ fulfillmentTask: { ...task, production_date: null } });
const noProductionDatePreview = fns.buildMaterializationPreview({ readiness: noProductionDateReadiness, existingBatches: [] });
assert.equal(noProductionDatePreview.materialization_ready, false);
assert.ok(noProductionDatePreview.materialization_blockers.includes('missing_production_date'));

const existingMatchingBatch = {
  id: 'batch_green_existing',
  batch_id: 'BATCH-2026-06-05-GREEN-JUICE',
  product_name: 'Green Juice',
  production_date: '2026-06-05',
  status: 'planned',
  planned_units: 2,
  order_sources: [{ order_number: 'NV-MPZNKGNT', order_id: 'base44_order_001', quantity: 2 }],
};
const existingMatchingReadiness = readinessFor({ existingBatches: [existingMatchingBatch] });
const existingMatchingPreview = fns.buildMaterializationPreview({ readiness: existingMatchingReadiness, existingBatches: [existingMatchingBatch] });
const greenExistingRow = existingMatchingPreview.proposed_production_batch_rows.find(row => row.product_name === 'Green Juice');
assert.equal(greenExistingRow.would_create, false);
assert.equal(greenExistingRow.would_skip_existing, true);
assert.ok(existingMatchingPreview.warnings.includes('existing_native_batch_already_contains_order_source'));
assert.ok(existingMatchingPreview.warnings.includes('existing_native_production_batches_detected'));
assert.equal(existingMatchingPreview.warnings.includes('native_production_batch_not_created'), false);
assert.equal(existingMatchingPreview.existing_native_batch_matches[0].status, 'planned');

const conflictingBatch = {
  id: 'batch_green_locked',
  batch_id: 'BATCH-2026-06-05-GREEN-JUICE',
  product_name: 'Green Juice',
  production_date: '2026-06-05',
  status: 'in_production',
  is_locked: true,
  planned_units: 10,
  order_sources: [{ order_number: 'OTHER-ORDER', quantity: 10 }],
};
const conflictPreview = fns.buildMaterializationPreview({ readiness: baseReadiness, existingBatches: [conflictingBatch] });
assert.equal(conflictPreview.materialization_ready, false);
assert.ok(conflictPreview.materialization_blockers.some(blocker => blocker.startsWith('existing_conflicting_native_batch:')));
assert.equal(conflictPreview.safety.production_batches_created, false);
assert.equal(conflictPreview.proposed_production_batch_rows[0].existing_batch_status, 'in_production');

console.log('G31K native production demand materialization tests passed');
