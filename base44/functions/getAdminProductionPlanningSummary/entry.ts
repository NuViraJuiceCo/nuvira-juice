import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { buildProductionComplianceLifecycleReadModel } from './productionComplianceReadModel.js';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_RANGE_DAYS = 31;
const PRODUCTION_COMPLIANCE_READ_MODEL_MODE = 'PRODUCTION_COMPLIANCE_LIFECYCLE';
const ADMIN_PRODUCTION_COMPLIANCE_READ_MODEL_ENABLE = 'ENABLE_ADMIN_PRODUCTION_COMPLIANCE_READ_MODEL';
const ADMIN_PRODUCTION_COMPLIANCE_READ_MODEL_KILL_SWITCH = 'ADMIN_PRODUCTION_COMPLIANCE_READ_MODEL_KILL_SWITCH';
const PRODUCTION_COMPLIANCE_READ_MODEL_LIMIT = 500;
const VALID_PRESETS = new Set(['today', 'this_week', 'next_7_days']);
const VALID_INGREDIENT_STATUSES = new Set(['covered', 'low', 'short', 'no_data']);
const DATE_PENDING = 'date_pending';
const MAY30_NATIVE_ORDER_START_DATE = '2026-05-28';
const MAY30_EVENT_DATE = '2026-05-30';
const MAY30_POS_EVENT_STOCK_PLAN = {
  event_date: MAY30_EVENT_DATE,
  event_count: 2,
  target: 'sell_out',
  items: [
    { product_name: 'Oasis', quantity: 45, product_category: 'May 30 POS Event Stock' },
    { product_name: 'Aura', quantity: 45, product_category: 'May 30 POS Event Stock' },
    { product_name: 'Re-Nu', quantity: 15, product_category: 'May 30 POS Event Stock' },
    { product_name: 'Hydration Shot', quantity: 9, product_category: 'May 30 POS Event Stock' },
    { product_name: 'Reset Shot', quantity: 1, product_category: 'May 30 POS Event Stock' },
    { product_name: 'Radiance Shot', quantity: 5, product_category: 'May 30 POS Event Stock' },
  ],
};
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

function uniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(value => normalizeText(value)).filter(Boolean)));
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

function sanitizeBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function envFlagEnabled(name) {
  return Deno.env.get(name) === 'true';
}

function readModelGateOpen() {
  return envFlagEnabled(ADMIN_PRODUCTION_COMPLIANCE_READ_MODEL_ENABLE) && !envFlagEnabled(ADMIN_PRODUCTION_COMPLIANCE_READ_MODEL_KILL_SWITCH);
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
    data_source: sanitizeText(group?.data_source, 80),
    fallback_source: sanitizeText(group?.fallback_source, 80),
    fallback_reason: sanitizeText(group?.fallback_reason, 100),
    native_primary: sanitizeBoolean(group?.native_primary, false),
    hub_fallback_used: sanitizeBoolean(group?.hub_fallback_used, false),
    warnings: sanitizeStringList(group?.warnings, 8, 100),
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
    data_source: sanitizeText(group?.data_source, 80),
    fallback_source: sanitizeText(group?.fallback_source, 80),
    fallback_reason: sanitizeText(group?.fallback_reason, 100),
    native_primary: sanitizeBoolean(group?.native_primary, false),
    hub_fallback_used: sanitizeBoolean(group?.hub_fallback_used, false),
    warnings: sanitizeStringList(group?.warnings, 8, 100),
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

function planningProductKey(group) {
  return normalizeMatchKey(group?.product_name);
}

function planningIngredientKey(row) {
  return `${normalizeMatchKey(row?.ingredient)}::${normalizeMatchKey(row?.unit || 'oz')}`;
}

function productGroupsByKey(groups) {
  const map = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    const sanitized = sanitizeProductGroup(group);
    const key = planningProductKey(sanitized);
    if (!key) continue;
    map.set(key, sanitized);
  }
  return map;
}

function decoratePlanningProductGroup(group, metadata) {
  return sanitizeProductGroup({
    ...group,
    data_source: metadata.data_source,
    fallback_source: metadata.fallback_source || null,
    fallback_reason: metadata.fallback_reason || null,
    native_primary: metadata.native_primary === true,
    hub_fallback_used: metadata.hub_fallback_used === true,
    warnings: metadata.warnings || [],
  });
}

function decorateDateGroup(group, metadata) {
  const productGroups = Array.isArray(group?.product_groups)
    ? group.product_groups.map(product => decoratePlanningProductGroup(product, metadata))
    : [];
  return sanitizeDateGroup({
    ...group,
    product_groups: productGroups,
    data_source: metadata.data_source,
    fallback_source: metadata.fallback_source || null,
    fallback_reason: metadata.fallback_reason || null,
    native_primary: metadata.native_primary === true,
    hub_fallback_used: metadata.hub_fallback_used === true,
    warnings: metadata.warnings || [],
  });
}

