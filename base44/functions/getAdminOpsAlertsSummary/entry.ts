import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

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

function isTerminalStatus(status) {
  return ['resolved', 'dismissed', 'archived', 'closed'].includes(normalizeLower(status));
}

function isActiveReviewStatus(status) {
  return !['resolved', 'rejected', 'archived'].includes(normalizeLower(status));
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

function nativeFallbackResponse({ nativeAlerts, reason, hubStatus = null }) {
  return Response.json({
    success: true,
    source: 'customer_app_native_ops_alerts_fallback',
    summary: sanitizeSummary(nativeAlerts.summary),
    count: nativeAlerts.alerts.length,
    truncated: nativeAlerts.truncated === true,
    alerts: nativeAlerts.alerts,
    warnings: [
      hubStatus ? `hub_ops_alerts_unavailable:${hubStatus}` : `hub_ops_alerts_unavailable:${reason}`,
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
    let limit;

    try {
      limit = normalizeLimit(body.limit);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const severity = normalizeText(body.severity);
    const status = normalizeText(body.status);
    const category = normalizeText(body.category);
    const search = normalizeText(body.search);
    const filters = { severity, status, category, search };
    const loadNativeAlerts = () => loadNativeOpsAlerts(base44, filters, limit);

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      const nativeAlerts = await loadNativeAlerts();
      return nativeFallbackResponse({
        nativeAlerts,
        reason: 'missing_config',
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
      });
    }

    if (!hubResponse.ok) {
      const nativeAlerts = await loadNativeAlerts();
      return nativeFallbackResponse({
        nativeAlerts,
        reason: 'non_ok',
        hubStatus: hubResponse.status,
      });
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubData || hubData.success !== true || !Array.isArray(hubData.alerts)) {
      const nativeAlerts = await loadNativeAlerts();
      return nativeFallbackResponse({
        nativeAlerts,
        reason: 'malformed_response',
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
    });
  } catch (error) {
    console.error('[getAdminOpsAlertsSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load ops alerts summary' }, { status: 500 });
  }
});
