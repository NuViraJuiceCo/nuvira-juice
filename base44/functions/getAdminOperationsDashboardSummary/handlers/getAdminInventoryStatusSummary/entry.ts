// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;
const VALID_STATUSES = new Set(['ok', 'low', 'critical', 'out_of_stock', 'demand_based']);
const FOOD_STOCK_EXCLUDED_CATEGORIES = new Set(['produce', 'juice base', 'spices & herbs']);
const FOOD_STOCK_EXCLUDED_ITEMS = new Set(['honey']);
const INVENTORY_MIGRATION_OPERATIONS = new Set(['preview_non_food_import', 'execute_non_food_import']);
const INVENTORY_ITEM_OPERATIONS = new Set(['update_native_item']);
const INVENTORY_UNITS = new Set(['lbs', 'g', 'L', 'mL', 'units', 'cases', 'bottles']);
const INVENTORY_CATEGORIES = new Set(['Produce', 'Juice Base', 'Spices & Herbs', 'Packaging', 'Supplies', 'Other']);
const SUPPLIER_PACKAGING_UNITS = new Set(['case', 'bunch', 'lb', 'kg', 'count', 'box', 'bag', 'other']);

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

function normalizeLimit(value) {
  const text = normalizeText(value);
  if (!text) return DEFAULT_LIMIT;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('limit must be a positive integer');
  }
  return Math.min(parsed, MAX_LIMIT);
}

