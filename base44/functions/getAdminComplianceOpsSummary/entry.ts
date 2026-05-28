import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_RANGE_DAYS = 31;
const DEFAULT_RANGE_DAYS_BACK = 6;
const CHICAGO_TZ = 'America/Chicago';

function normalizeText(value) {
  return (value || '').toString().trim();
}

function sanitizeText(value, maxLength = 160) {
  const text = normalizeText(value)
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');

  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
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
  if (date.toISOString().slice(0, 10) !== text) {
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

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeBoolean(value) {
  return value === true;
}

function safeStringArray(value, maxItems = 30) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map(item => sanitizeText(item, 120)).filter(Boolean);
}

function safeObjectNumberMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 40)
      .map(([key, count]) => [sanitizeText(key, 80), safeNumber(count)])
      .filter(([key]) => Boolean(key))
  );
}

function sanitizeLog(log) {
  return {
    id: sanitizeText(log?.id, 140) || null,
    type: sanitizeText(log?.type, 80) || null,
    date: sanitizeText(log?.date, 40) || null,
    time: sanitizeText(log?.time, 40) || null,
    status: sanitizeText(log?.status, 80) || null,
    staff_member: sanitizeText(log?.staff_member, 100) || null,
    batch_id: sanitizeText(log?.batch_id, 120) || null,
    product_name: sanitizeText(log?.product_name, 120) || null,
    location: sanitizeText(log?.location, 120) || null,
    value: typeof log?.value === 'number' || typeof log?.value === 'string' ? log.value : null,
    within_range: typeof log?.within_range === 'boolean' ? log.within_range : null,
    updated_date: sanitizeText(log?.updated_date, 80) || null,
  };
}

function sanitizeBatch(batch) {
  return {
    id: sanitizeText(batch?.id, 140) || null,
    batch_id: sanitizeText(batch?.batch_id, 120) || null,
    product_name: sanitizeText(batch?.product_name, 120) || null,
    production_date: sanitizeText(batch?.production_date, 40) || null,
    status: sanitizeText(batch?.status, 80) || null,
    compliance_log_id_present: safeBoolean(batch?.compliance_log_id_present),
    corrective_action_required: safeBoolean(batch?.corrective_action_required),
    corrective_action_log_id_present: safeBoolean(batch?.corrective_action_log_id_present),
    is_locked: safeBoolean(batch?.is_locked),
  };
}

function sanitizeHubResponse(data, fallbackDateFrom, fallbackDateTo) {
  return {
    success: data?.success === true,
    dry_run: data?.dry_run === true,
    read_only: data?.read_only === true,
    date_from: sanitizeText(data?.date_from, 40) || fallbackDateFrom,
    date_to: sanitizeText(data?.date_to, 40) || fallbackDateTo,
    generated_at: sanitizeText(data?.generated_at, 80) || null,
    summary: safeObjectNumberMap(data?.summary),
    issues: safeObjectNumberMap(data?.issues),
    recent_logs: Array.isArray(data?.recent_logs) ? data.recent_logs.slice(0, 60).map(sanitizeLog) : [],
    batch_compliance: Array.isArray(data?.batch_compliance) ? data.batch_compliance.slice(0, 60).map(sanitizeLog) : [],
    attention_batches: Array.isArray(data?.attention_batches) ? data.attention_batches.slice(0, 60).map(sanitizeBatch) : [],
    warnings: safeStringArray(data?.warnings),
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

    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

    const body = await req.json().catch(() => ({}));
    let dateFrom;
    let dateTo;
    try {
      dateFrom = parseIsoDate(body.date_from, 'date_from');
      dateTo = parseIsoDate(body.date_to, 'date_to');
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const today = todayChicagoDate();
    if (!dateFrom && !dateTo) {
      dateTo = today;
      dateFrom = addDays(today, -DEFAULT_RANGE_DAYS_BACK);
    } else if (dateFrom && !dateTo) {
      dateTo = addDays(dateFrom, DEFAULT_RANGE_DAYS_BACK);
    } else if (!dateFrom && dateTo) {
      dateFrom = addDays(dateTo, -DEFAULT_RANGE_DAYS_BACK);
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
      return Response.json({
        error: 'Hub compliance ops summary service is not configured',
        error_code: 'hub_not_configured',
      }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const params = new URLSearchParams({
      date_from: dateFrom,
      date_to: dateTo,
    });

    const hubResponse = await fetch(`${hubBase}/functions/getComplianceOpsSummaryForCustomerApp?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
    });

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubResponse.ok) {
      return Response.json({
        error: sanitizeText(hubData?.error, 160) || 'Unable to load Hub compliance ops summary',
        hub_status: hubResponse.status,
      }, { status: hubResponse.status >= 400 && hubResponse.status < 500 ? hubResponse.status : 502 });
    }

    return Response.json(sanitizeHubResponse(hubData, dateFrom, dateTo));
  } catch (error) {
    console.error('[getAdminComplianceOpsSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load compliance ops summary' }, { status: 500 });
  }
});
