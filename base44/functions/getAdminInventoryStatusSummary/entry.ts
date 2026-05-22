import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;
const VALID_STATUSES = new Set(['ok', 'low', 'critical', 'out_of_stock']);

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

function normalizeStatus(value) {
  const status = normalizeText(value).toLowerCase();
  if (!status) return '';
  if (!VALID_STATUSES.has(status)) {
    throw new Error('status must be one of ok, low, critical, out_of_stock');
  }
  return status;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeSummary(summary) {
  return {
    total_items: Number(summary?.total_items) || 0,
    low_stock_count: Number(summary?.low_stock_count) || 0,
    critical_count: Number(summary?.critical_count) || 0,
    out_of_stock_count: Number(summary?.out_of_stock_count) || 0,
    category_count: Number(summary?.category_count) || 0,
  };
}

function sanitizeItem(item) {
  const status = normalizeText(item.status).toLowerCase();
  return {
    id: item.id || null,
    ingredient: item.ingredient || null,
    category: item.category || null,
    unit: item.unit || null,
    stock: numberOrNull(item.stock),
    reorder_point: numberOrNull(item.reorder_point),
    max_stock: numberOrNull(item.max_stock),
    supplier: item.supplier || null,
    location: item.location || null,
    status: VALID_STATUSES.has(status) ? status : null,
    updated_date: item.updated_date || null,
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
    let status;
    let limit;

    try {
      status = normalizeStatus(body.status);
      limit = normalizeLimit(body.limit);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const category = normalizeText(body.category);
    const search = normalizeText(body.search);

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub inventory status service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const params = new URLSearchParams({
      limit: limit.toString(),
    });
    if (category) params.set('category', category);
    if (status) params.set('status', status);
    if (search) params.set('search', search);

    const hubResponse = await fetch(`${hubBase}/functions/getInventoryStatusSummaryForCustomerApp?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
    });

    if (!hubResponse.ok) {
      return Response.json({
        error: 'Unable to load inventory status summary',
        hub_status: hubResponse.status,
      }, { status: hubResponse.status >= 400 && hubResponse.status < 500 ? hubResponse.status : 502 });
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubData || hubData.success !== true || !Array.isArray(hubData.items)) {
      return Response.json({ error: 'Malformed inventory status summary response' }, { status: 502 });
    }

    const sanitizedItems = hubData.items.map(sanitizeItem).slice(0, limit);
    const truncated = hubData.truncated === true || sanitizedItems.length < hubData.items.length;

    return Response.json({
      success: true,
      summary: sanitizeSummary(hubData.summary),
      count: sanitizedItems.length,
      truncated,
      items: sanitizedItems,
    });
  } catch (error) {
    console.error('[getAdminInventoryStatusSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load inventory status summary' }, { status: 500 });
  }
});
