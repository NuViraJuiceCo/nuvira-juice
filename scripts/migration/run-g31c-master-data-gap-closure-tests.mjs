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
  inventory_matches: [],
  yield_matches: [
    { requested_name: 'Pineapple', normalized_name: 'pineapple', status: 'matched', count: 1, matches: [{ id: 'hub_yield_pineapple', name: 'Pineapple', purchase_unit: 'case', oz_per_purchase_unit: 160 }] },
  ],
  product_matches: [
    { requested_name: 'The NuVira Trio', normalized_name: 'the nuvira trio', status: 'matched', count: 1, matches: [{ id: 'hub_product_trio', name: 'The NuVira Trio', category: 'bundle' }] },
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
assert.equal(productBundleCandidate.status, 'manual_mapping_required');
assert.equal(productBundleCandidate.proposed_action, 'product_catalog_candidate_requires_manual_bundle_mapping');
assert.ok(productBundleCandidate.owner_input_fields_required.includes('components.product_name'));

const aliasYieldCandidate = fns.buildSeedPacketRow({ row: missingBlackSaltYieldRow, hubData });
assert.equal(aliasYieldCandidate.status, 'manual_mapping_required');
assert.equal(aliasYieldCandidate.proposed_action, 'alias_existing_hub_yield');
assert.equal(aliasYieldCandidate.hub_source_id, 'hub_yield_kala_namak');

const missingYieldNoAlias = fns.buildSeedPacketRow({ row: { ...missingBlackSaltYieldRow, required_name: 'Beetroot', normalized_name: 'beetroot', blockers: ['missing_hub_yield:Beetroot'] }, hubData: { ...hubData, yield_alias_candidates: [] } });
assert.equal(missingYieldNoAlias.status, 'owner_input_required');
assert.ok(missingYieldNoAlias.owner_input_fields_required.includes('oz_per_purchase_unit'));

const closureWithManualRows = fns.buildMasterDataGapClosurePreview({ requiredRows: [readyRecipeRow, missingBundleRow, missingBlackSaltYieldRow], hubData, hubResult: { ok: true, data: hubData } });
assert.equal(closureWithManualRows.seed_packet_ready, false);
assert.equal(closureWithManualRows.manual_mapping_required_rows.length, 2);
assert.equal(closureWithManualRows.next_action, 'create_update_hub_master_data_first');

const closureReady = fns.buildMasterDataGapClosurePreview({ requiredRows: [readyRecipeRow, readyYieldRow], hubData, hubResult: { ok: true, data: hubData } });
assert.equal(closureReady.seed_packet_ready, true);
assert.equal(closureReady.next_action, 'ready_for_customer_app_master_data_mirror_approval');

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

console.log('G31C Customer master-data gap closure tests passed');
