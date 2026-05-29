import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_RANGE_DAYS = 31;
const VALID_PRESETS = new Set(['today', 'last_7_days', 'last_30_days']);

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

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub operations dashboard service is not configured' }, { status: 503 });
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

    const hubResponse = await fetch(`${hubBase}/functions/getOperationsDashboardSummaryForCustomerApp?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
    });

    if (!hubResponse.ok) {
      return Response.json({
        error: 'Unable to load operations dashboard summary',
        hub_status: hubResponse.status,
      }, { status: hubResponse.status >= 400 && hubResponse.status < 500 ? hubResponse.status : 502 });
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubData || hubData.success !== true || !hubData.summary) {
      return Response.json({ error: 'Malformed operations dashboard summary response' }, { status: 502 });
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
