#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/previewNativeProductionInventoryReadiness/entry.ts');

function loadFunctions() {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  const serveIndex = source.indexOf('Deno.serve');
  if (serveIndex >= 0) source = source.slice(0, serveIndex);
  source += `\nglobalThis.__exports = { PROCUREMENT_VISIBILITY_MODE, INVENTORY_POLICY_NON_STOCK, getLookup, isProcurementVisibilityMode, hasProcurementVisibilityTarget, productionBatchLineItems, buildIndexes, expandLineItems, attachRecipes, computeIngredientNeeds, buildProductionReadiness, buildProcurementVisibilityPreview };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    Deno: { env: { get: () => '' } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return context.globalThis.__exports;
}

const fns = loadFunctions();

const lookup = fns.getLookup({
  preview_mode: 'NATIVE_PROCUREMENT_VISIBILITY',
  order_number: 'NV-G34B',
  production_date: '2026-06-07',
  batch_ids: ['batch_oasis'],
});
assert.equal(fns.PROCUREMENT_VISIBILITY_MODE, 'NATIVE_PROCUREMENT_VISIBILITY');
assert.equal(fns.INVENTORY_POLICY_NON_STOCK, 'NON_STOCK_MASTER_DATA_ONLY');
assert.equal(fns.isProcurementVisibilityMode({ preview_mode: 'NATIVE_PROCUREMENT_VISIBILITY' }, lookup), true);
assert.equal(fns.hasProcurementVisibilityTarget(lookup), true);

const customerOrder = {
  id: 'order_g34b',
  order_number: 'NV-G34B',
  payment_status: 'paid',
  payment_captured: true,
  order_type: 'one_time',
  fulfillment_type: 'delivery',
  production_date: '2026-06-07',
  estimated_delivery_date: '2026-06-08',
  line_items: [{ title: 'Oasis', quantity: 1 }, { title: 'Reset Shot', quantity: 1 }],
};
const nativeOrder = {
  id: 'native_g34b',
  base44_order_id: 'order_g34b',
  shopify_order_number: 'NV-G34B',
  order_type: 'one_time',
  fulfillment_method: 'delivery',
  payment_status: 'paid',
  production_date: '2026-06-07',
  line_items: customerOrder.line_items,
};
const task = {
  id: 'task_g34b',
  base44_order_id: 'order_g34b',
  native_shopify_order_id: 'native_g34b',
  order_number: 'NV-G34B',
  fulfillment_type: 'delivery',
  production_date: '2026-06-07',
  delivery_date: '2026-06-08',
};
const recipes = [
  {
    id: 'recipe_oasis',
    product_name: 'Oasis',
    product_sku: 'OASIS',
    yield_factor: 1,
    ingredients: [
      { ingredient_name: 'Sea Salt', quantity_oz: 0.02, unit: 'oz' },
      { ingredient_name: 'Black Pepper', quantity_oz: 0.01, unit: 'oz' },
      { ingredient_name: 'Apple', quantity_oz: 6, unit: 'oz' },
    ],
  },
  {
    id: 'recipe_reset',
    product_name: 'Reset Shot',
    product_sku: 'RESET',
    yield_factor: 1,
    ingredients: [
      { ingredient_name: 'Beetroot', quantity_oz: 0.536, unit: 'oz' },
      { ingredient_name: 'Black Salt', quantity_oz: 0, unit: 'pinch' },
    ],
  },
];
const products = [
  { id: 'product_oasis', title: 'Oasis', category: 'juice' },
  { id: 'product_reset', title: 'Reset Shot', category: 'shot' },
];
const inventoryItems = [
  { id: 'inventory_sea_salt', ingredient: 'Sea Salt', unit: 'bottles', stock: 0, supplier: 'Supplier A', category: 'spice' },
  { id: 'inventory_black_pepper', ingredient: 'Black Pepper', unit: 'bottles', stock: 0, supplier: 'Supplier A', category: 'spice' },
  { id: 'inventory_apple', ingredient: 'Apple', unit: 'lbs', stock: 0, supplier: 'Supplier B', category: 'produce' },
  { id: 'inventory_beetroot', ingredient: 'Beetroot', unit: 'lbs', stock: 0, supplier: 'Supplier B', category: 'produce' },
  { id: 'inventory_black_salt', ingredient: 'Black Salt', unit: 'lbs', stock: 0, supplier: 'Supplier A', category: 'spice' },
];
const ingredientYields = [
  { id: 'yield_sea_salt', ingredient_name: 'Sea Salt', purchase_unit: 'lb', oz_per_purchase_unit: 16, rounding_rule: 'exact' },
  { id: 'yield_black_pepper', ingredient_name: 'Black Pepper', purchase_unit: 'lb', oz_per_purchase_unit: 16, rounding_rule: 'exact' },
  { id: 'yield_apple', ingredient_name: 'Apple', purchase_unit: 'case', oz_per_purchase_unit: 40, rounding_rule: 'round_up_unit' },
];
const batches = [
  { id: 'batch_oasis', batch_id: 'BATCH-OASIS', product_name: 'Oasis', planned_units: 1, production_date: '2026-06-07', order_sources: [{ order_number: 'NV-G34B' }] },
  { id: 'batch_reset', batch_id: 'BATCH-RESET', product_name: 'Reset Shot', planned_units: 1, production_date: '2026-06-07', order_sources: [{ order_number: 'NV-G34B' }] },
];

let readiness = fns.buildProductionReadiness({
  customerOrder,
  nativeOrder,
  task,
  lookup,
  lineItems: customerOrder.line_items,
  masterData: { recipes, bundles: [], products, inventoryItems, ingredientYields },
  existingBatches: batches,
});
let preview = fns.buildProcurementVisibilityPreview(readiness);

assert.equal(preview.success, true);
assert.equal(preview.dry_run, true);
assert.equal(preview.writes_performed, false);
assert.equal(preview.preview_mode, 'NATIVE_PROCUREMENT_VISIBILITY');
assert.equal(preview.inventory_policy, 'NON_STOCK_MASTER_DATA_ONLY');
assert.equal(preview.stock_authoritative, false);
assert.equal(preview.procurement_visibility_ready, true);
assert.equal(preview.procurement_needed, true);
assert.equal(preview.inventory_deduction_ready, false);
assert.equal(preview.purchase_order_ready, false);
assert.equal(preview.purchase_order_automation_held, true);
assert.equal(preview.procurement_conversion_ready, false);
assert.ok(preview.ingredient_need_rows.length >= 5);
assert.ok(preview.procurement_summary_rows.some(row => row.ingredient_name === 'Apple'));
assert.ok(preview.warnings.includes('stock_not_authoritative'));
assert.ok(preview.warnings.includes('non_stock_master_data_policy'));
assert.ok(preview.warnings.includes('inventory_deduction_held'));
assert.ok(preview.warnings.includes('purchase_order_automation_held'));
assert.ok(preview.deferred_yield_rows.some(row => row.ingredient_name === 'Beetroot'));
assert.ok(preview.deferred_yield_rows.some(row => row.ingredient_name === 'Black Salt'));
assert.ok(preview.deferred_stock_unit_rows.some(row => row.ingredient_name === 'Sea Salt'));
assert.ok(preview.deferred_stock_unit_rows.some(row => row.ingredient_name === 'Black Pepper'));
assert.equal(preview.blockers.length, 0);
assert.equal(preview.safety.inventory_deducted, false);
assert.equal(preview.safety.inventory_stock_updated, false);
assert.equal(preview.safety.purchase_orders_created, false);
assert.equal(preview.safety.provider_calls_performed, false);

const batchLineItems = fns.productionBatchLineItems(batches);
assert.equal(batchLineItems.length, 2);
assert.equal(batchLineItems[0].source_batch_id, 'batch_oasis');
readiness = fns.buildProductionReadiness({
  customerOrder: null,
  nativeOrder: null,
  task: null,
  lookup: { productionDate: '2026-06-07', batchIds: [], orderNumber: '' },
  lineItems: batchLineItems,
  masterData: { recipes, bundles: [], products, inventoryItems, ingredientYields },
  existingBatches: batches,
  requireOrderContext: false,
});
preview = fns.buildProcurementVisibilityPreview(readiness);
assert.equal(preview.procurement_visibility_ready, true);
assert.equal(preview.production_date, '2026-06-07');
assert.ok(preview.ingredient_need_rows.some(row => Array.isArray(row.source_batch_ids) && row.source_batch_ids.includes('batch_oasis')));

const missingRecipeReadiness = fns.buildProductionReadiness({
  customerOrder,
  nativeOrder,
  task,
  lookup,
  lineItems: [{ title: 'Mystery Juice', quantity: 1 }],
  masterData: { recipes, bundles: [], products, inventoryItems, ingredientYields },
  existingBatches: [],
});
const missingRecipePreview = fns.buildProcurementVisibilityPreview(missingRecipeReadiness);
assert.equal(missingRecipePreview.procurement_visibility_ready, false);
assert.equal(missingRecipePreview.procurement_visibility_classification, 'blocked_missing_recipe');
assert.ok(missingRecipePreview.blockers.includes('unknown_product_mapping:Mystery Juice'));

const missingInventoryReadiness = fns.buildProductionReadiness({
  customerOrder,
  nativeOrder,
  task,
  lookup,
  lineItems: [{ title: 'Oasis', quantity: 1 }],
  masterData: { recipes, bundles: [], products, inventoryItems: [], ingredientYields },
  existingBatches: [],
});
const missingInventoryPreview = fns.buildProcurementVisibilityPreview(missingInventoryReadiness);
assert.equal(missingInventoryPreview.procurement_visibility_ready, false);
assert.equal(missingInventoryPreview.procurement_visibility_classification, 'blocked_missing_inventory_item');
assert.ok(missingInventoryPreview.missing_master_data_rows.some(row => row.type === 'InventoryItem'));

const unsupportedQuantityReadiness = fns.buildProductionReadiness({
  customerOrder,
  nativeOrder,
  task,
  lookup,
  lineItems: [{ title: 'Bad Recipe', quantity: 1 }],
  masterData: {
    recipes: [{ id: 'recipe_bad', product_name: 'Bad Recipe', ingredients: [{ ingredient_name: 'Apple', quantity_oz: 0, unit: 'oz' }] }],
    bundles: [],
    products: [{ id: 'product_bad', title: 'Bad Recipe', category: 'juice' }],
    inventoryItems,
    ingredientYields,
  },
  existingBatches: [],
});
const unsupportedQuantityPreview = fns.buildProcurementVisibilityPreview(unsupportedQuantityReadiness);
assert.equal(unsupportedQuantityPreview.procurement_visibility_ready, false);
assert.equal(unsupportedQuantityPreview.procurement_visibility_classification, 'blocked_unsupported_recipe_quantity');
assert.ok(unsupportedQuantityPreview.blockers.includes('unsupported_or_missing_recipe_quantity:Bad Recipe:Apple'));

assert.equal(fs.readFileSync(functionPath, 'utf8').includes('.create('), false);
assert.equal(fs.readFileSync(functionPath, 'utf8').includes('.update('), false);

console.log('G34B native procurement visibility tests passed');
