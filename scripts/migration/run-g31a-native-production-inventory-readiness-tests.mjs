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
    Deno: {
      env: {
        get: key => env[key] || '',
      },
    },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return context.globalThis.__exports;
}

const fns = loadFunctions('base44/functions/previewNativeProductionInventoryReadiness/entry.ts', [
  'getLookup',
  'safeLineItems',
  'buildIndexes',
  'expandLineItems',
  'attachRecipes',
  'computeIngredientNeeds',
  'stockToOz',
  'buildProductionReadiness',
  'requirePreviewAccess',
], {
  NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret',
});

const lookup = fns.getLookup({
  order_number: '#NV-MPZNKGNT',
  customer_app_order_id: 'base44_order_001',
  native_shopify_order_id: 'native_order_001',
  native_fulfillment_task_id: 'task_001',
  request_id: 'g31a_test',
});
assert.equal(lookup.orderNumber, 'NV-MPZNKGNT');
assert.equal(lookup.orderId, 'base44_order_001');
assert.equal(lookup.nativeOrderId, 'native_order_001');
assert.equal(lookup.taskId, 'task_001');

const adminAuth = await fns.requirePreviewAccess({
  base44: { auth: { me: async () => ({ role: 'admin', email: 'admin@example.test' }) } },
  req: { headers: { get: () => '' } },
  body: {},
});
assert.equal(adminAuth.ok, true);
assert.equal(adminAuth.actor_type, 'admin');

const internalSecretAuth = await fns.requirePreviewAccess({
  base44: { auth: { me: async () => { throw new Error('auth.me should not run'); } } },
  req: { headers: { get: name => (name.toLowerCase() === 'x-internal-secret' ? 'preview-secret' : '') } },
  body: {},
});
assert.equal(internalSecretAuth.ok, true);
assert.equal(internalSecretAuth.actor_type, 'system');

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
    ingredients: [
      { ingredient_name: 'Orange', quantity_oz: 12 },
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
  { id: 'product_bundle', title: 'Missing Bundle Product', category: 'bundle' },
];
const inventoryItems = [
  { id: 'inventory_spinach', ingredient: 'Spinach', unit: 'lbs', stock: 1 },
  { id: 'inventory_apple', ingredient: 'Apple', unit: 'lbs', stock: 0 },
  { id: 'inventory_orange', ingredient: 'Orange', unit: 'lbs', stock: 2 },
];
const ingredientYields = [
  { id: 'yield_spinach', ingredient_name: 'Spinach', purchase_unit: 'case', oz_per_purchase_unit: 16, units_per_case: 1, rounding_rule: 'round_up_unit' },
  { id: 'yield_apple', ingredient_name: 'Apple', purchase_unit: 'case', oz_per_purchase_unit: 40, units_per_case: 1, rounding_rule: 'round_up_unit' },
  { id: 'yield_orange', ingredient_name: 'Orange', purchase_unit: 'case', oz_per_purchase_unit: 32, units_per_case: 1, rounding_rule: 'round_up_unit' },
];

const lineItems = fns.safeLineItems({ customerOrder, nativeOrder, task });
assert.equal(lineItems.length, 2);
assert.equal(lineItems[0].title, 'Green Juice');

const readiness = fns.buildProductionReadiness({
  customerOrder,
  nativeOrder,
  task,
  lookup,
  lineItems,
  masterData: { recipes, bundles, products, inventoryItems, ingredientYields },
  existingBatches: [],
});
assert.equal(readiness.success, true);
assert.equal(readiness.dry_run, true);
assert.equal(readiness.writes_performed, false);
assert.equal(readiness.production_ready, true);
assert.equal(readiness.inventory_calculation_ready, true);
assert.equal(readiness.procurement_needed, true);
assert.equal(readiness.procurement_needed_count, 1);
assert.equal(readiness.inventory_deduction_ready, false);
assert.equal(readiness.hub_fallback_required, true);
assert.equal(readiness.production_demand_rows.length, 2);
assert.equal(readiness.ingredient_need_rows.length, 3);
assert.equal(readiness.blockers.length, 0);
assert.ok(readiness.warnings.includes('inventory_shortfall:Apple'));
assert.ok(readiness.warnings.includes('inventory_shortfall_procurement_needed'));
assert.ok(readiness.warnings.includes('inventory_deduction_held'));
assert.equal(readiness.classification, 'production_inventory_preview_ready_procurement_needed');

