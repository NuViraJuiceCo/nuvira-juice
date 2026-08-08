// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const DEFAULT_REVIEW_LIMIT = 150;
const MAX_REVIEW_LIMIT = 300;
const VALID_REVIEW_STATUSES = new Set(['all', 'open', 'pending', 'reviewing', 'resolved', 'rejected', 'archived']);

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

function normalizeLimit(value) {
  const text = normalizeText(value);
  if (!text) return DEFAULT_LIMIT;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('limit must be a positive integer');
  }
  return Math.min(parsed, MAX_LIMIT);
}

function normalizeReviewLimit(value) {
  const text = normalizeText(value);
  if (!text) return DEFAULT_REVIEW_LIMIT;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('review_limit must be a positive integer');
  }
  return Math.min(parsed, MAX_REVIEW_LIMIT);
}

function normalizeReviewStatus(value) {
  const status = normalizeLower(value) || 'open';
  if (!VALID_REVIEW_STATUSES.has(status)) {
    throw new Error('review_status must be one of all, open, pending, reviewing, resolved, rejected, archived');
  }
  return status;
}

function sanitizeText(value, maxLength = 240) {
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
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function normalizeRetiredReviewCopy(value) {
  const original = normalizeText(value);
  const normalized = original.replace(/^.+native order ops rejected order:\s*/i, '');
  if (normalizeLower(normalized) === 'delivery_order_missing_address') {
    return 'Delivery order requires a complete address.';
  }
  return normalized;
}

function sanitizeSummary(summary) {
  return {
    total_active: Number(summary?.total_active) || 0,
    critical: Number(summary?.critical) || 0,
    warning: Number(summary?.warning) || 0,
    info: Number(summary?.info) || 0,
    unresolved: Number(summary?.unresolved) || 0,
  };
}

function sanitizeAlert(alert) {
  return {
    id: alert.id || null,
    title: sanitizeText(alert.title, 120),
    summary: sanitizeText(alert.summary, 280),
    severity: sanitizeText(alert.severity, 40),
    status: sanitizeText(alert.status, 40),
    category: sanitizeText(alert.category, 80),
    source: sanitizeText(alert.source, 80),
    related_record_type: sanitizeText(alert.related_record_type, 80),
    related_display_id: sanitizeText(alert.related_display_id, 120),
    created_date: alert.created_date || null,
    updated_date: alert.updated_date || null,
    actions_available: alert.actions_available !== false,
  };
}

function sanitizeReviewRow(row) {
  return {
    id: sanitizeText(row?.id, 120),
    incident_type: sanitizeText(row?.incident_type, 120),
    customer_email: sanitizeText(row?.customer_email, 160),
    customer_name: sanitizeText(row?.customer_name, 160),
    existing_order_id: sanitizeText(row?.existing_order_id, 120),
    existing_order_number: sanitizeText(row?.existing_order_number, 120),
    existing_order_type: sanitizeText(row?.existing_order_type, 80),
    incoming_source: sanitizeText(row?.incoming_source, 120),
    issue_description: sanitizeText(normalizeRetiredReviewCopy(row?.issue_description), 600),
    recommended_action: sanitizeText(row?.recommended_action, 600),
    admin_notes: sanitizeText(row?.admin_notes, 600),
    status: sanitizeText(row?.status || 'pending', 40),
    resolved_action: sanitizeText(row?.resolved_action, 160),
    resolved_at: normalizeText(row?.resolved_at) || null,
    resolved_by: sanitizeText(row?.resolved_by, 160),
    occurrence_count: Number(row?.occurrence_count) || 0,
    first_seen_at: normalizeText(row?.first_seen_at) || null,
    last_seen_at: normalizeText(row?.last_seen_at) || null,
    queue_visibility_status: sanitizeText(row?.queue_visibility_status, 80),
    archived_at: normalizeText(row?.archived_at) || null,
    archived_by: sanitizeText(row?.archived_by, 160),
    archived_reason: sanitizeText(row?.archived_reason, 240),
    created_date: normalizeText(row?.created_date) || null,
    updated_date: normalizeText(row?.updated_date) || null,
  };
}

function isTerminalStatus(status) {
  return ['resolved', 'dismissed', 'archived', 'closed'].includes(normalizeLower(status));
}

function isActiveReviewStatus(status) {
  return !['resolved', 'rejected', 'archived'].includes(normalizeLower(status));
}

function isOpenReviewStatus(status) {
  return ['pending', 'reviewing'].includes(normalizeLower(status));
}

function isLegacyLaunchReviewQueueNoise(row) {
  const source = normalizeLower(row?.incoming_source);
  const incident = normalizeLower(row?.incident_type);
  const existingOrder = normalizeText(row?.existing_order_number || row?.order_number || row?.shopify_order_number);
  const recommendedAction = normalizeLower(row?.recommended_action);
  const referenceTimestamp = Date.parse(String(row?.last_seen_at || row?.updated_date || row?.created_date || ''));
  const isStale = Number.isFinite(referenceTimestamp) && referenceTimestamp < Date.now() - 30 * 24 * 60 * 60 * 1000;
  return source === 'shopify_pos' &&
    incident === 'payment_not_paid' &&
    !existingOrder &&
    recommendedAction === 'manual_review_before_operational_processing' &&
    isStale;
}

function isInternalTestReviewQueueItem(row) {
  if (row?.is_test_record === true || row?.is_test_order === true || row?.internal_test === true) return true;
  const orderRef = normalizeLower(row?.existing_order_number || row?.order_number || row?.shopify_order_number);
  return orderRef.startsWith('nv-test-') || orderRef.includes('-test-');
}

function reviewStatusMatches(row, status) {
  const current = normalizeLower(row?.status) || 'pending';
  if (status === 'all') return true;
  if (status === 'open') return isOpenReviewStatus(current);
  return current === status;
}

function reviewMatchesSearch(row, search) {
  const query = normalizeLower(search);
  if (!query) return true;
  const haystack = [
    row?.incident_type,
    row?.customer_email,
    row?.customer_name,
    row?.existing_order_number,
    row?.incoming_source,
    row?.issue_description,
    row?.recommended_action,
    row?.admin_notes,
    row?.status,
  ].map(normalizeLower).join(' ');
  return haystack.includes(query);
}

function countReviewByStatus(rows) {
  return rows.reduce((acc, row) => {
    const status = normalizeLower(row?.status) || 'pending';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
}

function normalizeSeverity(value, fallback = 'warning') {
  const severity = normalizeLower(value);
  if (severity === 'critical' || severity === 'high' || severity === 'failure') return 'critical';
  if (severity === 'warning' || severity === 'medium' || severity === 'needs_review') return 'warning';
  if (severity === 'info' || severity === 'low' || severity === 'notice') return 'info';
  return fallback;
}

function normalizeAlertStatus(value, fallback = 'unresolved') {
  const status = normalizeLower(value);
  if (!status) return fallback;
  if (['active', 'open', 'new', 'unread', 'read', 'acknowledged', 'pending', 'reviewing', 'unresolved'].includes(status)) {
    return status;
  }
  if (['resolved', 'dismissed', 'archived', 'closed'].includes(status)) return status;
  return fallback;
}

function matchesFilter(alert, { severity, status, category, search }) {
  if (severity && normalizeSeverity(alert.severity) !== normalizeSeverity(severity)) return false;
  if (status) {
    const wanted = normalizeLower(status);
    const current = normalizeAlertStatus(alert.status);
    if (wanted === 'unresolved' || wanted === 'active' || wanted === 'open') {
      if (isTerminalStatus(current)) return false;
    } else if (wanted === 'new') {
      if (!['new', 'unread', 'pending'].includes(current)) return false;
    } else if (current !== wanted) {
      return false;
    }
  }
  if (category && normalizeLower(alert.category) !== normalizeLower(category)) return false;
  if (search) {
    const haystack = [
      alert.title,
      alert.summary,
      alert.category,
      alert.source,
      alert.related_record_type,
      alert.related_display_id,
    ].map(normalizeLower).join(' ');
    if (!haystack.includes(normalizeLower(search))) return false;
  }
  return true;
}

function summarizeAlerts(alerts) {
  const active = alerts.filter(alert => !isTerminalStatus(alert.status));
  return sanitizeSummary({
    total_active: active.length,
    critical: active.filter(alert => normalizeSeverity(alert.severity) === 'critical').length,
    warning: active.filter(alert => normalizeSeverity(alert.severity) === 'warning').length,
    info: active.filter(alert => normalizeSeverity(alert.severity) === 'info').length,
    unresolved: active.length,
  });
}

async function listEntity(base44, entityName, sort, limit = 500) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity || typeof entity.list !== 'function') return [];
  return await entity.list(sort, limit).catch(error => {
    console.warn(`[getAdminOpsAlertsSummary] Native ${entityName} unavailable:`, error.message);
    return [];
  });
}

async function loadNativeReviewQueue(base44, { status, search, limit, includeLegacy = false, includeInternalTest = false }) {
  const entity = base44.asServiceRole?.entities?.OrderReviewQueue;
  if (!entity || typeof entity.list !== 'function') {
    return {
      source: 'customer_app_native_review_queue_unavailable',
      summary: {
        total: 0,
        open: 0,
        pending: 0,
        reviewing: 0,
        resolved: 0,
        rejected: 0,
        archived: 0,
        refund_related: 0,
      },
      rows: [],
      count: 0,
      total_matching: 0,
      truncated: false,
      warnings: ['order_review_queue_entity_unavailable'],
      safety: {
        raw_payloads_included: false,
        writes_performed: false,
        provider_calls_performed: false,
        notifications_sent: false,
        hub_mutation_performed: false,
      },
    };
  }

  const rows = await entity.list('-created_date', MAX_REVIEW_LIMIT).catch(error => {
    console.warn('[getAdminOpsAlertsSummary] Native OrderReviewQueue unavailable:', error.message);
    return [];
  });
  const allRows = Array.isArray(rows) ? rows : [];
  const legacyLaunchRows = allRows.filter(isLegacyLaunchReviewQueueNoise);
  const internalTestRows = allRows.filter(isInternalTestReviewQueueItem);
  const operationalRows = allRows.filter(row =>
    (includeLegacy || !isLegacyLaunchReviewQueueNoise(row)) &&
    (includeInternalTest || !isInternalTestReviewQueueItem(row))
  );
  const statusCounts = countReviewByStatus(operationalRows);
  const filtered = operationalRows
    .filter(row => reviewStatusMatches(row, status))
    .filter(row => reviewMatchesSearch(row, search));
  const visibleRows = filtered.slice(0, limit).map(sanitizeReviewRow);

  return {
    source: 'customer_app_native_review_queue_service_role_read',
    generated_at: new Date().toISOString(),
    status_filter: status,
    search_applied: Boolean(search),
    count: visibleRows.length,
    total_matching: filtered.length,
    truncated: filtered.length > visibleRows.length,
    summary: {
      total: operationalRows.length,
      total_raw: allRows.length,
      open: operationalRows.filter(row => isOpenReviewStatus(row?.status)).length,
      pending: statusCounts.pending || 0,
      reviewing: statusCounts.reviewing || 0,
      resolved: statusCounts.resolved || 0,
      rejected: statusCounts.rejected || 0,
      archived: statusCounts.archived || 0,
      refund_related: operationalRows.filter(row => normalizeLower(row?.incident_type).includes('refund')).length,
      legacy_launch_suppressed: includeLegacy ? 0 : legacyLaunchRows.length,
      internal_test_suppressed: includeInternalTest ? 0 : internalTestRows.length,
    },
    rows: visibleRows,
    warnings: [],
    safety: {
      raw_payloads_included: false,
      writes_performed: false,
      provider_calls_performed: false,
      notifications_sent: false,
      hub_mutation_performed: false,
    },
  };
}

async function loadNativeOpsAlerts(base44, filters, limit) {
  const [operationalAlerts, complianceAlerts, reviewQueueItems] = await Promise.all([
    listEntity(base44, 'OperationalAlert', '-created_date'),
    listEntity(base44, 'ComplianceAlert', '-created_date'),
    listEntity(base44, 'OrderReviewQueue', '-created_date'),
  ]);

  const nativeAlerts = [
    ...operationalAlerts.map(alert => ({
      id: `native_operational_${alert.id}`,
      title: sanitizeText(alert.title, 120) || 'Operational alert',
      summary: sanitizeText(alert.message || alert.description, 280),
      severity: normalizeSeverity(alert.severity, 'info'),
      status: alert.resolved === true ? 'resolved' : (alert.is_read === true ? 'read' : 'unread'),
      category: sanitizeText(alert.alert_type || 'operational', 80),
      source: 'customer_app_native',
      related_record_type: alert.shopify_order_id || alert.order_number ? 'order' : null,
      related_display_id: sanitizeText(alert.order_number || alert.shopify_order_id, 120),
      created_date: alert.created_date || null,
      updated_date: alert.updated_date || null,
      actions_available: false,
    })),
    ...complianceAlerts.map(alert => ({
      id: `native_compliance_${alert.id}`,
      title: sanitizeText(alert.alert_type || 'Compliance alert', 120),
      summary: sanitizeText(alert.message || alert.resolution_notes, 280),
      severity: normalizeSeverity(alert.severity, 'warning'),
      status: normalizeAlertStatus(alert.status, 'active'),
      category: sanitizeText(alert.alert_type || 'compliance', 80),
      source: 'customer_app_native_compliance',
      related_record_type: sanitizeText(alert.related_log_type, 80),
      related_display_id: sanitizeText(alert.related_log_id, 120),
      created_date: alert.triggered_date || alert.created_date || null,
      updated_date: alert.updated_date || null,
      actions_available: false,
    })),
    ...reviewQueueItems
      .filter(item => isActiveReviewStatus(item.status))
      .filter(item => !isLegacyLaunchReviewQueueNoise(item))
      .filter(item => !isInternalTestReviewQueueItem(item))
      .map(item => ({
        id: `native_review_${item.id}`,
        title: sanitizeText(`Order review: ${item.incident_type || 'needs review'}`, 120),
        summary: sanitizeText(item.issue_description || item.recommended_action || 'Order needs admin review.', 280),
        severity: 'warning',
        status: normalizeAlertStatus(item.status, 'pending'),
        category: sanitizeText(item.incident_type || 'order_review', 80),
        source: sanitizeText(item.incoming_source || 'customer_app_native_review', 80),
        related_record_type: sanitizeText(item.existing_order_type || 'order', 80),
        related_display_id: sanitizeText(item.existing_order_number || item.existing_order_id, 120),
        created_date: item.last_seen_at || item.created_date || null,
        updated_date: item.updated_date || item.last_seen_at || null,
        actions_available: false,
      })),
  ]
    .map(sanitizeAlert)
    .filter(alert => matchesFilter(alert, filters))
    .sort((a, b) => new Date(b.updated_date || b.created_date || 0) - new Date(a.updated_date || a.created_date || 0));

  return {
    summary: summarizeAlerts(nativeAlerts),
    alerts: nativeAlerts.slice(0, limit),
    truncated: nativeAlerts.length > limit,
  };
}

function nativeFallbackResponse({ nativeAlerts, reason, hubStatus = null, reviewQueue = null }) {
  return Response.json({
    success: true,
    source: 'customer_app_native_ops_alerts_fallback',
    summary: sanitizeSummary(nativeAlerts.summary),
    count: nativeAlerts.alerts.length,
    truncated: nativeAlerts.truncated === true,
    alerts: nativeAlerts.alerts,
    review_queue: reviewQueue,
    warnings: [
      hubStatus ? `hub_ops_alerts_unavailable:${hubStatus}` : `hub_ops_alerts_unavailable:${reason}`,
      'native_read_only_fallback',
    ],
    data_sources: {
      hub_available: false,
      native_available: true,
      native_read_only: true,
    },
    writes_performed: false,
    provider_calls_performed: false,
    notifications_sent: false,
    hub_mutation_performed: false,
  });
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
    const includeReviewQueue = body.include_review_queue === true || body.include_review_queue_only === true;
    const includeReviewQueueOnly = body.include_review_queue_only === true;
    const includeLegacyReviewQueue = body.include_legacy_review_queue === true;
    const includeInternalTestReviewQueue = body.include_internal_test_review_queue === true;
    let limit;
    let reviewLimit = DEFAULT_REVIEW_LIMIT;
    let reviewStatus = 'open';

    try {
      limit = normalizeLimit(body.limit);
      if (includeReviewQueue) {
        reviewLimit = normalizeReviewLimit(body.review_limit ?? body.limit);
        reviewStatus = normalizeReviewStatus(body.review_status);
      }
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const severity = normalizeText(body.severity);
    const status = normalizeText(body.status);
    const category = normalizeText(body.category);
    const search = normalizeText(body.search);
    const filters = { severity, status, category, search };
    const reviewSearch = normalizeText(body.review_search ?? body.search);
    const loadNativeAlerts = () => loadNativeOpsAlerts(base44, filters, limit);

    if (includeReviewQueueOnly) {
      const reviewQueue = await loadNativeReviewQueue(base44, {
        status: reviewStatus,
        search: reviewSearch,
        limit: reviewLimit,
        includeLegacy: includeLegacyReviewQueue,
        includeInternalTest: includeInternalTestReviewQueue,
      });
      return Response.json({
        success: true,
        source: reviewQueue.source,
        generated_at: reviewQueue.generated_at || new Date().toISOString(),
        status_filter: reviewQueue.status_filter,
        search_applied: reviewQueue.search_applied === true,
        summary: reviewQueue.summary,
        rows: reviewQueue.rows,
        count: reviewQueue.count,
        total_matching: reviewQueue.total_matching,
        truncated: reviewQueue.truncated === true,
        warnings: reviewQueue.warnings,
        safety: reviewQueue.safety,
        data_sources: {
          hub_available: false,
          native_available: true,
          native_read_only: true,
        },
        writes_performed: false,
        provider_calls_performed: false,
        notifications_sent: false,
        hub_mutation_performed: false,
      });
    }

    const reviewQueue = includeReviewQueue ? await loadNativeReviewQueue(base44, {
      status: reviewStatus,
      search: reviewSearch,
      limit: reviewLimit,
      includeLegacy: includeLegacyReviewQueue,
      includeInternalTest: includeInternalTestReviewQueue,
    }) : null;

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      const nativeAlerts = await loadNativeAlerts();
      return nativeFallbackResponse({
        nativeAlerts,
        reason: 'missing_config',
        reviewQueue,
      });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const params = new URLSearchParams({
      limit: limit.toString(),
    });
    if (severity) params.set('severity', severity);
    if (status) params.set('status', status);
    if (category) params.set('category', category);
    if (search) params.set('search', search);

    let hubResponse;
    try {
      hubResponse = await fetch(`${hubBase}/functions/getOpsAlertsSummaryForCustomerApp?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
        },
      });
    } catch (error) {
      console.warn('[getAdminOpsAlertsSummary] Hub fetch failed; returning native fallback:', error.message);
      const nativeAlerts = await loadNativeAlerts();
      return nativeFallbackResponse({
        nativeAlerts,
        reason: 'fetch_failed',
        reviewQueue,
      });
    }

    if (!hubResponse.ok) {
      const nativeAlerts = await loadNativeAlerts();
      return nativeFallbackResponse({
        nativeAlerts,
        reason: 'non_ok',
        hubStatus: hubResponse.status,
        reviewQueue,
      });
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubData || hubData.success !== true || !Array.isArray(hubData.alerts)) {
      const nativeAlerts = await loadNativeAlerts();
      return nativeFallbackResponse({
        nativeAlerts,
        reason: 'malformed_response',
        reviewQueue,
      });
    }

    const sanitizedAlerts = hubData.alerts.map(sanitizeAlert).slice(0, limit);
    const truncated = hubData.truncated === true || sanitizedAlerts.length < hubData.alerts.length;

    return Response.json({
      success: true,
      summary: sanitizeSummary(hubData.summary),
      count: sanitizedAlerts.length,
      truncated,
      alerts: sanitizedAlerts,
      review_queue: reviewQueue,
      writes_performed: false,
      provider_calls_performed: false,
      notifications_sent: false,
      hub_mutation_performed: false,
    });
  } catch (error) {
    console.error('[getAdminOpsAlertsSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load ops alerts summary' }, { status: 500 });
  }
}
