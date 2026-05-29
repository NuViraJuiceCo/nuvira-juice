import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_RANGE_DAYS = 31;
const DEFAULT_LIMIT = 150;
const MAX_LIMIT = 250;
const VALID_PRESETS = new Set(['current_month', 'next_30_days', 'today']);
const VALID_TYPES = new Set(['event', 'production', 'delivery', 'compliance']);

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

function normalizeLimit(value) {
  const text = normalizeText(value);
  if (!text) return DEFAULT_LIMIT;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('limit must be a positive integer');
  }
  return Math.min(parsed, MAX_LIMIT);
}

function normalizeType(value) {
  const type = normalizeLower(value);
  if (!type) return '';
  if (!VALID_TYPES.has(type)) {
    throw new Error('type must be one of event, production, delivery, compliance');
  }
  return type;
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
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'\-\s]{2,}\s+(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|way|ct|court|pl|place)\b/gi, '[redacted]')
    .replace(/\b(?:bearer|authorization|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi, '[redacted]');
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function sanitizeDate(value) {
  return normalizeText(value) || null;
}

function sanitizeCounts(group, maxKeys = 20) {
  if (!group || typeof group !== 'object' || Array.isArray(group)) return {};
  const result = {};
  for (const [key, value] of Object.entries(group).slice(0, maxKeys)) {
    const safeKey = sanitizeText(key, 50);
    if (safeKey) {
      result[safeKey] = numberOrZero(value);
    }
  }
  return result;
}

function sanitizeSummary(summary) {
  return {
    total_items: numberOrZero(summary?.total_items),
    events: numberOrZero(summary?.events),
    production_days: numberOrZero(summary?.production_days),
    delivery_days: numberOrZero(summary?.delivery_days),
    compliance_items: numberOrZero(summary?.compliance_items),
  };
}

function sanitizeEventItem(item) {
  return {
    id: sanitizeText(item?.id, 80),
    type: 'event',
    title: sanitizeText(item?.title, 140) || 'Event',
    event_type: sanitizeText(item?.event_type, 60),
    status: sanitizeText(item?.status, 60),
    start_datetime: sanitizeDate(item?.start_datetime),
    end_datetime: sanitizeDate(item?.end_datetime),
    location: sanitizeText(item?.location, 120),
    summary: sanitizeText(item?.summary, 160),
  };
}

function sanitizeProductionItem(item) {
  return {
    type: 'production',
    production_date: sanitizeDate(item?.production_date),
    batch_count: numberOrZero(item?.batch_count),
    product_count: numberOrZero(item?.product_count),
    planned_units: numberOrZero(item?.planned_units),
    status_counts: sanitizeCounts(item?.status_counts),
  };
}

function sanitizeDeliveryItem(item) {
  return {
    type: 'delivery',
    delivery_date: sanitizeDate(item?.delivery_date),
    stop_count: numberOrZero(item?.stop_count),
    completed_count: numberOrZero(item?.completed_count),
    pending_count: numberOrZero(item?.pending_count),
    source_type_counts: sanitizeCounts(item?.source_type_counts),
  };
}

function sanitizeCalendarItem(item) {
  const type = normalizeLower(item?.type);
  if (type === 'event') return sanitizeEventItem(item);
  if (type === 'production') return sanitizeProductionItem(item);
  if (type === 'delivery') return sanitizeDeliveryItem(item);
  return null;
}

function sanitizeDateGroup(group) {
  const items = Array.isArray(group?.items)
    ? group.items.map(sanitizeCalendarItem).filter(Boolean).slice(0, MAX_LIMIT)
    : [];

  return {
    date: sanitizeDate(group?.date),
    counts: {
      events: numberOrZero(group?.counts?.events),
      production: numberOrZero(group?.counts?.production),
      delivery: numberOrZero(group?.counts?.delivery),
      compliance: numberOrZero(group?.counts?.compliance),
    },
    items,
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
    let type;
    let limit;

    try {
      dateFrom = parseIsoDate(body.date_from, 'date_from');
      dateTo = parseIsoDate(body.date_to, 'date_to');
      const requestedPreset = normalizeLower(body.preset);
      preset = requestedPreset || ((dateFrom || dateTo) ? 'custom' : 'current_month');

      if (preset !== 'custom' && !VALID_PRESETS.has(preset)) {
        throw new Error('preset must be one of current_month, next_30_days, today');
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

      type = normalizeType(body.type);
      limit = normalizeLimit(body.limit);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const status = sanitizeText(body.status, 60) || '';
    const search = sanitizeText(body.search, 80) || '';

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub calendar service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const params = new URLSearchParams({
      limit: limit.toString(),
    });
    if (preset === 'custom') {
      params.set('date_from', dateFrom);
      params.set('date_to', dateTo);
    } else {
      params.set('preset', preset);
    }
    if (type) params.set('type', type);
    if (status) params.set('status', status);
    if (search) params.set('search', search);

    const hubResponse = await fetch(`${hubBase}/functions/getCalendarEventsSummaryForCustomerApp?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
    });

    if (!hubResponse.ok) {
      return Response.json({
        error: 'Unable to load calendar summary',
        hub_status: hubResponse.status,
      }, { status: hubResponse.status >= 400 && hubResponse.status < 500 ? hubResponse.status : 502 });
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (
      !hubData ||
      hubData.success !== true ||
      !hubData.summary ||
      !Array.isArray(hubData.dates)
    ) {
      return Response.json({ error: 'Malformed calendar summary response' }, { status: 502 });
    }

    return Response.json({
      success: true,
      date_from: hubData.date_from || dateFrom || null,
      date_to: hubData.date_to || dateTo || null,
      generated_at: hubData.generated_at || null,
      summary: sanitizeSummary(hubData.summary),
      dates: hubData.dates.map(sanitizeDateGroup).slice(0, MAX_RANGE_DAYS),
      truncated: hubData.truncated === true,
    });
  } catch (error) {
    console.error('[getAdminCalendarEventsSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load calendar summary' }, { status: 500 });
  }
});
