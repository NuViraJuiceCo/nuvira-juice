// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const SHOPIFY_API_VERSION = '2026-07';
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;
const VALID_STATUSES = new Set(['ok', 'low', 'critical', 'out_of_stock', 'demand_based', 'count_required', 'sync_error']);
const FOOD_STOCK_EXCLUDED_CATEGORIES = new Set(['produce', 'juice base', 'spices & herbs']);
const FOOD_STOCK_EXCLUDED_ITEMS = new Set(['honey']);
const INVENTORY_MIGRATION_OPERATIONS = new Set(['preview_non_food_import', 'execute_non_food_import']);
const INVENTORY_ITEM_OPERATIONS = new Set(['create_native_item', 'update_native_item']);
const SHOPIFY_INVENTORY_OPERATIONS = new Set([
  'preview_shopify_inventory_link',
  'link_shopify_inventory_item',
  'activate_shopify_inventory_item',
  'create_shopify_bag_product',
  'sync_shopify_inventory_quantity',
]);
const INVENTORY_UNITS = new Set(['lbs', 'g', 'L', 'mL', 'units', 'cases', 'bottles']);
const INVENTORY_CATEGORIES = new Set(['Produce', 'Juice Base', 'Spices & Herbs', 'Packaging', 'Supplies', 'Other']);
const INVENTORY_KINDS = new Set(['ingredient', 'label', 'bag', 'packaging', 'supply', 'other']);
const COUNT_STATUSES = new Set(['pending_count', 'verified']);
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
    throw new Error('status must be one of ok, low, critical, out_of_stock, demand_based, count_required, sync_error');
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
    count_required_count: Number(summary?.count_required_count) || 0,
    shopify_synced_bag_count: Number(summary?.shopify_synced_bag_count) || 0,
    shopify_sync_error_count: Number(summary?.shopify_sync_error_count) || 0,
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
    count_required_count: Number(a?.count_required_count || 0) + Number(b?.count_required_count || 0),
    shopify_synced_bag_count: Number(a?.shopify_synced_bag_count || 0) + Number(b?.shopify_synced_bag_count || 0),
    shopify_sync_error_count: Number(a?.shopify_sync_error_count || 0) + Number(b?.shopify_sync_error_count || 0),
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

function countStatus(item) {
  const status = normalizeLower(item?.count_status);
  if (COUNT_STATUSES.has(status)) return status;
  return Number.isFinite(Number(item?.stock)) ? 'verified' : 'pending_count';
}

function deriveInventoryStatus(item) {
  if (isFoodInventoryItem(item)) return 'demand_based';
  if (countStatus(item) !== 'verified') return 'count_required';
  if (normalizeLower(item?.shopify_sync_status) === 'error') return 'sync_error';
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
    inventory_kind: INVENTORY_KINDS.has(normalizeLower(item.inventory_kind)) ? normalizeLower(item.inventory_kind) : 'other',
    count_status: countStatus(item),
    counted_at: item.counted_at || null,
    linked_product_id: item.linked_product_id || null,
    linked_product_title: item.linked_product_title || null,
    shopify_sync_enabled: item.shopify_sync_enabled === true,
    shopify_inventory_authority: item.shopify_inventory_authority === 'shopify_pos' ? 'shopify_pos' : 'native',
    shopify_product_id: item.shopify_product_id || null,
    shopify_variant_id: item.shopify_variant_id || null,
    shopify_inventory_item_id: item.shopify_inventory_item_id || null,
    shopify_location_id: item.shopify_location_id || null,
    shopify_location_name: item.shopify_location_name || null,
    shopify_available_quantity: numberOrNull(item.shopify_available_quantity),
    shopify_synced_at: item.shopify_synced_at || null,
    shopify_sync_status: item.shopify_sync_status || 'not_linked',
    shopify_sync_error: item.shopify_sync_error || null,
    stock_tracking_policy: policy,
    stock_authoritative: policy === 'stock_tracked' && countStatus(item) === 'verified',
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
    count_required_count: safeItems.filter(item => item.stock_tracking_policy === 'stock_tracked' && item.status === 'count_required').length,
    shopify_synced_bag_count: safeItems.filter(item => item.inventory_kind === 'bag' && item.shopify_sync_enabled === true && item.shopify_sync_status === 'in_sync').length,
    shopify_sync_error_count: safeItems.filter(item => item.inventory_kind === 'bag' && item.shopify_sync_status === 'error').length,
    category_count: new Set(safeItems.map(item => item.category).filter(Boolean)).size,
    procurement_item_count: safePlan.length,
    procurement_supplier_count: new Set(safePlan.map(item => item.supplier).filter(Boolean)).size,
    open_purchase_order_count: safePurchaseOrders.length,
    net_procurement_item_count: safePlan.filter(item => Number(item.net_suggested_quantity || 0) > 0).length,
  });
}

