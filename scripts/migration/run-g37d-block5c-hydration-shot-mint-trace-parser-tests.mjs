#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function loadFunctions(relativePath, exportNames) {
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
    Deno: { env: { get: () => '' } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return context.globalThis.__exports;
}

const inventoryFns = loadFunctions('base44/functions/previewNativeProductionInventoryReadiness/entry.ts', [
  'getLookup',
  'buildProductionReadiness',
  'buildProcurementVisibilityPreview',
]);

const demandFns = loadFunctions('base44/functions/previewNativeProductionDemandMaterialization/entry.ts', [
  'getLookup',
  'buildProductionReadiness',
  'buildMaterializationPreview',
]);

const target = {
  order_number: 'NV-MQHJR3V2',
  customer_app_order_id: '6a321cbfd8d78863f15de956',
  native_shopify_order_id: '6a321d38a3819cdd5cf89031',
  native_fulfillment_task_id: '6a321d38071327f8218b958b',
  production_date: '2026-06-19',
  delivery_date: '2026-06-20',
};

const lineItems = [{ title: 'Hydration Shot', quantity: 6 }];
const customerOrder = {
  id: target.customer_app_order_id,
  order_number: target.order_number,
  status: 'scheduled_for_juicing',
  payment_status: 'paid',
  payment_captured: true,
  order_type: 'one_time',
  fulfillment_type: 'delivery',
  production_date: target.production_date,
  delivery_date: target.delivery_date,
  line_items: lineItems,
};
const nativeOrder = {
  id: target.native_shopify_order_id,
  base44_order_id: target.customer_app_order_id,
  shopify_order_number: target.order_number,
  payment_status: 'paid',
  order_type: 'one_time',
  fulfillment_method: 'delivery',
  production_date: target.production_date,
  requested_delivery_date: target.delivery_date,
  line_items: lineItems,
};
const task = {
  id: target.native_fulfillment_task_id,
  base44_order_id: target.customer_app_order_id,
  native_shopify_order_id: target.native_shopify_order_id,
  order_number: target.order_number,
  status: 'pending',
  fulfillment_type: 'delivery',
  production_date: target.production_date,
  delivery_date: target.delivery_date,
};
const hydrationRecipe = {
  id: '6a32a5a5d2c86c2213db0525',
  product_name: 'Hydration Shot',
  yield_factor: 1.05,
  ingredients: [
    { ingredient_name: 'Coconut Water', quantity_oz: 1.69, unit: 'oz' },
    { ingredient_name: 'Lime Juice', quantity_oz: 0.34, unit: 'oz' },
    { ingredient_name: 'Honey', quantity_oz: 0.15, unit: 'oz' },
    { ingredient_name: 'Mint', quantity_oz: 0, unit: 'leaves' },
    { ingredient_name: 'Pink Salt', quantity_oz: 0, unit: 'pinch' },
  ],
};
const inventoryItems = [
  { id: 'inventory_coconut', ingredient: 'Coconut Water', unit: 'oz', stock: 0, supplier: 'held' },
  { id: 'inventory_lime', ingredient: 'Lime Juice', unit: 'lbs', stock: 0, supplier: 'held' },
  { id: 'inventory_honey', ingredient: 'Honey', unit: 'lbs', stock: 0, supplier: 'held' },
  { id: 'inventory_mint', ingredient: 'Mint', unit: 'lbs', stock: 0, supplier: 'held' },
  { id: 'inventory_pink_salt', ingredient: 'Pink Salt', unit: 'lbs', stock: 0, supplier: 'held' },
];
const ingredientYields = [
  { id: 'yield_coconut', ingredient_name: 'Coconut Water', purchase_unit: 'oz', oz_per_purchase_unit: 1, rounding_rule: 'exact' },
];
const products = [{ id: 'product_hydration', title: 'Hydration Shot', category: 'shot' }];

function makeLookup(fns, requestId = 'g37d_block5c_test') {
  return fns.getLookup({
    order_number: target.order_number,
    customer_app_order_id: target.customer_app_order_id,
    native_shopify_order_id: target.native_shopify_order_id,
    native_fulfillment_task_id: target.native_fulfillment_task_id,
    production_date: target.production_date,
    request_id: requestId,
  });
}

function makeMasterData(recipe = hydrationRecipe, overrides = {}) {
  return {
    recipes: [recipe],
    bundles: [],
    products,
    inventoryItems,
    ingredientYields,
    ...overrides,
  };
}