const bundleLineItems = [{ title: 'Green Starter Pack', quantity: 1 }];
const bundleExpanded = fns.expandLineItems(bundleLineItems, fns.buildIndexes({ recipes, bundles, products, inventoryItems, ingredientYields }));
assert.equal(bundleExpanded.rows.length, 2);
assert.equal(bundleExpanded.bundleRows.length, 2);
assert.equal(bundleExpanded.blockers.length, 0);
assert.equal(bundleExpanded.rows[0].demand_source_type, 'bundle_component');

const bundleReadiness = fns.buildProductionReadiness({
  customerOrder: { ...customerOrder, line_items: bundleLineItems },
  nativeOrder: { ...nativeOrder, line_items: bundleLineItems },
  task,
  lookup,
  lineItems: bundleLineItems,
  masterData: { recipes, bundles, products, inventoryItems, ingredientYields },
  existingBatches: [],
});
assert.equal(bundleReadiness.production_ready, true);
assert.equal(bundleReadiness.bundle_decomposition_rows.length, 2);
assert.equal(bundleReadiness.production_demand_rows.length, 2);

const missingRecipeReadiness = fns.buildProductionReadiness({
  customerOrder,
  nativeOrder,
  task,
  lookup,
  lineItems: [{ title: 'Mystery Juice', quantity: 1 }],
  masterData: { recipes, bundles, products, inventoryItems, ingredientYields },
  existingBatches: [],
});
assert.equal(missingRecipeReadiness.success, true);
assert.equal(missingRecipeReadiness.production_ready, false);
assert.ok(missingRecipeReadiness.blockers.includes('unknown_product_mapping:Mystery Juice'));
assert.equal(missingRecipeReadiness.classification, 'blocked_master_data_or_order_context');

const missingInventoryReadiness = fns.buildProductionReadiness({
  customerOrder,
  nativeOrder,
  task,
  lookup,
  lineItems: [{ title: 'Green Juice', quantity: 1 }],
  masterData: { recipes, bundles, products, inventoryItems: [], ingredientYields },
  existingBatches: [],
});
assert.equal(missingInventoryReadiness.production_ready, true);
assert.equal(missingInventoryReadiness.inventory_calculation_ready, false);
assert.ok(missingInventoryReadiness.blockers.includes('missing_inventory_item:Spinach'));
assert.equal(missingInventoryReadiness.classification, 'production_ready_inventory_master_data_blocked');

const deferredYieldReadiness = fns.buildProductionReadiness({
  customerOrder,
  nativeOrder,
  task,
  lookup,
  lineItems: [{ title: 'Radiance Shot', quantity: 1 }],
  masterData: {
    recipes: [{
      id: 'recipe_radiance',
      product_name: 'Radiance Shot',
      yield_factor: 1,
      ingredients: [{ ingredient_name: 'Beetroot', quantity_oz: 0.536, unit: 'oz' }],
    }],
    bundles,
    products,
    inventoryItems: [{ id: 'inventory_beetroot', ingredient: 'Beetroot', unit: 'lbs', stock: 0 }],
    ingredientYields: [],
  },
  existingBatches: [],
});
assert.equal(deferredYieldReadiness.production_ready, true);
assert.equal(deferredYieldReadiness.inventory_calculation_ready, true);
assert.equal(deferredYieldReadiness.procurement_conversion_ready, false);
assert.equal(deferredYieldReadiness.inventory_deduction_ready, false);
assert.equal(deferredYieldReadiness.yield_details_pending, true);
assert.equal(JSON.stringify(deferredYieldReadiness.pending_yield_items), JSON.stringify(['Beetroot']));
assert.equal(JSON.stringify(deferredYieldReadiness.missing_yield_items), JSON.stringify(['Beetroot']));
assert.equal(deferredYieldReadiness.blockers.includes('missing_ingredient_yield:Beetroot'), false);
assert.ok(deferredYieldReadiness.warnings.includes('yield_details_pending:Beetroot'));
assert.equal(deferredYieldReadiness.classification, 'production_inventory_preview_ready_procurement_needed');