function decorateIngredient(row, metadata) {
  return sanitizeIngredient({
    ...row,
    data_source: metadata.data_source,
    fallback_source: metadata.fallback_source || null,
    fallback_reason: metadata.fallback_reason || null,
    native_primary: metadata.native_primary === true,
    hub_fallback_used: metadata.hub_fallback_used === true,
    warnings: metadata.warnings || [],
  });
}

function groupSourcePriority(group) {
  if (group?.native_primary === true) return 0;
  if (group?.hub_fallback_used === true) return 1;
  return 2;
}

function mergeDateGroupsNativeFirst(nativeDates, hubDates) {
  const nativeGroups = (Array.isArray(nativeDates) ? nativeDates : [])
    .map(group => decorateDateGroup(group, {
      data_source: 'customer_app_native',
      native_primary: true,
      hub_fallback_used: false,
    }))
    .filter(group => group.production_date || group.product_groups.length > 0 || group.planned_units > 0);
  const hubGroups = (Array.isArray(hubDates) ? hubDates : [])
    .map(group => sanitizeDateGroup(group))
    .filter(group => group.production_date || group.product_groups.length > 0 || group.planned_units > 0);

  const nativeByDate = new Map();
  for (const group of nativeGroups) {
    const key = group.production_date || DATE_PENDING;
    if (!nativeByDate.has(key)) nativeByDate.set(key, []);
    nativeByDate.get(key).push(group);
  }

  const merged = [...nativeGroups];
  const fallbackReasons = new Set();
  let hubFallbackRowCount = 0;
  let suppressedHubRowCount = 0;
  let hubOnlyCount = 0;
  let nativeOnlyCount = 0;
  let mismatchCount = 0;

  for (const group of hubGroups) {
    const dateKey = group.production_date || DATE_PENDING;
    const matchingNative = nativeByDate.get(dateKey) || [];
    if (matchingNative.length === 0) {
      fallbackReasons.add('native_planning_row_missing');
      hubFallbackRowCount += 1;
      hubOnlyCount += 1;
      merged.push(decorateDateGroup(group, {
        data_source: 'hub_fallback',
        fallback_source: 'hub',
        fallback_reason: 'native_planning_row_missing',
        native_primary: false,
        hub_fallback_used: true,
      }));
      continue;
    }

    const nativeProductKeys = new Set();
    let nativePlannedUnits = 0;
    for (const nativeGroup of matchingNative) {
      nativePlannedUnits += numberOrZero(nativeGroup.planned_units);
      for (const key of productGroupsByKey(nativeGroup.product_groups).keys()) nativeProductKeys.add(key);
    }

    const hubProducts = Array.from(productGroupsByKey(group.product_groups).values());
    const missingHubProducts = hubProducts.filter(product => !nativeProductKeys.has(planningProductKey(product)));
    const duplicateProductCount = hubProducts.length - missingHubProducts.length;

    if (missingHubProducts.length > 0) {
      fallbackReasons.add('native_data_incomplete_for_production_planning');
      hubFallbackRowCount += 1;
      const plannedUnits = missingHubProducts.reduce((sum, product) => sum + numberOrZero(product.planned_units), 0);
      merged.push(decorateDateGroup({
        ...group,
        product_groups: missingHubProducts,
        planned_units: plannedUnits || group.planned_units,
        source: group.source || 'hub_fallback',
      }, {
        data_source: 'native_with_hub_fallback_context',
        fallback_source: 'hub',
        fallback_reason: 'native_data_incomplete_for_production_planning',
        native_primary: false,
        hub_fallback_used: true,
        warnings: ['hub_fallback_context_used'],
      }));
    }

    if (duplicateProductCount > 0) {
      suppressedHubRowCount += 1;
      const hubPlannedUnits = numberOrZero(group.planned_units);
      if (hubPlannedUnits > 0 && nativePlannedUnits > 0 && hubPlannedUnits !== nativePlannedUnits) mismatchCount += 1;
    }
  }

  for (const group of nativeGroups) {
    const sameDateHub = hubGroups.some(hubGroup => (hubGroup.production_date || DATE_PENDING) === (group.production_date || DATE_PENDING));
    if (!sameDateHub) nativeOnlyCount += 1;
  }

  merged.sort((a, b) => {
    const dateCompare = (a.production_date || '').localeCompare(b.production_date || '');
    if (dateCompare !== 0) return dateCompare;
    const priorityCompare = groupSourcePriority(a) - groupSourcePriority(b);
    if (priorityCompare !== 0) return priorityCompare;
    return (a.source || '').localeCompare(b.source || '');
  });

  return { rows: merged, hubFallbackRowCount, suppressedHubRowCount, fallbackReasons, hubOnlyCount, nativeOnlyCount, mismatchCount };
}

