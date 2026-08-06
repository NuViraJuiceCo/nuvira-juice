import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const COMMAND_TYPE = 'native_fulfillment_task_lifecycle';
const SOURCE = 'customer_app_native_admin';
const ENABLE_WRITES_FLAG = 'ENABLE_NATIVE_FULFILLMENT_TASK_LIFECYCLE_WRITES';
const ALLOWED_EMAILS_FLAG = 'NATIVE_FULFILLMENT_TASK_LIFECYCLE_ALLOWED_EMAILS';
const TASK_ALLOWLIST_FLAG = 'NATIVE_FULFILLMENT_TASK_LIFECYCLE_TASK_ALLOWLIST';
const ALLOWED_ACTIONS_FLAG = 'NATIVE_FULFILLMENT_TASK_LIFECYCLE_ALLOWED_ACTIONS';
const ENABLE_TEST_WRITES_FLAG = 'ENABLE_NATIVE_FULFILLMENT_TASK_TEST_LIFECYCLE_WRITES';
const TEST_ALLOWED_EMAILS_FLAG = 'NATIVE_FULFILLMENT_TASK_LIFECYCLE_TEST_ALLOWED_EMAILS';
const TEST_TASK_ALLOWLIST_FLAG = 'NATIVE_FULFILLMENT_TASK_LIFECYCLE_TEST_TASK_ALLOWLIST';
const TEST_ALLOWED_ACTIONS_FLAG = 'NATIVE_FULFILLMENT_TASK_LIFECYCLE_TEST_ALLOWED_ACTIONS';
const KILL_SWITCH_FLAG = 'NATIVE_FULFILLMENT_TASK_LIFECYCLE_KILL_SWITCH';
const CONFIRMATION_PHRASE = 'execute_native_fulfillment_task_lifecycle';
const ALLOWED_ACTIONS = new Set(['assign', 'unassign', 'pack', 'out_for_delivery', 'delivered_operational']);
const TERMINAL_STATUSES = new Set(['delivered', 'cancelled', 'unable_to_deliver']);
const PACKABLE_STATUSES = new Set(['pending', 'scheduled', 'assigned', 'in_production']);
const OUT_FOR_DELIVERY_STATUSES = new Set(['packed', 'bottled_packed', 'ready_for_delivery']);
const DELIVERABLE_STATUSES = new Set(['out_for_delivery']);
const MAX_REASON_LENGTH = 300;
const MAX_DROP_LOCATION_LENGTH = 120;
const MAX_DELIVERY_NOTES_LENGTH = 300;
const MAX_DELIVERY_PHOTO_URL_LENGTH = 500;
const SAFE_ARRAY_LIMIT = 50;

const ALLOWED_BODY_KEYS = new Set([
  'mode',
  'confirmation',
  'fulfillment_task_id',
  'task_id',
  'action',
  'request_id',
  'reason',
  'assigned_driver',
  'assigned_driver_id',
  'assigned_driver_email',
  'delivery_drop_location',
  'delivery_notes',
  'delivery_photo_url',
  'notify_customer',
  'update_customer_order_status',
]);