const tracePinchReadiness = fns.buildProductionReadiness({
  customerOrder,
  nativeOrder,
  task,
  lookup,
  lineItems: [{ title: 'Reset Shot', quantity: 1 }],
  masterData: {
    recipes: [{
      id: 'recipe_reset',
      product_name: 'Reset Shot',
      yield_factor: 1,
      ingredients: [
        { ingredient_name: 'Ginger', quantity_oz: 0.1, unit: 'oz' },
        { ingredient_name: 'Black Salt', quantity_oz: 0, unit: 'pinch' },
      ],
    }],
    bundles,
    products,
    inventoryItems: [
      { id: 'inventory_ginger', ingredient: 'Ginger', unit: 'lbs', stock: 1 },
      { id: 'inventory_black_salt', ingredient: 'Black Salt', unit: 'lbs', stock: 0 },
    ],
    ingredientYields: [
      { id: 'yield_ginger', ingredient_name: 'Ginger', purchase_unit: 'lb', oz_per_purchase_unit: 16, units_per_case: 1, rounding_rule: 'round_up_unit' },
    ],
  },
  existingBatches: [],
});
assert.equal(tracePinchReadiness.production_ready, true);
assert.equal(tracePinchReadiness.blockers.includes('unsupported_or_missing_recipe_quantity:Reset Shot:Black Salt'), false);
assert.ok(tracePinchReadiness.warnings.includes('trace_recipe_ingredient_quantity_pending:Reset Shot:Black Salt'));
assert.equal(JSON.stringify(tracePinchReadiness.trace_ingredient_items), JSON.stringify(['Black Salt']));
assert.equal(JSON.stringify(tracePinchReadiness.pending_yield_items), JSON.stringify(['Black Salt']));

const missingBundleReadiness = fns.buildProductionReadiness({
  customerOrder,
  nativeOrder,
  task,
  lookup,
  lineItems: [{ title: 'Missing Bundle Product', quantity: 1 }],
  masterData: { recipes, bundles: [], products, inventoryItems, ingredientYields },
  existingBatches: [],
});
assert.equal(missingBundleReadiness.production_ready, false);
assert.ok(missingBundleReadiness.blockers.includes('missing_bundle_mapping:Missing Bundle Product'));
assert.equal(JSON.stringify(missingBundleReadiness.missing_bundle_items), JSON.stringify(['Missing Bundle Product']));

const unpaidReadiness = fns.buildProductionReadiness({
  customerOrder: { ...customerOrder, payment_status: 'pending', payment_captured: false },
  nativeOrder: { ...nativeOrder, payment_status: 'pending' },
  task,
  lookup,
  lineItems,
  masterData: { recipes, bundles, products, inventoryItems, ingredientYields },
  existingBatches: [],
});
assert.ok(unpaidReadiness.blockers.includes('order_not_paid'));
assert.ok(unpaidReadiness.blockers.includes('payment_not_captured'));
assert.equal(unpaidReadiness.production_ready, false);

const mismatchedTaskReadiness = fns.buildProductionReadiness({
  customerOrder,
  nativeOrder,
  task: { ...task, id: 'task_wrong', base44_order_id: 'other_order', native_shopify_order_id: 'other_native_order', order_number: 'OTHER-ORDER' },
  lookup: { ...lookup, taskId: 'task_wrong' },
  lineItems,
  masterData: { recipes, bundles, products, inventoryItems, ingredientYields },
  existingBatches: [],
});
assert.ok(mismatchedTaskReadiness.blockers.includes('native_task_base44_order_link_mismatch'));
assert.ok(mismatchedTaskReadiness.blockers.includes('native_task_shopify_order_link_mismatch'));
assert.ok(mismatchedTaskReadiness.blockers.includes('native_task_order_number_mismatch'));
assert.equal(mismatchedTaskReadiness.production_ready, false);

const posReadiness = fns.buildProductionReadiness({
  customerOrder: { ...customerOrder, fulfillment_method: 'pickup', order_type: 'pos' },
  nativeOrder: { ...nativeOrder, order_type: 'pos' },
  task: { ...task, fulfillment_type: 'pickup' },
  lookup,
  lineItems,
  masterData: { recipes, bundles, products, inventoryItems, ingredientYields },
  existingBatches: [],
});
assert.ok(posReadiness.blockers.includes('pos_event_order_out_of_scope'));
assert.ok(!posReadiness.blockers.some(blocker => blocker.includes('delivery_address')));

const poundsToOz = fns.stockToOz(2, 'lbs');
assert.equal(poundsToOz.ok, true);
assert.equal(poundsToOz.value, 32);
assert.equal(poundsToOz.reason, null);
assert.equal(fns.stockToOz(2, 'cases').ok, false);

console.log('G31A native production/inventory readiness tests passed');
