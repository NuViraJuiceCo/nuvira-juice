import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DEFAULT_ALLOWED_EVENTS = new Set(['order.created', 'order.updated', 'order.mirrored', 'manual.safe_sync']);
const MAX_SAFE_ARRAY = 40;
const ARRAY_SHAPE_GUARDED_FIELDS = ['line_items', 'fulfillments'];

function getNativeSafeSyncWriterConfig() {
  // Read gates per request so Base44 runtime artifact/env propagation issues
  // cannot leave native writer controls stuck on a stale module snapshot.
  return {
    enabled: Deno.env.get('ENABLE_NATIVE_SAFE_SYNC_WRITER') === 'true',
    killSwitch: Deno.env.get('NATIVE_SAFE_SYNC_WRITER_KILL_SWITCH') === 'true',
    secret: Deno.env.get('NATIVE_SAFE_SYNC_WRITER_SECRET') || Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || '',
    allowedSources: Deno.env.get('NATIVE_SAFE_SYNC_WRITER_ALLOWED_SOURCES') || '',
    allowedEvents: Deno.env.get('NATIVE_SAFE_SYNC_WRITER_ALLOWED_EVENTS') || '',
    orderAllowlist: Deno.env.get('NATIVE_SAFE_SYNC_WRITER_ORDER_ALLOWLIST') || '',
    actorEmailAllowlist: Deno.env.get('NATIVE_SAFE_SYNC_WRITER_ACTOR_EMAIL_ALLOWLIST') ||
      Deno.env.get('NATIVE_SAFE_SYNC_WRITER_ACTOR_ALLOWLIST') || '',
  };
}

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function parseCsvSet(value) {
  return new Set(String(value || '').split(',').map(normalizeLower).filter(Boolean));
}

function sanitizeText(value, maxLength = 220) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function safeStringArray(value, limit = MAX_SAFE_ARRAY) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : Object.keys(value || {});
  return [...new Set(values.map(item => sanitizeText(item, 100)).filter(Boolean))].slice(0, limit);
}

function compactObject(value) {
  const out = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (item !== undefined && item !== null) out[key] = item;
  }
  return out;
}

function stripUnsafeWriteFields(record) {
  const next = { ...(record || {}) };
  delete next.id;
  delete next.created_date;
  delete next.updated_date;
  delete next.created_by;
  delete next.updated_by;
  return next;
}

function getArrayShapeNormalizationRisk(existing, acceptedFields) {
  if (!existing || !acceptedFields) return [];
  return ARRAY_SHAPE_GUARDED_FIELDS.filter((field) => {
    if (Object.prototype.hasOwnProperty.call(acceptedFields, field)) return false;
    return !Array.isArray(existing[field]);
  });
}

function buildArrayShapeRiskResponse({ source, eventType, idempotencyKey, requestId, riskFields }) {
  return {
    success: false,
    skipped: true,
    error_code: 'schema_array_materialization_risk',
    message: 'Native safeSync writer blocked an update that could silently materialize missing array fields.',
    source,
    event_type: eventType,
    idempotency_key: idempotencyKey,
    request_id: requestId,
    blocked_fields: safeStringArray(riskFields),
    writes_performed: false,
    provider_calls_performed: false,
    notifications_sent: false,
    hub_bridge_modified: false,
  };
}

function getOrderIdentifiers(order) {
  return [
    order?.id,
    order?.base44_order_id,
    order?.shopify_order_id,
    order?.shopify_order_number,
    order?.order_number,
    order?.stripe_checkout_session_id,
    order?.stripe_payment_intent_id,
  ].map(normalizeLower).filter(Boolean);
}

function isOrderAllowlisted(order, config) {
  const allowed = parseCsvSet(config?.orderAllowlist);
  if (allowed.size === 0) return false;
  return getOrderIdentifiers(order).some(identifier => allowed.has(identifier));
}

function isSourceAllowed(source, config) {
  const allowed = parseCsvSet(config?.allowedSources);
  return allowed.size > 0 && allowed.has(normalizeLower(source));
}

function isEventAllowed(eventType, mode, config) {
  const allowed = parseCsvSet(config?.allowedEvents);
  if (allowed.size > 0) return allowed.has(normalizeLower(eventType));
  if (mode === 'live') return false;
  return DEFAULT_ALLOWED_EVENTS.has(normalizeLower(eventType));
}

