import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

const TARGET = {
  ca_order_number: 'NV-MPPU43TO',
  hub_order_id: '6a188b516e3006cf4112f8e6',
  customer_email: 'info@nuvirajuice.com',
  current_delivery_date: '2026-05-30',
  current_production_date: '2026-05-29',
  current_window_label: 'Saturday 12 PM - 3 PM',
  target_delivery_date: '2026-06-03',
  target_production_date: '2026-06-02',
  target_window_label: 'Wednesday 5 PM - 8 PM',
  target_window_start: '2026-06-03T22:00:00.000Z',
  target_window_end: '2026-06-04T01:00:00.000Z',
};

const CONFIRMATION = 'correct_NV-MPPU43TO_to_2026-06-03';
const TERMINAL_CA_ORDER_STATUSES = new Set(['delivered', 'picked_up', 'refunded', 'cancelled', 'canceled']);
const TERMINAL_NATIVE_TASK_STATUSES = new Set(['delivered', 'cancelled', 'completed']);

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function sanitizeText(value, maxLength = 180) {
  const text = normalizeText(value)
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function normalizeId(value, fieldName) {
  const text = normalizeText(value);
  if (!text) throw new Error(`${fieldName} is required`);
  if (text.length > 180 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
}

function unsupportedKeys(body) {
  const allowed = new Set([
    'dry_run',
    'confirm',
    'request_id',
    'order_id',
    'order_number',
    'target_delivery_date',
    'target_production_date',
    'target_window_label',
  ]);
  return Object.keys(body || {}).filter((key) => !allowed.has(key));
}

function safeOrderSnapshot(order) {
  if (!order) return null;
  return {
    id: order.id,
    order_number: order.order_number,
    customer_email: order.customer_email,
    status: order.status || null,
    payment_status: order.payment_status || null,
    payment_captured: order.payment_captured === true,
    fulfillment_type: order.fulfillment_type || null,
    estimated_delivery_date: order.estimated_delivery_date || null,
    assigned_delivery_date: order.assigned_delivery_date || null,
    selected_delivery_date: order.selected_delivery_date || null,
    production_date: order.production_date || null,
    assigned_production_day: order.assigned_production_day || null,
    delivery_window_label: order.delivery_window_label || null,
    assigned_delivery_window_start: order.assigned_delivery_window_start || null,
    assigned_delivery_window_end: order.assigned_delivery_window_end || null,
    status_history_count: Array.isArray(order.status_history) ? order.status_history.length : 0,
  };
}

function safeNativeOrderSnapshot(order) {
  if (!order) return null;
  return {
    id: order.id,
    order_number: order.shopify_order_number,
    source_channel: order.source_channel || null,
    order_type: order.order_type || null,
    payment_status: order.payment_status || null,
    production_status: order.production_status || null,
    fulfillment_status: order.fulfillment_status || null,
    requested_delivery_date: order.requested_delivery_date || null,
    selected_delivery_date: order.selected_delivery_date || null,
    assigned_delivery_date: order.assigned_delivery_date || null,
    production_date: order.production_date || null,
    delivery_window_label: order.delivery_window_label || null,
    fulfillments: Array.isArray(order.fulfillments)
      ? order.fulfillments.map((fulfillment) => ({
          fulfillment_number: fulfillment.fulfillment_number || null,
          production_date: fulfillment.production_date || null,
          delivery_date: fulfillment.delivery_date || null,
          status: fulfillment.status || null,
          item_count: Array.isArray(fulfillment.line_items || fulfillment.items) ? (fulfillment.line_items || fulfillment.items).length : 0,
        }))
      : [],
    audit_trail_count: Array.isArray(order.audit_trail) ? order.audit_trail.length : 0,
  };
}

function safeTaskSnapshot(task) {
  if (!task) return null;
  return {
    id: task.id,
    order_id: task.order_id || null,
    customer_email: task.customer_email || null,
    fulfillment_number: task.fulfillment_number || null,
    delivery_date: task.delivery_date || null,
    status: task.status || null,
    notes_present: Boolean(task.notes),
  };
}

async function safeListCommandLogs(base44) {
  try {
    return await base44.asServiceRole.entities.CommandLog.filter({ target_display_id: TARGET.ca_order_number });
  } catch (error) {
    if (isMissingEntitySchemaError(error, 'CommandLog')) return [];
    throw error;
  }
}

async function resolveAdmin(base44) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' };
  if (user.role !== 'admin') return { ok: false, status: 403, error: 'Forbidden' };
  return {
    ok: true,
    email: user.email || 'admin',
    role: user.role,
  };
}

async function loadSnapshot(base44) {
  const [ordersByNumber, nativeByNumber, taskList, commandLogs] = await Promise.all([
    base44.asServiceRole.entities.Order.filter({ order_number: TARGET.ca_order_number }).catch(() => []),
    base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_number: TARGET.ca_order_number }).catch(() => []),
    base44.asServiceRole.entities.FulfillmentTask.list('-created_date', 200).catch(() => []),
    safeListCommandLogs(base44),
  ]);

  const order = ordersByNumber?.[0] || null;
  const nativeOrder = nativeByNumber?.[0] || null;
  const nativeTasks = (taskList || []).filter((task) =>
    task.order_id === nativeOrder?.id ||
    task.order_id === order?.id ||
    task.customer_email === TARGET.customer_email && task.delivery_date === TARGET.current_delivery_date
  );

  return { order, nativeOrder, nativeTasks, commandLogs: commandLogs || [] };
}

