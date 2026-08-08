// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ENABLE_WRITES_FLAG = 'ENABLE_NATIVE_FULFILLMENT_TASK_LIFECYCLE_WRITES';
const ALLOWED_EMAILS_FLAG = 'NATIVE_FULFILLMENT_TASK_LIFECYCLE_ALLOWED_EMAILS';
const ALLOWED_ACTIONS_FLAG = 'NATIVE_FULFILLMENT_TASK_LIFECYCLE_ALLOWED_ACTIONS';
const ENABLE_TEST_WRITES_FLAG = 'ENABLE_NATIVE_FULFILLMENT_TASK_TEST_LIFECYCLE_WRITES';
const TEST_ALLOWED_EMAILS_FLAG = 'NATIVE_FULFILLMENT_TASK_LIFECYCLE_TEST_ALLOWED_EMAILS';
const TEST_ALLOWED_ACTIONS_FLAG = 'NATIVE_FULFILLMENT_TASK_LIFECYCLE_TEST_ALLOWED_ACTIONS';
const TEST_TASK_ALLOWLIST_FLAG = 'NATIVE_FULFILLMENT_TASK_LIFECYCLE_TEST_TASK_ALLOWLIST';
const KILL_SWITCH_FLAG = 'NATIVE_FULFILLMENT_TASK_LIFECYCLE_KILL_SWITCH';
const ALLOWED_ACTIONS = new Set(['assign', 'unassign', 'pack', 'out_for_delivery', 'delivered_operational']);
const TERMINAL_STATUSES = new Set(['delivered', 'cancelled', 'unable_to_deliver', 'Delivered', 'Cancelled']);
const PACKABLE_STATUSES = new Set(['pending', 'scheduled', 'assigned', 'in_production', 'Scheduled']);
const OUT_FOR_DELIVERY_STATUSES = new Set(['packed', 'bottled_packed', 'ready_for_delivery', 'Packed']);
const DELIVERABLE_STATUSES = new Set(['out_for_delivery', 'Out For Delivery']);
const SAFE_ARRAY_LIMIT = 40;
const SAFE_SUMMARY_LIMIT = 12;

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
  return value.slice(0, SAFE_ARRAY_LIMIT).map((item) => sanitizeText(item, maxLength)).filter(Boolean);
}

function parseCsvSet(value) {
  return new Set(normalizeText(value).split(',').map(normalizeLower).filter(Boolean));
}

function taskAllowlistKeys(task) {
  return [task?.id, task?.fulfillment_task_id, task?.order_number, task?.shopify_order_number]
    .map(normalizeLower)
    .filter(Boolean);
}

function isInternalTestTask(task) {
  const taskId = normalizeLower(task?.fulfillment_task_id || task?.id);
  const sourceChannel = normalizeLower(task?.source_channel || task?.source_type || task?.task_source);
  const testPurpose = normalizeLower(task?.test_purpose);
  return task?.is_test_task === true ||
    taskId.includes('-test-') ||
    sourceChannel.includes('internal_validation') ||
    testPurpose.includes('internal');
}

