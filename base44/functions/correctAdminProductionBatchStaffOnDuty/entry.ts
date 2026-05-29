import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const SOURCE = 'customer_app_admin';
const MAX_REASON_LENGTH = 300;
const MAX_STAFF_COUNT = 12;
const MAX_STAFF_LENGTH = 80;
const TARGET_PRODUCTION_BATCH_ID = '6a0801a8c1bc6f6b2cbfb174';
const TARGET_BATCH_ID = 'BATCH-20260522-RE-NU';

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'request_id',
  'staff_on_duty',
  'reason',
]);

const PLACEHOLDER_STAFF_VALUES = new Set([
  'paste exact approved staff values here',
  'paste exact staff on duty value here',
  'paste_exact_approved_staff_values_here',
  '[paste exact staff on duty value here]',
  '[paste_exact_approved_staff_values_here]',
  'unknown',
  'tbd',
  'test',
  'none',
  'n/a',
  'na',
  'placeholder',
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
    const normalized = normalizeLower(key);
    if (!ALLOWED_BODY_KEYS.has(normalized)) return key;
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

function normalizeStaffOnDuty(value) {
  if (!Array.isArray(value)) throw new Error('staff_on_duty must be an array');
  if (value.length > MAX_STAFF_COUNT) throw new Error('staff_on_duty contains too many entries');

  const staff = value.map((entry) => {
    if (typeof entry !== 'string') throw new Error('staff_on_duty values must be strings');
    const text = normalizeSingleLine(entry);
    if (!text) throw new Error('staff_on_duty cannot include empty values');
    if (text.length > MAX_STAFF_LENGTH) throw new Error('staff_on_duty contains an overly long value');
    return text;
  });

  const deduped = [...new Set(staff)];
  if (deduped.length === 0) throw new Error('staff_on_duty must include at least one approved staff value');

  for (const entry of deduped) {
    const normalized = normalizeLower(entry);
    if (PLACEHOLDER_STAFF_VALUES.has(normalized) || normalized.includes('paste exact')) {
      throw new Error('staff_on_duty contains a placeholder value');
    }
    if (!/^[A-Za-z0-9 .,'&()/-]+$/.test(entry)) {
      throw new Error('staff_on_duty contains unsupported characters');
    }
  }

  return deduped;
}

function sanitizeHubCorrectionResponse(data, requestId) {
  return {
    success: data?.success === true,
    production_batch_id: sanitizeText(data?.production_batch_id, 180) || null,
    batch_id: sanitizeText(data?.batch_id, 180) || null,
    previous_staff_on_duty_count: Number(data?.previous_staff_on_duty_count) || 0,
    staff_on_duty_count: Number(data?.staff_on_duty_count) || 0,
    status: sanitizeText(data?.status, 80) || null,
    request_id: sanitizeText(data?.request_id, 180) || requestId || null,
    skipped: data?.skipped === true,
    updated_at: sanitizeText(data?.updated_at, 80) || null,
  };
}

function safeHubError(data, fallback = 'Unable to correct Hub production batch staff on duty') {
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
    let requestId;
    let staffOnDuty;
    let reason;

    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      batchId = normalizeId(body.batch_id, 'batch_id');
      requestId = normalizeId(body.request_id, 'request_id');
      staffOnDuty = normalizeStaffOnDuty(body.staff_on_duty);
      reason = sanitizeText(body.reason, MAX_REASON_LENGTH);
    } catch (error) {
      return Response.json({ error: error.message, error_code: 'invalid_input' }, { status: 400 });
    }

    if (productionBatchId !== TARGET_PRODUCTION_BATCH_ID || batchId !== TARGET_BATCH_ID) {
      return Response.json({
        error: 'Batch is not approved for staff correction',
        error_code: 'batch_not_allowlisted',
      }, { status: 409 });
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub production batch staff correction service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const hubBody = {
      production_batch_id: productionBatchId,
      batch_id: batchId,
      request_id: requestId,
      staff_on_duty: staffOnDuty,
      actor_email: normalizeActorEmail(user.email),
      actor_role: sanitizeText(user.role, 60),
      source: SOURCE,
    };

    if (reason) {
      hubBody.reason = reason;
    }

    const hubResponse = await fetch(`${hubBase}/functions/correctProductionBatchStaffOnDutyForCustomerApp`, {
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

    return Response.json(sanitizeHubCorrectionResponse(hubData, requestId));
  } catch {
    console.error('[correctAdminProductionBatchStaffOnDuty] Error');
    return Response.json({ error: 'Unable to correct Hub production batch staff on duty' }, { status: 500 });
  }
});