function mergeIngredientsNativeFirst(nativeIngredients, hubIngredients) {
  const nativeRows = (Array.isArray(nativeIngredients) ? nativeIngredients : [])
    .map(row => decorateIngredient(row, {
      data_source: 'customer_app_native',
      native_primary: true,
      hub_fallback_used: false,
    }))
    .filter(row => row.ingredient);
  const hubRows = (Array.isArray(hubIngredients) ? hubIngredients : [])
    .map(sanitizeIngredient)
    .filter(row => row.ingredient);

  const nativeByIngredient = new Map(nativeRows.map(row => [planningIngredientKey(row), row]));
  const merged = [...nativeRows];
  const fallbackReasons = new Set();
  let hubFallbackRowCount = 0;
  let suppressedHubRowCount = 0;
  let hubOnlyCount = 0;
  let nativeOnlyCount = 0;
  let mismatchCount = 0;

  for (const hubRow of hubRows) {
    const key = planningIngredientKey(hubRow);
    const nativeRow = nativeByIngredient.get(key);
    if (!nativeRow) {
      fallbackReasons.add('native_planning_row_missing');
      hubFallbackRowCount += 1;
      hubOnlyCount += 1;
      merged.push(decorateIngredient(hubRow, {
        data_source: 'hub_fallback',
        fallback_source: 'hub',
        fallback_reason: 'native_planning_row_missing',
        native_primary: false,
        hub_fallback_used: true,
      }));
      continue;
    }

    const nativeIncomplete = nativeRow.yield_match_found !== true || nativeRow.status === 'no_data';
    const quantityMismatch = numberOrZero(nativeRow.required_quantity) !== numberOrZero(hubRow.required_quantity);
    if (quantityMismatch) mismatchCount += 1;

    if (nativeIncomplete) {
      fallbackReasons.add('native_data_incomplete_for_production_planning');
      hubFallbackRowCount += 1;
      merged.push(decorateIngredient(hubRow, {
        data_source: 'native_with_hub_fallback_context',
        fallback_source: 'hub',
        fallback_reason: 'native_data_incomplete_for_production_planning',
        native_primary: false,
        hub_fallback_used: true,
        warnings: ['hub_fallback_context_used'],
      }));
    } else {
      suppressedHubRowCount += 1;
    }
  }

  for (const row of nativeRows) {
    if (!hubRows.some(hubRow => planningIngredientKey(hubRow) === planningIngredientKey(row))) nativeOnlyCount += 1;
  }

  merged.sort((a, b) => {
    const priorityCompare = groupSourcePriority(a) - groupSourcePriority(b);
    if (priorityCompare !== 0) return priorityCompare;
    return (a.ingredient || '').localeCompare(b.ingredient || '');
  });

  return { rows: merged, hubFallbackRowCount, suppressedHubRowCount, fallbackReasons, hubOnlyCount, nativeOnlyCount, mismatchCount };
}

function summaryFromNativeFirstRows(dateRows, ingredientRows, nativePlanning, hubData, hubFallbackUsed) {
  const uniqueDates = new Set((dateRows || []).map(row => row.production_date).filter(Boolean));
  return sanitizeSummary({
    production_date_count: uniqueDates.size,
    batch_count: dateRows.reduce((sum, row) => sum + numberOrZero(row.batch_count), 0),
    planned_units: dateRows.reduce((sum, row) => sum + numberOrZero(row.planned_units), 0),
    produced_units: dateRows.reduce((sum, row) => sum + numberOrZero(row.produced_units), 0),
    ingredient_count: ingredientRows.length,
    shortage_count: ingredientRows.filter(row => row.status === 'short').length,
    missing_recipe_count: numberOrZero(nativePlanning?.summary?.missing_recipe_count) + (hubFallbackUsed ? numberOrZero(hubData?.summary?.missing_recipe_count) : 0),
    missing_yield_count: numberOrZero(nativePlanning?.summary?.missing_yield_count) + (hubFallbackUsed ? numberOrZero(hubData?.summary?.missing_yield_count) : 0),
    native_order_count: numberOrZero(nativePlanning?.summary?.native_order_count),
    skipped_missing_date_count: numberOrZero(nativePlanning?.summary?.skipped_missing_date_count),
  });
}

