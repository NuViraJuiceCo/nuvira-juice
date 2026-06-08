import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const FUNCTION_NAME = 'previewNativeDeliveryCompletionReconciliation';
const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const TARGET_NATIVE_ORDER_NUMBER = 'NV-MPZNKGNT';
const TARGET_HUB_ORDER_NUMBER = '1052';
const DEFAULT_HUB_SINCE = '2026-05-01';
const AUDITED_HUB_FULFILLED_FALLBACKS = Object.freeze({
  '1052': {
    shopify_order_number: '1052',
    fulfillment_status: 'fulfilled',
    production_status: 'new',
    audit_fallback_reason: 'g32h_read_only_hub_audit_confirmed_fulfilled_no_native_records',
  },
});
const HUB_FETCH_TIMEOUT_MS = 8000;

const CORRECTION_MODES = new Set([
  'DIRECT_DELIVERED_NO_NOTIFICATION',
  'HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION',
  'STATUS_ONLY_NO_NOTIFICATION',
  'HUB_FALLBACK_ONLY',
]);
const REQUIRED_NOTIFICATION_POLICY = 'NO_NOTIFICATION';
const REQUIRED_PROOF_DROP_POLICY = 'HELD_NOT_REQUIRED_FOR_RECONCILIATION';
const DELIVERED_TASK_STATUS = 'delivered';
const DELIVERED_DELIVERY_STATUS = 'delivered';
const SHOPIFY_ORDER_FULFILLED_STATUS = 'fulfilled';
const CUSTOMER_ORDER_DELIVERED_STATUS = 'delivered';

const ALLOWED_BODY_KEYS = new Set([
  'mode',
  'order_number',
  'customer_app_order_id',
  'base44_order_id',
  'order_id',
  'native_shopify_order_id',
  'native_order_id',
  'shopify_order_id',
  'native_fulfillment_task_id',
  'fulfillment_task_id',
  'task_id',
  'hub_order_number',
  'correction_mode',
  'notification_policy',
  'proof_drop_policy',
  'actual_delivered_at',
  'request_id',
  'targets',
  '_internal_secret',
  'internal_secret',
]);

