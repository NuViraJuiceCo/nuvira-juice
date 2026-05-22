import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_RANGE_DAYS = 31;
const DEFAULT_RANGE_DAYS_AHEAD = 14;
const MAX_LIMIT = 100;
const CHICAGO_TZ = 'America/Chicago';

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

function sanitizeBatch(batch) {
  return {
    id: batch.id || null,
    batch_id: batch.batch_id || null,
    production_date: batch.production_date || null,
    product_name: batch.product_name || null,
    product_category: batch.product_category || null,
    status: batch.status || null,
    planned_units: batch.planned_units ?? null,
    actual_units: batch.actual_units ?? null,
    is_locked: batch.is_locked === true,
    order_count: Number(batch.order_count) || 0,
    order_numbers: Array.isArray(batch.order_numbers)
      ? batch.order_numbers.map(value => value?.toString().trim()).filter(Boolean)
      : [],
    source_type_counts: sanitizeSourceTypeCounts(batch.source_type_counts),
    updated_date: batch.updated_date || null,
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
    let limit;

    try {
      dateFrom = parseIsoDate(body.date_from, 'date_from');
      dateTo = parseIsoDate(body.date_to, 'date_to');
      limit = normalizeLimit(body.limit);
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

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub production queue service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const params = new URLSearchParams({
      date_from: dateFrom,
      date_to: dateTo,
    });
    if (limit) params.set('limit', limit.toString());

    const hubResponse = await fetch(`${hubBase}/functions/getProductionQueueSummaryForCustomerApp?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
    });

    if (!hubResponse.ok) {
      return Response.json({
        error: 'Unable to load production queue summary',
        hub_status: hubResponse.status,
      }, { status: hubResponse.status >= 400 && hubResponse.status < 500 ? hubResponse.status : 502 });
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubData || hubData.success !== true || !Array.isArray(hubData.batches)) {
      return Response.json({ error: 'Malformed production queue summary response' }, { status: 502 });
    }

    const sanitizedBatches = hubData.batches.map(sanitizeBatch);
    const batches = limit ? sanitizedBatches.slice(0, limit) : sanitizedBatches;
    const truncated = hubData.truncated === true || batches.length < sanitizedBatches.length;

    return Response.json({
      success: true,
      date_from: hubData.date_from || dateFrom,
      date_to: hubData.date_to || dateTo,
      count: batches.length,
      truncated,
      batches,
    });
  } catch (error) {
    console.error('[getAdminProductionQueueSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load production queue summary' }, { status: 500 });
  }
});
