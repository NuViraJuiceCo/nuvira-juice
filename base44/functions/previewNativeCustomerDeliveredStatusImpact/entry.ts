import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const FUNCTION_NAME = 'previewNativeCustomerDeliveredStatusImpact';
const TARGET_ORDER_NUMBER = 'NV-MPZNKGNT';
const TARGET_CUSTOMER_APP_ORDER_ID = '6a219a3f4adcda5856c3d579';
const TARGET_NATIVE_SHOPIFY_ORDER_ID = '6a22ffda400eb806eb3ca945';
const TARGET_NATIVE_FULFILLMENT_TASK_ID = '6a22ffdaf675ea79e30575aa';
const STATUS_MODE = 'DELIVERED_STATUS_ONLY_NO_NOTIFICATION';
const REQUIRED_NOTIFICATION_POLICY = 'NO_NOTIFICATION';
const REQUIRED_PROOF_DROP_POLICY = 'HELD_NOT_REQUIRED_FOR_RECONCILIATION';
const CUSTOMER_DELIVERED_STATUS = 'delivered';
const NATIVE_ORDER_FULFILLED_STATUS = 'fulfilled';
const NATIVE_TASK_DELIVERED_STATUS = 'delivered';
const NATIVE_TASK_DELIVERED_DELIVERY_STATUS = 'delivered';
const MAX_TEXT = 180;

const EXPECTED_BATCH_IDS = Object.freeze([
  'NATIVE-NV-MPZNKGNT-2026-06-05-AURA',
  'NATIVE-NV-MPZNKGNT-2026-06-05-OASIS',
  'NATIVE-NV-MPZNKGNT-2026-06-05-PINEAPPLE-JUICE',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RADIANCE-SHOT',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RE-NU',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RESET-SHOT',
]);

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
  'correction_mode',
  'status_mode',
  'notification_policy',
  'proof_drop_policy',
  'request_id',
  '_internal_secret',
  'internal_secret',
]);

const CUSTOMER_ORDER_CANCELLED_REFUNDED = new Set(['cancelled', 'canceled', 'refunded', 'voided']);
const NATIVE_ORDER_CANCELLED_REFUNDED = new Set(['cancelled', 'canceled', 'refunded', 'voided']);
const STATUS_NOTIFICATION_SUBTYPES = Object.freeze({
  scheduled_for_juicing: 'production_reminder',
  in_production: 'production_reminder',
  out_for_delivery: 'out_for_delivery',
  arriving_soon: 'delivery_reminder',
  delivered: 'delivered',
  ready_for_pickup: 'delivery_reminder',
});

const READ_ONLY_SAFETY = Object.freeze({
  dry_run_only: true,
  writes_performed: false,
  customer_app_order_updated: false,
  customer_facing_status_updated: false,
  status_history_appended: false,
  native_shopify_order_updated: false,
  native_fulfillment_task_updated: false,
  production_batch_updated: false,
  batch_compliance_log_updated: false,
  notifications_created: false,
  notifications_sent: false,
  message_logs_created: false,
  proof_drop_route_fields_written: false,
  provider_calls_performed: false,
  stripe_calls_performed: false,
  shopify_api_calls_performed: false,
  sync_repair_replay_performed: false,
  inventory_deducted: false,
  purchase_order_created: false,
  hub_records_updated: false,
  hub_bridge_modified: false,
});

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizeLower(value) {
  return normalizeSingleLine(value).toLowerCase();
}

function normalizeUpper(value) {
  return normalizeSingleLine(value).toUpperCase();
}