function buildLiveGate({ task, action, actorEmail }) {
  const internalTestTask = isInternalTestTask(task);
  const enableFlag = internalTestTask ? ENABLE_TEST_WRITES_FLAG : ENABLE_WRITES_FLAG;
  const allowedEmailsFlag = internalTestTask ? TEST_ALLOWED_EMAILS_FLAG : ALLOWED_EMAILS_FLAG;
  const allowedActionsFlag = internalTestTask ? TEST_ALLOWED_ACTIONS_FLAG : ALLOWED_ACTIONS_FLAG;
  const writerEnabled = Deno.env.get(enableFlag) === 'true';
  const killSwitchActive = Deno.env.get(KILL_SWITCH_FLAG) === 'true';
  const allowedEmails = parseCsvSet(Deno.env.get(allowedEmailsFlag) || '');
  const allowedActions = parseCsvSet(Deno.env.get(allowedActionsFlag) || '');
  const actorAllowed = allowedEmails.has(normalizeLower(actorEmail));
  const actionAllowed = allowedActions.has(normalizeLower(action));
  const testAllowedTasks = parseCsvSet(Deno.env.get(TEST_TASK_ALLOWLIST_FLAG) || '');
  const testTaskAllowlisted = !internalTestTask || taskAllowlistKeys(task).some(key => testAllowedTasks.has(key));
  const testMarkerValid = !internalTestTask || task?.is_test_task === true;
  const blockers = [];
  if (killSwitchActive) blockers.push('kill_switch_active');
  if (!writerEnabled) blockers.push(internalTestTask
    ? 'native_fulfillment_task_test_lifecycle_writes_disabled'
    : 'native_fulfillment_task_lifecycle_writes_disabled');
  if (allowedEmails.size === 0) blockers.push('allowed_email_gate_required');
  else if (!actorAllowed) blockers.push('actor_email_not_allowlisted');
  if (allowedActions.size === 0) blockers.push('allowed_action_gate_required');
  else if (!actionAllowed) blockers.push('action_not_allowlisted');
  if (internalTestTask && testAllowedTasks.size === 0) blockers.push('test_task_allowlist_required');
  else if (internalTestTask && !testTaskAllowlisted) blockers.push('test_task_not_allowlisted');
  if (!testMarkerValid) blockers.push('test_task_allowlist_requires_test_marker');
  return {
    writer_enabled: writerEnabled,
    blockers,
    details: {
      kill_switch_active: killSwitchActive,
      actor_email_allowed: actorAllowed,
      action_allowed: actionAllowed,
      operational_task_authorized: !internalTestTask,
      test_task_allowlisted: internalTestTask && testTaskAllowlisted,
      test_task_marker_valid: testMarkerValid,
      legacy_exact_task_allowlist_required: false,
    },
  };
}

function safeItemsSummary(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, SAFE_SUMMARY_LIMIT).map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const title = sanitizeText(item.title || item.name || item.product_title || item.variant_title, 120);
    const quantity = safeNumber(item.quantity);
    const summary = {};
    if (title) summary.title = title;
    if (quantity !== null) summary.quantity = quantity;
    return Object.keys(summary).length ? summary : null;
  }).filter(Boolean);
}

function hasDeliveryAddress(task) {
  return Boolean(
    sanitizeText(task.address, 220) ||
    sanitizeText(task.address_line1, 120) ||
    (task.delivery_address && typeof task.delivery_address === 'object' && Object.keys(task.delivery_address).length > 0),
  );
}

function hasAssignedDriver(task) {
  return Boolean(
    sanitizeText(task.assigned_driver, 120) ||
    sanitizeId(task.assigned_driver_id) ||
    sanitizeText(task.assigned_driver_email, 120),
  );
}

function isDeliveryFulfillment(task) {
  const type = normalizeLower(task.fulfillment_type || task.source_type);
  if (!type) return false;
  return type.includes('delivery') || type.includes('driver');
}

function appendCommonGuards(task, blockers) {
  if (!sanitizeId(task.id) && !sanitizeId(task.fulfillment_task_id)) blockers.push('missing_task_identity');
  if (!sanitizeId(task.order_id) && !sanitizeId(task.shopify_order_id) && !sanitizeId(task.order_number)) {
    blockers.push('missing_order_reference');
  }
  if (TERMINAL_STATUSES.has(task.status)) blockers.push('task_terminal_status');
  if (task.review_status && normalizeLower(task.review_status) !== 'resolved') blockers.push('task_review_unresolved');
}

function buildBaseSummary(task) {
  const items = Array.isArray(task.items) ? task.items : [];
  return {
    fulfillment_task_id: sanitizeId(task.id) || sanitizeId(task.fulfillment_task_id) || null,
    order_id: sanitizeId(task.order_id) || sanitizeId(task.shopify_order_id) || null,
    order_number: sanitizeText(task.order_number || task.shopify_order_number, 80) || null,
    current_status: sanitizeText(task.status, 80) || null,
    delivery_status: sanitizeText(task.delivery_status, 80) || null,
    production_status: sanitizeText(task.production_status, 80) || null,
    source_type: sanitizeText(task.source_type, 80) || null,
    fulfillment_type: sanitizeText(task.fulfillment_type, 80) || null,
    delivery_date: sanitizeText(task.delivery_date || task.assigned_delivery_date || task.scheduled_date, 40) || null,
    production_date: sanitizeText(task.production_date, 40) || null,
    item_count: items.length,
    safe_item_summary: safeItemsSummary(items),
    assigned_driver_present: hasAssignedDriver(task),
    delivery_address_present: hasDeliveryAddress(task),
    audit_trail_count: Array.isArray(task.audit_trail) ? task.audit_trail.length : 0,
  };
}

