import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_RANGE_DAYS = 31;
const VALID_PRESETS = new Set(['today', 'last_7_days', 'last_30_days']);
const CHICAGO_TZ = 'America/Chicago';

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

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function resolveDateRange({ preset, dateFrom, dateTo }) {
  if (preset === 'custom') {
    return { date_from: dateFrom, date_to: dateTo };
  }

  const today = todayChicagoDate();
  if (preset === 'today') {
    return { date_from: today, date_to: today };
  }
  if (preset === 'last_30_days') {
    return { date_from: addDays(today, -29), date_to: today };
  }
  return { date_from: addDays(today, -6), date_to: today };
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizeCountGroup(group, keys) {
  const result = {};
  for (const key of keys) {
    result[key] = numberOrZero(group?.[key]);
  }
  return result;
}

function sanitizeSummary(summary) {
  return {
    orders: sanitizeCountGroup(summary?.orders, ['total', 'paid', 'fulfilled', 'delivered']),
    production: sanitizeCountGroup(summary?.production, ['batch_count', 'planned_units', 'produced_units']),
    delivery: sanitizeCountGroup(summary?.delivery, ['today_stops', 'tomorrow_stops', 'completed_in_range']),
    inventory: sanitizeCountGroup(summary?.inventory, ['low', 'critical', 'out_of_stock']),
    alerts: sanitizeCountGroup(summary?.alerts, ['active', 'critical', 'warning', 'info']),
    source_mix: sanitizeCountGroup(summary?.source_mix, ['one_time', 'subscription', 'pos', 'other']),
  };
}

function dateKey(value) {
  const text = normalizeText(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function inRange(value, from, to) {
  const key = dateKey(value);
  return key && key >= from && key <= to;
}

function normalizeOrderNumber(value) {
  return normalizeLower(value).replace(/^#/, '');
}

function normalizeStatus(value) {
  return normalizeLower(value).replace(/\s+/g, '_');
}

function uniqueByOrderNumber(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizeOrderNumber(row?.order_number || row?.shopify_order_number || row?.id);
    if (key && !map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

function orderReferenceDate(order) {
  return (
    order?.customer_order_date ||
    order?.created_date ||
    order?.shopify_synced_at ||
    order?.updated_date ||
    order?.estimated_delivery_date ||
    order?.assigned_delivery_date ||
    null
  );
}

function orderMatchesSource(order, sourceType, sourceChannel) {
  if (!sourceType && !sourceChannel) return true;
  const type = normalizeLower(order?.source_type || order?.order_type || order?.fulfillment_type);
  const channel = normalizeLower(order?.source_channel || (order?.is_pos_order ? 'pos' : ''));
  if (sourceType && type !== normalizeLower(sourceType)) return false;
  if (sourceChannel && channel !== normalizeLower(sourceChannel)) return false;
  return true;
}

function isPaidOrder(order) {
  const paymentStatus = normalizeStatus(order?.payment_status || order?.financial_status);
  return order?.payment_captured === true || ['paid', 'captured', 'succeeded'].includes(paymentStatus);
}

function isFulfilledOrder(order) {
  const statuses = [
    order?.status,
    order?.fulfillment_status,
    order?.production_status,
    order?.delivery_status,
  ].map(normalizeStatus);
  return statuses.some(status => [
    'fulfilled',
    'delivered',
    'picked_up',
  ].includes(status));
}

function isDeliveredOrder(order) {
  const statuses = [
    order?.status,
    order?.fulfillment_status,
    order?.delivery_status,
    order?.production_status,
  ].map(normalizeStatus);
  return Boolean(order?.delivered_at) || statuses.some(status => ['delivered', 'picked_up', 'fulfilled'].includes(status));
}

function classifyOrderSource(order) {
  const sourceChannel = normalizeLower(order?.source_channel);
  const sourceType = normalizeLower(order?.source_type || order?.order_type || order?.fulfillment_type);
  const fulfillmentMethod = normalizeLower(order?.fulfillment_method);
  if (order?.is_pos_order === true || sourceChannel === 'pos' || sourceType === 'pos' || fulfillmentMethod === 'pos') return 'pos';
  if (order?.is_subscription === true || order?.stripe_subscription_id || sourceChannel === 'subscription' || sourceType === 'subscription') return 'subscription';
  if (sourceChannel || sourceType || Array.isArray(order?.line_items) || Array.isArray(order?.items)) return 'one_time';
  return 'other';
}

function taskDate(task) {
  return task?.delivery_date || task?.scheduled_date || task?.assigned_delivery_date || null;
}

function isCompletedTask(task) {
  return ['delivered', 'picked_up', 'fulfilled', 'completed'].includes(normalizeStatus(task?.status || task?.delivery_status));
}

function alertDate(row) {
  return row?.last_seen_at || row?.created_date || row?.updated_date || null;
}

function isActiveAlert(row) {
  return !['resolved', 'archived', 'closed', 'dismissed'].includes(normalizeStatus(row?.status));
}

function alertSeverity(row) {
  return normalizeStatus(row?.severity || row?.priority || row?.level || row?.incident_type);
}

function inventoryStatus(item) {
  const stock = Number(item?.stock);
  const reorderPoint = Number(item?.reorder_point);
  if (!Number.isFinite(stock)) return 'unknown';
  if (stock <= 0) return 'out_of_stock';
  if (Number.isFinite(reorderPoint) && reorderPoint > 0 && stock <= reorderPoint * 0.5) return 'critical';
  if (Number.isFinite(reorderPoint) && reorderPoint > 0 && stock <= reorderPoint) return 'low';
  return 'ok';
}

async function listEntity(base44, entityName, sort, limit = 500) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity || typeof entity.list !== 'function') return [];
  return await entity.list(sort, limit).catch(error => {
    console.warn(`[getAdminOperationsDashboardSummary] Native ${entityName} unavailable:`, error.message);
    return [];
  });
}

async function loadNativeOperationsDashboardSummary(base44, { dateFrom, dateTo, sourceType, sourceChannel }) {
  const [
    customerOrders,
    shopifyOrders,
    productionBatches,
    fulfillmentTasks,
    inventoryItems,
    reviewQueueItems,
    operationalAlerts,
    complianceAlerts,
  ] = await Promise.all([
    listEntity(base44, 'Order', '-created_date'),
    listEntity(base44, 'ShopifyOrder', '-created_date'),
    listEntity(base44, 'ProductionBatch', '-production_date'),
    listEntity(base44, 'FulfillmentTask', '-delivery_date'),
    listEntity(base44, 'InventoryItem', 'ingredient'),
    listEntity(base44, 'OrderReviewQueue', '-created_date'),
    listEntity(base44, 'OperationalAlert', '-created_date'),
    listEntity(base44, 'ComplianceAlert', '-created_date'),
  ]);

  const orders = uniqueByOrderNumber([
    ...customerOrders
      .filter(order => inRange(orderReferenceDate(order), dateFrom, dateTo))
      .filter(order => orderMatchesSource(order, sourceType, sourceChannel)),
    ...shopifyOrders
      .filter(order => inRange(orderReferenceDate(order), dateFrom, dateTo))
      .filter(order => orderMatchesSource(order, sourceType, sourceChannel))
      .map(order => ({
        ...order,
        order_number: order.shopify_order_number || order.order_number,
      })),
  ]);

  const batches = productionBatches.filter(batch => inRange(batch.production_date, dateFrom, dateTo));
  const today = todayChicagoDate();
  const tomorrow = addDays(today, 1);
  const deliveryTasks = fulfillmentTasks.filter(task => {
    const source = normalizeLower(task.source_type || task.source_channel);
    return source !== 'pos' && normalizeLower(task.fulfillment_type) !== 'event_pos';
  });
  const alerts = [
    ...reviewQueueItems.map(item => ({ ...item, severity: item.incident_type || 'warning' })),
    ...operationalAlerts,
    ...complianceAlerts,
  ].filter(alert => inRange(alertDate(alert), dateFrom, dateTo)).filter(isActiveAlert);

  const inventoryCounts = { low: 0, critical: 0, out_of_stock: 0 };
  for (const item of inventoryItems) {
    const status = inventoryStatus(item);
    if (status === 'low') inventoryCounts.low += 1;
    if (status === 'critical') inventoryCounts.critical += 1;
    if (status === 'out_of_stock') inventoryCounts.out_of_stock += 1;
  }

  const sourceMix = { one_time: 0, subscription: 0, pos: 0, other: 0 };
  for (const order of orders) {
    const source = classifyOrderSource(order);
    sourceMix[source] = (sourceMix[source] || 0) + 1;
  }

  return sanitizeSummary({
    orders: {
      total: orders.length,
      paid: orders.filter(isPaidOrder).length,
      fulfilled: orders.filter(isFulfilledOrder).length,
      delivered: orders.filter(isDeliveredOrder).length,
    },
    production: {
      batch_count: batches.length,
      planned_units: batches.reduce((sum, batch) => sum + numberOrZero(batch.planned_units), 0),
      produced_units: batches.reduce((sum, batch) => sum + numberOrZero(batch.actual_units || batch.final_usable_quantity || batch.bottles_produced), 0),
    },
    delivery: {
      today_stops: deliveryTasks.filter(task => dateKey(taskDate(task)) === today).length,
      tomorrow_stops: deliveryTasks.filter(task => dateKey(taskDate(task)) === tomorrow).length,
      completed_in_range: deliveryTasks.filter(task => inRange(task.delivered_at || taskDate(task), dateFrom, dateTo) && isCompletedTask(task)).length,
    },
    inventory: inventoryCounts,
    alerts: {
      active: alerts.length,
      critical: alerts.filter(alert => ['critical', 'error', 'failed', 'failure'].includes(alertSeverity(alert))).length,
      warning: alerts.filter(alert => ['warning', 'needs_review', 'incomplete_address', 'low_quality_order'].includes(alertSeverity(alert))).length,
      info: alerts.filter(alert => ['info', 'notice'].includes(alertSeverity(alert))).length,
    },
    source_mix: sourceMix,
  });
}

function nativeFallbackResponse({ dateFrom, dateTo, summary, reason, hubStatus = null }) {
  return Response.json({
    success: true,
    source: 'customer_app_native_operations_dashboard_fallback',
    generated_at: new Date().toISOString(),
    date_from: dateFrom,
    date_to: dateTo,
    summary,
    truncated: false,
    warnings: [
      hubStatus
        ? `hub_operations_dashboard_unavailable:${hubStatus}`
        : `hub_operations_dashboard_unavailable:${reason}`,
      'native_read_only_fallback',
    ],
    data_sources: {
      hub_available: false,
      native_available: true,
      native_read_only: true,
    },
  });
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
      preset = requestedPreset || ((dateFrom || dateTo) ? 'custom' : 'last_7_days');

      if (preset !== 'custom' && !VALID_PRESETS.has(preset)) {
        throw new Error('preset must be one of today, last_7_days, last_30_days');
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

    const sourceType = normalizeText(body.source_type);
    const sourceChannel = normalizeText(body.source_channel);
    const resolvedRange = resolveDateRange({ preset, dateFrom, dateTo });
    const loadNativeSummary = () => loadNativeOperationsDashboardSummary(base44, {
      dateFrom: resolvedRange.date_from,
      dateTo: resolvedRange.date_to,
      sourceType,
      sourceChannel,
    });

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      const nativeSummary = await loadNativeSummary();
      return nativeFallbackResponse({
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        summary: nativeSummary,
        reason: 'missing_config',
      });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const params = new URLSearchParams();
    if (preset === 'custom') {
      params.set('date_from', dateFrom);
      params.set('date_to', dateTo);
    } else {
      params.set('preset', preset);
    }
    if (sourceType) params.set('source_type', sourceType);
    if (sourceChannel) params.set('source_channel', sourceChannel);

    let hubResponse;
    try {
      hubResponse = await fetch(`${hubBase}/functions/getOperationsDashboardSummaryForCustomerApp?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
        },
      });
    } catch (error) {
      console.warn('[getAdminOperationsDashboardSummary] Hub fetch failed; returning native fallback:', error.message);
      const nativeSummary = await loadNativeSummary();
      return nativeFallbackResponse({
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        summary: nativeSummary,
        reason: 'fetch_failed',
      });
    }

    if (!hubResponse.ok) {
      const nativeSummary = await loadNativeSummary();
      return nativeFallbackResponse({
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        summary: nativeSummary,
        reason: 'non_ok',
        hubStatus: hubResponse.status,
      });
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubData || hubData.success !== true || !hubData.summary) {
      const nativeSummary = await loadNativeSummary();
      return nativeFallbackResponse({
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        summary: nativeSummary,
        reason: 'malformed_response',
      });
    }

    return Response.json({
      success: true,
      source: hubData.source || 'hub_operations_dashboard_summary',
      generated_at: hubData.generated_at || null,
      date_from: hubData.date_from || dateFrom || null,
      date_to: hubData.date_to || dateTo || null,
      summary: sanitizeSummary(hubData.summary),
      truncated: hubData.truncated === true,
    });
  } catch (error) {
    console.error('[getAdminOperationsDashboardSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load operations dashboard summary' }, { status: 500 });
  }
});
