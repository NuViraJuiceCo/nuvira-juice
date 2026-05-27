import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_TEXT_LENGTH = 160;
const MAX_PREVIEW_ROWS = 25;

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'expected_status',
  'request_id',
]);

const SAFE_RESPONSE_KEYS = new Set([
  'success',
  'dry_run',
  'function_name',
  'production_batch_id',
  'batch_id',
  'current_status',
  'expected_status_match',
  'request_id',
  'inventory_item_count_scanned',
  'ingredients_used_count',
  'deduction_preview_count',
  'deduction_preview_rows',
  'prior_deduction_log_present',
  'real_inventory_deduction_enabled',
  'actor_allowed',
  'batch_allowlisted',
  'projected_writes_if_approved',
  'purchase_order_changes_deferred',
  'customer_app_sync_deferred',
  'notifications_deferred',
  'live_allowed',
  'blockers',
  'warnings',
  'error',
  'error_code',
  'message',
]);

function normalizeText(value) {
  return (value || '').toString().trim();
}

function safeText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');

  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function parseBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

function unsupportedKeys(body) {
  return Object.keys(body || {}).filter(key => !ALLOWED_BODY_KEYS.has(key));
}

function sanitizeStringArray(values, limit = 30) {
  if (!Array.isArray(values)) return [];
  return values
    .slice(0, limit)
    .map(value => safeText(value, 80))
    .filter(Boolean);
}

function sanitizePreviewRow(row) {
  return {
    ingredient_name: safeText(row?.ingredient_name, 100),
    inventory_item_id: safeText(row?.inventory_item_id, 80),
    ingredient_unit: safeText(row?.ingredient_unit, 40),
    inventory_unit: safeText(row?.inventory_unit, 40),
    unit: safeText(row?.unit, 40),
    source_quantity: safeNumber(row?.source_quantity),
    source_unit: safeText(row?.source_unit, 40),
    quantity_to_deduct: safeNumber(row?.quantity_to_deduct),
    current_stock: safeNumber(row?.current_stock),
    projected_stock: safeNumber(row?.projected_stock),
    reorder_point: safeNumber(row?.reorder_point),
    inventory_match_count: safeNumber(row?.inventory_match_count),
    lot_present: row?.lot_present === true,
    status: safeText(row?.status, 40),
  };
}

function sanitizeHubResponse(data, hubStatus) {
  const safe = {};
  for (const key of SAFE_RESPONSE_KEYS) {
    if (!(key in (data || {}))) continue;
    safe[key] = data[key];
  }

  safe.success = data?.success === true;
  safe.dry_run = data?.dry_run === true;
  safe.production_batch_id = safeText(data?.production_batch_id, 100);
  safe.batch_id = safeText(data?.batch_id, 160);
  safe.current_status = safeText(data?.current_status, 80);
  safe.expected_status_match = data?.expected_status_match === true;
  safe.request_id = safeText(data?.request_id, 120);
  safe.inventory_item_count_scanned = safeNumber(data?.inventory_item_count_scanned) || 0;
  safe.ingredients_used_count = safeNumber(data?.ingredients_used_count) || 0;
  safe.deduction_preview_count = safeNumber(data?.deduction_preview_count) || 0;
  safe.deduction_preview_rows = Array.isArray(data?.deduction_preview_rows)
    ? data.deduction_preview_rows.slice(0, MAX_PREVIEW_ROWS).map(sanitizePreviewRow)
    : [];
  safe.prior_deduction_log_present = data?.prior_deduction_log_present === true;
  safe.real_inventory_deduction_enabled = data?.real_inventory_deduction_enabled === true;
  safe.actor_allowed = data?.actor_allowed === true;
  safe.batch_allowlisted = data?.batch_allowlisted === true;
  safe.projected_writes_if_approved = sanitizeStringArray(data?.projected_writes_if_approved, 10);
  safe.purchase_order_changes_deferred = data?.purchase_order_changes_deferred === true;
  safe.customer_app_sync_deferred = data?.customer_app_sync_deferred === true;
  safe.notifications_deferred = data?.notifications_deferred === true;
  safe.live_allowed = data?.live_allowed === true;
  safe.blockers = sanitizeStringArray(data?.blockers, 40);
  safe.warnings = sanitizeStringArray(data?.warnings, 40);
  safe.error = safeText(data?.error, 160);
  safe.error_code = safeText(data?.error_code, 80);
  safe.message = safeText(data?.message, 160);
  safe.hub_status = hubStatus;

  return safe;
}

function buildHubBody(body, user) {
  const hubBody = {
    production_batch_id: normalizeText(body.production_batch_id),
    actor_email: normalizeText(user?.email).toLowerCase(),
    actor_role: normalizeText(user?.role),
    source: 'customer_app_admin',
  };

  if (normalizeText(body.batch_id)) hubBody.batch_id = normalizeText(body.batch_id);
  if (normalizeText(body.expected_status)) hubBody.expected_status = normalizeText(body.expected_status);
  if (normalizeText(body.request_id)) hubBody.request_id = safeText(body.request_id, 120);
  return hubBody;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed', error_code: 'method_not_allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ error: 'Unauthorized', error_code: 'unauthorized' }, { status: 401 });
    }

    if (!user) {
      return Response.json({ error: 'Unauthorized', error_code: 'unauthorized' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden', error_code: 'forbidden' }, { status: 403 });
    }

    const body = await parseBody(req);
    if (unsupportedKeys(body).length > 0) {
      return Response.json({
        error: 'Unsupported request field',
        error_code: 'unsupported_field',
      }, { status: 400 });
    }

    if (!normalizeText(body.production_batch_id)) {
      return Response.json({
        error: 'production_batch_id is required',
        error_code: 'invalid_request',
      }, { status: 400 });
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({
        error: 'Hub inventory deduction preview is not configured',
        error_code: 'hub_not_configured',
      }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const hubResponse = await fetch(`${hubBase}/functions/previewProductionInventoryDeductionForCustomerApp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify(buildHubBody(body, user)),
    });

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubData || typeof hubData !== 'object') {
      return Response.json({
        success: false,
        dry_run: true,
        error: 'Malformed Hub preview response',
        error_code: 'malformed_hub_response',
        hub_status: hubResponse.status,
      }, { status: 502 });
    }

    return Response.json(sanitizeHubResponse(hubData, hubResponse.status), {
      status: hubResponse.ok ? 200 : hubResponse.status,
    });
  } catch (error) {
    console.error('[previewAdminProductionInventoryDeduction] Error');
    return Response.json({
      success: false,
      dry_run: true,
      error: 'Unable to preview production inventory deduction',
      error_code: 'internal_error',
    }, { status: 500 });
  }
});
