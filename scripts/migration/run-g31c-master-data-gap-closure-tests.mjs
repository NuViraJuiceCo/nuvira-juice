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
  'buildMasterDataGapClosurePreview',
  'buildSeedPacketRow',
  'seedPreviewPayload',
  'buildCustomerAppNonStockMirrorImportPreview',
  'buildParityReport',
]);

const readyRecipeRow = {
  required_type: 'recipe',
  required_name: 'Pineapple Juice',
  normalized_name: 'pineapple juice',
  source_line_item: 'Pineapple Juice',
  native_present: false,
  hub_match_status: 'matched',
  field_compatibility_status: 'compatible',
  mirror_readiness: 'ready_to_mirror',
  blockers: [],
  warnings: [],
};
const readyYieldRow = {
  required_type: 'yield',
  required_name: 'Pineapple',
  normalized_name: 'pineapple',
  source_line_item: 'Pineapple Juice',
  native_present: false,
  hub_match_status: 'matched',
  field_compatibility_status: 'compatible',
  mirror_readiness: 'ready_to_mirror',
  blockers: [],
  warnings: [],
};
const readyInventoryRow = {
  required_type: 'inventory',
  required_name: 'Pineapple',
  normalized_name: 'pineapple',
  source_line_item: 'Pineapple Juice',
  native_present: false,
  hub_match_status: 'matched',
  field_compatibility_status: 'compatible',
  mirror_readiness: 'ready_to_mirror_master_data_with_stock_seed_decision',
  blockers: [],
  warnings: ['inventory_seed_policy_non_stock_master_data_only'],
};
const missingBundleRow = {
  required_type: 'bundle',
  required_name: 'The NuVira Trio',
  normalized_name: 'the nuvira trio',
  source_line_item: 'The NuVira Trio',
  native_present: false,
  hub_match_status: 'missing',
  field_compatibility_status: 'missing',
  mirror_readiness: 'blocked',
  blockers: ['missing_hub_bundle:The NuVira Trio'],
  warnings: [],
};
const missingBlackSaltYieldRow = {
  required_type: 'yield',
  required_name: 'Black Salt',
  normalized_name: 'black salt',
  source_line_item: 'Reset Shot',
  native_present: false,
  hub_match_status: 'missing',
  field_compatibility_status: 'missing',
  mirror_readiness: 'blocked',
  blockers: ['missing_hub_yield:Black Salt'],
  warnings: [],
};

const hubData = {
  recipe_matches: [
    { requested_name: 'Pineapple Juice', normalized_name: 'pineapple juice', status: 'matched', count: 1, matches: [{ id: 'hub_recipe_pineapple', name: 'Pineapple Juice', product_sku: 'PINE', bottle_size_oz: 12, yield_factor: 1.05, ingredients: [{ ingredient_name: 'Pineapple', quantity_oz: 10, unit: 'oz' }] }] },
  ],
  bundle_matches: [],
  inventory_matches: [
    { requested_name: 'Pineapple', normalized_name: 'pineapple', status: 'matched', count: 1, matches: [{ id: 'hub_inv_pineapple', name: 'Pineapple', unit: 'lbs', stock: 42, reorder_point: 2, max_stock: 20, supplier: 'Vendor', category: 'Produce' }] },
  ],
  yield_matches: [
    { requested_name: 'Pineapple', normalized_name: 'pineapple', status: 'matched', count: 1, matches: [{ id: 'hub_yield_pineapple', name: 'Pineapple', purchase_unit: 'case', oz_per_purchase_unit: 160 }] },
  ],
  product_matches: [
    { requested_name: 'The NuVira Trio', normalized_name: 'the nuvira trio', status: 'matched', count: 1, matches: [{ id: 'hub_product_trio', name: 'The NuVira Trio', category: 'bundle' }] },
  ],
  bundle_alias_candidates: [
    { requested_name: 'The NuVira Trio', normalized_name: 'the nuvira trio', required_type: 'bundle', candidate_type: 'bundle', status: 'single_candidate', count: 1, candidates: [{ confidence: 0.9, match_kind: 'owner_approved_alias', candidate: { id: '69e8f55b06e17fbd88dbbc0c', name: 'NuVira Trio', component_count: 3, components: [{ product_name: 'Pineapple Juice', quantity: 1 }, { product_name: 'Reset Shot', quantity: 1 }, { product_name: 'Radiance Shot', quantity: 1 }] } }] },
  ],
  yield_alias_candidates: [
    { requested_name: 'Black Salt', normalized_name: 'black salt', required_type: 'yield', candidate_type: 'yield', status: 'single_candidate', count: 1, candidates: [{ confidence: 0.9, match_kind: 'known_alias', candidate: { id: 'hub_yield_kala_namak', name: 'Kala Namak', purchase_unit: 'bag', oz_per_purchase_unit: 16 } }] },
  ],
};

const readyRow = fns.buildSeedPacketRow({ row: readyRecipeRow, hubData });
assert.equal(readyRow.status, 'mirror_ready');
assert.equal(readyRow.proposed_action, 'mirror_hub_recipe');
assert.equal(readyRow.seed_payload_preview.ingredient_count, 1);

const readyYield = fns.buildSeedPacketRow({ row: readyYieldRow, hubData });
assert.equal(readyYield.status, 'mirror_ready');
assert.equal(readyYield.seed_payload_preview.oz_per_purchase_unit, 160);

const productBundleCandidate = fns.buildSeedPacketRow({ row: missingBundleRow, hubData });
assert.equal(productBundleCandidate.status, 'approved_alias_mapping');
assert.equal(productBundleCandidate.proposed_action, 'apply_approved_bundle_alias_mapping');
assert.equal(productBundleCandidate.hub_source_id, '69e8f55b06e17fbd88dbbc0c');
assert.equal(productBundleCandidate.seed_ready, true);

