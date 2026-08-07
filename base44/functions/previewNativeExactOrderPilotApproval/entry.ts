import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const MAX_ITEMS = 20;

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeOrderNumber(value) {
  return normalizeText(value).replace(/^#/, '');
}

function sanitizeText(value, maxLength = 180) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\b(?:ch|re|pi|cs|cus|sub|evt|in|pm|seti|si|src|tok|po|li)_[A-Za-z0-9]{8,}\b/g, '[redacted provider id]')
    .replace(/\bgid:\/\/shopify\/[A-Za-z]+\/[A-Za-z0-9_-]+\b/g, '[redacted shopify id]');
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function safeStringArray(values, limit = MAX_ITEMS) {
  const input = Array.isArray(values) ? values : [];
  return [...new Set(input.map(item => sanitizeText(item, 100)).filter(Boolean))].slice(0, limit);
}

function compactObject(value) {
  const out = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (item !== undefined && item !== null && item !== '') out[key] = item;
  }
  return out;
}

function getPreviewInternalSecret() {
  return Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET') ||
    Deno.env.get('CUSTOMER_APP_SYNC_SECRET') ||
    Deno.env.get('HUB_SYNC_SECRET') ||
    '';
}

async function readJsonBody(req) {
  const raw = await req.text();
  if (!raw.trim()) return { ok: true, body: {} };
  try {
    const body = JSON.parse(raw);
    return body && typeof body === 'object' && !Array.isArray(body)
      ? { ok: true, body }
      : { ok: false, body: null };
  } catch {
    return { ok: false, body: null };
  }
}

function unauthorized() {
  return Response.json({ success: false, error_code: 'unauthorized', message: 'Unauthorized' }, { status: 401 });
}

function forbidden() {
  return Response.json({ success: false, error_code: 'forbidden', message: 'Admin access required' }, { status: 403 });
}

async function requirePreviewAccess({ base44, req, body }) {
  const bodySecret = normalizeText(body?.internal_secret || body?._internal_secret);
  const headerSecret = normalizeText(req.headers.get('x-internal-secret'));
  const expectedSecret = getPreviewInternalSecret();
  const providedSecret = headerSecret || bodySecret;

  if (providedSecret) {
    return expectedSecret && providedSecret === expectedSecret
      ? { ok: true, actor_type: 'system', actor_role: 'service', actor_email: 'system' }
      : { ok: false, response: unauthorized() };
  }

  try {
    const user = await base44.auth.me().catch(() => null);
    if (!user) return { ok: false, response: unauthorized() };
    if (user.role !== 'admin') return { ok: false, response: forbidden() };
    return { ok: true, actor_type: 'admin', actor_role: 'admin', actor_email: user.email || 'admin' };
  } catch {
    return { ok: false, response: unauthorized() };
  }
}

function getLookup(body) {
  return {
    orderId: normalizeText(body?.order_id || body?.customer_app_order_id || body?.base44_order_id),
    nativeOrderId: normalizeText(body?.native_order_id || body?.native_shopify_order_id || body?.shopify_order_record_id || body?.shopify_order_id),
    orderNumber: normalizeOrderNumber(body?.order_number || body?.shopify_order_number || body?.order || body?.number),
  };
}

function hasExactLookup(lookup) {
  return Boolean(lookup.orderId || lookup.nativeOrderId || lookup.orderNumber);
}

function readinessPreviewPayload(body, lookup) {
  return compactObject({
    mode: 'dry_run',
    _internal_secret: getPreviewInternalSecret(),
    order_id: lookup.orderId || null,
    native_order_id: lookup.nativeOrderId || null,
    order_number: lookup.orderNumber || null,
    source: sanitizeText(body?.source || 'customer_app', 80) || 'customer_app',
    event_type: sanitizeText(body?.event_type || body?.event || 'order.created', 100) || 'order.created',
  });
}

async function runCutoverReadinessPreview({ base44, body, lookup }) {
  const response = await base44.asServiceRole.functions.invoke(
    'previewNativeOrderCutoverReadiness',
    readinessPreviewPayload(body, lookup),
  );
  return response?.data || response;
}

