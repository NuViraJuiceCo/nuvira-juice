import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_TASK_IDS = 10;

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'expected_status',
  'request_id',
  'fulfillment_task_ids',
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

function normalizeStatus(value) {
  const text = normalizeSingleLine(value);
  if (!text) throw new Error('expected_status is required');
  if (text.length > 80 || !/^[A-Za-z0-9._ -]+$/.test(text)) {
    throw new Error('expected_status contains unsupported characters');
  }
  return text;
}

function normalizeReason(value) {
  if (value === undefined || value === null || value === '') return '';
  const reason = sanitizeText(value, 180);
  if (!reason) throw new Error('reason contains unsupported content');
  return reason;
}

function normalizeTaskIds(value) {
  if (!Array.isArray(value)) throw new Error('fulfillment_task_ids must be an array');
  if (value.length === 0) throw new Error('fulfillment_task_ids is required');
  if (value.length > MAX_TASK_IDS) throw new Error('too many fulfillment_task_ids');

  const taskIds = value.map((item) => normalizeId(item, 'fulfillment_task_id'));
  if (new Set(taskIds).size !== taskIds.length) throw new Error('duplicate fulfillment_task_ids are not allowed');
  return taskIds;
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

function safeStringArray(value, itemLength = 180) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_TASK_IDS)
    .map((item) => sanitizeText(item, itemLength))
    .filter(Boolean);
}

function sanitizeHubResponse(data, requestId) {
  return {
    success: data?.success === true,
    production_batch_id: sanitizeText(data?.production_batch_id, 180) || null,
    batch_id: sanitizeText(data?.batch_id, 180) || null,
    previous_status: sanitizeText(data?.previous_status, 80) || null,
    status: sanitizeText(data?.status, 80) || null,
    production_date: sanitizeText(data?.production_date, 40) || null,
    fulfillment_task_ids: safeStringArray(data?.fulfillment_task_ids, 180),
    packed_task_count: Number(data?.packed_task_count) || 0,
    skipped_task_count: Number(data?.skipped_task_count) || 0,
    request_id: sanitizeText(data?.request_id || requestId, 180) || null,
    skipped: data?.skipped === true,
    updated_at: sanitizeText(data?.updated_at, 80) || null,
    cascades_deferred: data?.cascades_deferred === true,
    order_cascade_deferred: data?.order_cascade_deferred !== false,
  };
}

function safeHubError(data, fallback = 'Unable to pack Hub production fulfillment tasks') {
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
      return Response.json({ success: false, error: 'malformed_json', error_code: 'malformed_json' }, { status: 400 });
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
    let expectedStatus;
    let requestId;
    let fulfillmentTaskIds;
    let reason;

    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      batchId = normalizeId(body.batch_id, 'batch_id');
      expectedStatus = normalizeStatus(body.expected_status);
      requestId = normalizeId(body.request_id, 'request_id');
      fulfillmentTaskIds = normalizeTaskIds(body.fulfillment_task_ids);
      reason = normalizeReason(body.reason);
    } catch (error) {
      return Response.json({ error: error.message, error_code: 'invalid_input' }, { status: 400 });
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub production fulfillment task pack service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const hubBody = {
      production_batch_id: productionBatchId,
      batch_id: batchId,
      expected_status: expectedStatus,
      request_id: requestId,
      fulfillment_task_ids: fulfillmentTaskIds,
      actor_email: user.email,
      actor_role: user.role,
      source: 'customer_app_admin',
    };

    if (reason) hubBody.reason = reason;

    const hubResponse = await fetch(`${hubBase}/functions/packProductionVerifyFulfillmentTasksForCustomerApp`, {
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
    console.error('[packAdminProductionVerifyFulfillmentTasks] Error');
    return Response.json({ error: 'Unable to pack Hub production fulfillment tasks' }, { status: 500 });
  }
});
