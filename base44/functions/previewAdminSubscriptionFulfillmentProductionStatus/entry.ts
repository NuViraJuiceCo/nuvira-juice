import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const SAFE_ARRAY_LIMIT = 40;

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'hub_order_id',
  'fulfillment_task_id',
  'fulfillment_number',
  'production_date',
  'delivery_date',
  'expected_task_status',
  'expected_fulfillment_status',
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

function normalizeId(value, fieldName, required = true) {
  const text = normalizeSingleLine(value);
  if (!text) {
    if (required) throw new Error(`${fieldName} is required`);
    return '';
  }
  if (text.length > 180 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
}

function normalizeDate(value, fieldName) {
  const text = normalizeSingleLine(value);
  if (!text) throw new Error(`${fieldName} is required`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${fieldName} must be YYYY-MM-DD`);
  }
  return text;
}

function normalizeFulfillmentNumber(value) {
  const text = normalizeSingleLine(value);
  if (!text) throw new Error('fulfillment_number is required');
  const numberValue = Number(text);
  if (!Number.isInteger(numberValue) || numberValue < 1 || numberValue > 52) {
    throw new Error('fulfillment_number must be a positive integer');
  }
  return numberValue;
}

function normalizeOptionalStatus(value, fieldName) {
  const status = normalizeSingleLine(value);
  if (!status) return '';
  if (status.length > 80 || !/^[A-Za-z0-9._ -]+$/.test(status)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return status;
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

function safeFulfillmentSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const summary = {
    fulfillment_number: Number(value.fulfillment_number) || null,
    current_status: sanitizeText(value.current_status, 80) || null,
    production_date: sanitizeText(value.production_date, 40) || null,
    delivery_date: sanitizeText(value.delivery_date, 40) || null,
    item_count: Number(value.item_count) || 0,
  };

  return Object.fromEntries(Object.entries(summary).filter(([, item]) => item !== null));
}

function sanitizeHubPreviewResponse(data, requestId) {
  return {
    success: data?.success === true,
    dry_run: data?.dry_run === true,
    function_name: sanitizeText(data?.function_name, 120) || null,
    production_batch_id: sanitizeText(data?.production_batch_id, 180) || null,
    batch_id: sanitizeText(data?.batch_id, 180) || null,
    hub_order_id: sanitizeText(data?.hub_order_id, 180) || null,
    fulfillment_task_id: sanitizeText(data?.fulfillment_task_id, 180) || null,
    fulfillment_number: Number(data?.fulfillment_number) || null,
    production_date: sanitizeText(data?.production_date, 40) || null,
    delivery_date: sanitizeText(data?.delivery_date, 40) || null,
    request_id: sanitizeText(data?.request_id || requestId, 180) || null,
    current_batch_status: sanitizeText(data?.current_batch_status, 80) || null,
    parent_order_type: sanitizeText(data?.parent_order_type, 80) || null,
    parent_fulfillment_mode: sanitizeText(data?.parent_fulfillment_mode, 80) || null,
    parent_production_status: sanitizeText(data?.parent_production_status, 80) || null,
    parent_status_will_change: data?.parent_status_will_change === true,
    current_task_status: sanitizeText(data?.current_task_status, 80) || null,
    current_fulfillment_status: sanitizeText(data?.current_fulfillment_status, 80) || null,
    proposed_task_status: sanitizeText(data?.proposed_task_status, 80) || null,
    proposed_fulfillment_status: sanitizeText(data?.proposed_fulfillment_status, 80) || null,
    task_linked_to_batch: data?.task_linked_to_batch === true,
    fulfillment_match_count: Number(data?.fulfillment_match_count) || 0,
    fulfillment_summary: safeFulfillmentSummary(data?.fulfillment_summary),
    customer_facing_status_will_change: data?.customer_facing_status_will_change === true,
    status_history_will_change: data?.status_history_will_change === true,
    notifications_will_send: data?.notifications_will_send === true,
    projected_writes_if_approved: safeStringArray(data?.projected_writes_if_approved, 120),
    live_allowed: data?.live_allowed === true,
    blockers: safeStringArray(data?.blockers, 120),
    warnings: safeStringArray(data?.warnings, 120),
  };
}

function safeHubError(data, fallback = 'Unable to preview Hub subscription fulfillment production status') {
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
    let hubOrderId;
    let fulfillmentTaskId;
    let fulfillmentNumber;
    let productionDate;
    let deliveryDate;
    let expectedTaskStatus;
    let expectedFulfillmentStatus;
    let requestId;

    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      batchId = normalizeId(body.batch_id, 'batch_id');
      hubOrderId = normalizeId(body.hub_order_id, 'hub_order_id');
      fulfillmentTaskId = normalizeId(body.fulfillment_task_id, 'fulfillment_task_id');
      fulfillmentNumber = normalizeFulfillmentNumber(body.fulfillment_number);
      productionDate = normalizeDate(body.production_date, 'production_date');
      deliveryDate = normalizeDate(body.delivery_date, 'delivery_date');
      expectedTaskStatus = normalizeOptionalStatus(body.expected_task_status, 'expected_task_status');
      expectedFulfillmentStatus = normalizeOptionalStatus(body.expected_fulfillment_status, 'expected_fulfillment_status');
      requestId = normalizeId(body.request_id, 'request_id', false);
    } catch (error) {
      return Response.json({ error: error.message, error_code: 'invalid_input' }, { status: 400 });
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub subscription fulfillment production status preview service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const hubBody = {
      production_batch_id: productionBatchId,
      batch_id: batchId,
      hub_order_id: hubOrderId,
      fulfillment_task_id: fulfillmentTaskId,
      fulfillment_number: fulfillmentNumber,
      production_date: productionDate,
      delivery_date: deliveryDate,
    };

    if (expectedTaskStatus) hubBody.expected_task_status = expectedTaskStatus;
    if (expectedFulfillmentStatus) hubBody.expected_fulfillment_status = expectedFulfillmentStatus;
    if (requestId) hubBody.request_id = requestId;

    const hubResponse = await fetch(`${hubBase}/functions/previewSubscriptionFulfillmentProductionStatusForCustomerApp`, {
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
    console.error('[previewAdminSubscriptionFulfillmentProductionStatus] Error');
    return Response.json({ error: 'Unable to preview Hub subscription fulfillment production status' }, { status: 500 });
  }
});
