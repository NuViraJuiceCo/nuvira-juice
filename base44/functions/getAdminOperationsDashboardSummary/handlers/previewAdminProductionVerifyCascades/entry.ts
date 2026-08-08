// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const SAFE_ARRAY_LIMIT = 40;
const SAFE_SUMMARY_LIMIT = 20;

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

function normalizeOptionalStatus(value) {
  const status = normalizeSingleLine(value);
  if (!status) return '';
  if (status.length > 80 || !/^[A-Za-z0-9._ -]+$/.test(status)) {
    throw new Error('expected_status contains unsupported characters');
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

function safeCountMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, SAFE_ARRAY_LIMIT)
      .map(([key, count]) => [sanitizeText(key, 80), Number(count) || 0])
      .filter(([key]) => Boolean(key))
  );
}

function safeTaskUpdateSummaries(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, SAFE_SUMMARY_LIMIT)
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const summary = {
        task_id: sanitizeText(item.task_id, 180) || null,
        order_id: sanitizeText(item.order_id, 180) || null,
        order_number: sanitizeText(item.order_number, 80) || null,
        current_status: sanitizeText(item.current_status, 80) || null,
        projected_status: sanitizeText(item.projected_status, 80) || null,
        current_production_date: sanitizeText(item.current_production_date, 40) || null,
        projected_production_date: sanitizeText(item.projected_production_date, 40) || null,
        scheduled_date: sanitizeText(item.scheduled_date, 40) || null,
        source_type: sanitizeText(item.source_type, 80) || null,
        fulfillment_type: sanitizeText(item.fulfillment_type, 80) || null,
        will_update: item.will_update === true,
        blockers: safeStringArray(item.blockers, 120),
      };
      return Object.fromEntries(Object.entries(summary).filter(([, val]) => (
        val !== null && !(Array.isArray(val) && val.length === 0)
      )));
    })
    .filter(Boolean);
}

function safeOrderUpdateSummaries(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, SAFE_SUMMARY_LIMIT)
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const summary = {
        order_id: sanitizeText(item.order_id, 180) || null,
        order_number: sanitizeText(item.order_number, 80) || null,
        order_type: sanitizeText(item.order_type, 80) || null,
        fulfillment_mode: sanitizeText(item.fulfillment_mode, 80) || null,
        current_production_status: sanitizeText(item.current_production_status, 80) || null,
        projected_production_status: sanitizeText(item.projected_production_status, 80) || null,
        will_update: item.will_update === true,
        blockers: safeStringArray(item.blockers, 120),
      };
      return Object.fromEntries(Object.entries(summary).filter(([, val]) => (
        val !== null && !(Array.isArray(val) && val.length === 0)
      )));
    })
    .filter(Boolean);
}

function sanitizeHubPreviewResponse(data, requestId) {
  return {
    success: data?.success === true,
    dry_run: data?.dry_run === true,
    production_batch_id: sanitizeText(data?.production_batch_id, 180) || null,
    batch_id: sanitizeText(data?.batch_id, 180) || null,
    current_status: sanitizeText(data?.current_status, 80) || null,
    production_date: sanitizeText(data?.production_date, 40) || null,
    verified_at_present: data?.verified_at_present === true,
    verified_by_present: data?.verified_by_present === true,
    compliance_log_id_present: data?.compliance_log_id_present === true,
    is_locked: data?.is_locked === true,
    cascade_preview_allowed: data?.cascade_preview_allowed === true,
    pack_cascade_allowed: data?.pack_cascade_allowed === true,
    bottled_order_cascade_allowed: data?.bottled_order_cascade_allowed === true,
    linked_order_id_count: Number(data?.linked_order_id_count) || 0,
    linked_task_count: Number(data?.linked_task_count) || 0,
    packable_task_count: Number(data?.packable_task_count) || 0,
    blocked_task_count: Number(data?.blocked_task_count) || 0,
    linked_order_count: Number(data?.linked_order_count) || 0,
    eligible_bottled_order_count: Number(data?.eligible_bottled_order_count) || 0,
    blocked_bottled_order_count: Number(data?.blocked_bottled_order_count) || 0,
    subscription_order_count: Number(data?.subscription_order_count) || 0,
    missing_linked_order_count: Number(data?.missing_linked_order_count) || 0,
    task_status_counts: safeCountMap(data?.task_status_counts),
    order_type_counts: safeCountMap(data?.order_type_counts),
    fulfillment_mode_counts: safeCountMap(data?.fulfillment_mode_counts),
    order_production_status_counts: safeCountMap(data?.order_production_status_counts),
    projected_pack_writes: safeStringArray(data?.projected_pack_writes, 120),
    projected_order_writes: safeStringArray(data?.projected_order_writes, 120),
    cascades_split_required: data?.cascades_split_required === true,
    task_update_summaries: safeTaskUpdateSummaries(data?.task_update_summaries),
    order_update_summaries: safeOrderUpdateSummaries(data?.order_update_summaries),
    blockers: safeStringArray(data?.blockers, 120),
    warnings: safeStringArray(data?.warnings, 120),
    ...(requestId ? { request_id: requestId } : {}),
  };
}

function safeHubError(data, fallback = 'Unable to preview Hub production verify cascades') {
  const error = sanitizeText(data?.error, 160);
  const errorCode = sanitizeText(data?.error_code, 80);
  const message = sanitizeText(data?.message, 180);
  return {
    error: error || fallback,
    ...(errorCode ? { error_code: errorCode } : {}),
    ...(message ? { message } : {}),
  };
}

export default async function handler(req: Request) {
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
    let expectedStatus;
    let requestId;

    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      batchId = normalizeId(body.batch_id, 'batch_id', false);
      expectedStatus = normalizeOptionalStatus(body.expected_status);
      requestId = normalizeId(body.request_id, 'request_id', false);
    } catch (error) {
      return Response.json({ error: error.message, error_code: 'invalid_input' }, { status: 400 });
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub production verify cascade preview service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const hubBody = {
      production_batch_id: productionBatchId,
    };

    if (batchId) hubBody.batch_id = batchId;
    if (expectedStatus) hubBody.expected_status = expectedStatus;
    if (requestId) hubBody.request_id = requestId;

    const hubResponse = await fetch(`${hubBase}/functions/previewProductionVerifyCascadesForCustomerApp`, {
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
    console.error('[previewAdminProductionVerifyCascades] Error');
    return Response.json({ error: 'Unable to preview Hub production verify cascades' }, { status: 500 });
  }
}
