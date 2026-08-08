// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_TEXT_LENGTH = 180;
const MAX_ARRAY_LENGTH = 60;
const MAX_PREVIEW_ROWS = 60;

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'expected_status',
  'request_id',
]);

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function sanitizeText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = normalizeSingleLine(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');

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

function sanitizeStringArray(values, limit = MAX_ARRAY_LENGTH) {
  if (!Array.isArray(values)) return [];
  return values
    .slice(0, limit)
    .map(value => sanitizeText(value, 120))
    .filter(Boolean);
}

function sanitizeInventoryMatch(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  return {
    inventory_item_id: sanitizeText(item.inventory_item_id, 120),
    inventory_item_name: sanitizeText(item.inventory_item_name, 160),
    current_stock: safeNumber(item.current_stock),
    unit: sanitizeText(item.unit, 40),
    reorder_point: safeNumber(item.reorder_point),
    max_stock: safeNumber(item.max_stock),
    category: sanitizeText(item.category, 100),
    supplier: sanitizeText(item.supplier, 160),
    location: sanitizeText(item.location, 160),
  };
}

function sanitizeYieldMatch(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  return {
    yield_record_id: sanitizeText(item.yield_record_id, 120),
    ingredient_name: sanitizeText(item.ingredient_name, 160),
    purchase_unit: sanitizeText(item.purchase_unit, 80),
    oz_per_purchase_unit: safeNumber(item.oz_per_purchase_unit),
    trim_waste_factor: safeNumber(item.trim_waste_factor),
    units_per_case: safeNumber(item.units_per_case),
    rounding_rule: sanitizeText(item.rounding_rule, 100),
    supplier: sanitizeText(item.supplier, 160),
  };
}

function sanitizeProposedUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    ingredient_name: sanitizeText(value.ingredient_name, 160),
    quantity: safeNumber(value.quantity),
    unit: sanitizeText(value.unit, 40),
    lot_number: sanitizeText(value.lot_number, 80),
    source: sanitizeText(value.source, 100),
  };
}

function sanitizePreviewRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  return {
    matched_recipe_ingredient_name: sanitizeText(row.matched_recipe_ingredient_name, 160),
    recipe_quantity_oz_per_unit: safeNumber(row.recipe_quantity_oz_per_unit),
    recipe_unit_label: sanitizeText(row.recipe_unit_label, 40),
    actual_units: safeNumber(row.actual_units),
    recipe_yield_factor: safeNumber(row.recipe_yield_factor),
    proposed_ingredient_usage: sanitizeProposedUsage(row.proposed_ingredient_usage),
    proposed_deduction_quantity: safeNumber(row.proposed_deduction_quantity),
    projected_stock_after_deduction: safeNumber(row.projected_stock_after_deduction),
    shortfall_quantity: safeNumber(row.shortfall_quantity),
    usage_row_ready: row.usage_row_ready === true,
    inventory_match_found: row.inventory_match_found === true,
    yield_match_found: row.yield_match_found === true,
    stock_available: row.stock_available === true,
    procurement_needed: row.procurement_needed === true,
    inventory_deduction_ready: row.inventory_deduction_ready === true,
    inventory_match_count: safeNumber(row.inventory_match_count) || 0,
    inventory_matches: Array.isArray(row.inventory_matches)
      ? row.inventory_matches.slice(0, 10).map(sanitizeInventoryMatch).filter(Boolean)
      : [],
    yield_match_count: safeNumber(row.yield_match_count) || 0,
    yield_matches: Array.isArray(row.yield_matches)
      ? row.yield_matches.slice(0, 10).map(sanitizeYieldMatch).filter(Boolean)
      : [],
    status: sanitizeText(row.status, 60),
    correction_blockers: sanitizeStringArray(row.correction_blockers, 20),
    deduction_blockers: sanitizeStringArray(row.deduction_blockers, 20),
    blockers: sanitizeStringArray(row.blockers, 20),
    warnings: sanitizeStringArray(row.warnings, 20),
  };
}