function buildCommandDraft({ action, task, actorEmail, requestId, now }) {
  return {
    command_type: `fulfillment_task_${action}_preview`,
    command_source: 'customer_app_native_preview',
    target_entity: 'FulfillmentTask',
    target_id: sanitizeId(task.id) || sanitizeId(task.fulfillment_task_id) || null,
    target_display_id: sanitizeText(task.order_number || task.shopify_order_number || task.fulfillment_task_id || task.id, 120) || null,
    actor_email: sanitizeText(actorEmail, 120) || null,
    actor_type: actorEmail ? 'admin' : 'unknown',
    status: 'dry_run',
    request_id: sanitizeId(requestId) || null,
    function_name: 'previewNativeFulfillmentTaskLifecycle',
    notes: 'Dry-run only. No records are created or updated.',
    submitted_at: now,
    completed_at: now,
  };
}

function auditTrailAppend({ action, actorEmail, requestId, now }) {
  return {
    timestamp: now,
    action: `fulfillment_task_${action}`,
    performed_by: sanitizeText(actorEmail, 120) || 'native_preview_actor',
    reason: 'Native dry-run fulfillment task lifecycle preview',
    request_id: sanitizeId(requestId) || null,
  };
}

function planAssign({ task, actorEmail, requestId, now, assignmentInput }) {
  const blockers = [];
  const warnings = [];
  appendCommonGuards(task, blockers);

  const driverName = sanitizeText(assignmentInput.assigned_driver || assignmentInput.driver_name, 120);
  const driverId = sanitizeId(assignmentInput.assigned_driver_id || assignmentInput.driver_id);
  const driverEmail = sanitizeText(assignmentInput.assigned_driver_email || assignmentInput.driver_email, 120);
  if (!driverName && !driverId && !driverEmail) blockers.push('missing_driver_identity');

  if (task.status && normalizeLower(task.status) === 'out_for_delivery') warnings.push('assignment_after_out_for_delivery_requires_review');
  if (hasAssignedDriver(task)) warnings.push('driver_already_assigned');

  const status = ['pending', 'scheduled', 'Scheduled'].includes(task.status) ? 'assigned' : (sanitizeText(task.status, 80) || 'assigned');
  const proposedPatch = blockers.length ? null : {
    ...(driverName ? { assigned_driver: driverName } : {}),
    ...(driverId ? { assigned_driver_id: driverId } : {}),
    ...(driverEmail ? { assigned_driver_email: driverEmail } : {}),
    assigned_at: now,
    status,
    audit_trail_append: auditTrailAppend({ action: 'assign', actorEmail, requestId, now }),
  };

  return {
    projected_writes: blockers.length ? [] : [
      'FulfillmentTask.assigned_driver',
      'FulfillmentTask.assigned_driver_id',
      'FulfillmentTask.assigned_driver_email',
      'FulfillmentTask.assigned_at',
      'FulfillmentTask.status',
      'FulfillmentTask.audit_trail',
    ],
    proposed_patch: proposedPatch,
    blockers,
    warnings,
  };
}

function planUnassign({ task, actorEmail, requestId, now }) {
  const blockers = [];
  const warnings = [];
  appendCommonGuards(task, blockers);
  if (!hasAssignedDriver(task)) blockers.push('driver_not_assigned');
  if (normalizeLower(task.status) === 'out_for_delivery') blockers.push('cannot_unassign_out_for_delivery_task');

  const proposedPatch = blockers.length ? null : {
    assigned_driver: null,
    assigned_driver_id: null,
    assigned_driver_email: null,
    assigned_at: null,
    status: normalizeLower(task.status) === 'assigned' ? 'scheduled' : (sanitizeText(task.status, 80) || 'scheduled'),
    audit_trail_append: auditTrailAppend({ action: 'unassign', actorEmail, requestId, now }),
  };

  if (task.route_id || task.route_stop_sequence) warnings.push('route_assignment_should_be_recomputed');

  return {
    projected_writes: blockers.length ? [] : [
      'FulfillmentTask.assigned_driver',
      'FulfillmentTask.assigned_driver_id',
      'FulfillmentTask.assigned_driver_email',
      'FulfillmentTask.assigned_at',
      'FulfillmentTask.status',
      'FulfillmentTask.audit_trail',
    ],
    proposed_patch: proposedPatch,
    blockers,
    warnings,
  };
}

