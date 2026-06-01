import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const COMMAND_TYPE = 'native_fulfillment_task_materialization';
const ENABLE_WRITES_FLAG = 'ENABLE_NATIVE_FULFILLMENT_TASK_MATERIALIZATION_WRITES';
const ALLOWED_EMAILS_FLAG = 'NATIVE_FULFILLMENT_TASK_MATERIALIZATION_ALLOWED_EMAILS';
const ORDER_ALLOWLIST_FLAG = 'NATIVE_FULFILLMENT_TASK_MATERIALIZATION_ORDER_ALLOWLIST';
const KILL_SWITCH_FLAG = 'NATIVE_FULFILLMENT_TASK_MATERIALIZATION_KILL_SWITCH';
const CONFIRMATION_PHRASE = 'execute_native_fulfillment_task_materialization';
const SAFE_ARRAY_LIMIT = 40;

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

function operationalText(value, maxLength = 160) {
  const text = normalizeSingleLine(value).replace(/[\u0000-\u001f\u007f]/g, '');
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function sanitizeId(value, maxLength = 180) {
  const text = sanitizeText(value, maxLength);
  return /^[A-Za-z0-9._:@/#-]+$/.test(text) ? text : '';
}

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeStringArray(value, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, SAFE_ARRAY_LIMIT).map(item => sanitizeText(item, maxLength)).filter(Boolean);
}

function parseCsvSet(value) {
  return new Set(normalizeText(value).split(',').map(normalizeLower).filter(Boolean));
}

function parseIsoDate(value, fieldName) {
  const text = normalizeText(value);
  if (!text) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${fieldName} must use YYYY-MM-DD format`);
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== text) throw new Error(`${fieldName} must be a valid calendar date`);
  return text;
}

async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function lineItemsSummary(items) {
  if (!Array.isArray(items)) return '';
  return items
    .slice(0, 8)
    .map(item => `${safeNumber(item.quantity) ?? 0}x ${operationalText(item.title || item.name || item.product_title, 80)}`)
    .filter(item => !item.startsWith('0x '))
    .join(', ');
}

function taskItemsFromOrder(order) {
  if (!Array.isArray(order.line_items)) return [];
  return order.line_items.slice(0, SAFE_ARRAY_LIMIT).map(item => ({
    product_id: sanitizeId(item.shopify_line_item_id || item.id, 120),
    title: operationalText(item.title || item.name || item.product_title, 120) || 'Item',
    price: safeNumber(item.price) ?? 0,
    quantity: safeNumber(item.quantity) ?? 0,
  })).filter(item => item.title && item.quantity > 0);
}

function deliveryAddress(order) {
  return operationalText(order.delivery_address || order.address || [
    order.address_line1,
    order.address_city,
    order.address_state,
    order.address_postal_code,
  ].filter(Boolean).join(', '), 280);
}

function hasNativeMarker(order) {
  const tags = Array.isArray(order.tags) ? order.tags.map(normalizeLower) : [];
  return tags.includes('may30_native_ops') ||
    normalizeLower(order.sync_status) === 'native_may30_ready' ||
    normalizeLower(order.source_type).includes('customer_app') ||
    normalizeLower(order.source_channel) === 'online';
}

function buildTaskDraft(order, body, requestId, actorEmail) {
  const deliveryDate = parseIsoDate(body.delivery_date || body.assigned_delivery_date || body.target_delivery_date, 'delivery_date');
  const productionDate = parseIsoDate(body.production_date || body.target_production_date, 'production_date');
  const windowLabel = sanitizeText(body.delivery_window_label || order.delivery_window_label || order.requested_time_window, 120);
  const items = taskItemsFromOrder(order);
  const address = deliveryAddress(order);
  const now = new Date().toISOString();

  return {
    order_id: order.id,
    shopify_order_id: order.id,
    shopify_order_number: operationalText(order.shopify_order_number || order.order_number, 120),
    order_number: operationalText(order.shopify_order_number || order.order_number, 120),
    customer_name: operationalText(order.customer_name, 160),
    customer_email: operationalText(order.customer_email, 180),
    customer_phone: operationalText(order.customer_phone, 80),
    source_channel: sanitizeText(order.source_channel || 'customer_app', 80),
    source_type: sanitizeText(order.source_type || 'customer_app_native', 80),
    fulfillment_type: 'delivery',
    fulfillment_number: 1,
    delivery_date: deliveryDate,
    scheduled_date: deliveryDate,
    assigned_delivery_date: deliveryDate,
    ...(productionDate ? { production_date: productionDate } : {}),
    ...(windowLabel ? { time_window: windowLabel, delivery_window_label: windowLabel } : {}),
    address,
    delivery_address: address,
    address_line1: operationalText(order.address_line1, 120),
    address_line2: operationalText(order.address_line2, 120),
    address_city: operationalText(order.address_city, 100),
    address_state: operationalText(order.address_state, 80),
    address_postal_code: operationalText(order.address_postal_code, 40),
    items,
    items_summary: lineItemsSummary(order.line_items),
    status: 'scheduled',
    delivery_status: 'scheduled',
    production_status: sanitizeText(order.production_status, 80) || 'awaiting_production',
    payment_status: sanitizeText(order.payment_status || order.financial_status, 80),
    sync_status: 'native_task_materialized',
    schedule_source: 'native_admin_materialization',
    internal_notes: sanitizeText(`Native fulfillment task materialized. Request=${requestId}.`, 500),
    review_status: null,
    review_reason: null,
    audit_trail: [{
      timestamp: now,
      action: 'native_fulfillment_task_materialized',
      performed_by: sanitizeText(actorEmail, 120) || 'native_admin_actor',
      request_id: sanitizeId(requestId) || null,
    }],
  };
}

async function findOrder(base44, body) {
  const key = sanitizeId(body.shopify_order_id || body.native_order_id || body.order_id);
  if (key) {
    const byId = await base44.asServiceRole.entities.ShopifyOrder.get(key).catch(() => null);
    if (byId?.id) return { order: byId, matches: [byId] };
  }

  const orderNumber = sanitizeText(body.order_number || body.shopify_order_number, 120);
  const filters = [];
  if (orderNumber) {
    filters.push({ shopify_order_number: orderNumber });
    filters.push({ order_number: orderNumber });
  }

  const matches = [];
  for (const filter of filters) {
    const found = await base44.asServiceRole.entities.ShopifyOrder.filter(filter, '-created_date', 5).catch(() => []);
    for (const item of found || []) {
      if (item?.id && !matches.some(match => match.id === item.id)) matches.push(item);
    }
  }

  return { order: matches.length === 1 ? matches[0] : null, matches };
}

async function findExistingTasks(base44, order) {
  if (!order?.id) return [];
  const queries = [
    { order_id: order.id },
    { shopify_order_id: order.id },
    { shopify_order_number: order.shopify_order_number },
    { order_number: order.shopify_order_number || order.order_number },
  ].filter(filter => Object.values(filter)[0]);
  const matches = [];
  for (const filter of queries) {
    const found = await base44.asServiceRole.entities.FulfillmentTask.filter(filter, '-created_date', 10).catch(() => []);
    for (const item of found || []) {
      if (item?.id && !matches.some(match => match.id === item.id)) matches.push(item);
    }
  }
  return matches;
}

function buildPlan(order, existingTasks, body, requestId, actorEmail) {
  const blockers = [];
  const warnings = [];
  if (!order?.id) {
    return {
      ready: false,
      blockers: ['order_not_found'],
      warnings,
      draft: null,
      projected_writes: [],
    };
  }
  if (existingTasks.length > 0) blockers.push('fulfillment_task_already_exists');
  if (!hasNativeMarker(order)) warnings.push('native_marker_not_present');
  if (normalizeLower(order.order_type) === 'subscription' || order.stripe_subscription_id) blockers.push('subscription_order_not_supported');
  if (normalizeLower(order.order_type) === 'pos' || normalizeLower(order.source_channel) === 'pos' || normalizeLower(order.fulfillment_method) === 'pos') blockers.push('pos_order_not_delivery_task');
  if (normalizeLower(order.fulfillment_method) !== 'delivery') blockers.push('not_delivery_order');
  if (!['paid', 'succeeded'].includes(normalizeLower(order.payment_status || order.financial_status))) blockers.push('payment_not_paid');
  if (['cancelled', 'canceled', 'refunded'].includes(normalizeLower(order.payment_status || order.financial_status || order.order_status))) blockers.push('order_cancelled_or_refunded');
  if (!deliveryAddress(order)) blockers.push('missing_delivery_address');
  if (!Array.isArray(order.line_items) || order.line_items.length === 0) blockers.push('missing_line_items');

  let draft = null;
  try {
    draft = buildTaskDraft(order, body, requestId, actorEmail);
    if (!draft.delivery_date) blockers.push('missing_delivery_date');
    if (!draft.production_date) warnings.push('production_date_not_provided');
  } catch (error) {
    blockers.push(error.message.includes('production_date') ? 'invalid_production_date' : 'invalid_delivery_date');
  }

  return {
    ready: blockers.length === 0,
    blockers: safeStringArray(blockers),
    warnings: safeStringArray(warnings),
    draft: blockers.length === 0 ? draft : null,
    projected_writes: blockers.length === 0
      ? ['ShopifyOrder.assigned_delivery_date', 'ShopifyOrder.selected_delivery_date', 'ShopifyOrder.requested_delivery_date', 'FulfillmentTask']
      : [],
  };
}

function envGateFailure({ actorEmail, order }) {
  if (Deno.env.get(KILL_SWITCH_FLAG) === 'true') return 'kill_switch_active';
  if (Deno.env.get(ENABLE_WRITES_FLAG) !== 'true') return 'native_fulfillment_task_materialization_writes_disabled';

  const allowedEmails = parseCsvSet(Deno.env.get(ALLOWED_EMAILS_FLAG) || '');
  if (allowedEmails.size === 0) return 'allowed_email_gate_required';
  if (!allowedEmails.has(normalizeLower(actorEmail))) return 'actor_email_not_allowlisted';

  const allowlist = parseCsvSet(Deno.env.get(ORDER_ALLOWLIST_FLAG) || '');
  if (allowlist.size === 0) return 'order_allowlist_required';
  const candidates = [
    order?.id,
    order?.shopify_order_id,
    order?.shopify_order_number,
    order?.order_number,
    order?.base44_order_id,
  ].map(normalizeLower).filter(Boolean);
  if (!candidates.some(candidate => allowlist.has(candidate))) return 'order_not_allowlisted';
  return null;
}

async function findExistingCommandLog(base44, idempotencyKey) {
  return base44.asServiceRole.entities.CommandLog.filter({ idempotency_key: idempotencyKey }, '-created_date', 1).catch(() => []);
}

async function createCommandLog({ base44, order, status, idempotencyKey, requestId, user, result, errorCode, errorMessage }) {
  const now = new Date().toISOString();
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: COMMAND_TYPE,
    command_source: 'customer_app_native_admin',
    status,
    target_entity: 'ShopifyOrder',
    target_id: order?.id || null,
    target_display_id: sanitizeText(order?.shopify_order_number || order?.order_number, 120) || null,
    actor_email: sanitizeText(user?.email, 180) || null,
    actor_role: sanitizeText(user?.role, 80) || null,
    actor_type: 'admin',
    payload: { exact_order_allowlist: true },
    result,
    error_code: errorCode || null,
    error_message: errorMessage ? sanitizeText(errorMessage, 180) : null,
    idempotency_key: idempotencyKey,
    idempotent_skipped: status === 'skipped',
    request_id: requestId,
    submitted_at: now,
    completed_at: status === 'running' ? null : now,
    function_name: 'executeNativeFulfillmentTaskMaterialization',
    notes: 'Creates one native FulfillmentTask and assigns delivery schedule fields to the exact native ShopifyOrder. No Customer App Order, notification, provider, Stripe/Shopify, inventory, PO, sync, or repair writes.',
  });
}

async function updateCommandLog({ base44, commandLogId, status, result, errorCode, errorMessage }) {
  if (!commandLogId) return null;
  return base44.asServiceRole.entities.CommandLog.update(commandLogId, {
    status,
    result,
    error_code: errorCode || null,
    error_message: errorMessage ? sanitizeText(errorMessage, 180) : null,
    idempotent_skipped: status === 'skipped',
    completed_at: new Date().toISOString(),
  });
}

function orderPatchFromDraft(order, draft, requestId, actorEmail) {
  const existingTrail = Array.isArray(order.audit_trail) ? order.audit_trail.slice(-100) : [];
  return {
    assigned_delivery_date: draft.delivery_date,
    selected_delivery_date: draft.delivery_date,
    requested_delivery_date: draft.delivery_date,
    ...(draft.production_date ? { production_date: draft.production_date } : {}),
    ...(draft.delivery_window_label ? { delivery_window_label: draft.delivery_window_label, requested_time_window: draft.delivery_window_label } : {}),
    fulfillment_status: 'scheduled',
    sync_status: 'native_task_materialized',
    data_quality_status: order.data_quality_status || 'complete',
    audit_trail: [...existingTrail, {
      timestamp: new Date().toISOString(),
      action: 'native_fulfillment_task_materialized',
      performed_by: sanitizeText(actorEmail, 120) || 'native_admin_actor',
      request_id: sanitizeId(requestId),
    }],
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', error: 'Method not allowed' }, { status: 405 });
    }

    if (Deno.env.get(ENABLE_WRITES_FLAG) !== 'true') {
      return Response.json({
        success: false,
        skipped: true,
        error_code: 'native_fulfillment_task_materialization_writes_disabled',
        native_writer_enabled: false,
        writes_performed: false,
      }, { status: 409 });
    }

    const base44 = createClientFromRequest(req);
    const body = await readJsonBody(req);
    if (body === null) return Response.json({ success: false, error_code: 'malformed_json' }, { status: 400 });

    let user;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ success: false, error_code: 'unauthorized' }, { status: 401 });
    }
    if (user?.role !== 'admin') return Response.json({ success: false, error_code: 'forbidden' }, { status: 403 });

    if (normalizeText(body.confirmation) !== CONFIRMATION_PHRASE || normalizeLower(body.mode) !== 'live') {
      return Response.json({ success: false, error_code: 'confirmation_required' }, { status: 400 });
    }

    const requestId = sanitizeId(body.request_id);
    if (!requestId) return Response.json({ success: false, error_code: 'request_id_required' }, { status: 400 });
    const actorEmail = normalizeLower(user.email);
    const idempotencyKey = `${COMMAND_TYPE}:${requestId}`;

    const existingLogs = await findExistingCommandLog(base44, idempotencyKey);
    const existingLog = Array.isArray(existingLogs) && existingLogs.length > 0 ? existingLogs[0] : null;
    if (existingLog && existingLog.status !== 'failed') {
      return Response.json({
        success: true,
        skipped: true,
        idempotent: true,
        reason: 'idempotency_log_present',
        request_id: requestId,
        idempotency_key: idempotencyKey,
        native_writer_enabled: true,
        writes_performed: false,
      });
    }

    const { order, matches } = await findOrder(base44, body);
    if (!order && matches.length > 1) {
      return Response.json({ success: false, skipped: true, error_code: 'multiple_order_matches', writes_performed: false }, { status: 409 });
    }
    if (!order) return Response.json({ success: false, skipped: true, error_code: 'order_not_found', writes_performed: false }, { status: 404 });

    const gateFailure = envGateFailure({ actorEmail, order });
    if (gateFailure) {
      return Response.json({
        success: false,
        skipped: true,
        error_code: gateFailure,
        native_writer_enabled: true,
        writes_performed: false,
      }, { status: 409 });
    }

    const existingTasks = await findExistingTasks(base44, order);
    const plan = buildPlan(order, existingTasks, body, requestId, actorEmail);
    if (!plan.ready || !plan.draft) {
      await createCommandLog({
        base44,
        order,
        status: 'rejected',
        idempotencyKey,
        requestId,
        user,
        result: { blockers: plan.blockers, warnings: plan.warnings, writes_performed: false },
        errorCode: 'materialization_preflight_blocked',
        errorMessage: plan.blockers.join(', '),
      });
      return Response.json({
        success: false,
        skipped: true,
        error_code: 'materialization_preflight_blocked',
        blockers: plan.blockers,
        warnings: plan.warnings,
        native_writer_enabled: true,
        writes_performed: false,
      }, { status: 409 });
    }

    const commandLog = await createCommandLog({
      base44,
      order,
      status: 'running',
      idempotencyKey,
      requestId,
      user,
      result: {
        projected_writes: plan.projected_writes,
        warnings: plan.warnings,
        writes_performed: false,
      },
    });

    let updatedOrder;
    let createdTask;
    try {
      updatedOrder = await base44.asServiceRole.entities.ShopifyOrder.update(order.id, orderPatchFromDraft(order, plan.draft, requestId, actorEmail));
      createdTask = await base44.asServiceRole.entities.FulfillmentTask.create(plan.draft);
    } catch (error) {
      await updateCommandLog({
        base44,
        commandLogId: commandLog?.id,
        status: 'failed',
        result: {
          projected_writes: plan.projected_writes,
          warnings: plan.warnings,
          writes_performed: false,
          order_updated: Boolean(updatedOrder?.id),
          fulfillment_task_created: false,
        },
        errorCode: 'materialization_write_failed',
        errorMessage: error?.message || 'Materialization write failed',
      }).catch(() => null);
      throw error;
    }

    await updateCommandLog({
      base44,
      commandLogId: commandLog?.id,
      status: 'success',
      result: {
        projected_writes: plan.projected_writes,
        warnings: plan.warnings,
        writes_performed: true,
        order_updated: true,
        fulfillment_task_created: true,
        fulfillment_task_id: sanitizeId(createdTask?.id) || null,
        customer_notification_sent: false,
        external_service_calls: false,
        inventory_or_po_mutation: false,
      },
    });

    return Response.json({
      success: true,
      skipped: false,
      request_id: requestId,
      idempotency_key: idempotencyKey,
      order_id: updatedOrder?.id || order.id,
      order_number: sanitizeText(updatedOrder?.shopify_order_number || order.shopify_order_number || order.order_number, 120) || null,
      fulfillment_task_id: sanitizeId(createdTask?.id) || null,
      command_log_id: sanitizeId(commandLog?.id) || null,
      projected_writes: plan.projected_writes,
      warnings: plan.warnings,
      native_writer_enabled: true,
      writes_performed: true,
      order_updated: true,
      fulfillment_task_created: true,
      customer_app_order_updated: false,
      customer_notification_sent: false,
      provider_calls: false,
      stripe_calls: false,
      shopify_calls: false,
      inventory_or_po_mutation: false,
      sync_retry_repair_run: false,
    });
  } catch {
    console.error('[executeNativeFulfillmentTaskMaterialization] Error');
    return Response.json({
      success: false,
      error_code: 'internal_error',
      error: 'Unable to execute native fulfillment task materialization',
      writes_performed: false,
    }, { status: 500 });
  }
});
