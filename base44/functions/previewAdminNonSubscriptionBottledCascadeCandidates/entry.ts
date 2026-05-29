import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const SAFE_ARRAY_LIMIT = 50;

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'limit',
  'request_id',
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

function normalizeOptionalId(value, fieldName) {
  const text = normalizeSingleLine(value);
  if (!text) return '';
  if (text.length > 180 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') return null;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 1 || numberValue > SAFE_ARRAY_LIMIT) {
    throw new Error(`limit must be an integer from 1 to ${SAFE_ARRAY_LIMIT}`);
  }
  return numberValue;
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

function safeStringArray(value, itemLength = 120) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, SAFE_ARRAY_LIMIT)
    .map((item) => sanitizeText(item, itemLength))
    .filter(Boolean);
}

function safeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function safeCandidateSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  return {
    production_batch_id: sanitizeText(value.production_batch_id, 180) || null,
    batch_id: sanitizeText(value.batch_id, 180) || null,
    batch_status: sanitizeText(value.batch_status, 80) || null,
    production_date: sanitizeText(value.production_date, 40) || null,
    is_locked: value.is_locked === true,
    verified_at_present: value.verified_at_present === true,
    verified_by_present: value.verified_by_present === true,
    compliance_log_id_present: value.compliance_log_id_present === true,
    shopify_order_id: sanitizeText(value.shopify_order_id, 180) || null,
    order_number: sanitizeText(value.order_number, 80) || null,
    order_type: sanitizeText(value.order_type, 80) || null,
    fulfillment_mode: sanitizeText(value.fulfillment_mode, 80) || null,
    fulfillment_count: safeNumber(value.fulfillment_count),
    current_production_status: sanitizeText(value.current_production_status, 80) || null,
    projected_production_status: sanitizeText(value.projected_production_status, 80) || null,
    live_allowed: value.live_allowed === true,
    projected_writes: safeStringArray(value.projected_writes, 120),
    customer_app_sync_deferred: value.customer_app_sync_deferred !== false,
    notifications_deferred: value.notifications_deferred !== false,
    blockers: safeStringArray(value.blockers, 120),
    warnings: safeStringArray(value.warnings, 120),
  };
}

function safeCandidateArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, SAFE_ARRAY_LIMIT)
    .map(safeCandidateSummary)
    .filter(Boolean);
}

function sanitizeHubPreviewResponse(data, requestId) {
  return {
    success: data?.success === true,
    dry_run: data?.dry_run === true,
    function_name: sanitizeText(data?.function_name, 120) || null,
    scanned_batch_count: safeNumber(data?.scanned_batch_count),
    scanned_linked_order_count: safeNumber(data?.scanned_linked_order_count),
    missing_order_count: safeNumber(data?.missing_order_count),
    candidate_count: safeNumber(data?.candidate_count),
    blocked_summary_count: safeNumber(data?.blocked_summary_count),
    candidates: safeCandidateArray(data?.candidates),
    blocked_summaries: safeCandidateArray(data?.blocked_summaries),
    projected_writes_if_approved: safeStringArray(data?.projected_writes_if_approved, 120),
    customer_app_sync_deferred: data?.customer_app_sync_deferred !== false,
    notifications_deferred: data?.notifications_deferred !== false,
    request_id: sanitizeText(data?.request_id || requestId, 180) || null,
  };
}

function safeHubError(data, fallback = 'Unable to preview Hub non-subscription bottled candidates') {
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

    const body = await readJsonBody(req);
    if (body === null) {
      return Response.json({ success: false, error: 'malformed_json' }, { status: 400 });
    }

    const unsupportedKey = findUnsupportedBodyKey(body);
    if (unsupportedKey) {
      return Response.json({
        error: `Unsupported field: ${unsupportedKey}`,
        error_code: 'unsupported_field',
      }, { status: 400 });
    }

    let productionBatchId;
    let batchId;
    let limit;
    let requestId;

    try {
      productionBatchId = normalizeOptionalId(body.production_batch_id, 'production_batch_id');
      batchId = normalizeOptionalId(body.batch_id, 'batch_id');
      limit = normalizeLimit(body.limit);
      requestId = normalizeOptionalId(body.request_id, 'request_id');
    } catch (error) {
      return Response.json({ error: error.message, error_code: 'invalid_input' }, { status: 400 });
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub non-subscription bottled candidate preview service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const hubBody = {};

    if (productionBatchId) hubBody.production_batch_id = productionBatchId;
    if (batchId) hubBody.batch_id = batchId;
    if (limit !== null) hubBody.limit = limit;
    if (requestId) hubBody.request_id = requestId;

    const hubResponse = await fetch(`${hubBase}/functions/previewNonSubscriptionBottledCascadeCandidatesForCustomerApp`, {
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

    return Response.json(sanitizeHubPreviewResponse(hubData, requestId));
  } catch {
    console.error('[previewAdminNonSubscriptionBottledCascadeCandidates] Error');
    return Response.json({ error: 'Unable to preview Hub non-subscription bottled candidates' }, { status: 500 });
  }
});
