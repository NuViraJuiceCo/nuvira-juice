// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const SOURCE = 'customer_app_admin';
const MAX_REASON_LENGTH = 300;
const MAX_DROP_LOCATION_LENGTH = 120;
const MAX_DELIVERY_NOTES_LENGTH = 300;
const MAX_DELIVERY_PHOTO_URL_LENGTH = 500;
const ALLOWED_BODY_KEYS = new Set([
  'fulfillment_task_id',
  'request_id',
  'reason',
  'delivery_drop_location',
  'delivery_notes',
  'delivery_photo_url',
]);
const FORBIDDEN_BODY_KEYS = new Set([
  'customer_name',
  'customer_email',
  'customer_phone',
  'customer_address',
  'address',
  'delivery_address',
  'address_line1',
  'address_line2',
  'address_city',
  'address_state',
  'address_postal_code',
  'driver_notes',
  'internal_notes',
  'notes',
  'proof',
  'proof_url',
  'proof_file',
  'proof_file_id',
  'proof_photo_url',
  'photo',
  'photo_url',
  'drop_location',
  'route',
  'route_order',
  'optimizer_data',
  'optimized_route',
  'provider_id',
  'provider_ids',
  'raw_payload',
  'payload',
  'raw_body',
  'raw_task',
  'task',
  'raw_order',
  'order',
  'order_update',
  'customer_app_order_update',
  'status_history',
  'task_status',
  'status',
  'delivery_status',
  'fulfillment_status',
  'production_status',
  'notify_customer',
  'notification',
  'send_notification',
  'batch_update',
  'inventory_update',
  'review_queue_update',
  'headers',
  'authorization',
  'auth_header',
  'secret',
  'token',
  'api_key',
  'api-key',
  'bulk_ids',
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

async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
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

function sanitizeUrl(value, maxLength = MAX_DELIVERY_PHOTO_URL_LENGTH) {
  const text = normalizeSingleLine(value);
  if (!text) return '';
  if (text.length > maxLength) throw new Error('delivery_photo_url is too long');

  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('delivery_photo_url must be a valid URL');
  }

  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('delivery_photo_url must use http or https');
  }

  return text;
}

