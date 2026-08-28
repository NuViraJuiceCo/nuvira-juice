function text(value) {
  return String(value || '').trim();
}

function roundedQuantity(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

export function canonicalProductionProductKey(value) {
  const normalized = text(value)
    .toLowerCase()
    .replace(/[®™]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (!normalized) return '';
  if (/\bre\s*nu\b/.test(normalized)) return 're-nu';
  if (/\bhydrat(?:e|ion|ing)?\b/.test(normalized)) return 'hydration-shot';
  if (/\bradiance\b/.test(normalized)) return 'radiance-shot';
  if (/\breset\b/.test(normalized)) return 'reset-shot';
  if (/\bwatermelon\b/.test(normalized)) return 'watermelon-juice';
  if (/\bpineapple\b/.test(normalized)) return 'pineapple-juice';
  if (/\borange\b/.test(normalized)) return 'orange-juice';
  if (/\boasis\b/.test(normalized)) return 'oasis';
  if (/\baura\b/.test(normalized)) return 'aura';
  return normalized;
}

export function findActiveRecipeForBatch(recipes, batch) {
  const activeRecipes = (Array.isArray(recipes) ? recipes : []).filter(recipe => (
    recipe?.is_active !== false && text(recipe?.product_name)
  ));
  const batchSku = text(batch?.product_sku || batch?.sku).toLowerCase();
  if (batchSku) {
    const skuMatches = activeRecipes.filter(recipe => text(recipe?.product_sku).toLowerCase() === batchSku);
    if (skuMatches.length === 1) return skuMatches[0];
  }

  const batchName = text(batch?.product_name);
  const exactMatches = activeRecipes.filter(recipe => text(recipe?.product_name).toLowerCase() === batchName.toLowerCase());
  if (exactMatches.length === 1) return exactMatches[0];

  const batchKey = canonicalProductionProductKey(batchName);
  if (!batchKey) return null;
  const canonicalMatches = activeRecipes.filter(recipe => canonicalProductionProductKey(recipe?.product_name) === batchKey);
  return canonicalMatches.length === 1 ? canonicalMatches[0] : null;
}

export function buildRecipeBatchDefaults(recipe, batch) {
  if (!recipe) return null;
  const plannedUnits = Number(batch?.planned_units);
  const multiplier = Number.isFinite(plannedUnits) && plannedUnits > 0 ? plannedUnits : 1;
  const recipeIngredients = (Array.isArray(recipe?.ingredients) ? recipe.ingredients : [])
    .slice(0, 40)
    .map(row => {
      const ingredientName = text(row?.ingredient_name);
      const quantityPerBottle = Number(row?.quantity_oz);
      if (!ingredientName || !Number.isFinite(quantityPerBottle) || quantityPerBottle <= 0) return null;
      return {
        ingredient_name: ingredientName,
        quantity: roundedQuantity(quantityPerBottle * multiplier),
        unit: text(row?.unit) || 'oz',
        lot_number: '',
      };
    })
    .filter(Boolean);
  const bottleOunces = Number(recipe?.bottle_size_oz);

  return {
    master_data_resolved: true,
    recipe_resolved: true,
    formula_or_recipe_used: text(recipe?.product_name),
    formula_source: 'recipe',
    bottle_size: Number.isFinite(bottleOunces) && bottleOunces > 0 ? `${bottleOunces} oz` : '',
    bottle_size_source: Number.isFinite(bottleOunces) && bottleOunces > 0 ? 'recipe' : null,
    ingredients_used: recipeIngredients,
    recipe_planned_ingredients: recipeIngredients,
    ingredient_quantity_variances: [],
    ingredient_source: recipeIngredients.length > 0 ? 'recipe_planned_usage' : null,
    ingredient_quantity_basis: recipeIngredients.length > 0
      ? (multiplier > 1 ? 'recipe_per_bottle_times_planned_units' : 'recipe_per_bottle')
      : null,
    warnings: [],
    pH_capture_step: 'verify',
    measured_pH_must_be_entered: true,
  };
}

export function mergeRecipeBatchDefaults(existingDefaults, recipeDefaults) {
  if (!recipeDefaults) return existingDefaults;
  const current = existingDefaults && typeof existingDefaults === 'object' ? existingDefaults : {};
  const hasCurrentIngredients = Array.isArray(current.ingredients_used) && current.ingredients_used.length > 0;
  const hasRecipePlan = Array.isArray(current.recipe_planned_ingredients) && current.recipe_planned_ingredients.length > 0;
  return {
    ...recipeDefaults,
    ...current,
    master_data_resolved: true,
    recipe_resolved: true,
    formula_or_recipe_used: text(current.formula_or_recipe_used) || recipeDefaults.formula_or_recipe_used,
    formula_source: text(current.formula_or_recipe_used) ? (current.formula_source || 'production_batch') : 'recipe',
    bottle_size: text(current.bottle_size) || recipeDefaults.bottle_size,
    bottle_size_source: text(current.bottle_size) ? (current.bottle_size_source || 'production_batch') : recipeDefaults.bottle_size_source,
    ingredients_used: hasCurrentIngredients ? current.ingredients_used : recipeDefaults.ingredients_used,
    recipe_planned_ingredients: hasRecipePlan ? current.recipe_planned_ingredients : recipeDefaults.recipe_planned_ingredients,
    ingredient_source: hasCurrentIngredients ? (current.ingredient_source || 'production_batch') : recipeDefaults.ingredient_source,
    ingredient_quantity_basis: hasCurrentIngredients ? current.ingredient_quantity_basis : recipeDefaults.ingredient_quantity_basis,
    warnings: Array.isArray(current.warnings) ? current.warnings : [],
  };
}
