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
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response,
    Deno: { env: { get: () => '' } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return context.globalThis.__exports;
}

const fns = loadFunctions('base44/functions/previewNativeProductionMasterDataParity/entry.ts', [
  'buildCustomerAppNonStockMirrorImportPreview',
]);

const preview = fns.buildCustomerAppNonStockMirrorImportPreview([
  {
    status: 'mirror_ready',
    entity_type: 'recipe',
    customer_app_target_name: 'Pineapple Juice',
    source_line_item: 'Pineapple Juice',
    hub_source_id: 'hub_recipe_pineapple',
    hub_source_name: 'Pineapple Juice',
    seed_payload_preview: {
      product_name: 'Pineapple Juice',
      product_sku: 'PINE',
      bottle_size_oz: 12,
      yield_factor: 1.05,
      ingredients: [{ ingredient_name: 'Pineapple', quantity_oz: 10, unit: 'oz' }],
      is_active: true,
    },
    warnings: [],
  },
  {
    status: 'approved_alias_mapping',
    entity_type: 'bundle',
    customer_app_target_name: 'The NuVira Trio',
    source_line_item: 'The NuVira Trio',
    hub_source_id: '69e8f55b06e17fbd88dbbc0c',
    hub_source_name: 'NuVira Trio',
    approved_alias_mapping: {
      source_name: 'The NuVira Trio',
      target_hub_name: 'NuVira Trio',
      target_hub_id: '69e8f55b06e17fbd88dbbc0c',
    },
    alias_candidate_preview: {
      bundle_name: 'NuVira Trio',
      components: [
        { product_name: 'Pineapple Juice', quantity: 1 },
        { product_name: 'Reset Shot', quantity: 1 },
        { product_name: 'Radiance Shot', quantity: 1 },
      ],
      fulfillment_count: 1,
      is_active: true,
    },
    warnings: ['approved_alias_mapping_applied'],
  },
  {
    status: 'mirror_ready_non_stock_master_data',
    entity_type: 'inventory',
    customer_app_target_name: 'Pineapple',
    source_line_item: 'Pineapple Juice',
    hub_source_id: 'hub_inv_pineapple',
    hub_source_name: 'Pineapple',
    seed_payload_preview: {
      ingredient: 'Pineapple',
      unit: 'lbs',
      stock: 50,
      stock_seed_quantity: 0,
      reorder_point: 2,
      max_stock: 20,
      supplier: 'Produce Vendor',
      category: 'Produce',
      inventory_seed_policy: 'NON_STOCK_MASTER_DATA_ONLY',
    },
    warnings: ['inventory_seed_policy_non_stock_master_data_only'],
  },
  {
    status: 'mirror_ready',
    entity_type: 'yield',
    customer_app_target_name: 'Pineapple',
    source_line_item: 'Pineapple Juice',
    hub_source_id: 'hub_yield_pineapple',
    hub_source_name: 'Pineapple',
    seed_payload_preview: {
      ingredient_name: 'Pineapple',
      purchase_unit: 'case',
      oz_per_purchase_unit: 160,
      trim_waste_factor: 1.05,
      units_per_case: 6,
      rounding_rule: 'round_up_case',
    },
    warnings: [],
  },
  {
    status: 'yield_details_deferred',
    entity_type: 'yield',
    customer_app_target_name: 'Black Salt',
    source_line_item: 'Reset Shot',
    yield_policy: 'DEFER_DETAILED_PURCHASE_CONVERSION_VALUES',
    warnings: ['yield_details_pending'],
  },
]);

assert.equal(preview.success, true);
assert.equal(preview.dry_run, true);
assert.equal(preview.writes_performed, false);
assert.equal(preview.import_ready, true);
assert.equal(preview.create_row_count, 4);
assert.equal(preview.deferred_row_count, 1);
assert.equal(preview.create_rows_by_entity.Recipe, 1);
assert.equal(preview.create_rows_by_entity.Bundle, 1);
assert.equal(preview.create_rows_by_entity.InventoryItem, 1);
assert.equal(preview.create_rows_by_entity.IngredientYield, 1);
assert.equal(preview.next_action, 'approve_gated_customer_app_non_stock_master_data_import');

const bundleRow = preview.create_rows.find(row => row.target_entity === 'Bundle');
assert.equal(bundleRow.payload.bundle_name, 'The NuVira Trio');
assert.equal(bundleRow.payload.components.length, 3);
assert.equal(bundleRow.approved_alias_mapping.target_hub_id, '69e8f55b06e17fbd88dbbc0c');

const inventoryRow = preview.create_rows.find(row => row.target_entity === 'InventoryItem');
assert.equal(inventoryRow.payload.stock, 0);
assert.equal(inventoryRow.payload.reorder_point, 2);
assert.equal(inventoryRow.payload.supplier, 'Produce Vendor');
assert.equal(inventoryRow.payload.notes.includes('NON_STOCK_MASTER_DATA_ONLY'), true);

const deferredYield = preview.deferred_rows[0];
assert.equal(deferredYield.match_value, 'Black Salt');
assert.equal(deferredYield.procurement_conversion_ready, false);
assert.equal(deferredYield.inventory_deduction_ready, false);
assert.equal(deferredYield.purchase_order_automation_ready, false);

assert.equal(preview.safety.recipe_records_created, false);
assert.equal(preview.safety.bundle_records_created, false);
assert.equal(preview.safety.inventory_records_created, false);
assert.equal(preview.safety.ingredient_yield_records_created, false);
assert.equal(preview.safety.provider_calls_performed, false);

console.log('G31F non-stock master-data import preview tests passed');
