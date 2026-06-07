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

const fns = loadFunctions('base44/functions/previewNativeProductionMasterDataParity/entry.ts', [
  'getLookup',
  'safeLineItems',
  'buildParityReport',
  'buildRequiredRow',
  'recommendedNextAction',
  'requirePreviewAccess',
]);

const lookup = fns.getLookup({ order_number: '#NV-MPZNKGNT', customer_app_order_id: 'order_001', native_shopify_order_id: 'native_order_001' });
assert.equal(lookup.orderNumber, 'NV-MPZNKGNT');
assert.equal(lookup.orderId, 'order_001');

const adminAuth = await fns.requirePreviewAccess({
  base44: { auth: { me: async () => ({ role: 'admin', email: 'admin@example.test' }) } },
  req: { headers: { get: () => '' } },
  body: {},
});
assert.equal(adminAuth.ok, true);
assert.equal(adminAuth.actor_type, 'admin');

const customerOrder = {
  id: 'order_001',
  order_number: 'NV-MPZNKGNT',
  line_items: [
    { title: 'Pineapple Juice', quantity: 1 },
    { title: 'The NuVira Trio', quantity: 1 },
    { title: 'Reset Shot', quantity: 1 },
    { title: 'Radiance Shot', quantity: 1 },
  ],
};
const nativeOrder = { id: 'native_order_001', shopify_order_number: 'NV-MPZNKGNT', base44_order_id: 'order_001', line_items: customerOrder.line_items };
const task = { id: 'task_001', native_shopify_order_id: 'native_order_001', order_number: 'NV-MPZNKGNT' };
const lineItems = fns.safeLineItems({ body: {}, customerOrder, nativeOrder, task });
assert.equal(lineItems.length, 4);

const hubData = {
  success: true,
  counts: { recipe_count: 3, bundle_count: 1, inventory_item_count: 3, ingredient_yield_count: 3 },
  recipe_matches: [
    { requested_name: 'Pineapple Juice', normalized_name: 'pineapple juice', status: 'matched', count: 1, matches: [{ id: 'hub_recipe_pineapple', name: 'Pineapple Juice', ingredients: [{ ingredient_name: 'Pineapple', quantity_oz: 10 }], field_compatibility_status: 'compatible' }] },
    { requested_name: 'Reset Shot', normalized_name: 'reset shot', status: 'matched', count: 1, matches: [{ id: 'hub_recipe_reset', name: 'Reset Shot', ingredients: [{ ingredient_name: 'Ginger', quantity_oz: 1 }], field_compatibility_status: 'compatible' }] },
    { requested_name: 'Radiance Shot', normalized_name: 'radiance shot', status: 'matched', count: 1, matches: [{ id: 'hub_recipe_radiance', name: 'Radiance Shot', ingredients: [{ ingredient_name: 'Turmeric', quantity_oz: 1 }], field_compatibility_status: 'compatible' }] },
  ],
  bundle_matches: [
    { requested_name: 'The NuVira Trio', normalized_name: 'the nuvira trio', status: 'matched', count: 1, matches: [{ id: 'hub_bundle_trio', name: 'The NuVira Trio', components: [{ product_name: 'Pineapple Juice', quantity: 1 }, { product_name: 'Reset Shot', quantity: 1 }, { product_name: 'Radiance Shot', quantity: 1 }], field_compatibility_status: 'compatible' }] },
  ],
  component_recipe_matches: [
    { requested_name: 'Pineapple Juice', normalized_name: 'pineapple juice', status: 'matched', count: 1, matches: [{ id: 'hub_recipe_pineapple', name: 'Pineapple Juice', ingredients: [{ ingredient_name: 'Pineapple', quantity_oz: 10 }], field_compatibility_status: 'compatible' }] },
    { requested_name: 'Reset Shot', normalized_name: 'reset shot', status: 'matched', count: 1, matches: [{ id: 'hub_recipe_reset', name: 'Reset Shot', ingredients: [{ ingredient_name: 'Ginger', quantity_oz: 1 }], field_compatibility_status: 'compatible' }] },
    { requested_name: 'Radiance Shot', normalized_name: 'radiance shot', status: 'matched', count: 1, matches: [{ id: 'hub_recipe_radiance', name: 'Radiance Shot', ingredients: [{ ingredient_name: 'Turmeric', quantity_oz: 1 }], field_compatibility_status: 'compatible' }] },
  ],
  inventory_matches: [
    { requested_name: 'Pineapple', normalized_name: 'pineapple', status: 'matched', count: 1, matches: [{ id: 'hub_inv_pineapple', name: 'Pineapple', unit: 'lbs', stock: 0, reorder_point: 2, field_compatibility_status: 'compatible' }] },
    { requested_name: 'Ginger', normalized_name: 'ginger', status: 'matched', count: 1, matches: [{ id: 'hub_inv_ginger', name: 'Ginger', unit: 'lbs', stock: 0, reorder_point: 1, field_compatibility_status: 'compatible' }] },
    { requested_name: 'Turmeric', normalized_name: 'turmeric', status: 'matched', count: 1, matches: [{ id: 'hub_inv_turmeric', name: 'Turmeric', unit: 'lbs', stock: 0, reorder_point: 1, field_compatibility_status: 'compatible' }] },
  ],
  yield_matches: [
    { requested_name: 'Pineapple', normalized_name: 'pineapple', status: 'matched', count: 1, matches: [{ id: 'hub_yield_pineapple', name: 'Pineapple', purchase_unit: 'case', oz_per_purchase_unit: 160, field_compatibility_status: 'compatible' }] },
    { requested_name: 'Ginger', normalized_name: 'ginger', status: 'matched', count: 1, matches: [{ id: 'hub_yield_ginger', name: 'Ginger', purchase_unit: 'case', oz_per_purchase_unit: 80, field_compatibility_status: 'compatible' }] },
    { requested_name: 'Turmeric', normalized_name: 'turmeric', status: 'matched', count: 1, matches: [{ id: 'hub_yield_turmeric', name: 'Turmeric', purchase_unit: 'case', oz_per_purchase_unit: 80, field_compatibility_status: 'compatible' }] },
  ],
};

