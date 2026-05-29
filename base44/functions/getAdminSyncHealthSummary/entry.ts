import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_RANGE_DAYS = 31;
const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 500;
const VALID_PRESETS = new Set(['today', 'last_7_days', 'last_30_days']);
const VALID_STATUSES = new Set([
  'success',
  'failed',
  'failure',
  'error',
  'pending',
  'stale',
  'skipped',
  'rejected',
]);

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

function normalizeStatus(value) {
  const status = normalizeLower(value);
  if (!status) return '';
  if (!VALID_STATUSES.has(status)) {
    throw new Error('status must be one of success, failed, pending, stale, skipped, rejected, error');
  }
  return status === 'failure' ? 'failed' : status;
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
    .replace(/\b(?:bearer|authorization|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi, '[redacted]')
    .replace(/\b(?:stripe|shopify)[-_a-z0-9]{8,}\b/gi, '[redacted]')
    .replace(/\b(?:ch|re|pi|cs|cus|sub|evt|in|pm|seti|si|src|tok|po|li)_[A-Za-z0-9]{8,}\b/g, '[redacted]')
    .replace(/\bgid:\/\/shopify\/[A-Za-z]+\/[A-Za-z0-9_-]+\b/g, '[redacted]');
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function sanitizeDate(value) {
  return normalizeText(value) || null;
}

function sanitizeSummary(summary) {
  return {
    total_events: numberOrZero(summary?.total_events),
    success_count: numberOrZero(summary?.success_count),
    failed_count: numberOrZero(summary?.failed_count),
    pending_count: numberOrZero(summary?.pending_count),
    stale_count: numberOrZero(summary?.stale_count),
    latest_success_at: sanitizeDate(summary?.latest_success_at),
    latest_failure_at: sanitizeDate(summary?.latest_failure_at),
  };
}

function sanitizeDirection(direction) {
  return {
    total: numberOrZero(direction?.total),
    success: numberOrZero(direction?.success),
    failed: numberOrZero(direction?.failed),
    pending: numberOrZero(direction?.pending),
  };
}

function sanitizeErrorCategory(category) {
  return {
    category: sanitizeText(category?.category, 80) || 'Other',
    count: numberOrZero(category?.count),
    latest_seen_at: sanitizeDate(category?.latest_seen_at),
  };
}

function sanitizeTool(tool) {
  return {
    name: sanitizeText(tool?.name, 100) || 'Tool',
    status: sanitizeText(tool?.status, 60) || 'unknown',
    note: sanitizeText(tool?.note, 180),
  };
}

function dateKey(value) {
  const text = normalizeText(value);
  if (!text) return '';
  return text.slice(0, 10);
}

function inRange(value, from, to) {
  const key = dateKey(value);
  if (!key) return true;
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

function nativeLogTimestamp(log) {
  return log.sync_timestamp || log.completed_at || log.created_date || null;
}

function nativeQueueTimestamp(item) {
  return item.last_seen_at || item.first_seen_at || item.created_date || null;
}

function summarizeNativeReviewItem(item) {
  const payload = item?.incoming_payload && typeof item.incoming_payload === 'object' ? item.incoming_payload : {};
  return {
    id: item?.id || null,
    incident_type: sanitizeText(item?.incident_type, 100),
    status: sanitizeText(item?.status, 60) || 'pending',
    source: sanitizeText(item?.incoming_source, 80),
    order_number: sanitizeText(item?.existing_order_number || payload.order_number, 100),
    issue: sanitizeText(item?.issue_description, 240),
    recommended_action: sanitizeText(item?.recommended_action, 160),
    occurrence_count: numberOrZero(item?.occurrence_count || 1),
    last_seen_at: sanitizeDate(nativeQueueTimestamp(item)),
  };
}

function summarizeNativeSyncLog(log) {
  return {
    id: log?.id || null,
    order_number: sanitizeText(log?.order_number, 100),
    status: sanitizeText(log?.status, 60),
    source: sanitizeText(log?.sync_source || log?.triggered_by, 80),
    event_type: sanitizeText(log?.event_type, 100),
    action: sanitizeText(log?.action || log?.hub_action, 100),
    reason: sanitizeText(log?.reason || log?.error_code || log?.description, 220),
    timestamp: sanitizeDate(nativeLogTimestamp(log)),
  };
}

async function getNativeCustomerAppContext(base44, dateFrom, dateTo) {
  const [orderSyncLogs, reviewQueueItems] = await Promise.all([
    base44.asServiceRole.entities.OrderSyncLog.list('-created_date', 500).catch(error => {
      console.warn('[getAdminSyncHealthSummary] Native OrderSyncLog unavailable:', error.message);
      return [];
    }),
    base44.asServiceRole.entities.OrderReviewQueue.list('-created_date', 500).catch(error => {
      console.warn('[getAdminSyncHealthSummary] Native OrderReviewQueue unavailable:', error.message);
      return [];
    }),
  ]);

  const nativeLogs = (Array.isArray(orderSyncLogs) ? orderSyncLogs : [])
    .filter(log => inRange(nativeLogTimestamp(log), dateFrom, dateTo));
  const reviewItems = (Array.isArray(reviewQueueItems) ? reviewQueueItems : [])
    .filter(item => inRange(nativeQueueTimestamp(item), dateFrom, dateTo));
  const activeReviewItems = reviewItems.filter(item => !['resolved', 'archived'].includes(normalizeLower(item.status)));
  const failedLogs = nativeLogs.filter(log => ['error', 'failed', 'failure', 'rejected'].includes(normalizeLower(log.status)));
  const pendingLogs = nativeLogs.filter(log => ['pending', 'queued_for_review'].includes(normalizeLower(log.status)));
  const successfulLogs = nativeLogs.filter(log => ['success', 'deduped', 'skipped'].includes(normalizeLower(log.status)));

  return {
    summary: {
      native_sync_events: nativeLogs.length,
      native_success_count: successfulLogs.length,
      native_failed_count: failedLogs.length,
      native_pending_count: pendingLogs.length,
      active_review_count: activeReviewItems.length,
      total_review_count: reviewItems.length,
    },
    recent_review_issues: activeReviewItems
      .sort((a, b) => new Date(nativeQueueTimestamp(b) || 0) - new Date(nativeQueueTimestamp(a) || 0))
      .slice(0, 20)
      .map(summarizeNativeReviewItem),
    recent_sync_logs: nativeLogs
      .sort((a, b) => new Date(nativeLogTimestamp(b) || 0) - new Date(nativeLogTimestamp(a) || 0))
      .slice(0, 20)
      .map(summarizeNativeSyncLog),
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
    let status;
    let limit;

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

      status = normalizeStatus(body.status);
      limit = normalizeLimit(body.limit);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const source = sanitizeText(body.source, 80) || '';
    const action = sanitizeText(body.action, 80) || '';
    const responseDateFrom = preset === 'custom'
      ? dateFrom
      : preset === 'today'
        ? new Date().toISOString().slice(0, 10)
        : null;
    const responseDateTo = preset === 'custom'
      ? dateTo
      : preset === 'today'
        ? new Date().toISOString().slice(0, 10)
        : null;
    const nativeCustomerApp = await getNativeCustomerAppContext(base44, responseDateFrom, responseDateTo);

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({
        success: true,
        hub_available: false,
        hub_error: 'Hub sync health service is not configured',
        date_from: dateFrom || null,
        date_to: dateTo || null,
        generated_at: new Date().toISOString(),
        summary: sanitizeSummary({}),
        directions: {
          customer_app_to_hub: sanitizeDirection({}),
          hub_to_customer_app: sanitizeDirection({}),
        },
        error_categories: [],
        disabled_or_deprecated_tools: [],
        native_customer_app: nativeCustomerApp,
        truncated: false,
      });
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
    if (status) params.set('status', status);
    if (source) params.set('source', source);
    if (action) params.set('action', action);

    const hubResponse = await fetch(`${hubBase}/functions/getSyncHealthSummaryForCustomerApp?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
    });

    if (!hubResponse.ok) {
      return Response.json({
        success: true,
        hub_available: false,
        hub_error: 'Unable to load sync health summary',
        hub_status: hubResponse.status,
        date_from: dateFrom || null,
        date_to: dateTo || null,
        generated_at: new Date().toISOString(),
        summary: sanitizeSummary({}),
        directions: {
          customer_app_to_hub: sanitizeDirection({}),
          hub_to_customer_app: sanitizeDirection({}),
        },
        error_categories: [],
        disabled_or_deprecated_tools: [],
        native_customer_app: nativeCustomerApp,
        truncated: false,
      });
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (
      !hubData ||
      hubData.success !== true ||
      !hubData.summary ||
      !hubData.directions ||
      !Array.isArray(hubData.error_categories) ||
      !Array.isArray(hubData.disabled_or_deprecated_tools)
    ) {
      return Response.json({ error: 'Malformed sync health summary response' }, { status: 502 });
    }

    return Response.json({
      success: true,
      hub_available: true,
      date_from: hubData.date_from || dateFrom || null,
      date_to: hubData.date_to || dateTo || null,
      generated_at: hubData.generated_at || null,
      summary: sanitizeSummary(hubData.summary),
      directions: {
        customer_app_to_hub: sanitizeDirection(hubData.directions.customer_app_to_hub),
        hub_to_customer_app: sanitizeDirection(hubData.directions.hub_to_customer_app),
      },
      error_categories: hubData.error_categories.map(sanitizeErrorCategory).slice(0, 30),
      disabled_or_deprecated_tools: hubData.disabled_or_deprecated_tools.map(sanitizeTool).slice(0, 30),
      native_customer_app: nativeCustomerApp,
      truncated: hubData.truncated === true,
    });
  } catch (error) {
    console.error('[getAdminSyncHealthSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load sync health summary' }, { status: 500 });
  }
});
