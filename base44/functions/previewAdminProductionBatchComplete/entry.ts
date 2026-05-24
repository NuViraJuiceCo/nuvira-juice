import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const SAFE_ARRAY_LIMIT = 40;
const SAFE_SUMMARY_LIMIT = 10;

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'expected_status',
  'request_id',
  'actual_units',
  'actual_quantity_produced',
  'bottles_produced',
  'bottles_rejected_or_wasted',
  'final_usable_quantity',
  'storage_location',
  'use_by_date',
  'pH_result',
  'pH_passed_failed',
  'pH_meter_id',
  'calibration_checked',
  'ccp_check_complete',
  'sanitation_verification_complete',
  'labels_applied',
  'passed_failed',
  'notes',
]);

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function sanitizeText(value, maxLength = 160) {
  const text = normalizeSingleLine(value)
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

function normalizeNumber(value, fieldName, { required = false, positive = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new Error(`${fieldName} is required`);
    return null;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) throw new Error(`${fieldName} must be a number`);
  if (positive && numberValue <= 0) throw new Error(`${fieldName} must be greater than 0`);
  if (!positive && numberValue < 0) throw new Error(`${fieldName} must be greater than or equal to 0`);
  return numberValue;
}

function normalizeBoolean(value) {
  return value === true;
}

function normalizeIsoDate(value, fieldName) {
  const text = normalizeSingleLine(value);
  if (!text) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${fieldName} must be YYYY-MM-DD`);
  return text;
}

function normalizePassedFailed(value, fieldName, required = false) {
  const text = normalizeSingleLine(value).toLowerCase();
  if (!text) {
    if (required) throw new Error(`${fieldName} is required`);
    return '';
  }
  if (!['passed', 'failed'].includes(text)) throw new Error(`${fieldName} must be passed or failed`);
  return text;
}

function findUnsupportedBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const key of Object.keys(body)) {
    if (!ALLOWED_BODY_KEYS.has(normalizeSingleLine(key))) return key;
  }
  return null;
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

function safeOrderSourceSummaries(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, SAFE_SUMMARY_LIMIT).map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const summary = {};
    const sourceType = sanitizeText(item.source_type, 80);
    const orderNumber = sanitizeText(item.order_number, 80);
    const customerName = sanitizeText(item.customer_name, 100);
    const customerEmail = sanitizeText(item.customer_email, 120);
    if (sourceType) summary.source_type = sourceType;
    if (orderNumber) summary.order_number = orderNumber;
    if (customerName) summary.customer_name = customerName;
    if (customerEmail) summary.customer_email = customerEmail;
    return Object.keys(summary).length > 0 ? summary : null;
  }).filter(Boolean);
}

function sanitizeHubPreviewResponse(data, requestId) {
  return {
    success: data?.success === true,
    dry_run: data?.dry_run === true,
    production_batch_id: sanitizeText(data?.production_batch_id, 180) || null,
    batch_id: sanitizeText(data?.batch_id, 180) || null,
    current_status: sanitizeText(data?.current_status, 80) || null,
    eligible_status: data?.eligible_status === true,
    is_locked: data?.is_locked === true,
    actual_start_time_present: data?.actual_start_time_present === true,
    order_sources_count: Number(data?.order_sources_count) || 0,
    order_source_type_counts: safeCountMap(data?.order_source_type_counts),
    customer_context_present: data?.customer_context_present === true,
    customer_context_allowed_for_preview: data?.customer_context_allowed_for_preview === true,
    order_sources_preview_allowed: data?.order_sources_preview_allowed === true,
    safe_order_source_summaries: safeOrderSourceSummaries(data?.safe_order_source_summaries),
    manual_source_count: Number(data?.manual_source_count) || 0,
    linked_order_count: Number(data?.linked_order_count) || 0,
    compliance_finalization_present: data?.compliance_finalization_present === true,
    inventory_po_linkage_present: data?.inventory_po_linkage_present === true,
    proof_drop_present: data?.proof_drop_present === true,
    provider_payment_linkage_present: data?.provider_payment_linkage_present === true,
    recalculation_risk: data?.recalculation_risk === true,
    prior_lifecycle_conflict: data?.prior_lifecycle_conflict === true,
    projected_writes: safeStringArray(data?.projected_writes, 120),
    live_allowed: data?.live_allowed === true,
    blockers: safeStringArray(data?.blockers, 120),
    warnings: safeStringArray(data?.warnings, 120),
    ...(requestId ? { request_id: requestId } : {}),
  };
}

function safeHubError(data, fallback = 'Unable to preview Hub production batch completion') {
  const error = sanitizeText(data?.error, 160);
  const errorCode = sanitizeText(data?.error_code, 80);
  const message = sanitizeText(data?.message, 180);
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
    let requestId;
    let hubBody;
    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      requestId = normalizeId(body.request_id, 'request_id', false);
      hubBody = {
        production_batch_id: productionBatchId,
      };

      const batchId = normalizeId(body.batch_id, 'batch_id', false);
      const expectedStatus = normalizeOptionalStatus(body.expected_status);
      const actualUnits = normalizeNumber(body.actual_units ?? body.actual_quantity_produced, 'actual_units', {
        required: true,
        positive: true,
      });
      const pHResult = normalizeNumber(body.pH_result, 'pH_result', { required: true, positive: true });
      const pHStatus = normalizePassedFailed(body.pH_passed_failed, 'pH_passed_failed', true);
      const passedFailed = normalizePassedFailed(body.passed_failed, 'passed_failed', true);
      const bottlesProduced = normalizeNumber(body.bottles_produced, 'bottles_produced', { positive: true });
      const bottlesRejectedOrWasted = normalizeNumber(body.bottles_rejected_or_wasted, 'bottles_rejected_or_wasted');
      const finalUsableQuantity = normalizeNumber(body.final_usable_quantity, 'final_usable_quantity', { positive: true });
      const storageLocation = sanitizeText(body.storage_location, 80);
      const useByDate = normalizeIsoDate(body.use_by_date, 'use_by_date');
      const pHMeterId = sanitizeText(body.pH_meter_id, 80);
      const notes = sanitizeText(body.notes, 300);

      if (batchId) hubBody.batch_id = batchId;
      if (expectedStatus) hubBody.expected_status = expectedStatus;
      if (requestId) hubBody.request_id = requestId;
      hubBody.actual_units = actualUnits;
      hubBody.pH_result = pHResult;
      hubBody.pH_passed_failed = pHStatus;
      hubBody.passed_failed = passedFailed;
      if (bottlesProduced !== null) hubBody.bottles_produced = bottlesProduced;
      if (bottlesRejectedOrWasted !== null) hubBody.bottles_rejected_or_wasted = bottlesRejectedOrWasted;
      if (finalUsableQuantity !== null) hubBody.final_usable_quantity = finalUsableQuantity;
      if (storageLocation) hubBody.storage_location = storageLocation;
      if (useByDate) hubBody.use_by_date = useByDate;
      if (pHMeterId) hubBody.pH_meter_id = pHMeterId;
      if (notes) hubBody.notes = notes;
      hubBody.calibration_checked = normalizeBoolean(body.calibration_checked);
      hubBody.ccp_check_complete = normalizeBoolean(body.ccp_check_complete);
      hubBody.sanitation_verification_complete = normalizeBoolean(body.sanitation_verification_complete);
      hubBody.labels_applied = normalizeBoolean(body.labels_applied);
    } catch (error) {
      return Response.json({ error: error.message, error_code: 'invalid_input' }, { status: 400 });
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub production batch complete preview service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const hubResponse = await fetch(`${hubBase}/functions/previewProductionBatchCompleteForCustomerApp`, {
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
    console.error('[previewAdminProductionBatchComplete] Error');
    return Response.json({ error: 'Unable to preview Hub production batch completion' }, { status: 500 });
  }
});