const aliasYieldCandidate = fns.buildSeedPacketRow({ row: missingBlackSaltYieldRow, hubData });
assert.equal(aliasYieldCandidate.status, 'yield_details_deferred');
assert.equal(aliasYieldCandidate.proposed_action, 'defer_purchase_conversion_values');
assert.equal(aliasYieldCandidate.procurement_conversion_ready, false);
assert.equal(aliasYieldCandidate.inventory_deduction_ready, false);

const missingYieldNoAlias = fns.buildSeedPacketRow({ row: { ...missingBlackSaltYieldRow, required_name: 'Beetroot', normalized_name: 'beetroot', blockers: ['missing_hub_yield:Beetroot'] }, hubData: { ...hubData, yield_alias_candidates: [] } });
assert.equal(missingYieldNoAlias.status, 'yield_details_deferred');
assert.equal(missingYieldNoAlias.proposed_action, 'defer_purchase_conversion_values');
assert.equal(missingYieldNoAlias.yield_policy, 'DEFER_DETAILED_PURCHASE_CONVERSION_VALUES');

const closureWithManualRows = fns.buildMasterDataGapClosurePreview({ requiredRows: [readyRecipeRow, missingBundleRow, missingBlackSaltYieldRow], hubData, hubResult: { ok: true, data: hubData } });
assert.equal(closureWithManualRows.seed_packet_ready, true);
assert.equal(closureWithManualRows.non_stock_master_data_seed_ready, true);
assert.equal(closureWithManualRows.production_master_data_ready, true);
assert.equal(closureWithManualRows.procurement_conversion_ready, false);
assert.equal(closureWithManualRows.inventory_deduction_ready, false);
assert.equal(closureWithManualRows.yield_details_pending, true);
assert.equal(JSON.stringify(closureWithManualRows.pending_yield_items), JSON.stringify(['Black Salt']));
assert.equal(closureWithManualRows.manual_mapping_required_rows.length, 0);
assert.equal(closureWithManualRows.owner_input_required_rows.length, 0);
assert.equal(closureWithManualRows.blocked_rows.length, 0);
assert.equal(closureWithManualRows.next_action, 'ready_with_deferred_yield_details');
assert.equal(closureWithManualRows.non_stock_import_preview_ready, true);
assert.equal(closureWithManualRows.customer_app_non_stock_master_data_import_preview.import_ready, true);
assert.equal(closureWithManualRows.customer_app_non_stock_master_data_import_preview.writes_performed, false);

const importPreview = fns.buildCustomerAppNonStockMirrorImportPreview(
  fns.buildMasterDataGapClosurePreview({
    requiredRows: [readyRecipeRow, readyInventoryRow, readyYieldRow, missingBundleRow, missingBlackSaltYieldRow],
    hubData,
    hubResult: { ok: true, data: hubData },
  }).seed_packet_rows,
);
assert.equal(importPreview.import_ready, true);
assert.equal(importPreview.writes_performed, false);
assert.equal(importPreview.create_rows_by_entity.Recipe, 1);
assert.equal(importPreview.create_rows_by_entity.Bundle, 1);
assert.equal(importPreview.create_rows_by_entity.InventoryItem, 1);
assert.equal(importPreview.create_rows_by_entity.IngredientYield, 1);
assert.equal(importPreview.deferred_row_count, 1);
const bundleImportRow = importPreview.create_rows.find(row => row.target_entity === 'Bundle');
assert.equal(bundleImportRow.payload.bundle_name, 'The NuVira Trio');
assert.equal(bundleImportRow.source_hub_id, '69e8f55b06e17fbd88dbbc0c');
const inventoryImportRow = importPreview.create_rows.find(row => row.target_entity === 'InventoryItem');
assert.equal(inventoryImportRow.payload.stock, 0);
assert.equal(inventoryImportRow.payload.reorder_point, 2);
assert.equal(inventoryImportRow.payload.supplier, 'Vendor');
assert.equal(importPreview.deferred_rows[0].match_value, 'Black Salt');
assert.equal(importPreview.deferred_rows[0].inventory_deduction_ready, false);
assert.equal(importPreview.safety.recipe_records_created, false);

const closureReady = fns.buildMasterDataGapClosurePreview({ requiredRows: [readyRecipeRow, readyYieldRow], hubData, hubResult: { ok: true, data: hubData } });
assert.equal(closureReady.seed_packet_ready, true);
assert.equal(closureReady.next_action, 'ready_for_non_stock_master_data_mirror');

const report = fns.buildParityReport({
  lookup: { orderNumber: 'NV-MPZNKGNT' },
  customerOrder: { id: 'order_001', order_number: 'NV-MPZNKGNT' },
  nativeOrder: { id: 'native_order_001', shopify_order_number: 'NV-MPZNKGNT' },
  task: { id: 'task_001' },
  lineItems: [{ title: 'Pineapple Juice', quantity: 1 }],
  nativeData: { recipes: [], bundles: [], inventoryItems: [], ingredientYields: [] },
  hubResult: { ok: true, data: hubData },
});
assert.equal(report.success, true);
assert.equal(report.dry_run, true);
assert.equal(report.writes_performed, false);
assert.equal(report.safety.master_data_imported, false);
assert.ok(Array.isArray(report.seed_packet_rows));
assert.equal(report.inventory_seed_policy, 'NON_STOCK_MASTER_DATA_ONLY');
assert.equal(report.yield_policy, 'DEFER_DETAILED_PURCHASE_CONVERSION_VALUES');

console.log('G31C/G31E Customer master-data gap closure tests passed');
