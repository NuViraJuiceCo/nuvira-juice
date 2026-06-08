import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const FUNCTION_NAME = 'previewNativeCustomerStatusNotificationImpact';
const DEFAULT_MAX_ROWS = 60;
const TARGET_PRODUCTION_DATE = '2026-06-05';
const TARGET_DELIVERY_DATE = '2026-06-06';

const ALLOWED_BODY_KEYS = new Set([
  'mode',
  'order_number',
  'shopify_order_number',
  'customer_app_order_id',
  'base44_order_id',
  'order_id',
  'native_shopify_order_id',
  'native_order_id',
  'shopify_order_id',
  'native_fulfillment_task_id',
  'fulfillment_task_id',
  'task_id',
  'request_id',
  '_internal_secret',
  'internal_secret',
]);

const CUSTOMER_ORDER_TERMINAL_STATUSES = new Set(['delivered', 'picked_up', 'cancelled', 'canceled', 'refunded']);
const NATIVE_ORDER_CANCELLED_REFUNDED = new Set(['canceled', 'cancelled', 'refunded', 'voided']);
const DELIVERY_IMPLYING_CUSTOMER_STATUSES = new Set(['out_for_delivery', 'arriving_soon', 'delivered', 'ready_for_pickup', 'picked_up']);
const STATUS_NOTIFICATION_SUBTYPES = {
  scheduled_for_juicing: 'production_reminder',
  in_production: 'production_reminder',
  out_for_delivery: 'out_for_delivery',
  arriving_soon: 'delivery_reminder',
  delivered: 'delivered',
  ready_for_pickup: 'delivery_reminder',
};
const DELIVERY_NOTIFICATION_SUBTYPES = new Set(['out_for_delivery', 'delivered']);

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
    .replace(/\b(?:ch|re|pi|cs|cus|sub|evt|in|pm|seti|si|src|tok|po|li)_[A-Za-z0-9]{8,}\b/g, '[redacted provider id]')
    .replace(/\bgid:\/\/shopify\/[A-Za-z]+\/[A-Za-z0-9_-]+\b/g, '[redacted shopify id]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function sanitizeId(value, maxLength = 180) {
  const text = sanitizeText(value, maxLength);
  return text && /^[A-Za-z0-9._:@/#-]+$/.test(text) ? text : '';
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getPreviewSecret() {
  return normalizeText(Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET')) ||
    normalizeText(Deno.env.get('CUSTOMER_APP_SYNC_SECRET')) ||
    normalizeText(Deno.env.get('HUB_SYNC_SECRET'));
}

function envEnabled(name) {
  return Deno.env.get(name) === 'true';
}

function unauthorized() {
  return Response.json({ success: false, error_code: 'unauthorized', writes_performed: false }, { status: 401 });
}

function forbidden() {
  return Response.json({ success: false, error_code: 'forbidden', writes_performed: false }, { status: 403 });
}

async function requirePreviewAccess({ base44, req, body }) {
  const headerSecret = normalizeText(req.headers.get('x-internal-secret'));
  const bodySecret = normalizeText(body?._internal_secret || body?.internal_secret);
  const providedSecret = headerSecret || bodySecret;
  const expectedSecret = getPreviewSecret();

  if (providedSecret) {
    return expectedSecret && providedSecret === expectedSecret
      ? { ok: true, actor_type: 'system', actor_role: 'service', actor_email: 'system' }
      : { ok: false, response: unauthorized() };
  }

  try {
    const user = await base44.auth.me().catch(() => null);
    if (!user) return { ok: false, response: unauthorized() };
    if (user.role !== 'admin') return { ok: false, response: forbidden() };
    return { ok: true, actor_type: 'admin', actor_role: 'admin', actor_email: sanitizeText(user.email, 120) || 'admin' };
  } catch {
    return { ok: false, response: unauthorized() };
  }
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

function unsupportedBodyKey(body) {
  for (const key of Object.keys(body || {})) {
    if (!ALLOWED_BODY_KEYS.has(normalizeLower(key))) return key;
  }
  return null;
}

function getLookup(body) {
  return {
    orderNumber: normalizeText(body?.order_number || body?.shopify_order_number).replace(/^#/, ''),
    customerAppOrderId: sanitizeId(body?.customer_app_order_id || body?.base44_order_id || body?.order_id, 120),
    nativeShopifyOrderId: sanitizeId(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id, 120),
    nativeFulfillmentTaskId: sanitizeId(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id, 120),
    requestId: sanitizeId(body?.request_id, 180),
  };
}

function hasExactLookup(lookup) {
  return Boolean(lookup.orderNumber || lookup.customerAppOrderId || lookup.nativeShopifyOrderId || lookup.nativeFulfillmentTaskId);
}

async function filterEntity(base44, entityName, filter, sort = '-created_date', limit = 20) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity?.filter) return [];
  const rows = await entity.filter(filter, sort, limit).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function listEntity(base44, entityName, sort = '-created_date', limit = 500) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity?.list) return [];
  const rows = await entity.list(sort, limit).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function findCustomerOrder(base44, lookup) {
  const filters = [];
  if (lookup.customerAppOrderId) filters.push({ id: lookup.customerAppOrderId });
  if (lookup.orderNumber) filters.push({ order_number: lookup.orderNumber }, { shopify_order_number: lookup.orderNumber });
  for (const filter of filters) {
    const rows = await filterEntity(base44, 'Order', filter, '-created_date', 5);
    if (rows.length > 0) return rows[0];
  }
  return null;
}

async function findNativeShopifyOrder(base44, customerOrder, lookup) {
  const orderNumber = lookup.orderNumber || normalizeText(customerOrder?.order_number || customerOrder?.shopify_order_number).replace(/^#/, '');
  const filters = [];
  if (lookup.nativeShopifyOrderId) filters.push({ id: lookup.nativeShopifyOrderId }, { shopify_order_id: lookup.nativeShopifyOrderId });
  if (customerOrder?.id) filters.push({ base44_order_id: customerOrder.id });
  if (orderNumber) filters.push({ shopify_order_number: orderNumber }, { order_number: orderNumber });
  for (const filter of filters) {
    const rows = await filterEntity(base44, 'ShopifyOrder', filter, '-created_date', 5);
    if (rows.length > 0) return rows[0];
  }
  return null;
}

async function findNativeFulfillmentTask(base44, customerOrder, nativeOrder, lookup) {
  const orderNumber = lookup.orderNumber || normalizeText(nativeOrder?.shopify_order_number || customerOrder?.order_number).replace(/^#/, '');
  const filters = [];
  if (lookup.nativeFulfillmentTaskId) filters.push({ id: lookup.nativeFulfillmentTaskId }, { fulfillment_task_id: lookup.nativeFulfillmentTaskId });
  if (nativeOrder?.id) filters.push({ native_shopify_order_id: nativeOrder.id }, { shopify_order_id: nativeOrder.id }, { order_id: nativeOrder.id });
  if (customerOrder?.id) filters.push({ base44_order_id: customerOrder.id }, { order_id: customerOrder.id });
  if (orderNumber) filters.push({ order_number: orderNumber }, { shopify_order_number: orderNumber });
  for (const filter of filters) {
    const rows = await filterEntity(base44, 'FulfillmentTask', filter, '-created_date', 20);
    if (rows.length > 0) return rows[0];
  }
  return null;
}

function batchReferencesTarget(batch, { orderNumber, customerOrder, nativeOrder, task }) {
  const sourceText = [
    batch?.batch_id,
    batch?.source_order_number,
    batch?.order_number,
    batch?.source_order_id,
    batch?.base44_order_id,
    batch?.native_shopify_order_id,
    batch?.native_fulfillment_task_id,
    JSON.stringify(batch?.order_sources || []),
    JSON.stringify(batch?.related_orders || []),
  ].map(value => normalizeText(value)).join(' ');
  return [orderNumber, customerOrder?.id, nativeOrder?.id, task?.id]
    .filter(Boolean)
    .some(value => sourceText.includes(value));
}

async function findProductionBatches(base44, { orderNumber, customerOrder, nativeOrder, task }) {
  const all = await listEntity(base44, 'ProductionBatch', '-production_date', 800);
  return all
    .filter(batch => batchReferencesTarget(batch, { orderNumber, customerOrder, nativeOrder, task }))
    .slice(0, DEFAULT_MAX_ROWS);
}

async function complianceLogsForBatches(base44, batches) {
  const groups = await Promise.all((batches || []).map(async batch => {
    const byDisplayId = batch?.batch_id ? await filterEntity(base44, 'BatchComplianceLog', { batch_id: batch.batch_id }, '-created_date', 20) : [];
    const bySourceId = batch?.id ? await filterEntity(base44, 'BatchComplianceLog', { source_production_batch_id: batch.id }, '-created_date', 20) : [];
    return [...new Map([...byDisplayId, ...bySourceId].map(row => [row.id, row])).values()];
  }));
  return groups.flat();
}

async function loadNotificationContext(base44, customerOrder, orderNumber) {
  const notificationRows = customerOrder?.id
    ? await filterEntity(base44, 'Notification', { order_id: customerOrder.id }, '-created_date', 20)
    : [];
  const messageLogsByOrderId = customerOrder?.id
    ? await filterEntity(base44, 'CustomerMessageDeliveryLog', { order_id: customerOrder.id }, '-created_date', 20)
    : [];
  const messageLogsByOrderNumber = orderNumber
    ? await filterEntity(base44, 'CustomerMessageDeliveryLog', { order_number: orderNumber }, '-created_date', 20)
    : [];
  return {
    notificationRows: [...new Map(notificationRows.map(row => [row.id, row])).values()],
    messageLogRows: [...new Map([...messageLogsByOrderId, ...messageLogsByOrderNumber].map(row => [row.id, row])).values()],
  };
}

async function loadCommandLogs(base44, orderNumber) {
  const byOrder = orderNumber ? await filterEntity(base44, 'CommandLog', { related_order_number: orderNumber }, '-created_date', 40) : [];
  const byTarget = orderNumber ? await filterEntity(base44, 'CommandLog', { target_display_id: orderNumber }, '-created_date', 40) : [];
  return [...new Map([...byOrder, ...byTarget].map(row => [row.id, row])).values()].slice(0, 40);
}

function orderType(customerOrder, nativeOrder, task) {
  if (nativeOrder?.is_subscription === true || customerOrder?.is_subscription === true || customerOrder?.subscription_id) return 'subscription';
  return normalizeLower(nativeOrder?.order_type || customerOrder?.order_type || task?.order_type || 'one_time') || 'one_time';
}

function fulfillmentMode(customerOrder, nativeOrder, task) {
  return normalizeLower(nativeOrder?.fulfillment_mode || customerOrder?.fulfillment_mode || task?.fulfillment_mode || task?.fulfillment_type || nativeOrder?.fulfillment_method || customerOrder?.fulfillment_type || 'single_delivery') || 'single_delivery';
}

function mapNativeProductionStatusToCustomerStatus(nativeProductionStatus) {
  const map = {
    new: 'order_received',
    awaiting_production: 'scheduled_for_juicing',
    scheduled_for_production: 'scheduled_for_juicing',
    in_production: 'in_production',
    bottled: 'bottled_packed',
    labeled: 'bottled_packed',
    qc_checked: 'bottled_packed',
    packed: 'bottled_packed',
    in_cold_storage: 'bottled_packed',
    assigned_for_pickup: 'ready_for_pickup',
    assigned_for_delivery: 'out_for_delivery',
    fulfilled: 'delivered',
    order_received: 'order_received',
    scheduled_for_juicing: 'scheduled_for_juicing',
    bottled_packed: 'bottled_packed',
    out_for_delivery: 'out_for_delivery',
    arriving_soon: 'arriving_soon',
    ready_for_pickup: 'ready_for_pickup',
    picked_up: 'picked_up',
  };
  return map[normalizeLower(nativeProductionStatus)] || null;
}

function statusMessage(status) {
  const messages = {
    bottled_packed: 'Native production is verified, packed, and bottled. Customer-facing status update remains held until approved.',
    in_production: 'Native production is in progress. Customer-facing status update remains held until approved.',
    out_for_delivery: 'Delivery status would be customer-facing and remains held for delivery workflow approval.',
    delivered: 'Delivered status is out of scope for production status preview.',
  };
  return messages[status] || `Customer-facing status would be ${status || 'unchanged'} if later approved.`;
}

function statusHistoryAlreadyContains(order, proposedStatus) {
  return Array.isArray(order?.status_history) && order.status_history.some(entry => normalizeLower(entry?.status) === normalizeLower(proposedStatus));
}

function summarizeBatchRows(batches, complianceLogs) {
  return (batches || []).map(batch => {
    const logs = complianceLogs.filter(log => log?.batch_id === batch?.batch_id || log?.source_production_batch_id === batch?.id);
    return {
      production_batch_id: sanitizeId(batch?.id, 120) || null,
      batch_id: sanitizeText(batch?.batch_id, 180),
      product_name: sanitizeText(batch?.product_name, 120),
      status: sanitizeText(batch?.status, 80),
      production_date: sanitizeText(batch?.production_date, 40),
      verified_at_present: Boolean(batch?.verified_at),
      compliance_log_id_present: Boolean(batch?.compliance_log_id),
      compliance_log_count: logs.length,
      actual_units: numberOrNull(batch?.actual_units),
    };
  });
}

function buildStatusHistoryPreview({ customerOrder, proposedStatus }) {
  const currentStatus = sanitizeText(customerOrder?.status, 80) || null;
  const wouldAppend = Boolean(customerOrder && proposedStatus && currentStatus !== proposedStatus);
  return {
    would_append: wouldAppend,
    append_held: true,
    current_status: currentStatus,
    proposed_status: proposedStatus || currentStatus,
    existing_status_history_count: Array.isArray(customerOrder?.status_history) ? customerOrder.status_history.length : 0,
    already_has_proposed_status_entry: statusHistoryAlreadyContains(customerOrder, proposedStatus),
    preview_entry: wouldAppend ? {
      status: proposedStatus,
      timestamp: '[server timestamp if later approved]',
      message: statusMessage(proposedStatus),
      source: 'native_customer_status_notification_impact_preview',
      writes_performed: false,
    } : null,
  };
}

function allowedDeliveryStatuses() {
  const configured = Deno.env.get('CUSTOMER_DELIVERY_STATUS_NOTIFICATION_STATUSES');
  const rawValues = configured ? configured.split(',') : ['out_for_delivery', 'delivered'];
  return new Set(rawValues.map(value => value.trim().toLowerCase()).filter(Boolean));
}

function notificationWouldSendForStatus(status) {
  const subtype = STATUS_NOTIFICATION_SUBTYPES[status];
  if (!subtype) return false;
  if (envEnabled('ENABLE_ORDER_STATUS_NOTIFICATIONS')) return true;
  return envEnabled('ENABLE_CUSTOMER_DELIVERY_STATUS_NOTIFICATIONS') &&
    DELIVERY_NOTIFICATION_SUBTYPES.has(subtype) &&
    allowedDeliveryStatuses().has(status);
}

function buildNotificationPreview({ customerOrder, proposedStatus, notificationRows, messageLogRows }) {
  const subtype = STATUS_NOTIFICATION_SUBTYPES[proposedStatus] || null;
  const enabledForStatus = notificationWouldSendForStatus(proposedStatus);
  const pushEnabled = envEnabled('ENABLE_CUSTOMER_PUSH_NOTIFICATIONS');
  const deliveredEmailEnabled = envEnabled('ENABLE_DELIVERED_CUSTOMER_EMAIL');
  const proofEmailEnabled = envEnabled('ENABLE_DELIVERED_PROOF_DETAILS_IN_EMAIL');
  const nonConfirmationEnabled = envEnabled('ENABLE_NON_CONFIRMATION_CUSTOMER_NOTIFICATIONS');
  const statusConfigured = Boolean(subtype);
  const idempotencyKey = customerOrder?.id && proposedStatus ? `order_status_${customerOrder.id}_${proposedStatus}` : null;

  return {
    notification_would_send: false,
    notification_held: true,
    status_notification_configured: statusConfigured,
    proposed_notification_subtype: subtype,
    order_status_notifications_enabled: envEnabled('ENABLE_ORDER_STATUS_NOTIFICATIONS'),
    non_confirmation_notifications_enabled: nonConfirmationEnabled,
    delivery_status_notifications_enabled: envEnabled('ENABLE_CUSTOMER_DELIVERY_STATUS_NOTIFICATIONS'),
    customer_push_notifications_enabled: pushEnabled,
    automatic_notification_would_send_if_status_updated: enabledForStatus,
    status_only_path_available_without_notification: !enabledForStatus,
    notification_channels: {
      in_app: enabledForStatus,
      push: enabledForStatus && pushEnabled,
      sms: false,
      email: proposedStatus === 'delivered' && enabledForStatus && deliveredEmailEnabled,
      email_proof_details: proposedStatus === 'delivered' && enabledForStatus && deliveredEmailEnabled && proofEmailEnabled,
    },
    held_channels: ['in_app', 'push', 'sms', 'email'],
    existing_notification_count_for_order: Array.isArray(notificationRows) ? notificationRows.length : 0,
    existing_message_log_count_for_order: Array.isArray(messageLogRows) ? messageLogRows.length : 0,
    proposed_idempotency_key_preview: idempotencyKey ? sanitizeText(idempotencyKey, 220) : null,
    notes: statusConfigured
      ? 'Order status notification path exists, but this preview does not send notifications.'
      : 'No order status notification is configured for the proposed status; status-only command can remain notification-free if later approved.',
    blockers: enabledForStatus ? ['automatic_notification_would_send_if_status_updated'] : [],
    warnings: [
      'notifications_held',
      'no_push_sms_email_in_app_notification_sent',
      enabledForStatus ? 'notification_policy_approval_required' : 'status_only_path_notification_free',
    ],
  };
}

function buildCustomerStatusPreview({ customerOrder, nativeOrder, task, batches, complianceLogs, notificationRows, messageLogRows }) {
  const batchRows = summarizeBatchRows(batches, complianceLogs);
  const verifiedCount = batchRows.filter(row => normalizeLower(row.status) === 'verified_logged').length;
  const complianceReadyCount = batchRows.filter(row => row.compliance_log_count > 0).length;
  const productionVerified = batchRows.length > 0 && verifiedCount === batchRows.length;
  const complianceReady = batchRows.length > 0 && complianceReadyCount === batchRows.length;
  const taskPacked = ['packed', 'bottled_packed'].includes(normalizeLower(task?.status)) && ['packed', 'bottled_packed'].includes(normalizeLower(task?.production_status));
  const nativeOrderBottled = normalizeLower(nativeOrder?.production_status) === 'bottled';
  const proposedStatus = mapNativeProductionStatusToCustomerStatus(nativeOrder?.production_status);
  const currentStatus = sanitizeText(customerOrder?.status, 80) || null;
  const type = orderType(customerOrder, nativeOrder, task);
  const mode = fulfillmentMode(customerOrder, nativeOrder, task);

  const blockers = [];
  const warnings = [];
  if (!customerOrder) blockers.push('missing_customer_app_order');
  if (!nativeOrder) blockers.push('missing_native_shopify_order');
  if (!task) blockers.push('missing_native_fulfillment_task');
  if (!productionVerified) blockers.push('native_production_not_fully_verified');
  if (!complianceReady) blockers.push('missing_batch_compliance_logs');
  if (!taskPacked) blockers.push('native_fulfillment_task_not_packed');
  if (!nativeOrderBottled) blockers.push('native_shopify_order_not_bottled');
  if (!proposedStatus) blockers.push('missing_customer_status_mapping');
  if (customerOrder && !(customerOrder.payment_captured === true || normalizeLower(customerOrder.payment_status) === 'paid')) blockers.push('customer_app_order_not_paid_or_captured');
  if (['subscription', 'multi_delivery'].includes(type) || mode === 'multi_delivery' || nativeOrder?.is_subscription === true) blockers.push('subscription_multi_delivery_customer_status_blocked');
  if (customerOrder && CUSTOMER_ORDER_TERMINAL_STATUSES.has(normalizeLower(customerOrder.status))) blockers.push('customer_app_order_terminal_status');
  if (nativeOrder && (NATIVE_ORDER_CANCELLED_REFUNDED.has(normalizeLower(nativeOrder.production_status)) || NATIVE_ORDER_CANCELLED_REFUNDED.has(normalizeLower(nativeOrder.financial_status || nativeOrder.payment_status)))) blockers.push('native_order_cancelled_or_refunded');
  if (task && ['out_for_delivery', 'delivered', 'unable_to_deliver', 'cancelled', 'canceled'].includes(normalizeLower(task.delivery_status))) blockers.push('delivery_lifecycle_already_advanced');
  if (proposedStatus && DELIVERY_IMPLYING_CUSTOMER_STATUSES.has(proposedStatus) && proposedStatus !== 'bottled_packed') blockers.push('proposed_status_implies_delivery_lifecycle');

  const notificationPreview = buildNotificationPreview({ customerOrder, proposedStatus, notificationRows, messageLogRows });
  if (notificationPreview.automatic_notification_would_send_if_status_updated) warnings.push('automatic_notification_would_send_if_status_updated');
  if (currentStatus === proposedStatus) warnings.push('customer_status_already_satisfied');
  warnings.push('customer_status_update_held_pending_explicit_approval');
  warnings.push('notifications_held');

  const technicallyReady = blockers.length === 0 && currentStatus !== proposedStatus;
  const alreadySatisfied = blockers.length === 0 && currentStatus === proposedStatus;
  const statusOnlyReady = technicallyReady && notificationPreview.status_only_path_available_without_notification;
  const recommendation = (() => {
    if (blockers.includes('subscription_multi_delivery_customer_status_blocked') || blockers.includes('customer_app_order_terminal_status') || blockers.includes('native_order_cancelled_or_refunded')) return 'not_applicable';
    if (alreadySatisfied) return 'not_applicable';
    if (!proposedStatus) return 'hold_for_status_mapping_decision';
    if (notificationPreview.automatic_notification_would_send_if_status_updated) return 'hold_for_notification_policy';
    if (blockers.includes('proposed_status_implies_delivery_lifecycle')) return 'hold_for_delivery_phase';
    if (blockers.length > 0) return 'hold_for_delivery_phase';
    if (statusOnlyReady) return 'ready_for_status_only_command_no_notification';
    return 'hold_for_status_mapping_decision';
  })();

  return {
    production_verified: productionVerified,
    task_packed: taskPacked,
    native_order_bottled: nativeOrderBottled,
    current_customer_order_status: currentStatus,
    proposed_customer_order_status: proposedStatus || currentStatus,
    status_update_ready: statusOnlyReady,
    status_update_held: true,
    status_update_already_satisfied: alreadySatisfied,
    customer_status_already_satisfied: alreadySatisfied,
    status_only_path_available_without_notification: statusOnlyReady,
    status_command_available: statusOnlyReady,
    status_command_gated: true,
    status_requires_exact_approval: statusOnlyReady,
    notification_policy_required: 'NO_NOTIFICATION',
    customer_order_type: type,
    fulfillment_mode: mode,
    would_update_customer_app_order_if_later_approved: statusOnlyReady,
    would_append_status_history_if_later_approved: statusOnlyReady,
    customer_would_see_status: Boolean(proposedStatus),
    status_history_preview: buildStatusHistoryPreview({ customerOrder, proposedStatus }),
    notification_preview: notificationPreview,
    notification_would_send: false,
    notification_held: true,
    blockers: [...new Set(blockers)],
    warnings: [...new Set([...warnings, ...notificationPreview.warnings])],
    recommended_next_action: recommendation,
  };
}

function buildPreview({ customerOrder, nativeOrder, task, batches, complianceLogs, notificationRows, messageLogRows, commandLogs, lookup, auth }) {
  const orderNumber = sanitizeText(lookup.orderNumber || nativeOrder?.shopify_order_number || customerOrder?.order_number || task?.order_number, 120) || null;
  const batchRows = summarizeBatchRows(batches, complianceLogs);
  const statusPreview = buildCustomerStatusPreview({ customerOrder, nativeOrder, task, batches, complianceLogs, notificationRows, messageLogRows });
  const blockers = [...statusPreview.blockers];
  const warnings = [...statusPreview.warnings, 'hub_fallback_required'];

  let nextAction = statusPreview.recommended_next_action;
  if (nextAction === 'ready_for_status_only_command_no_notification') nextAction = 'plan_status_only_command_with_notifications_disabled';

  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    function_name: FUNCTION_NAME,
    order_number: orderNumber,
    request_id: sanitizeId(lookup.requestId, 180) || null,
    generated_at: new Date().toISOString(),
    customer_app_order_present: Boolean(customerOrder),
    native_shopify_order_present: Boolean(nativeOrder),
    native_fulfillment_task_present: Boolean(task),
    customer_app_order_id: sanitizeId(customerOrder?.id, 120) || null,
    native_shopify_order_id: sanitizeId(nativeOrder?.id, 120) || null,
    native_fulfillment_task_id: sanitizeId(task?.id, 120) || null,
    production_date: sanitizeText(task?.production_date || batchRows[0]?.production_date || TARGET_PRODUCTION_DATE, 40) || null,
    delivery_date: sanitizeText(task?.delivery_date || task?.assigned_delivery_date || nativeOrder?.requested_delivery_date || customerOrder?.delivery_date || TARGET_DELIVERY_DATE, 40) || null,
    production_verified: statusPreview.production_verified,
    task_packed: statusPreview.task_packed,
    native_order_bottled: statusPreview.native_order_bottled,
    current_customer_order_status: statusPreview.current_customer_order_status,
    proposed_customer_order_status: statusPreview.proposed_customer_order_status,
    status_update_ready: statusPreview.status_update_ready,
    status_update_held: statusPreview.status_update_held,
    status_update_already_satisfied: statusPreview.status_update_already_satisfied,
    status_only_path_available_without_notification: statusPreview.status_only_path_available_without_notification,
    customer_order_type: statusPreview.customer_order_type,
    fulfillment_mode: statusPreview.fulfillment_mode,
    status_history_preview: statusPreview.status_history_preview,
    proposed_status_history_entry: statusPreview.status_history_preview?.preview_entry || null,
    status_command_available: statusPreview.status_command_available,
    status_command_gated: statusPreview.status_command_gated,
    status_requires_exact_approval: statusPreview.status_requires_exact_approval,
    notification_policy_required: statusPreview.notification_policy_required,
    customer_status_already_satisfied: statusPreview.customer_status_already_satisfied,
    notification_preview: statusPreview.notification_preview,
    notification_would_send: false,
    notification_held: true,
    notification_channels_impacted_if_policy_enabled: statusPreview.notification_preview.notification_channels,
    existing_notification_count_for_order: statusPreview.notification_preview.existing_notification_count_for_order,
    existing_message_log_count_for_order: statusPreview.notification_preview.existing_message_log_count_for_order,
    production_batch_count: batchRows.length,
    verified_batch_count: batchRows.filter(row => normalizeLower(row.status) === 'verified_logged').length,
    compliance_log_count: complianceLogs.length,
    target_batch_rows: batchRows.slice(0, DEFAULT_MAX_ROWS),
    prior_command_context: {
      command_log_count: commandLogs.length,
      latest_command_types: [...new Set(commandLogs.map(log => sanitizeText(log?.command_type, 120)).filter(Boolean))].slice(0, 10),
    },
    customer_status_impact_preview: statusPreview,
    blockers: [...new Set(blockers)].slice(0, DEFAULT_MAX_ROWS),
    warnings: [...new Set(warnings)].slice(0, DEFAULT_MAX_ROWS),
    next_action: nextAction,
    hub_fallback_required: true,
    actor_context: {
      actor_type: auth?.actor_type || 'unknown',
      actor_role: auth?.actor_role || 'unknown',
    },
    safety: {
      dry_run_only: true,
      writes_performed: false,
      customer_app_order_updated: false,
      status_history_appended: false,
      notifications_created: false,
      notifications_sent: false,
      native_shopify_order_updated: false,
      native_fulfillment_task_updated: false,
      production_batch_updated: false,
      compliance_logs_created: false,
      inventory_deducted: false,
      purchase_orders_created: false,
      provider_calls_performed: false,
      stripe_calls_performed: false,
      shopify_api_calls_performed: false,
      sync_repair_replay_performed: false,
      delivery_route_proof_drop_mutated: false,
      hub_bridge_modified: false,
    },
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', message: 'POST required', writes_performed: false }, { status: 405 });
    }

    const parsed = await readJsonBody(req);
    if (!parsed.ok) return Response.json({ success: false, error_code: 'malformed_json', writes_performed: false }, { status: 400 });
    const body = parsed.body || {};
    if (body.mode && body.mode !== 'dry_run') {
      return Response.json({ success: false, error_code: 'dry_run_only', message: 'Only dry_run mode is supported', writes_performed: false }, { status: 400 });
    }
    const badKey = unsupportedBodyKey(body);
    if (badKey) return Response.json({ success: false, error_code: 'unsupported_request_field', field: sanitizeText(badKey, 80), writes_performed: false }, { status: 400 });

    const lookup = getLookup(body);
    if (!hasExactLookup(lookup)) {
      return Response.json({ success: false, error_code: 'exact_order_required', message: 'order_number or exact target id is required', writes_performed: false }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const auth = await requirePreviewAccess({ base44, req, body });
    if (!auth.ok) return auth.response;

    let customerOrder = await findCustomerOrder(base44, lookup);
    let nativeOrder = await findNativeShopifyOrder(base44, customerOrder, lookup);
    if (!customerOrder && nativeOrder?.base44_order_id) {
      customerOrder = await findCustomerOrder(base44, { ...lookup, customerAppOrderId: nativeOrder.base44_order_id, orderNumber: normalizeText(nativeOrder.shopify_order_number).replace(/^#/, '') });
    }
    if (!nativeOrder && customerOrder) nativeOrder = await findNativeShopifyOrder(base44, customerOrder, lookup);
    const task = await findNativeFulfillmentTask(base44, customerOrder, nativeOrder, lookup);
    const orderNumber = lookup.orderNumber || normalizeText(nativeOrder?.shopify_order_number || customerOrder?.order_number || task?.order_number).replace(/^#/, '');
    const batches = await findProductionBatches(base44, { orderNumber, customerOrder, nativeOrder, task });
    const complianceLogs = await complianceLogsForBatches(base44, batches);
    const { notificationRows, messageLogRows } = await loadNotificationContext(base44, customerOrder, orderNumber);
    const commandLogs = await loadCommandLogs(base44, orderNumber);

    return Response.json(buildPreview({ customerOrder, nativeOrder, task, batches, complianceLogs, notificationRows, messageLogRows, commandLogs, lookup: { ...lookup, orderNumber }, auth }));
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] failed safely: ${error?.message || 'unknown error'}`);
    return Response.json({ success: false, error_code: 'native_customer_status_notification_impact_preview_failed', message: 'Customer status / notification impact preview failed safely.', writes_performed: false }, { status: 500 });
  }
});
