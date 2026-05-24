import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const SOURCE = 'customer_app_admin';
const MAX_NOTES_LENGTH = 300;
const MAX_REASON_LENGTH = 300;

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'request_id',
  'batch_id',
  'expected_status',
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

function normalizeActorEmail(value) {
  const email = normalizeSingleLine(value).toLowerCase();
  if (!email || email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Authenticated admin email is unavailable');
  }
  return email;
}

function normalizeNumber(value, fieldName, { required = false, positive = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new Error(`${fieldName} is required`);
    return null;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`${fieldName} must be a number`);
  }
  if (positive && numberValue <= 0) {
    throw new Error(`${fieldName} must be greater than 0`);
  }
  if (!positive && numberValue < 0) {
    throw new Error(`${fieldName} must be greater than or equal to 0`);
  }
  return numberValue;
}

function normalizeBoolean(value) {
  return value === true;
}

function normalizeIsoDate(value, fieldName) {
  const text = normalizeSingleLine(value);
  if (!text) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${fieldName} must be YYYY-MM-DD`);
  }
  return text;
}

function normalizePassedFailed(value, fieldName, required = true) {
  const text = normalizeLower(value);
  if (!text) {
    if (required) throw new Error(`${fieldName} is required`);
    return '';
  }
  if (!['passed', 'failed'].includes(text)) {
    throw new Error(`${fieldName} must be passed or failed`);
  }
  return text;
}

function findUnsupportedBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  for (const key of Object.keys(body)) {
    const normalized = normalizeSingleLine(key);
    if (!ALLOWED_BODY_KEYS.has(normalized)) return key;
  }

  return null;
}

function sanitizeHubCommandResponse(data, requestId) {
  return {
    success: data?.success === true,
    production_batch_id: sanitizeText(data?.production_batch_id, 180) || null,
    batch_id: sanitizeText(data?.batch_id, 180) || null,
    previous_status: sanitizeText(data?.previous_status, 80) || null,
    status: sanitizeText(data?.status, 80) || null,
    completed_at: sanitizeText(data?.completed_at, 80) || null,
    request_id: sanitizeText(data?.request_id, 180) || requestId || null,
    skipped: data?.skipped === true,
    updated_at: sanitizeText(data?.updated_at, 80) || null,
    fake_test_only: data?.fake_test_only === true,
    real_complete_enabled: data?.real_complete_enabled === true,
    real_batch_allowlisted: data?.real_batch_allowlisted === true,
    verification_excluded: data?.verification_excluded === true,
    linked_manual_batch_updated: data?.linked_manual_batch_updated === true,
    linked_manual_batch_updated_count: Number(data?.linked_manual_batch_updated_count) || 0,
  };
}

function safeHubError(data, fallback = 'Unable to complete Hub production batch') {
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

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

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
    let batchId;
    let expectedStatus;
    let hubBody;

    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      requestId = normalizeId(body.request_id, 'request_id');
      batchId = normalizeId(body.batch_id, 'batch_id', false);
      expectedStatus = normalizeOptionalStatus(body.expected_status);

      hubBody = {
        production_batch_id: productionBatchId,
        request_id: requestId,
        actor_email: normalizeActorEmail(user.email),
        actor_role: sanitizeText(user.role, 60),
        source: SOURCE,
        actual_units: normalizeNumber(body.actual_units ?? body.actual_quantity_produced, 'actual_units', {
          required: true,
          positive: true,
        }),
        pH_result: normalizeNumber(body.pH_result, 'pH_result', { required: true, positive: true }),
        pH_passed_failed: normalizePassedFailed(body.pH_passed_failed, 'pH_passed_failed'),
        passed_failed: normalizePassedFailed(body.passed_failed, 'passed_failed'),
      };

      if (batchId) hubBody.batch_id = batchId;
      if (expectedStatus) hubBody.expected_status = expectedStatus;

      const bottlesProduced = normalizeNumber(body.bottles_produced, 'bottles_produced', { positive: true });
      const bottlesRejectedOrWasted = normalizeNumber(body.bottles_rejected_or_wasted, 'bottles_rejected_or_wasted');
      const finalUsableQuantity = normalizeNumber(body.final_usable_quantity, 'final_usable_quantity', { positive: true });
      const storageLocation = sanitizeText(body.storage_location, 80);
      const useByDate = normalizeIsoDate(body.use_by_date, 'use_by_date');
      const pHMeterId = sanitizeText(body.pH_meter_id, 80);
      const notes = sanitizeText(body.notes, MAX_NOTES_LENGTH);
      const reason = sanitizeText(body.reason, MAX_REASON_LENGTH);

      if (bottlesProduced !== null) hubBody.bottles_produced = bottlesProduced;
      if (bottlesRejectedOrWasted !== null) hubBody.bottles_rejected_or_wasted = bottlesRejectedOrWasted;
      if (finalUsableQuantity !== null) hubBody.final_usable_quantity = finalUsableQuantity;
      if (storageLocation) hubBody.storage_location = storageLocation;
      if (useByDate) hubBody.use_by_date = useByDate;
      if (pHMeterId) hubBody.pH_meter_id = pHMeterId;
      if (notes) hubBody.notes = notes;
      if (reason) hubBody.reason = reason;

      hubBody.calibration_checked = normalizeBoolean(body.calibration_checked);
      hubBody.ccp_check_complete = normalizeBoolean(body.ccp_check_complete);
      hubBody.sanitation_verification_complete = normalizeBoolean(body.sanitation_verification_complete);
      hubBody.labels_applied = normalizeBoolean(body.labels_applied);
    } catch (error) {
      return Response.json({ error: error.message, error_code: 'invalid_input' }, { status: 400 });
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub production batch complete command service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const hubResponse = await fetch(`${hubBase}/functions/completeProductionBatchForCustomerApp`, {
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

    return Response.json(sanitizeHubCommandResponse(hubData, requestId));
  } catch {
    console.error('[completeAdminProductionBatch] Error');
    return Response.json({ error: 'Unable to complete Hub production batch' }, { status: 500 });
  }
});