function procurementPlanFromItems(items, openPurchaseOrders) {
  const openPoByIngredient = new Map();
  for (const po of Array.isArray(openPurchaseOrders) ? openPurchaseOrders : []) {
    for (const poItem of Array.isArray(po?.items) ? po.items : []) {
      const key = poItemKey(poItem?.ingredient);
      if (!key) continue;
      const current = openPoByIngredient.get(key) || { quantity: 0, poNumbers: [] };
      current.quantity += Number(poItem?.quantity) || 0;
      if (po.po_number) current.poNumbers.push(po.po_number);
      openPoByIngredient.set(key, current);
    }
  }
  return (Array.isArray(items) ? items : [])
    .filter(item => item.stock_tracking_policy === 'stock_tracked' && ['low', 'critical', 'out_of_stock'].includes(item.status))
    .map(item => {
      const coverage = openPoByIngredient.get(poItemKey(item.ingredient)) || { quantity: 0, poNumbers: [] };
      const stock = Number(item.stock) || 0;
      const target = Number(item.max_stock ?? item.reorder_point ?? 0) || 0;
      const suggestedQuantity = Math.max(0, target - stock);
      const netSuggestedQuantity = Math.max(0, suggestedQuantity - coverage.quantity);
      return sanitizeProcurementPlanItem({
        ...item,
        inventory_item_id: item.id,
        suggested_quantity: suggestedQuantity,
        open_po_quantity: coverage.quantity,
        open_po_numbers: coverage.poNumbers,
        net_suggested_quantity: netSuggestedQuantity,
        estimated_cost: item.cost_per_unit === null || item.cost_per_unit === undefined ? null : netSuggestedQuantity * Number(item.cost_per_unit),
      });
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
    .filter(item => item.stock_tracking_policy === 'stock_tracked' && ['low', 'critical', 'out_of_stock'].includes(item.status))
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

async function loadInventoryProductOptions(base44) {
  const productEntity = base44?.asServiceRole?.entities?.Product;
  const products = productEntity?.list ? await productEntity.list('sort_order', 200).catch(() => []) : [];
  return (Array.isArray(products) ? products : [])
    .filter(product => product?.is_available !== false && ['juice', 'shot', 'merch', 'apparel'].includes(normalizeLower(product?.category)))
    .map(product => ({
      id: product.id || null,
      title: optionalText(product.title, 160),
      category: normalizeLower(product.category),
      price: numberOrNull(product.price),
      shopify_product_id: product.shopify_product_id || null,
      shopify_variant_id: product.shopify_variant_id || null,
    }))
    .filter(product => product.id && product.title);
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
    inventory_kind: normalizeLower(item.category) === 'packaging' ? 'packaging' : 'supply',
    count_status: 'verified',
    counted_at: new Date().toISOString(),
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

function inventoryItemMutationPayload(body, current, user) {
  const item = body?.item && typeof body.item === 'object' && !Array.isArray(body.item) ? body.item : {};
  const suppliedCountStatus = normalizeLower(item.count_status);
  const nextCountStatus = suppliedCountStatus
    ? enumValue(suppliedCountStatus, 'item.count_status', COUNT_STATUSES)
    : current
      ? countStatus(current)
      : (item.stock === null || item.stock === undefined || item.stock === '' ? 'pending_count' : 'verified');
  const inventoryKind = enumValue(normalizeLower(item.inventory_kind || current?.inventory_kind || 'other'), 'item.inventory_kind', INVENTORY_KINDS);
  const payload = {
    ingredient: optionalText(item.ingredient, 160),
    unit: enumValue(item.unit, 'item.unit', INVENTORY_UNITS),
    stock: nextCountStatus === 'pending_count' && (item.stock === null || item.stock === undefined || item.stock === '')
      ? 0
      : requiredNonNegativeNumber(item.stock, 'item.stock'),
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
    notes: optionalText(item.notes, 500),
    inventory_kind: inventoryKind,
    count_status: nextCountStatus,
    linked_product_id: optionalText(item.linked_product_id, 160),
    linked_product_title: optionalText(item.linked_product_title, 160),
  };
  if (!payload.ingredient) throw new Error('item.ingredient is required');
  if (isFoodInventoryItem(payload)) {
    throw new Error('Food and juice ingredients are demand-based and cannot be stock-tracked here');
  }
  if (current && normalizeMatchKey(payload.ingredient) !== normalizeMatchKey(current?.ingredient)) {
    throw new Error('item.ingredient cannot be renamed during a stock update');
  }
  if (payload.max_stock !== null && payload.max_stock < payload.reorder_point) {
    throw new Error('item.max_stock must be at least item.reorder_point');
  }
  if (payload.inventory_kind === 'label' && !payload.linked_product_id) {
    throw new Error('Labels must be linked to the product they identify');
  }
  if (payload.count_status === 'verified') {
    const stockChanged = !current || Number(current.stock) !== Number(payload.stock) || countStatus(current) !== 'verified';
    if (stockChanged) {
      payload.counted_at = new Date().toISOString();
      payload.counted_by = user.email;
    }
  }
  return payload;
}

async function handleInventoryItemMutation({ base44, user, body }) {
  const operation = normalizeLower(body.operation);
  if (!INVENTORY_ITEM_OPERATIONS.has(operation)) return null;

  const itemId = normalizeText(body.item_id);
  const requestId = normalizeText(body.request_id);
  const expectedUpdatedDate = normalizeText(body.expected_updated_date);
  if (operation === 'update_native_item' && !itemId) return Response.json({ error: 'item_id is required' }, { status: 400 });
  if (!requestId) return Response.json({ error: 'request_id is required' }, { status: 400 });
  if (body.confirm !== true) return Response.json({ error: 'confirm must be true' }, { status: 400 });

  const idempotencyKey = `native_inventory_item_${operation}:${requestId}`;
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
      item_id: prior.target_id || itemId || null,
      source: 'customer_app_native',
    });
  }

  const existingItems = operation === 'update_native_item'
    ? await base44.asServiceRole.entities.InventoryItem.filter({ id: itemId }, '-updated_date', 1).catch(() => [])
    : [];
  const current = existingItems[0] || null;
  if (operation === 'update_native_item' && !current) return Response.json({ error: 'Inventory item not found' }, { status: 404 });
  if (current && isFoodInventoryItem(current)) {
    return Response.json({ error: 'Food and juice ingredients are managed from production demand' }, { status: 409 });
  }
  const currentUpdatedDate = normalizeText(current?.updated_date);
  if (operation === 'update_native_item' && currentUpdatedDate && expectedUpdatedDate !== currentUpdatedDate) {
    return Response.json({ error: 'Inventory item changed; refresh before saving' }, { status: 409 });
  }

  let payload;
  try {
    payload = inventoryItemMutationPayload(body, current, user);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  if (payload.linked_product_id) {
    const products = await base44.asServiceRole.entities.Product.filter({ id: payload.linked_product_id }, '-updated_date', 1).catch(() => []);
    const product = products[0] || null;
    if (!product) return Response.json({ error: 'Linked product was not found' }, { status: 409 });
    payload.linked_product_title = optionalText(product.title, 160);
  }
  if (
    operation === 'update_native_item'
    && current?.shopify_sync_enabled === true
    && current?.shopify_inventory_authority === 'shopify_pos'
    && Number(payload.stock) !== Number(current.stock)
  ) {
    return Response.json({ error: 'Use the Shopify POS quantity control to change stock for this linked bag' }, { status: 409 });
  }
  if (operation === 'create_native_item') {
    const allItems = await base44.asServiceRole.entities.InventoryItem.list('ingredient', 500).catch(() => []);
    if (allItems.some(item => normalizeMatchKey(item.ingredient) === normalizeMatchKey(payload.ingredient))) {
      return Response.json({ error: 'An inventory item with this name already exists' }, { status: 409 });
    }
  }

  const now = new Date().toISOString();
  const command = await base44.asServiceRole.entities.CommandLog.create({
    command_id: requestId,
    command_type: operation === 'create_native_item' ? 'native_inventory_item_create' : 'native_inventory_item_update',
    command_source: 'customer_app_admin',
    status: 'pending',
    target_entity: 'InventoryItem',
    target_id: itemId || 'pending_create',
    target_display_id: current?.ingredient || payload.ingredient,
    actor_email: user.email,
    actor_role: user.role,
    actor_type: 'authenticated_admin',
    payload: {
      operation,
      expected_updated_date: expectedUpdatedDate || null,
      inventory_kind: payload.inventory_kind,
      count_status: payload.count_status,
      linked_product_id: payload.linked_product_id || null,
    },
    result: { saved: false },
    idempotency_key: idempotencyKey,
    idempotent_skipped: false,
    request_id: requestId,
    submitted_at: now,
    started_at: now,
    function_name: 'getAdminInventoryStatusSummary',
  });

  try {
    const saved = operation === 'create_native_item'
      ? await base44.asServiceRole.entities.InventoryItem.create(payload)
      : await base44.asServiceRole.entities.InventoryItem.update(itemId, payload);
    if (operation === 'create_native_item' && saved?.id) {
      await base44.asServiceRole.entities.CommandLog.update(command.id, { target_id: saved.id }).catch(() => null);
    }
    await base44.asServiceRole.entities.CommandLog.update(command.id, {
      status: 'success',
      completed_at: new Date().toISOString(),
      result: { saved: true, source: 'customer_app_native' },
    });
    return Response.json({
      success: true,
      operation,
      skipped: false,
      item: sanitizeItem({ ...(current || {}), ...saved, source: 'customer_app_native', status: deriveInventoryStatus({ ...(current || {}), ...saved }) }),
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
      error_code: operation === 'create_native_item' ? 'inventory_item_create_failed' : 'inventory_item_update_failed',
      error_message: operation === 'create_native_item' ? 'Inventory item create failed' : 'Inventory item update failed',
      result: { saved: false },
    }).catch(() => null);
    return Response.json({ error: operation === 'create_native_item' ? 'Unable to create inventory item' : 'Unable to update inventory item' }, { status: 500 });
  }
}

function shopifyHost() {
  return normalizeText(Deno.env.get('SHOPIFY_STORE_URL'))
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\/+$/, '');
}

async function shopifyAccessToken(host) {
  const clientId = normalizeText(Deno.env.get('SHOPIFY_CLIENT_ID'));
  const secretNames = [
    'SHOPIFY_CLIENT_SECRET',
    'SHOPIFY_API_SECRET_KEY',
    'SHOPIFY_API_SECRET',
    'SHOPIFY_APP_SECRET',
    'SHOPIFY_SHARED_SECRET',
  ];
  const seenSecrets = new Set();
  if (clientId) {
    for (const name of secretNames) {
      const clientSecret = normalizeText(Deno.env.get(name));
      if (!clientSecret || seenSecrets.has(clientSecret)) continue;
      seenSecrets.add(clientSecret);
      const response = await fetch(`https://${host}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.access_token) return normalizeText(payload.access_token);
    }
  }
  return normalizeText(Deno.env.get('SHOPIFY_API_TOKEN'));
}

function safeProviderError(value) {
  return optionalText(value, 220) || 'Shopify inventory request failed';
}

async function shopifyGraphql(query, variables = {}, idempotencyKey = '') {
  const host = shopifyHost();
  const token = host ? await shopifyAccessToken(host) : '';
  if (!host || !token) throw new Error('Shopify inventory credentials are not configured');
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': token,
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch(`https://${host}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => ({}));
  const graphError = Array.isArray(payload?.errors) ? payload.errors.map(error => error?.message).filter(Boolean).join('; ') : '';
  if (!response.ok || graphError) throw new Error(safeProviderError(graphError || `Shopify HTTP ${response.status}`));
  return payload?.data || {};
}

function availableQuantity(level) {
  const quantity = (Array.isArray(level?.quantities) ? level.quantities : [])
    .find(value => normalizeLower(value?.name) === 'available')?.quantity;
  return Number.isFinite(Number(quantity)) ? Number(quantity) : null;
}

function sanitizeShopifyPreview(data, expectedTitle) {
  const products = Array.isArray(data?.products?.nodes) ? data.products.nodes : [];
  const candidates = products
    .filter(product => normalizeMatchKey(product?.title) === normalizeMatchKey(expectedTitle))
    .map(product => ({
      product_id: product?.id || null,
      title: optionalText(product?.title, 160),
      handle: optionalText(product?.handle, 160),
      status: normalizeLower(product?.status),
      variants: (Array.isArray(product?.variants?.nodes) ? product.variants.nodes : []).map(variant => ({
        variant_id: variant?.id || null,
        title: optionalText(variant?.title, 120),
        sku: optionalText(variant?.sku, 120),
        price: numberOrNull(variant?.price),
        inventory_item_id: variant?.inventoryItem?.id || null,
        tracked: variant?.inventoryItem?.tracked === true,
        levels: (Array.isArray(variant?.inventoryItem?.inventoryLevels?.nodes) ? variant.inventoryItem.inventoryLevels.nodes : []).map(level => ({
          location_id: level?.location?.id || null,
          location_name: optionalText(level?.location?.name, 160),
          available_quantity: availableQuantity(level),
        })).filter(level => level.location_id),
      })).filter(variant => variant.variant_id && variant.inventory_item_id),
    })).filter(product => product.product_id);
  const locations = (Array.isArray(data?.locations?.nodes) ? data.locations.nodes : [])
    .filter(location => location?.isActive !== false)
    .map(location => ({ id: location?.id || null, name: optionalText(location?.name, 160) }))
    .filter(location => location.id);
  const pointOfSalePublication = (Array.isArray(data?.publications?.nodes) ? data.publications.nodes : [])
    .find(publication => normalizeLower(publication?.name).includes('point of sale')) || null;
  return {
    candidates,
    locations,
    point_of_sale_publication: pointOfSalePublication
      ? { id: pointOfSalePublication.id, name: optionalText(pointOfSalePublication.name, 160) }
      : null,
  };
}

async function shopifyInventoryPreview(expectedTitle) {
  const queryText = normalizeText(expectedTitle).replace(/["\\]/g, ' ');
  const inventoryData = await shopifyGraphql(`query InventoryConnectionPreview($query: String!) {
    products(first: 20, query: $query) {
      nodes {
        id title handle status
        variants(first: 20) {
          nodes {
            id title sku price
            inventoryItem {
              id tracked
              inventoryLevels(first: 20) {
                nodes {
                  location { id name }
                  quantities(names: ["available"]) { name quantity }
                }
              }
            }
          }
        }
      }
    }
    locations(first: 50) { nodes { id name isActive } }
  }`, { query: `title:\"${queryText}\"` });
  let publicationData = {};
  let publicationAccess = 'available';
  let publicationWarning = null;
  try {
    publicationData = await shopifyGraphql(`query PointOfSalePublication {
      publications(first: 50) { nodes { id name } }
    }`);
  } catch {
    publicationAccess = 'scope_required';
    publicationWarning = 'Automatic Shopify POS publishing needs publications access. Create or enable the bag in Shopify POS, then refresh here to link its tracked inventory.';
  }
  return {
    ...sanitizeShopifyPreview({ ...inventoryData, ...publicationData }, expectedTitle),
    publication_access: publicationAccess,
    publication_warning: publicationWarning,
  };
}

async function loadInventoryItem(base44, itemId) {
  const rows = await base44.asServiceRole.entities.InventoryItem.filter({ id: itemId }, '-updated_date', 1).catch(() => []);
  return rows[0] || null;
}

async function loadLinkedProduct(base44, item) {
  if (!item?.linked_product_id) return null;
  const rows = await base44.asServiceRole.entities.Product.filter({ id: item.linked_product_id }, '-updated_date', 1).catch(() => []);
  return rows[0] || null;
}

async function readLinkedShopifyQuantity(item) {
  if (!item?.shopify_inventory_item_id || !item?.shopify_location_id) return null;
  const data = await shopifyGraphql(`query LinkedInventoryLevel($id: ID!) {
    inventoryItem(id: $id) {
      id tracked
      inventoryLevels(first: 50) {
        nodes {
          location { id name }
          quantities(names: ["available"]) { name quantity }
        }
      }
    }
  }`, { id: item.shopify_inventory_item_id });
  const levels = Array.isArray(data?.inventoryItem?.inventoryLevels?.nodes) ? data.inventoryItem.inventoryLevels.nodes : [];
  const level = levels.find(value => value?.location?.id === item.shopify_location_id) || null;
  if (!level) throw new Error('Linked Shopify location is not active for this inventory item');
  return {
    quantity: availableQuantity(level),
    location_name: optionalText(level?.location?.name, 160),
    tracked: data?.inventoryItem?.tracked === true,
  };
}

async function createProviderCommand(base44, user, { requestId, operation, item, payload }) {
  const idempotencyKey = `shopify_inventory_${operation}:${requestId}`;
  const existing = await base44.asServiceRole.entities.CommandLog.filter({ idempotency_key: idempotencyKey }, '-created_date', 1).catch(() => []);
  if (existing.length > 0) return { existing: existing[0], idempotencyKey, command: null };
  const now = new Date().toISOString();
  const command = await base44.asServiceRole.entities.CommandLog.create({
    command_id: requestId,
    command_type: `shopify_inventory_${operation}`,
    command_source: 'customer_app_admin',
    status: 'pending',
    target_entity: 'InventoryItem',
    target_id: item.id,
    target_display_id: item.ingredient,
    actor_email: user.email,
    actor_role: user.role,
    actor_type: 'authenticated_admin',
    payload,
    result: { provider_write_completed: false, native_projection_completed: false },
    idempotency_key: idempotencyKey,
    idempotent_skipped: false,
    request_id: requestId,
    submitted_at: now,
    started_at: now,
    function_name: 'getAdminInventoryStatusSummary',
  });
  return { existing: null, idempotencyKey, command };
}

function providerUserErrors(payload, field) {
  const errors = Array.isArray(payload?.[field]?.userErrors) ? payload[field].userErrors : [];
  if (errors.length > 0) throw new Error(safeProviderError(errors.map(error => error?.message).filter(Boolean).join('; ')));
  return payload?.[field] || {};
}

async function handleShopifyInventoryOperation({ base44, user, body }) {
  const operation = normalizeLower(body.operation);
  if (!SHOPIFY_INVENTORY_OPERATIONS.has(operation)) return null;
  const itemId = normalizeText(body.item_id);
  if (!itemId) return Response.json({ error: 'item_id is required' }, { status: 400 });
  const item = await loadInventoryItem(base44, itemId);
  if (!item) return Response.json({ error: 'Inventory item not found' }, { status: 404 });
  if (normalizeLower(item.inventory_kind) !== 'bag') {
    return Response.json({ error: 'Shopify POS inventory linking is limited to sellable bag items' }, { status: 409 });
  }
  const product = await loadLinkedProduct(base44, item);
  if (!product) return Response.json({ error: 'Link this bag to its Customer App product first' }, { status: 409 });

  if (operation === 'preview_shopify_inventory_link') {
    try {
      const preview = await shopifyInventoryPreview(product.title);
      return Response.json({
        success: true,
        operation,
        dry_run: true,
        read_only: true,
        item_id: item.id,
        linked_product: { id: product.id, title: optionalText(product.title, 160), price: numberOrNull(product.price) },
        ...preview,
        existing_candidate_count: preview.candidates.length,
        creation_ready: preview.candidates.length === 0 && preview.locations.length > 0 && Boolean(preview.point_of_sale_publication) && Number.isFinite(Number(product.price)),
        creation_blocker: preview.candidates.length > 0
          ? null
          : !preview.point_of_sale_publication
            ? 'shopify_publication_scope_required'
            : preview.locations.length === 0
              ? 'shopify_location_required'
              : !Number.isFinite(Number(product.price))
                ? 'linked_product_price_required'
                : null,
        writes_performed: false,
        provider_calls_performed: true,
        customer_notifications_sent: false,
      });
    } catch (error) {
      return Response.json({ error: safeProviderError(error.message) }, { status: 502 });
    }
  }

  const requestId = normalizeText(body.request_id);
  if (!requestId) return Response.json({ error: 'request_id is required' }, { status: 400 });
  if (body.confirm !== true) return Response.json({ error: 'confirm must be true' }, { status: 400 });

  if (operation === 'link_shopify_inventory_item') {
    const productId = normalizeText(body.shopify_product_id);
    const variantId = normalizeText(body.shopify_variant_id);
    const inventoryItemId = normalizeText(body.shopify_inventory_item_id);
    const locationId = normalizeText(body.shopify_location_id);
    if (!productId || !variantId || !inventoryItemId || !locationId) {
      return Response.json({ error: 'Shopify product, variant, inventory item, and location are required' }, { status: 400 });
    }
    let preview;
    try {
      preview = await shopifyInventoryPreview(product.title);
    } catch (error) {
      return Response.json({ error: safeProviderError(error.message) }, { status: 502 });
    }
    const candidate = preview.candidates.find(value => value.product_id === productId);
    const variant = candidate?.variants?.find(value => value.variant_id === variantId && value.inventory_item_id === inventoryItemId);
    const location = preview.locations.find(value => value.id === locationId);
    if (!candidate || !variant || !location) return Response.json({ error: 'Shopify link selection changed; preview again' }, { status: 409 });
    const level = variant.levels.find(value => value.location_id === locationId) || null;
    if (!variant.tracked || !level || !Number.isFinite(Number(level.available_quantity))) {
      return Response.json({ error: 'Selected Shopify variant is not actively inventory-tracked at this location' }, { status: 409 });
    }
    const commandState = await createProviderCommand(base44, user, {
      requestId, operation, item,
      payload: { product_id: productId, variant_id: variantId, inventory_item_id: inventoryItemId, location_id: locationId },
    });
    if (commandState.existing) {
      if (commandState.existing.status !== 'success') return Response.json({ error: 'A prior link attempt requires review' }, { status: 409 });
      return Response.json({ success: true, operation, skipped: true, reason: 'duplicate_request_id', item_id: item.id });
    }
    try {
      const now = new Date().toISOString();
      const quantity = Number(level.available_quantity);
      const saved = await base44.asServiceRole.entities.InventoryItem.update(item.id, {
        stock: quantity,
        count_status: 'verified',
        counted_at: now,
        counted_by: user.email,
        shopify_sync_enabled: true,
        shopify_inventory_authority: 'shopify_pos',
        shopify_product_id: productId,
        shopify_variant_id: variantId,
        shopify_inventory_item_id: inventoryItemId,
        shopify_location_id: locationId,
        shopify_location_name: location.name,
        shopify_available_quantity: quantity,
        shopify_synced_at: now,
        shopify_sync_status: 'in_sync',
        shopify_sync_error: null,
      });
      await base44.asServiceRole.entities.Product.update(product.id, {
        shopify_product_id: productId,
        shopify_variant_id: variantId,
        shopify_handle: candidate.handle || product.shopify_handle || null,
      });
      await base44.asServiceRole.entities.CommandLog.update(commandState.command.id, {
        status: 'success', completed_at: now,
        result: { provider_write_completed: false, native_projection_completed: true, linked: true, quantity },
      });
      return Response.json({ success: true, operation, item: sanitizeItem({ ...item, ...saved, status: deriveInventoryStatus({ ...item, ...saved }) }), provider_calls_performed: true, inventory_mutation: true, customer_notifications_sent: false });
    } catch {
      await base44.asServiceRole.entities.CommandLog.update(commandState.command.id, { status: 'failed', completed_at: new Date().toISOString(), error_code: 'shopify_inventory_link_projection_failed', error_message: 'Unable to save verified Shopify inventory link' }).catch(() => null);
      return Response.json({ error: 'Unable to save verified Shopify inventory link' }, { status: 500 });
    }
  }

  if (operation === 'activate_shopify_inventory_item') {
    if (normalizeText(body.confirmation) !== 'ACTIVATE SHOPIFY POS BAG') {
      return Response.json({ error: 'confirmation phrase is required' }, { status: 400 });
    }
    if (countStatus(item) !== 'verified' || !Number.isInteger(Number(item.stock))) {
      return Response.json({ error: 'Record and verify the physical bag count before activating Shopify inventory' }, { status: 409 });
    }
    const productId = normalizeText(body.shopify_product_id);
    const variantId = normalizeText(body.shopify_variant_id);
    const inventoryItemId = normalizeText(body.shopify_inventory_item_id);
    const locationId = normalizeText(body.shopify_location_id);
    if (!productId || !variantId || !inventoryItemId || !locationId) {
      return Response.json({ error: 'Shopify product, variant, inventory item, and location are required' }, { status: 400 });
    }
    let preview;
    try {
      preview = await shopifyInventoryPreview(product.title);
    } catch (error) {
      return Response.json({ error: safeProviderError(error.message) }, { status: 502 });
    }
    const candidate = preview.candidates.find(value => value.product_id === productId);
    const variant = candidate?.variants?.find(value => value.variant_id === variantId && value.inventory_item_id === inventoryItemId);
    const location = preview.locations.find(value => value.id === locationId);
    const level = variant?.levels?.find(value => value.location_id === locationId) || null;
    if (!candidate || !variant || !location) return Response.json({ error: 'Shopify activation selection changed; preview again' }, { status: 409 });
    if (variant.tracked === true && level && Number.isInteger(Number(level.available_quantity))) {
      return Response.json({ error: 'Shopify inventory is already tracked at this location; link it instead' }, { status: 409 });
    }
    const commandState = await createProviderCommand(base44, user, {
      requestId, operation, item,
      payload: {
        product_id: productId,
        variant_id: variantId,
        inventory_item_id: inventoryItemId,
        location_id: locationId,
        opening_quantity: Number(item.stock),
      },
    });
    if (commandState.existing) {
      if (commandState.existing.status !== 'success') return Response.json({ error: 'A prior activation attempt requires review before retrying' }, { status: 409 });
      return Response.json({ success: true, operation, skipped: true, reason: 'duplicate_request_id', item_id: item.id });
    }
    let trackingEnabled = false;
    try {
      const trackingData = await shopifyGraphql(`mutation TrackPosBagInventory($id: ID!, $input: InventoryItemInput!) {
        inventoryItemUpdate(id: $id, input: $input) {
          inventoryItem { id tracked }
          userErrors { code field message }
        }
      }`, { id: inventoryItemId, input: { tracked: true } }, `${commandState.idempotencyKey}:track`);
      const trackingResult = providerUserErrors(trackingData, 'inventoryItemUpdate');
      trackingEnabled = trackingResult?.inventoryItem?.tracked === true;
      if (!trackingEnabled) throw new Error('Shopify did not enable inventory tracking for the bag');

      if (level && Number.isInteger(Number(level.available_quantity))) {
        const quantityData = await shopifyGraphql(`mutation SetOpeningPosBagQuantity($input: InventorySetQuantitiesInput!) {
          inventorySetQuantities(input: $input) {
            inventoryAdjustmentGroup { createdAt reason referenceDocumentUri changes { name delta } }
            userErrors { code field message }
          }
        }`, { input: {
          name: 'available', reason: 'correction', referenceDocumentUri: `gid://nuvira/InventoryCommand/${requestId}`,
          quantities: [{
            inventoryItemId,
            locationId,
            quantity: Number(item.stock),
            compareQuantity: Number(level.available_quantity),
          }],
        } }, `${commandState.idempotencyKey}:quantity`);
        providerUserErrors(quantityData, 'inventorySetQuantities');
      } else {
        const activateData = await shopifyGraphql(`mutation ActivateExistingPosBagInventory($inventoryItemId: ID!, $locationId: ID!, $available: Int!) {
          inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) {
            inventoryLevel { id quantities(names: ["available"]) { name quantity } }
            userErrors { field message }
          }
        }`, { inventoryItemId, locationId, available: Number(item.stock) }, `${commandState.idempotencyKey}:activate`);
        providerUserErrors(activateData, 'inventoryActivate');
      }

      const now = new Date().toISOString();
      const saved = await base44.asServiceRole.entities.InventoryItem.update(item.id, {
        shopify_sync_enabled: true,
        shopify_inventory_authority: 'shopify_pos',
        shopify_product_id: productId,
        shopify_variant_id: variantId,
        shopify_inventory_item_id: inventoryItemId,
        shopify_location_id: locationId,
        shopify_location_name: location.name,
        shopify_available_quantity: Number(item.stock),
        shopify_synced_at: now,
        shopify_sync_status: 'in_sync',
        shopify_sync_error: null,
      });
      await base44.asServiceRole.entities.Product.update(product.id, {
        shopify_product_id: productId,
        shopify_variant_id: variantId,
        shopify_handle: candidate.handle || product.shopify_handle || null,
      });
      await base44.asServiceRole.entities.CommandLog.update(commandState.command.id, {
        status: 'success', completed_at: now,
        result: { provider_write_completed: true, native_projection_completed: true, tracking_enabled: true, quantity: Number(item.stock) },
      });
      return Response.json({
        success: true,
        operation,
        item: sanitizeItem({ ...item, ...saved, status: deriveInventoryStatus({ ...item, ...saved }) }),
        provider_calls_performed: true,
        inventory_mutation: true,
        customer_notifications_sent: false,
      });
    } catch (error) {
      await base44.asServiceRole.entities.CommandLog.update(commandState.command.id, {
        status: 'failed', completed_at: new Date().toISOString(), error_code: 'shopify_inventory_activation_failed',
        error_message: safeProviderError(error.message),
        result: { provider_write_completed: trackingEnabled, native_projection_completed: false, tracking_enabled: trackingEnabled },
      }).catch(() => null);
      return Response.json({
        error: safeProviderError(error.message),
        partial_provider_write: trackingEnabled,
        requires_review: trackingEnabled,
      }, { status: 502 });
    }
  }

  if (operation === 'create_shopify_bag_product') {
    if (normalizeText(body.confirmation) !== 'CREATE SHOPIFY POS BAG') {
      return Response.json({ error: 'confirmation phrase is required' }, { status: 400 });
    }
    if (countStatus(item) !== 'verified' || !Number.isInteger(Number(item.stock))) {
      return Response.json({ error: 'Record and verify the physical bag count before creating Shopify inventory' }, { status: 409 });
    }
    let preview;
    try {
      preview = await shopifyInventoryPreview(product.title);
    } catch (error) {
      return Response.json({ error: safeProviderError(error.message) }, { status: 502 });
    }
    if (preview.candidates.length > 0) return Response.json({ error: 'Matching Shopify product now exists; link it instead of creating another' }, { status: 409 });
    const location = preview.locations.find(value => value.id === normalizeText(body.shopify_location_id));
    const publication = preview.point_of_sale_publication;
    if (!location || !publication || publication.id !== normalizeText(body.shopify_publication_id)) {
      return Response.json({ error: 'Shopify location or Point of Sale publication changed; preview again' }, { status: 409 });
    }
    const commandState = await createProviderCommand(base44, user, {
      requestId, operation, item,
      payload: { location_id: location.id, publication_id: publication.id, opening_quantity: Number(item.stock) },
    });
    if (commandState.existing) {
      if (commandState.existing.status !== 'success') return Response.json({ error: 'A prior create attempt requires review before retrying' }, { status: 409 });
      return Response.json({ success: true, operation, skipped: true, reason: 'duplicate_request_id', item_id: item.id });
    }
    let createdProductId = null;
    let createdVariantId = null;
    let createdInventoryItemId = null;
    try {
      const createData = await shopifyGraphql(`mutation CreatePosBag($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product { id title handle variants(first: 1) { nodes { id inventoryItem { id tracked } } } }
          userErrors { field message }
        }
      }`, { product: {
        title: product.title,
        descriptionHtml: optionalText(product.description || product.short_description, 1000) || '',
        productType: 'Bags', vendor: 'NuVira Juice Company', status: 'ACTIVE', tags: ['Bag', 'POS', 'NuVira'],
      } }, commandState.idempotencyKey);
      const createResult = providerUserErrors(createData, 'productCreate');
      createdProductId = createResult?.product?.id || null;
      createdVariantId = createResult?.product?.variants?.nodes?.[0]?.id || null;
      if (!createdProductId || !createdVariantId) throw new Error('Shopify did not return the created bag variant');

      const variantData = await shopifyGraphql(`mutation ConfigurePosBag($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id inventoryItem { id tracked } }
          userErrors { field message }
        }
      }`, {
        productId: createdProductId,
        variants: [{ id: createdVariantId, price: Number(product.price).toFixed(2), inventoryItem: { sku: 'NUVIRA-LARGE-TOTE', tracked: true } }],
      }, `${commandState.idempotencyKey}:variant`);
      const variantResult = providerUserErrors(variantData, 'productVariantsBulkUpdate');
      createdInventoryItemId = variantResult?.productVariants?.[0]?.inventoryItem?.id || null;
      if (!createdInventoryItemId) throw new Error('Shopify did not return the bag inventory item');

      const activateData = await shopifyGraphql(`mutation ActivatePosBagInventory($inventoryItemId: ID!, $locationId: ID!, $available: Int!) {
        inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) {
          inventoryLevel { id quantities(names: ["available"]) { name quantity } }
          userErrors { field message }
        }
      }`, { inventoryItemId: createdInventoryItemId, locationId: location.id, available: Number(item.stock) }, `${commandState.idempotencyKey}:activate`);
      providerUserErrors(activateData, 'inventoryActivate');

      const publishData = await shopifyGraphql(`mutation PublishPosBag($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) { userErrors { field message } }
      }`, { id: createdProductId, input: [{ publicationId: publication.id }] }, `${commandState.idempotencyKey}:publish`);
      providerUserErrors(publishData, 'publishablePublish');

      const now = new Date().toISOString();
      const saved = await base44.asServiceRole.entities.InventoryItem.update(item.id, {
        shopify_sync_enabled: true,
        shopify_inventory_authority: 'shopify_pos',
        shopify_product_id: createdProductId,
        shopify_variant_id: createdVariantId,
        shopify_inventory_item_id: createdInventoryItemId,
        shopify_location_id: location.id,
        shopify_location_name: location.name,
        shopify_available_quantity: Number(item.stock),
        shopify_synced_at: now,
        shopify_sync_status: 'in_sync',
        shopify_sync_error: null,
      });
      await base44.asServiceRole.entities.Product.update(product.id, {
        shopify_product_id: createdProductId,
        shopify_variant_id: createdVariantId,
        shopify_handle: createResult?.product?.handle || null,
      });
      await base44.asServiceRole.entities.CommandLog.update(commandState.command.id, {
        status: 'success', completed_at: now,
        result: { provider_write_completed: true, native_projection_completed: true, published_to_pos: true, quantity: Number(item.stock) },
      });
      return Response.json({ success: true, operation, item: sanitizeItem({ ...item, ...saved, status: deriveInventoryStatus({ ...item, ...saved }) }), provider_calls_performed: true, inventory_mutation: true, customer_notifications_sent: false });
    } catch (error) {
      await base44.asServiceRole.entities.CommandLog.update(commandState.command.id, {
        status: 'failed', completed_at: new Date().toISOString(), error_code: 'shopify_pos_bag_create_failed',
        error_message: safeProviderError(error.message),
        result: { provider_write_completed: Boolean(createdProductId), native_projection_completed: false, created_product_id: createdProductId, created_variant_id: createdVariantId, created_inventory_item_id: createdInventoryItemId },
      }).catch(() => null);
      return Response.json({ error: safeProviderError(error.message), partial_provider_write: Boolean(createdProductId), requires_review: Boolean(createdProductId) }, { status: 502 });
    }
  }

  const quantity = Number(body.quantity);
  const expectedQuantity = Number(body.expected_shopify_quantity);
  if (!item.shopify_sync_enabled || item.shopify_inventory_authority !== 'shopify_pos' || !item.shopify_inventory_item_id || !item.shopify_location_id) {
    return Response.json({ error: 'Bag is not linked to Shopify POS inventory' }, { status: 409 });
  }
  if (!Number.isInteger(quantity) || quantity < 0) return Response.json({ error: 'quantity must be a whole number 0 or greater' }, { status: 400 });
  if (!Number.isInteger(expectedQuantity) || expectedQuantity < 0) return Response.json({ error: 'expected_shopify_quantity is required' }, { status: 400 });
  const commandState = await createProviderCommand(base44, user, {
    requestId, operation, item,
    payload: { quantity, expected_shopify_quantity: expectedQuantity, inventory_item_id: item.shopify_inventory_item_id, location_id: item.shopify_location_id },
  });
  if (commandState.existing) {
    if (commandState.existing.status !== 'success') return Response.json({ error: 'A prior quantity sync requires review before retrying' }, { status: 409 });
    return Response.json({ success: true, operation, skipped: true, reason: 'duplicate_request_id', item_id: item.id });
  }
  try {
    const current = await readLinkedShopifyQuantity(item);
    if (!Number.isInteger(current?.quantity) || current.quantity !== expectedQuantity) {
      await base44.asServiceRole.entities.CommandLog.update(commandState.command.id, { status: 'failed', completed_at: new Date().toISOString(), error_code: 'shopify_quantity_changed', error_message: 'Shopify POS quantity changed before save', result: { provider_write_completed: false, native_projection_completed: false } });
      return Response.json({ error: 'Shopify POS quantity changed; refresh before saving', current_shopify_quantity: current?.quantity ?? null }, { status: 409 });
    }
    const mutationData = await shopifyGraphql(`mutation SetPosBagQuantity($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        inventoryAdjustmentGroup { createdAt reason referenceDocumentUri changes { name delta } }
        userErrors { code field message }
      }
    }`, { input: {
      name: 'available', reason: 'correction', referenceDocumentUri: `gid://nuvira/InventoryCommand/${requestId}`,
      quantities: [{ inventoryItemId: item.shopify_inventory_item_id, locationId: item.shopify_location_id, quantity, compareQuantity: current.quantity }],
    } }, commandState.idempotencyKey);
    providerUserErrors(mutationData, 'inventorySetQuantities');
    const now = new Date().toISOString();
    const saved = await base44.asServiceRole.entities.InventoryItem.update(item.id, {
      stock: quantity, count_status: 'verified', counted_at: now, counted_by: user.email,
      shopify_available_quantity: quantity, shopify_synced_at: now, shopify_sync_status: 'in_sync', shopify_sync_error: null,
    });
    await base44.asServiceRole.entities.CommandLog.update(commandState.command.id, {
      status: 'success', completed_at: now,
      result: { provider_write_completed: true, native_projection_completed: true, previous_quantity: current.quantity, quantity },
    });
    return Response.json({ success: true, operation, item: sanitizeItem({ ...item, ...saved, status: deriveInventoryStatus({ ...item, ...saved }) }), provider_calls_performed: true, inventory_mutation: true, customer_notifications_sent: false });
  } catch (error) {
    await base44.asServiceRole.entities.CommandLog.update(commandState.command.id, {
      status: 'failed', completed_at: new Date().toISOString(), error_code: 'shopify_inventory_quantity_sync_failed', error_message: safeProviderError(error.message), result: { provider_write_completed: false, native_projection_completed: false },
    }).catch(() => null);
    await base44.asServiceRole.entities.InventoryItem.update(item.id, { shopify_sync_status: 'error', shopify_sync_error: safeProviderError(error.message) }).catch(() => null);
    return Response.json({ error: safeProviderError(error.message) }, { status: 502 });
  }
}

async function hydrateShopifyBagItems(items) {
  const hydrated = [];
  let providerCalls = 0;
  const warnings = [];
  for (const item of items) {
    if (item?.inventory_kind !== 'bag' || item?.shopify_sync_enabled !== true || !item?.shopify_inventory_item_id || !item?.shopify_location_id) {
      hydrated.push(item);
      continue;
    }
    providerCalls += 1;
    try {
      const remote = await readLinkedShopifyQuantity(item);
      const quantity = remote?.quantity;
      const merged = {
        ...item,
        stock: quantity,
        shopify_available_quantity: quantity,
        shopify_location_name: remote?.location_name || item.shopify_location_name,
        shopify_synced_at: new Date().toISOString(),
        shopify_sync_status: Number.isFinite(Number(quantity)) ? 'in_sync' : 'error',
        shopify_sync_error: Number.isFinite(Number(quantity)) ? null : 'Shopify available quantity is unavailable',
      };
      hydrated.push({ ...merged, status: deriveInventoryStatus(merged) });
    } catch {
      const merged = { ...item, shopify_sync_status: 'error', shopify_sync_error: 'Unable to read Shopify POS inventory' };
      hydrated.push({ ...merged, status: deriveInventoryStatus(merged) });
      warnings.push(`shopify_inventory_read_failed:${item.id}`);
    }
  }
  return { items: hydrated, providerCalls, warnings };
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
    const shopifyInventoryResponse = await handleShopifyInventoryOperation({ base44, user, body });
    if (shopifyInventoryResponse) return shopifyInventoryResponse;
    const nativeData = await loadNativeInventorySummary(base44, { status, category, search, limit });
    const inventoryMigrationRequested = INVENTORY_MIGRATION_OPERATIONS.has(normalizeLower(body.operation));

    if (!inventoryMigrationRequested) {
      if (!nativeData.source_available) {
        return Response.json({ error: 'Unable to load Customer App inventory records' }, { status: 503 });
      }
      const nativeItemsBeforeProviderRead = nativeData.items.filter(item => item.stock_tracking_policy === 'stock_tracked');
      const hydratedShopify = await hydrateShopifyBagItems(nativeItemsBeforeProviderRead);
      const nativeItems = hydratedShopify.items;
      const nativeProcurementPlan = procurementPlanFromItems(nativeItems, nativeData.open_purchase_orders);
      const productOptions = await loadInventoryProductOptions(base44);
      return Response.json({
        success: true,
        source: 'customer_app_native_inventory_authoritative',
        summary: summaryFromItems(nativeItems, nativeProcurementPlan, nativeData.open_purchase_orders),
        count: nativeItems.length,
        truncated: false,
        items: nativeItems,
        product_options: productOptions,
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
          opening_count_workflow_enabled: true,
          label_inventory_enabled: true,
          bag_inventory_enabled: true,
          shopify_pos_bag_inventory_enabled: true,
          shopify_pos_synced_bag_count: nativeItems.filter(item => item.inventory_kind === 'bag' && item.shopify_sync_enabled === true).length,
          inventory_deduction_enabled: false,
          purchase_order_automation_enabled: false,
        },
        warnings: hydratedShopify.warnings,
        writes_performed: false,
        provider_calls_performed: hydratedShopify.providerCalls > 0,
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