const FORBIDDEN_BODY_KEYS = new Set([
  'raw_payload',
  'payload',
  'raw_body',
  'raw_task',
  'task',
  'raw_order',
  'order',
  'order_update',
  'customer_app_order_update',
  'shopify_order_update',
  'production_batch_update',
  'inventory_update',
  'purchase_order_update',
  'review_queue_update',
  'status_history',
  'notification',
  'send_notification',
  'notify_customer',
  'proof',
  'proof_url',
  'proof_file',
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
  'stripe_id',
  'shopify_id',
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

function sanitizeId(value, maxLength = 180) {
  const text = sanitizeText(value, maxLength);
  return /^[A-Za-z0-9._:@/#-]+$/.test(text) ? text : '';
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeStringArray(value, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, SAFE_ARRAY_LIMIT).map((item) => sanitizeText(item, maxLength)).filter(Boolean);
}

function parseCsvSet(value) {
  return new Set(
    normalizeText(value)
      .split(',')
      .map((item) => normalizeLower(item))
      .filter(Boolean),
  );
}

async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function normalizeActorEmail(value) {
  const email = normalizeSingleLine(value).toLowerCase();
  if (!email || email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Authenticated admin email is unavailable');
  }
  return email;
}

function normalizeAction(value) {
  const action = normalizeLower(value);
  if (!ALLOWED_ACTIONS.has(action)) {
    throw new Error('action must be assign, unassign, pack, out_for_delivery, or delivered_operational');
  }
  return action;
}

function normalizeDriver(value, fieldName, { required = false } = {}) {
  const text = sanitizeText(value, 120);
  if (!text) {
    if (required) throw new Error(`${fieldName} is required`);
    return '';
  }
  if (!/^[A-Za-z0-9 ._'@+-]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  if (fieldName === 'assigned_driver' && (/^\d+$/.test(text) || text.length < 2)) {
    throw new Error('assigned_driver must be a safe internal driver label or email');
  }
  return text;
}

function boolFlag(value) {
  return value === true || normalizeLower(value) === 'true' || normalizeLower(value) === 'yes';
}

function findUnsupportedBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const key of Object.keys(body)) {
    const normalized = normalizeLower(key);
    if (ALLOWED_BODY_KEYS.has(normalized)) continue;
    if (FORBIDDEN_BODY_KEYS.has(normalized)) return key;
    if (/(^|_)(customer|order|task|batch|inventory|purchase_order|review_queue|delivery|route|proof|provider|compliance)_(id|ids|status|update|mutation|payload|name|email|phone|address|fields|url|file)$/i.test(normalized)) {
      return key;
    }
    if (/(^|_)(header|headers|authorization|auth|secret|token|api_key|api-key)$/i.test(normalized)) {
      return key;
    }
  }
  return null;
}

function isDeliveryFulfillment(task) {
  const type = normalizeLower(task.fulfillment_type || task.source_type);
  return Boolean(type && (type.includes('delivery') || type.includes('driver')));
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

function normalizedStatus(task) {
  return normalizeLower(task.status);
}

function appendCommonGuards(task, blockers) {
  if (!sanitizeId(task.id) && !sanitizeId(task.fulfillment_task_id)) blockers.push('missing_task_identity');
  if (!sanitizeId(task.order_id) && !sanitizeId(task.shopify_order_id) && !sanitizeText(task.order_number, 80)) {
    blockers.push('missing_order_reference');
  }
  if (TERMINAL_STATUSES.has(normalizedStatus(task))) blockers.push('task_terminal_status');
  if (task.review_status && normalizeLower(task.review_status) !== 'resolved') blockers.push('task_review_unresolved');
}

function auditTrailAppend({ action, actorEmail, requestId, now, reason }) {
  return {
    timestamp: now,
    action: `fulfillment_task_${action}`,
    performed_by: sanitizeText(actorEmail, 120) || 'native_admin_actor',
    reason: sanitizeText(reason, MAX_REASON_LENGTH) || 'Native fulfillment task lifecycle command',
    request_id: sanitizeId(requestId) || null,
  };
}

function planAssign({ task, actorEmail, requestId, now, body, reason }) {
  const blockers = [];
  const warnings = [];
  appendCommonGuards(task, blockers);

  const assignedDriver = normalizeDriver(body.assigned_driver, 'assigned_driver', { required: true });
  const assignedDriverId = sanitizeId(body.assigned_driver_id);
  const assignedDriverEmail = normalizeDriver(body.assigned_driver_email, 'assigned_driver_email');
  if (hasAssignedDriver(task)) warnings.push('driver_already_assigned');
  if (normalizedStatus(task) === 'out_for_delivery') warnings.push('assignment_after_out_for_delivery_requires_review');

  const status = ['pending', 'scheduled'].includes(normalizedStatus(task))
    ? 'assigned'
    : (sanitizeText(task.status, 80) || 'assigned');

  return {
    projected_writes: blockers.length ? [] : [
      'FulfillmentTask.assigned_driver',
      'FulfillmentTask.assigned_driver_id',
      'FulfillmentTask.assigned_driver_email',
      'FulfillmentTask.assigned_at',
      'FulfillmentTask.status',
      'FulfillmentTask.audit_trail',
    ],
    proposed_patch: blockers.length ? null : {
      assigned_driver: assignedDriver,
      ...(assignedDriverId ? { assigned_driver_id: assignedDriverId } : {}),
      ...(assignedDriverEmail ? { assigned_driver_email: assignedDriverEmail } : {}),
      assigned_at: now,
      status,
      audit_trail_append: auditTrailAppend({ action: 'assign', actorEmail, requestId, now, reason }),
    },
    blockers,
    warnings,
  };
}

function planUnassign({ task, actorEmail, requestId, now, reason }) {
  const blockers = [];
  const warnings = [];
  appendCommonGuards(task, blockers);
  if (!hasAssignedDriver(task)) blockers.push('driver_not_assigned');
  if (normalizedStatus(task) === 'out_for_delivery') blockers.push('cannot_unassign_out_for_delivery_task');
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
    proposed_patch: blockers.length ? null : {
      assigned_driver: null,
      assigned_driver_id: null,
      assigned_driver_email: null,
      assigned_at: null,
      status: normalizedStatus(task) === 'assigned' ? 'scheduled' : (sanitizeText(task.status, 80) || 'scheduled'),
      audit_trail_append: auditTrailAppend({ action: 'unassign', actorEmail, requestId, now, reason }),
    },
    blockers,
    warnings,
  };
}

function planPack({ task, actorEmail, requestId, now, reason }) {
  const blockers = [];
  const warnings = [];
  appendCommonGuards(task, blockers);
  if (!PACKABLE_STATUSES.has(normalizedStatus(task))) blockers.push('status_not_packable');
  if (!Array.isArray(task.items) || task.items.length === 0) blockers.push('missing_items');
  if (task.packed_at) warnings.push('already_packed_timestamp_present');

  return {
    projected_writes: blockers.length ? [] : [
      'FulfillmentTask.status',
      'FulfillmentTask.production_status',
      'FulfillmentTask.packed_at',
      'FulfillmentTask.audit_trail',
    ],
    proposed_patch: blockers.length ? null : {
      status: 'packed',
      production_status: 'packed',
      packed_at: now,
      audit_trail_append: auditTrailAppend({ action: 'pack', actorEmail, requestId, now, reason }),
    },
    blockers,
    warnings,
  };
}

function planOutForDelivery({ task, actorEmail, requestId, now, body, reason }) {
  const blockers = [];
  const warnings = [];
  const projectCustomerOrder = boolFlag(body.update_customer_order_status);
  const notifyCustomer = boolFlag(body.notify_customer);
  appendCommonGuards(task, blockers);
  if (!OUT_FOR_DELIVERY_STATUSES.has(normalizedStatus(task))) blockers.push('status_not_ready_for_delivery');
  if (!isDeliveryFulfillment(task)) blockers.push('not_delivery_fulfillment');
  if (!hasDeliveryAddress(task)) blockers.push('missing_delivery_address');
  if (!hasAssignedDriver(task)) blockers.push('missing_assigned_driver');
  if (!projectCustomerOrder) warnings.push('customer_status_projection_deferred');
  if (!notifyCustomer) warnings.push('customer_notification_not_included');

  return {
    projected_writes: blockers.length ? [] : [
      'FulfillmentTask.status',
      'FulfillmentTask.delivery_status',
      'FulfillmentTask.out_for_delivery_at',
      'FulfillmentTask.audit_trail',
      ...(projectCustomerOrder ? ['Order.status', 'Order.status_history'] : []),
      ...(notifyCustomer ? ['Notification.order_status'] : []),
    ],
    proposed_patch: blockers.length ? null : {
      status: 'out_for_delivery',
      delivery_status: 'out_for_delivery',
      out_for_delivery_at: now,
      audit_trail_append: auditTrailAppend({ action: 'out_for_delivery', actorEmail, requestId, now, reason }),
    },
    blockers,
    warnings,
  };
}

function planDeliveredOperational({ task, actorEmail, requestId, now, body, reason }) {
  const blockers = [];
  const warnings = [];
  const projectCustomerOrder = boolFlag(body.update_customer_order_status);
  const notifyCustomer = boolFlag(body.notify_customer);
  appendCommonGuards(task, blockers);
  if (!DELIVERABLE_STATUSES.has(normalizedStatus(task))) blockers.push('status_not_deliverable');
  if (!isDeliveryFulfillment(task)) blockers.push('not_delivery_fulfillment');
  if (!hasAssignedDriver(task)) blockers.push('missing_assigned_driver');

  const deliveryDropLocation = sanitizeText(body.delivery_drop_location, MAX_DROP_LOCATION_LENGTH);
  const deliveryNotes = sanitizeText(body.delivery_notes, MAX_DELIVERY_NOTES_LENGTH);
  const deliveryPhotoUrl = sanitizeUrl(body.delivery_photo_url);
  if (!deliveryDropLocation) warnings.push('delivery_drop_location_not_provided');
  if (!deliveryPhotoUrl) warnings.push('proof_photo_not_provided');

  const proofWrites = [];
  const proofPatch = {};
  if (deliveryDropLocation) {
    proofWrites.push('FulfillmentTask.delivery_drop_location');
    proofPatch.delivery_drop_location = deliveryDropLocation;
  }
  if (deliveryNotes) {
    proofWrites.push('FulfillmentTask.delivery_notes');
    proofPatch.delivery_notes = deliveryNotes;
  }
  if (deliveryPhotoUrl) {
    proofWrites.push('FulfillmentTask.delivery_photo_url');
    proofPatch.delivery_photo_url = deliveryPhotoUrl;
  }
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
    proposed_patch: blockers.length ? null : {
      status: 'delivered',
      delivery_status: 'delivered',
      delivered_at: now,
      delivered_by: sanitizeText(actorEmail, 120) || null,
      ...proofPatch,
      audit_trail_append: auditTrailAppend({ action: 'delivered_operational', actorEmail, requestId, now, reason }),
    },
    blockers,
    warnings,
  };
}

function planLifecycle({ action, task, actorEmail, requestId, now, body, reason }) {
  if (action === 'assign') return planAssign({ task, actorEmail, requestId, now, body, reason });
  if (action === 'unassign') return planUnassign({ task, actorEmail, requestId, now, reason });
  if (action === 'pack') return planPack({ task, actorEmail, requestId, now, reason });
  if (action === 'out_for_delivery') return planOutForDelivery({ task, actorEmail, requestId, now, body, reason });
  return planDeliveredOperational({ task, actorEmail, requestId, now, body, reason });
}

function buildWritePatch(task, proposedPatch, commandLogId) {
  const patch = { ...safeObject(proposedPatch) };
  const auditEntry = patch.audit_trail_append;
  delete patch.audit_trail_append;
  if (auditEntry) {
    const existingTrail = Array.isArray(task.audit_trail) ? task.audit_trail.slice(-100) : [];
    patch.audit_trail = [...existingTrail, auditEntry];
  }
  if (commandLogId) patch.command_log_id = commandLogId;
  return patch;
}

async function findTask(base44, taskKey) {
  const byId = await base44.asServiceRole.entities.FulfillmentTask.get(taskKey).catch(() => null);
  if (byId?.id) return byId;

  const byExternalId = await base44.asServiceRole.entities.FulfillmentTask.filter({ fulfillment_task_id: taskKey }, '-created_date', 2).catch(() => []);
  if (Array.isArray(byExternalId) && byExternalId.length === 1) return byExternalId[0];
  if (Array.isArray(byExternalId) && byExternalId.length > 1) throw new Error('multiple_fulfillment_task_matches');
  return null;
}

function normalizedOrderNumber(value) {
  return sanitizeText(value, 80).replace(/^#/, '').toUpperCase();
}

function sameOrderNumber(left, right) {
  const a = normalizedOrderNumber(left);
  const b = normalizedOrderNumber(right);
  return Boolean(a && b && a === b);
}

function terminalCustomerStatus(value) {
  return ['delivered', 'picked_up', 'cancelled', 'canceled', 'refunded', 'failed'].includes(normalizeLower(value));
}

function terminalFulfillmentTask(task) {
  const statuses = [task?.status, task?.delivery_status]
    .map((value) => normalizeLower(value).replace(/\s+/g, '_'));
  return statuses.some((status) => ['delivered', 'completed', 'fulfilled', 'cancelled', 'canceled', 'unable_to_deliver'].includes(status)) ||
    Boolean(sanitizeText(task?.delivered_at, 80));
}

async function pendingSiblingFulfillmentTasks(base44, task, order) {
  const orderNumber = normalizedOrderNumber(task?.order_number || task?.shopify_order_number || order?.order_number);
  let rows = [];
  if (orderNumber) {
    rows = await base44.asServiceRole.entities.FulfillmentTask.filter({ order_number: orderNumber }, '-created_date', 50).catch(() => []);
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    const orderId = sanitizeId(task?.order_id || task?.base44_order_id || order?.id);
    rows = orderId
      ? await base44.asServiceRole.entities.FulfillmentTask.filter({ order_id: orderId }, '-created_date', 50).catch(() => [])
      : [];
  }
  return (Array.isArray(rows) ? rows : []).filter((candidate) => (
    candidate?.id !== task?.id && !terminalFulfillmentTask(candidate)
  ));
}

async function findCustomerOrderForTask(base44, task) {
  const candidates = [
    sanitizeId(task?.base44_order_id),
    sanitizeId(task?.customer_app_order_id),
    sanitizeId(task?.order_id),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const byId = await base44.asServiceRole.entities.Order.get(candidate).catch(() => null);
    if (byId?.id) return byId;
  }

  const orderNumber = normalizedOrderNumber(task?.order_number || task?.shopify_order_number);
  if (!orderNumber) return null;
  const rows = await base44.asServiceRole.entities.Order.filter({ order_number: orderNumber }, '-created_date', 2).catch(() => []);
  if (Array.isArray(rows) && rows.length === 1) return rows[0];
  return null;
}

function buildStatusHistory(order, { status, now, message, requestId }) {
  const current = Array.isArray(order?.status_history) ? order.status_history.slice(-100) : [];
  const last = current[current.length - 1];
  if (
    normalizeLower(last?.status) === status &&
    sanitizeId(last?.request_id) === sanitizeId(requestId)
  ) {
    return current;
  }
  return [
    ...current,
    {
      status,
      timestamp: now,
      message,
      request_id: sanitizeId(requestId) || null,
    },
  ];
}

function buildCustomerOrderPatch({ order, task, writtenTask, action, now, requestId }) {
  const nextStatus = action === 'out_for_delivery' ? 'out_for_delivery' : 'delivered';
  const currentStatus = normalizeLower(order?.status);
  const patch = {};
  const terminal = terminalCustomerStatus(currentStatus);

  if (terminal && currentStatus !== nextStatus) {
    return {
      patch: null,
      skipped: true,
      reason: 'customer_order_terminal_status_not_overwritten',
    };
  }

  if (currentStatus !== nextStatus) {
    patch.status = nextStatus;
    patch.status_history = buildStatusHistory(order, {
      status: nextStatus,
      now,
      requestId,
      message: nextStatus === 'delivered'
        ? 'Order delivered from Customer App admin delivery workflow.'
        : 'Order marked out for delivery from Customer App admin delivery workflow.',
    });
  }

  if (nextStatus === 'delivered') {
    const deliveredAt = sanitizeText(writtenTask?.delivered_at, 80) || now;
    if (!order?.delivered_at || sanitizeText(order.delivered_at, 80) !== deliveredAt) {
      patch.delivered_at = deliveredAt;
    }
    if (writtenTask?.delivery_photo_url && writtenTask.delivery_photo_url !== order?.delivery_photo_url) {
      patch.delivery_photo_url = writtenTask.delivery_photo_url;
    }
    if (writtenTask?.delivery_drop_location && writtenTask.delivery_drop_location !== order?.delivery_drop_location) {
      patch.delivery_drop_location = writtenTask.delivery_drop_location;
    }
    if (writtenTask?.delivery_notes && writtenTask.delivery_notes !== order?.delivery_notes) {
      patch.delivery_notes = writtenTask.delivery_notes;
    }
  }

  return {
    patch,
    skipped: Object.keys(patch).length === 0,
    reason: Object.keys(patch).length === 0 ? 'customer_order_already_projected' : null,
  };
}

async function projectCustomerOrderStatus({ base44, task, writtenTask, action, now, requestId }) {
  if (!['out_for_delivery', 'delivered_operational'].includes(action)) {
    return { attempted: false, updated: false, skipped: true, reason: 'action_not_customer_projectable' };
  }

  const order = await findCustomerOrderForTask(base44, task);
  if (!order?.id) {
    return { attempted: true, updated: false, skipped: true, reason: 'customer_order_not_found' };
  }
  if (
    normalizedOrderNumber(task?.order_number || task?.shopify_order_number) &&
    normalizedOrderNumber(order?.order_number) &&
    !sameOrderNumber(task?.order_number || task?.shopify_order_number, order?.order_number)
  ) {
    return { attempted: true, updated: false, skipped: true, reason: 'customer_order_number_mismatch' };
  }

  if (action === 'delivered_operational') {
    const pendingSiblings = await pendingSiblingFulfillmentTasks(base44, task, order);
    if (pendingSiblings.length > 0) {
      return {
        attempted: true,
        updated: false,
        skipped: true,
        reason: 'pending_sibling_fulfillment_tasks',
        partial_fulfillment_completed: true,
        pending_sibling_count: pendingSiblings.length,
        order_id: sanitizeId(order.id) || null,
        order_number: sanitizeText(order.order_number, 80) || null,
        status: sanitizeText(order.status, 80) || null,
      };
    }
  }

  const { patch, skipped, reason } = buildCustomerOrderPatch({ order, task, writtenTask, action, now, requestId });
  if (skipped || !patch) {
    return {
      attempted: true,
      updated: false,
      skipped: true,
      reason,
      order_id: sanitizeId(order.id) || null,
      order_number: sanitizeText(order.order_number, 80) || null,
      status: sanitizeText(order.status, 80) || null,
    };
  }

  const updatedOrder = await base44.asServiceRole.entities.Order.update(order.id, patch);
  return {
    attempted: true,
    updated: true,
    skipped: false,
    order_id: sanitizeId(order.id) || null,
    order_number: sanitizeText(order.order_number, 80) || null,
    status: sanitizeText(updatedOrder?.status || patch.status || order.status, 80) || null,
    projected_fields: Object.keys(patch),
  };
}

async function sendCustomerStatusNotification({ base44, customerProjection, action }) {
  if (!customerProjection?.order_id || !['out_for_delivery', 'delivered_operational'].includes(action)) {
    return { attempted: false, sent: false, skipped: true, reason: 'customer_order_projection_missing' };
  }
  if (customerProjection.skipped === true && customerProjection.reason !== 'customer_order_already_projected') {
    return { attempted: false, sent: false, skipped: true, reason: customerProjection.reason || 'customer_order_projection_skipped' };
  }

  const status = action === 'out_for_delivery' ? 'out_for_delivery' : 'delivered';
  const result = await base44.asServiceRole.functions.invoke('sendOrderStatusNotification', {
    order_id: customerProjection.order_id,
    new_status: status,
  });
  const data = result?.data || result;
  return {
    attempted: true,
    sent: data?.success === true && data?.skipped !== true,
    skipped: data?.skipped === true,
    status,
    order_number: sanitizeText(data?.order_number || customerProjection.order_number, 80) || null,
    reason: sanitizeText(data?.reason, 160) || null,
  };
}

async function findExistingCommandLog(base44, idempotencyKey) {
  return base44.asServiceRole.entities.CommandLog.filter({ idempotency_key: idempotencyKey }, '-created_date', 1).catch(() => []);
}

function taskAllowlistKeys(task, requestedKey) {
  return [
    requestedKey,
    task?.id,
    task?.fulfillment_task_id,
    task?.order_number,
    task?.shopify_order_number,
  ].map(normalizeLower).filter(Boolean);
}

function testTaskRequested(task, requestedKey) {
  const allowedTasks = parseCsvSet(Deno.env.get(TEST_TASK_ALLOWLIST_FLAG) || '');
  if (allowedTasks.size === 0) return false;
  return taskAllowlistKeys(task, requestedKey).some((key) => allowedTasks.has(key));
}

function envGateFailure({ action, task, requestedKey, actorEmail }) {
  if (Deno.env.get(KILL_SWITCH_FLAG) === 'true') return 'kill_switch_active';
  const isTestRequest = testTaskRequested(task, requestedKey);
  const enableFlag = isTestRequest ? ENABLE_TEST_WRITES_FLAG : ENABLE_WRITES_FLAG;
  const allowedEmailsFlag = isTestRequest ? TEST_ALLOWED_EMAILS_FLAG : ALLOWED_EMAILS_FLAG;
  const allowedActionsFlag = isTestRequest ? TEST_ALLOWED_ACTIONS_FLAG : ALLOWED_ACTIONS_FLAG;
  const taskAllowlistFlag = isTestRequest ? TEST_TASK_ALLOWLIST_FLAG : TASK_ALLOWLIST_FLAG;
  if (Deno.env.get(enableFlag) !== 'true') {
    return isTestRequest
      ? 'native_fulfillment_task_test_lifecycle_writes_disabled'
      : 'native_fulfillment_task_lifecycle_writes_disabled';
  }
  if (isTestRequest && task?.is_test_task !== true) return 'test_task_allowlist_requires_test_marker';

  const allowedEmails = parseCsvSet(Deno.env.get(allowedEmailsFlag) || '');
  if (allowedEmails.size === 0) return 'allowed_email_gate_required';
  if (!allowedEmails.has(normalizeLower(actorEmail))) return 'actor_email_not_allowlisted';

  const allowedActions = parseCsvSet(Deno.env.get(allowedActionsFlag) || '');
  if (allowedActions.size === 0) return 'allowed_action_gate_required';
  if (!allowedActions.has(action)) return 'action_not_allowlisted';

  const allowedTasks = parseCsvSet(Deno.env.get(taskAllowlistFlag) || '');
  if (allowedTasks.size === 0) return 'task_allowlist_required';
  const keys = taskAllowlistKeys(task, requestedKey);
  if (!keys.some((key) => allowedTasks.has(key))) return 'task_not_allowlisted';

  return null;
}

async function createCommandLog({ base44, task, action, status, idempotencyKey, requestId, user, result, errorCode, errorMessage }) {
  const now = new Date().toISOString();
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: COMMAND_TYPE,
    command_source: SOURCE,
    status,
    target_entity: 'FulfillmentTask',
    target_id: task?.id || null,
    target_display_id: sanitizeText(task?.order_number || task?.shopify_order_number || task?.fulfillment_task_id || task?.id, 120) || null,
    actor_email: sanitizeText(user?.email, 180) || null,
    actor_role: sanitizeText(user?.role, 80) || null,
    actor_type: 'admin',
    payload: {
      action,
      exact_task_allowlist: true,
      is_test_task: task?.is_test_task === true,
      test_task_id: task?.is_test_task === true
        ? sanitizeId(task?.fulfillment_task_id) || sanitizeId(task?.id) || null
        : null,
    },
    result,
    error_code: errorCode || null,
    error_message: errorMessage ? sanitizeText(errorMessage, 180) : null,
    idempotency_key: idempotencyKey,
    idempotent_skipped: status === 'skipped',
    request_id: requestId,
    submitted_at: now,
    completed_at: status === 'running' ? null : now,
    function_name: 'executeNativeFulfillmentTaskLifecycle',
    notes: 'Native FulfillmentTask lifecycle command. Customer App Order projection and order-status notification run only when explicit request flags are present. No ShopifyOrder, ProductionBatch, inventory, PO, provider, route save, sync, or repair writes.',
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

function safeTaskSummary(task) {
  return {
    fulfillment_task_id: sanitizeId(task?.id) || null,
    external_fulfillment_task_id: sanitizeId(task?.fulfillment_task_id) || null,
    order_number: sanitizeText(task?.order_number || task?.shopify_order_number, 80) || null,
    previous_status: sanitizeText(task?.status, 80) || null,
    delivery_status: sanitizeText(task?.delivery_status, 80) || null,
    assigned_driver: sanitizeText(task?.assigned_driver, 120) || null,
    is_test_task: task?.is_test_task === true,
    test_purpose: task?.is_test_task === true ? sanitizeText(task?.test_purpose, 160) || null : null,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', error: 'Method not allowed' }, { status: 405 });
    }

    if (Deno.env.get(ENABLE_WRITES_FLAG) !== 'true' && Deno.env.get(ENABLE_TEST_WRITES_FLAG) !== 'true') {
      return Response.json({
        success: false,
        skipped: true,
        error_code: 'native_fulfillment_task_lifecycle_writes_disabled',
        native_writer_enabled: false,
        writes_performed: false,
      }, { status: 409 });
    }

    const base44 = createClientFromRequest(req);
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ success: false, error_code: 'unauthorized', error: 'Unauthorized' }, { status: 401 });
    }

    if (!user) return Response.json({ success: false, error_code: 'unauthorized', error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ success: false, error_code: 'forbidden', error: 'Forbidden' }, { status: 403 });

    const body = await readJsonBody(req);
    if (body === null) {
      return Response.json({ success: false, error_code: 'malformed_json', error: 'Malformed JSON' }, { status: 400 });
    }

    const unsupportedKey = findUnsupportedBodyKey(body);
    if (unsupportedKey) {
      return Response.json({ success: false, error_code: 'unsupported_field', error: `Unsupported field: ${unsupportedKey}` }, { status: 400 });
    }

    let taskKey;
    let action;
    let requestId;
    let actorEmail;
    let reason;
    try {
      if (normalizeLower(body.mode) !== 'live') throw new Error('mode live is required');
      if (normalizeText(body.confirmation) !== CONFIRMATION_PHRASE) throw new Error('confirmation phrase is required');
      taskKey = sanitizeId(body.fulfillment_task_id) || sanitizeId(body.task_id);
      if (!taskKey) throw new Error('fulfillment_task_id or task_id is required');
      action = normalizeAction(body.action);
      requestId = sanitizeId(body.request_id);
      if (!requestId) throw new Error('request_id is required');
      actorEmail = normalizeActorEmail(user.email);
      reason = sanitizeText(body.reason, MAX_REASON_LENGTH);
    } catch (error) {
      return Response.json({ success: false, error_code: 'invalid_input', error: error.message }, { status: 400 });
    }

    const task = await findTask(base44, taskKey);
    if (!task) {
      return Response.json({
        success: false,
        skipped: true,
        error_code: 'fulfillment_task_not_found',
        native_writer_enabled: true,
        writes_performed: false,
      }, { status: 404 });
    }

    const gateFailure = envGateFailure({ action, task, requestedKey: taskKey, actorEmail });
    if (gateFailure) {
      return Response.json({
        success: false,
        skipped: true,
        error_code: gateFailure,
        native_writer_enabled: true,
        writes_performed: false,
      }, { status: 409 });
    }
    if (
      task.is_test_task === true &&
      (boolFlag(body.update_customer_order_status) || boolFlag(body.notify_customer))
    ) {
      return Response.json({
        success: false,
        skipped: true,
        error_code: 'test_task_customer_side_effects_forbidden',
        native_writer_enabled: true,
        writes_performed: false,
        customer_order_updated: false,
        customer_notification_sent: false,
        external_service_calls: false,
      }, { status: 409 });
    }

    const idempotencyKey = `${COMMAND_TYPE}:${requestId}`;
    const existingLogs = await findExistingCommandLog(base44, idempotencyKey);
    const existingLog = Array.isArray(existingLogs) && existingLogs.length > 0 ? existingLogs[0] : null;
    if (existingLog && ['success', 'skipped'].includes(normalizeLower(existingLog.status))) {
      return Response.json({
        success: true,
        skipped: true,
        idempotent: true,
        action,
        request_id: requestId,
        idempotency_key: idempotencyKey,
        native_writer_enabled: true,
        writes_performed: false,
        reason: 'idempotency_log_present',
      });
    }
    if (existingLog && normalizeLower(existingLog.status) === 'rejected') {
      return Response.json({
        success: false,
        skipped: true,
        idempotent: true,
        action,
        request_id: requestId,
        idempotency_key: idempotencyKey,
        error_code: existingLog.error_code || 'lifecycle_preflight_blocked',
        blockers: safeStringArray(existingLog.result?.blockers),
        warnings: safeStringArray(existingLog.result?.warnings),
        native_writer_enabled: true,
        writes_performed: false,
        reason: 'idempotent_rejected_command_replay',
      }, { status: 409 });
    }
    if (existingLog && ['pending', 'running'].includes(normalizeLower(existingLog.status))) {
      return Response.json({
        success: false,
        skipped: true,
        idempotent: true,
        action,
        request_id: requestId,
        idempotency_key: idempotencyKey,
        error_code: 'command_already_in_progress',
        native_writer_enabled: true,
        writes_performed: false,
      }, { status: 409 });
    }

    const now = new Date().toISOString();
    let plan;
    try {
      plan = planLifecycle({ action, task, actorEmail, requestId, now, body, reason });
    } catch (error) {
      return Response.json({
        success: false,
        skipped: true,
        error_code: 'invalid_input',
        error: error.message,
        native_writer_enabled: true,
        writes_performed: false,
      }, { status: 400 });
    }
    const blockers = safeStringArray(plan.blockers);
    const warnings = safeStringArray(plan.warnings);
    if (blockers.length > 0 || !plan.proposed_patch) {
      await createCommandLog({
        base44,
        task,
        action,
        status: 'rejected',
        idempotencyKey,
        requestId,
        user,
        result: {
          blockers,
          warnings,
          writes_performed: false,
          native_writer_enabled: true,
        },
        errorCode: 'lifecycle_preflight_blocked',
        errorMessage: blockers.join(', '),
      });
      return Response.json({
        success: false,
        skipped: true,
        action,
        ...safeTaskSummary(task),
        request_id: requestId,
        idempotency_key: idempotencyKey,
        error_code: 'lifecycle_preflight_blocked',
        blockers,
        warnings,
        native_writer_enabled: true,
        writes_performed: false,
      }, { status: 409 });
    }

    const commandLog = await createCommandLog({
      base44,
      task,
      action,
      status: 'running',
      idempotencyKey,
      requestId,
      user,
      result: {
        action,
        projected_writes: safeStringArray(plan.projected_writes),
        warnings,
        writes_performed: false,
        native_writer_enabled: true,
      },
    });

    let writtenTask;
    let customerProjection = { attempted: false, updated: false, skipped: true, reason: 'not_requested' };
    let customerNotification = { attempted: false, sent: false, skipped: true, reason: 'not_requested' };
    const projectCustomerOrder = boolFlag(body.update_customer_order_status);
    const notifyCustomer = boolFlag(body.notify_customer);
    try {
      const writePatch = buildWritePatch(task, plan.proposed_patch, commandLog?.id);
      writtenTask = await base44.asServiceRole.entities.FulfillmentTask.update(task.id, writePatch);
    } catch (error) {
      await updateCommandLog({
        base44,
        commandLogId: commandLog?.id,
        status: 'failed',
        result: {
          action,
          projected_writes: safeStringArray(plan.projected_writes),
          warnings,
          customer_order_projection: customerProjection,
          customer_notification: customerNotification,
          writes_performed: false,
          native_writer_enabled: true,
        },
        errorCode: 'fulfillment_task_update_failed',
        errorMessage: error?.message || 'FulfillmentTask update failed',
      }).catch(() => null);
      throw error;
    }

    if (projectCustomerOrder) {
      try {
        customerProjection = await projectCustomerOrderStatus({
          base44,
          task,
          writtenTask,
          action,
          now,
          requestId,
        });
      } catch (error) {
        warnings.push('customer_order_projection_failed');
        customerProjection = {
          attempted: true,
          updated: false,
          skipped: true,
          reason: 'customer_order_projection_failed',
          error: sanitizeText(error?.message || 'Customer order projection failed', 180),
        };
      }
    }

    if (notifyCustomer) {
      try {
        customerNotification = await sendCustomerStatusNotification({
          base44,
          customerProjection,
          action,
        });
      } catch (error) {
        warnings.push('customer_notification_failed');
        customerNotification = {
          attempted: true,
          sent: false,
          skipped: true,
          reason: 'customer_notification_failed',
          error: sanitizeText(error?.message || 'Customer notification failed', 180),
        };
      }
    }

    await updateCommandLog({
      base44,
      commandLogId: commandLog?.id,
      status: 'success',
      result: {
        action,
        projected_writes: safeStringArray(plan.projected_writes),
        warnings,
        writes_performed: true,
        native_writer_enabled: true,
        customer_order_updated: customerProjection.updated === true,
        shopify_order_updated: false,
        production_batch_updated: false,
        customer_notification_sent: customerNotification.sent === true,
        proof_drop_processed: Boolean(writtenTask?.delivery_photo_url || writtenTask?.delivery_drop_location || writtenTask?.delivery_notes),
        customer_order_projection: customerProjection,
        customer_notification: customerNotification,
        route_saved: false,
        external_service_calls: false,
      },
    });

    return Response.json({
      success: true,
      skipped: false,
      action,
      ...safeTaskSummary(task),
      status: sanitizeText(writtenTask?.status, 80) || null,
      delivery_status: sanitizeText(writtenTask?.delivery_status, 80) || null,
      request_id: requestId,
      idempotency_key: idempotencyKey,
      command_log_id: commandLog?.id || null,
      projected_writes: safeStringArray(plan.projected_writes),
      warnings,
      native_writer_enabled: true,
      writes_performed: true,
      customer_order_updated: customerProjection.updated === true,
      shopify_order_updated: false,
      production_batch_updated: false,
      customer_notification_sent: customerNotification.sent === true,
      proof_drop_processed: Boolean(writtenTask?.delivery_photo_url || writtenTask?.delivery_drop_location || writtenTask?.delivery_notes),
      customer_order_projection: customerProjection,
      customer_notification: customerNotification,
      route_saved: false,
      external_service_calls: false,
    });
  } catch {
    console.error('[executeNativeFulfillmentTaskLifecycle] Error');
    return Response.json({
      success: false,
      error_code: 'internal_error',
      error: 'Unable to execute native fulfillment task lifecycle command',
      writes_performed: false,
    }, { status: 500 });
  }
});