function normalizeOrderNumber(value) {
  return normalizeSingleLine(value).replace(/^#/, '');
}

function safeText(value, maxLength = MAX_TEXT) {
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

function safeId(value, maxLength = MAX_TEXT) {
  const text = safeText(value, maxLength);
  return text && /^[A-Za-z0-9._:@/#-]+$/.test(text) ? text : '';
}

function uniqueStrings(values, limit = 120) {
  return [...new Set((values || []).map(value => safeText(value, 180)).filter(Boolean))].slice(0, limit);
}

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
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

function getPreviewSecret() {
  return normalizeText(Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET')) ||
    normalizeText(Deno.env.get('CUSTOMER_APP_SYNC_SECRET')) ||
    normalizeText(Deno.env.get('HUB_SYNC_SECRET'));
}

function suppliedInternalSecret(req, body) {
  return normalizeText(req.headers.get('x-native-preview-secret')) ||
    normalizeText(req.headers.get('x-internal-secret')) ||
    normalizeText(body?._internal_secret || body?.internal_secret);
}

async function requirePreviewAccess({ base44, req, body }) {
  const expected = getPreviewSecret();
  const supplied = suppliedInternalSecret(req, body);
  if (expected && supplied && supplied === expected) {
    return { ok: true, actor_type: 'internal_service', actor_role: 'service', actor_email_present: false };
  }
  try {
    const user = await base44.auth.me();
    if (!user) return { ok: false, response: jsonResponse({ success: false, error_code: 'unauthorized', writes_performed: false }, 401) };
    if (user.role !== 'admin') return { ok: false, response: jsonResponse({ success: false, error_code: 'forbidden', writes_performed: false }, 403) };
    return { ok: true, actor_type: 'admin', actor_role: user.role, actor_email_present: Boolean(user.email) };
  } catch {
    return { ok: false, response: jsonResponse({ success: false, error_code: 'unauthorized', writes_performed: false }, 401) };
  }
}

function getLookup(body) {
  return {
    orderNumber: normalizeOrderNumber(body?.order_number || body?.shopify_order_number),
    customerAppOrderId: safeId(body?.customer_app_order_id || body?.base44_order_id || body?.order_id, 140),
    nativeShopifyOrderId: safeId(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id, 140),
    nativeFulfillmentTaskId: safeId(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id, 140),
    statusMode: normalizeUpper(body?.status_mode || body?.correction_mode || STATUS_MODE),
    notificationPolicy: normalizeUpper(body?.notification_policy || REQUIRED_NOTIFICATION_POLICY),
    proofDropPolicy: normalizeUpper(body?.proof_drop_policy || REQUIRED_PROOF_DROP_POLICY),
    requestId: safeId(body?.request_id, 180),
  };
}

async function filterEntity(base44, entityName, filter, sort = '-created_date', limit = 20) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity?.filter) return [];
  const rows = await entity.filter(filter, sort, limit).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function getEntity(base44, entityName, id) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity?.get || !id) return null;
  return entity.get(id).catch(() => null);
}

async function findCustomerOrder(base44, lookup) {
  const id = lookup.customerAppOrderId || TARGET_CUSTOMER_APP_ORDER_ID;
  const byId = await getEntity(base44, 'Order', id);
  if (byId?.id) return byId;
  const rows = await filterEntity(base44, 'Order', { order_number: lookup.orderNumber || TARGET_ORDER_NUMBER }, '-created_date', 5);
  return rows.find(row => safeId(row?.id, 140) === id) || rows[0] || null;
}

async function findNativeShopifyOrder(base44, lookup) {
  const id = lookup.nativeShopifyOrderId || TARGET_NATIVE_SHOPIFY_ORDER_ID;
  const byId = await getEntity(base44, 'ShopifyOrder', id);
  if (byId?.id) return byId;
  const rows = await filterEntity(base44, 'ShopifyOrder', { shopify_order_number: lookup.orderNumber || TARGET_ORDER_NUMBER }, '-created_date', 5);
  return rows.find(row => safeId(row?.id, 140) === id) || rows[0] || null;
}

async function findNativeFulfillmentTask(base44, lookup) {
  const id = lookup.nativeFulfillmentTaskId || TARGET_NATIVE_FULFILLMENT_TASK_ID;
  const byId = await getEntity(base44, 'FulfillmentTask', id);
  if (byId?.id) return byId;
  const rows = await filterEntity(base44, 'FulfillmentTask', { order_number: lookup.orderNumber || TARGET_ORDER_NUMBER }, '-created_date', 20);
  return rows.find(row => safeId(row?.id, 140) === id || safeId(row?.fulfillment_task_id, 140) === id) || null;
}

async function findBatchByBatchId(base44, batchId) {
  return filterEntity(base44, 'ProductionBatch', { batch_id: batchId }, '-created_date', 5);
}

async function findComplianceLogsForBatch(base44, batch) {
  const byDisplayId = batch?.batch_id ? await filterEntity(base44, 'BatchComplianceLog', { batch_id: batch.batch_id }, '-created_date', 20) : [];
  const bySourceId = batch?.id ? await filterEntity(base44, 'BatchComplianceLog', { source_production_batch_id: batch.id }, '-created_date', 20) : [];
  return [...new Map([...byDisplayId, ...bySourceId].map(row => [row.id || `${row.batch_id}:${row.source_production_batch_id}`, row])).values()];
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
    notification_count: [...new Map(notificationRows.map(row => [row.id, row])).values()].length,
    message_log_count: [...new Map([...messageLogsByOrderId, ...messageLogsByOrderNumber].map(row => [row.id, row])).values()].length,
  };
}

