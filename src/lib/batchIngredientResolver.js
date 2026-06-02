/**
 * Resolves the ingredients for a BatchComplianceLog for display/print purposes.
 * Priority: embedded batch ingredients → default formula ingredients → built-in recipe lookup.
 * Read-only — no database writes.
 */

// Normalize product names to canonical form for recipe lookup
export function normalizeProductName(name) {
  if (!name) return 'Unknown';
  const n = name.trim();
  if (/re[\s-]?nu/i.test(n)) return 'Re-Nu';
  if (/reset/i.test(n)) return 'Reset Shot';
  if (/hydrat/i.test(n)) return 'Hydration Shot';
  if (/radiance/i.test(n)) return 'Radiance Shot';
  if (/watermelon/i.test(n)) return 'Watermelon Juice';
  if (/pineapple/i.test(n)) return 'Pineapple Juice';
  if (/orange/i.test(n)) return 'Orange Juice';
  if (/oasis/i.test(n)) return 'Oasis';
  if (/aura/i.test(n)) return 'Aura';
  return n;
}

// Built-in recipe map with quantities per 12oz bottle (oz unless noted)
// quantity_oz = oz per bottle; unit shown on form
const BUILT_IN_RECIPES = {
  'Re-Nu': [
    { ingredient_name: 'Cucumber',    quantity_oz: 3,   unit: 'oz' },
    { ingredient_name: 'Green Apple', quantity_oz: 3,   unit: 'oz' },
    { ingredient_name: 'Red Apple',   quantity_oz: 2,   unit: 'oz' },
    { ingredient_name: 'Celery',      quantity_oz: 2,   unit: 'oz' },
    { ingredient_name: 'Kale',        quantity_oz: 2,   unit: 'oz' },
  ],
  'Aura': [
    { ingredient_name: 'Carrot',        quantity_oz: 3,    unit: 'oz' },
    { ingredient_name: 'Pineapple',     quantity_oz: 2.5,  unit: 'oz' },
    { ingredient_name: 'Orange',        quantity_oz: 2.5,  unit: 'oz' },
    { ingredient_name: 'Ginger',        quantity_oz: 0.5,  unit: 'oz' },
    { ingredient_name: 'Cucumber',      quantity_oz: 2,    unit: 'oz' },
    { ingredient_name: 'Coconut Water', quantity_oz: 1,    unit: 'oz' },
    { ingredient_name: 'Sea Salt',      quantity_oz: 0.25, unit: 'oz' },
  ],
  'Oasis': [
    { ingredient_name: 'Watermelon',    quantity_oz: 3.5,  unit: 'oz' },
    { ingredient_name: 'Pineapple',     quantity_oz: 2,    unit: 'oz' },
    { ingredient_name: 'Orange',        quantity_oz: 2,    unit: 'oz' },
    { ingredient_name: 'Lemon',         quantity_oz: 1,    unit: 'oz' },
    { ingredient_name: 'Ginger',        quantity_oz: 0.5,  unit: 'oz' },
    { ingredient_name: 'Coconut Water', quantity_oz: 1.5,  unit: 'oz' },
    { ingredient_name: 'Sea Salt',      quantity_oz: 0.25, unit: 'oz' },
    { ingredient_name: 'Black Pepper',  quantity_oz: 0.1,  unit: 'oz' },
  ],
  'Reset Shot': [
    { ingredient_name: 'Pineapple',  quantity_oz: 1,    unit: 'oz' },
    { ingredient_name: 'Lemon',      quantity_oz: 0.75, unit: 'oz' },
    { ingredient_name: 'Ginger',     quantity_oz: 0.5,  unit: 'oz' },
    { ingredient_name: 'Black Salt', quantity_oz: 0.1,  unit: 'oz' },
  ],
  'Hydration Shot': [
    { ingredient_name: 'Coconut Water', quantity_oz: 1.5,  unit: 'oz' },
    { ingredient_name: 'Lime Juice',    quantity_oz: 0.75, unit: 'oz' },
    { ingredient_name: 'Honey',         quantity_oz: 0.5,  unit: 'oz' },
    { ingredient_name: 'Mint',          quantity_oz: 0.25, unit: 'oz' },
    { ingredient_name: 'Pink Salt',     quantity_oz: 0.1,  unit: 'oz' },
  ],
  'Radiance Shot': [
    { ingredient_name: 'Beetroot',   quantity_oz: 1.5,  unit: 'oz' },
    { ingredient_name: 'Red Apple',  quantity_oz: 0.75, unit: 'oz' },
    { ingredient_name: 'Lemon',      quantity_oz: 0.5,  unit: 'oz' },
  ],
  'Orange Juice': [
    { ingredient_name: 'Orange', quantity_oz: 12, unit: 'oz' },
  ],
  'Pineapple Juice': [
    { ingredient_name: 'Pineapple', quantity_oz: 12, unit: 'oz' },
  ],
  'Watermelon Juice': [
    { ingredient_name: 'Watermelon', quantity_oz: 12, unit: 'oz' },
  ],
};

/**
 * Returns { ingredients, source, lotNotes }
 *  - ingredients: array of { ingredient_name, quantity, unit, lot_number } or { ingredient_name } only
 *  - source: 'Batch Final Ingredients' | 'Default Product Formula' | 'Recipe Lookup' | null
 *  - lotNotes: string | null
 */
export function resolveIngredients(log) {
  const lotNotes = log.ingredient_lot_notes || null;

  // 1. BatchComplianceLog.ingredients (set during verifyAndLogBatch from actual batch data)
  if (log.ingredients?.length > 0) {
    return { ingredients: log.ingredients, source: 'Batch Final Ingredients', lotNotes };
  }

  // 2. BatchComplianceLog.final_batch_ingredients
  if (log.final_batch_ingredients?.length > 0) {
    return { ingredients: log.final_batch_ingredients, source: 'Batch Final Ingredients', lotNotes };
  }

  // 3. BatchComplianceLog.default_formula_ingredients
  if (log.default_formula_ingredients?.length > 0) {
    return { ingredients: log.default_formula_ingredients, source: 'Default Product Formula', lotNotes };
  }

  // 4. Built-in recipe lookup by normalized product name
  const normalized = normalizeProductName(log.juice_flavor || log.product_name);
  const builtIn = BUILT_IN_RECIPES[normalized];
  if (builtIn) {
    // Map to standard shape: use quantity_oz as quantity
    const ingredients = builtIn.map(i => ({
      ingredient_name: i.ingredient_name,
      quantity: i.quantity_oz,
      unit: i.unit,
    }));
    return { ingredients, source: 'Recipe Lookup', lotNotes };
  }

  // 5. No structured data — fall back to lot notes as text only
  if (lotNotes) {
    return { ingredients: null, source: null, lotNotes };
  }

  return { ingredients: null, source: null, lotNotes: null };
}