function normalizeStatus(value) {
  const status = normalizeText(value).toLowerCase();
  if (!status) return '';
  if (!VALID_STATUSES.has(status)) {
    throw new Error('status must be one of ok, low, critical, out_of_stock, demand_based');
  }
  return status;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requiredNonNegativeNumber(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${fieldName} must be 0 or greater`);
  return parsed;
}

function optionalNonNegativeNumber(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return requiredNonNegativeNumber(value, fieldName);
}

function enumValue(value, fieldName, allowed) {
  const text = normalizeText(value);
  if (!allowed.has(text)) throw new Error(`${fieldName} is invalid`);
  return text;
}

function optionalText(value, maxLength) {
  const text = normalizeText(value).replace(/\s+/g, ' ');
  if (!text) return null;
  if (text.length > maxLength) throw new Error(`Text must be ${maxLength} characters or fewer`);
  return text;
}

function sanitizeSummary(summary) {
  return {
    total_items: Number(summary?.total_items) || 0,
    stock_tracked_item_count: Number(summary?.stock_tracked_item_count) || 0,
    demand_based_food_count: Number(summary?.demand_based_food_count) || 0,
    food_stock_warnings_suppressed_count: Number(summary?.food_stock_warnings_suppressed_count) || 0,
    low_stock_count: Number(summary?.low_stock_count) || 0,
    critical_count: Number(summary?.critical_count) || 0,
    out_of_stock_count: Number(summary?.out_of_stock_count) || 0,
    category_count: Number(summary?.category_count) || 0,
    procurement_item_count: Number(summary?.procurement_item_count) || 0,
    procurement_supplier_count: Number(summary?.procurement_supplier_count) || 0,
    open_purchase_order_count: Number(summary?.open_purchase_order_count) || 0,
    net_procurement_item_count: Number(summary?.net_procurement_item_count) || 0,
  };
}

function mergeSummary(a, b) {
  return sanitizeSummary({
    total_items: Number(a?.total_items || 0) + Number(b?.total_items || 0),
    stock_tracked_item_count: Number(a?.stock_tracked_item_count || 0) + Number(b?.stock_tracked_item_count || 0),
    demand_based_food_count: Number(a?.demand_based_food_count || 0) + Number(b?.demand_based_food_count || 0),
    food_stock_warnings_suppressed_count: Number(a?.food_stock_warnings_suppressed_count || 0) + Number(b?.food_stock_warnings_suppressed_count || 0),
    low_stock_count: Number(a?.low_stock_count || 0) + Number(b?.low_stock_count || 0),
    critical_count: Number(a?.critical_count || 0) + Number(b?.critical_count || 0),
    out_of_stock_count: Number(a?.out_of_stock_count || 0) + Number(b?.out_of_stock_count || 0),
    category_count: Math.max(Number(a?.category_count || 0), Number(b?.category_count || 0)),
    procurement_item_count: Number(a?.procurement_item_count || 0) + Number(b?.procurement_item_count || 0),
    procurement_supplier_count: Math.max(Number(a?.procurement_supplier_count || 0), Number(b?.procurement_supplier_count || 0)),
    open_purchase_order_count: Number(a?.open_purchase_order_count || 0) + Number(b?.open_purchase_order_count || 0),
    net_procurement_item_count: Number(a?.net_procurement_item_count || 0) + Number(b?.net_procurement_item_count || 0),
  });
}

function isFoodInventoryItem(item) {
  return FOOD_STOCK_EXCLUDED_CATEGORIES.has(normalizeLower(item?.category))
    || FOOD_STOCK_EXCLUDED_ITEMS.has(normalizeMatchKey(item?.ingredient));
}

function rawThresholdStatus(item) {
  const stock = Number(item.stock);
  const reorderPoint = Number(item.reorder_point);
  if (!Number.isFinite(stock)) return null;
  if (stock <= 0) return 'out_of_stock';
  if (Number.isFinite(reorderPoint) && reorderPoint > 0 && stock <= reorderPoint * 0.5) return 'critical';
  if (Number.isFinite(reorderPoint) && reorderPoint > 0 && stock <= reorderPoint) return 'low';
  return 'ok';
}

function deriveInventoryStatus(item) {
  if (isFoodInventoryItem(item)) return 'demand_based';
  return rawThresholdStatus(item);
}

function stockTrackingPolicy(item) {
  return isFoodInventoryItem(item) ? 'food_make_to_order' : 'stock_tracked';
}

function stockWarningSuppressed(item) {
  if (!isFoodInventoryItem(item)) return false;
  return ['low', 'critical', 'out_of_stock'].includes(rawThresholdStatus(item));
}

function sanitizeItem(item) {
  const policy = stockTrackingPolicy(item);
  const rawStatus = normalizeText(item.status).toLowerCase();
  const status = policy === 'food_make_to_order'
    ? 'demand_based'
    : VALID_STATUSES.has(rawStatus)
      ? rawStatus
      : null;
  return {
    id: item.id || null,
    ingredient: item.ingredient || null,
    category: item.category || null,
    unit: item.unit || null,
    stock: numberOrNull(item.stock),
    reorder_point: numberOrNull(item.reorder_point),
    max_stock: numberOrNull(item.max_stock),
    cost_per_unit: numberOrNull(item.cost_per_unit),
    cost_per_supplier_unit: numberOrNull(item.cost_per_supplier_unit),
    supplier_packaging_unit: item.supplier_packaging_unit || null,
    supplier_packaging_qty: item.supplier_packaging_qty || null,
    supplier: item.supplier || null,
    location: item.location || null,
    status,
    stock_tracking_policy: policy,
    stock_authoritative: policy === 'stock_tracked',
    stock_warning_suppressed: stockWarningSuppressed(item),
    updated_date: item.updated_date || null,
    source: item.source || null,
  };
}

function sanitizeStringArray(values, max = 20) {
  if (!Array.isArray(values)) return [];
  return values
    .map(value => normalizeText(value))
    .filter(Boolean)
    .slice(0, max);
}

function sanitizeProcurementPlanItem(item) {
  const policy = stockTrackingPolicy(item);
  const rawStatus = normalizeText(item.status).toLowerCase();
  return {
    inventory_item_id: item.inventory_item_id || null,
    ingredient: item.ingredient || null,
    category: item.category || null,
    supplier: item.supplier || null,
    status: policy === 'food_make_to_order'
      ? 'demand_based'
      : VALID_STATUSES.has(rawStatus)
        ? rawStatus
        : null,
    stock: numberOrNull(item.stock),
    reorder_point: numberOrNull(item.reorder_point),
    max_stock: numberOrNull(item.max_stock),
    unit: item.unit || null,
    supplier_packaging_unit: item.supplier_packaging_unit || null,
    supplier_packaging_qty: item.supplier_packaging_qty || null,
    suggested_quantity: numberOrNull(item.suggested_quantity),
    open_po_quantity: numberOrNull(item.open_po_quantity),
    open_po_numbers: sanitizeStringArray(item.open_po_numbers, 10),
    net_suggested_quantity: numberOrNull(item.net_suggested_quantity),
    estimated_cost: numberOrNull(item.estimated_cost),
    stock_tracking_policy: policy,
    stock_authoritative: policy === 'stock_tracked',
    stock_warning_suppressed: stockWarningSuppressed(item),
    source: item.source || null,
  };
}

function summaryFromItems(items, procurementPlan, openPurchaseOrders) {
  const safeItems = Array.isArray(items) ? items : [];
  const safePlan = Array.isArray(procurementPlan) ? procurementPlan : [];
  const safePurchaseOrders = Array.isArray(openPurchaseOrders) ? openPurchaseOrders : [];
  return sanitizeSummary({
    total_items: safeItems.length,
    stock_tracked_item_count: safeItems.filter(item => item.stock_tracking_policy === 'stock_tracked').length,
    demand_based_food_count: safeItems.filter(item => item.stock_tracking_policy === 'food_make_to_order').length,
    food_stock_warnings_suppressed_count: safeItems.filter(item => item.stock_warning_suppressed === true).length,
    low_stock_count: safeItems.filter(item => item.stock_tracking_policy === 'stock_tracked' && item.status === 'low').length,
    critical_count: safeItems.filter(item => item.stock_tracking_policy === 'stock_tracked' && item.status === 'critical').length,
    out_of_stock_count: safeItems.filter(item => item.stock_tracking_policy === 'stock_tracked' && item.status === 'out_of_stock').length,
    category_count: new Set(safeItems.map(item => item.category).filter(Boolean)).size,
    procurement_item_count: safePlan.length,
    procurement_supplier_count: new Set(safePlan.map(item => item.supplier).filter(Boolean)).size,
    open_purchase_order_count: safePurchaseOrders.length,
    net_procurement_item_count: safePlan.filter(item => Number(item.net_suggested_quantity || 0) > 0).length,
  });
}

function sanitizePurchaseOrder(po) {
  const items = Array.isArray(po.items)
    ? po.items.slice(0, 25).map(item => ({
      ingredient: item?.ingredient || null,
      quantity: numberOrNull(item?.quantity),
      unit: item?.unit || null,
      unit_cost: numberOrNull(item?.unit_cost),
    })).filter(item => item.ingredient)
    : [];

  return {
    id: po.id || null,
    po_number: po.po_number || null,
    supplier: po.supplier || null,
    status: po.status || null,
    item_count: numberOrNull(po.item_count) || items.length,
    items,
    total_amount: numberOrNull(po.total_amount),
    order_date: po.order_date || null,
    expected_date: po.expected_date || null,
    updated_date: po.updated_date || null,
    source: po.source || null,
  };
}

function poItemKey(value) {
  return normalizeMatchKey(value);
}

async function loadNativeInventorySummary(base44, { status, category, search, limit }) {
  let nativeItems;
  let nativePurchaseOrders;
  try {
    [nativeItems, nativePurchaseOrders] = await Promise.all([
      base44.asServiceRole.entities.InventoryItem.list('ingredient', 500),
      base44.asServiceRole.entities.PurchaseOrder.list('-order_date', 200),
    ]);
  } catch {
    return {
      summary: summaryFromItems([], [], []),
      items: [],
      procurement_plan: [],
      open_purchase_orders: [],
      source_available: false,
      all_item_keys: [],
    };
  }
  nativeItems = Array.isArray(nativeItems) ? nativeItems : [];
  nativePurchaseOrders = Array.isArray(nativePurchaseOrders) ? nativePurchaseOrders : [];
  const openPoStatuses = new Set(['draft', 'ordered', 'in transit']);
  const openPoByIngredient = new Map();

  for (const po of nativePurchaseOrders) {
    if (!openPoStatuses.has(normalizeLower(po.status))) continue;
    for (const item of Array.isArray(po.items) ? po.items : []) {
      const key = poItemKey(item?.ingredient);
      if (!key) continue;
      const current = openPoByIngredient.get(key) || { quantity: 0, poNumbers: [] };
      current.quantity += Number(item?.quantity) || 0;
      if (po.po_number) current.poNumbers.push(po.po_number);
      openPoByIngredient.set(key, current);
    }
  }

  let items = nativeItems.map(item => {
    const derivedStatus = deriveInventoryStatus(item);
    return sanitizeItem({
      ...item,
      status: derivedStatus,
      source: 'customer_app_native',
    });
  });

  if (category) {
    items = items.filter(item => normalizeLower(item.category) === normalizeLower(category));
  }
  if (status) {
    items = items.filter(item => normalizeLower(item.status) === status);
  }
  if (search) {
    const searchKey = normalizeLower(search);
    items = items.filter(item => [
      item.ingredient,
      item.category,
      item.supplier,
      item.location,
    ].some(value => normalizeLower(value).includes(searchKey)));
  }

  const procurementPlan = items
    .filter(item => item.stock_tracking_policy === 'stock_tracked' && item.status && item.status !== 'ok')
    .map(item => {
      const key = poItemKey(item.ingredient);
      const poCoverage = openPoByIngredient.get(key) || { quantity: 0, poNumbers: [] };
      const stock = Number(item.stock) || 0;
      const target = Number(item.max_stock ?? item.reorder_point ?? 0) || 0;
      const suggestedQuantity = Math.max(0, target - stock);
      const netSuggestedQuantity = Math.max(0, suggestedQuantity - poCoverage.quantity);
      return sanitizeProcurementPlanItem({
        inventory_item_id: item.id,
        ingredient: item.ingredient,
        category: item.category,
        supplier: item.supplier,
        status: item.status,
        stock: item.stock,
        reorder_point: item.reorder_point,
        max_stock: item.max_stock,
        unit: item.unit,
        supplier_packaging_unit: item.supplier_packaging_unit,
        supplier_packaging_qty: item.supplier_packaging_qty,
        suggested_quantity: suggestedQuantity,
        open_po_quantity: poCoverage.quantity,
        open_po_numbers: poCoverage.poNumbers,
        net_suggested_quantity: netSuggestedQuantity,
        estimated_cost: item.cost_per_unit === null || item.cost_per_unit === undefined ? null : netSuggestedQuantity * Number(item.cost_per_unit),
        source: 'customer_app_native',
      });
    });

  const openPurchaseOrders = nativePurchaseOrders
    .filter(po => openPoStatuses.has(normalizeLower(po.status)))
    .slice(0, 50)
    .map(po => sanitizePurchaseOrder({ ...po, source: 'customer_app_native' }));

  const summary = summaryFromItems(items, procurementPlan, openPurchaseOrders);

  return {
    summary,
    items: items.slice(0, limit),
    procurement_plan: procurementPlan.slice(0, 100),
    open_purchase_orders: openPurchaseOrders,
    source_available: true,
    all_item_keys: nativeItems.map(item => normalizeMatchKey(item?.ingredient)).filter(Boolean),
  };
}

function migrationCandidatePayload(item) {
  return {
    ingredient: item.ingredient,
    unit: item.unit,
    stock: Number(item.stock) || 0,
    reorder_point: Number(item.reorder_point) || 0,
    max_stock: item.max_stock === null || item.max_stock === undefined ? null : Number(item.max_stock),
    cost_per_unit: item.cost_per_unit === null || item.cost_per_unit === undefined ? null : Number(item.cost_per_unit),
    supplier: item.supplier || null,
    supplier_packaging_unit: item.supplier_packaging_unit || null,
    supplier_packaging_qty: item.supplier_packaging_qty || null,
    cost_per_supplier_unit: item.cost_per_supplier_unit === null || item.cost_per_supplier_unit === undefined ? null : Number(item.cost_per_supplier_unit),
    location: item.location || null,
    category: item.category,
    notes: 'Imported from Operations Hub during Customer App inventory cutover.',
  };
}

function buildNonFoodMigrationPlan(hubItems, nativeKeys) {
  const candidates = [];
  const blockers = [];
  for (const item of hubItems) {
    if (item.stock_tracking_policy !== 'stock_tracked') continue;
    const key = normalizeMatchKey(item.ingredient);
    if (!key || nativeKeys.has(key)) continue;
    const payload = migrationCandidatePayload(item);
    const missing = ['ingredient', 'unit', 'category'].filter(field => !payload[field]);
    if (missing.length > 0) {
      blockers.push({ ingredient: item.ingredient || 'Unnamed item', reason: `missing_${missing.join('_')}` });
      continue;
    }
    candidates.push({ key, source_id: item.id || null, payload });
  }
  return { candidates, blockers };
}

function inventoryItemUpdatePayload(body, current) {
  const item = body?.item && typeof body.item === 'object' && !Array.isArray(body.item) ? body.item : {};
  const payload = {
    ingredient: optionalText(item.ingredient, 160),
    unit: enumValue(item.unit, 'item.unit', INVENTORY_UNITS),
    stock: requiredNonNegativeNumber(item.stock, 'item.stock'),
    reorder_point: requiredNonNegativeNumber(item.reorder_point, 'item.reorder_point'),
    max_stock: optionalNonNegativeNumber(item.max_stock, 'item.max_stock'),
    cost_per_unit: optionalNonNegativeNumber(item.cost_per_unit, 'item.cost_per_unit'),
    supplier: optionalText(item.supplier, 160),
    supplier_packaging_unit: item.supplier_packaging_unit
      ? enumValue(item.supplier_packaging_unit, 'item.supplier_packaging_unit', SUPPLIER_PACKAGING_UNITS)
      : null,
    supplier_packaging_qty: optionalText(item.supplier_packaging_qty, 120),
    cost_per_supplier_unit: optionalNonNegativeNumber(item.cost_per_supplier_unit, 'item.cost_per_supplier_unit'),
    location: optionalText(item.location, 160),
    category: enumValue(item.category, 'item.category', INVENTORY_CATEGORIES),
  };
  if (!payload.ingredient) throw new Error('item.ingredient is required');
  if (isFoodInventoryItem(payload)) {
    throw new Error('Food and juice ingredients are demand-based and cannot be stock-tracked here');
  }
  if (normalizeMatchKey(payload.ingredient) !== normalizeMatchKey(current?.ingredient)) {
    throw new Error('item.ingredient cannot be renamed during a stock update');
  }
  if (payload.max_stock !== null && payload.max_stock < payload.reorder_point) {
    throw new Error('item.max_stock must be at least item.reorder_point');
  }
  return payload;
}

async function handleInventoryItemMutation({ base44, user, body }) {
  const operation = normalizeLower(body.operation);
  if (!INVENTORY_ITEM_OPERATIONS.has(operation)) return null;

  const itemId = normalizeText(body.item_id);
  const requestId = normalizeText(body.request_id);
  const expectedUpdatedDate = normalizeText(body.expected_updated_date);
  if (!itemId) return Response.json({ error: 'item_id is required' }, { status: 400 });
  if (!requestId) return Response.json({ error: 'request_id is required' }, { status: 400 });
  if (body.confirm !== true) return Response.json({ error: 'confirm must be true' }, { status: 400 });

  const idempotencyKey = `native_inventory_item_update:${requestId}`;
  const existingCommands = await base44.asServiceRole.entities.CommandLog.filter(
    { idempotency_key: idempotencyKey }, '-created_date', 1,
  ).catch(() => []);
  if (existingCommands.length > 0) {
    const prior = existingCommands[0];
    if (prior.status !== 'success') {
      return Response.json({ error: 'A prior attempt requires review before retrying' }, { status: 409 });
    }
    return Response.json({
      success: true,
      operation,
      skipped: true,
      reason: 'duplicate_request_id',
      item_id: prior.target_id || itemId,
      source: 'customer_app_native',
    });
  }

  const existingItems = await base44.asServiceRole.entities.InventoryItem.filter({ id: itemId }, '-updated_date', 1).catch(() => []);
  const current = existingItems[0] || null;
  if (!current) return Response.json({ error: 'Inventory item not found' }, { status: 404 });
  if (isFoodInventoryItem(current)) {
    return Response.json({ error: 'Food and juice ingredients are managed from production demand' }, { status: 409 });
  }
  const currentUpdatedDate = normalizeText(current.updated_date);
  if (currentUpdatedDate && expectedUpdatedDate !== currentUpdatedDate) {
    return Response.json({ error: 'Inventory item changed; refresh before saving' }, { status: 409 });
  }

  let payload;
  try {
    payload = inventoryItemUpdatePayload(body, current);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  const now = new Date().toISOString();
  const command = await base44.asServiceRole.entities.CommandLog.create({
    command_id: requestId,
    command_type: 'native_inventory_item_update',
    command_source: 'customer_app_admin',
    status: 'pending',
    target_entity: 'InventoryItem',
    target_id: itemId,
    target_display_id: current.ingredient,
    actor_email: user.email,
    actor_role: user.role,
    actor_type: 'authenticated_admin',
    payload: { operation, expected_updated_date: expectedUpdatedDate || null },
    result: { saved: false },
    idempotency_key: idempotencyKey,
    idempotent_skipped: false,
    request_id: requestId,
    submitted_at: now,
    started_at: now,
    function_name: 'getAdminInventoryStatusSummary',
  });

  try {
    const saved = await base44.asServiceRole.entities.InventoryItem.update(itemId, payload);
    await base44.asServiceRole.entities.CommandLog.update(command.id, {
      status: 'success',
      completed_at: new Date().toISOString(),
      result: { saved: true, source: 'customer_app_native' },
    });
    return Response.json({
      success: true,
      operation,
      skipped: false,
      item: sanitizeItem({ ...current, ...saved, source: 'customer_app_native', status: deriveInventoryStatus({ ...current, ...saved }) }),
      source: 'customer_app_native',
      inventory_mutation: true,
      provider_calls: false,
      customer_notifications: false,
      hub_mutation: false,
    });
  } catch {
    await base44.asServiceRole.entities.CommandLog.update(command.id, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_code: 'inventory_item_update_failed',
      error_message: 'Inventory item update failed',
      result: { saved: false },
    }).catch(() => null);
    return Response.json({ error: 'Unable to update inventory item' }, { status: 500 });
  }
}

async function handleInventoryMigration({ base44, user, body, hubItems, nativeKeys, hubAvailable }) {
  const operation = normalizeLower(body.operation);
  if (!INVENTORY_MIGRATION_OPERATIONS.has(operation)) return null;
  if (!hubAvailable) {
    return Response.json({ error: 'Read-only Hub inventory source is unavailable for migration verification' }, { status: 503 });
  }
  const plan = buildNonFoodMigrationPlan(hubItems, nativeKeys);

  if (operation === 'preview_non_food_import') {
    return Response.json({
      success: true,
      operation,
      dry_run: true,
      read_only: true,
      candidate_count: plan.candidates.length,
      blocker_count: plan.blockers.length,
      candidates: plan.candidates.map(candidate => ({
        ingredient: candidate.payload.ingredient,
        category: candidate.payload.category,
        unit: candidate.payload.unit,
        stock: candidate.payload.stock,
        reorder_point: candidate.payload.reorder_point,
      })),
      blockers: plan.blockers,
      writes_performed: false,
      inventory_mutation: false,
      provider_calls: false,
      customer_notifications: false,
      hub_mutation: false,
    });
  }

  const requestId = normalizeText(body.request_id);
  const expectedCount = Number(body.expected_count);
  if (!requestId) return Response.json({ error: 'request_id is required' }, { status: 400 });
  if (body.confirm !== true) return Response.json({ error: 'confirm must be true' }, { status: 400 });

  const idempotencyKey = `native_non_food_inventory_import:${requestId}`;
  const existingCommands = await base44.asServiceRole.entities.CommandLog.filter(
    { idempotency_key: idempotencyKey }, '-created_date', 1,
  ).catch(() => []);
  if (existingCommands.length > 0) {
    const prior = existingCommands[0];
    if (prior.status !== 'success') {
      return Response.json({
        error: 'A prior inventory import attempt requires review before retrying',
        prior_status: prior.status || 'unknown',
      }, { status: 409 });
    }
    return Response.json({
      success: true,
      operation,
      skipped: true,
      reason: 'duplicate_request_id',
      imported_count: Number(prior?.result?.imported_count || 0),
      source: 'customer_app_native',
    });
  }

  if (!Number.isInteger(expectedCount) || expectedCount !== plan.candidates.length) {
    return Response.json({
      error: 'Inventory migration candidate count changed; run preview again',
      expected_count: Number.isInteger(expectedCount) ? expectedCount : null,
      current_count: plan.candidates.length,
    }, { status: 409 });
  }
  if (plan.blockers.length > 0) {
    return Response.json({ error: 'Inventory migration has blocked records', blockers: plan.blockers }, { status: 409 });
  }

  const now = new Date().toISOString();
  const command = await base44.asServiceRole.entities.CommandLog.create({
    command_id: requestId,
    command_type: 'native_non_food_inventory_import',
    command_source: 'customer_app_admin',
    status: 'pending',
    target_entity: 'InventoryItem',
    target_id: 'non_food_inventory_cutover',
    target_display_id: 'Non-food inventory cutover',
    actor_email: user.email,
    actor_role: user.role,
    actor_type: 'authenticated_admin',
    payload: { expected_count: expectedCount, candidate_names: plan.candidates.map(item => item.payload.ingredient) },
    result: { imported_count: 0 },
    idempotency_key: idempotencyKey,
    idempotent_skipped: false,
    request_id: requestId,
    submitted_at: now,
    started_at: now,
    function_name: 'getAdminInventoryStatusSummary',
  });

  const created = [];
  try {
    for (const candidate of plan.candidates) {
      const record = await base44.asServiceRole.entities.InventoryItem.create(candidate.payload);
      created.push({ id: record?.id || null, ingredient: candidate.payload.ingredient });
    }
  } catch {
    await base44.asServiceRole.entities.CommandLog.update(command.id, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_code: 'inventory_import_partial_failure',
      error_message: 'Inventory import stopped before all records were created',
      result: { imported_count: created.length, imported_item_names: created.map(item => item.ingredient) },
    }).catch(() => null);
    return Response.json({
      error: 'Inventory import stopped before all records were created; review Customer App inventory before retrying',
      imported_count: created.length,
    }, { status: 500 });
  }

  await base44.asServiceRole.entities.CommandLog.update(command.id, {
    status: 'success',
    result: { imported_count: created.length, imported_item_names: created.map(item => item.ingredient) },
    completed_at: new Date().toISOString(),
  });

  return Response.json({
    success: true,
    operation,
    skipped: false,
    imported_count: created.length,
    imported_items: created,
    source: 'customer_app_native',
    inventory_mutation: created.length > 0,
    provider_calls: false,
    customer_notifications: false,
    hub_mutation: false,
  });
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
    let status;
    let limit;

    try {
      status = normalizeStatus(body.status);
      limit = normalizeLimit(body.limit);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const category = normalizeText(body.category);
    const search = normalizeText(body.search);
    const itemMutationResponse = await handleInventoryItemMutation({ base44, user, body });
    if (itemMutationResponse) return itemMutationResponse;
    const nativeData = await loadNativeInventorySummary(base44, { status, category, search, limit });
    const inventoryMigrationRequested = INVENTORY_MIGRATION_OPERATIONS.has(normalizeLower(body.operation));

    if (!inventoryMigrationRequested) {
      if (!nativeData.source_available) {
        return Response.json({ error: 'Unable to load Customer App inventory records' }, { status: 503 });
      }
      const nativeItems = nativeData.items.filter(item => item.stock_tracking_policy === 'stock_tracked');
      const nativeProcurementPlan = nativeData.procurement_plan
        .filter(item => item.stock_tracking_policy === 'stock_tracked' && item.status && item.status !== 'ok' && item.status !== 'demand_based');
      return Response.json({
        success: true,
        source: 'customer_app_native_inventory_authoritative',
        summary: summaryFromItems(nativeItems, nativeProcurementPlan, nativeData.open_purchase_orders),
        count: nativeItems.length,
        truncated: false,
        items: nativeItems,
        procurement_plan: nativeProcurementPlan,
        open_purchase_orders: nativeData.open_purchase_orders,
        data_sources: {
          hub_available: false,
          native_available: true,
          native_read_only: false,
          native_authoritative: true,
          hub_operational_dependency: false,
          hub_transition_read_only: true,
          historical_inventory_cutover_review_available: nativeData.all_item_keys.length === 0,
          non_food_import_candidate_count: null,
          food_inventory_policy: 'food_and_juice_make_to_order',
          food_inventory_rows_hidden: true,
          food_stock_warnings_suppressed: true,
          non_food_inventory_counts_enabled: true,
          inventory_deduction_enabled: false,
          purchase_order_automation_enabled: false,
        },
        warnings: [],
        writes_performed: false,
        provider_calls_performed: false,
        customer_notifications_sent: false,
        hub_mutation_performed: false,
      });
    }

    let hubData = null;
    let hubWarning = null;
    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      hubWarning = 'hub_inventory_status_service_not_configured';
    } else {
      const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
      const params = new URLSearchParams({
        limit: limit.toString(),
      });
      if (category) params.set('category', category);
      if (search) params.set('search', search);

      let hubResponse;
      try {
        hubResponse = await fetch(`${hubBase}/functions/getInventoryStatusSummaryForCustomerApp?${params.toString()}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
          },
        });
      } catch {
        hubWarning = 'hub_inventory_status_fetch_failed';
      }

      if (!hubResponse) {
        // Native inventory/procurement data remains usable when Hub is temporarily unreachable.
      } else if (!hubResponse.ok) {
        hubWarning = `hub_inventory_status_unavailable:${hubResponse.status}`;
      } else {
        const parsedHubData = await hubResponse.json().catch(() => null);
        if (!parsedHubData || parsedHubData.success !== true || !Array.isArray(parsedHubData.items)) {
          hubWarning = 'hub_inventory_status_malformed_response';
        } else {
          hubData = parsedHubData;
        }
      }
    }

    let hubItemsForDedupe = hubData ? hubData.items.map(item => sanitizeItem({ ...item, source: 'hub' })) : [];
    if (category) {
      hubItemsForDedupe = hubItemsForDedupe.filter(item => normalizeLower(item.category) === normalizeLower(category));
    }
    if (search) {
      const searchKey = normalizeLower(search);
      hubItemsForDedupe = hubItemsForDedupe.filter(item => [
        item.ingredient,
        item.category,
        item.supplier,
        item.location,
      ].some(value => normalizeLower(value).includes(searchKey)));
    }
    const nativeItemKeys = new Set(nativeData.all_item_keys || []);
    const migrationResponse = await handleInventoryMigration({
      base44,
      user,
      body,
      hubItems: hubItemsForDedupe,
      nativeKeys: nativeItemKeys,
      hubAvailable: Boolean(hubData),
    });
    if (migrationResponse) return migrationResponse;

    const hubItemKeys = new Set(hubItemsForDedupe.map(item => normalizeMatchKey(item.ingredient)).filter(Boolean));
    const hubTrackedForDedupe = hubItemsForDedupe.filter(item => item.stock_tracking_policy === 'stock_tracked');
    const missingNativeTrackedItems = hubTrackedForDedupe.filter(item => !nativeItemKeys.has(normalizeMatchKey(item.ingredient)));
    const nativeCutoverReady = Boolean(hubData) && missingNativeTrackedItems.length === 0;
    const hubItems = (status
      ? hubTrackedForDedupe.filter(item => normalizeLower(item.status) === status)
      : hubTrackedForDedupe);
    const nativeTrackedItems = nativeData.items.filter(item => item.stock_tracking_policy === 'stock_tracked');
    const nativeOnlyItems = nativeTrackedItems.filter(item => !hubItemKeys.has(normalizeMatchKey(item.ingredient)));
    const allSanitizedItems = nativeCutoverReady
      ? nativeTrackedItems
      : [...hubItems, ...nativeOnlyItems];
    const sanitizedItems = allSanitizedItems.slice(0, limit);
    const hubProcurementPlan = hubData && Array.isArray(hubData.procurement_plan)
      ? hubData.procurement_plan.slice(0, 100).map(item => sanitizeProcurementPlanItem({ ...item, source: 'hub' })).filter(Boolean)
      : [];
    const procurementPlan = (nativeCutoverReady
      ? nativeData.procurement_plan
      : [
        ...hubProcurementPlan,
        ...nativeData.procurement_plan.filter(item => !hubItemKeys.has(normalizeMatchKey(item.ingredient))),
      ])
      .filter(item => item.stock_tracking_policy === 'stock_tracked' && item.status && item.status !== 'ok' && item.status !== 'demand_based')
      .slice(0, 100);
    const allOpenPurchaseOrders = nativeCutoverReady
      ? nativeData.open_purchase_orders
      : [
        ...(hubData && Array.isArray(hubData.open_purchase_orders)
          ? hubData.open_purchase_orders.slice(0, 50).map(po => sanitizePurchaseOrder({ ...po, source: 'hub' })).filter(Boolean)
          : []),
        ...nativeData.open_purchase_orders,
      ];
    const openPurchaseOrders = allOpenPurchaseOrders.slice(0, 50);
    const truncated = hubData?.truncated === true || sanitizedItems.length < allSanitizedItems.length;

    if (!hubData && !nativeData.source_available) {
      return Response.json({
        error: 'Unable to load inventory status summary',
        warning: hubWarning,
      }, { status: 503 });
    }

    return Response.json({
      success: true,
      summary: summaryFromItems(allSanitizedItems, procurementPlan, allOpenPurchaseOrders),
      count: sanitizedItems.length,
      truncated,
      items: sanitizedItems,
      procurement_plan: procurementPlan,
      open_purchase_orders: openPurchaseOrders,
      data_sources: {
        hub_available: Boolean(hubData),
        native_available: nativeData.source_available,
        native_read_only: false,
        native_authoritative: nativeCutoverReady,
        hub_transition_read_only: true,
        non_food_import_candidate_count: missingNativeTrackedItems.length,
        food_inventory_policy: 'food_and_juice_make_to_order',
        food_inventory_rows_hidden: true,
        food_stock_warnings_suppressed: true,
        non_food_inventory_counts_enabled: true,
        inventory_deduction_enabled: false,
        purchase_order_automation_enabled: false,
      },
      warnings: [hubWarning].filter(Boolean),
    });
  } catch (error) {
    console.error('[getAdminInventoryStatusSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load inventory status summary' }, { status: 500 });
  }
}
