import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;
const VALID_STATUSES = new Set(['ok', 'low', 'critical', 'out_of_stock']);

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
    throw new Error('status must be one of ok, low, critical, out_of_stock');
  }
  return status;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeSummary(summary) {
  return {
    total_items: Number(summary?.total_items) || 0,
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

function deriveInventoryStatus(item) {
  const stock = Number(item.stock);
  const reorderPoint = Number(item.reorder_point);
  if (!Number.isFinite(stock)) return null;
  if (stock <= 0) return 'out_of_stock';
  if (Number.isFinite(reorderPoint) && stock <= reorderPoint * 0.5) return 'critical';
  if (Number.isFinite(reorderPoint) && stock <= reorderPoint) return 'low';
  return 'ok';
}

function sanitizeItem(item) {
  const status = normalizeText(item.status).toLowerCase();
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
    status: VALID_STATUSES.has(status) ? status : null,
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
  return {
    inventory_item_id: item.inventory_item_id || null,
    ingredient: item.ingredient || null,
    category: item.category || null,
    supplier: item.supplier || null,
    status: VALID_STATUSES.has(normalizeText(item.status).toLowerCase()) ? normalizeText(item.status).toLowerCase() : null,
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
    source: item.source || null,
  };
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
  const nativeItems = await base44.asServiceRole.entities.InventoryItem.list('ingredient', 500).catch(() => []);
  const nativePurchaseOrders = await base44.asServiceRole.entities.PurchaseOrder.list('-order_date', 200).catch(() => []);
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
    .filter(item => item.status && item.status !== 'ok')
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

  const categoryCount = new Set(items.map(item => item.category).filter(Boolean)).size;
  const supplierCount = new Set(procurementPlan.map(item => item.supplier).filter(Boolean)).size;
  const summary = sanitizeSummary({
    total_items: items.length,
    low_stock_count: items.filter(item => item.status === 'low').length,
    critical_count: items.filter(item => item.status === 'critical').length,
    out_of_stock_count: items.filter(item => item.status === 'out_of_stock').length,
    category_count: categoryCount,
    procurement_item_count: procurementPlan.length,
    procurement_supplier_count: supplierCount,
    open_purchase_order_count: openPurchaseOrders.length,
    net_procurement_item_count: procurementPlan.filter(item => Number(item.net_suggested_quantity || 0) > 0).length,
  });

  return {
    summary,
    items: items.slice(0, limit),
    procurement_plan: procurementPlan.slice(0, 100),
    open_purchase_orders: openPurchaseOrders,
    source_available: nativeItems.length > 0 || nativePurchaseOrders.length > 0,
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

    const body = await req.json().catch(() => ({}));
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
    const nativeData = await loadNativeInventorySummary(base44, { status, category, search, limit });

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
      if (status) params.set('status', status);
      if (search) params.set('search', search);

      const hubResponse = await fetch(`${hubBase}/functions/getInventoryStatusSummaryForCustomerApp?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
        },
      });

      if (!hubResponse.ok) {
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

    const hubItems = hubData ? hubData.items.map(item => sanitizeItem({ ...item, source: 'hub' })) : [];
    const hubItemKeys = new Set(hubItems.map(item => normalizeMatchKey(item.ingredient)).filter(Boolean));
    const nativeOnlyItems = nativeData.items.filter(item => !hubItemKeys.has(normalizeMatchKey(item.ingredient)));
    const sanitizedItems = [...hubItems, ...nativeOnlyItems].slice(0, limit);
    const procurementPlan = [
      ...(hubData && Array.isArray(hubData.procurement_plan)
        ? hubData.procurement_plan.slice(0, 100).map(item => sanitizeProcurementPlanItem({ ...item, source: 'hub' })).filter(Boolean)
        : []),
      ...nativeData.procurement_plan.filter(item => !hubItemKeys.has(normalizeMatchKey(item.ingredient))),
    ].slice(0, 100);
    const openPurchaseOrders = [
      ...(hubData && Array.isArray(hubData.open_purchase_orders)
        ? hubData.open_purchase_orders.slice(0, 50).map(po => sanitizePurchaseOrder({ ...po, source: 'hub' })).filter(Boolean)
        : []),
      ...nativeData.open_purchase_orders,
    ].slice(0, 50);
    const truncated = hubData?.truncated === true || sanitizedItems.length < (hubData?.items?.length || 0);

    if (!hubData && !nativeData.source_available) {
      return Response.json({
        error: 'Unable to load inventory status summary',
        warning: hubWarning,
      }, { status: 503 });
    }

    return Response.json({
      success: true,
      summary: mergeSummary(hubData?.summary, nativeData.summary),
      count: sanitizedItems.length,
      truncated,
      items: sanitizedItems,
      procurement_plan: procurementPlan,
      open_purchase_orders: openPurchaseOrders,
      data_sources: {
        hub_available: Boolean(hubData),
        native_available: nativeData.source_available,
        native_read_only: true,
        inventory_deduction_enabled: false,
        purchase_order_automation_enabled: false,
      },
      warnings: [hubWarning].filter(Boolean),
    });
  } catch (error) {
    console.error('[getAdminInventoryStatusSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load inventory status summary' }, { status: 500 });
  }
});