function sanitizeHubResponse(data, hubStatus) {
  return {
    success: data?.success === true,
    dry_run: data?.dry_run === true,
    function_name: sanitizeText(data?.function_name, 120),
    production_batch_id: sanitizeText(data?.production_batch_id, 120),
    batch_id: sanitizeText(data?.batch_id, 180),
    current_status: sanitizeText(data?.current_status, 80),
    expected_status_match: data?.expected_status_match === true,
    request_id: sanitizeText(data?.request_id, 140),
    product_name: sanitizeText(data?.product_name, 180),
    product_category: sanitizeText(data?.product_category, 80),
    production_date: sanitizeText(data?.production_date, 80),
    actual_units: safeNumber(data?.actual_units),
    existing_ingredients_used_count: safeNumber(data?.existing_ingredients_used_count) || 0,
    compliance_log_id: sanitizeText(data?.compliance_log_id, 120),
    compliance_log_ingredients_count: safeNumber(data?.compliance_log_ingredients_count) || 0,
    prior_deduction_log_present: data?.prior_deduction_log_present === true,
    recipe_match_present: data?.recipe_match_present === true,
    recipe_id: sanitizeText(data?.recipe_id, 120),
    recipe_product_name: sanitizeText(data?.recipe_product_name, 180),
    recipe_yield_factor: safeNumber(data?.recipe_yield_factor),
    recipe_ingredients_count: safeNumber(data?.recipe_ingredients_count) || 0,
    usage_correction_preview_count: safeNumber(data?.usage_correction_preview_count) || 0,
    usage_correction_ready_count: safeNumber(data?.usage_correction_ready_count) || 0,
    usage_correction_allowed: data?.usage_correction_allowed === true,
    proposed_ingredient_usage_count: safeNumber(data?.proposed_ingredient_usage_count) || 0,
    proposed_ingredient_usage_ready_count: safeNumber(data?.proposed_ingredient_usage_ready_count) || 0,
    proposed_ingredient_usage_rows: Array.isArray(data?.proposed_ingredient_usage_rows)
      ? data.proposed_ingredient_usage_rows.slice(0, MAX_PREVIEW_ROWS).map(sanitizePreviewRow).filter(Boolean)
      : [],
    inventory_item_count_scanned: safeNumber(data?.inventory_item_count_scanned) || 0,
    ingredient_yield_count_scanned: safeNumber(data?.ingredient_yield_count_scanned) || 0,
    projected_writes_if_approved: sanitizeStringArray(data?.projected_writes_if_approved, 20),
    inventory_stock_changes_deferred: data?.inventory_stock_changes_deferred === true,
    purchase_order_changes_deferred: data?.purchase_order_changes_deferred === true,
    batch_compliance_log_changes_deferred: data?.batch_compliance_log_changes_deferred === true,
    customer_app_sync_deferred: data?.customer_app_sync_deferred === true,
    notifications_deferred: data?.notifications_deferred === true,
    procurement_needed: data?.procurement_needed === true,
    procurement_needed_count: safeNumber(data?.procurement_needed_count) || 0,
    live_allowed: data?.live_allowed === true,
    inventory_deduction_ready: data?.inventory_deduction_ready === true,
    deduction_blockers: sanitizeStringArray(data?.deduction_blockers, 60),
    correction_blockers: sanitizeStringArray(data?.correction_blockers, 60),
    blockers: sanitizeStringArray(data?.blockers, 60),
    warnings: sanitizeStringArray(data?.warnings, 60),
    error: sanitizeText(data?.error, 180),
    error_code: sanitizeText(data?.error_code, 100),
    message: sanitizeText(data?.message, 220),
    hub_status: hubStatus,
  };
}

function buildHubBody(body) {
  const hubBody = {
    production_batch_id: normalizeText(body.production_batch_id),
  };

  if (normalizeText(body.batch_id)) hubBody.batch_id = normalizeText(body.batch_id);
  if (normalizeText(body.expected_status)) hubBody.expected_status = normalizeText(body.expected_status);
  if (normalizeText(body.request_id)) hubBody.request_id = sanitizeText(body.request_id, 140);
  return hubBody;
}

export default async function handler(req: Request) {
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
        error: 'Hub ingredient usage preview is not configured',
        error_code: 'hub_not_configured',
      }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const hubResponse = await fetch(`${hubBase}/functions/previewProductionIngredientUsageCorrectionForCustomerApp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify(buildHubBody(body)),
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
  } catch {
    console.error('[previewAdminProductionIngredientUsageCorrection] Error');
    return Response.json({
      success: false,
      dry_run: true,
      error: 'Unable to preview production ingredient usage correction',
      error_code: 'internal_error',
    }, { status: 500 });
  }
}
