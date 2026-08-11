// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const MAX_RANGE_DAYS = 31;
const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 500;
const BUSINESS_TIME_ZONE = 'America/Chicago';
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

function normalizeLimit(value) {
  const text = normalizeText(value);
  if (!text) return DEFAULT_LIMIT;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('limit must be a positive integer');
  }
  return Math.min(parsed, MAX_LIMIT);
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

function dateKey(value) {
  const text = normalizeText(value);
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const part = type => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addDays(date, days) {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function selectedDateRange(preset, dateFrom, dateTo) {
  if (preset === 'custom') return { from: dateFrom, to: dateTo };
  const today = dateKey(new Date());
  if (preset === 'today') return { from: today, to: today };
  return {
    from: addDays(today, preset === 'last_30_days' ? -29 : -6),
    to: today,
  };
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
  return item?.last_seen_at || item?.first_seen_at || item?.created_date || null;
}

function normalizedIssueDescription(item) {
  const original = normalizeText(item?.issue_description);
  const withoutRetiredPrefix = original.replace(/^.+native order ops rejected order:\s*/i, '');
  if (normalizeLower(withoutRetiredPrefix) === 'delivery_order_missing_address') {
    return 'Delivery order requires a complete address.';
  }
  return withoutRetiredPrefix || 'Review required.';
}

function summarizeNativeReviewItem(item, groupedCount = 1) {
  const payload = item?.incoming_payload && typeof item.incoming_payload === 'object' ? item.incoming_payload : {};
  return {
    id: item?.id || null,
    incident_type: sanitizeText(item?.incident_type, 100),
    status: sanitizeText(item?.status, 60) || 'pending',
    source: sanitizeText(item?.incoming_source, 80),
    order_number: sanitizeText(item?.existing_order_number || payload.order_number, 100),
    issue: sanitizeText(normalizedIssueDescription(item), 240),
    recommended_action: sanitizeText(item?.recommended_action, 160),
    occurrence_count: numberOrZero(item?.occurrence_count || 1),
    affected_record_count: groupedCount,
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
  const staleLogs = nativeLogs.filter(log => normalizeLower(log.status) === 'stale');
  const successfulLogs = nativeLogs.filter(log => ['success', 'deduped', 'skipped'].includes(normalizeLower(log.status)));
  const groupedReviewItems = new Map();
  for (const item of activeReviewItems) {
    const key = `${normalizeLower(item?.incident_type) || 'review'}:${normalizeLower(normalizedIssueDescription(item))}`;
    const current = groupedReviewItems.get(key);
    const itemTime = new Date(nativeQueueTimestamp(item) || 0).getTime();
    const currentTime = new Date(nativeQueueTimestamp(current?.latest) || 0).getTime();
    groupedReviewItems.set(key, {
      count: Number(current?.count || 0) + 1,
      latest: !current || itemTime >= currentTime ? item : current.latest,
    });
  }

  return {
    summary: {
      native_sync_events: nativeLogs.length,
      native_success_count: successfulLogs.length,
      native_failed_count: failedLogs.length,
      native_pending_count: pendingLogs.length,
      native_stale_count: staleLogs.length,
      active_review_count: activeReviewItems.length,
      total_review_count: reviewItems.length,
      latest_failure_at: failedLogs
        .map(nativeLogTimestamp)
        .filter(Boolean)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null,
      latest_success_at: successfulLogs
        .map(nativeLogTimestamp)
        .filter(Boolean)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null,
    },
    recent_review_issues: [...groupedReviewItems.values()]
      .sort((a, b) => new Date(nativeQueueTimestamp(b.latest) || 0) - new Date(nativeQueueTimestamp(a.latest) || 0))
      .slice(0, 20)
      .map(group => summarizeNativeReviewItem(group.latest, group.count)),
    recent_sync_logs: nativeLogs
      .sort((a, b) => new Date(nativeLogTimestamp(b) || 0) - new Date(nativeLogTimestamp(a) || 0))
      .slice(0, 20)
      .map(summarizeNativeSyncLog),
  };
}

export default async function handler(req: Request) {
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

      limit = normalizeLimit(body.limit);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const selectedRange = selectedDateRange(preset, dateFrom, dateTo);
    const nativeCustomerApp = await getNativeCustomerAppContext(base44, selectedRange.from, selectedRange.to);
    const nativeSummary = nativeCustomerApp.summary || {};
    const reviewIssues = Array.isArray(nativeCustomerApp.recent_review_issues) ? nativeCustomerApp.recent_review_issues : [];
    const failedLogs = (Array.isArray(nativeCustomerApp.recent_sync_logs) ? nativeCustomerApp.recent_sync_logs : [])
      .filter(log => ['failed', 'failure', 'error', 'rejected', 'stale'].includes(normalizeLower(log.status)));
    const errorCategoryMap = new Map();
    for (const issue of reviewIssues) {
      const category = sanitizeText(issue.incident_type, 80) || 'Operational review';
      const current = errorCategoryMap.get(category) || { category, count: 0, latest_seen_at: null };
      current.count += Math.max(1, numberOrZero(issue.affected_record_count || issue.occurrence_count));
      if (!current.latest_seen_at || new Date(issue.last_seen_at || 0) > new Date(current.latest_seen_at || 0)) current.latest_seen_at = issue.last_seen_at || null;
      errorCategoryMap.set(category, current);
    }
    for (const log of failedLogs) {
      const category = sanitizeText(log.reason || log.event_type || 'Sync failure', 80) || 'Sync failure';
      const current = errorCategoryMap.get(category) || { category, count: 0, latest_seen_at: null };
      current.count += 1;
      if (!current.latest_seen_at || new Date(log.timestamp || 0) > new Date(current.latest_seen_at || 0)) current.latest_seen_at = log.timestamp || null;
      errorCategoryMap.set(category, current);
    }
    const activeReviewCount = numberOrZero(nativeSummary.active_review_count);
    const pendingCount = numberOrZero(nativeSummary.native_pending_count) + activeReviewCount;
    return Response.json({
      success: true,
      authority: 'customer_app_native',
      native_available: true,
      hub_operational_dependency: false,
      date_from: selectedRange.from,
      date_to: selectedRange.to,
      generated_at: new Date().toISOString(),
      summary: sanitizeSummary({
        total_events: numberOrZero(nativeSummary.native_sync_events) + activeReviewCount,
        success_count: nativeSummary.native_success_count,
        failed_count: nativeSummary.native_failed_count,
        pending_count: pendingCount,
        stale_count: nativeSummary.native_stale_count,
        latest_success_at: nativeSummary.latest_success_at,
        latest_failure_at: nativeSummary.latest_failure_at,
      }),
      directions: {
        customer_app_native_events: sanitizeDirection({
          total: nativeSummary.native_sync_events,
          success: nativeSummary.native_success_count,
          failed: nativeSummary.native_failed_count,
          pending: numberOrZero(nativeSummary.native_pending_count) + numberOrZero(nativeSummary.native_stale_count),
        }),
        operational_review_queue: sanitizeDirection({
          total: activeReviewCount,
          success: 0,
          failed: 0,
          pending: activeReviewCount,
        }),
      },
      error_categories: [...errorCategoryMap.values()].map(sanitizeErrorCategory).slice(0, 30),
      disabled_or_deprecated_tools: [],
      native_customer_app: nativeCustomerApp,
      truncated: numberOrZero(nativeSummary.native_sync_events) > limit,
      writes_performed: false,
      provider_calls_performed: false,
      customer_notifications_sent: false,
    });
  } catch (error) {
    console.error('[getAdminSyncHealthSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load sync health summary' }, { status: 500 });
  }
}