function planPack({ task, actorEmail, requestId, now }) {
  const blockers = [];
  const warnings = [];
  appendCommonGuards(task, blockers);
  if (!PACKABLE_STATUSES.has(task.status)) blockers.push('status_not_packable');
  if (!Array.isArray(task.items) || task.items.length === 0) blockers.push('missing_items');
  if (task.packed_at) warnings.push('already_packed_timestamp_present');

  const proposedPatch = blockers.length ? null : {
    status: 'packed',
    production_status: 'packed',
    packed_at: now,
    audit_trail_append: auditTrailAppend({ action: 'pack', actorEmail, requestId, now }),
  };

  return {
    projected_writes: blockers.length ? [] : [
      'FulfillmentTask.status',
      'FulfillmentTask.production_status',
      'FulfillmentTask.packed_at',
      'FulfillmentTask.audit_trail',
    ],
    proposed_patch: proposedPatch,
    blockers,
    warnings,
  };
}

function planOutForDelivery({ task, actorEmail, requestId, now }) {
  const blockers = [];
  const warnings = [];
  appendCommonGuards(task, blockers);
  if (!OUT_FOR_DELIVERY_STATUSES.has(task.status)) blockers.push('status_not_ready_for_delivery');
  if (!isDeliveryFulfillment(task)) blockers.push('not_delivery_fulfillment');
  if (!hasDeliveryAddress(task)) blockers.push('missing_delivery_address');
  if (!hasAssignedDriver(task)) blockers.push('missing_assigned_driver');

  const proposedPatch = blockers.length ? null : {
    status: 'out_for_delivery',
    delivery_status: 'out_for_delivery',
    out_for_delivery_at: now,
    audit_trail_append: auditTrailAppend({ action: 'out_for_delivery', actorEmail, requestId, now }),
  };
  warnings.push('customer_status_projection_deferred');
  warnings.push('customer_notification_not_included');

  return {
    projected_writes: blockers.length ? [] : [
      'FulfillmentTask.status',
      'FulfillmentTask.delivery_status',
      'FulfillmentTask.out_for_delivery_at',
      'FulfillmentTask.audit_trail',
    ],
    proposed_patch: proposedPatch,
    blockers,
    warnings,
  };
}

function boolFlag(value) {
  return value === true || normalizeLower(value) === 'true' || normalizeLower(value) === 'yes';
}

