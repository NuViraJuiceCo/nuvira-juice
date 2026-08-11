// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { handleOperationalNoticeMaintenance } from './noticeMaintenance.ts';

const SOURCE = 'customer_app_admin';
const MAX_NOTE_LENGTH = 500;
const VALID_ACTIONS = new Set(['acknowledge', 'resolve', 'dismiss']);
const FORBIDDEN_BODY_KEYS = new Set([
  'raw_alert_payload',
  'raw_payload',
  'payload',
  'raw_body',
  'raw_message',
  'message',
  'route',
  'deep_link',
  'action_url',
  'url',
  'recommended_action',
  'related_record_id',
  'related_record_ids',
  'provider_id',
  'provider_ids',
  'stripe_event_id',
  'shopify_order_id',
  'bulk_ids',
  'customer_name',
  'customer_email',
  'customer_phone',
  'customer_address',
  'order_update',
  'task_update',
  'batch_update',
  'inventory_update',
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
    throw new Error('action must be one of acknowledge, resolve, dismiss');
  }
  return action;
}

function normalizeActorEmail(value) {
  const email = normalizeSingleLine(value).toLowerCase();
  if (!email || email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Authenticated admin email is unavailable');
  }
  return email;
}

function normalizeResolutionNote(value, action) {
  const note = sanitizeText(value, MAX_NOTE_LENGTH);
  if (note && action !== 'resolve') {
    throw new Error('resolution_note is only accepted for resolve');
  }
  return note;
}

function findForbiddenBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  for (const key of Object.keys(body)) {
    const normalized = normalizeLower(key);
    if (FORBIDDEN_BODY_KEYS.has(normalized)) return key;
    if (/(^|_)(order|task|batch|inventory|review_queue|customer)_(id|ids|status|update|mutation|payload|name|email|phone|address)$/i.test(normalized)) {
      return key;
    }
    if (/(^|_)(header|headers|authorization|auth|secret|token|api_key|api-key)$/i.test(normalized)) {
      return key;
    }
  }

  return null;
}

function alertStatus(alert) {
  if (alert?.resolved === true) return 'resolved';
  if (alert?.is_read === true) return 'acknowledged';
  return 'active';
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

    if (body.action === 'maintenance_preview' || body.action === 'maintenance_apply') {
      return await handleOperationalNoticeMaintenance(base44, user, body);
    }

    const forbiddenKey = findForbiddenBodyKey(body);
    if (forbiddenKey) {
      return Response.json({ error: `Unsupported field: ${forbiddenKey}` }, { status: 400 });
    }

    let alertId;
    let action;
    let requestId;
    let resolutionNote;

    try {
      alertId = normalizeId(body.alert_id, 'alert_id');
      action = normalizeAction(body.action);
      requestId = normalizeId(body.request_id, 'request_id');
      resolutionNote = normalizeResolutionNote(body.resolution_note, action);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const idempotencyKey = `native_ops_alert_status:${requestId}`;
    const priorCommands = await base44.asServiceRole.entities.CommandLog.filter(
      { idempotency_key: idempotencyKey }, '-created_date', 1,
    ).catch(() => []);
    if (priorCommands.length > 0) {
      const prior = priorCommands[0];
      if (prior.status !== 'success') {
        return Response.json({ error: 'A prior alert update requires review before retrying' }, { status: 409 });
      }
      return Response.json({
        success: true,
        alert_id: alertId,
        action,
        status: sanitizeText(prior?.result?.status, 40) || null,
        request_id: requestId,
        skipped: true,
        reason: 'duplicate_request_id',
        source: 'customer_app_native',
        hub_operational_dependency: false,
      });
    }

    const matches = await base44.asServiceRole.entities.OperationalAlert.filter(
      { id: alertId }, '-updated_date', 2,
    ).catch(() => []);
    if (matches.length !== 1) {
      return Response.json({ error: matches.length === 0 ? 'Operational alert not found' : 'Operational alert lookup is ambiguous' }, { status: matches.length === 0 ? 404 : 409 });
    }
    const alert = matches[0];
    const previousStatus = alertStatus(alert);
    const status = action === 'acknowledge' ? 'acknowledged' : action === 'dismiss' ? 'dismissed' : 'resolved';
    const alreadyApplied = action === 'acknowledge'
      ? alert.is_read === true
      : alert.resolved === true;
    if (alreadyApplied) {
      return Response.json({
        success: true,
        alert_id: alertId,
        action,
        previous_status: previousStatus,
        status,
        request_id: requestId,
        skipped: true,
        reason: 'already_applied',
        updated_at: alert.updated_date || null,
        source: 'customer_app_native',
        hub_operational_dependency: false,
      });
    }

    const actorEmail = normalizeActorEmail(user.email);
    const now = new Date().toISOString();
    const command = await base44.asServiceRole.entities.CommandLog.create({
      command_id: requestId,
      command_type: 'native_operational_alert_status_update',
      command_source: SOURCE,
      status: 'pending',
      target_entity: 'OperationalAlert',
      target_id: alertId,
      target_display_id: sanitizeText(alert.order_number, 160) || alertId,
      actor_email: actorEmail,
      actor_role: sanitizeText(user.role, 60),
      actor_type: 'authenticated_admin',
      payload: { action, resolution_note_present: Boolean(resolutionNote) },
      result: { saved: false },
      idempotency_key: idempotencyKey,
      idempotent_skipped: false,
      request_id: requestId,
      submitted_at: now,
      started_at: now,
      function_name: 'maintainAdminOperationalNotices',
    });

    const update = action === 'acknowledge'
      ? { is_read: true }
      : {
        is_read: true,
        resolved: true,
        ...(resolutionNote ? {
          description: sanitizeText(
            [normalizeSingleLine(alert.description), `Resolution: ${resolutionNote}`].filter(Boolean).join(' | '),
            1000,
          ),
        } : {}),
      };

    try {
      const saved = await base44.asServiceRole.entities.OperationalAlert.update(alertId, update);
      await base44.asServiceRole.entities.CommandLog.update(command.id, {
        status: 'success',
        completed_at: new Date().toISOString(),
        result: { saved: true, status, source: 'customer_app_native' },
      });
      return Response.json({
        success: true,
        alert_id: alertId,
        action,
        previous_status: previousStatus,
        status,
        request_id: requestId,
        skipped: false,
        updated_at: saved?.updated_date || new Date().toISOString(),
        source: 'customer_app_native',
        hub_operational_dependency: false,
        provider_calls_performed: false,
        customer_notifications_sent: false,
      });
    } catch {
      await base44.asServiceRole.entities.CommandLog.update(command.id, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_code: 'native_operational_alert_update_failed',
        error_message: 'Unable to save native operational alert status',
        result: { saved: false },
      }).catch(() => null);
      return Response.json({ error: 'Unable to update ops alert status' }, { status: 500 });
    }
  } catch (error) {
    console.error('[updateAdminOpsAlertStatus] Error:', error.message);
    return Response.json({ error: 'Unable to update ops alert status' }, { status: 500 });
  }
}