function extractTarget(readinessResult, lookup) {
  const targets = Array.isArray(readinessResult?.targets) ? readinessResult.targets : [];
  if (targets.length === 1) return targets[0];
  const orderNumber = normalizeLower(lookup.orderNumber);
  const orderId = normalizeLower(lookup.orderId);
  const nativeOrderId = normalizeLower(lookup.nativeOrderId);
  return targets.find(target => {
    const identifiers = [
      target?.order_number,
      target?.customer_app_order_id,
      target?.native_shopify_order_id,
    ].map(normalizeLower).filter(Boolean);
    return (orderNumber && identifiers.includes(orderNumber)) ||
      (orderId && identifiers.includes(orderId)) ||
      (nativeOrderId && identifiers.includes(nativeOrderId));
  }) || null;
}

function writerGateWarnings(gates) {
  const warnings = [];
  const writer = gates?.native_safe_sync_writer || {};
  if (writer.enabled !== true) warnings.push('native_safe_sync_writer_currently_disabled');
  if (writer.kill_switch === true) warnings.push('native_safe_sync_writer_kill_switch_currently_on');
  if (writer.order_allowlist_count === 0) warnings.push('native_safe_sync_writer_exact_order_allowlist_required');
  if (writer.actor_allowlist_count === 0) warnings.push('native_safe_sync_writer_actor_allowlist_required');
  return warnings;
}