function normalizeId(value, fieldName) {
  const text = normalizeSingleLine(value);
  if (!text) throw new Error(`${fieldName} is required`);
  if (text.length > 160 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
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

function findForbiddenBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  for (const key of Object.keys(body)) {
    const normalized = normalizeLower(key);
    if (ALLOWED_BODY_KEYS.has(normalized)) continue;
    if (FORBIDDEN_BODY_KEYS.has(normalized)) return key;
    if (/(^|_)(customer|order|task|batch|inventory|review_queue|delivery|route|proof|provider)_(id|ids|status|update|mutation|payload|name|email|phone|address|fields|url|file)$/i.test(normalized)) {
      return key;
    }
    if (/(^|_)(header|headers|authorization|auth|secret|token|api_key|api-key)$/i.test(normalized)) {
      return key;
    }
  }

  return null;
}

function sanitizeHubCommandResponse(data, requestId) {
  return {
    success: data?.success === true,
    fulfillment_task_id: sanitizeText(data?.fulfillment_task_id, 160) || null,
    previous_status: sanitizeText(data?.previous_status, 40) || null,
    status: sanitizeText(data?.status, 40) || null,
    previous_delivery_status: sanitizeText(data?.previous_delivery_status, 40) || null,
    delivery_status: sanitizeText(data?.delivery_status, 40) || null,
    delivered_at: sanitizeText(data?.delivered_at, 80) || null,
    request_id: sanitizeText(data?.request_id, 160) || requestId || null,
    skipped: data?.skipped === true,
    updated_at: sanitizeText(data?.updated_at, 80) || null,
    proof_drop_omitted: data?.proof_drop_omitted === true,
    proof_drop_error: sanitizeText(data?.proof_drop_error, 160) || null,
  };
}

function safeHubError(data, fallback = 'Unable to record fulfillment task delivered') {
  const error = sanitizeText(data?.error, 160);
  const errorCode = sanitizeText(data?.error_code, 80);
  const message = sanitizeText(data?.message, 160);
  return {
    error: error || fallback,
    ...(errorCode ? { error_code: errorCode } : {}),
    ...(message ? { message } : {}),
  };
}

function unsupportedProofDropError(data) {
  const error = normalizeLower(data?.error || data?.message || data?.error_code);
  return error.includes('unsupported field') &&
    (
      error.includes('delivery_drop_location') ||
      error.includes('delivery_photo_url') ||
      error.includes('delivery_notes') ||
      error.includes('proof') ||
      error.includes('drop')
    );
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
      return Response.json({ error: 'malformed_json' }, { status: 400 });
    }

    const forbiddenKey = findForbiddenBodyKey(body);
    if (forbiddenKey) {
      return Response.json({ error: `Unsupported field: ${forbiddenKey}` }, { status: 400 });
    }

    let taskId;
    let requestId;
    let reason;
    let deliveryDropLocation;
    let deliveryNotes;
    let deliveryPhotoUrl;

    try {
      taskId = normalizeId(body.fulfillment_task_id, 'fulfillment_task_id');
      requestId = normalizeId(body.request_id, 'request_id');
      reason = sanitizeText(body.reason, MAX_REASON_LENGTH);
      deliveryDropLocation = sanitizeText(body.delivery_drop_location, MAX_DROP_LOCATION_LENGTH);
      deliveryNotes = sanitizeText(body.delivery_notes, MAX_DELIVERY_NOTES_LENGTH);
      deliveryPhotoUrl = sanitizeUrl(body.delivery_photo_url);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Source delivered command service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const hubBody = {
      fulfillment_task_id: taskId,
      request_id: requestId,
      actor_email: normalizeActorEmail(user.email),
      actor_role: sanitizeText(user.role, 60),
      source: SOURCE,
    };

    if (reason) {
      hubBody.reason = reason;
    }
    if (deliveryDropLocation) {
      hubBody.delivery_drop_location = deliveryDropLocation;
    }
    if (deliveryNotes) {
      hubBody.delivery_notes = deliveryNotes;
    }
    if (deliveryPhotoUrl) {
      hubBody.delivery_photo_url = deliveryPhotoUrl;
    }

    const hubUrl = `${hubBase}/functions/recordFulfillmentTaskDeliveredForCustomerApp`;
    let hubResponse = await fetch(hubUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify(hubBody),
    });

    let proofDropOmitted = false;
    let proofDropError = '';
    let hubData = await hubResponse.json().catch(() => null);
    if (!hubResponse.ok && (deliveryDropLocation || deliveryNotes || deliveryPhotoUrl) && unsupportedProofDropError(hubData)) {
      proofDropOmitted = true;
      proofDropError = sanitizeText(hubData?.error || hubData?.message || 'Source proof/drop contract rejected delivery metadata', 160);
      const minimalHubBody = {
        fulfillment_task_id: taskId,
        request_id: requestId,
        actor_email: hubBody.actor_email,
        actor_role: hubBody.actor_role,
        source: SOURCE,
      };
      if (reason) {
        minimalHubBody.reason = reason;
      }

      hubResponse = await fetch(hubUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
        },
        body: JSON.stringify(minimalHubBody),
      });
      hubData = await hubResponse.json().catch(() => null);
    }

    if (!hubResponse.ok) {
      return Response.json({
        ...safeHubError(hubData),
        hub_status: hubResponse.status,
      }, { status: hubResponse.status >= 400 && hubResponse.status < 500 ? hubResponse.status : 502 });
    }

    return Response.json(sanitizeHubCommandResponse({
      ...hubData,
      proof_drop_omitted: proofDropOmitted || hubData?.proof_drop_omitted === true,
      proof_drop_error: proofDropError || hubData?.proof_drop_error,
    }, requestId));
  } catch {
    console.error('[recordAdminFulfillmentTaskDelivered] Error');
    return Response.json({ error: 'Unable to record fulfillment task delivered' }, { status: 500 });
  }
}