function buildNativeFirstPlanningParts(nativePlanning, hubData) {
  const nativeDates = Array.isArray(nativePlanning?.dates) ? nativePlanning.dates : [];
  const hubDates = Array.isArray(hubData?.dates) ? hubData.dates : [];
  const nativeIngredients = Array.isArray(nativePlanning?.ingredients) ? nativePlanning.ingredients : [];
  const hubIngredients = Array.isArray(hubData?.ingredients) ? hubData.ingredients : [];

  const dateMerge = mergeDateGroupsNativeFirst(nativeDates, hubDates);
  const ingredientMerge = mergeIngredientsNativeFirst(nativeIngredients, hubIngredients);
  const fallbackReasons = new Set([...dateMerge.fallbackReasons, ...ingredientMerge.fallbackReasons]);
  const hubFallbackRowCount = dateMerge.hubFallbackRowCount + ingredientMerge.hubFallbackRowCount;
  const suppressedHubRowCount = dateMerge.suppressedHubRowCount + ingredientMerge.suppressedHubRowCount;
  const hubOnlyCount = dateMerge.hubOnlyCount + ingredientMerge.hubOnlyCount;
  const nativeOnlyCount = dateMerge.nativeOnlyCount + ingredientMerge.nativeOnlyCount;
  const mismatchCount = dateMerge.mismatchCount + ingredientMerge.mismatchCount;
  const nativeOverlayRowCount = nativeDates.length + nativeIngredients.length;
  const hubSummaryRowCount = hubDates.length + hubIngredients.length;
  const hubFallbackUsed = hubFallbackRowCount > 0;
  const nativeDataPresent = nativeOverlayRowCount > 0;

  return {
    summary: summaryFromNativeFirstRows(dateMerge.rows, ingredientMerge.rows, nativePlanning, hubData, hubFallbackUsed),
    dates: dateMerge.rows,
    ingredients: ingredientMerge.rows,
    metadata: {
      native_first_enabled: true,
      native_row_count: nativeDates.length,
      hub_fallback_row_count: hubFallbackRowCount,
      native_overlay_row_count: nativeOverlayRowCount,
      hub_summary_row_count: hubSummaryRowCount,
      suppressed_hub_row_count: suppressedHubRowCount,
      fallback_required: hubFallbackUsed,
      fallback_reasons: Array.from(fallbackReasons).sort(),
      hub_fallback_used: hubFallbackUsed,
      native_missing_count: nativeDataPresent ? 0 : hubSummaryRowCount,
      hub_only_count: hubOnlyCount,
      native_only_count: nativeOnlyCount,
      mismatch_count: mismatchCount,
      production_planning_source: nativeDataPresent ? 'customer_app_native_first' : (hubFallbackUsed ? 'hub_fallback' : 'empty'),
      writes_performed: false,
      provider_call_impact: false,
      notifications_sent: false,
      hub_mutation_performed: false,
      inventory_deduction_ready: false,
      purchase_order_ready: false,
      live_production_command_candidate: false,
      production_batch_command_ready: false,
      production_lifecycle_command_recommendation: 'preview_only_fresh_active_order_required',
    },
  };
}

async function safeEntityList(base44, entityName, sort, limit) {
  try {
    const entity = base44.asServiceRole?.entities?.[entityName];
    if (!entity?.list) return { rows: [], warning: `${entityName}_entity_unavailable` };
    const rows = await entity.list(sort, limit);
    return { rows: Array.isArray(rows) ? rows : [], warning: null };
  } catch {
    return { rows: [], warning: `${entityName}_read_failed` };
  }
}

async function fetchHubJson(url, headers) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      return { ok: false, warning: `hub_production_planning_unavailable:${response.status}`, data: null };
    }

    const data = await response.json().catch(() => null);
    return { ok: true, warning: null, data };
  } catch {
    return { ok: false, warning: 'hub_production_planning_unavailable:fetch_failed', data: null };
  }
}