function isActorAllowed(actor, config) {
  const allowed = parseCsvSet(config?.actorEmailAllowlist);
  if (allowed.size === 0) return false;
  const actorEmail = normalizeLower(actor?.actor_email);
  const identifiers = [
    actorEmail,
    actor?.actor_type && actorEmail ? `${normalizeLower(actor.actor_type)}:${actorEmail}` : '',
    actor?.actor_role && actorEmail ? `${normalizeLower(actor.actor_role)}:${actorEmail}` : '',
  ].filter(Boolean);
  return identifiers.some(identifier => allowed.has(identifier));
}

async function readJsonBody(req) {
  const raw = await req.text();
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function resolveAuth({ base44, req, body, mode, config }) {
  const authHeader = req.headers.get('authorization') || '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const bodySecret = normalizeText(body?.internal_secret || body?._internal_secret);
  const writerSecret = config?.secret || '';
  if (writerSecret && (bearer === writerSecret || bodySecret === writerSecret)) {
    return { ok: true, actor_type: 'system', actor_role: 'service', actor_email: 'system' };
  }

  try {
    const user = await base44.auth.me();
    if (user?.role === 'admin') {
      return {
        ok: mode !== 'live',
        actor_type: 'admin',
        actor_role: 'admin',
        actor_email: user.email || 'admin',
      };
    }
  } catch {
    // Fall through to unauthorized.
  }

  return { ok: false };
}

async function findExistingOrder(base44, body, incoming) {
  const directId = sanitizeText(body?.existing_order_id || body?.target_order_id, 160);
  const filters = [];
  if (directId) filters.push({ id: directId });
  if (incoming?.base44_order_id) filters.push({ base44_order_id: incoming.base44_order_id });
  if (incoming?.shopify_order_id) filters.push({ shopify_order_id: incoming.shopify_order_id });
  if (incoming?.shopify_order_number || incoming?.order_number) {
    filters.push({ shopify_order_number: incoming.shopify_order_number || incoming.order_number });
  }
  if (incoming?.stripe_checkout_session_id) filters.push({ stripe_checkout_session_id: incoming.stripe_checkout_session_id });
  if (incoming?.stripe_payment_intent_id) filters.push({ stripe_payment_intent_id: incoming.stripe_payment_intent_id });

  for (const filter of filters) {
    const matches = await base44.asServiceRole.entities.ShopifyOrder.filter(filter, '-created_date', 5).catch(() => []);
    if (Array.isArray(matches) && matches.length > 0) return matches[0];
  }
  return null;
}

async function runPlanner({ base44, source, incoming, existing, idempotencyKey, fixtureId }) {
  const response = await base44.asServiceRole.functions.invoke('previewNativeSafeSyncOrderUpdate', {
    mode: 'dry_run',
    fixture_id: fixtureId || 'execute_native_safe_sync',
    source,
    idempotency_key: idempotencyKey,
    incoming_payload: incoming,
    starting_order: existing || null,
  });
  return response?.data || response;
}

async function findIdempotencyLog(base44, idempotencyKey) {
  if (!idempotencyKey) return null;
  const commandMatches = await base44.asServiceRole.entities.CommandLog.filter({ idempotency_key: idempotencyKey }, '-created_date', 1).catch(() => []);
  if (Array.isArray(commandMatches) && commandMatches.length > 0) return { entity: 'CommandLog', record: commandMatches[0] };

  const syncMatches = await base44.asServiceRole.entities.OrderSyncLog.filter({ idempotency_key: idempotencyKey }, '-created_date', 1).catch(() => []);
  if (Array.isArray(syncMatches) && syncMatches.length > 0) return { entity: 'OrderSyncLog', record: syncMatches[0] };
  return null;
}

function buildReviewQueueDraft({ planner, source, incoming, idempotencyKey }) {
  const draft = planner?.order_review_queue_draft || {};
  const incomingFields = Object.keys(incoming || {}).sort();
  return compactObject({
    incident_type: draft.incident_type || planner?.error_code || 'native_safe_sync_review_required',
    customer_email: sanitizeText(incoming?.customer_email, 180),
    customer_name: sanitizeText(incoming?.customer_name, 160),
    existing_order_id: draft.existing_order_id || planner?.proposed_order_state?.id || null,
    existing_order_number: draft.existing_order_number || planner?.proposed_order_state?.shopify_order_number || null,
    incoming_source: source,
    incoming_payload: draft.incoming_payload_summary || {
      field_count: incomingFields.length,
      fields_present: incomingFields.slice(0, 80),
      order_number: sanitizeText(incoming?.shopify_order_number || incoming?.order_number, 120),
      source_channel: sanitizeText(incoming?.source_channel, 80),
      payment_status: sanitizeText(incoming?.payment_status, 80),
    },
    issue_description: sanitizeText(draft.issue_description || `Native safeSync rejected update: ${planner?.error_code || 'review_required'}`, 260),
    recommended_action: draft.recommended_action || 'manual_review',
    status: 'pending',
    idempotency_key: idempotencyKey,
    occurrence_count: 1,
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  });
}

async function createOrUpdateReviewQueue({ base44, planner, source, incoming, idempotencyKey, mode }) {
  const draft = buildReviewQueueDraft({ planner, source, incoming, idempotencyKey });
  if (mode !== 'live') return { action: 'drafted', draft };

  const existing = idempotencyKey
    ? await base44.asServiceRole.entities.OrderReviewQueue.filter({ idempotency_key: idempotencyKey }, '-created_date', 1).catch(() => [])
    : [];
  if (Array.isArray(existing) && existing.length > 0) {
    const occurrenceCount = Number(existing[0].occurrence_count || 1) + 1;
    const updated = await base44.asServiceRole.entities.OrderReviewQueue.update(existing[0].id, {
      occurrence_count: occurrenceCount,
      last_seen_at: new Date().toISOString(),
      issue_description: draft.issue_description,
    });
    return { action: 'updated', record: updated };
  }

  const created = await base44.asServiceRole.entities.OrderReviewQueue.create(draft);
  return { action: 'created', record: created };
}

async function createOrderSyncLog({ base44, planner, record, source, eventType, status, action, reason, idempotencyKey, requestId, mode }) {
  const draft = planner?.order_sync_log_draft || {};
  const payload = compactObject({
    order_number: record?.shopify_order_number || draft.order_number || 'unknown',
    status,
    sync_timestamp: new Date().toISOString(),
    sync_source: source,
    event_type: eventType,
    stripe_event_id: draft.stripe_event_id || null,
    order_id: record?.id || draft.order_id || null,
    action,
    reason: sanitizeText(reason || draft.reason, 300),
    fields_updated: safeStringArray(draft.fields_updated || planner?.accepted_fields),
    fields_rejected: safeStringArray(draft.fields_rejected || planner?.rejected_fields),
    success: status === 'success' || status === 'deduped',
    error: status === 'rejected' ? (planner?.error_code || draft.error || 'rejected') : null,
    error_code: status === 'rejected' ? (planner?.error_code || draft.error_code || 'rejected') : null,
    idempotency_key: idempotencyKey,
    request_id: requestId,
    correlation_id: idempotencyKey,
  });

  if (mode !== 'live') return { action: 'drafted', draft: payload };
  const created = await base44.asServiceRole.entities.OrderSyncLog.create(payload);
  return { action: 'created', record: created };
}

async function createCommandLog({ base44, record, source, eventType, status, action, idempotencyKey, requestId, actor, planner, mode }) {
  const payload = compactObject({
    command_type: 'native_safe_sync_order_update',
    command_source: source,
    status,
    target_entity: 'ShopifyOrder',
    target_id: record?.id || null,
    target_display_id: record?.shopify_order_number || null,
    actor_email: actor?.actor_email || 'system',
    actor_role: actor?.actor_role || 'service',
    actor_type: actor?.actor_type || 'system',
    payload: {
      source,
      event_type: eventType,
      accepted_fields: safeStringArray(planner?.accepted_fields),
      rejected_fields: safeStringArray(planner?.rejected_fields),
    },
    result: {
      action,
      would_create_order: planner?.would_create_order === true,
      would_update_order: planner?.would_update_order === true,
      would_quarantine: planner?.would_quarantine === true,
      would_reject: planner?.would_reject === true,
    },
    error_code: status === 'rejected' ? (planner?.error_code || 'rejected') : null,
    idempotency_key: idempotencyKey,
    request_id: requestId,
    submitted_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    function_name: 'executeNativeSafeSyncOrderUpdate',
    related_order_id: record?.id || null,
    related_order_number: record?.shopify_order_number || null,
  });

  if (mode !== 'live') return { action: 'drafted', draft: payload };
  const created = await base44.asServiceRole.entities.CommandLog.create(payload);
  return { action: 'created', record: created };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', message: 'POST required' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const body = await readJsonBody(req);
    if (body === null) {
      return Response.json({ success: false, error_code: 'malformed_json', message: 'Malformed JSON body' }, { status: 400 });
    }

    const mode = body.mode === 'live' ? 'live' : 'dry_run';
    const source = normalizeText(body.source || 'customer_app');
    const eventType = normalizeText(body.event_type || body.event || 'manual.safe_sync');
    const incoming = body.incoming_payload && typeof body.incoming_payload === 'object'
      ? body.incoming_payload
      : (body.order && typeof body.order === 'object' ? body.order : {});
    const idempotencyKey = sanitizeText(body.idempotency_key || body.request_id || `native_safe_sync:${Date.now()}`, 180);
    const requestId = sanitizeText(body.request_id, 160) || idempotencyKey;
    const writerConfig = getNativeSafeSyncWriterConfig();

    const auth = await resolveAuth({ base44, req, body, mode, config: writerConfig });
    if (!auth.ok) {
      return Response.json({ success: false, error_code: 'unauthorized', message: 'Unauthorized' }, { status: 401 });
    }

    if (!source || !eventType || !incoming || Object.keys(incoming).length === 0) {
      return Response.json({ success: false, error_code: 'invalid_request', message: 'source, event_type, and incoming_payload are required' }, { status: 400 });
    }

    if (!isEventAllowed(eventType, mode, writerConfig)) {
      return Response.json({ success: false, skipped: true, error_code: 'event_not_allowed', source, event_type: eventType });
    }

    const existing = mode === 'dry_run' && body.starting_order
      ? body.starting_order
      : await findExistingOrder(base44, body, incoming);
    const planner = await runPlanner({
      base44,
      source,
      incoming,
      existing,
      idempotencyKey,
      fixtureId: body.fixture_id,
    });
    const schemaNormalizationRisk = planner?.would_update_order === true
      ? getArrayShapeNormalizationRisk(existing, planner?.accepted_fields)
      : [];

    if (mode !== 'live') {
      const review = planner?.would_quarantine ? await createOrUpdateReviewQueue({ base44, planner, source, incoming, idempotencyKey, mode }) : null;
      const syncLog = await createOrderSyncLog({
        base44,
        planner,
        record: planner?.proposed_order_state || incoming,
        source,
        eventType,
        status: planner?.would_reject ? 'rejected' : 'pending',
        action: planner?.action || 'dry_run',
        reason: planner?.error_code || 'dry_run_preview',
        idempotencyKey,
        requestId,
        mode,
      });
      const commandLog = await createCommandLog({
        base44,
        record: planner?.proposed_order_state || incoming,
        source,
        eventType,
        status: planner?.would_reject ? 'rejected' : 'pending',
        action: planner?.action || 'dry_run',
        idempotencyKey,
        requestId,
        actor: auth,
        planner,
        mode,
      });

      return Response.json({
        success: planner?.success === true,
        dry_run: true,
        source,
        event_type: eventType,
        idempotency_key: idempotencyKey,
        native_safe_sync: planner,
        order_review_queue_draft: review?.draft || planner?.order_review_queue_draft || null,
        order_sync_log_draft: syncLog?.draft || planner?.order_sync_log_draft || null,
        command_log_draft: commandLog?.draft || null,
        schema_normalization_risk: schemaNormalizationRisk,
        writes_performed: false,
      });
    }

    if (writerConfig.killSwitch) {
      return Response.json({ success: true, skipped: true, error_code: 'native_safe_sync_writer_kill_switch', writes_performed: false });
    }
    if (!writerConfig.enabled) {
      return Response.json({ success: true, skipped: true, error_code: 'native_safe_sync_writer_disabled', writes_performed: false });
    }
    if (!isActorAllowed(auth, writerConfig)) {
      return Response.json({ success: true, skipped: true, error_code: 'actor_not_allowlisted', writes_performed: false });
    }
    if (!isSourceAllowed(source, writerConfig)) {
      return Response.json({ success: true, skipped: true, error_code: 'source_not_allowed', source, writes_performed: false });
    }
    if (!isOrderAllowlisted({ ...incoming, ...(existing || {}) }, writerConfig)) {
      return Response.json({ success: true, skipped: true, error_code: 'order_not_allowlisted', writes_performed: false });
    }

    const existingLog = await findIdempotencyLog(base44, idempotencyKey);
    if (existingLog) {
      return Response.json({
        success: true,
        skipped: true,
        action: 'idempotent_skip',
        idempotency_key: idempotencyKey,
        existing_log_entity: existingLog.entity,
        existing_log_id: existingLog.record?.id || null,
        writes_performed: false,
      });
    }

    if (!planner?.success) {
      return Response.json({ success: false, error_code: 'native_safe_sync_preview_failed', writes_performed: false }, { status: 500 });
    }
    if (schemaNormalizationRisk.length > 0) {
      return Response.json(buildArrayShapeRiskResponse({
        source,
        eventType,
        idempotencyKey,
        requestId,
        riskFields: schemaNormalizationRisk,
      }), { status: 409 });
    }

    let writtenRecord = existing || null;
    let action = 'skipped';
    let status = 'deduped';

    if (planner.would_reject === true) {
      action = 'rejected';
      status = 'rejected';
      await createOrUpdateReviewQueue({ base44, planner, source, incoming, idempotencyKey, mode });
    } else if (planner.would_create_order === true) {
      writtenRecord = await base44.asServiceRole.entities.ShopifyOrder.create(stripUnsafeWriteFields(planner.proposed_order_state));
      action = 'created';
      status = 'success';
    } else if (planner.would_update_order === true && existing?.id) {
      writtenRecord = await base44.asServiceRole.entities.ShopifyOrder.update(existing.id, stripUnsafeWriteFields(planner.accepted_fields));
      action = 'updated';
      status = 'success';
    }

    await createOrderSyncLog({
      base44,
      planner,
      record: writtenRecord || planner.proposed_order_state || incoming,
      source,
      eventType,
      status,
      action,
      reason: planner?.error_code || `native safeSync ${action}`,
      idempotencyKey,
      requestId,
      mode,
    }).catch(error => {
      console.warn(`[executeNativeSafeSyncOrderUpdate] OrderSyncLog write failed safely: ${error?.message || 'unknown'}`);
      return null;
    });

    await createCommandLog({
      base44,
      record: writtenRecord || planner.proposed_order_state || incoming,
      source,
      eventType,
      status: status === 'success' ? 'success' : (status === 'rejected' ? 'rejected' : 'skipped'),
      action,
      idempotencyKey,
      requestId,
      actor: auth,
      planner,
      mode,
    }).catch(error => {
      console.warn(`[executeNativeSafeSyncOrderUpdate] CommandLog write failed safely: ${error?.message || 'unknown'}`);
      return null;
    });

    return Response.json({
      success: status === 'success' || status === 'deduped',
      skipped: action === 'skipped',
      dry_run: false,
      action,
      source,
      event_type: eventType,
      order_id: writtenRecord?.id || null,
      order_number: writtenRecord?.shopify_order_number || planner?.proposed_order_state?.shopify_order_number || incoming?.shopify_order_number || incoming?.order_number || null,
      idempotency_key: idempotencyKey,
      native_safe_sync: {
        accepted_field_count: Object.keys(planner?.accepted_fields || {}).length,
        rejected_fields: safeStringArray(planner?.rejected_fields),
        would_quarantine: planner?.would_quarantine === true,
        would_reject: planner?.would_reject === true,
        error_code: planner?.error_code || null,
      },
      writes_performed: action === 'created' || action === 'updated' || action === 'rejected',
      native_writer_enabled: true,
      provider_calls_performed: false,
      notifications_sent: false,
      hub_bridge_modified: false,
    });
  } catch (error) {
    console.error(`[executeNativeSafeSyncOrderUpdate] failed safely: ${error?.message || 'unknown error'}`);
    return Response.json({
      success: false,
      error_code: 'native_safe_sync_writer_failed',
      message: 'Native safeSync writer failed safely.',
      writes_performed: false,
    }, { status: 500 });
  }
});
