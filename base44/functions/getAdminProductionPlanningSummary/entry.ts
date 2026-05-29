import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_RANGE_DAYS = 31;
const VALID_PRESETS = new Set(['today', 'this_week', 'next_7_days']);
const VALID_INGREDIENT_STATUSES = new Set(['covered', 'low', 'short', 'no_data']);
const DATE_PENDING = 'date_pending';
const MAY30_NATIVE_ORDER_START_DATE = '2026-05-28';
const BUILT_IN_RECIPE_FALLBACKS = {
  'Re-Nu': [
    { ingredient_name: 'Cucumber', quantity_oz: 3, unit: 'oz' },
    { ingredient_name: 'Green Apple', quantity_oz: 3, unit: 'oz' },
    { ingredient_name: 'Red Apple', quantity_oz: 2, unit: 'oz' },
    { ingredient_name: 'Celery', quantity_oz: 2, unit: 'oz' },
    { ingredient_name: 'Kale', quantity_oz: 2, unit: 'oz' },
  ],
  Aura: [
    { ingredient_name: 'Carrot', quantity_oz: 3, unit: 'oz' },
    { ingredient_name: 'Pineapple', quantity_oz: 2.5, unit: 'oz' },
    { ingredient_name: 'Orange', quantity_oz: 2.5, unit: 'oz' },
    { ingredient_name: 'Ginger', quantity_oz: 0.5, unit: 'oz' },
    { ingredient_name: 'Cucumber', quantity_oz: 2, unit: 'oz' },
    { ingredient_name: 'Coconut Water', quantity_oz: 1, unit: 'oz' },
    { ingredient_name: 'Sea Salt', quantity_oz: 0.25, unit: 'oz' },
  ],
  Oasis: [
    { ingredient_name: 'Watermelon', quantity_oz: 3.5, unit: 'oz' },
    { ingredient_name: 'Pineapple', quantity_oz: 2, unit: 'oz' },
    { ingredient_name: 'Orange', quantity_oz: 2, unit: 'oz' },
    { ingredient_name: 'Lemon', quantity_oz: 1, unit: 'oz' },
    { ingredient_name: 'Ginger', quantity_oz: 0.5, unit: 'oz' },
    { ingredient_name: 'Coconut Water', quantity_oz: 1.5, unit: 'oz' },
    { ingredient_name: 'Sea Salt', quantity_oz: 0.25, unit: 'oz' },
    { ingredient_name: 'Black Pepper', quantity_oz: 0.1, unit: 'oz' },
  ],
};