function emptyNativePlanning() {
  return {
    summary: {
      production_date_count: 0,
      batch_count: 0,
      planned_units: 0,
      produced_units: 0,
      ingredient_count: 0,
      shortage_count: 0,
      missing_recipe_count: 0,
      missing_yield_count: 0,
      native_order_count: 0,
      skipped_missing_date_count: 0,
    },
    dates: [],
    ingredients: [],
    native_recipe_count: 0,
    native_bundle_count: 0,
    native_product_count: 0,
    built_in_fallback_recipe_count: 0,
    native_inventory_item_count: 0,
    native_ingredient_yield_count: 0,
    missing_recipe_count: 0,
    ambiguous_recipe_count: 0,
    missing_inventory_count: 0,
    missing_yield_count: 0,
    ambiguous_yield_count: 0,
  };
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
    order?.delivery_date ||
    firstFulfillmentDate(order),
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

function firstFulfillmentDate(order) {
  const firstFulfillment = Array.isArray(order?.fulfillments)
    ? order.fulfillments.find(fulfillment => (
        fulfillment?.production_date ||
        fulfillment?.delivery_date ||
        fulfillment?.assigned_delivery_date ||
        fulfillment?.selected_delivery_date ||
        fulfillment?.requested_delivery_date ||
        fulfillment?.scheduled_date
      ))
    : null;
  return firstFulfillment?.production_date ||
    firstFulfillment?.delivery_date ||
    firstFulfillment?.assigned_delivery_date ||
    firstFulfillment?.selected_delivery_date ||
    firstFulfillment?.requested_delivery_date ||
    firstFulfillment?.scheduled_date ||
    order?.first_fulfillment?.production_date ||
    order?.first_fulfillment?.delivery_date ||
    order?.first_fulfillment?.assigned_delivery_date ||
    order?.first_fulfillment?.selected_delivery_date ||
    order?.first_fulfillment?.requested_delivery_date ||
    null;
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

function normalizedPurchaseUnit(yieldRecord) {
  return sanitizeText(yieldRecord?.purchase_unit, 30);
}

function normalizedRoundingRule(yieldRecord) {
  const rule = normalizeLower(yieldRecord?.rounding_rule);
  return ['round_up_unit', 'round_up_case', 'exact'].includes(rule) ? rule : 'round_up_unit';
}

function roundedProcurementQuantity(rawQuantity, roundingRule, unitsPerCase) {
  if (rawQuantity === null || rawQuantity === undefined) return null;
  if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) return 0;
  if (roundingRule === 'exact') return Number(rawQuantity.toFixed(3));
  if (roundingRule === 'round_up_case' && Number.isFinite(unitsPerCase) && unitsPerCase > 0) {
    return Math.ceil(rawQuantity / unitsPerCase) * unitsPerCase;
  }
  return Math.ceil(rawQuantity);
}

function procurementNeedFromYield(row, shortageAmount) {
  if (!row.yield_match_found || !row.oz_per_purchase_unit || row.oz_per_purchase_unit <= 0) {
    return {
      procurement_needed_quantity: null,
      procurement_unit: null,
      procurement_case_quantity: null,
      procurement_basis: row.yield_match_found ? 'yield_missing_conversion' : 'missing_yield',
    };
  }

  const basisOz = numberOrZero(shortageAmount);
  if (basisOz <= 0) {
    return {
      procurement_needed_quantity: 0,
      procurement_unit: row.purchase_unit || null,
      procurement_case_quantity: 0,
      procurement_basis: 'covered',
    };
  }

  const trimWasteFactor = numberOrZero(row.trim_waste_factor) || 1;
  const rawPurchaseUnits = (basisOz * trimWasteFactor) / row.oz_per_purchase_unit;
  const roundedUnits = roundedProcurementQuantity(rawPurchaseUnits, row.rounding_rule, row.units_per_case);
  const caseQuantity = row.rounding_rule === 'round_up_case' && numberOrZero(row.units_per_case) > 0
    ? Math.ceil(rawPurchaseUnits / numberOrZero(row.units_per_case))
    : null;

  return {
    procurement_needed_quantity: roundedUnits,
    procurement_unit: row.purchase_unit || null,
    procurement_case_quantity: caseQuantity,
    procurement_basis: row.available_stock === null || row.available_stock === undefined ? 'required_no_stock_data' : 'shortfall',
  };
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
    yield_match_found: false,
    purchase_unit: null,
    oz_per_purchase_unit: null,
    trim_waste_factor: null,
    units_per_case: null,
    split_case_allowed: null,
    rounding_rule: null,
    supplier: null,
  };

  current.required_quantity += numberOrZero(row.required_quantity);
  if (row.available_stock !== null && row.available_stock !== undefined) {
    current.available_stock = row.available_stock;
  }
  if (row.source && current.source !== row.source) {
    current.source = 'mixed_native_and_event_plan';
  }
  if (row.yield_match_found && !current.yield_match_found) {
    current.yield_match_found = true;
    current.purchase_unit = row.purchase_unit || null;
    current.oz_per_purchase_unit = row.oz_per_purchase_unit ?? null;
    current.trim_waste_factor = row.trim_waste_factor ?? null;
    current.units_per_case = row.units_per_case ?? null;
    current.split_case_allowed = row.split_case_allowed ?? null;
    current.rounding_rule = row.rounding_rule || null;
    current.supplier = row.supplier || null;
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
    try {
      const entity = base44.asServiceRole?.entities?.[entityName];
      if (!entity || typeof entity.list !== 'function') return [];
      const rows = await entity.list(sort, limit).catch(() => []);
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  };

  const nativeOrders = await listEntity('ShopifyOrder', '-customer_order_date', 500);
  const recipes = await listEntity('Recipe', 'product_name', 500);
  const bundles = await listEntity('Bundle', 'bundle_name', 500);
  const products = await listEntity('Product', 'title', 500);
  const inventoryItems = await listEntity('InventoryItem', 'ingredient', 500);
  const ingredientYields = await listEntity('IngredientYield', 'ingredient_name', 500);

  const productByDate = new Map();
  const orderNumbersByDate = new Map();
  const ingredientMap = new Map();
  const recipeIndex = new Map();
  const bundleIndex = new Map();
  const productIndex = new Map();
  const inventoryIndex = new Map();
  const yieldIndex = new Map();
  const missingRecipeKeys = new Set();
  const ambiguousRecipeKeys = new Set();
  const missingInventoryKeys = new Set();
  const missingYieldKeys = new Set();
  const ambiguousYieldKeys = new Set();
  let skippedDateCount = 0;
  let builtInFallbackRecipeCount = 0;
  let eventStockPlanIncluded = false;

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
  ingredientYields.forEach(yieldRecord => addToIndex(yieldIndex, yieldRecord.ingredient_name, yieldRecord));

  function ensurePlanningDate(productionDate) {
    if (!productByDate.has(productionDate)) productByDate.set(productionDate, new Map());
    if (!orderNumbersByDate.has(productionDate)) orderNumbersByDate.set(productionDate, new Set());
    return productByDate.get(productionDate);
  }

  function addProductDemand({ productionDate, productName, quantity, sourceCategory, source, sizeOz }) {
    if (!productName || quantity <= 0) return;

    const productMap = ensurePlanningDate(productionDate);
    const key = normalizeLower(productName);
    const recipeMatch = firstUnambiguous(recipeIndex, productName);
    const fallbackRecipe = !recipeMatch ? builtInRecipeForProduct(productName, sizeOz) : null;
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
        const yieldMatch = firstUnambiguous(yieldIndex, ingredientName);
        const yieldRecord = yieldMatch && !yieldMatch.ambiguous ? yieldMatch : null;
        if (!inventoryItem) missingInventoryKeys.add(ingredientName);
        if (yieldMatch?.ambiguous) ambiguousYieldKeys.add(ingredientName);
        else if (!yieldRecord) missingYieldKeys.add(ingredientName);
        aggregateNativeIngredient(ingredientMap, {
          ingredient: ingredientName,
          unit: 'oz',
          required_quantity: requiredOz,
          available_stock: availableOz,
          source_products: [productName],
          production_dates: [productionDate],
          source,
          yield_match_found: Boolean(yieldRecord),
          purchase_unit: normalizedPurchaseUnit(yieldRecord),
          oz_per_purchase_unit: numberOrNull(yieldRecord?.oz_per_purchase_unit),
          trim_waste_factor: numberOrNull(yieldRecord?.trim_waste_factor),
          units_per_case: numberOrNull(yieldRecord?.units_per_case),
          split_case_allowed: typeof yieldRecord?.split_case_allowed === 'boolean' ? yieldRecord.split_case_allowed : null,
          rounding_rule: normalizedRoundingRule(yieldRecord),
          supplier: sanitizeText(yieldRecord?.supplier || inventoryItem?.supplier, 120),
        });
      }
    }

    const current = productMap.get(key) || {
      product_name: productName,
      product_category: sourceCategory,
      planned_units: 0,
      produced_units: 0,
      batch_count: 0,
      source_order_count: 0,
      source,
    };
    current.planned_units += quantity;
    productMap.set(key, current);
  }

  for (const order of nativeOrders) {
    if (!isNativeMay30OperationalOrder(order)) continue;

    const plannedProductionDate = orderPlanningDate(order);
    const productionDate = plannedProductionDate || DATE_PENDING;
    if (plannedProductionDate && !isInRange(plannedProductionDate, dateFrom, dateTo)) {
      continue;
    }
    if (!plannedProductionDate) skippedDateCount += 1;

    const orderNumber = sanitizeText(order.shopify_order_number || order.order_number, 80);
    ensurePlanningDate(productionDate);
    if (orderNumber) orderNumbersByDate.get(productionDate).add(orderNumber);

    for (const item of safeLineItems(order)) {
      const expandedProducts = expandLineItemProducts(item, bundleIndex, productIndex);
      for (const product of expandedProducts) {
        addProductDemand({
          productionDate,
          productName: product.product_name,
          quantity: numberOrZero(product.quantity),
          sourceCategory: 'Native May 30 Orders',
          source: 'customer_app_native',
          sizeOz: product.size_oz,
        });
      }
    }
  }

  if (isInRange(MAY30_POS_EVENT_STOCK_PLAN.event_date, dateFrom, dateTo)) {
    eventStockPlanIncluded = true;
    ensurePlanningDate(MAY30_POS_EVENT_STOCK_PLAN.event_date);
    orderNumbersByDate.get(MAY30_POS_EVENT_STOCK_PLAN.event_date).add('May 30 POS Event 1');
    orderNumbersByDate.get(MAY30_POS_EVENT_STOCK_PLAN.event_date).add('May 30 POS Event 2');

    for (const item of MAY30_POS_EVENT_STOCK_PLAN.items) {
      addProductDemand({
        productionDate: MAY30_POS_EVENT_STOCK_PLAN.event_date,
        productName: item.product_name,
        quantity: numberOrZero(item.quantity),
        sourceCategory: item.product_category,
        source: 'may30_pos_event_stock_plan',
      });
    }
  }

  let dates = Array.from(productByDate.entries())
    .map(([productionDate, productMap]) => {
      const productGroups = Array.from(productMap.values()).map(group => ({
        ...group,
        source_order_count: orderNumbersByDate.get(productionDate)?.size || 0,
      }));
      const plannedUnits = productGroups.reduce((sum, group) => sum + numberOrZero(group.planned_units), 0);
      const hasEventPlan = productGroups.some(group => group.source === 'may30_pos_event_stock_plan');
      const hasNativeOrders = productGroups.some(group => group.source === 'customer_app_native');
      return {
        production_date: productionDate,
        batch_count: 0,
        planned_units: plannedUnits,
        produced_units: 0,
        product_groups: productGroups,
        ingredient_count: 0,
        shortage_count: 0,
        native_order_count: orderNumbersByDate.get(productionDate)?.size || 0,
        source: hasEventPlan && !hasNativeOrders ? 'may30_pos_event_stock_plan' : 'customer_app_native',
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
    const procurementNeed = procurementNeedFromYield(
      { ...row, available_stock: availableStock },
      shortageAmount,
    );

    return {
      ...row,
      available_stock: availableStock,
      shortage_amount: shortageAmount,
      status,
      ...procurementNeed,
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
      missing_yield_count: missingYieldKeys.size + ambiguousYieldKeys.size,
      native_order_count: nativeOrderCount,
      skipped_missing_date_count: skippedDateCount,
      event_stock_plan_count: eventStockPlanIncluded ? 1 : 0,
    },
    dates,
    ingredients,
    native_recipe_count: recipes.length,
    native_bundle_count: bundles.length,
    native_product_count: products.length,
    built_in_fallback_recipe_count: builtInFallbackRecipeCount,
    native_inventory_item_count: inventoryItems.length,
    native_ingredient_yield_count: ingredientYields.length,
    missing_recipe_count: missingRecipeKeys.size,
    ambiguous_recipe_count: ambiguousRecipeKeys.size,
    missing_inventory_count: missingInventoryKeys.size,
    missing_yield_count: missingYieldKeys.size,
    ambiguous_yield_count: ambiguousYieldKeys.size,
    event_stock_plan: {
      included: eventStockPlanIncluded,
      event_date: MAY30_POS_EVENT_STOCK_PLAN.event_date,
      event_count: MAY30_POS_EVENT_STOCK_PLAN.event_count,
      target: MAY30_POS_EVENT_STOCK_PLAN.target,
      total_units: MAY30_POS_EVENT_STOCK_PLAN.items.reduce((sum, item) => sum + numberOrZero(item.quantity), 0),
      items: MAY30_POS_EVENT_STOCK_PLAN.items.map(item => ({
        product_name: sanitizeText(item.product_name, 120),
        quantity: numberOrZero(item.quantity),
        product_category: sanitizeText(item.product_category, 80),
      })),
      inventory_deduction_enabled: false,
      purchase_order_automation_enabled: false,
    },
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
    yield_match_found: row?.yield_match_found === true,
    purchase_unit: sanitizeText(row?.purchase_unit, 30),
    oz_per_purchase_unit: numberOrNull(row?.oz_per_purchase_unit),
    trim_waste_factor: numberOrNull(row?.trim_waste_factor),
    units_per_case: numberOrNull(row?.units_per_case),
    split_case_allowed: typeof row?.split_case_allowed === 'boolean' ? row.split_case_allowed : null,
    rounding_rule: sanitizeText(row?.rounding_rule, 40),
    supplier: sanitizeText(row?.supplier, 120),
    procurement_needed_quantity: numberOrNull(row?.procurement_needed_quantity),
    procurement_unit: sanitizeText(row?.procurement_unit, 30),
    procurement_case_quantity: numberOrNull(row?.procurement_case_quantity),
    procurement_basis: sanitizeText(row?.procurement_basis, 60),
    source_products: sanitizeStringList(row?.source_products, 20, 100),
    production_dates: sanitizeStringList(row?.production_dates, 31, 20),
    source: sanitizeText(row?.source, 80),
    data_source: sanitizeText(row?.data_source, 80),
    fallback_source: sanitizeText(row?.fallback_source, 80),
    fallback_reason: sanitizeText(row?.fallback_reason, 100),
    native_primary: sanitizeBoolean(row?.native_primary, false),
    hub_fallback_used: sanitizeBoolean(row?.hub_fallback_used, false),
    warnings: sanitizeStringList(row?.warnings, 8, 100),
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
    const productionComplianceReadModelRequested = normalizeText(body.read_model_mode).toUpperCase() === PRODUCTION_COMPLIANCE_READ_MODEL_MODE;
    const productionComplianceReadModelEnabled = readModelGateOpen();
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
    let nativePlanning = emptyNativePlanning();
    try {
      nativePlanning = await loadNativeMay30Planning(base44, resolvedRange.dateFrom, resolvedRange.dateTo);
    } catch (error) {
      console.error('[getAdminProductionPlanningSummary] Native overlay error:', error.message);
      warnings.push('native_production_planning_overlay_unavailable');
    }

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

      const hubResult = await fetchHubJson(
        `${hubBase}/functions/getProductionPlanningSummaryForCustomerApp?${params.toString()}`,
        { Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}` },
      );

      if (!hubResult.ok) {
        warnings.push(hubResult.warning);
      } else {
        const parsedHubData = hubResult.data;
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

    const nativeFirstPlanning = buildNativeFirstPlanningParts(nativePlanning, hubData);

    let productionComplianceReadModel = null;
    if (productionComplianceReadModelRequested && productionComplianceReadModelEnabled) {
      const [productionBatchResult, complianceLogResult, manualBatchResult] = await Promise.all([
        safeEntityList(base44, 'ProductionBatch', '-production_date', PRODUCTION_COMPLIANCE_READ_MODEL_LIMIT),
        safeEntityList(base44, 'BatchComplianceLog', '-created_date', PRODUCTION_COMPLIANCE_READ_MODEL_LIMIT),
        safeEntityList(base44, 'ManualProductionBatch', '-production_date', 200),
      ]);
      for (const warning of [productionBatchResult.warning, complianceLogResult.warning, manualBatchResult.warning].filter(Boolean)) warnings.push(warning);
      productionComplianceReadModel = buildProductionComplianceLifecycleReadModel({
        productionBatches: productionBatchResult.rows,
        batchComplianceLogs: complianceLogResult.rows,
        manualProductionBatches: manualBatchResult.rows,
        dateFrom: resolvedRange.dateFrom,
        dateTo: resolvedRange.dateTo,
        enabled: true,
        sourceMode: 'customer_app_native_first_with_hub_fallback',
      });
    }

    const responseBody = {
      success: true,
      date_from: resolvedRange.dateFrom,
      date_to: resolvedRange.dateTo,
      generated_at: hubData.generated_at || new Date().toISOString(),
      summary: nativeFirstPlanning.summary,
      dates: nativeFirstPlanning.dates.slice(0, 62),
      ingredients: nativeFirstPlanning.ingredients.slice(0, 200),
      truncated: hubData.truncated === true,
      ...nativeFirstPlanning.metadata,
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
        native_ingredient_yield_count: nativePlanning.native_ingredient_yield_count,
        missing_recipe_count: nativePlanning.missing_recipe_count,
        ambiguous_recipe_count: nativePlanning.ambiguous_recipe_count,
        missing_inventory_count: nativePlanning.missing_inventory_count,
        missing_yield_count: nativePlanning.missing_yield_count,
        ambiguous_yield_count: nativePlanning.ambiguous_yield_count,
        skipped_missing_date_count: nativePlanning.summary.skipped_missing_date_count,
        event_stock_plan: nativePlanning.event_stock_plan,
        inventory_deduction_enabled: false,
        purchase_order_automation_enabled: false,
      },
      warnings,
    };

    if (productionComplianceReadModel) {
      responseBody.production_compliance_lifecycle_read_model = productionComplianceReadModel;
    }

    return Response.json(responseBody);
  } catch (error) {
    console.error('[getAdminProductionPlanningSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load production planning summary' }, { status: 500 });
  }
});
