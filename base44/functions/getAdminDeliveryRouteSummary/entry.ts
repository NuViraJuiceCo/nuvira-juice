import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const CHICAGO_TZ = 'America/Chicago';
const MAX_LIMIT = 100;

function normalizeText(value) {
  return (value || '').toString().trim();
}

function sanitizeAssignedDriver(value) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');

  if (!text) return null;
  return text.length > 120 ? `${text.slice(0, 119).trim()}...` : text;
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

function normalizeLimit(value) {
  const text = normalizeText(value);
  if (!text) return MAX_LIMIT;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('limit must be a positive integer');
  }
  return Math.min(parsed, MAX_LIMIT);
}

function sanitizeStop(stop) {
  return {
    task_id: stop.task_id || null,
    order_number: stop.order_number || null,
    fulfillment_number: stop.fulfillment_number ?? null,
    source_type: stop.source_type || null,
    assigned_driver: sanitizeAssignedDriver(stop.assigned_driver),
    task_status: stop.task_status || null,
    delivery_status: stop.delivery_status || null,
    fulfillment_status: stop.fulfillment_status || null,
    delivery_date: stop.delivery_date || null,
    delivery_window_label: stop.delivery_window_label || null,
    items_summary: stop.items_summary || null,
    delivered_at: stop.delivered_at || null,
    proof_available: stop.proof_available === true,
    delivery_photo_url: stop.delivery_photo_url || null,
    delivery_drop_location: stop.delivery_drop_location || null,
    missing_address: stop.missing_address === true,
    bag_return_required: stop.bag_return_required ?? null,
    bag_return_count: stop.bag_return_count ?? null,
  };
}

function sanitizeSummary(summary) {
  return {
    total_stops: Number(summary?.total_stops) || 0,
    active: Number(summary?.active) || 0,
    completed: Number(summary?.completed) || 0,
    bag_returns: summary?.bag_returns === null || summary?.bag_returns === undefined
      ? null
      : Number(summary.bag_returns) || 0,
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
    let deliveryDate;
    let limit;

    try {
      deliveryDate = parseIsoDate(body.delivery_date || body.date, 'delivery_date') || todayChicagoDate();
      limit = normalizeLimit(body.limit);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub delivery queue service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const params = new URLSearchParams({
      delivery_date: deliveryDate,
      limit: limit.toString(),
    });

    const hubResponse = await fetch(`${hubBase}/functions/getDeliveryRouteSummaryForCustomerApp?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
    });

    if (!hubResponse.ok) {
      return Response.json({
        error: 'Unable to load delivery queue summary',
        hub_status: hubResponse.status,
      }, { status: hubResponse.status >= 400 && hubResponse.status < 500 ? hubResponse.status : 502 });
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (
      !hubData ||
      hubData.success !== true ||
      !hubData.sections ||
      !Array.isArray(hubData.sections.delivery_stops) ||
      !Array.isArray(hubData.sections.completed)
    ) {
      return Response.json({ error: 'Malformed delivery queue summary response' }, { status: 502 });
    }

    return Response.json({
      success: true,
      delivery_date: hubData.delivery_date || deliveryDate,
      summary: sanitizeSummary(hubData.summary),
      sections: {
        delivery_stops: hubData.sections.delivery_stops.map(sanitizeStop).slice(0, limit),
        completed: hubData.sections.completed.map(sanitizeStop).slice(0, limit),
      },
    });
  } catch (error) {
    console.error('[getAdminDeliveryRouteSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load delivery queue summary' }, { status: 500 });
  }
});
