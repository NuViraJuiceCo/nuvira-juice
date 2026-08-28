// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_RANGE_DAYS = 31;
const DEFAULT_RANGE_DAYS_AHEAD = 14;
const MAX_LIMIT = 100;
const CHICAGO_TZ = 'America/Chicago';
const TEST_BATCH_MODES = new Set(['exclude', 'only']);
const TERMINAL_OPERATIONAL_STATUSES = new Set([
  'delivered',
  'fulfilled',
  'completed',
  'picked_up',
  'cancelled',
  'canceled',
  'refunded',
]);
const PRE_START_RECORD_TYPES = {
  sanitation: { entity: 'SanitationLog', dateField: 'log_date' },
  daily_checklist: { entity: 'DailyChecklist', dateField: 'checklist_date' },
  temperature: { entity: 'TemperatureLog', dateField: 'log_date' },
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

function todayChicagoDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
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

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysInclusive(from, to) {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
}

function normalizeLimit(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('limit must be a positive integer');
  }
  return Math.min(parsed, MAX_LIMIT);
}

function sanitizeSourceTypeCounts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, count]) => [key.toString(), Number(count) || 0])
      .filter(([key]) => Boolean(key))
  );
}

function safeStringArray(values, limit = 30) {
  if (!Array.isArray(values)) return [];
  return values
    .map(value => normalizeText(value))
    .filter(Boolean)
    .slice(0, limit);
}

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function safeIngredientUsageRows(values) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, 40).map(row => {
    const ingredientName = normalizeText(row?.ingredient_name || row?.name);
    if (!ingredientName) return null;
    return {
      ingredient_name: ingredientName,
      quantity: safeNumber(row?.quantity),
      unit: normalizeText(row?.unit),
      lot_number: normalizeText(row?.lot_number),
    };
  }).filter(Boolean);
}

function sourceKey(batch) {
  return normalizeText(batch.batch_id || batch.id).toLowerCase();
}

function normalizedOrderNumber(value) {
  return normalizeText(value).toLowerCase();
}

function batchOrderNumbers(batch) {
  return safeStringArray(batch?.order_numbers, 50).map(normalizedOrderNumber).filter(Boolean);
}

function lifecycleRecordTerminal(record) {
  if (!record || typeof record !== 'object') return false;
  if (record.delivered_at || record.fulfilled_at || record.completed_at || record.cancelled_at || record.canceled_at) {
    return true;
  }
  return [
    record.status,
    record.order_status,
    record.fulfillment_status,
    record.delivery_status,
  ].some(value => TERMINAL_OPERATIONAL_STATUSES.has(normalizeText(value).toLowerCase()));
}

async function loadTerminalNativeOrderNumbers(base44, hubBatches) {
  const relevantOrderNumbers = new Set(
    (Array.isArray(hubBatches) ? hubBatches : []).flatMap(batchOrderNumbers),
  );
  if (relevantOrderNumbers.size === 0) {
    return { available: true, orderNumbers: new Set(), error: null };
  }

  try {
    const orderEntity = base44.asServiceRole?.entities?.Order;
    const taskEntity = base44.asServiceRole?.entities?.FulfillmentTask;
    if (!orderEntity?.list || !taskEntity?.list) {
      return { available: false, orderNumbers: new Set(), error: 'native_order_lifecycle_entity_unavailable' };
    }

    const [orders, tasks] = await Promise.all([
      orderEntity.list('-updated_date', 500),
      taskEntity.list('-updated_date', 500),
    ]);
    if (!Array.isArray(orders) || !Array.isArray(tasks)) {
      return { available: false, orderNumbers: new Set(), error: 'native_order_lifecycle_entity_malformed' };
    }

    const ordersByNumber = new Map();
    const tasksByNumber = new Map();
    for (const order of orders) {
      const orderNumber = normalizedOrderNumber(order?.order_number || order?.shopify_order_number);
      if (!relevantOrderNumbers.has(orderNumber)) continue;
      if (!ordersByNumber.has(orderNumber)) ordersByNumber.set(orderNumber, []);
      ordersByNumber.get(orderNumber).push(order);
    }
    for (const task of tasks) {
      const orderNumber = normalizedOrderNumber(task?.order_number || task?.shopify_order_number);
      if (!relevantOrderNumbers.has(orderNumber)) continue;
      if (!tasksByNumber.has(orderNumber)) tasksByNumber.set(orderNumber, []);
      tasksByNumber.get(orderNumber).push(task);
    }

    const terminalOrderNumbers = new Set();
    for (const orderNumber of relevantOrderNumbers) {
      const orderRows = ordersByNumber.get(orderNumber) || [];
      const taskRows = tasksByNumber.get(orderNumber) || [];
      if (
        orderRows.length > 0 &&
        taskRows.length > 0 &&
        orderRows.every(lifecycleRecordTerminal) &&
        taskRows.every(lifecycleRecordTerminal)
      ) {
        terminalOrderNumbers.add(orderNumber);
      }
    }

    return { available: true, orderNumbers: terminalOrderNumbers, error: null };
  } catch {
    return { available: false, orderNumbers: new Set(), error: 'native_order_lifecycle_read_failed' };
  }
}

