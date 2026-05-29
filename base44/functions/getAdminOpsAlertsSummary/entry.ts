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
  const text = normalizeText(value);
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

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub ops alerts service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const params = new URLSearchParams({
      limit: limit.toString(),
    });
    if (severity) params.set('severity', severity);
    if (status) params.set('status', status);
    if (category) params.set('category', category);
    if (search) params.set('search', search);

    const hubResponse = await fetch(`${hubBase}/functions/getOpsAlertsSummaryForCustomerApp?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
    });

    if (!hubResponse.ok) {
      return Response.json({
        error: 'Unable to load ops alerts summary',
        hub_status: hubResponse.status,
      }, { status: hubResponse.status >= 400 && hubResponse.status < 500 ? hubResponse.status : 502 });
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubData || hubData.success !== true || !Array.isArray(hubData.alerts)) {
      return Response.json({ error: 'Malformed ops alerts summary response' }, { status: 502 });
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