function buildApprovalPacket({ readinessResult, lookup, actor }) {
  const readiness = readinessResult?.readiness || {};
  const gates = readinessResult?.gates || {};
  const target = extractTarget(readinessResult, lookup);
  const blockers = [];
  const warnings = [];

  if (!target) blockers.push('target_order_not_found');
  if (readinessResult?.success !== true) blockers.push('cutover_readiness_not_success');
  if (readiness.classification !== 'pilot_ready_with_exact_order_approval') blockers.push('cutover_not_pilot_ready');
  for (const blocker of readiness.blockers || []) blockers.push(blocker);
  for (const blocker of target?.blockers || []) blockers.push(blocker);
  if (!target?.classification?.startsWith('pilot_ready')) blockers.push('target_not_pilot_ready');
  if (!target?.native_order_present) blockers.push('native_order_missing');
  if (target?.payment_status !== 'paid' && target?.payment_captured !== true) blockers.push('payment_not_paid');
  if (target?.address_complete === false) blockers.push('delivery_address_incomplete');
  if (gates?.native_safe_sync_writer?.broad_real_order_mode === true) blockers.push('native_safe_sync_writer_broad_mode_enabled_unexpectedly');
  if (gates?.native_fulfillment_task_materialization?.broad_real_order_mode === true) blockers.push('native_task_materialization_broad_mode_enabled_unexpectedly');

  for (const warning of readiness.warnings || []) warnings.push(warning);
  for (const warning of target?.warnings || []) warnings.push(warning);
  warnings.push(...writerGateWarnings(gates));

  const orderNumber = sanitizeText(target?.order_number || lookup.orderNumber, 120);
  const exactApprovalPhrase = orderNumber ? `APPROVE G28 EXACT ORDER PILOT ${orderNumber}` : null;
  const plannerSummary = target?.planner_summary || null;

  return {
    approval_packet_ready: blockers.length === 0,
    approval_required: true,
    approved_for_live_execution: false,
    live_execution_not_run: true,
    exact_order_approval_phrase: exactApprovalPhrase,
    target: {
      order_number: orderNumber,
      customer_app_order_id: sanitizeText(target?.customer_app_order_id, 120),
      native_shopify_order_id: sanitizeText(target?.native_shopify_order_id, 120),
      payment_status: sanitizeText(target?.payment_status, 80),
      fulfillment_method: sanitizeText(target?.fulfillment_method, 80),
      native_sync_status: sanitizeText(target?.native_sync_status, 80),
      native_task_count: Number(target?.native_task_count || 0),
      native_task_display_metadata_complete_count: Number(target?.native_task_display_metadata_complete_count || 0),
    },
    readiness: {
      classification: sanitizeText(readiness.classification, 120),
      target_classification: sanitizeText(target?.classification, 120),
      next_action: sanitizeText(readiness.next_action, 160),
      hub_bridge_remains_fallback: readiness.hub_bridge_remains_fallback === true,
    },
    writer_dry_run_equivalent: plannerSummary ? {
      success: plannerSummary.success === true,
      action: sanitizeText(plannerSummary.action, 120),
      would_create_order: plannerSummary.would_create_order === true,
      would_update_order: plannerSummary.would_update_order === true,
      would_reject: plannerSummary.would_reject === true,
      would_quarantine: plannerSummary.would_quarantine === true,
      accepted_fields: safeStringArray(plannerSummary.accepted_fields, 80),
      rejected_fields: safeStringArray(plannerSummary.rejected_fields, 80),
      error_code: sanitizeText(plannerSummary.error_code, 120),
      proposed_line_item_count: Number(plannerSummary.proposed_line_item_count || 0),
    } : null,
    gate_snapshot: {
      native_safe_sync_writer: {
        enabled: gates?.native_safe_sync_writer?.enabled === true,
        kill_switch: gates?.native_safe_sync_writer?.kill_switch === true,
        broad_real_order_mode: gates?.native_safe_sync_writer?.broad_real_order_mode === true,
        order_allowlist_count: Number(gates?.native_safe_sync_writer?.order_allowlist_count || 0),
        actor_allowlist_count: Number(gates?.native_safe_sync_writer?.actor_allowlist_count || 0),
      },
      native_order_ops: {
        enabled: gates?.native_order_ops?.enabled === true,
        hub_bridge_fallback_expected: gates?.native_order_ops?.hub_bridge_fallback_expected === true,
      },
    },
    live_execution_contract: {
      function_name: 'executeNativeSafeSyncOrderUpdate',
      required_mode: 'live',
      exact_order_only: true,
      separate_approval_required: true,
      required_actor_allowlist: true,
      required_order_allowlist: true,
      hub_bridge_remains_fallback: true,
      broad_real_order_mode_allowed: false,
      provider_calls_allowed: false,
      stripe_calls_allowed: false,
      shopify_api_calls_allowed: false,
      notifications_allowed: false,
      sync_repair_replay_allowed: false,
      production_inventory_delivery_mutations_allowed: false,
    },
    blockers: safeStringArray(blockers),
    warnings: safeStringArray(warnings),
    generated_by: {
      actor_type: sanitizeText(actor?.actor_type, 80),
      actor_role: sanitizeText(actor?.actor_role, 80),
      actor_email: sanitizeText(actor?.actor_email, 180),
    },
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', message: 'POST required' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const parsed = await readJsonBody(req);
    if (!parsed.ok) {
      return Response.json({ success: false, error_code: 'malformed_json', message: 'Malformed JSON body' }, { status: 400 });
    }

    const body = parsed.body || {};
    if (body.mode && body.mode !== 'dry_run') {
      return Response.json({ success: false, error_code: 'dry_run_only', message: 'Only dry_run mode is supported' }, { status: 400 });
    }

    const auth = await requirePreviewAccess({ base44, req, body });
    if (!auth.ok) return auth.response;

    const lookup = getLookup(body);
    if (!hasExactLookup(lookup)) {
      return Response.json({
        success: false,
        dry_run: true,
        error_code: 'exact_order_required',
        message: 'Provide order_id, order_number, or native_order_id for an exact-order pilot approval packet.',
        writes_performed: false,
      }, { status: 400 });
    }

    const readinessResult = await runCutoverReadinessPreview({ base44, body, lookup });
    const approval = buildApprovalPacket({ readinessResult, lookup, actor: auth });

    return Response.json({
      success: approval.approval_packet_ready,
      dry_run: true,
      function_name: 'previewNativeExactOrderPilotApproval',
      generated_at: new Date().toISOString(),
      scope: 'specific_order',
      approval,
      safety: {
        dry_run_only: true,
        writes_performed: false,
        live_execution_performed: false,
        provider_calls_performed: false,
        stripe_calls_performed: false,
        shopify_api_calls_performed: false,
        notifications_sent: false,
        sync_repair_replay_performed: false,
        production_inventory_delivery_mutations_performed: false,
        hub_bridge_modified: false,
      },
    });
  } catch (error) {
    console.error(`[previewNativeExactOrderPilotApproval] failed safely: ${error?.message || 'unknown error'}`);
    return Response.json({
      success: false,
      dry_run: true,
      error_code: 'native_exact_order_pilot_approval_failed',
      message: 'Native exact-order pilot approval preview failed safely.',
      writes_performed: false,
    }, { status: 500 });
  }
});