function hubBatchSuppressedByTerminalOrders(batch, terminalOrderNumbers) {
  const orderNumbers = batchOrderNumbers(batch);
  return orderNumbers.length > 0 && orderNumbers.every(orderNumber => terminalOrderNumbers.has(orderNumber));
}

function isInternalTestBatch(batch) {
  const batchId = normalizeText(batch?.batch_id || batch?.id).toLowerCase();
  const sourceSystem = normalizeText(batch?.source_system).toLowerCase();
  const ownerStatus = normalizeText(batch?.native_owner_status).toLowerCase();
  const testPurpose = normalizeText(batch?.test_purpose).toLowerCase();
  return batch?.is_test_batch === true ||
    batchId.includes('-test-') ||
    sourceSystem.includes('internal_validation') ||
    ownerStatus.includes('internal_test') ||
    testPurpose.includes('internal validation');
}

function safeId(value) {
  const normalized = normalizeText(value).replace(/\s+/g, ' ');
  return normalized && normalized.length <= 180 && /^[A-Za-z0-9._:@/#-]+$/.test(normalized) ? normalized : '';
}

function lower(value) {
  return normalizeText(value).replace(/\s+/g, ' ').toLowerCase();
}

function referenceList(value) {
  if (Array.isArray(value)) return value.map(safeId).filter(Boolean);
  return normalizeText(value).split(',').map(safeId).filter(Boolean);
}

function uniqueRows(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter(row => {
    const key = safeId(row?.id);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function preStartRecordMatchesBatch(record, batch) {
  const sourceId = safeId(batch?.id);
  const batchId = safeId(batch?.batch_id);
  const sourceRefs = new Set([
    safeId(record?.source_production_batch_id),
    ...referenceList(record?.related_source_production_batch_ids),
  ].filter(Boolean));
  const batchRefs = new Set([
    safeId(record?.batch_id),
    ...referenceList(record?.related_batch_ids),
    ...referenceList(record?.batches_logged),
  ].filter(Boolean));
  return Boolean((sourceId && sourceRefs.has(sourceId)) || (batchId && batchRefs.has(batchId)));
}

function preStartRecordReady(recordType, record) {
  if (recordType === 'sanitation') {
    return record?.cleaned === true && record?.sanitized === true && lower(record?.sanitizer_level) !== 'low';
  }
  if (recordType === 'daily_checklist') {
    return ['complete', 'pre-production complete'].includes(lower(record?.overall_status)) &&
      record?.morning_fridge_temp_logged === true &&
      record?.sanitizer_levels_checked === true &&
      record?.equipment_sanitized === true &&
      record?.work_areas_cleaned === true;
  }
  return record?.within_range === true && Number.isFinite(Number(record?.temperature));
}

function batchSetupReady(batch) {
  if (!batch) return false;
  const staff = safeStringArray(batch.staff_on_duty, 20);
  const equipment = safeStringArray(batch.equipment_used, 30);
  const recipe = normalizeText(batch.formula_or_recipe_used);
  const bottleSize = normalizeText(batch.bottle_size);
  const ingredients = safeIngredientUsageRows(batch.ingredients_used);
  const ingredientsComplete = ingredients.length > 0 && ingredients.every(row => (
    row.ingredient_name && Number.isFinite(row.quantity) && row.quantity > 0 && row.unit && row.lot_number
  ));
  return staff.length > 0 && equipment.length > 0 && Boolean(recipe) && Boolean(bottleSize) && ingredientsComplete;
}

function exactNamedRows(rows, field, value, { requireActive = false } = {}) {
  const expected = lower(value);
  return (Array.isArray(rows) ? rows : []).filter(row => (
    lower(row?.[field]) === expected && (!requireActive || row?.is_active !== false)
  ));
}

function canonicalProductKey(value) {
  const normalized = lower(value)
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

function canonicalNamedRows(rows, field, value, { requireActive = false } = {}) {
  const expected = canonicalProductKey(value);
  if (!expected) return [];
  return (Array.isArray(rows) ? rows : []).filter(row => (
    canonicalProductKey(row?.[field]) === expected && (!requireActive || row?.is_active !== false)
  ));
}

function roundedQuantity(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

async function resolveBatchDefaults(base44, batch) {
  const productName = normalizeText(batch?.product_name);
  if (!productName) {
    return {
      master_data_resolved: false,
      warnings: ['batch_product_name_missing'],
      pH_capture_step: 'verify',
      measured_pH_must_be_entered: true,
    };
  }

  const recipeEntity = base44.asServiceRole?.entities?.Recipe;
  const productEntity = base44.asServiceRole?.entities?.Product;
  const [recipeRows, productRows] = await Promise.all([
    recipeEntity?.filter
      ? recipeEntity.filter({ product_name: productName }, '-updated_date', 5).catch(() => [])
      : [],
    productEntity?.filter
      ? productEntity.filter({ title: productName }, '-updated_date', 5).catch(() => [])
      : [],
  ]);
  let recipeMatches = exactNamedRows(recipeRows, 'product_name', productName, { requireActive: true });
  let productMatches = exactNamedRows(productRows, 'title', productName);
  if (recipeMatches.length === 0 && recipeEntity?.list) {
    const allRecipes = await recipeEntity.list('-updated_date', 100).catch(() => []);
    recipeMatches = canonicalNamedRows(allRecipes, 'product_name', productName, { requireActive: true });
  }
  if (productMatches.length === 0 && productEntity?.list) {
    const allProducts = await productEntity.list('-updated_date', 100).catch(() => []);
    productMatches = canonicalNamedRows(allProducts, 'title', productName);
  }
  const recipe = recipeMatches.length === 1 ? recipeMatches[0] : null;
  const product = productMatches.length === 1 ? productMatches[0] : null;
  const warnings = [];
  if (recipeMatches.length > 1) warnings.push('multiple_active_recipe_matches');
  if (productMatches.length > 1) warnings.push('multiple_product_matches');

  const existingIngredients = safeIngredientUsageRows(batch?.ingredients_used);
  const plannedUnits = safeNumber(batch?.planned_units);
  const recipeIngredients = (Array.isArray(recipe?.ingredients) ? recipe.ingredients : []).slice(0, 40).map(row => {
    const ingredientName = normalizeText(row?.ingredient_name);
    const perBottleQuantity = safeNumber(row?.quantity_oz);
    if (!ingredientName || perBottleQuantity === null || perBottleQuantity <= 0) return null;
    return {
      ingredient_name: ingredientName,
      quantity: roundedQuantity(plannedUnits && plannedUnits > 0 ? perBottleQuantity * plannedUnits : perBottleQuantity),
      unit: normalizeText(row?.unit) || 'oz',
      lot_number: '',
    };
  }).filter(Boolean);
  const recipeBottleOunces = safeNumber(recipe?.bottle_size_oz);
  const existingBottleSize = normalizeText(batch?.bottle_size);
  const recipeBottleSize = recipeBottleOunces && recipeBottleOunces > 0 ? `${recipeBottleOunces} oz` : '';
  const productBottleSize = normalizeText(product?.size);
  const ingredientQuantityVariances = existingIngredients.length > 0 && recipeIngredients.length > 0
    ? recipeIngredients.map(planned => {
        const recorded = existingIngredients.find(row => lower(row?.ingredient_name) === lower(planned.ingredient_name));
        const recordedQuantity = safeNumber(recorded?.quantity);
        return recordedQuantity !== null && recordedQuantity !== planned.quantity
          ? {
              ingredient_name: planned.ingredient_name,
              recorded_quantity: recordedQuantity,
              planned_quantity: planned.quantity,
              unit: planned.unit,
            }
          : null;
      }).filter(Boolean)
    : [];
  if (ingredientQuantityVariances.length > 0) warnings.push('recorded_ingredient_quantity_differs_from_recipe_plan');

  return {
    master_data_resolved: Boolean(recipe || product),
    recipe_resolved: Boolean(recipe),
    product_resolved: Boolean(product),
    formula_or_recipe_used: normalizeText(batch?.formula_or_recipe_used) || normalizeText(recipe?.product_name),
    formula_source: normalizeText(batch?.formula_or_recipe_used) ? 'production_batch' : (recipe ? 'recipe' : null),
    bottle_size: existingBottleSize || recipeBottleSize || productBottleSize,
    bottle_size_source: existingBottleSize ? 'production_batch' : (recipeBottleSize ? 'recipe' : (productBottleSize ? 'product' : null)),
    ingredients_used: existingIngredients.length > 0 ? existingIngredients : recipeIngredients,
    recipe_planned_ingredients: recipeIngredients,
    ingredient_quantity_variances: ingredientQuantityVariances,
    ingredient_source: existingIngredients.length > 0 ? 'production_batch' : (recipeIngredients.length > 0 ? 'recipe_planned_usage' : null),
    ingredient_quantity_basis: recipeIngredients.length > 0 && existingIngredients.length === 0
      ? (plannedUnits && plannedUnits > 0 ? 'recipe_per_bottle_times_planned_units' : 'recipe_per_bottle')
      : null,
    warnings,
    pH_capture_step: 'verify',
    measured_pH_must_be_entered: true,
  };
}

async function resolvePreStartBatch(base44, body) {
  const entity = base44.asServiceRole?.entities?.ProductionBatch;
  const sourceId = safeId(body?.production_batch_id);
  const displayId = safeId(body?.batch_id);
  let batch = null;
  if (sourceId && entity?.get) batch = await entity.get(sourceId).catch(() => null);
  if (!batch && displayId && entity?.filter) {
    const rows = await entity.filter({ batch_id: displayId }, '-created_date', 2).catch(() => []);
    if (Array.isArray(rows) && rows.length === 1) batch = rows[0];
  }
  if (!batch && body?.is_test_batch === true) throw new Error('test_batch_must_resolve');
  const productionDate = normalizeText(batch?.production_date || body?.production_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(productionDate)) throw new Error('production_date_required');
  return {
    id: safeId(batch?.id) || sourceId,
    batch_id: safeId(batch?.batch_id) || displayId,
    production_date: productionDate,
    is_test_batch: isInternalTestBatch(batch),
    record: batch,
  };
}

async function loadPreStartRows(base44, recordType, batch) {
  const config = PRE_START_RECORD_TYPES[recordType];
  const entity = base44.asServiceRole?.entities?.[config.entity];
  if (!entity?.filter) throw new Error(`${config.entity}_unavailable`);
  const requests = [
    batch.id ? entity.filter({ source_production_batch_id: batch.id }, '-created_date', 20).catch(() => []) : [],
    batch.batch_id ? entity.filter({ batch_id: batch.batch_id }, '-created_date', 20).catch(() => []) : [],
    entity.filter({ [config.dateField]: batch.production_date }, '-created_date', 50).catch(() => []),
  ];
  return uniqueRows((await Promise.all(requests)).flat()).filter(row => (
    batch.is_test_batch ? row?.is_test_record === true : row?.is_test_record !== true
  ));
}

function preStartStatusItem(recordType, rows, batch) {
  const exact = rows.find(row => preStartRecordMatchesBatch(row, batch) && preStartRecordReady(recordType, row));
  const reusable = batch.is_test_batch
    ? null
    : rows.find(row => !preStartRecordMatchesBatch(row, batch) && preStartRecordReady(recordType, row));
  return {
    key: recordType,
    ready: Boolean(exact),
    match_scope: exact ? 'batch_linked' : null,
    record_id: safeId(exact?.id) || null,
    reusable_record_id: safeId(reusable?.id) || null,
    reusable_same_day_record: Boolean(reusable),
  };
}

async function preStartStatusResponse(base44, body) {
  const batch = await resolvePreStartBatch(base44, body);
  if (!batch.id && !batch.batch_id) {
    return Response.json({ success: false, error: 'production_batch_id_or_batch_id_required' }, { status: 400 });
  }
  const [entries, batchDefaults] = await Promise.all([
    Promise.all(Object.keys(PRE_START_RECORD_TYPES).map(async recordType => (
      [recordType, await loadPreStartRows(base44, recordType, batch)]
    ))),
    resolveBatchDefaults(base44, batch.record),
  ]);
  const rowsByType = Object.fromEntries(entries);
  const items = Object.keys(PRE_START_RECORD_TYPES).map(recordType => preStartStatusItem(recordType, rowsByType[recordType], batch));
  if (batch.record?.id) {
    const setupReady = batchSetupReady(batch.record);
    items.push({
      key: 'batch_setup',
      ready: setupReady,
      match_scope: setupReady ? 'production_batch' : null,
      record_id: setupReady ? safeId(batch.record.id) : null,
      reusable_record_id: null,
      reusable_same_day_record: false,
    });
  }
  const missing = items.filter(item => !item.ready).map(item => item.key);
  return Response.json({
    success: true,
    action: 'pre_start_status',
    read_only: true,
    ready: missing.length === 0,
    batch: {
      production_batch_id: batch.id || null,
      batch_id: batch.batch_id || null,
      production_date: batch.production_date,
      is_test_batch: batch.is_test_batch,
    },
    items,
    required_item_count: items.length,
    batch_defaults: batchDefaults,
    missing,
    writes_performed: false,
    provider_calls_performed: false,
    customer_notifications_sent: false,
  });
}

function sanitizeBatch(batch) {
  const isTestBatch = isInternalTestBatch(batch);
  return {
    id: batch.id || null,
    batch_id: batch.batch_id || null,
    production_date: batch.production_date || null,
    product_name: batch.product_name || null,
    product_category: batch.product_category || null,
    status: batch.status || null,
    planned_units: batch.planned_units ?? null,
    actual_units: batch.actual_units ?? null,
    is_test_batch: isTestBatch,
    test_purpose: isTestBatch ? normalizeText(batch.test_purpose) : null,
    is_locked: batch.is_locked === true,
    order_count: Number(batch.order_count) || 0,
    order_numbers: Array.isArray(batch.order_numbers)
      ? batch.order_numbers.map(value => value?.toString().trim()).filter(Boolean)
      : [],
    source_type_counts: sanitizeSourceTypeCounts(batch.source_type_counts),
    source: batch.source || 'hub',
    source_label: batch.source === 'customer_app_native' ? 'Native Customer App' : 'Hub',
    updated_date: batch.updated_date || null,
  };
}

function nativeSourceTypeCounts(orderSources) {
  const counts = {};
  for (const source of Array.isArray(orderSources) ? orderSources : []) {
    const key = normalizeText(source?.source_type) || 'native_order';
    counts[key] = (counts[key] || 0) + (Number(source?.quantity) || 1);
  }
  return counts;
}

function eventAllocationCount(orderSources) {
  return new Set((Array.isArray(orderSources) ? orderSources : [])
    .filter(source => normalizeText(source?.source_type).toLowerCase() === 'event_stock')
    .map(source => normalizeText(source?.order_id))
    .filter(Boolean)).size;
}

async function loadNativeProductionBatches(base44, dateFrom, dateTo, limit, testBatchMode = 'exclude') {
  try {
    const entity = base44.asServiceRole?.entities?.ProductionBatch;
    if (!entity || typeof entity.list !== 'function') {
      return { available: false, rows: [], error: 'production_batch_entity_unavailable' };
    }
    // Daily operations must prefer the newest native records. Ascending order can
    // hide current batches once the entity contains more than 500 rows.
    const rows = await entity.list('-production_date', 500);
    if (!Array.isArray(rows)) {
      return { available: false, rows: [], error: 'production_batch_entity_malformed' };
    }

    const filtered = rows
      .filter(batch => {
        const productionDate = normalizeText(batch.production_date);
        const operational = normalizeText(batch.status).toLowerCase() !== 'archived';
        const isTestBatch = isInternalTestBatch(batch);
        const modeMatches = testBatchMode === 'only' ? isTestBatch : !isTestBatch;
        return operational && modeMatches && productionDate && productionDate >= dateFrom && productionDate <= dateTo;
      })
      .map(batch => {
        const orderSources = Array.isArray(batch.order_sources) ? batch.order_sources : [];
        const safeBatch = sanitizeBatch({
          ...batch,
          order_count: orderSources.length,
          order_numbers: safeStringArray(orderSources.map(source => source?.order_number), 50),
          source_type_counts: nativeSourceTypeCounts(orderSources),
          event_allocation_count: eventAllocationCount(orderSources),
          source: 'customer_app_native',
        });

        return {
          ...safeBatch,
          actual_start_time: normalizeText(batch.actual_start_time),
          actual_end_time: normalizeText(batch.actual_end_time),
          started_by: normalizeText(batch.started_by),
          completed_by: normalizeText(batch.completed_by),
          verified_by: normalizeText(batch.verified_by),
          verified_at: normalizeText(batch.verified_at),
          compliance_log_id: normalizeText(batch.compliance_log_id),
          inventory_deduction_log_id: normalizeText(batch.inventory_deduction_log_id),
          source_system: normalizeText(batch.source_system),
          source_hub_batch_id: normalizeText(batch.source_hub_batch_id),
          native_owner_status: normalizeText(batch.native_owner_status),
          pH_result: safeNumber(batch.pH_result),
          pH_passed_failed: normalizeText(batch.pH_passed_failed),
          pH_meter_id: normalizeText(batch.pH_meter_id),
          calibration_checked: batch.calibration_checked === true,
          ccp_check_complete: batch.ccp_check_complete === true,
          sanitation_verification_complete: batch.sanitation_verification_complete === true,
          labels_applied: batch.labels_applied === true,
          passed_failed: normalizeText(batch.passed_failed),
          bottles_produced: safeNumber(batch.bottles_produced),
          bottles_rejected_or_wasted: safeNumber(batch.bottles_rejected_or_wasted),
          final_usable_quantity: safeNumber(batch.final_usable_quantity),
          storage_location: normalizeText(batch.storage_location),
          use_by_date: normalizeText(batch.use_by_date),
          staff_on_duty: safeStringArray(batch.staff_on_duty, 20),
          equipment_used: safeStringArray(batch.equipment_used, 30),
          formula_or_recipe_used: normalizeText(batch.formula_or_recipe_used),
          bottle_size: normalizeText(batch.bottle_size),
          ingredients_used: safeIngredientUsageRows(batch.ingredients_used),
          ingredient_lot_notes: normalizeText(batch.ingredient_lot_notes),
          shopify_pos_inventory_sync_status: normalizeText(batch.shopify_pos_inventory_sync_status),
          shopify_pos_inventory_sync_quantity: safeNumber(batch.shopify_pos_inventory_sync_quantity),
          shopify_pos_inventory_synced_at: normalizeText(batch.shopify_pos_inventory_synced_at),
          shopify_pos_location_id: normalizeText(batch.shopify_pos_location_id),
          shopify_pos_inventory_sync_error: normalizeText(batch.shopify_pos_inventory_sync_error),
          event_allocation_count: eventAllocationCount(orderSources),
        };
      });

    const sorted = (limit ? filtered.slice(0, limit) : filtered).sort((a, b) => {
      const dateCompare = (a.production_date || '').localeCompare(b.production_date || '');
      if (dateCompare !== 0) return dateCompare;
      return (a.product_name || '').localeCompare(b.product_name || '');
    });
    return { available: true, rows: sorted, error: null };
  } catch (error) {
    console.error('[getAdminProductionQueueSummary] Native batch overlay unavailable:', error.message);
    return { available: false, rows: [], error: 'production_batch_entity_read_failed' };
  }
}

function mergeHubAndNativeBatches(hubBatches, nativeBatches, limit, terminalOrderNumbers = new Set()) {
  const hubRows = Array.isArray(hubBatches)
    ? hubBatches.map(batch => sanitizeBatch({ ...batch, source: 'hub' }))
    : [];
  const nativeKeys = new Set(nativeBatches.map(sourceKey).filter(Boolean));
  const hubFallbackRows = hubRows.filter(batch => {
    const key = sourceKey(batch);
    return key && !nativeKeys.has(key) && !hubBatchSuppressedByTerminalOrders(batch, terminalOrderNumbers);
  });
  const merged = [...nativeBatches, ...hubFallbackRows].sort((a, b) => {
    const dateCompare = (a.production_date || '').localeCompare(b.production_date || '');
    if (dateCompare !== 0) return dateCompare;
    const sourceCompare = (a.source || '').localeCompare(b.source || '');
    if (sourceCompare !== 0) return sourceCompare;
    return (a.product_name || '').localeCompare(b.product_name || '');
  });
  return limit ? merged.slice(0, limit) : merged;
}

function nativeOnlyProductionQueueResponse({
  dateFrom,
  dateTo,
  nativeBatches,
  warnings,
  testBatchMode = 'exclude',
  nativeSourceAvailable = true,
  hubHistoricalContextRequested = false,
  hubHistoricalContextAvailable = false,
  hubHistoricalContextBatchCount = 0,
}) {
  return {
    success: true,
    date_from: dateFrom,
    date_to: dateTo,
    count: nativeBatches.length,
    truncated: false,
    batches: nativeBatches,
    data_sources: {
      hub_available: false,
      native_available: nativeSourceAvailable,
      native_read_only: false,
      native_batch_count: nativeBatches.length,
      native_authoritative_batch_count: nativeBatches.length,
      hub_batch_count: 0,
      hub_fallback_batch_count: 0,
      customer_app_native_authoritative: true,
      hub_operational_dependency: false,
      hub_historical_context_requested: hubHistoricalContextRequested,
      hub_historical_context_available: hubHistoricalContextAvailable,
      hub_historical_context_batch_count: hubHistoricalContextBatchCount,
      live_actions_source: testBatchMode === 'only' ? 'native_internal_test_only' : 'customer_app_native',
    },
    customer_app_native_authoritative: true,
    hub_operational_dependency: false,
    include_hub_historical_context: hubHistoricalContextRequested,
    hub_historical_context_batch_count: hubHistoricalContextBatchCount,
    test_batch_mode: testBatchMode,
    operational_totals_exclude_test_batches: true,
    warnings,
  };
}

export default async function handler(req: Request) {
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
    if (lower(body?.action) === 'pre_start_status') {
      try {
        return await preStartStatusResponse(base44, body);
      } catch (error) {
        const message = normalizeText(error?.message) || 'pre_start_status_unavailable';
        const status = ['production_date_required', 'test_batch_must_resolve'].includes(message) ? 400 : 500;
        return Response.json({ success: false, error: message }, { status });
      }
    }
    let dateFrom;
    let dateTo;
    let limit;
    let testBatchMode;
    const includeHubHistoricalContext = body.include_hub_historical_context === true;

    try {
      dateFrom = parseIsoDate(body.date_from, 'date_from');
      dateTo = parseIsoDate(body.date_to, 'date_to');
      limit = normalizeLimit(body.limit);
      testBatchMode = normalizeText(body.test_batch_mode || 'exclude').toLowerCase();
      if (!TEST_BATCH_MODES.has(testBatchMode)) {
        throw new Error('test_batch_mode must be exclude or only');
      }
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const today = todayChicagoDate();
    if (!dateFrom && !dateTo) {
      dateFrom = today;
      dateTo = addDays(today, DEFAULT_RANGE_DAYS_AHEAD);
    } else if (dateFrom && !dateTo) {
      dateTo = addDays(dateFrom, DEFAULT_RANGE_DAYS_AHEAD);
    } else if (!dateFrom && dateTo) {
      dateFrom = today;
    }

    if (dateTo < dateFrom) {
      return Response.json({ error: 'date_to must be on or after date_from' }, { status: 400 });
    }

    if (daysInclusive(dateFrom, dateTo) > MAX_RANGE_DAYS) {
      return Response.json({
        error: `Date range must be ${MAX_RANGE_DAYS} days or fewer`,
        max_range_days: MAX_RANGE_DAYS,
      }, { status: 400 });
    }

    const nativeRead = await loadNativeProductionBatches(base44, dateFrom, dateTo, limit, testBatchMode);
    const nativeBatches = nativeRead.rows;
    const nativeSourceAvailable = nativeRead.available === true;
    const warnings = [];
    if (nativeRead.error) warnings.push(nativeRead.error);
    if (!nativeSourceAvailable) {
      return Response.json({
        error: 'Unable to load Customer App production queue summary',
        warnings,
      }, { status: 503 });
    }
    if (testBatchMode === 'only') {
      warnings.push('internal_test_batches_only');
      return Response.json(nativeOnlyProductionQueueResponse({
        dateFrom,
        dateTo,
        nativeBatches,
        warnings,
        testBatchMode,
        nativeSourceAvailable,
      }));
    }

    if (!includeHubHistoricalContext) {
      return Response.json(nativeOnlyProductionQueueResponse({
        dateFrom,
        dateTo,
        nativeBatches,
        warnings,
        testBatchMode,
        nativeSourceAvailable,
      }));
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      warnings.push('hub_historical_production_context_not_configured');
      return Response.json(nativeOnlyProductionQueueResponse({
        dateFrom,
        dateTo,
        nativeBatches,
        warnings,
        testBatchMode,
        nativeSourceAvailable,
        hubHistoricalContextRequested: true,
      }));
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const params = new URLSearchParams({
      date_from: dateFrom,
      date_to: dateTo,
    });
    if (limit) params.set('limit', limit.toString());

    let hubResponse;
    try {
      hubResponse = await fetch(`${hubBase}/functions/getProductionQueueSummaryForCustomerApp?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
        },
      });
    } catch {
      warnings.push('hub_historical_production_context_unavailable:fetch_failed');
      return Response.json(nativeOnlyProductionQueueResponse({
        dateFrom,
        dateTo,
        nativeBatches,
        warnings,
        testBatchMode,
        nativeSourceAvailable,
        hubHistoricalContextRequested: true,
      }));
    }

    if (!hubResponse.ok) {
      warnings.push(`hub_historical_production_context_unavailable:${hubResponse.status}`);
      return Response.json(nativeOnlyProductionQueueResponse({
        dateFrom,
        dateTo,
        nativeBatches,
        warnings,
        testBatchMode,
        nativeSourceAvailable,
        hubHistoricalContextRequested: true,
      }));
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubData || hubData.success !== true || !Array.isArray(hubData.batches)) {
      warnings.push('hub_historical_production_context_malformed_response');
      return Response.json(nativeOnlyProductionQueueResponse({
        dateFrom,
        dateTo,
        nativeBatches,
        warnings,
        testBatchMode,
        nativeSourceAvailable,
        hubHistoricalContextRequested: true,
      }));
    }
    return Response.json(nativeOnlyProductionQueueResponse({
      dateFrom,
      dateTo,
      nativeBatches,
      warnings,
      testBatchMode,
      nativeSourceAvailable,
      hubHistoricalContextRequested: true,
      hubHistoricalContextAvailable: true,
      hubHistoricalContextBatchCount: hubData.batches.length,
    }));
  } catch (error) {
    console.error('[getAdminProductionQueueSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load production queue summary' }, { status: 500 });
  }
}