const report = fns.buildParityReport({
  lookup,
  customerOrder,
  nativeOrder,
  task,
  lineItems,
  nativeData: { recipes: [], bundles: [], inventoryItems: [], ingredientYields: [] },
  hubResult: { ok: true, data: hubData },
});
assert.equal(report.success, true);
assert.equal(report.dry_run, true);
assert.equal(report.writes_performed, false);
assert.equal(report.customer_app_counts.recipe_count, 0);
assert.equal(report.hub_counts.recipe_count, 3);
assert.equal(report.missing_native_bundles.includes('The NuVira Trio'), true);
assert.equal(report.missing_native_recipes.includes('Pineapple Juice'), true);
assert.equal(report.missing_native_inventory_items.includes('Pineapple'), true);
assert.equal(report.missing_native_ingredient_yields.includes('Pineapple'), true);
assert.equal(report.mirror_blockers.length, 0);
assert.equal(report.recommended_next_action, 'ready_for_master_data_mirror');
assert.equal(report.native_production_readiness_after_mirror, true);
assert.ok(report.warnings.includes('inventory_stock_is_live_state_seed_decision_required'));

const missingHubRecipe = fns.buildParityReport({
  lookup,
  customerOrder,
  nativeOrder,
  task,
  lineItems: [{ title: 'Pineapple Juice', quantity: 1 }],
  nativeData: { recipes: [], bundles: [], inventoryItems: [], ingredientYields: [] },
  hubResult: { ok: true, data: { ...hubData, recipe_matches: [{ requested_name: 'Pineapple Juice', normalized_name: 'pineapple juice', status: 'missing', count: 0, matches: [] }], component_recipe_matches: [], inventory_matches: [], yield_matches: [] } },
});
assert.equal(missingHubRecipe.recommended_next_action, 'hub_master_data_missing');
assert.ok(missingHubRecipe.mirror_blockers.includes('missing_hub_recipe:Pineapple Juice'));

const ambiguousHubBundle = fns.buildParityReport({
  lookup,
  customerOrder,
  nativeOrder,
  task,
  lineItems: [{ title: 'The NuVira Trio', quantity: 1 }],
  nativeData: { recipes: [], bundles: [], inventoryItems: [], ingredientYields: [] },
  hubResult: { ok: true, data: { ...hubData, bundle_matches: [{ requested_name: 'The NuVira Trio', normalized_name: 'the nuvira trio', status: 'ambiguous', count: 2, matches: [{ id: 'a', name: 'The NuVira Trio' }, { id: 'b', name: 'The NuVira Trio' }] }], component_recipe_matches: [], inventory_matches: [], yield_matches: [] } },
});
assert.equal(ambiguousHubBundle.recommended_next_action, 'ambiguous_hub_match');
assert.ok(ambiguousHubBundle.mirror_blockers.includes('ambiguous_hub_bundle:The NuVira Trio'));

const existingNativeRecipe = fns.buildParityReport({
  lookup,
  customerOrder,
  nativeOrder,
  task,
  lineItems: [{ title: 'Pineapple Juice', quantity: 1 }],
  nativeData: { recipes: [{ id: 'native_recipe_pineapple', product_name: 'Pineapple Juice', ingredients: [{ ingredient_name: 'Pineapple', quantity_oz: 10 }] }], bundles: [], inventoryItems: [], ingredientYields: [] },
  hubResult: { ok: true, data: hubData },
});
assert.equal(existingNativeRecipe.missing_native_recipes.includes('Pineapple Juice'), false);
assert.equal(existingNativeRecipe.required_master_data_rows.find(row => row.required_type === 'recipe' && row.required_name === 'Pineapple Juice').mirror_readiness, 'already_native');

const schemaGapRow = fns.buildRequiredRow({
  type: 'recipe',
  name: 'Broken Juice',
  sourceLineItem: 'Broken Juice',
  nativeMatches: [],
  hubMatch: { status: 'matched', count: 1, matches: [{ id: 'bad_recipe', name: 'Broken Juice', ingredients: 'not-array', field_compatibility_status: 'schema_gap', incompatibilities: ['ingredients_not_array'] }] },
});
assert.equal(schemaGapRow.mirror_readiness, 'blocked');
assert.ok(schemaGapRow.blockers.includes('recipe_ingredients_not_array:Broken Juice'));

const hubUnavailable = fns.buildParityReport({
  lookup,
  customerOrder,
  nativeOrder,
  task,
  lineItems,
  nativeData: { recipes: [], bundles: [], inventoryItems: [], ingredientYields: [] },
  hubResult: { ok: false, error_code: 'hub_master_data_fetch_failed', message: 'failed' },
});
assert.equal(hubUnavailable.recommended_next_action, 'hold');
assert.ok(hubUnavailable.blockers.includes('hub_master_data_fetch_failed'));

console.log('G31B native master-data parity tests passed');
