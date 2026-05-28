import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_RANGE_DAYS = 31;
const VALID_PRESETS = new Set(['today', 'this_week', 'next_7_days']);
const VALID_INGREDIENT_STATUSES = new Set(['covered', 'low', 'short', 'no_data']);

function normalizeText(value) {
  return (value || '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
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
    ingredient_count: numberOrZero(hubSummary?.ingredient_count),
    shortage_count: numberOrZero(hubSummary?.shortage_count),
    missing_recipe_count: numberOrZero(hubSummary?.missing_recipe_count),
    missing_yield_count: numberOrZero(hubSummary?.missing_yield_count),
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
    order?.customer_order_date ||
    order?.created_date,
  );
}

function safeLineItems(order) {
  return Array.isArray(order?.line_items)
    ? order.line_items.slice(0, 60)
    : [];
}

function isNativeMay30OperationalOrder(order) {
  const tags = Array.isArray(order?.tags) ? order.tags.map(normalizeLower) : [];
  const paymentStatus = normalizeLower(order?.payment_status || order?.financial_status);
  const orderType = normalizeLower(order?.order_type);
  const sourceChannel = normalizeLower(order?.source_channel);
  const fulfillmentMethod = normalizeLower(order?.fulfillment_method);
  const productionStatus = normalizeLower(order?.production_status);

  if (!tags.includes('may30_native_ops') && normalizeLower(order?.sync_status) !== 'native_may30_ready') return false;
  if (order?.excluded_from_production === true) return false;
  if (['canceled', 'cancelled', 'refunded'].includes(productionStatus)) return false;
  if (['refunded', 'partially_refunded'].includes(paymentStatus)) return false;
  if (paymentStatus && paymentStatus !== 'paid') return false;
  if (orderType === 'pos' || sourceChannel === 'pos' || fulfillmentMethod === 'pos') return false;
  if (orderType === 'subscription' || sourceChannel === 'subscription' || order?.stripe_subscription_id) return false;
  return safeLineItems(order).length > 0;
}

async function loadNativeMay30Planning(base44, dateFrom, dateTo) {
  const nativeOrders = await base44.asServiceRole.entities.ShopifyOrder
    .filter({ sync_status: 'native_may30_ready' }, '-customer_order_date', 500)
    .catch(() => []);

  const productByDate = new Map();
  const orderNumbersByDate = new Map();
  let skippedDateCount = 0;

  for (const order of nativeOrders) {
    if (!isNativeMay30OperationalOrder(order)) continue;

    const productionDate = orderPlanningDate(order);
    if (!isInRange(productionDate, dateFrom, dateTo)) {
      if (!productionDate) skippedDateCount += 1;
      continue;
    }

    const orderNumber = sanitizeText(order.shopify_order_number || order.order_number, 80);
    if (!productByDate.has(productionDate)) productByDate.set(productionDate, new Map());
    if (!orderNumbersByDate.has(productionDate)) orderNumbersByDate.set(productionDate, new Set());
    if (orderNumber) orderNumbersByDate.get(productionDate).add(orderNumber);

    const productMap = productByDate.get(productionDate);
    for (const item of safeLineItems(order)) {
      const productName = sanitizeText(item?.title || item?.name || item?.product_title, 120);
      if (!productName) continue;
      const key = normalizeLower(productName);
      const quantity = numberOrZero(item?.quantity);
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

  const dates = Array.from(productByDate.entries())
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

  return {
    summary: {
      production_date_count: dates.length,
      batch_count: 0,
      planned_units: plannedUnits,
      produced_units: 0,
      ingredient_count: 0,
      shortage_count: 0,
      missing_recipe_count: 0,
      missing_yield_count: 0,
      native_order_count: nativeOrderCount,
      skipped_missing_date_count: skippedDateCount,
    },
    dates,
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

    return Response.json({
      success: true,
      date_from: hubData.date_from || resolvedRange.dateFrom,
      date_to: hubData.date_to || resolvedRange.dateTo,
      generated_at: hubData.generated_at || new Date().toISOString(),
      summary: mergeSummaries(hubData.summary, nativePlanning.summary),
      dates: mergeDateGroups(hubData.dates, nativePlanning.dates).slice(0, 62),
      ingredients: hubData.ingredients.map(sanitizeIngredient).slice(0, 200),
      truncated: hubData.truncated === true,
      native_overlay: {
        source: 'customer_app_shopify_order_mirror',
        read_only: true,
        order_count: nativePlanning.summary.native_order_count,
        planned_units: nativePlanning.summary.planned_units,
        date_count: nativePlanning.summary.production_date_count,
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