function sanitizeUrl(value, maxLength = 500) {
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

function planDeliveredOperational({ task, actorEmail, requestId, now, deliveryInput }) {
  const blockers = [];
  const warnings = [];
  appendCommonGuards(task, blockers);
  if (!DELIVERABLE_STATUSES.has(task.status)) blockers.push('status_not_deliverable');
  if (!isDeliveryFulfillment(task)) blockers.push('not_delivery_fulfillment');
  if (!hasAssignedDriver(task)) blockers.push('missing_assigned_driver');

  const deliveryDropLocation = sanitizeText(deliveryInput.delivery_drop_location || deliveryInput.drop_location, 120);
  const deliveryNotes = sanitizeText(deliveryInput.delivery_notes || deliveryInput.notes, 300);
  const deliveryPhotoUrl = sanitizeUrl(deliveryInput.delivery_photo_url || deliveryInput.proof_url || deliveryInput.drop_photo_url);
  const projectCustomerOrder = boolFlag(deliveryInput.update_customer_order_status);
  const notifyCustomer = boolFlag(deliveryInput.notify_customer || deliveryInput.send_notification);
  const proofWrites = [];
  const proofPatch = {};
  if (deliveryDropLocation) {
    proofWrites.push('FulfillmentTask.delivery_drop_location');
    proofPatch.delivery_drop_location = deliveryDropLocation;
  } else {
    warnings.push('delivery_drop_location_not_provided');
  }
  if (deliveryNotes) {
    proofWrites.push('FulfillmentTask.delivery_notes');
    proofPatch.delivery_notes = deliveryNotes;
  }
  if (deliveryPhotoUrl) {
    proofWrites.push('FulfillmentTask.delivery_photo_url');
    proofPatch.delivery_photo_url = deliveryPhotoUrl;
  } else {
    warnings.push('proof_photo_not_provided');
  }

  const proposedPatch = blockers.length ? null : {
    status: 'delivered',
    delivery_status: 'delivered',
    delivered_at: now,
    delivered_by: sanitizeText(actorEmail, 120) || null,
    ...proofPatch,
    audit_trail_append: auditTrailAppend({ action: 'delivered_operational', actorEmail, requestId, now }),
  };
  if (!projectCustomerOrder) warnings.push('customer_status_projection_deferred');
  if (!notifyCustomer) warnings.push('customer_notification_not_included');

  return {
    projected_writes: blockers.length ? [] : [
      'FulfillmentTask.status',
      'FulfillmentTask.delivery_status',
      'FulfillmentTask.delivered_at',
      'FulfillmentTask.delivered_by',
      'FulfillmentTask.audit_trail',
      ...proofWrites,
      ...(projectCustomerOrder ? [
        'Order.status',
        'Order.status_history',
        'Order.delivered_at',
        'Order.delivery_photo_url',
        'Order.delivery_drop_location',
        'Order.delivery_notes',
      ] : []),
      ...(notifyCustomer ? ['Notification.order_status'] : []),
    ],
    proposed_patch: proposedPatch,
    blockers,
    warnings,
  };
}

function planLifecycle(input) {
  const body = safeObject(input);
  const action = normalizeLower(body.action);
  const task = safeObject(body.task);
  const actorEmail = body.actor_email;
  const requestId = body.request_id;
  const now = sanitizeText(body.now, 40) || new Date().toISOString();
  const assignmentInput = safeObject(body.assignment_input);
  const deliveryInput = safeObject(body.delivery_input);

  if (!ALLOWED_ACTIONS.has(action)) {
    return {
      success: false,
      dry_run: true,
      error_code: 'unsupported_action',
      error: 'action must be assign, unassign, pack, out_for_delivery, or delivered_operational',
      status: 400,
    };
  }

  if (body.mode && normalizeLower(body.mode) !== 'dry_run') {
    return {
      success: false,
      dry_run: true,
      action,
      error_code: 'dry_run_only',
      error: 'previewNativeFulfillmentTaskLifecycle does not support live mode',
      status: 400,
    };
  }

  let plan;
  if (action === 'assign') {
    plan = planAssign({ task, actorEmail, requestId, now, assignmentInput });
  } else if (action === 'unassign') {
    plan = planUnassign({ task, actorEmail, requestId, now });
  } else if (action === 'pack') {
    plan = planPack({ task, actorEmail, requestId, now });
  } else if (action === 'out_for_delivery') {
    plan = planOutForDelivery({ task, actorEmail, requestId, now });
  } else {
    plan = planDeliveredOperational({ task, actorEmail, requestId, now, deliveryInput });
  }

  const blockers = safeStringArray(plan.blockers);
  const warnings = safeStringArray(plan.warnings);
  const liveGate = buildLiveGate({ task, action, actorEmail });
  const liveCommandBlockers = [...new Set([...blockers, ...liveGate.blockers])];
  const liveCommandAvailable = liveCommandBlockers.length === 0;
  return {
    success: true,
    dry_run: true,
    action,
    native_writer_enabled: liveGate.writer_enabled,
    source: 'customer_app_native_preview',
    ...buildBaseSummary(task),
    lifecycle_ready: blockers.length === 0,
    native_write_allowed: liveCommandAvailable,
    live_command_available: liveCommandAvailable,
    live_command_blockers: liveCommandBlockers,
    live_gate: liveGate.details,
    projected_writes: safeStringArray(plan.projected_writes),
    proposed_patch: plan.proposed_patch,
    command_log_draft: buildCommandDraft({ action, task, actorEmail, requestId, now }),
    blockers,
    warnings,
    response_safety: {
      raw_payload_returned: false,
      live_records_read: false,
      live_records_mutated: false,
      external_service_calls: false,
      customer_notification_sent: false,
      proof_drop_processed: false,
      route_optimization_run: false,
    },
    status: 200,
  };
}

export default async function handler(req: Request) {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', error: 'Method not allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ success: false, dry_run: true, error_code: 'unauthorized', error: 'Unauthorized' }, { status: 401 });
    }
    if (!user || user.role !== 'admin') {
      return Response.json({ success: false, dry_run: true, error_code: 'forbidden', error: 'Forbidden' }, { status: 403 });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ success: false, dry_run: true, error_code: 'malformed_json', error: 'Malformed JSON' }, { status: 400 });
    }

    const result = planLifecycle({ ...body, actor_email: user.email });
    const status = result.status || 200;
    delete result.status;
    return Response.json(result, { status });
  } catch {
    return Response.json({
      success: false,
      dry_run: true,
      error_code: 'preview_failed',
      error: 'Unable to preview native fulfillment task lifecycle',
    }, { status: 500 });
  }
}
