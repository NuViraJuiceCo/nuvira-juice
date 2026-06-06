import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const MAX_TASK_SUMMARY = 5;
const MAX_BLOCKERS = 20;

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeOrderNumber(value) {
  return normalizeText(value).replace(/^#/, '');
}

function parseCsv(value) {
  return normalizeText(value).split(',').map(item => normalizeText(item)).filter(Boolean);
}

function countCsv(value) {
  return parseCsv(value).length;
}

function safeLimit(value) {
  const parsed = Number(value || DEFAULT_LIMIT);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compactObject(value) {
  const out = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (item !== undefined && item !== null && item !== '') out[key] = item;
  }
  return out;
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
  const authHeader = req.headers.get('authorization') || '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const bodySecret = normalizeText(body?.internal_secret || body?._internal_secret);
  const headerSecret = normalizeText(req.headers.get('x-internal-secret'));
  const expectedSecret = getPreviewInternalSecret();
  const providedSecret = headerSecret || bearer || bodySecret;

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

function paymentStatus(order) {
  const status = normalizeLower(order?.payment_status || order?.financial_status);
  if (status) return status;
  return order?.payment_captured === true ? 'paid' : 'pending';
}

function fulfillmentMethod(order) {
  return normalizeLower(order?.fulfillment_type || order?.fulfillment_method) || 'delivery';
}

function lineItemCount(order) {
  const items = Array.isArray(order?.items) ? order.items : order?.line_items;
  return Array.isArray(items) ? items.filter(item => safeNumber(item?.quantity, 0) > 0).length : 0;
}

function hasCompleteDeliveryAddress(order) {
  if (fulfillmentMethod(order) !== 'delivery') return true;
  const deliveryAddress = typeof order?.delivery_address === 'object' && order.delivery_address !== null
    ? order.delivery_address
    : {};
  return Boolean(
    normalizeText(order?.address_line1 || deliveryAddress.address_line1 || deliveryAddress.address1 || order?.delivery_address) &&
    normalizeText(order?.address_city || deliveryAddress.city) &&
    normalizeText(order?.address_state || deliveryAddress.state || deliveryAddress.province) &&
    normalizeText(order?.address_postal_code || deliveryAddress.postal_code || deliveryAddress.zip)
  );
}

function taskHasDisplayMetadata(task) {
  return Boolean(
    normalizeText(task?.shopify_order_number || task?.order_number) &&
    normalizeText(task?.source_type) &&
    normalizeText(task?.schedule_source) &&
    normalizeText(task?.production_date)
  );
}

function summarizeTask(task) {
  return {
    id: task?.id || null,
    status: sanitizeText(task?.status, 80),
    delivery_status: sanitizeText(task?.delivery_status, 80),
    delivery_date: sanitizeText(task?.delivery_date || task?.assigned_delivery_date, 40),
    production_date: sanitizeText(task?.production_date, 40),
    shopify_order_number: sanitizeText(task?.shopify_order_number || task?.order_number, 120),
    source_type: sanitizeText(task?.source_type, 80),
    schedule_source: sanitizeText(task?.schedule_source, 100),
    display_metadata_complete: taskHasDisplayMetadata(task),
  };
}

async function listCandidateCustomerOrders(base44, limit) {
  const rows = await base44.asServiceRole.entities.Order.list('-created_date', 80).catch(() => []);
  return (Array.isArray(rows) ? rows : [])
    .filter(order => {
      const status = paymentStatus(order);
      const method = fulfillmentMethod(order);
      return (status === 'paid' || order?.payment_captured === true) &&
        method === 'delivery' &&
        lineItemCount(order) > 0;
    })
    .slice(0, limit);
}

async function findCustomerOrder(base44, lookup) {
  const candidates = [];
  if (lookup.orderId) candidates.push({ id: lookup.orderId });
  if (lookup.orderNumber) candidates.push({ order_number: lookup.orderNumber });
  if (lookup.orderNumber) candidates.push({ shopify_order_number: lookup.orderNumber });
  for (const filter of candidates) {
    const rows = await base44.asServiceRole.entities.Order.filter(filter, '-created_date', 5).catch(() => []);
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
  }
  return null;
}

async function findNativeShopifyOrder(base44, customerOrder, lookup) {
  const orderNumber = lookup.orderNumber || normalizeOrderNumber(customerOrder?.order_number || customerOrder?.shopify_order_number);
  const queries = [];
  if (lookup.nativeOrderId) queries.push({ id: lookup.nativeOrderId });
  if (lookup.nativeOrderId) queries.push({ shopify_order_id: lookup.nativeOrderId });
  if (customerOrder?.id) queries.push({ base44_order_id: customerOrder.id });
  if (orderNumber) queries.push({ shopify_order_number: orderNumber });
  for (const filter of queries) {
    const rows = await base44.asServiceRole.entities.ShopifyOrder.filter(filter, '-created_date', 5).catch(() => []);
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
  }
  return null;
}

async function findNativeFulfillmentTasks(base44, customerOrder, nativeOrder, lookup) {
  const orderNumber = lookup.orderNumber || normalizeOrderNumber(customerOrder?.order_number || nativeOrder?.shopify_order_number);
  const queries = [];
  if (nativeOrder?.id) {
    queries.push({ order_id: nativeOrder.id });
    queries.push({ shopify_order_id: nativeOrder.id });
  }
  if (customerOrder?.id) {
    queries.push({ order_id: customerOrder.id });
    queries.push({ base44_order_id: customerOrder.id });
  }
  if (orderNumber) {
    queries.push({ order_number: orderNumber });
    queries.push({ shopify_order_number: orderNumber });
  }

  const seen = new Set();
  const out = [];
  for (const filter of queries) {
    const rows = await base44.asServiceRole.entities.FulfillmentTask.filter(filter, '-created_date', 10).catch(() => []);
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

async function runLiveOrderParityPreview({ base44, customerOrder, lookup, source, eventType }) {
  const response = await base44.asServiceRole.functions.invoke('previewNativeSafeSyncLiveOrderParity', compactObject({
    mode: 'dry_run',
    _internal_secret: getPreviewInternalSecret(),
    order_id: customerOrder?.id || lookup.orderId || null,
    order_number: lookup.orderNumber || normalizeOrderNumber(customerOrder?.order_number) || null,
    native_order_id: lookup.nativeOrderId || null,
    source,
    event_type: eventType,
    idempotency_key: `g27:cutover-readiness:${customerOrder?.id || lookup.orderNumber || lookup.nativeOrderId || Date.now()}`,
  }));
  return response?.data || response;
}

function gateSummary() {
  const nativeWriterAllowedSources = parseCsv(Deno.env.get('NATIVE_SAFE_SYNC_WRITER_ALLOWED_SOURCES'));
  const nativeWriterAllowedEvents = parseCsv(Deno.env.get('NATIVE_SAFE_SYNC_WRITER_ALLOWED_EVENTS'));
  return {
    native_safe_sync_writer: {
      enabled: Deno.env.get('ENABLE_NATIVE_SAFE_SYNC_WRITER') === 'true',
      kill_switch: Deno.env.get('NATIVE_SAFE_SYNC_WRITER_KILL_SWITCH') === 'true',
      secret_configured: Boolean(Deno.env.get('NATIVE_SAFE_SYNC_WRITER_SECRET') || Deno.env.get('CUSTOMER_APP_SYNC_SECRET')),
      allowed_sources: nativeWriterAllowedSources.slice(0, 10).map(value => sanitizeText(value, 80)).filter(Boolean),
      allowed_events: nativeWriterAllowedEvents.slice(0, 10).map(value => sanitizeText(value, 80)).filter(Boolean),
      order_allowlist_count: countCsv(Deno.env.get('NATIVE_SAFE_SYNC_WRITER_ORDER_ALLOWLIST')),
      actor_allowlist_count: countCsv(Deno.env.get('NATIVE_SAFE_SYNC_WRITER_ACTOR_EMAIL_ALLOWLIST') || Deno.env.get('NATIVE_SAFE_SYNC_WRITER_ACTOR_ALLOWLIST')),
      broad_real_order_mode: Deno.env.get('ENABLE_NATIVE_SAFE_SYNC_WRITER') === 'true' && countCsv(Deno.env.get('NATIVE_SAFE_SYNC_WRITER_ORDER_ALLOWLIST')) === 0,
    },
    may30_native_order_ops: {
      enabled: Deno.env.get('ENABLE_MAY30_NATIVE_ORDER_OPS') === 'true',
      secret_configured: Boolean(Deno.env.get('MAY30_NATIVE_ORDER_OPS_SECRET') || Deno.env.get('CUSTOMER_APP_SYNC_SECRET')),
      hub_bridge_fallback_expected: true,
    },
    native_fulfillment_task_materialization: {
      enabled: Deno.env.get('ENABLE_NATIVE_FULFILLMENT_TASK_MATERIALIZATION_WRITES') === 'true',
      kill_switch: Deno.env.get('NATIVE_FULFILLMENT_TASK_MATERIALIZATION_KILL_SWITCH') === 'true',
      order_allowlist_count: countCsv(Deno.env.get('NATIVE_FULFILLMENT_TASK_MATERIALIZATION_ORDER_ALLOWLIST')),
      actor_allowlist_count: countCsv(Deno.env.get('NATIVE_FULFILLMENT_TASK_MATERIALIZATION_ALLOWED_EMAILS')),
      broad_real_order_mode: Deno.env.get('ENABLE_NATIVE_FULFILLMENT_TASK_MATERIALIZATION_WRITES') === 'true' && countCsv(Deno.env.get('NATIVE_FULFILLMENT_TASK_MATERIALIZATION_ORDER_ALLOWLIST')) === 0,
    },
  };
}

function summarizeTarget({ customerOrder, nativeOrder, tasks, preview, lookup }) {
  const blockers = [];
  const warnings = [];
  const orderNumber = normalizeOrderNumber(customerOrder?.order_number || nativeOrder?.shopify_order_number || lookup.orderNumber);
  const paid = paymentStatus(customerOrder) === 'paid' || customerOrder?.payment_captured === true;
  const delivery = fulfillmentMethod(customerOrder) === 'delivery';
  const addressComplete = hasCompleteDeliveryAddress(customerOrder || {});
  const itemCount = lineItemCount(customerOrder);
  const parityReadiness = preview?.readiness || {};
  const parityBlockers = Array.isArray(parityReadiness.blockers) ? parityReadiness.blockers : [];
  const parityWarnings = Array.isArray(parityReadiness.warnings) ? parityReadiness.warnings : [];
  const displayCompleteTasks = tasks.filter(taskHasDisplayMetadata);

  if (!customerOrder) blockers.push('customer_app_order_missing');
  if (customerOrder && !paid) blockers.push('payment_not_paid');
  if (customerOrder && itemCount === 0) blockers.push('line_items_missing');
  if (customerOrder && delivery && !addressComplete) blockers.push('delivery_address_incomplete');
  if (parityBlockers.length > 0) blockers.push(...parityBlockers);
  if (nativeOrder && delivery && tasks.length === 0) warnings.push('native_fulfillment_task_missing');
  if (tasks.length > 0 && displayCompleteTasks.length === 0) warnings.push('native_task_display_metadata_incomplete');
  warnings.push(...parityWarnings);

  const uniqueBlockers = [...new Set(blockers)].slice(0, MAX_BLOCKERS);
  const uniqueWarnings = [...new Set(warnings)].slice(0, MAX_BLOCKERS);
  const planner = preview?.planner_summary || {};
  let classification = 'hold';
  if (uniqueBlockers.length > 0) classification = 'blocked';
  else if (!nativeOrder && planner.would_create_order) classification = 'pilot_ready_native_create_dry_run';
  else if (nativeOrder && (planner.would_update_order || planner.action === 'skipped' || planner.action === 'duplicate_event')) classification = 'pilot_ready_native_update_or_dedupe_dry_run';
  else if (nativeOrder && tasks.length > 0) classification = 'usable_with_hub_fallback';

  return {
    order_number: orderNumber || null,
    customer_app_order_id: customerOrder?.id || null,
    native_shopify_order_id: nativeOrder?.id || null,
    status: sanitizeText(customerOrder?.status, 80),
    payment_status: paymentStatus(customerOrder),
    payment_captured: customerOrder?.payment_captured === true,
    fulfillment_method: fulfillmentMethod(customerOrder),
    line_item_count: itemCount,
    address_complete: addressComplete,
    native_order_present: Boolean(nativeOrder),
    native_sync_status: sanitizeText(nativeOrder?.sync_status, 100),
    native_source_type: sanitizeText(nativeOrder?.source_type, 80),
    native_order_type: sanitizeText(nativeOrder?.order_type, 80),
    native_task_count: tasks.length,
    native_task_display_metadata_complete_count: displayCompleteTasks.length,
    native_tasks: tasks.slice(0, MAX_TASK_SUMMARY).map(summarizeTask),
    parity_status: preview?.parity_status || null,
    planner_summary: preview?.planner_summary || null,
    classification,
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
  };
}

function aggregateReadiness(targets, gates) {
  const blockers = [];
  const warnings = [];
  const targetBlockers = targets.flatMap(target => target.blockers || []);
  const targetWarnings = targets.flatMap(target => target.warnings || []);
  if (targets.length === 0) blockers.push('no_paid_delivery_orders_selected_or_found');
  if (targetBlockers.length > 0) blockers.push('one_or_more_targets_blocked');
  if (gates.native_safe_sync_writer.broad_real_order_mode) blockers.push('native_safe_sync_writer_broad_mode_enabled_unexpectedly');
  if (gates.native_fulfillment_task_materialization.broad_real_order_mode) blockers.push('native_task_materialization_broad_mode_enabled_unexpectedly');
  if (!gates.may30_native_order_ops.enabled) warnings.push('may30_native_order_ops_live_path_disabled_future_orders_need_existing_checkout_or_bridge_flow');
  if (!gates.native_safe_sync_writer.enabled) warnings.push('native_safe_sync_writer_disabled_for_broad_real_orders');
  if (!gates.native_fulfillment_task_materialization.enabled) warnings.push('native_task_materialization_writes_disabled');
  if (targetWarnings.length > 0) warnings.push('one_or_more_targets_have_warnings');

  const pilotReadyTargets = targets.filter(target => target.classification?.startsWith('pilot_ready'));
  const usableTargets = targets.filter(target => ['usable_with_hub_fallback', 'pilot_ready_native_create_dry_run', 'pilot_ready_native_update_or_dedupe_dry_run'].includes(target.classification));

  return {
    classification: blockers.length > 0
      ? 'hold_before_live_pilot'
      : pilotReadyTargets.length > 0
        ? 'pilot_ready_with_exact_order_approval'
        : usableTargets.length > 0
          ? 'usable_with_hub_fallback_monitor_next_order'
          : 'review_required',
    target_count: targets.length,
    pilot_ready_target_count: pilotReadyTargets.length,
    usable_target_count: usableTargets.length,
    blockers: [...new Set(blockers)].slice(0, MAX_BLOCKERS),
    warnings: [...new Set(warnings)].slice(0, MAX_BLOCKERS),
    target_blockers: [...new Set(targetBlockers)].slice(0, MAX_BLOCKERS),
    target_warnings: [...new Set(targetWarnings)].slice(0, MAX_BLOCKERS),
    hub_bridge_remains_fallback: true,
    live_pilot_requires_exact_order_approval: true,
    next_action: blockers.length > 0
      ? 'resolve_blockers_then_recheck'
      : pilotReadyTargets.length > 0
        ? 'approve_one_exact_order_live_pilot_or_continue_monitoring'
        : 'monitor_next_natural_paid_order',
  };
}

async function buildTargets(base44, body) {
  const limit = safeLimit(body?.limit);
  const lookup = getLookup(body);
  if (lookup.orderId || lookup.orderNumber || lookup.nativeOrderId) {
    let customerOrder = await findCustomerOrder(base44, lookup);
    if (!customerOrder && lookup.nativeOrderId) {
      const nativeOrder = await findNativeShopifyOrder(base44, null, lookup);
      customerOrder = await findCustomerOrder(base44, {
        orderId: nativeOrder?.base44_order_id || '',
        orderNumber: normalizeOrderNumber(nativeOrder?.shopify_order_number),
        nativeOrderId: lookup.nativeOrderId,
      });
    }
    return customerOrder ? [customerOrder] : [];
  }
  return listCandidateCustomerOrders(base44, limit);
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

    const source = sanitizeText(body?.source || 'customer_app', 80) || 'customer_app';
    const eventType = sanitizeText(body?.event_type || body?.event || 'order.created', 100) || 'order.created';
    const targets = await buildTargets(base44, body);
    const lookup = getLookup(body);
    const summaries = [];

    for (const customerOrder of targets) {
      const targetLookup = {
        orderId: customerOrder?.id || lookup.orderId,
        orderNumber: normalizeOrderNumber(customerOrder?.order_number || lookup.orderNumber),
        nativeOrderId: lookup.nativeOrderId,
      };
      const nativeOrder = await findNativeShopifyOrder(base44, customerOrder, targetLookup);
      const tasks = await findNativeFulfillmentTasks(base44, customerOrder, nativeOrder, targetLookup);
      const preview = await runLiveOrderParityPreview({ base44, customerOrder, lookup: targetLookup, source, eventType }).catch(error => ({
        success: false,
        parity_status: 'preview_failed',
        readiness: { blockers: ['live_order_parity_preview_failed'], warnings: [sanitizeText(error?.message, 120)].filter(Boolean) },
      }));
      summaries.push(summarizeTarget({ customerOrder, nativeOrder, tasks, preview, lookup: targetLookup }));
    }

    const gates = gateSummary();
    const readiness = aggregateReadiness(summaries, gates);

    return Response.json({
      success: readiness.blockers.length === 0,
      dry_run: true,
      function_name: 'previewNativeOrderCutoverReadiness',
      generated_at: new Date().toISOString(),
      scope: lookup.orderId || lookup.orderNumber || lookup.nativeOrderId ? 'specific_order' : 'recent_paid_delivery_orders',
      source,
      event_type: eventType,
      readiness,
      gates,
      targets: summaries,
      safety: {
        dry_run_only: true,
        writes_performed: false,
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
    console.error(`[previewNativeOrderCutoverReadiness] failed safely: ${error?.message || 'unknown error'}`);
    return Response.json({
      success: false,
      dry_run: true,
      error_code: 'native_order_cutover_readiness_failed',
      message: 'Native order cutover readiness preview failed safely.',
      writes_performed: false,
    }, { status: 500 });
  }
});