async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return (value || '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeMatchKey(value) {
  return normalizeLower(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularMatchKey(value) {
  const key = normalizeMatchKey(value);
  return key
    .split(' ')
    .map(part => (part.length > 3 && part.endsWith('s') ? part.slice(0, -1) : part))
    .join(' ');
}

function matchKeys(value) {
  const exact = normalizeMatchKey(value);
  const singular = singularMatchKey(value);
  return Array.from(new Set([exact, singular].filter(Boolean)));
}

function canonicalProductName(value) {
  const text = normalizeText(value);
  if (!text) return null;
  if (/re[\s-]?nu/i.test(text)) return 'Re-Nu';
  if (/oasis/i.test(text)) return 'Oasis';
  if (/aura/i.test(text)) return 'Aura';
  if (/pineapple/i.test(text)) return 'Pineapple Juice';
  if (/orange/i.test(text)) return 'Orange Juice';
  if (/watermelon/i.test(text)) return 'Watermelon Juice';
  return text;
}

function parseOunces(value) {
  const text = normalizeText(value);
  const match = text.match(/(\d+(?:\.\d+)?)\s*oz\b/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseIsoDate(value, fieldName) {
  const text = normalizeText(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD format`);
  }

  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const normalized = date.toISOString().slice(0, 10);
  if (normalized !== text) {
    throw new Error(`${fieldName} must be a valid calendar date`);
  }

  return text;
}

function daysInclusive(from, to) {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function startOfWeekMonday(dateStr) {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function resolveRange({ preset, dateFrom, dateTo }) {
  if (preset === 'custom') return { dateFrom, dateTo };

  const today = todayIsoDate();
  if (preset === 'today') return { dateFrom: today, dateTo: today };
  if (preset === 'this_week') {
    const weekStart = startOfWeekMonday(today);
    return { dateFrom: weekStart, dateTo: addDays(weekStart, 6) };
  }

  return { dateFrom: today, dateTo: addDays(today, 6) };
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeText(value, maxLength = 120) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[redacted]')
    .replace(/\b(?:bearer|authorization|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi, '[redacted]');
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function sanitizeDate(value) {
  return normalizeText(value) || null;
}

function sanitizeStringList(values, maxItems = 12, maxLength = 80) {
  if (!Array.isArray(values)) return [];
  return values
    .map(value => sanitizeText(value, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function sanitizeSummary(summary) {
  return {
    production_date_count: numberOrZero(summary?.production_date_count),
    batch_count: numberOrZero(summary?.batch_count),
    planned_units: numberOrZero(summary?.planned_units),
    produced_units: numberOrZero(summary?.produced_units),
    ingredient_count: numberOrZero(summary?.ingredient_count),
    shortage_count: numberOrZero(summary?.shortage_count),
    missing_recipe_count: numberOrZero(summary?.missing_recipe_count),
    missing_yield_count: numberOrZero(summary?.missing_yield_count),
    native_order_count: numberOrZero(summary?.native_order_count),
    skipped_missing_date_count: numberOrZero(summary?.skipped_missing_date_count),
  };
}

function sanitizeProductGroup(group) {
  return {
    product_name: sanitizeText(group?.product_name),
    product_category: sanitizeText(group?.product_category, 80),
    planned_units: numberOrZero(group?.planned_units),
    produced_units: numberOrZero(group?.produced_units),
    batch_count: numberOrZero(group?.batch_count),
    source_order_count: numberOrZero(group?.source_order_count),
    source: sanitizeText(group?.source, 80),
  };
}

function sanitizeDateGroup(group) {
  const productGroups = Array.isArray(group?.product_groups)
    ? group.product_groups.map(sanitizeProductGroup).slice(0, 100)
    : [];

  return {
    production_date: sanitizeDate(group?.production_date),
    batch_count: numberOrZero(group?.batch_count),
    planned_units: numberOrZero(group?.planned_units),
    produced_units: numberOrZero(group?.produced_units),
    product_groups: productGroups,
    ingredient_count: numberOrZero(group?.ingredient_count),
    shortage_count: numberOrZero(group?.shortage_count),
    native_order_count: numberOrZero(group?.native_order_count),
    source: sanitizeText(group?.source, 80),
  };
}

function mergeSummaries(hubSummary, nativeSummary) {
  return sanitizeSummary({
    production_date_count: numberOrZero(hubSummary?.production_date_count) + numberOrZero(nativeSummary?.production_date_count),
    batch_count: numberOrZero(hubSummary?.batch_count) + numberOrZero(nativeSummary?.batch_count),
    planned_units: numberOrZero(hubSummary?.planned_units) + numberOrZero(nativeSummary?.planned_units),
    produced_units: numberOrZero(hubSummary?.produced_units) + numberOrZero(nativeSummary?.produced_units),
    ingredient_count: numberOrZero(hubSummary?.ingredient_count) + numberOrZero(nativeSummary?.ingredient_count),
    shortage_count: numberOrZero(hubSummary?.shortage_count) + numberOrZero(nativeSummary?.shortage_count),
    missing_recipe_count: numberOrZero(hubSummary?.missing_recipe_count) + numberOrZero(nativeSummary?.missing_recipe_count),
    missing_yield_count: numberOrZero(hubSummary?.missing_yield_count) + numberOrZero(nativeSummary?.missing_yield_count),
    native_order_count: numberOrZero(nativeSummary?.native_order_count),
    skipped_missing_date_count: numberOrZero(nativeSummary?.skipped_missing_date_count),
  });
}

function mergeDateGroups(hubDates, nativeDates) {
  return [
    ...(Array.isArray(hubDates) ? hubDates.map(sanitizeDateGroup) : []),
    ...(Array.isArray(nativeDates) ? nativeDates.map(sanitizeDateGroup) : []),
  ].sort((a, b) => {
    const dateCompare = (a.production_date || '').localeCompare(b.production_date || '');
    if (dateCompare !== 0) return dateCompare;
    return (a.source || 'hub').localeCompare(b.source || 'hub');
  });
}

function normalizeOrderDate(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function isInRange(date, dateFrom, dateTo) {
  return Boolean(date && date >= dateFrom && date <= dateTo);
}

function orderPlanningDate(order) {
  return normalizeOrderDate(
    order?.production_date ||
    order?.assigned_delivery_date ||
    order?.selected_delivery_date ||
    order?.requested_delivery_date ||
    order?.scheduled_delivery_date ||
    order?.delivery_date,
  );
}

function orderReferenceDate(order) {
  return normalizeOrderDate(
    order?.customer_order_date ||
    order?.created_date ||
    order?.shopify_synced_at ||
    order?.updated_date,
  );
}

function safeLineItems(order) {
  return Array.isArray(order?.line_items)
    ? order.line_items.slice(0, 60)
    : [];
}

function addToIndex(index, value, record) {
  for (const key of matchKeys(value)) {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(record);
  }
}

function firstUnambiguous(index, value) {
  for (const key of matchKeys(value)) {
    const matches = index.get(key) || [];
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return { ambiguous: true, matches };
  }
  return null;
}

function inventoryAvailableOz(item) {
  if (!item) return null;
  const stock = numberOrNull(item.stock);
  if (stock === null) return null;

  const unit = normalizeLower(item.unit);
  if (unit === 'lbs' || unit === 'lb') return stock * 16;
  if (unit === 'g') return stock * 0.035274;
  if (unit === 'units' || unit === 'bottles' || unit === 'cases') return null;
  return stock;
}

function lineItemTitle(item) {
  return sanitizeText(item?.title || item?.name || item?.product_title || item?.variant_title, 120);
}

function lineItemSizeOz(item, productRecord) {
  return parseOunces(item?.size) ||
    parseOunces(item?.variant_title) ||
    parseOunces(item?.title) ||
    parseOunces(productRecord?.size) ||
    parseOunces(productRecord?.title) ||
    null;
}

function builtInRecipeForProduct(productName, sizeOz) {
  const canonicalName = canonicalProductName(productName);
  if (!canonicalName) return null;

  if (canonicalName === 'Orange Juice') {
    return {
      product_name: canonicalName,
      yield_factor: 1,
      ingredients: [{ ingredient_name: 'Orange', quantity_oz: sizeOz || 12, unit: 'oz' }],
      source: 'built_in_recipe_fallback',
    };
  }

  if (canonicalName === 'Pineapple Juice') {
    return {
      product_name: canonicalName,
      yield_factor: 1,
      ingredients: [{ ingredient_name: 'Pineapple', quantity_oz: sizeOz || 12, unit: 'oz' }],
      source: 'built_in_recipe_fallback',
    };
  }

  if (canonicalName === 'Watermelon Juice') {
    return {
      product_name: canonicalName,
      yield_factor: 1,
      ingredients: [{ ingredient_name: 'Watermelon', quantity_oz: sizeOz || 12, unit: 'oz' }],
      source: 'built_in_recipe_fallback',
    };
  }

  const recipe = BUILT_IN_RECIPE_FALLBACKS[canonicalName];
  if (!recipe) return null;
  return {
    product_name: canonicalName,
    yield_factor: 1,
    ingredients: recipe,
    source: 'built_in_recipe_fallback',
  };
}

function expandLineItemProducts(item, bundleIndex, productIndex) {
  const title = lineItemTitle(item);
  const quantity = numberOrZero(item?.quantity);
  if (!title || quantity <= 0) return [];

  const bundle = firstUnambiguous(bundleIndex, title);
  if (bundle && !bundle.ambiguous && Array.isArray(bundle.components) && bundle.components.length > 0) {
    return bundle.components
      .map(component => ({
        product_name: sanitizeText(component?.product_name, 120),
        quantity: quantity * numberOrZero(component?.quantity || 1),
        source_line_item: title,
        source_type: 'bundle_component',
      }))
      .filter(component => component.product_name && component.quantity > 0);
  }

  const productRecord = firstUnambiguous(productIndex, title);
  const matchedProduct = productRecord && !productRecord.ambiguous ? productRecord : null;

  return [{
    product_name: title,
    quantity,
    source_line_item: title,
    source_type: 'direct_line_item',
    size_oz: lineItemSizeOz(item, matchedProduct),
  }];
}

function aggregateNativeIngredient(ingredientMap, row) {
  const key = `${normalizeMatchKey(row.ingredient)}::${row.unit || 'oz'}`;
  const current = ingredientMap.get(key) || {
    ingredient: row.ingredient,
    unit: row.unit || 'oz',
    required_quantity: 0,
    available_stock: row.available_stock,
    shortage_amount: 0,
    status: 'no_data',
    source_products: [],
    production_dates: [],
    source: 'customer_app_native',
  };

  current.required_quantity += numberOrZero(row.required_quantity);
  if (row.available_stock !== null && row.available_stock !== undefined) {
    current.available_stock = row.available_stock;
  }
  current.source_products = uniqueStrings([...current.source_products, ...(row.source_products || [])]).slice(0, 20);
  current.production_dates = uniqueStrings([...current.production_dates, ...(row.production_dates || [])]).slice(0, 31);
  ingredientMap.set(key, current);
}

function isNativeMay30OperationalOrder(order) {
  const tags = Array.isArray(order?.tags) ? order.tags.map(normalizeLower) : [];
  const paymentStatus = normalizeLower(order?.payment_status || order?.financial_status);
  const orderType = normalizeLower(order?.order_type);
  const sourceType = normalizeLower(order?.source_type);
  const sourceChannel = normalizeLower(order?.source_channel);
  const fulfillmentMethod = normalizeLower(order?.fulfillment_method);
  const productionStatus = normalizeLower(order?.production_status);
  const syncStatus = normalizeLower(order?.sync_status);
  const referenceDate = orderReferenceDate(order);
  const isRecentLaunchOrder = Boolean(referenceDate && referenceDate >= MAY30_NATIVE_ORDER_START_DATE);
  const hasNativeOpsMarker =
    tags.includes('may30_native_ops') ||
    syncStatus === 'native_may30_ready' ||
    ['customer_app_one_time', 'website_one_time'].includes(sourceType) ||
    ((sourceChannel === 'online' || sourceChannel === 'customer_app' || sourceChannel === 'website') && isRecentLaunchOrder);

  if (!hasNativeOpsMarker) return false;
  if (order?.excluded_from_production === true) return false;
  if (['canceled', 'cancelled', 'refunded'].includes(productionStatus)) return false;
  if (['refunded', 'partially_refunded'].includes(paymentStatus)) return false;
  if (paymentStatus && paymentStatus !== 'paid') return false;
  if (orderType === 'pos' || sourceChannel === 'pos' || fulfillmentMethod === 'pos') return false;
  if (orderType === 'subscription' || sourceChannel === 'subscription' || order?.stripe_subscription_id) return false;
  return safeLineItems(order).length > 0;
}

async function loadNativeMay30Planning(base44, dateFrom, dateTo) {
  const listEntity = async (entityName, sort, limit) => {
    const entity = base44.asServiceRole?.entities?.[entityName];
    if (!entity || typeof entity.list !== 'function') return [];
    return entity.list(sort, limit).catch(() => []);
  };

  const nativeOrders = await listEntity('ShopifyOrder', '-customer_order_date', 500);
  const recipes = await listEntity('Recipe', 'product_name', 500);
  const bundles = await listEntity('Bundle', 'bundle_name', 500);
  const products = await listEntity('Product', 'title', 500);
  const inventoryItems = await listEntity('InventoryItem', 'ingredient', 500);

  const productByDate = new Map();
  const orderNumbersByDate = new Map();
  const ingredientMap = new Map();
  const recipeIndex = new Map();
  const bundleIndex = new Map();
  const productIndex = new Map();
  const inventoryIndex = new Map();
  const missingRecipeKeys = new Set();
  const ambiguousRecipeKeys = new Set();
  const missingInventoryKeys = new Set();
  let skippedDateCount = 0;
  let builtInFallbackRecipeCount = 0;

  recipes
    .filter(recipe => recipe?.is_active !== false)
    .forEach(recipe => {
      addToIndex(recipeIndex, recipe.product_name, recipe);
      if (recipe.product_sku) addToIndex(recipeIndex, recipe.product_sku, recipe);
    });

  bundles
    .filter(bundle => bundle?.is_active !== false)
    .forEach(bundle => addToIndex(bundleIndex, bundle.bundle_name, bundle));

  products
    .filter(product => product?.is_available !== false)
    .forEach(product => addToIndex(productIndex, product.title, product));

  inventoryItems.forEach(item => addToIndex(inventoryIndex, item.ingredient, item));

  for (const order of nativeOrders) {
    if (!isNativeMay30OperationalOrder(order)) continue;

    const plannedProductionDate = orderPlanningDate(order);
    const productionDate = plannedProductionDate || DATE_PENDING;
    if (plannedProductionDate && !isInRange(plannedProductionDate, dateFrom, dateTo)) {
      continue;
    }
    if (!plannedProductionDate) skippedDateCount += 1;

    const orderNumber = sanitizeText(order.shopify_order_number || order.order_number, 80);
    if (!productByDate.has(productionDate)) productByDate.set(productionDate, new Map());
    if (!orderNumbersByDate.has(productionDate)) orderNumbersByDate.set(productionDate, new Set());
    if (orderNumber) orderNumbersByDate.get(productionDate).add(orderNumber);

    const productMap = productByDate.get(productionDate);
    for (const item of safeLineItems(order)) {
      const expandedProducts = expandLineItemProducts(item, bundleIndex, productIndex);
      for (const product of expandedProducts) {
        const productName = product.product_name;
        const key = normalizeLower(productName);
        const quantity = numberOrZero(product.quantity);
        if (!productName || quantity <= 0) continue;

        const recipeMatch = firstUnambiguous(recipeIndex, productName);
        const fallbackRecipe = !recipeMatch ? builtInRecipeForProduct(productName, product.size_oz) : null;
        if (!recipeMatch && !fallbackRecipe) missingRecipeKeys.add(productName);
        if (recipeMatch?.ambiguous) ambiguousRecipeKeys.add(productName);
        if (fallbackRecipe) builtInFallbackRecipeCount += 1;
        const effectiveRecipe = recipeMatch && !recipeMatch.ambiguous ? recipeMatch : fallbackRecipe;

        if (effectiveRecipe && Array.isArray(effectiveRecipe.ingredients)) {
          const recipeYieldFactor = numberOrZero(effectiveRecipe.yield_factor) || 1;
          for (const recipeIngredient of effectiveRecipe.ingredients) {
            const ingredientName = sanitizeText(recipeIngredient?.ingredient_name, 120);
            if (!ingredientName) continue;
            const requiredOz = quantity * numberOrZero(recipeIngredient?.quantity_oz) * recipeYieldFactor;
            const inventoryMatch = firstUnambiguous(inventoryIndex, ingredientName);
            const inventoryItem = inventoryMatch && !inventoryMatch.ambiguous ? inventoryMatch : null;
            const availableOz = inventoryAvailableOz(inventoryItem);
            if (!inventoryItem) missingInventoryKeys.add(ingredientName);
            aggregateNativeIngredient(ingredientMap, {
              ingredient: ingredientName,
              unit: 'oz',
              required_quantity: requiredOz,
              available_stock: availableOz,
              source_products: [productName],
              production_dates: [productionDate],
            });
          }
        }

      const current = productMap.get(key) || {
        product_name: productName,
        product_category: 'Native May 30 Orders',
        planned_units: 0,
        produced_units: 0,
        batch_count: 0,
        source_order_count: 0,
        source: 'customer_app_native',
      };
      current.planned_units += quantity;
      productMap.set(key, current);
      }
    }
  }

  let dates = Array.from(productByDate.entries())
    .map(([productionDate, productMap]) => {
      const productGroups = Array.from(productMap.values()).map(group => ({
        ...group,
        source_order_count: orderNumbersByDate.get(productionDate)?.size || 0,
      }));
      const plannedUnits = productGroups.reduce((sum, group) => sum + numberOrZero(group.planned_units), 0);
      return {
        production_date: productionDate,
        batch_count: 0,
        planned_units: plannedUnits,
        produced_units: 0,
        product_groups: productGroups,
        ingredient_count: 0,
        shortage_count: 0,
        native_order_count: orderNumbersByDate.get(productionDate)?.size || 0,
        source: 'customer_app_native',
      };
    })
    .sort((a, b) => (a.production_date || '').localeCompare(b.production_date || ''));

  const plannedUnits = dates.reduce((sum, group) => sum + numberOrZero(group.planned_units), 0);
  const nativeOrderCount = dates.reduce((sum, group) => sum + numberOrZero(group.native_order_count), 0);
  const ingredients = Array.from(ingredientMap.values()).map(row => {
    const availableStock = row.available_stock === null || row.available_stock === undefined ? null : numberOrZero(row.available_stock);
    const shortageAmount = availableStock === null
      ? numberOrZero(row.required_quantity)
      : Math.max(0, numberOrZero(row.required_quantity) - availableStock);
    let status = 'no_data';
    if (availableStock !== null) {
      if (shortageAmount > 0) status = 'short';
      else if (availableStock <= numberOrZero(row.required_quantity) * 1.15) status = 'low';
      else status = 'covered';
    }

    return {
      ...row,
      available_stock: availableStock,
      shortage_amount: shortageAmount,
      status,
    };
  });
  const ingredientStatsByDate = new Map();
  for (const ingredient of ingredients) {
    for (const productionDate of ingredient.production_dates || []) {
      const current = ingredientStatsByDate.get(productionDate) || { ingredient_count: 0, shortage_count: 0 };
      current.ingredient_count += 1;
      if (ingredient.status === 'short') current.shortage_count += 1;
      ingredientStatsByDate.set(productionDate, current);
    }
  }
  dates = dates.map(group => {
    const stats = ingredientStatsByDate.get(group.production_date) || {};
    return {
      ...group,
      ingredient_count: numberOrZero(stats.ingredient_count),
      shortage_count: numberOrZero(stats.shortage_count),
    };
  });

  return {
    summary: {
      production_date_count: dates.length,
      batch_count: 0,
      planned_units: plannedUnits,
      produced_units: 0,
      ingredient_count: ingredients.length,
      shortage_count: ingredients.filter(row => row.status === 'short').length,
      missing_recipe_count: missingRecipeKeys.size + ambiguousRecipeKeys.size,
      missing_yield_count: 0,
      native_order_count: nativeOrderCount,
      skipped_missing_date_count: skippedDateCount,
    },
    dates,
    ingredients,
    native_recipe_count: recipes.length,
    native_bundle_count: bundles.length,
    native_product_count: products.length,
    built_in_fallback_recipe_count: builtInFallbackRecipeCount,
    native_inventory_item_count: inventoryItems.length,
    missing_recipe_count: missingRecipeKeys.size,
    ambiguous_recipe_count: ambiguousRecipeKeys.size,
    missing_inventory_count: missingInventoryKeys.size,
  };
}

function sanitizeIngredient(row) {
  const status = VALID_INGREDIENT_STATUSES.has(normalizeLower(row?.status))
    ? normalizeLower(row?.status)
    : 'no_data';

  return {
    ingredient: sanitizeText(row?.ingredient),
    unit: sanitizeText(row?.unit, 30),
    required_quantity: numberOrZero(row?.required_quantity),
    available_stock: row?.available_stock === null || row?.available_stock === undefined
      ? null
      : numberOrZero(row.available_stock),
    shortage_amount: numberOrZero(row?.shortage_amount),
    status,
    source_products: sanitizeStringList(row?.source_products, 20, 100),
    production_dates: sanitizeStringList(row?.production_dates, 31, 20),
    source: sanitizeText(row?.source, 80),
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await readJsonBody(req);
    if (body === null) {
      return Response.json({ success: false, error: 'malformed_json' }, { status: 400 });
    }
    let dateFrom;
    let dateTo;
    let preset;

    try {
      dateFrom = parseIsoDate(body.date_from, 'date_from');
      dateTo = parseIsoDate(body.date_to, 'date_to');
      const requestedPreset = normalizeLower(body.preset);
      preset = requestedPreset || ((dateFrom || dateTo) ? 'custom' : 'next_7_days');

      if (preset !== 'custom' && !VALID_PRESETS.has(preset)) {
        throw new Error('preset must be one of today, this_week, next_7_days');
      }

      if ((dateFrom || dateTo) && preset !== 'custom') {
        throw new Error('Use either preset or date_from/date_to, not both');
      }

      if (preset === 'custom') {
        if (!dateFrom || !dateTo) {
          throw new Error('date_from and date_to are required for custom range');
        }
        if (dateTo < dateFrom) {
          throw new Error('date_to must be on or after date_from');
        }
        if (daysInclusive(dateFrom, dateTo) > MAX_RANGE_DAYS) {
          throw new Error(`Date range must be ${MAX_RANGE_DAYS} days or fewer`);
        }
      }
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const resolvedRange = resolveRange({ preset, dateFrom, dateTo });
    const warnings = [];
    let hubData = {
      success: true,
      date_from: resolvedRange.dateFrom,
      date_to: resolvedRange.dateTo,
      generated_at: null,
      summary: {},
      dates: [],
      ingredients: [],
      truncated: false,
    };

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      warnings.push('hub_production_planning_service_not_configured');
    } else {
      const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
      const params = new URLSearchParams();
      if (preset === 'custom') {
        params.set('date_from', dateFrom);
        params.set('date_to', dateTo);
      } else {
        params.set('preset', preset);
      }

      const hubResponse = await fetch(`${hubBase}/functions/getProductionPlanningSummaryForCustomerApp?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
        },
      });

      if (!hubResponse.ok) {
        warnings.push(`hub_production_planning_unavailable:${hubResponse.status}`);
      } else {
        const parsedHubData = await hubResponse.json().catch(() => null);
        if (
          !parsedHubData ||
          parsedHubData.success !== true ||
          !parsedHubData.summary ||
          !Array.isArray(parsedHubData.dates) ||
          !Array.isArray(parsedHubData.ingredients)
        ) {
          warnings.push('hub_production_planning_malformed_response');
        } else {
          hubData = parsedHubData;
        }
      }
    }

    const nativePlanning = await loadNativeMay30Planning(base44, resolvedRange.dateFrom, resolvedRange.dateTo);
    const hubIngredients = Array.isArray(hubData.ingredients) ? hubData.ingredients.map(sanitizeIngredient) : [];
    const nativeIngredients = Array.isArray(nativePlanning.ingredients) ? nativePlanning.ingredients.map(sanitizeIngredient) : [];

    return Response.json({
      success: true,
      date_from: hubData.date_from || resolvedRange.dateFrom,
      date_to: hubData.date_to || resolvedRange.dateTo,
      generated_at: hubData.generated_at || new Date().toISOString(),
      summary: mergeSummaries(hubData.summary, nativePlanning.summary),
      dates: mergeDateGroups(hubData.dates, nativePlanning.dates).slice(0, 62),
      ingredients: [...hubIngredients, ...nativeIngredients].slice(0, 200),
      truncated: hubData.truncated === true,
      native_overlay: {
        source: 'customer_app_shopify_order_mirror',
        read_only: true,
        order_count: nativePlanning.summary.native_order_count,
        planned_units: nativePlanning.summary.planned_units,
        date_count: nativePlanning.summary.production_date_count,
        ingredient_count: nativePlanning.summary.ingredient_count,
        shortage_count: nativePlanning.summary.shortage_count,
        native_recipe_count: nativePlanning.native_recipe_count,
        native_bundle_count: nativePlanning.native_bundle_count,
        native_product_count: nativePlanning.native_product_count,
        built_in_fallback_recipe_count: nativePlanning.built_in_fallback_recipe_count,
        native_inventory_item_count: nativePlanning.native_inventory_item_count,
        missing_recipe_count: nativePlanning.missing_recipe_count,
        ambiguous_recipe_count: nativePlanning.ambiguous_recipe_count,
        missing_inventory_count: nativePlanning.missing_inventory_count,
        skipped_missing_date_count: nativePlanning.summary.skipped_missing_date_count,
        inventory_deduction_enabled: false,
        purchase_order_automation_enabled: false,
      },
      warnings,
    });
  } catch (error) {
    console.error('[getAdminProductionPlanningSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load production planning summary' }, { status: 500 });
  }
});
