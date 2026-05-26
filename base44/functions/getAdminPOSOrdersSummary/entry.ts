import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_RANGE_DAYS = 31;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function normalizeText(value) {
  return (value || '').toString().trim();
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

function normalizePreset(value) {
  const preset = normalizeText(value).toLowerCase();
  if (!preset) return 'last_7_days';
  if (!['today', 'last_7_days', 'last_30_days', 'custom'].includes(preset)) {
    throw new Error('preset must be one of today, last_7_days, last_30_days, custom');
  }
  return preset;
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

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeString(value, maxLength = 160) {
  const text = normalizeText(value);
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function sanitizeLineItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 20).map(item => ({
    title: safeString(item?.title, 80),
    variant_title: safeString(item?.variant_title, 80),
    sku: safeString(item?.sku, 40),
    quantity: safeNumber(item?.quantity),
    price: item?.price === null || item?.price === undefined ? null : safeNumber(item.price),
  })).filter(item => item.title || item.quantity);
}

function sanitizeOrder(order) {
  return {
    id: safeString(order?.id, 80),
    order_number: safeString(order?.order_number, 80),
    customer_name: safeString(order?.customer_name, 80),
    customer_email: safeString(order?.customer_email, 120),
    total_price: order?.total_price === null || order?.total_price === undefined ? null : safeNumber(order.total_price),
    subtotal: order?.subtotal === null || order?.subtotal === undefined ? null : safeNumber(order.subtotal),
    payment_status: safeString(order?.payment_status, 40),
    fulfillment_status: safeString(order?.fulfillment_status, 40),
    production_status: safeString(order?.production_status, 40),
    order_lock_status: safeString(order?.order_lock_status, 40),
    source_channel: safeString(order?.source_channel, 40),
    source_type: safeString(order?.source_type, 40),
    order_type: safeString(order?.order_type, 40),
    fulfillment_method: safeString(order?.fulfillment_method, 40),
    customer_order_date: safeString(order?.customer_order_date, 40),
    created_date: safeString(order?.created_date, 40),
    location_label: safeString(order?.location_label, 80),
    tags: Array.isArray(order?.tags) ? order.tags.map(tag => safeString(tag, 40)).filter(Boolean).slice(0, 12) : [],
    line_items: sanitizeLineItems(order?.line_items),
    item_count: safeNumber(order?.item_count),
    internal_note_summary: safeString(order?.internal_note_summary, 160),
    requires_delivery: order?.requires_delivery === true,
    requires_production: order?.requires_production === true,
    requires_fulfillment_task: order?.requires_fulfillment_task === true,
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

    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const body = await req.json().catch(() => ({}));
    let preset;
    let dateFrom;
    let dateTo;
    let limit;

    try {
      preset = normalizePreset(body.preset);
      dateFrom = parseIsoDate(body.date_from, 'date_from');
      dateTo = parseIsoDate(body.date_to, 'date_to');
      limit = normalizeLimit(body.limit);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    if (preset === 'custom') {
      if (!dateFrom || !dateTo) {
        return Response.json({ error: 'date_from and date_to are required for custom range' }, { status: 400 });
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
    } else {
      dateFrom = null;
      dateTo = null;
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub POS order service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const params = new URLSearchParams({ limit: limit.toString() });
    if (preset === 'custom') {
      params.set('date_from', dateFrom);
      params.set('date_to', dateTo);
    } else {
      params.set('preset', preset);
    }

    const hubResponse = await fetch(`${hubBase}/functions/getPOSOrdersForCustomerApp?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
    });

    if (!hubResponse.ok) {
      return Response.json({
        error: 'Unable to load POS orders summary',
        hub_status: hubResponse.status,
      }, { status: hubResponse.status >= 400 && hubResponse.status < 500 ? hubResponse.status : 502 });
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubData || hubData.success !== true || !Array.isArray(hubData.orders)) {
      return Response.json({ error: 'Malformed POS orders summary response' }, { status: 502 });
    }

    return Response.json({
      success: true,
      source: 'customer_app_admin_pos_orders_summary',
      generated_at: hubData.generated_at || null,
      date_from: hubData.date_from || dateFrom,
      date_to: hubData.date_to || dateTo,
      summary: {
        total: safeNumber(hubData.summary?.total),
        shown: safeNumber(hubData.summary?.shown),
        paid: safeNumber(hubData.summary?.paid),
        fulfilled: safeNumber(hubData.summary?.fulfilled),
        production_not_required: safeNumber(hubData.summary?.production_not_required),
        requires_delivery: safeNumber(hubData.summary?.requires_delivery),
        requires_production: safeNumber(hubData.summary?.requires_production),
        requires_fulfillment_task: safeNumber(hubData.summary?.requires_fulfillment_task),
      },
      count: safeNumber(hubData.count),
      truncated: hubData.truncated === true,
      orders: hubData.orders.map(sanitizeOrder),
    });
  } catch (error) {
    console.error('[getAdminPOSOrdersSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load POS orders summary' }, { status: 500 });
  }
});