const inventoryReadiness = inventoryFns.buildProductionReadiness({
  customerOrder,
  nativeOrder,
  task,
  lookup: makeLookup(inventoryFns),
  lineItems,
  masterData: makeMasterData(),
  existingBatches: [],
});
assert.equal(inventoryReadiness.success, true);
assert.equal(inventoryReadiness.writes_performed, false);
assert.equal(inventoryReadiness.production_ready, true);
assert.equal(inventoryReadiness.inventory_deduction_ready, false);
assert.equal(inventoryReadiness.purchase_order_ready, false);
assert.equal(inventoryReadiness.safety.inventory_deducted, false);
assert.equal(inventoryReadiness.safety.purchase_orders_created, false);
assert.equal(inventoryReadiness.safety.provider_calls_performed, false);
assert.equal(inventoryReadiness.safety.notifications_sent, false);
assert.ok(!inventoryReadiness.blockers.includes('unsupported_or_missing_recipe_quantity:Hydration Shot:Mint'));
assert.ok(inventoryReadiness.warnings.includes('mint_trace_garnish_inventory_po_held'));
assert.ok(inventoryReadiness.warnings.includes('trace_recipe_ingredient_quantity_pending:Hydration Shot:Mint'));
assert.ok(inventoryReadiness.trace_ingredient_items.includes('Mint'));
const mintNeed = inventoryReadiness.ingredient_need_rows.find(row => row.ingredient_name === 'Mint');
assert.equal(mintNeed.status, 'trace_quantity_pending');
assert.equal(mintNeed.trace_reason, 'owner_approved_hydration_mint_trace_garnish');
assert.equal(mintNeed.proposed_quantity, 0);
assert.equal(mintNeed.procurement_needed, false);
assert.equal(mintNeed.inventory_deduction_ready, false);
assert.equal(mintNeed.purchase_order_ready, false);

const fullyConvertedTraceReadiness = inventoryFns.buildProductionReadiness({
  customerOrder,
  nativeOrder,
  task,
  lookup: makeLookup(inventoryFns, 'g37d_block5c_full_conversion_trace_hold'),
  lineItems,
  masterData: makeMasterData(hydrationRecipe, {
    inventoryItems: inventoryItems.map(row => ({ ...row, unit: 'oz', stock: 999 })),
    ingredientYields: [
      { id: 'yield_coconut', ingredient_name: 'Coconut Water', purchase_unit: 'oz', oz_per_purchase_unit: 1, rounding_rule: 'exact' },
      { id: 'yield_lime', ingredient_name: 'Lime Juice', purchase_unit: 'oz', oz_per_purchase_unit: 1, rounding_rule: 'exact' },
      { id: 'yield_honey', ingredient_name: 'Honey', purchase_unit: 'oz', oz_per_purchase_unit: 1, rounding_rule: 'exact' },
      { id: 'yield_mint', ingredient_name: 'Mint', purchase_unit: 'leaf', oz_per_purchase_unit: 0.01, rounding_rule: 'exact' },
      { id: 'yield_pink_salt', ingredient_name: 'Pink Salt', purchase_unit: 'pinch', oz_per_purchase_unit: 0.01, rounding_rule: 'exact' },
    ],
  }),
  existingBatches: [],
});
assert.equal(fullyConvertedTraceReadiness.production_ready, true);
assert.equal(fullyConvertedTraceReadiness.procurement_conversion_ready, true);
assert.equal(fullyConvertedTraceReadiness.procurement_needed, false);
assert.equal(fullyConvertedTraceReadiness.inventory_deduction_ready, false);
assert.equal(fullyConvertedTraceReadiness.purchase_order_ready, false);
assert.ok(fullyConvertedTraceReadiness.trace_ingredient_items.includes('Mint'));

const procurementPreview = inventoryFns.buildProcurementVisibilityPreview(inventoryReadiness);
assert.equal(procurementPreview.writes_performed, false);
assert.equal(procurementPreview.purchase_order_ready, false);
assert.equal(procurementPreview.purchase_order_automation_held, true);
assert.equal(procurementPreview.inventory_deduction_ready, false);
assert.equal(procurementPreview.safety.inventory_deducted, false);
assert.equal(procurementPreview.safety.purchase_orders_created, false);
assert.equal(procurementPreview.safety.provider_calls_performed, false);
assert.equal(procurementPreview.safety.notifications_sent, false);

const demandReadiness = demandFns.buildProductionReadiness({
  customerOrder,
  nativeOrder,
  task,
  lookup: makeLookup(demandFns, 'g37d_block5c_demand_test'),
  lineItems,
  masterData: makeMasterData(),
  existingBatches: [],
});
assert.equal(demandReadiness.success, true);
assert.equal(demandReadiness.production_ready, true);
assert.equal(demandReadiness.inventory_deduction_ready, false);
assert.equal(demandReadiness.purchase_order_ready, false);
assert.ok(!demandReadiness.blockers.includes('unsupported_or_missing_recipe_quantity:Hydration Shot:Mint'));
assert.ok(demandReadiness.warnings.includes('mint_trace_garnish_inventory_po_held'));
assert.ok(demandReadiness.trace_ingredient_items.includes('Mint'));
const materializationPreview = demandFns.buildMaterializationPreview({ readiness: demandReadiness, existingBatches: [] });
assert.equal(materializationPreview.success, true);
assert.equal(materializationPreview.dry_run, true);
assert.equal(materializationPreview.writes_performed, false);
assert.equal(materializationPreview.materialization_ready, true);
assert.equal(materializationPreview.inventory_deduction_ready, false);
assert.equal(materializationPreview.purchase_order_ready, false);
assert.ok(materializationPreview.warnings.includes('mint_trace_garnish_inventory_po_held'));
assert.equal(materializationPreview.proposed_production_batch_rows.length, 1);
assert.equal(materializationPreview.proposed_production_batch_rows[0].product_name, 'Hydration Shot');
assert.equal(materializationPreview.proposed_production_batch_rows[0].planned_units, 6);
assert.equal(materializationPreview.safety.production_batches_created, false);
assert.equal(materializationPreview.safety.inventory_deducted, false);
assert.equal(materializationPreview.safety.purchase_orders_created, false);
assert.equal(materializationPreview.safety.provider_calls_performed, false);
assert.equal(materializationPreview.safety.notifications_sent, false);