function validateSnapshot(snapshot) {
  const blockers = [];
  const warnings = [];
  const { order, nativeOrder, nativeTasks } = snapshot;

  if (!order) blockers.push('customer_app_order_not_found');
  if (order) {
    if (order.order_number !== TARGET.ca_order_number) blockers.push('order_number_mismatch');
    if (normalizeLower(order.customer_email) !== normalizeLower(TARGET.customer_email)) blockers.push('customer_email_mismatch');
    if (order.payment_status !== 'paid' || order.payment_captured !== true) blockers.push('order_not_paid');
    if (TERMINAL_CA_ORDER_STATUSES.has(normalizeLower(order.status))) blockers.push('customer_app_order_terminal');
    if (order.assigned_delivery_date !== TARGET.current_delivery_date && order.estimated_delivery_date !== TARGET.current_delivery_date) {
      warnings.push('current_customer_app_delivery_date_not_expected');
    }
  }

  if (!nativeOrder) warnings.push('native_shopify_order_not_found');
  if (nativeOrder && normalizeLower(nativeOrder.customer_email) !== normalizeLower(TARGET.customer_email)) blockers.push('native_customer_email_mismatch');

  for (const task of nativeTasks) {
    if (TERMINAL_NATIVE_TASK_STATUSES.has(normalizeLower(task.status))) {
      blockers.push(`native_task_terminal:${task.id}`);
    }
  }

  return { blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] };
}

function buildCustomerAppOrderPatch(order) {
  return {
    estimated_delivery_date: TARGET.target_delivery_date,
    assigned_delivery_date: TARGET.target_delivery_date,
    production_date: TARGET.target_production_date,
    assigned_production_day: TARGET.target_production_date,
    assigned_delivery_day: 'Wednesday',
    delivery_window_label: TARGET.target_window_label,
    assigned_delivery_window_start: TARGET.target_window_start,
    assigned_delivery_window_end: TARGET.target_window_end,
    delivery_window_timezone: 'America/Chicago',
    notes: `${normalizeText(order.notes)}\nDelivery date corrected to ${TARGET.target_delivery_date}; production ${TARGET.target_production_date}; no customer notification sent.`.trim(),
  };
}

function buildCorrectedFulfillments(order) {
  const fulfillments = Array.isArray(order.fulfillments) && order.fulfillments.length > 0
    ? order.fulfillments
    : [{
        fulfillment_number: 1,
        line_items: Array.isArray(order.line_items) ? order.line_items : [],
        status: 'pending',
      }];

  return fulfillments.map((fulfillment, index) => {
    if (index !== 0) return fulfillment;
    return {
      ...fulfillment,
      production_date: TARGET.target_production_date,
      delivery_date: TARGET.target_delivery_date,
      delivery_window_label: TARGET.target_window_label,
      status: fulfillment.status || 'pending',
    };
  });
}

