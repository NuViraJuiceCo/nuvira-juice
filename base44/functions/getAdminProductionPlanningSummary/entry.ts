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
  };
}

function sanitizeProductGroup(group) {
  return {
    product_name: sanitizeText(group?.product_name),
    product_category: sanitizeText(group?.product_category, 80),
    planned_units: numberOrZero(group?.planned_units),
    produced_units: numberOrZero(group?.produced_units),
    batch_count: numberOrZero(group?.batch_count),
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

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub production planning service is not configured' }, { status: 503 });
    }

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
      return Response.json({
        error: 'Unable to load production planning summary',
        hub_status: hubResponse.status,
      }, { status: hubResponse.status >= 400 && hubResponse.status < 500 ? hubResponse.status : 502 });
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (
      !hubData ||
      hubData.success !== true ||
      !hubData.summary ||
      !Array.isArray(hubData.dates) ||
      !Array.isArray(hubData.ingredients)
    ) {
      return Response.json({ error: 'Malformed production planning summary response' }, { status: 502 });
    }

    return Response.json({
      success: true,
      date_from: hubData.date_from || dateFrom || null,
      date_to: hubData.date_to || dateTo || null,
      generated_at: hubData.generated_at || null,
      summary: sanitizeSummary(hubData.summary),
      dates: hubData.dates.map(sanitizeDateGroup).slice(0, 31),
      ingredients: hubData.ingredients.map(sanitizeIngredient).slice(0, 200),
      truncated: hubData.truncated === true,
    });
  } catch (error) {
    console.error('[getAdminProductionPlanningSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load production planning summary' }, { status: 500 });
  }
});
