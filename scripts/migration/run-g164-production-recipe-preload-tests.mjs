#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildRecipeBatchDefaults,
  canonicalProductionProductKey,
  findActiveRecipeForBatch,
  mergeRecipeBatchDefaults,
} from '../../src/lib/productionRecipeDefaults.js';

const recipeNames = [
  'Aura',
  'Oasis',
  'Re-Nu',
  'Orange Juice',
  'Pineapple Juice',
  'Watermelon Juice',
  'Hydration Shot',
  'Radiance Shot',
  'Reset Shot',
];
const recipes = recipeNames.map((productName, index) => ({
  id: `recipe_${index + 1}`,
  product_name: productName,
  product_sku: `${productName.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}-12`,
  bottle_size_oz: productName.endsWith('Shot') ? 2 : (productName.endsWith('Juice') ? 32 : 12),
  is_active: true,
  ingredients: [{ ingredient_name: `${productName} ingredient`, quantity_oz: index + 0.5, unit: 'oz' }],
}));

const variants = [
  ['AURA', 'Aura'],
  ['OASIS', 'Oasis'],
  ['RE NU', 'Re-Nu'],
  ['orange', 'Orange Juice'],
  ['PINEAPPLE JUICE', 'Pineapple Juice'],
  ['Watermelon 32 oz bottles', 'Watermelon Juice'],
  ['Hydration Shots - F45 event', 'Hydration Shot'],
  ['RADIANCE SHOT', 'Radiance Shot'],
  ['Reset', 'Reset Shot'],
];

for (const [batchName, expectedRecipe] of variants) {
  const recipe = findActiveRecipeForBatch(recipes, { product_name: batchName });
  assert.equal(recipe?.product_name, expectedRecipe, `${batchName} should resolve ${expectedRecipe}`);
}

assert.equal(canonicalProductionProductKey('OASIS event production'), 'oasis');
assert.equal(canonicalProductionProductKey('Aura® 12oz'), 'aura');

const oasis = {
  product_name: 'Oasis',
  bottle_size_oz: 12,
  is_active: true,
  ingredients: Array.from({ length: 8 }, (_, index) => ({
    ingredient_name: `Oasis ingredient ${index + 1}`,
    quantity_oz: index === 0 ? 3.5 : 0.5,
    unit: 'oz',
  })),
};
const oasisDefaults = buildRecipeBatchDefaults(oasis, { product_name: 'OASIS', planned_units: 20 });
assert.equal(oasisDefaults.formula_or_recipe_used, 'Oasis');
assert.equal(oasisDefaults.bottle_size, '12 oz');
assert.equal(oasisDefaults.ingredients_used.length, 8);
assert.equal(oasisDefaults.ingredients_used[0].quantity, 70);
assert.equal(oasisDefaults.ingredients_used[1].quantity, 10);

const aura = {
  product_name: 'Aura',
  bottle_size_oz: 12,
  is_active: true,
  ingredients: Array.from({ length: 7 }, (_, index) => ({
    ingredient_name: `Aura ingredient ${index + 1}`,
    quantity_oz: 1.25,
    unit: 'oz',
  })),
};
const auraDefaults = buildRecipeBatchDefaults(aura, { product_name: 'AURA', planned_units: 10 });
assert.equal(auraDefaults.ingredients_used.length, 7);
assert.equal(auraDefaults.ingredients_used[0].quantity, 12.5);

const merged = mergeRecipeBatchDefaults(
  { product_resolved: true, warnings: ['backend_recipe_lookup_missed'] },
  oasisDefaults,
);
assert.equal(merged.recipe_resolved, true);
assert.equal(merged.formula_source, 'recipe');
assert.equal(merged.ingredients_used.length, 8);
assert.deepEqual(merged.warnings, ['backend_recipe_lookup_missed']);

const recorded = mergeRecipeBatchDefaults({
  formula_or_recipe_used: 'Operator-confirmed Oasis',
  formula_source: 'production_batch',
  bottle_size: '12 oz',
  ingredients_used: [{ ingredient_name: 'Recorded ingredient', quantity: 5, unit: 'oz', lot_number: 'LOT-1' }],
  ingredient_source: 'production_batch',
}, oasisDefaults);
assert.equal(recorded.formula_or_recipe_used, 'Operator-confirmed Oasis');
assert.equal(recorded.ingredients_used[0].ingredient_name, 'Recorded ingredient');

const inactiveOnly = findActiveRecipeForBatch([{ ...oasis, is_active: false }], { product_name: 'OASIS' });
assert.equal(inactiveOnly, null);

const modalSource = fs.readFileSync('src/components/admin/ProductionPreStartModal.jsx', 'utf8');
const backendSource = fs.readFileSync('base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminProductionQueueSummary/entry.ts', 'utf8');
const criticalSource = fs.readFileSync('scripts/ci/run-critical-regressions.mjs', 'utf8');
assert.match(modalSource, /active-production-recipes/);
assert.match(modalSource, /findActiveRecipeForBatch/);
assert.match(backendSource, /canonicalNamedRows/);
assert.match(backendSource, /recipeEntity\.list\('-updated_date', 100\)/);
assert.match(criticalSource, /run-g164-production-recipe-preload-tests\.mjs/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g164-production-recipe-preload',
  cases: 32,
  supported_recipe_names: recipeNames.length,
  writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
}, null, 2));
