// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const SOURCE = 'customer_app_admin';
const MAX_REASON_LENGTH = 300;
const VALID_ACTIONS = new Set(['assign', 'unassign']);
const ALLOWED_BODY_KEYS = new Set([
  'fulfillment_task_id',
  'action',
  'request_id',
  'assigned_driver',
  'reason',
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
  'photo',
  'photo_url',
  'delivery_photo_url',
  'drop_location',
  'delivery_drop_location',
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
  'task_status',
  'status',
  'delivery_status',
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

function normalizeId(value, fieldName) {
  const text = normalizeSingleLine(value);
  if (!text) throw new Error(`${fieldName} is required`);
  if (text.length > 160 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
}

function normalizeAction(value) {
  const action = normalizeLower(value);
  if (!action) throw new Error('action is required');
  if (!VALID_ACTIONS.has(action)) {
    throw new Error('action must be one of assign, unassign');
  }
  return action;
}

function normalizeAssignedDriver(value, action) {
  const hasValue = value !== undefined && value !== null && normalizeSingleLine(value) !== '';

  if (action === 'unassign') {
    if (hasValue) throw new Error('assigned_driver is not accepted for unassign');
    return null;
  }

  if (!hasValue) throw new Error('assigned_driver is required for assign');

  const driver = normalizeSingleLine(value);
  if (driver.length > 120) throw new Error('assigned_driver is too long');
  if (!/^[A-Za-z0-9 ._'@+-]+$/.test(driver)) {
    throw new Error('assigned_driver contains unsupported characters');
  }
  if (/^\d+$/.test(driver) || driver.length < 2) {
    throw new Error('assigned_driver must be a safe internal driver label or email');
  }

  return driver;
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
    if (/(^|_)(customer|order|task|batch|inventory|review_queue|delivery|route|proof|provider)_(id|ids|status|update|mutation|payload|name|email|phone|address|fields)$/i.test(normalized)) {
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
    action: sanitizeText(data?.action, 40) || null,
    previous_driver: sanitizeText(data?.previous_driver, 120) || null,
    assigned_driver: sanitizeText(data?.assigned_driver, 120) || null,
    previous_status: sanitizeText(data?.previous_status, 40) || null,
    status: sanitizeText(data?.status, 40) || null,
    request_id: sanitizeText(data?.request_id, 160) || requestId || null,
    skipped: data?.skipped === true,
    updated_at: sanitizeText(data?.updated_at, 80) || null,
  };
}

function safeHubError(data, fallback = 'Unable to update fulfillment task assignment') {
  const error = sanitizeText(data?.error, 160);
  const errorCode = sanitizeText(data?.error_code, 80);
  const message = sanitizeText(data?.message, 160);
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
    let action;
    let requestId;
    let assignedDriver;
    let reason;

    try {
      taskId = normalizeId(body.fulfillment_task_id, 'fulfillment_task_id');
      action = normalizeAction(body.action);
      requestId = normalizeId(body.request_id, 'request_id');
      assignedDriver = normalizeAssignedDriver(body.assigned_driver, action);
      reason = sanitizeText(body.reason, MAX_REASON_LENGTH);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub fulfillment assignment service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const hubBody = {
      fulfillment_task_id: taskId,
      action,
      request_id: requestId,
      actor_email: normalizeActorEmail(user.email),
      actor_role: sanitizeText(user.role, 60),
      source: SOURCE,
    };

    if (action === 'assign') {
      hubBody.assigned_driver = assignedDriver;
    }
    if (reason) {
      hubBody.reason = reason;
    }

    const hubResponse = await fetch(`${hubBase}/functions/updateFulfillmentTaskAssignmentForCustomerApp`, {
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
  } catch (error) {
    console.error('[updateAdminFulfillmentTaskAssignment] Error:', error.message);
    return Response.json({ error: 'Unable to update fulfillment task assignment' }, { status: 500 });
  }
}