const READ_ONLY_SAFETY = Object.freeze({
  dry_run_only: true,
  writes_performed: false,
  customer_app_order_updated: false,
  customer_app_order_created: false,
  status_history_appended: false,
  native_shopify_order_updated: false,
  native_shopify_order_created: false,
  native_fulfillment_task_updated: false,
  native_fulfillment_task_created: false,
  hub_records_updated: false,
  notifications_created: false,
  notifications_sent: false,
  message_logs_created: false,
  proof_drop_route_fields_written: false,
  production_batch_updated: false,
  batch_compliance_log_updated: false,
  provider_calls_performed: false,
  stripe_calls_performed: false,
  shopify_api_calls_performed: false,
  sync_repair_replay_performed: false,
  inventory_deducted: false,
  purchase_order_created: false,
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

function sanitizeText(value, maxLength = 180) {
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

function isoDate(value) {
  const match = normalizeText(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function isIsoDateTime(value) {
  const text = normalizeText(value);
  return Boolean(text && !Number.isNaN(Date.parse(text)));
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function readJsonBody(req) {
  const raw = await req.text();
  if (!raw.trim()) return { ok: true, body: {} };
  try {
    const parsed = JSON.parse(raw);
    return { ok: true, body: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {} };
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
  if (expected && supplied && supplied === expected) return { ok: true, actor_type: 'internal_service', actor_role: 'service' };
  try {
    const user = await base44.auth.me();
    if (!user) return { ok: false, response: Response.json({ success: false, error_code: 'unauthorized', writes_performed: false }, { status: 401 }) };
    if (user.role !== 'admin') return { ok: false, response: Response.json({ success: false, error_code: 'forbidden', writes_performed: false }, { status: 403 }) };
    return { ok: true, actor_type: 'admin', actor_role: user.role, actor_email_present: Boolean(user.email) };
  } catch {
    return { ok: false, response: Response.json({ success: false, error_code: 'unauthorized', writes_performed: false }, { status: 401 }) };
  }
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

function lookupFromBody(body) {
  return {
    orderNumber: normalizeOrderNumber(body?.order_number),
    customerAppOrderId: sanitizeId(body?.customer_app_order_id || body?.base44_order_id || body?.order_id, 140),
    nativeShopifyOrderId: sanitizeId(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id, 140),
    nativeFulfillmentTaskId: sanitizeId(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id, 140),
    hubOrderNumber: normalizeOrderNumber(body?.hub_order_number),
    correctionMode: normalizeUpper(body?.correction_mode),
    notificationPolicy: normalizeUpper(body?.notification_policy),
    proofDropPolicy: normalizeUpper(body?.proof_drop_policy),
    actualDeliveredAt: sanitizeText(body?.actual_delivered_at, 100),
    requestId: sanitizeId(body?.request_id, 160),
  };
}

function targetSpecsFromBody(body) {
  const lookup = lookupFromBody(body);
  const rawTargets = Array.isArray(body?.targets) ? body.targets : [];
  const targets = [];
  for (const target of rawTargets) {
    if (typeof target === 'string') {
      const orderNumber = normalizeOrderNumber(target);
      if (orderNumber) targets.push({ orderNumber, hubOrderNumber: orderNumber, label: orderNumber });
    } else if (target && typeof target === 'object' && !Array.isArray(target)) {
      const targetLookup = lookupFromBody(target);
      targets.push({
        orderNumber: targetLookup.orderNumber,
        customerAppOrderId: targetLookup.customerAppOrderId,
        nativeShopifyOrderId: targetLookup.nativeShopifyOrderId,
        nativeFulfillmentTaskId: targetLookup.nativeFulfillmentTaskId,
        hubOrderNumber: targetLookup.hubOrderNumber || targetLookup.orderNumber,
        correctionMode: targetLookup.correctionMode,
        label: targetLookup.orderNumber || targetLookup.hubOrderNumber || targetLookup.customerAppOrderId || 'target',
      });
    }
  }
  if (lookup.orderNumber || lookup.customerAppOrderId || lookup.nativeShopifyOrderId || lookup.nativeFulfillmentTaskId || lookup.hubOrderNumber) {
    targets.unshift({
      orderNumber: lookup.orderNumber,
      customerAppOrderId: lookup.customerAppOrderId,
      nativeShopifyOrderId: lookup.nativeShopifyOrderId,
      nativeFulfillmentTaskId: lookup.nativeFulfillmentTaskId,
      hubOrderNumber: lookup.hubOrderNumber || lookup.orderNumber,
      correctionMode: lookup.correctionMode,
      label: lookup.orderNumber || lookup.hubOrderNumber || lookup.customerAppOrderId || 'target',
    });
  }
  if (targets.length === 0) {
    targets.push(
      { orderNumber: TARGET_NATIVE_ORDER_NUMBER, hubOrderNumber: TARGET_NATIVE_ORDER_NUMBER, correctionMode: 'DIRECT_DELIVERED_NO_NOTIFICATION', label: TARGET_NATIVE_ORDER_NUMBER },
      { orderNumber: TARGET_HUB_ORDER_NUMBER, hubOrderNumber: TARGET_HUB_ORDER_NUMBER, correctionMode: 'HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION', label: TARGET_HUB_ORDER_NUMBER },
    );
  }
  return [...new Map(targets.map(target => [
    `${target.orderNumber || ''}:${target.customerAppOrderId || ''}:${target.nativeShopifyOrderId || ''}:${target.nativeFulfillmentTaskId || ''}:${target.hubOrderNumber || ''}:${target.correctionMode || ''}`,
    target,
  ])).values()].slice(0, 8);
}

async function findCustomerOrder(base44, spec) {
  const filters = [];
  if (spec.customerAppOrderId) filters.push({ id: spec.customerAppOrderId });
  if (spec.orderNumber) filters.push({ order_number: spec.orderNumber }, { shopify_order_number: spec.orderNumber });
  for (const filter of filters) {
    const rows = await filterEntity(base44, 'Order', filter, '-created_date', 5);
    if (rows.length) return rows[0];
  }
  return null;
}

async function findNativeShopifyOrder(base44, customerOrder, spec) {
  const orderNumber = spec.orderNumber || normalizeOrderNumber(customerOrder?.order_number || customerOrder?.shopify_order_number);
  const filters = [];
  if (spec.nativeShopifyOrderId) filters.push({ id: spec.nativeShopifyOrderId }, { shopify_order_id: spec.nativeShopifyOrderId });
  if (customerOrder?.id) filters.push({ base44_order_id: customerOrder.id });
  if (orderNumber) filters.push({ shopify_order_number: orderNumber }, { order_number: orderNumber });
  for (const filter of filters) {
    const rows = await filterEntity(base44, 'ShopifyOrder', filter, '-created_date', 5);
    if (rows.length) return rows[0];
  }
  return null;
}

async function findNativeFulfillmentTask(base44, customerOrder, nativeOrder, spec) {
  const orderNumber = spec.orderNumber || normalizeOrderNumber(nativeOrder?.shopify_order_number || nativeOrder?.order_number || customerOrder?.order_number);
  const filters = [];
  if (spec.nativeFulfillmentTaskId) filters.push({ id: spec.nativeFulfillmentTaskId }, { fulfillment_task_id: spec.nativeFulfillmentTaskId });
  if (nativeOrder?.id) filters.push({ native_shopify_order_id: nativeOrder.id }, { shopify_order_id: nativeOrder.id }, { order_id: nativeOrder.id });
  if (customerOrder?.id) filters.push({ base44_order_id: customerOrder.id }, { order_id: customerOrder.id });
  if (orderNumber) filters.push({ order_number: orderNumber }, { shopify_order_number: orderNumber });
  for (const filter of filters) {
    const rows = await filterEntity(base44, 'FulfillmentTask', filter, '-created_date', 20);
    if (rows.length) return rows[0];
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

async function findProductionBatches(base44, context) {
  const all = await listEntity(base44, 'ProductionBatch', '-production_date', 800);
  return all.filter(batch => batchReferencesTarget(batch, context)).slice(0, 80);
}

async function complianceLogsForBatches(base44, batches) {
  const groups = await Promise.all((batches || []).map(async batch => {
    const byDisplayId = batch?.batch_id ? await filterEntity(base44, 'BatchComplianceLog', { batch_id: batch.batch_id }, '-created_date', 20) : [];
    const bySourceId = batch?.id ? await filterEntity(base44, 'BatchComplianceLog', { source_production_batch_id: batch.id }, '-created_date', 20) : [];
    return [...new Map([...byDisplayId, ...bySourceId].map(row => [row.id, row])).values()];
  }));
  return groups.flat();
}

function safeOrderStatus(order) {
  return order ? {
    id: sanitizeId(order.id, 140) || null,
    order_number: sanitizeText(normalizeOrderNumber(order.order_number || order.shopify_order_number), 80) || null,
    status: sanitizeText(order.status, 80) || null,
    payment_status: sanitizeText(order.payment_status || order.financial_status, 80) || null,
    payment_captured: order.payment_captured === true,
    fulfillment_status: sanitizeText(order.fulfillment_status, 80) || null,
    delivery_status: sanitizeText(order.delivery_status, 80) || null,
    production_status: sanitizeText(order.production_status, 80) || null,
    assigned_delivery_date: isoDate(order.assigned_delivery_date || order.estimated_delivery_date || order.delivery_date) || null,
    production_date: isoDate(order.production_date || order.assigned_production_day) || null,
    delivered_at_present: Boolean(order.delivered_at || order.fulfilled_at || order.completed_at || order.delivery_completed_at),
    status_history_count: Array.isArray(order.status_history) ? order.status_history.length : null,
  } : null;
}

function safeNativeOrderStatus(order) {
  return order ? {
    id: sanitizeId(order.id, 140) || null,
    order_number: sanitizeText(normalizeOrderNumber(order.shopify_order_number || order.order_number), 80) || null,
    production_status: sanitizeText(order.production_status, 80) || null,
    fulfillment_status: sanitizeText(order.fulfillment_status, 80) || null,
    financial_status: sanitizeText(order.financial_status || order.payment_status, 80) || null,
    assigned_delivery_date: isoDate(order.assigned_delivery_date || order.selected_delivery_date || order.delivery_date) || null,
    production_date: isoDate(order.production_date) || null,
    delivered_at_present: Boolean(order.delivered_at || order.fulfilled_at || order.completed_at),
    audit_trail_count: Array.isArray(order.audit_trail) ? order.audit_trail.length : null,
  } : null;
}

function safeTaskStatus(task) {
  return task ? {
    id: sanitizeId(task.id, 140) || null,
    order_number: sanitizeText(normalizeOrderNumber(task.order_number || task.shopify_order_number), 80) || null,
    status: sanitizeText(task.status, 80) || null,
    delivery_status: sanitizeText(task.delivery_status, 80) || null,
    production_status: sanitizeText(task.production_status, 80) || null,
    delivery_date: isoDate(task.delivery_date || task.scheduled_date || task.assigned_delivery_date) || null,
    scheduled_date: isoDate(task.scheduled_date) || null,
    assigned_delivery_date: isoDate(task.assigned_delivery_date) || null,
    production_date: isoDate(task.production_date) || null,
    packed_at_present: Boolean(task.packed_at),
    out_for_delivery_at_present: Boolean(task.out_for_delivery_at || task.dispatched_at),
    delivered_at_present: Boolean(task.delivered_at || task.delivery_completed_at || task.completed_at),
    proof_drop_fields_present: Boolean(task.proof_photo_url || task.delivery_proof_url || task.drop_photo_url || task.dropoff_photo_url || task.proof_of_delivery || task.delivery_drop_location),
    audit_trail_count: Array.isArray(task.audit_trail) ? task.audit_trail.length : null,
  } : null;
}

function hubOrderNumber(order) {
  return normalizeOrderNumber(order?.shopify_order_number || order?.order_number || order?.name);
}

function safeHubOrderStatus(order) {
  return order ? {
    order_number: sanitizeText(hubOrderNumber(order), 80) || null,
    hub_order_id_present: Boolean(order.id || order.shopify_order_id),
    customer_email_present: Boolean(order.customer_email || order.contact_email),
    customer_name_present: Boolean(order.customer_name || order.full_name),
    source_channel: sanitizeText(order.source_channel || order.source_type, 80) || null,
    order_type: sanitizeText(order.order_type || (Array.isArray(order.fulfillments) && order.fulfillments.length > 1 ? 'subscription' : 'one_time'), 80) || null,
    payment_status: sanitizeText(order.payment_status || order.financial_status, 80) || null,
    production_status: sanitizeText(order.production_status || order.status, 80) || null,
    fulfillment_status: sanitizeText(order.fulfillment_status || order.shopify_fulfillment_status, 80) || null,
    fulfillment_method: sanitizeText(order.fulfillment_method || order.fulfillment_type, 80) || null,
    assigned_delivery_date: isoDate(order.assigned_delivery_date || order.selected_delivery_date || order.estimated_delivery_date || order.delivery_date) || null,
    production_date: isoDate(order.production_date) || null,
    delivered_at_present: Boolean(order.delivered_at || order.fulfilled_at || order.completed_at),
    line_item_count: Array.isArray(order.line_items) ? order.line_items.length : 0,
    total_price_present: order.total_price !== undefined || order.total !== undefined,
    audit_fallback_used: Boolean(order.audit_fallback_reason),
  } : null;
}

function auditedHubFallbackOrder(orderNumber) {
  const key = normalizeOrderNumber(orderNumber);
  const fallback = AUDITED_HUB_FULFILLED_FALLBACKS[key];
  return fallback ? { ...fallback } : null;
}

async function fetchHubOrders({ since = DEFAULT_HUB_SINCE } = {}) {
  const hubBase = HUB_API_URL ? HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '') : null;
  if (!hubBase || !CUSTOMER_APP_SYNC_SECRET) return { ok: false, status: 0, error_code: 'hub_config_missing', orders: [] };
  const url = new URL(`${hubBase}/functions/getOrderUpdatesForCustomerApp`);
  if (since) url.searchParams.set('since', since);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HUB_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}` }, signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status, error_code: `hub_fetch_failed_${response.status}`, orders: [] };
    const data = await response.json().catch(() => null);
    return { ok: true, status: response.status, orders: Array.isArray(data?.orders) ? data.orders : [] };
  } catch (error) {
    return { ok: false, status: 0, error_code: error?.name === 'AbortError' ? 'hub_fetch_timeout' : 'hub_fetch_failed', orders: [] };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHubTasksForOrder(orderNumber) {
  const hubBase = HUB_API_URL ? HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '') : null;
  if (!hubBase || !CUSTOMER_APP_SYNC_SECRET || !orderNumber) return { ok: false, status: 0, error_code: 'hub_task_detail_unavailable', tasks: [] };
  const url = new URL(`${hubBase}/functions/getFulfillmentTaskDetailsForCustomerApp`);
  url.searchParams.set('order_number', orderNumber);
  url.searchParams.set('limit', '10');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HUB_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}` }, signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status, error_code: `hub_task_fetch_failed_${response.status}`, tasks: [] };
    const data = await response.json().catch(() => null);
    return { ok: true, status: response.status, matched_by: data?.matched_by || null, tasks: Array.isArray(data?.tasks) ? data.tasks : [] };
  } catch (error) {
    return { ok: false, status: 0, error_code: error?.name === 'AbortError' ? 'hub_task_fetch_timeout' : 'hub_task_fetch_failed', tasks: [] };
  } finally {
    clearTimeout(timeout);
  }
}

function statusMappingAudit() {
  return {
    schema_audited: true,
    fulfillment_task: {
      status_delivered_supported: true,
      status_value: DELIVERED_TASK_STATUS,
      delivery_status_value: DELIVERED_DELIVERY_STATUS,
      delivered_at_supported: true,
      sequence_required_before_direct_delivered: false,
    },
    native_shopify_order: {
      fulfillment_status_fulfilled_supported: true,
      fulfillment_status_value: SHOPIFY_ORDER_FULFILLED_STATUS,
      delivered_at_supported: true,
    },
    customer_app_order: {
      delivered_status_supported: true,
      status_value: CUSTOMER_ORDER_DELIVERED_STATUS,
      status_history_supported: true,
      status_update_held_for_separate_approval: true,
    },
    mapping_blockers: [],
  };
}

function commonPolicyBlockers({ correctionMode, notificationPolicy, proofDropPolicy }) {
  return unique([
    !CORRECTION_MODES.has(correctionMode) ? 'unsupported_correction_mode' : null,
    notificationPolicy !== REQUIRED_NOTIFICATION_POLICY ? 'notification_policy_must_be_no_notification' : null,
    proofDropPolicy !== REQUIRED_PROOF_DROP_POLICY ? 'proof_drop_policy_must_be_held_not_required_for_reconciliation' : null,
  ]);
}

function buildNativeDeliveredRow({ spec, customerOrder, nativeOrder, task, batches, complianceLogs, policy, mapping }) {
  const orderNumber = spec.orderNumber || normalizeOrderNumber(task?.order_number || nativeOrder?.shopify_order_number || customerOrder?.order_number) || TARGET_NATIVE_ORDER_NUMBER;
  const taskStatus = normalizeLower(task?.status);
  const deliveryStatus = normalizeLower(task?.delivery_status);
  const nativeProductionStatus = normalizeLower(nativeOrder?.production_status);
  const nativeFulfillmentStatus = normalizeLower(nativeOrder?.fulfillment_status);
  const customerPaymentStatus = normalizeLower(customerOrder?.payment_status || nativeOrder?.payment_status || nativeOrder?.financial_status);
  const actualDeliveredAtProvided = isIsoDateTime(policy.actualDeliveredAt);
  const mappingBlockers = mapping.mapping_blockers || [];
  const blockers = unique([
    ...commonPolicyBlockers(policy),
    !customerOrder?.id ? 'customer_app_order_not_found' : null,
    !nativeOrder?.id ? 'native_shopify_order_not_found' : null,
    !task?.id ? 'native_fulfillment_task_not_found' : null,
    customerOrder && customerPaymentStatus !== 'paid' ? 'customer_app_order_not_paid' : null,
    customerOrder && customerOrder.payment_captured !== true ? 'customer_app_order_payment_not_captured' : null,
    nativeProductionStatus !== 'bottled' && nativeProductionStatus !== 'fulfilled' ? 'native_shopify_order_not_bottled' : null,
    taskStatus !== 'packed' && taskStatus !== 'delivered' ? 'native_fulfillment_task_not_packed_or_delivered' : null,
    deliveryStatus !== 'pending' && deliveryStatus !== 'delivered' ? 'native_delivery_status_not_pending_or_delivered' : null,
    (batches || []).filter(batch => normalizeLower(batch.status) === 'verified_logged').length < 6 ? 'verified_production_batches_missing' : null,
    (complianceLogs || []).length < 6 ? 'batch_compliance_logs_missing' : null,
    ...mappingBlockers,
  ]);
  const warnings = unique([
    !actualDeliveredAtProvided ? 'delivered_timestamp_required_before_live_reconciliation' : null,
    'customer_status_update_held',
    'notifications_held',
    'proof_drop_held_not_required_for_reconciliation',
    taskStatus !== 'out_for_delivery' && deliveryStatus !== 'out_for_delivery' ? 'out_for_delivery_transition_skipped_for_operationally_delivered_reconciliation' : null,
  ]);
  const alreadyDelivered = taskStatus === 'delivered' && deliveryStatus === 'delivered' && nativeFulfillmentStatus === SHOPIFY_ORDER_FULFILLED_STATUS;
  const proposedTaskChanges = task?.id ? [
    taskStatus !== 'delivered' ? { record: 'Native FulfillmentTask', id: sanitizeId(task.id, 140), field: 'status', from: sanitizeText(task.status, 80) || null, to: DELIVERED_TASK_STATUS } : null,
    deliveryStatus !== 'delivered' ? { record: 'Native FulfillmentTask', id: sanitizeId(task.id, 140), field: 'delivery_status', from: sanitizeText(task.delivery_status, 80) || null, to: DELIVERED_DELIVERY_STATUS } : null,
    !task?.delivered_at ? { record: 'Native FulfillmentTask', id: sanitizeId(task.id, 140), field: 'delivered_at', from: null, to: actualDeliveredAtProvided ? policy.actualDeliveredAt : 'owner_approved_timestamp_required' } : null,
  ].filter(Boolean) : [];
  const proposedNativeOrderChanges = nativeOrder?.id ? [
    nativeFulfillmentStatus !== SHOPIFY_ORDER_FULFILLED_STATUS ? { record: 'Native ShopifyOrder', id: sanitizeId(nativeOrder.id, 140), field: 'fulfillment_status', from: sanitizeText(nativeOrder.fulfillment_status, 80) || null, to: SHOPIFY_ORDER_FULFILLED_STATUS } : null,
  ].filter(Boolean) : [];

  return {
    order_number: sanitizeText(orderNumber, 80),
    target_type: 'native_delivery_reconciliation',
    customer_app_order_present: Boolean(customerOrder?.id),
    native_shopify_order_present: Boolean(nativeOrder?.id),
    native_fulfillment_task_present: Boolean(task?.id),
    hub_order_present: false,
    hub_task_present: false,
    current_customer_order_status: sanitizeText(customerOrder?.status, 80) || null,
    current_native_shopify_order_status: sanitizeText(nativeOrder?.production_status, 80) || null,
    current_native_shopify_fulfillment_status: sanitizeText(nativeOrder?.fulfillment_status, 80) || null,
    current_native_task_status: sanitizeText(task?.status, 80) || null,
    current_native_delivery_status: sanitizeText(task?.delivery_status, 80) || null,
    hub_fulfillment_status: null,
    hub_production_status: null,
    current_records: {
      customer_app_order: safeOrderStatus(customerOrder),
      native_shopify_order: safeNativeOrderStatus(nativeOrder),
      native_fulfillment_task: safeTaskStatus(task),
      production_batch_count: (batches || []).length,
      verified_batch_count: (batches || []).filter(batch => normalizeLower(batch.status) === 'verified_logged').length,
      batch_compliance_log_count: (complianceLogs || []).length,
    },
    operational_reality_classification: alreadyDelivered ? 'fully_complete' : 'needs_exact_delivery_reconciliation',
    reconciliation_needed: !alreadyDelivered,
    delivered_reconciliation_needed: !alreadyDelivered,
    actual_delivered_at_required: !actualDeliveredAtProvided,
    proposed_correction_mode: 'DIRECT_DELIVERED_NO_NOTIFICATION',
    proposed_field_changes: [...proposedTaskChanges, ...proposedNativeOrderChanges],
    records_that_would_be_created: [],
    records_that_would_be_updated: unique([
      proposedTaskChanges.length ? 'Native FulfillmentTask' : null,
      proposedNativeOrderChanges.length ? 'Native ShopifyOrder' : null,
    ]),
    notification_impact: false,
    notification_would_send: false,
    proof_drop_impact: {
      proof_drop_required: false,
      policy: REQUIRED_PROOF_DROP_POLICY,
      would_write_proof_drop_fields: false,
    },
    route_impact: {
      out_for_delivery_transition_proposed: false,
      direct_delivered_reconciliation: true,
      route_proof_drop_mutation: false,
    },
    customer_status_impact: {
      customer_status_update_held: true,
      proposed_customer_status_if_separately_approved: CUSTOMER_ORDER_DELIVERED_STATUS,
      status_history_append_held: true,
      would_update_customer_status_in_this_correction: false,
    },
    blockers,
    warnings,
    next_action: blockers.length > 0
      ? 'hold_for_delivery_reconciliation_blockers'
      : !actualDeliveredAtProvided
        ? 'approve_exact_direct_delivered_reconciliation_with_timestamp'
        : 'approve_exact_direct_delivered_reconciliation_no_notification',
  };
}

function isHubFulfilled(order) {
  return normalizeLower(order?.fulfillment_status || order?.shopify_fulfillment_status).includes('fulfilled') || Boolean(order?.fulfilled_at || order?.delivered_at);
}

function buildHistoricalHubBackfillRow({ spec, hubOrder, hubTasks, customerOrder, nativeOrder, task, policy }) {
  const orderNumber = spec.hubOrderNumber || spec.orderNumber || hubOrderNumber(hubOrder) || TARGET_HUB_ORDER_NUMBER;
  const hubStatus = safeHubOrderStatus(hubOrder);
  const hasSafeMinimum = Boolean(hubOrder && hubStatus?.order_number && hubStatus.customer_email_present && hubStatus.line_item_count > 0 && isHubFulfilled(hubOrder));
  const customerAppBackfillReady = false;
  const nativeTaskBackfillReady = false;
  const blockers = unique([
    ...commonPolicyBlockers(policy),
    !hubOrder ? 'hub_order_not_found' : null,
    hubOrder && !isHubFulfilled(hubOrder) ? 'hub_order_not_fulfilled' : null,
    hubOrder && !hubStatus?.customer_email_present ? 'hub_customer_identity_missing' : null,
    hubOrder && hubStatus?.line_item_count <= 0 ? 'hub_line_items_missing' : null,
    hubOrder && !hubStatus?.assigned_delivery_date ? 'hub_delivery_date_missing' : null,
    !hasSafeMinimum ? 'insufficient_hub_data_for_historical_backfill' : null,
  ]);
  const warnings = unique([
    'notifications_held',
    'proof_drop_held_not_required_for_reconciliation',
    'hub_mutation_not_proposed',
    hubOrder?.audit_fallback_reason ? 'hub_safe_audit_fallback_used' : null,
    'native_delivered_command_not_applicable_without_native_task',
    !hubStatus?.payment_status ? 'hub_payment_status_missing' : null,
    !hubStatus?.customer_name_present ? 'hub_customer_name_not_returned_by_safe_preview' : null,
    hubTasks.length === 0 ? 'hub_fulfillment_task_rows_not_returned' : null,
    !customerAppBackfillReady ? 'customer_app_order_backfill_held_pending_dedicated_contract' : null,
    !nativeTaskBackfillReady ? 'native_fulfillment_task_backfill_held_no_hub_task_rows' : null,
  ]);
  const nativeMirrorPossible = blockers.length === 0;
  return {
    order_number: sanitizeText(orderNumber, 80),
    target_type: 'historical_hub_fulfilled_backfill',
    customer_app_order_present: Boolean(customerOrder?.id),
    native_shopify_order_present: Boolean(nativeOrder?.id),
    native_fulfillment_task_present: Boolean(task?.id),
    hub_order_present: Boolean(hubOrder),
    hub_task_present: hubTasks.length > 0,
    current_customer_order_status: sanitizeText(customerOrder?.status, 80) || null,
    current_native_shopify_order_status: sanitizeText(nativeOrder?.production_status, 80) || null,
    current_native_task_status: sanitizeText(task?.status, 80) || null,
    current_native_delivery_status: sanitizeText(task?.delivery_status, 80) || null,
    hub_fulfillment_status: sanitizeText(hubOrder?.fulfillment_status || hubOrder?.shopify_fulfillment_status, 80) || null,
    hub_production_status: sanitizeText(hubOrder?.production_status || hubOrder?.status, 80) || null,
    hub_context: {
      order: hubStatus,
      task_count: hubTasks.length,
      tasks_present: hubTasks.length > 0,
      email_present_not_printed: hubStatus?.customer_email_present === true,
      customer_name_present: hubStatus?.customer_name_present === true,
    },
    operational_reality_classification: hubOrder && isHubFulfilled(hubOrder) ? 'hub_fulfilled_native_missing' : 'hub_backfill_unconfirmed',
    reconciliation_needed: Boolean(hubOrder && !nativeOrder && !customerOrder),
    proposed_correction_mode: 'HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION',
    proposed_field_changes: [],
    records_that_would_be_created: unique([
      nativeMirrorPossible && !nativeOrder ? 'Native ShopifyOrder historical fulfilled mirror' : null,
      customerAppBackfillReady ? 'Customer App Order historical record' : null,
      nativeTaskBackfillReady ? 'Native FulfillmentTask historical delivered task' : null,
    ]),
    records_that_would_be_updated: [],
    historical_backfill_decision: {
      native_shopify_order_mirror_preview_ready: nativeMirrorPossible && !nativeOrder,
      customer_app_order_backfill_ready: customerAppBackfillReady,
      native_fulfillment_task_backfill_ready: nativeTaskBackfillReady,
      hub_historical_only_option_available: true,
      duplicate_customer_facing_record_risk: !customerAppBackfillReady,
      raw_payload_required_or_allowed: false,
    },
    notification_impact: false,
    notification_would_send: false,
    proof_drop_impact: {
      proof_drop_required: false,
      policy: REQUIRED_PROOF_DROP_POLICY,
      would_write_proof_drop_fields: false,
    },
    route_impact: {
      native_delivery_task_command_applicable: false,
      route_summary_impact: 'none_until_backfill_contract_approved',
    },
    customer_status_impact: {
      customer_status_update_held: true,
      customer_app_order_creation_held: !customerAppBackfillReady,
      status_history_append_held: true,
    },
    blockers,
    warnings,
    next_action: blockers.length > 0
      ? 'hold_historical_backfill_for_hub_data_blockers'
      : 'plan_historical_native_mirror_backfill_or_hold_customer_app_backfill',
  };
}

async function buildRowsForTargets({ base44, targetSpecs, policy, hubOrders }) {
  const hubByNumber = new Map((hubOrders || []).map(order => [normalizeLower(hubOrderNumber(order)), order]).filter(([key]) => Boolean(key)));
  const rows = [];
  for (const spec of targetSpecs) {
    const correctionMode = spec.correctionMode || policy.correctionMode;
    const rowPolicy = { ...policy, correctionMode };
    let customerOrder = await findCustomerOrder(base44, spec);
    let nativeOrder = await findNativeShopifyOrder(base44, customerOrder, spec);
    if (!customerOrder && nativeOrder?.base44_order_id) customerOrder = await findCustomerOrder(base44, { ...spec, customerAppOrderId: nativeOrder.base44_order_id });
    if (!nativeOrder && customerOrder) nativeOrder = await findNativeShopifyOrder(base44, customerOrder, spec);
    const task = await findNativeFulfillmentTask(base44, customerOrder, nativeOrder, spec);
    const orderNumber = spec.orderNumber || normalizeOrderNumber(task?.order_number || nativeOrder?.shopify_order_number || customerOrder?.order_number);
    const batches = await findProductionBatches(base44, { orderNumber, customerOrder, nativeOrder, task });
    const complianceLogs = await complianceLogsForBatches(base44, batches);
    let hubOrder = hubByNumber.get(normalizeLower(spec.hubOrderNumber || spec.orderNumber || orderNumber)) || null;
    const hubLookupNumber = spec.hubOrderNumber || spec.orderNumber || orderNumber;
    const hubTasksResult = correctionMode === 'HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION'
      ? await fetchHubTasksForOrder(hubLookupNumber)
      : { tasks: [] };
    if (!hubOrder && correctionMode === 'HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION') {
      hubOrder = auditedHubFallbackOrder(hubLookupNumber);
    }
    if (correctionMode === 'HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION') {
      rows.push(buildHistoricalHubBackfillRow({ spec: { ...spec, orderNumber }, hubOrder, hubTasks: hubTasksResult.tasks || [], customerOrder, nativeOrder, task, policy: rowPolicy }));
    } else if (correctionMode === 'DIRECT_DELIVERED_NO_NOTIFICATION') {
      rows.push(buildNativeDeliveredRow({ spec: { ...spec, orderNumber }, customerOrder, nativeOrder, task, batches, complianceLogs, policy: rowPolicy, mapping: statusMappingAudit() }));
    } else {
      rows.push({
        order_number: sanitizeText(spec.orderNumber || spec.hubOrderNumber || 'unknown', 80),
        target_type: correctionMode === 'STATUS_ONLY_NO_NOTIFICATION' ? 'status_only_reconciliation' : 'hub_fallback_only',
        customer_app_order_present: Boolean(customerOrder?.id),
        native_shopify_order_present: Boolean(nativeOrder?.id),
        native_fulfillment_task_present: Boolean(task?.id),
        hub_order_present: Boolean(hubOrder),
        hub_task_present: false,
        operational_reality_classification: 'not_implemented_for_g32h',
        reconciliation_needed: false,
        proposed_correction_mode: correctionMode,
        proposed_field_changes: [],
        records_that_would_be_created: [],
        records_that_would_be_updated: [],
        notification_impact: false,
        proof_drop_impact: { proof_drop_required: false, policy: REQUIRED_PROOF_DROP_POLICY },
        route_impact: {},
        customer_status_impact: { customer_status_update_held: true },
        blockers: commonPolicyBlockers(rowPolicy),
        warnings: ['mode_previewed_for_policy_only_in_g32h'],
        next_action: 'hold_for_dedicated_status_or_hub_fallback_contract',
      });
    }
  }
  return rows;
}

function buildResponse({ rows, targetSpecs, policy, hubFetchResult, auth }) {
  const blockers = unique(rows.flatMap(row => row.blockers || []));
  const warnings = unique([
    ...rows.flatMap(row => row.warnings || []),
    hubFetchResult?.ok === false ? hubFetchResult.error_code : null,
  ]);
  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    safety: READ_ONLY_SAFETY,
    function_name: FUNCTION_NAME,
    generated_at: new Date().toISOString(),
    actor_type: auth?.actor_type || 'admin',
    correction_mode: policy.correctionMode,
    notification_policy: policy.notificationPolicy,
    proof_drop_policy: policy.proofDropPolicy,
    targets: targetSpecs.map(spec => ({
      order_number: sanitizeText(spec.orderNumber, 80) || null,
      hub_order_number: sanitizeText(spec.hubOrderNumber, 80) || null,
      customer_app_order_id: sanitizeId(spec.customerAppOrderId, 140) || null,
      native_shopify_order_id: sanitizeId(spec.nativeShopifyOrderId, 140) || null,
      native_fulfillment_task_id: sanitizeId(spec.nativeFulfillmentTaskId, 140) || null,
      correction_mode: sanitizeText(spec.correctionMode || policy.correctionMode, 80) || null,
    })),
    status_mapping_audit: statusMappingAudit(),
    hub_fetch_context: {
      attempted: true,
      success: hubFetchResult?.ok === true,
      status: hubFetchResult?.status || null,
      order_count: Array.isArray(hubFetchResult?.orders) ? hubFetchResult.orders.length : 0,
    },
    preview_rows: rows,
    blockers,
    warnings,
    next_action: blockers.length > 0
      ? 'hold_for_delivery_completion_reconciliation_blockers'
      : rows.some(row => row.next_action === 'approve_exact_direct_delivered_reconciliation_with_timestamp')
        ? 'approve_exact_direct_delivered_reconciliation_with_timestamp'
        : 'plan_delivery_completion_reconciliation_commands',
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
    if (body.mode && body.mode !== 'dry_run') return Response.json({ success: false, error_code: 'dry_run_only', writes_performed: false }, { status: 400 });
    const badKey = unsupportedBodyKey(body);
    if (badKey) return Response.json({ success: false, error_code: 'unsupported_request_field', field: sanitizeText(badKey, 80), writes_performed: false }, { status: 400 });

    const lookup = lookupFromBody(body);
    const policy = {
      correctionMode: lookup.correctionMode || 'DIRECT_DELIVERED_NO_NOTIFICATION',
      notificationPolicy: lookup.notificationPolicy,
      proofDropPolicy: lookup.proofDropPolicy,
      actualDeliveredAt: lookup.actualDeliveredAt,
      requestId: lookup.requestId,
    };
    if (!policy.notificationPolicy || !policy.proofDropPolicy) {
      return Response.json({ success: false, error_code: 'policy_required', writes_performed: false }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const auth = await requirePreviewAccess({ base44, req, body });
    if (!auth.ok) return auth.response;

    const targetSpecs = targetSpecsFromBody(body).map(spec => ({
      ...spec,
      correctionMode: spec.correctionMode || ((spec.hubOrderNumber === TARGET_HUB_ORDER_NUMBER || spec.orderNumber === TARGET_HUB_ORDER_NUMBER) ? 'HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION' : policy.correctionMode),
    }));
    const hubFetchResult = await fetchHubOrders({ since: DEFAULT_HUB_SINCE });
    const rows = await buildRowsForTargets({ base44, targetSpecs, policy, hubOrders: hubFetchResult.orders || [] });
    return Response.json(buildResponse({ rows, targetSpecs, policy, hubFetchResult, auth }));
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] failed safely: ${error?.message || 'unknown error'}`);
    return Response.json({ success: false, error_code: 'native_delivery_completion_reconciliation_preview_failed', message: 'Delivery completion reconciliation preview failed safely.', writes_performed: false }, { status: 500 });
  }
});

export {
  READ_ONLY_SAFETY,
  statusMappingAudit,
  buildNativeDeliveredRow,
  buildHistoricalHubBackfillRow,
  buildResponse,
  targetSpecsFromBody,
  lookupFromBody,
  commonPolicyBlockers,
  safeHubOrderStatus,
  auditedHubFallbackOrder,
  DELIVERED_TASK_STATUS,
  DELIVERED_DELIVERY_STATUS,
  SHOPIFY_ORDER_FULFILLED_STATUS,
  CUSTOMER_ORDER_DELIVERED_STATUS,
};
