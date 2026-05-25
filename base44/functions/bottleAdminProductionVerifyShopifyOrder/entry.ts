import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'expected_status',
  'shopify_order_id',
  'expected_production_status',
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

function normalizeId(value, fieldName) {
  const text = normalizeSingleLine(value);
  if (!text) throw new Error(`${fieldName} is required`);
  if (text.length > 180 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
}

function normalizeStatus(value, fieldName) {
  const text = normalizeSingleLine(value);
  if (!text) throw new Error(`${fieldName} is required`);
  if (text.length > 80 || !/^[A-Za-z0-9._ -]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
}

function normalizeReason(value) {
  if (value === undefined || value === null || value === '') return '';
  const reason = sanitizeText(value, 180);
  if (!reason) throw new Error('reason contains unsupported content');
  return reason;
}

function findUnsupportedBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const key of Object.keys(body)) {
    if (!ALLOWED_BODY_KEYS.has(normalizeLower(key))) return key;
  }
  return null;
}

function sanitizeHubResponse(data, requestId) {
  return {
    success: data?.success === true,
    production_batch_id: sanitizeText(data?.production_batch_id, 180) || null,
    batch_id: sanitizeText(data?.batch_id, 180) || null,
    shopify_order_id: sanitizeText(data?.shopify_order_id, 180) || null,
    order_number: sanitizeText(data?.order_number, 80) || null,
    previous_production_status: sanitizeText(data?.previous_production_status, 80) || null,
    production_status: sanitizeText(data?.production_status, 80) || null,
    request_id: sanitizeText(data?.request_id || requestId, 180) || null,
    skipped: data?.skipped === true,
    updated_at: sanitizeText(data?.updated_at, 80) || null,
    customer_app_sync_deferred: data?.customer_app_sync_deferred !== false,
    notifications_deferred: data?.notifications_deferred !== false,
    task_cascade_deferred: data?.task_cascade_deferred !== false,
  };
}

function safeHubError(data, fallback = 'Unable to bottle Hub ShopifyOrder') {
  const error = sanitizeText(data?.error, 180);
  const errorCode = sanitizeText(data?.error_code, 80);
  const message = sanitizeText(data?.message, 220);
  return {
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
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

    const body = await req.json().catch(() => ({}));
    const unsupportedKey = findUnsupportedBodyKey(body);
    if (unsupportedKey) {
      return Response.json({
        error: `Unsupported field: ${unsupportedKey}`,
        error_code: 'unsupported_field',
      }, { status: 400 });
    }

    let productionBatchId;
    let batchId;
    let expectedStatus;
    let shopifyOrderId;
    let expectedProductionStatus;
    let requestId;
    let reason;

    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      batchId = normalizeId(body.batch_id, 'batch_id');
      expectedStatus = normalizeStatus(body.expected_status, 'expected_status');
      shopifyOrderId = normalizeId(body.shopify_order_id, 'shopify_order_id');
      expectedProductionStatus = normalizeStatus(body.expected_production_status, 'expected_production_status');
      requestId = normalizeId(body.request_id, 'request_id');
      reason = normalizeReason(body.reason);
    } catch (error) {
      return Response.json({ error: error.message, error_code: 'invalid_input' }, { status: 400 });
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub ShopifyOrder bottled service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const hubBody = {
      production_batch_id: productionBatchId,
      batch_id: batchId,
      expected_status: expectedStatus,
      shopify_order_id: shopifyOrderId,
      expected_production_status: expectedProductionStatus,
      request_id: requestId,
      actor_email: user.email,
      actor_role: user.role,
      source: 'customer_app_admin',
    };

    if (reason) hubBody.reason = reason;

    const hubResponse = await fetch(`${hubBase}/functions/bottleProductionVerifyShopifyOrderForCustomerApp`, {
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

    return Response.json(sanitizeHubResponse(hubData, requestId));
  } catch {
    console.error('[bottleAdminProductionVerifyShopifyOrder] Error');
    return Response.json({ error: 'Unable to bottle Hub ShopifyOrder' }, { status: 500 });
  }
});