function buildNativeOrderPatch(order, actor, requestId) {
  const auditEntry = {
    timestamp: new Date().toISOString(),
    action: 'CorrectDeliverySchedule',
    performed_by: actor.email,
    request_id: requestId,
    before: {
      requested_delivery_date: order.requested_delivery_date || null,
      selected_delivery_date: order.selected_delivery_date || null,
      assigned_delivery_date: order.assigned_delivery_date || null,
      production_date: order.production_date || null,
      delivery_window_label: order.delivery_window_label || null,
    },
    after: {
      requested_delivery_date: TARGET.target_delivery_date,
      selected_delivery_date: TARGET.target_delivery_date,
      assigned_delivery_date: TARGET.target_delivery_date,
      production_date: TARGET.target_production_date,
      delivery_window_label: TARGET.target_window_label,
    },
    reason: 'Customer selected June 3; May 30 was written by stale/conflicting checkout schedule option.',
  };

  return {
    requested_delivery_date: TARGET.target_delivery_date,
    selected_delivery_date: TARGET.target_delivery_date,
    assigned_delivery_date: TARGET.target_delivery_date,
    production_date: TARGET.target_production_date,
    delivery_window_label: TARGET.target_window_label,
    delivery_window_start: TARGET.target_window_start,
    delivery_window_end: TARGET.target_window_end,
    fulfillments: buildCorrectedFulfillments(order),
    audit_trail: [...(Array.isArray(order.audit_trail) ? order.audit_trail : []), auditEntry],
    internal_notes: `${normalizeText(order.internal_notes)}\n[${auditEntry.timestamp}] Delivery schedule corrected to ${TARGET.target_delivery_date}; request_id=${requestId}.`.trim(),
  };
}

function buildTaskPatch(task, requestId) {
  return {
    delivery_date: TARGET.target_delivery_date,
    notes: `${normalizeText(task.notes)}\nDelivery date corrected to ${TARGET.target_delivery_date}; request_id=${requestId}.`.trim(),
  };
}

function findExistingCommandLog(snapshot, requestId) {
  return (snapshot.commandLogs || []).find((log) =>
    log.command_type === 'correct_order_delivery_schedule' &&
    log.idempotency_key === requestId &&
    log.target_display_id === TARGET.ca_order_number
  ) || null;
}

function isMissingEntitySchemaError(error, entityName) {
  return normalizeLower(error?.message || error).includes(`entity schema ${normalizeLower(entityName)} not found`);
}

async function createOrReuseCommandLog(base44, existingLog, commandLogPatch) {
  try {
    if (existingLog) {
      await base44.asServiceRole.entities.CommandLog.update(existingLog.id, commandLogPatch);
      return { commandLog: existingLog, warning: null };
    }

    const commandLog = await base44.asServiceRole.entities.CommandLog.create({
      ...commandLogPatch,
      submitted_at: new Date().toISOString(),
    });
    return { commandLog, warning: null };
  } catch (error) {
    if (isMissingEntitySchemaError(error, 'CommandLog')) {
      return { commandLog: null, warning: 'customer_app_command_log_entity_unavailable' };
    }
    throw error;
  }
}

async function updateCommandLogIfAvailable(base44, commandLog, patch) {
  if (!commandLog?.id) return;
  await base44.asServiceRole.entities.CommandLog.update(commandLog.id, patch);
}