function orderType(customerOrder, nativeOrder, task) {
  if (nativeOrder?.is_subscription === true || customerOrder?.is_subscription === true || customerOrder?.subscription_id || nativeOrder?.subscription_parent_id || task?.customer_app_subscription_id || task?.stripe_subscription_id) return 'subscription';
  return normalizeLower(nativeOrder?.order_type || customerOrder?.order_type || task?.order_type || 'one_time') || 'one_time';
}

function fulfillmentMode(customerOrder, nativeOrder, task) {
  return normalizeLower(nativeOrder?.fulfillment_mode || customerOrder?.fulfillment_mode || task?.fulfillment_mode || task?.fulfillment_type || nativeOrder?.fulfillment_method || customerOrder?.fulfillment_type || 'single_delivery') || 'single_delivery';
}

function statusHistoryAlreadyContains(order, status) {
  return Array.isArray(order?.status_history) && order.status_history.some(entry => normalizeLower(entry?.status) === normalizeLower(status));
}

function deliveredStatusMappingBlockers(targetStatus = CUSTOMER_DELIVERED_STATUS) {
  const blockers = [];
  if (normalizeLower(targetStatus) !== CUSTOMER_DELIVERED_STATUS) blockers.push('delivered_status_mapping_required');
  if (!STATUS_NOTIFICATION_SUBTYPES[CUSTOMER_DELIVERED_STATUS]) blockers.push('delivered_notification_mapping_missing_for_audit');
  return blockers;
}

