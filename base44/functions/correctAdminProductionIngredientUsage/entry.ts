import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const SOURCE = 'customer_app_admin';
const MAX_REASON_LENGTH = 300;
const MAX_PREVIEW_ROWS = 50;

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'expected_status',
  'request_id',
  'reason',
]);

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizeLower(value) {
  return normalizeSingleLine(value).toLowerCase();
}

function sanitizeText(value, maxLength = 160) {
  const text = normalizeSingleLine(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');

  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeId(value, fieldName) {
  const text = normalizeSingleLine(value);
  if (!text) throw new Error(`${fieldName} is required`);
  if (text.length > 180 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
}

function normalizeExpectedStatus(value) {
  const status = normalizeSingleLine(value);
  if (!status) throw new Error('expected_status is required');
  if (status.length > 80 || !/^[A-Za-z0-9._ -]+$/.test(status)) {
    throw new Error('expected_status contains unsupported characters');
  }
  return status;
}

function normalizeActorEmail(value) {
  const email = normalizeSingleLine(value).toLowerCase();
  if (!email || email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Authenticated admin email is unavailable');
  }
  return email;
}

function findUnsupportedBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  for (const key of Object.keys(body)) {
    if (!ALLOWED_BODY_KEYS.has(normalizeLower(key))) return key;
  }

  return null;
}

async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function sanitizeIngredientPreviewRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  return {
    ingredient_name: sanitizeText(row.ingredient_name, 120) || null,
    quantity: safeNumber(row.quantity),
    unit: sanitizeText(row.unit, 20) || null,
  };
}

function sanitizeHubCommandResponse(data, requestId) {
  return {
    success: data?.success === true,
    production_batch_id: sanitizeText(data?.production_batch_id, 180) || null,
    batch_id: sanitizeText(data?.batch_id, 180) || null,
    status: sanitizeText(data?.status, 80) || null,
    request_id: sanitizeText(data?.request_id, 180) || requestId || null,
    skipped: data?.skipped === true,
    updated_at: sanitizeText(data?.updated_at, 80) || null,
    previous_ingredients_used_count: safeNumber(data?.previous_ingredients_used_count),
    ingredients_used_count: safeNumber(data?.ingredients_used_count),
    ingredients_used_preview: Array.isArray(data?.ingredients_used_preview)
      ? data.ingredients_used_preview.slice(0, MAX_PREVIEW_ROWS).map(sanitizeIngredientPreviewRow).filter(Boolean)
      : [],
    inventory_stock_changes_deferred: data?.inventory_stock_changes_deferred === true,
    purchase_order_changes_deferred: data?.purchase_order_changes_deferred === true,
    batch_compliance_log_changes_deferred: data?.batch_compliance_log_changes_deferred === true,
    customer_app_sync_deferred: data?.customer_app_sync_deferred === true,
    notifications_deferred: data?.notifications_deferred === true,
  };
}

function safeHubError(data, fallback = 'Unable to correct Hub production ingredient usage') {
  const error = sanitizeText(data?.error, 160);
  const errorCode = sanitizeText(data?.error_code, 80);
  const message = sanitizeText(data?.message, 180);
  return {
    success: false,
    error: error || fallback,
    ...(errorCode ? { error_code: errorCode } : {}),
    ...(message ? { message } : {}),
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ success: false, error: 'Unauthorized', error_code: 'unauthorized' }, { status: 401 });
    }

    if (!user) return Response.json({ success: false, error: 'Unauthorized', error_code: 'unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ success: false, error: 'Forbidden', error_code: 'forbidden' }, { status: 403 });
    if (req.method !== 'POST') {
      return Response.json({ success: false, error: 'Method not allowed', error_code: 'method_not_allowed' }, { status: 405 });
    }

    const body = await readJsonBody(req);
    if (body === null) {
      return Response.json({ success: false, error: 'malformed_json', error_code: 'malformed_json' }, { status: 400 });
    }

    const unsupportedKey = findUnsupportedBodyKey(body);
    if (unsupportedKey) {
      return Response.json({
        success: false,
        error: 'Unsupported request field',
        error_code: 'unsupported_field',
      }, { status: 400 });
    }

    let requestId;
    let hubBody;

    try {
      requestId = normalizeId(body.request_id, 'request_id');
      hubBody = {
        production_batch_id: normalizeId(body.production_batch_id, 'production_batch_id'),
        batch_id: normalizeId(body.batch_id, 'batch_id'),
        expected_status: normalizeExpectedStatus(body.expected_status),
        request_id: requestId,
        actor_email: normalizeActorEmail(user.email),
        actor_role: sanitizeText(user.role, 60),
        source: SOURCE,
      };

      if (!hubBody.actor_role) throw new Error('Authenticated admin role is unavailable');

      const reason = sanitizeText(body.reason, MAX_REASON_LENGTH);
      if (reason) hubBody.reason = reason;
    } catch (error) {
      return Response.json({ success: false, error: error.message, error_code: 'invalid_input' }, { status: 400 });
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({
        success: false,
        error: 'Hub ingredient usage correction command service is not configured',
        error_code: 'hub_not_configured',
      }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const hubResponse = await fetch(`${hubBase}/functions/correctProductionIngredientUsageForCustomerApp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify(hubBody),
    });

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubResponse.ok) {
      return Response.json({
        ...safeHubError(hubData),
        hub_status: hubResponse.status,
      }, { status: hubResponse.status >= 400 && hubResponse.status < 500 ? hubResponse.status : 502 });
    }

    return Response.json({
      ...sanitizeHubCommandResponse(hubData, requestId),
      hub_status: hubResponse.status,
    });
  } catch {
    console.error('[correctAdminProductionIngredientUsage] Error');
    return Response.json({
      success: false,
      error: 'Unable to correct Hub production ingredient usage',
      error_code: 'internal_error',
    }, { status: 500 });
  }
});