const otherRecipeMintLeaves = {
  id: 'recipe_other',
  product_name: 'Other Shot',
  yield_factor: 1,
  ingredients: [{ ingredient_name: 'Mint', quantity_oz: 0, unit: 'leaves' }],
};
const otherReadiness = inventoryFns.buildProductionReadiness({
  customerOrder: { ...customerOrder, line_items: [{ title: 'Other Shot', quantity: 1 }] },
  nativeOrder: { ...nativeOrder, line_items: [{ title: 'Other Shot', quantity: 1 }] },
  task,
  lookup: makeLookup(inventoryFns, 'g37d_block5c_other_recipe'),
  lineItems: [{ title: 'Other Shot', quantity: 1 }],
  masterData: makeMasterData(otherRecipeMintLeaves, { products: [{ id: 'product_other', title: 'Other Shot', category: 'shot' }] }),
  existingBatches: [],
});
assert.equal(otherReadiness.production_ready, false);
assert.ok(otherReadiness.blockers.includes('unsupported_or_missing_recipe_quantity:Other Shot:Mint'));
assert.ok(!otherReadiness.warnings.includes('mint_trace_garnish_inventory_po_held'));

const hydrationOtherLeaves = {
  ...hydrationRecipe,
  ingredients: [{ ingredient_name: 'Basil', quantity_oz: 0, unit: 'leaves' }],
};
const otherIngredientReadiness = inventoryFns.buildProductionReadiness({
  customerOrder,
  nativeOrder,
  task,
  lookup: makeLookup(inventoryFns, 'g37d_block5c_other_ingredient'),
  lineItems,
  masterData: makeMasterData(hydrationOtherLeaves, { inventoryItems: [{ id: 'inventory_basil', ingredient: 'Basil', unit: 'lbs', stock: 0 }] }),
  existingBatches: [],
});
assert.equal(otherIngredientReadiness.production_ready, false);
assert.ok(otherIngredientReadiness.blockers.includes('unsupported_or_missing_recipe_quantity:Hydration Shot:Basil'));
assert.ok(!otherIngredientReadiness.warnings.includes('mint_trace_garnish_inventory_po_held'));

const unsupportedZeroUnit = {
  id: 'recipe_bad',
  product_name: 'Bad Recipe',
  yield_factor: 1,
  ingredients: [{ ingredient_name: 'Apple', quantity_oz: 0, unit: 'oz' }],
};
const badReadiness = inventoryFns.buildProductionReadiness({
  customerOrder: { ...customerOrder, line_items: [{ title: 'Bad Recipe', quantity: 1 }] },
  nativeOrder: { ...nativeOrder, line_items: [{ title: 'Bad Recipe', quantity: 1 }] },
  task,
  lookup: makeLookup(inventoryFns, 'g37d_block5c_bad_recipe'),
  lineItems: [{ title: 'Bad Recipe', quantity: 1 }],
  masterData: makeMasterData(unsupportedZeroUnit, {
    products: [{ id: 'product_bad', title: 'Bad Recipe', category: 'shot' }],
    inventoryItems: [{ id: 'inventory_apple', ingredient: 'Apple', unit: 'lbs', stock: 0 }],
  }),
  existingBatches: [],
});
assert.equal(badReadiness.production_ready, false);
assert.ok(badReadiness.blockers.includes('unsupported_or_missing_recipe_quantity:Bad Recipe:Apple'));
assert.ok(!badReadiness.warnings.includes('mint_trace_garnish_inventory_po_held'));

for (const rel of [
  'base44/functions/previewNativeProductionInventoryReadiness/entry.ts',
  'base44/functions/previewNativeProductionDemandMaterialization/entry.ts',
]) {
  const source = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
  assert.equal(source.includes('.create('), false, `${rel} must not create records`);
  assert.equal(source.includes('.update('), false, `${rel} must not update records`);
}

console.log('G37D-BLOCK5C Hydration Shot Mint trace parser tests passed');