async function loadTargetContext(base44, lookup) {
  const blockers = [];
  const warnings = [];
  const conflicts = [];
  const orderNumber = lookup.orderNumber || TARGET_ORDER_NUMBER;
  const customerOrder = await findCustomerOrder(base44, lookup);
  const nativeOrder = await findNativeShopifyOrder(base44, lookup);
  const task = await findNativeFulfillmentTask(base44, lookup);
  const batches = [];
  const complianceLogs = [];

  if (orderNumber !== TARGET_ORDER_NUMBER) blockers.push('target_order_number_mismatch');
  if ((lookup.customerAppOrderId || TARGET_CUSTOMER_APP_ORDER_ID) !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('target_customer_app_order_id_mismatch');
  if ((lookup.nativeShopifyOrderId || TARGET_NATIVE_SHOPIFY_ORDER_ID) !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('target_native_shopify_order_id_mismatch');
  if ((lookup.nativeFulfillmentTaskId || TARGET_NATIVE_FULFILLMENT_TASK_ID) !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('target_native_fulfillment_task_id_mismatch');
  if (lookup.statusMode !== STATUS_MODE) blockers.push('delivered_status_only_no_notification_mode_required');
  if (lookup.notificationPolicy !== REQUIRED_NOTIFICATION_POLICY) blockers.push('notification_policy_must_be_no_notification');
  if (lookup.proofDropPolicy !== REQUIRED_PROOF_DROP_POLICY) blockers.push('proof_drop_policy_must_be_held_not_required_for_reconciliation');
  blockers.push(...deliveredStatusMappingBlockers(CUSTOMER_DELIVERED_STATUS).filter(code => code !== 'delivered_notification_mapping_missing_for_audit'));
  if (STATUS_NOTIFICATION_SUBTYPES[CUSTOMER_DELIVERED_STATUS]) warnings.push('delivered_notification_subtype_configured_but_not_called');

  if (!customerOrder) blockers.push('customer_app_order_not_found');
  if (!nativeOrder) blockers.push('native_shopify_order_not_found');
  if (!task) blockers.push('native_fulfillment_task_not_found');

  if (customerOrder) {
    const status = normalizeLower(customerOrder.status);
    if (safeId(customerOrder.id, 140) !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('customer_app_order_id_mismatch');
    if (normalizeOrderNumber(customerOrder.order_number || customerOrder.shopify_order_number) !== TARGET_ORDER_NUMBER) blockers.push('customer_app_order_number_mismatch');
    if (normalizeLower(customerOrder.payment_status) !== 'paid') blockers.push('customer_app_order_not_paid');
    if (customerOrder.payment_captured !== true) blockers.push('customer_app_order_payment_not_captured');
    if (CUSTOMER_ORDER_CANCELLED_REFUNDED.has(status)) blockers.push('customer_app_order_cancelled_or_refunded');
  }

  if (nativeOrder) {
    const productionStatus = normalizeLower(nativeOrder.production_status);
    const fulfillmentStatus = normalizeLower(nativeOrder.fulfillment_status);
    const paymentStatus = normalizeLower(nativeOrder.payment_status || nativeOrder.financial_status || customerOrder?.payment_status);
    const type = orderType(customerOrder, nativeOrder, task);
    const mode = fulfillmentMode(customerOrder, nativeOrder, task);
    if (safeId(nativeOrder.id, 140) !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('native_shopify_order_id_mismatch');
    if (normalizeOrderNumber(nativeOrder.shopify_order_number || nativeOrder.order_number) !== TARGET_ORDER_NUMBER) blockers.push('native_shopify_order_number_mismatch');
    if (nativeOrder.base44_order_id && safeId(nativeOrder.base44_order_id, 140) !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('native_shopify_order_base44_order_mismatch');
    if (productionStatus !== 'bottled') blockers.push('native_shopify_order_not_bottled');
    if (fulfillmentStatus !== NATIVE_ORDER_FULFILLED_STATUS) blockers.push('native_shopify_order_not_fulfilled');
    if (NATIVE_ORDER_CANCELLED_REFUNDED.has(productionStatus) || NATIVE_ORDER_CANCELLED_REFUNDED.has(fulfillmentStatus) || NATIVE_ORDER_CANCELLED_REFUNDED.has(paymentStatus)) blockers.push('native_order_cancelled_or_refunded');
    if (['subscription', 'multi_delivery'].includes(type) || mode === 'multi_delivery') blockers.push('subscription_multi_delivery_delivered_status_blocked');
  }

  if (task) {
    if (safeId(task.id, 140) !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('native_fulfillment_task_id_mismatch');
    if (normalizeLower(task.status) !== NATIVE_TASK_DELIVERED_STATUS) blockers.push('native_fulfillment_task_not_delivered');
    if (normalizeLower(task.delivery_status) !== NATIVE_TASK_DELIVERED_DELIVERY_STATUS) blockers.push('native_fulfillment_task_delivery_status_not_delivered');
    if (!task.delivered_at) blockers.push('native_fulfillment_task_delivered_at_missing');
    if (normalizeLower(task.production_status) !== 'packed') warnings.push('native_fulfillment_task_production_status_not_packed');
  }

  for (const batchId of EXPECTED_BATCH_IDS) {
    const matches = await findBatchByBatchId(base44, batchId);
    if (matches.length === 0) {
      blockers.push(`production_batch_not_found:${batchId}`);
      continue;
    }
    if (matches.length > 1) {
      blockers.push(`multiple_production_batch_matches:${batchId}`);
      conflicts.push({ batch_id: batchId, reason: 'multiple_production_batch_matches', match_count: matches.length });
      continue;
    }
    const batch = matches[0];
    batches.push(batch);
    if (normalizeLower(batch?.status) !== 'verified_logged') blockers.push(`production_batch_not_verified_logged:${batchId}`);
    const logs = await findComplianceLogsForBatch(base44, batch);
    complianceLogs.push(...logs);
    if (logs.length === 0) blockers.push(`missing_batch_compliance_log:${batchId}`);
  }

  const uniqueComplianceLogs = [...new Map(complianceLogs.map(row => [row.id || `${row.batch_id}:${row.source_production_batch_id}`, row])).values()];
  if (batches.length !== EXPECTED_BATCH_IDS.length) blockers.push('verified_production_batch_count_mismatch');
  if (uniqueComplianceLogs.length < EXPECTED_BATCH_IDS.length) blockers.push('batch_compliance_log_count_mismatch');

  return {
    ready: blockers.length === 0,
    blockers: uniqueStrings(blockers, 160),
    warnings: uniqueStrings(warnings, 120),
    conflicts,
    orderNumber,
    customerOrder,
    nativeOrder,
    task,
    batches,
    complianceLogs: uniqueComplianceLogs,
    notificationContext: await loadNotificationContext(base44, customerOrder, orderNumber),
  };
}

function buildPreview(context, lookup, access) {
  const customerOrder = context.customerOrder || {};
  const nativeOrder = context.nativeOrder || {};
  const task = context.task || {};
  const currentStatus = normalizeLower(customerOrder.status);
  const alreadySatisfied = currentStatus === CUSTOMER_DELIVERED_STATUS;
  const updateReady = context.ready === true && !alreadySatisfied;
  const statusHistoryCount = Array.isArray(customerOrder.status_history) ? customerOrder.status_history.length : 0;
  const warnings = uniqueStrings([
    ...context.warnings,
    'customer_delivered_status_update_held_pending_explicit_approval',
    'notifications_held',
    'proof_drop_held_not_required_for_reconciliation',
    'provider_shopify_sync_held',
    alreadySatisfied ? 'customer_status_already_delivered' : null,
  ], 160);

  return {
    success: context.blockers.length === 0,
    dry_run: true,
    writes_performed: false,
    function_name: FUNCTION_NAME,
    preview_source: 'local_read_only',
    order_number: TARGET_ORDER_NUMBER,
    customer_app_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
    native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
    native_fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
    correction_mode: STATUS_MODE,
    status_mode: STATUS_MODE,
    notification_policy: REQUIRED_NOTIFICATION_POLICY,
    proof_drop_policy: REQUIRED_PROOF_DROP_POLICY,
    current_customer_order_status: safeText(customerOrder.status, 80) || null,
    proposed_customer_order_status: CUSTOMER_DELIVERED_STATUS,
    status_update_ready: updateReady,
    status_update_held: true,
    customer_delivered_status_already_satisfied: alreadySatisfied,
    status_command_available: updateReady,
    status_command_gated: true,
    status_requires_exact_approval: updateReady,
    customer_app_order_present: Boolean(customerOrder.id),
    native_shopify_order_present: Boolean(nativeOrder.id),
    native_fulfillment_task_present: Boolean(task.id),
    production_verified: context.batches.length === EXPECTED_BATCH_IDS.length && context.batches.every(batch => normalizeLower(batch.status) === 'verified_logged'),
    production_batch_count: context.batches.length,
    verified_batch_count: context.batches.filter(batch => normalizeLower(batch.status) === 'verified_logged').length,
    compliance_log_count: context.complianceLogs.length,
    native_task_delivered: normalizeLower(task.status) === NATIVE_TASK_DELIVERED_STATUS && normalizeLower(task.delivery_status) === NATIVE_TASK_DELIVERED_DELIVERY_STATUS && Boolean(task.delivered_at),
    native_order_fulfilled: normalizeLower(nativeOrder.fulfillment_status) === NATIVE_ORDER_FULFILLED_STATUS,
    native_order_bottled: normalizeLower(nativeOrder.production_status) === 'bottled',
    delivered_at_present: Boolean(task.delivered_at),
    proof_drop_required: false,
    proof_drop_held: true,
    notification_would_send: false,
    notification_held: true,
    notification_preview: {
      notification_would_send: false,
      notification_held: true,
      notification_policy: REQUIRED_NOTIFICATION_POLICY,
      delivered_notification_subtype_configured: Boolean(STATUS_NOTIFICATION_SUBTYPES[CUSTOMER_DELIVERED_STATUS]),
      proposed_notification_subtype: STATUS_NOTIFICATION_SUBTYPES[CUSTOMER_DELIVERED_STATUS] || null,
      automatic_notification_would_send_if_status_updated: false,
      channels: { in_app: false, push: false, sms: false, email: false },
      existing_notification_count: context.notificationContext.notification_count,
      existing_message_log_count: context.notificationContext.message_log_count,
    },
    status_history_preview: {
      would_append: updateReady,
      append_held: true,
      existing_status_history_count: statusHistoryCount,
      already_has_delivered_entry: statusHistoryAlreadyContains(customerOrder, CUSTOMER_DELIVERED_STATUS),
      preview_entry: updateReady ? {
        status: CUSTOMER_DELIVERED_STATUS,
        timestamp: '[server timestamp if later approved]',
        message: 'Order delivered. Customer-facing delivered status reconciled without notification.',
        writes_performed: false,
      } : null,
    },
    customer_status_impact: {
      current_status: safeText(customerOrder.status, 80) || null,
      proposed_status: CUSTOMER_DELIVERED_STATUS,
      customer_visible_status_change_if_later_approved: updateReady,
      status_history_append_if_later_approved: updateReady,
      status_update_held: true,
    },
    proof_drop_impact: {
      proof_drop_policy: REQUIRED_PROOF_DROP_POLICY,
      proof_drop_required: false,
      would_write_proof_drop_fields: false,
    },
    provider_sync_impact: {
      provider_calls_performed: false,
      stripe_calls_performed: false,
      shopify_api_calls_performed: false,
      sync_repair_replay_performed: false,
    },
    status_mapping_audit: {
      canonical_customer_final_status: CUSTOMER_DELIVERED_STATUS,
      mapping_source: 'Order status constants and delivered notification subtype audit',
      delivered_notification_subtype_configured: Boolean(STATUS_NOTIFICATION_SUBTYPES[CUSTOMER_DELIVERED_STATUS]),
      status_update_can_run_with_no_notification_policy: true,
      proof_drop_required_for_customer_status: false,
      blockers: deliveredStatusMappingBlockers(CUSTOMER_DELIVERED_STATUS).filter(code => code !== 'delivered_notification_mapping_missing_for_audit'),
    },
    blockers: context.blockers,
    warnings,
    conflicts: context.conflicts,
    next_action: context.blockers.length > 0
      ? 'resolve_delivered_status_preview_blockers'
      : alreadySatisfied
        ? 'customer_delivered_status_already_satisfied'
        : 'plan_gated_customer_delivered_status_command',
    actor_context: access ? {
      actor_type: access.actor_type || null,
      actor_role: access.actor_role || null,
      actor_email_present: Boolean(access.actor_email_present),
    } : null,
    request_id: lookup.requestId || null,
    safety: READ_ONLY_SAFETY,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return jsonResponse({ success: false, error_code: 'method_not_allowed', message: 'POST required', writes_performed: false }, 405);
    }

    const parsed = await readJsonBody(req);
    if (!parsed.ok) return jsonResponse({ success: false, error_code: 'malformed_json', writes_performed: false }, 400);
    const body = parsed.body || {};
    const badKey = unsupportedBodyKey(body);
    if (badKey) return jsonResponse({ success: false, error_code: 'unsupported_request_field', field: safeText(badKey, 80), writes_performed: false }, 400);

    const base44 = createClientFromRequest(req);
    const access = await requirePreviewAccess({ base44, req, body });
    if (!access.ok) return access.response;

    const lookup = getLookup(body);
    const context = await loadTargetContext(base44, lookup);
    const preview = buildPreview(context, lookup, access);
    return jsonResponse(preview, preview.success ? 200 : 409);
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] failed safely: ${error?.message || 'unknown error'}`);
    return jsonResponse({ success: false, error_code: 'native_customer_delivered_status_preview_failed', writes_performed: false, dry_run: true }, 500);
  }
});