async function callHubCorrection(body, user) {
  if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
    return { success: false, error_code: 'hub_not_configured' };
  }
  const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
  const response = await fetch(`${hubBase}/functions/correctHubOrderDeliveryScheduleForCustomerApp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
    },
    body: JSON.stringify({
      dry_run: body.dry_run !== false,
      confirm: body.confirm,
      request_id: body.request_id,
      order_id: TARGET.hub_order_id,
      order_number: TARGET.ca_order_number,
      target_delivery_date: TARGET.target_delivery_date,
      target_production_date: TARGET.target_production_date,
      target_window_label: TARGET.target_window_label,
      actor_email: user.email,
      actor_role: user.role,
    }),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, ...data };
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await resolveAdmin(base44);
    if (!user.ok) return Response.json({ error: user.error }, { status: user.status });

    const body = await req.json().catch(() => ({}));
    const unsupported = unsupportedKeys(body);
    if (unsupported.length > 0) {
      return Response.json({ error: 'unsupported_fields', fields: unsupported.slice(0, 5) }, { status: 400 });
    }

    const requestId = normalizeId(body.request_id, 'request_id');
    const dryRun = body.dry_run !== false;

    const snapshot = await loadSnapshot(base44);
    if ((body.order_id && snapshot?.order?.id && body.order_id !== snapshot.order.id) || body.order_number !== TARGET.ca_order_number) {
      return Response.json({ success: false, error_code: 'target_not_allowlisted' }, { status: 403 });
    }
    if (body.target_delivery_date !== TARGET.target_delivery_date || body.target_production_date !== TARGET.target_production_date) {
      return Response.json({ success: false, error_code: 'target_date_not_allowlisted' }, { status: 403 });
    }

    const existingLog = findExistingCommandLog(snapshot, requestId);
    if (existingLog?.status === 'success') {
      return Response.json({
        success: true,
        skipped: true,
        dry_run: dryRun,
        reason: 'duplicate_request_id',
        request_id: requestId,
        command_log_id: existingLog.id,
      });
    }

    const validation = validateSnapshot(snapshot);
    const before = {
      customer_app_order: safeOrderSnapshot(snapshot.order),
      native_shopify_order: safeNativeOrderSnapshot(snapshot.nativeOrder),
      native_fulfillment_tasks: snapshot.nativeTasks.map(safeTaskSnapshot),
    };

    const hubPreview = await callHubCorrection({ ...body, dry_run: true }, user);
    if (hubPreview.success !== true || hubPreview.live_allowed === false) {
      validation.blockers.push(`hub_preview_failed:${hubPreview.error_code || hubPreview.status || 'unknown'}`);
    }

    if (!dryRun && hubPreview.skipped === true) {
      return Response.json({
        success: true,
        skipped: true,
        dry_run: false,
        reason: hubPreview.reason || 'duplicate_request_id',
        request_id: requestId,
        command_log_id: existingLog?.id || null,
        hub_command_log_id: hubPreview.hub_command_log_id || null,
        before,
        side_effects: {
          notifications_sent: false,
          provider_calls: false,
          stripe_calls: false,
          shopify_calls: false,
          inventory_or_po_mutation: false,
          status_history_written: false,
          sync_retry_repair_run: false,
        },
      });
    }

    if (validation.blockers.length > 0) {
      return Response.json({
        success: false,
        dry_run: true,
        live_allowed: false,
        blockers: validation.blockers,
        warnings: validation.warnings,
        before,
        hub_preview: hubPreview,
      }, { status: 409 });
    }

    const preview = {
      customer_app_order_patch: {
        estimated_delivery_date: TARGET.target_delivery_date,
        assigned_delivery_date: TARGET.target_delivery_date,
        production_date: TARGET.target_production_date,
        assigned_production_day: TARGET.target_production_date,
        delivery_window_label: TARGET.target_window_label,
      },
      native_shopify_order_patch: snapshot.nativeOrder ? {
        assigned_delivery_date: TARGET.target_delivery_date,
        selected_delivery_date: TARGET.target_delivery_date,
        requested_delivery_date: TARGET.target_delivery_date,
        production_date: TARGET.target_production_date,
        delivery_window_label: TARGET.target_window_label,
      } : null,
      native_fulfillment_task_patch_count: snapshot.nativeTasks.length,
    };

    if (dryRun) {
      return Response.json({
        success: true,
        dry_run: true,
        live_allowed: true,
        request_id: requestId,
        blockers: [],
        warnings: validation.warnings,
        before,
        preview,
        hub_preview: hubPreview,
        side_effect_policy: {
          notifications: false,
          provider_calls: false,
          stripe_calls: false,
          shopify_calls: false,
          inventory_or_po: false,
          status_history: false,
        },
      });
    }

    if (body.confirm !== CONFIRMATION) {
      return Response.json({ success: false, error_code: 'confirmation_required' }, { status: 400 });
    }

    const commandLogPatch = {
      command_type: 'correct_order_delivery_schedule',
      command_source: 'customer_app_admin',
      status: 'running',
      target_entity: 'Order',
      target_id: snapshot.order.id,
      target_display_id: TARGET.ca_order_number,
      actor_email: user.email,
      actor_role: user.role,
      actor_type: 'admin',
      payload: {
        order_number: TARGET.ca_order_number,
        from_delivery_date: TARGET.current_delivery_date,
        to_delivery_date: TARGET.target_delivery_date,
        from_production_date: TARGET.current_production_date,
        to_production_date: TARGET.target_production_date,
      },
      idempotency_key: requestId,
      request_id: requestId,
      started_at: new Date().toISOString(),
      function_name: 'correctAdminOrderDeliverySchedule',
      related_order_id: snapshot.order.id,
      related_order_number: TARGET.ca_order_number,
      notes: 'One-record correction for checkout schedule mismatch. No notifications/provider/inventory/PO actions.',
    };

    const { commandLog, warning: commandLogWarning } = await createOrReuseCommandLog(base44, existingLog, commandLogPatch);

    await base44.asServiceRole.entities.Order.update(snapshot.order.id, buildCustomerAppOrderPatch(snapshot.order));

    let nativeOrderAction = 'not_found';
    if (snapshot.nativeOrder) {
      await base44.asServiceRole.entities.ShopifyOrder.update(snapshot.nativeOrder.id, buildNativeOrderPatch(snapshot.nativeOrder, user, requestId));
      nativeOrderAction = 'updated';
    }

    const nativeTaskResults = [];
    for (const task of snapshot.nativeTasks) {
      await base44.asServiceRole.entities.FulfillmentTask.update(task.id, buildTaskPatch(task, requestId));
      nativeTaskResults.push({ id: task.id, action: 'updated' });
    }

    const hubResult = await callHubCorrection({ ...body, dry_run: false }, user);
    if (hubResult.success !== true) {
      await updateCommandLogIfAvailable(base44, commandLog, {
        status: 'failed',
        error_code: hubResult.error_code || 'hub_correction_failed',
        error_message: sanitizeText(hubResult.error || hubResult.message || 'Hub correction failed', 240),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
      });
      return Response.json({
        success: false,
        error_code: 'hub_correction_failed_after_customer_app_update',
        command_log_id: commandLog?.id || null,
        command_log_warning: commandLogWarning,
        hub_result: hubResult,
      }, { status: 502 });
    }

    const afterSnapshot = await loadSnapshot(base44);
    const after = {
      customer_app_order: safeOrderSnapshot(afterSnapshot.order),
      native_shopify_order: safeNativeOrderSnapshot(afterSnapshot.nativeOrder),
      native_fulfillment_tasks: afterSnapshot.nativeTasks.map(safeTaskSnapshot),
    };

    await updateCommandLogIfAvailable(base44, commandLog, {
      status: 'success',
      result: {
        customer_app_order_updated: true,
        native_shopify_order_action: nativeOrderAction,
        native_fulfillment_task_updates: nativeTaskResults,
        hub_result_summary: {
          success: hubResult.success === true,
          skipped: hubResult.skipped === true,
          hub_command_log_id: hubResult.hub_command_log_id || null,
        },
      },
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    });

    return Response.json({
      success: true,
      skipped: false,
      dry_run: false,
      request_id: requestId,
      command_log_id: commandLog?.id || null,
      command_log_warning: commandLogWarning,
      before,
      after,
      native_shopify_order_action: nativeOrderAction,
      native_fulfillment_task_updates: nativeTaskResults,
      hub_result: hubResult,
      side_effects: {
        notifications_sent: false,
        provider_calls: false,
        stripe_calls: false,
        shopify_calls: false,
        inventory_or_po_mutation: false,
        status_history_written: false,
        sync_retry_repair_run: false,
      },
    });
  } catch (error) {
    console.error('[correctAdminOrderDeliverySchedule] Error:', error?.message || error);
    return Response.json({ success: false, error_code: 'correction_failed', error: sanitizeText(error?.message || error, 180) }, { status: 500 });
  }
});
