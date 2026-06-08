import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const FUNCTION_NAME = 'previewNativeDeliveryWorkflowReadiness';
const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const TARGET_ORDER_NUMBER = 'NV-MPZNKGNT';
const TARGET_STALE_HUB_DELIVERY_DATE = '2026-06-06';
const DEFAULT_DELIVERY_DATE = '2026-06-08';
const DEFAULT_PRODUCTION_BATCH_DATE = '2026-06-05';
const DEFAULT_MAX_ROWS = 80;

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
  'delivery_date',
  'production_date',
  'request_id',
  '_internal_secret',
  'internal_secret',
]);

const TERMINAL_CUSTOMER_STATUSES = new Set(['cancelled', 'canceled', 'refunded', 'delivered', 'picked_up']);
const TERMINAL_TASK_STATUSES = new Set(['cancelled', 'canceled', 'delivered', 'unable_to_deliver']);
const CANCELLED_REFUNDED_ORDER_STATUSES = new Set(['cancelled', 'canceled', 'refunded', 'voided']);

const READ_ONLY_SAFETY = Object.freeze({
  dry_run_only: true,
  writes_performed: false,
  customer_app_order_updated: false,
  status_history_appended: false,
  native_shopify_order_updated: false,
  native_fulfillment_task_updated: false,
  production_batch_updated: false,
  batch_compliance_log_updated: false,
  notifications_created: false,
  notifications_sent: false,
  delivery_status_updated: false,
  fulfillment_task_status_updated: false,
  delivery_route_proof_drop_mutated: false,
  hub_records_updated: false,
  hub_repair_replay_performed: false,
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

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function isoDate(value) {
  const text = normalizeText(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizeText(value));
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
  const rawDeliveryDate = normalizeText(body?.delivery_date);
  const rawProductionDate = normalizeText(body?.production_date);
  return {
    orderNumber: normalizeText(body?.order_number || body?.shopify_order_number).replace(/^#/, ''),
    customerAppOrderId: sanitizeId(body?.customer_app_order_id || body?.base44_order_id || body?.order_id, 120),
    nativeShopifyOrderId: sanitizeId(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id, 120),
    nativeFulfillmentTaskId: sanitizeId(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id, 120),
    deliveryDate: isIsoDate(rawDeliveryDate) ? rawDeliveryDate : '',
    productionDate: isIsoDate(rawProductionDate) ? rawProductionDate : '',
    deliveryDateInvalid: Boolean(rawDeliveryDate && !isIsoDate(rawDeliveryDate)),
    productionDateInvalid: Boolean(rawProductionDate && !isIsoDate(rawProductionDate)),
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
  const orderNumber = lookup.orderNumber || normalizeText(nativeOrder?.shopify_order_number || nativeOrder?.order_number || customerOrder?.order_number).replace(/^#/, '');
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

function safeDeliveryRow(row, sourceOverride = '') {
  if (!row) return null;
  return {
    task_id: sanitizeId(row.task_id || row.id || row.fulfillment_task_id, 160) || null,
    order_number: sanitizeText(row.order_number || row.shopify_order_number, 80) || null,
    source_type: sanitizeText(row.source_type || row.source_channel, 80) || null,
    task_status: sanitizeText(row.task_status || row.status, 80) || null,
    delivery_status: sanitizeText(row.delivery_status, 80) || null,
    fulfillment_status: sanitizeText(row.fulfillment_status, 80) || null,
    production_status: sanitizeText(row.production_status, 80) || null,
    delivery_date: isoDate(row.delivery_date || row.scheduled_date || row.assigned_delivery_date) || null,
    scheduled_date: isoDate(row.scheduled_date) || null,
    assigned_delivery_date: isoDate(row.assigned_delivery_date) || null,
    production_date: isoDate(row.production_date) || null,
    delivery_window_label: sanitizeText(row.delivery_window_label || row.time_window, 120) || null,
    packed_at: sanitizeText(row.packed_at, 80) || null,
    data_source: sourceOverride || sanitizeText(row.data_source, 80) || null,
  };
}

function safeNativeDeliveryRow({ task, customerOrder, nativeOrder }) {
  if (!task) return null;
  return safeDeliveryRow({
    id: task.id,
    order_number: task.order_number || nativeOrder?.shopify_order_number || customerOrder?.order_number,
    source_type: task.source_type || nativeOrder?.source_type || nativeOrder?.source_channel || 'customer_app_native',
    status: task.status,
    delivery_status: task.delivery_status,
    fulfillment_status: nativeOrder?.fulfillment_status,
    production_status: task.production_status,
    delivery_date: task.delivery_date || task.scheduled_date || task.assigned_delivery_date,
    scheduled_date: task.scheduled_date,
    assigned_delivery_date: task.assigned_delivery_date,
    production_date: task.production_date,
    delivery_window_label: task.delivery_window_label || task.time_window || customerOrder?.delivery_window_label || nativeOrder?.delivery_window_label,
    packed_at: task.packed_at,
  }, 'customer_app_native_task');
}

function safeHubRow(stop) {
  return safeDeliveryRow({ ...stop, delivery_date: stop?.delivery_date }, 'hub');
}

async function fetchHubRouteSummary(deliveryDate) {
  if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET || !deliveryDate) {
    return { ok: false, warning: 'hub_delivery_queue_service_not_configured', delivery_date: deliveryDate, rows: [] };
  }
  const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
  const params = new URLSearchParams({ delivery_date: deliveryDate, limit: '100' });
  try {
    const response = await fetch(`${hubBase}/functions/getDeliveryRouteSummaryForCustomerApp?${params.toString()}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}` },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.sections) {
      return { ok: false, warning: `hub_delivery_queue_unavailable:${response.status}`, delivery_date: deliveryDate, rows: [] };
    }
    const rows = [...(data.sections.delivery_stops || []), ...(data.sections.completed || []), ...(data.sections.unscheduled_delivery_orders || [])]
      .map(safeHubRow)
      .filter(Boolean);
    return { ok: true, warning: null, delivery_date: data.delivery_date || deliveryDate, rows };
  } catch {
    return { ok: false, warning: 'hub_delivery_queue_unavailable:fetch_failed', delivery_date: deliveryDate, rows: [] };
  }
}

function normalizeOrderKey(value) {
  return normalizeLower(value).replace(/^#/, '');
}

function rowOrderKey(row) {
  return normalizeOrderKey(row?.order_number);
}

function reconcileNativeAndHubRows({ nativeRow, hubRows, deliveryDate }) {
  const targetKey = rowOrderKey(nativeRow);
  const matchingHubRows = (hubRows || []).filter(row => rowOrderKey(row) && rowOrderKey(row) === targetKey);
  const staleRows = matchingHubRows.filter(row => row.delivery_date && nativeRow?.delivery_date && row.delivery_date !== nativeRow.delivery_date);
  const duplicateRows = matchingHubRows.filter(row => !row.delivery_date || !nativeRow?.delivery_date || row.delivery_date === nativeRow.delivery_date);
  const staleDetected = staleRows.length > 0;
  const nativeOnRequestedDate = Boolean(nativeRow?.delivery_date && nativeRow.delivery_date === deliveryDate);
  return {
    route_summary_merge_status: staleDetected
      ? 'native_schedule_active_hub_fallback_stale_date_detected'
      : duplicateRows.length > 0
        ? 'native_schedule_preferred_hub_duplicate_detected'
        : 'native_schedule_active_no_hub_duplicate',
    stale_hub_fallback_detected: staleDetected,
    native_schedule_active: nativeOnRequestedDate,
    native_preferred: Boolean(nativeRow),
    hub_task_present: matchingHubRows.length > 0,
    hub_fallback_rows: matchingHubRows,
    stale_hub_fallback_rows: staleRows,
    duplicate_hub_rows: duplicateRows,
    warnings: unique([
      staleDetected ? 'hub_fallback_stale_date_detected' : null,
      staleDetected ? 'native_schedule_active_hub_stale_date_suppressed_from_active_route' : null,
      duplicateRows.length > 0 ? 'native_schedule_preferred_over_hub_duplicate' : null,
      matchingHubRows.length === 0 ? 'hub_fallback_row_not_found_for_target' : null,
    ]),
  };
}

function buildOutForDeliveryPreview({ customerOrder, nativeOrder, task, nativeRow, batches, complianceLogs, reconciliation, deliveryDate }) {
  const blockers = [];
  const customerStatus = normalizeLower(customerOrder?.status);
  const taskStatus = normalizeLower(task?.status);
  const deliveryStatus = normalizeLower(task?.delivery_status);
  const nativeProductionStatus = normalizeLower(nativeOrder?.production_status);
  const nativeFulfillmentStatus = normalizeLower(nativeOrder?.fulfillment_status);
  const orderPaymentStatus = normalizeLower(customerOrder?.payment_status || nativeOrder?.payment_status || nativeOrder?.financial_status);

  if (!customerOrder?.id) blockers.push('customer_app_order_not_found');
  if (!nativeOrder?.id) blockers.push('native_shopify_order_not_found');
  if (!task?.id) blockers.push('native_fulfillment_task_not_found');
  if (customerOrder && orderPaymentStatus !== 'paid') blockers.push('customer_app_order_not_paid');
  if (customerOrder && customerOrder.payment_captured !== true) blockers.push('customer_app_order_payment_not_captured');
  if (nativeProductionStatus !== 'bottled') blockers.push('native_shopify_order_not_bottled');
  if (nativeFulfillmentStatus && CANCELLED_REFUNDED_ORDER_STATUSES.has(nativeFulfillmentStatus)) blockers.push('native_shopify_order_cancelled_or_refunded');
  if (TERMINAL_CUSTOMER_STATUSES.has(customerStatus)) blockers.push('customer_order_terminal');
  if (TERMINAL_TASK_STATUSES.has(taskStatus) || TERMINAL_TASK_STATUSES.has(deliveryStatus)) blockers.push('fulfillment_task_terminal');
  if (taskStatus !== 'packed') blockers.push('native_fulfillment_task_not_packed');
  if (deliveryStatus !== 'pending') blockers.push('delivery_status_not_pending');
  if (!nativeRow?.delivery_date || nativeRow.delivery_date !== deliveryDate) blockers.push('native_task_not_on_requested_delivery_date');
  if ((batches || []).filter(batch => normalizeLower(batch.status) === 'verified_logged').length < 6) blockers.push('verified_production_batches_missing');
  if ((complianceLogs || []).length < 6) blockers.push('batch_compliance_logs_missing');

  return {
    out_for_delivery_ready: blockers.length === 0,
    out_for_delivery_held: true,
    command_available: blockers.length === 0,
    command_gated: true,
    exact_approval_required: true,
    current_task_status: sanitizeText(task?.status, 80) || null,
    current_delivery_status: sanitizeText(task?.delivery_status, 80) || null,
    current_production_status: sanitizeText(task?.production_status, 80) || null,
    proposed_task_status: 'out_for_delivery',
    proposed_delivery_status: 'out_for_delivery',
    would_update_native_fulfillment_task: blockers.length === 0,
    would_touch_customer_app_order: false,
    would_send_notification: false,
    notification_held: true,
    route_required_now: false,
    proof_drop_required_now: false,
    stale_hub_fallback_blocks: false,
    stale_hub_fallback_detected: reconciliation.stale_hub_fallback_detected,
    blockers,
    warnings: unique([
      'out_for_delivery_command_requires_separate_approval',
      'notifications_held',
      'customer_status_held',
      reconciliation.stale_hub_fallback_detected ? 'hub_fallback_stale_date_detected_but_not_blocking_native_out_for_delivery_preview' : null,
    ]),
  };
}

function buildDeliveredPreview({ task }) {
  const taskStatus = normalizeLower(task?.status);
  const deliveryStatus = normalizeLower(task?.delivery_status);
  return {
    delivered_ready: false,
    delivered_held: true,
    current_task_status: sanitizeText(task?.status, 80) || null,
    current_delivery_status: sanitizeText(task?.delivery_status, 80) || null,
    requires_out_for_delivery_first: !(taskStatus === 'out_for_delivery' || deliveryStatus === 'out_for_delivery'),
    proof_drop_policy_required: true,
    route_completion_policy_required: true,
    customer_status_approval_required: true,
    notification_policy_required: true,
    would_touch_customer_app_order: false,
    would_send_notification: false,
    would_update_delivery_status: false,
    blockers: unique([
      !(taskStatus === 'out_for_delivery' || deliveryStatus === 'out_for_delivery') ? 'task_not_out_for_delivery' : null,
      'proof_drop_policy_not_defined',
      'route_completion_policy_not_defined',
      'customer_status_update_not_approved',
      'notification_policy_not_approved',
    ]),
    warnings: ['delivered_command_requires_separate_policy_and_approval'],
  };
}

function buildCustomerStatusImpactPreview(customerOrder) {
  return {
    would_touch_customer_app_order: false,
    current_customer_order_status: sanitizeText(customerOrder?.status, 80) || null,
    customer_facing_status_changes_held: true,
    status_history_append_held: true,
    delivered_status_held: true,
    out_for_delivery_status_held: true,
    expected_customer_status_after_this_phase: 'unchanged',
    blockers: [],
    warnings: ['customer_facing_status_requires_separate_approval'],
  };
}

function buildNotificationImpactPreview() {
  return {
    would_send_notification: false,
    notification_held: true,
    notification_channels_held: ['in_app', 'push', 'sms', 'email'],
    notification_types_held: ['out_for_delivery', 'delivered', 'delivery_reminder'],
    non_confirmation_notifications_disabled_until_separate_approval: true,
    blockers: [],
    warnings: ['notifications_require_separate_approval'],
  };
}

function buildPreview({ customerOrder, nativeOrder, task, batches, complianceLogs, hubRowsByDate, lookup, auth }) {
  const orderNumber = lookup.orderNumber || normalizeText(task?.order_number || nativeOrder?.shopify_order_number || nativeOrder?.order_number || customerOrder?.order_number).replace(/^#/, '');
  const deliveryDate = lookup.deliveryDate || isoDate(task?.delivery_date || task?.scheduled_date || customerOrder?.assigned_delivery_date || nativeOrder?.assigned_delivery_date) || DEFAULT_DELIVERY_DATE;
  const nativeRow = safeNativeDeliveryRow({ task, customerOrder, nativeOrder });
  const hubRows = Object.values(hubRowsByDate || {}).flatMap(result => result.rows || []);
  const reconciliation = reconcileNativeAndHubRows({ nativeRow, hubRows, deliveryDate });
  const outForDeliveryPreview = buildOutForDeliveryPreview({ customerOrder, nativeOrder, task, nativeRow, batches, complianceLogs, reconciliation, deliveryDate });
  const deliveredPreview = buildDeliveredPreview({ task });
  const customerStatusImpact = buildCustomerStatusImpactPreview(customerOrder);
  const notificationImpact = buildNotificationImpactPreview();
  const blockers = unique([
    !customerOrder?.id ? 'customer_app_order_not_found' : null,
    !nativeOrder?.id ? 'native_shopify_order_not_found' : null,
    !task?.id ? 'native_fulfillment_task_not_found' : null,
    lookup.deliveryDateInvalid ? 'delivery_date_invalid' : null,
    lookup.productionDateInvalid ? 'production_date_invalid' : null,
  ]);
  const warnings = unique([
    ...reconciliation.warnings,
    'customer_status_held',
    'notifications_held',
    'delivered_preview_held_pending_proof_drop_route_policy',
    'hub_fallback_required',
  ]);

  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    safety: READ_ONLY_SAFETY,
    function_name: FUNCTION_NAME,
    generated_at: new Date().toISOString(),
    actor_type: auth?.actor_type || 'admin',
    order_number: sanitizeText(orderNumber || TARGET_ORDER_NUMBER, 80),
    delivery_date: deliveryDate,
    production_date: lookup.productionDate || isoDate(task?.production_date || nativeOrder?.production_date || DEFAULT_PRODUCTION_BATCH_DATE) || null,
    customer_app_order_present: Boolean(customerOrder?.id),
    native_shopify_order_present: Boolean(nativeOrder?.id),
    native_fulfillment_task_present: Boolean(task?.id),
    production_batch_count: (batches || []).length,
    verified_batch_count: (batches || []).filter(batch => normalizeLower(batch.status) === 'verified_logged').length,
    compliance_log_count: (complianceLogs || []).length,
    native_task_present: Boolean(task?.id),
    hub_task_present: reconciliation.hub_task_present,
    route_summary_merge_status: reconciliation.route_summary_merge_status,
    stale_hub_fallback_detected: reconciliation.stale_hub_fallback_detected,
    native_schedule_active: reconciliation.native_schedule_active,
    native_delivery_row: nativeRow,
    hub_fallback_row: reconciliation.hub_fallback_rows[0] || null,
    stale_hub_fallback_rows: reconciliation.stale_hub_fallback_rows,
    route_summary_reconciliation: {
      merge_status: reconciliation.route_summary_merge_status,
      native_preferred: reconciliation.native_preferred,
      stale_hub_fallback_detected: reconciliation.stale_hub_fallback_detected,
      stale_hub_fallback_count: reconciliation.stale_hub_fallback_rows.length,
      hub_match_count: reconciliation.hub_fallback_rows.length,
      native_delivery_date: nativeRow?.delivery_date || null,
      hub_delivery_dates: unique(reconciliation.hub_fallback_rows.map(row => row.delivery_date)),
      recommendation: reconciliation.stale_hub_fallback_detected
        ? 'prefer_native_corrected_schedule_and_label_hub_fallback_stale_date'
        : 'native_delivery_schedule_can_drive_delivery_workflow_preview',
    },
    out_for_delivery_preview: outForDeliveryPreview,
    out_for_delivery_ready: outForDeliveryPreview.out_for_delivery_ready,
    out_for_delivery_held: outForDeliveryPreview.out_for_delivery_held,
    delivered_preview: deliveredPreview,
    delivered_ready: deliveredPreview.delivered_ready,
    delivered_held: deliveredPreview.delivered_held,
    customer_status_impact_preview: customerStatusImpact,
    notification_impact_preview: notificationImpact,
    customer_status_held: true,
    notifications_held: true,
    blockers,
    warnings,
    next_action: blockers.length > 0
      ? 'hold_for_delivery_workflow_preview_blockers'
      : outForDeliveryPreview.out_for_delivery_ready
        ? 'plan_gated_native_out_for_delivery_command'
        : 'hold_for_delivery_workflow_policy_or_state',
    hub_fallback_required: true,
  };
}

async function loadHubRowsForPreview({ deliveryDate, task }) {
  const dates = unique([
    deliveryDate,
    isoDate(task?.delivery_date),
    isoDate(task?.scheduled_date),
    isoDate(task?.assigned_delivery_date),
    TARGET_STALE_HUB_DELIVERY_DATE,
  ]).filter(Boolean);
  const entries = await Promise.all(dates.map(async date => [date, await fetchHubRouteSummary(date)]));
  return Object.fromEntries(entries);
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
    if (lookup.deliveryDateInvalid || lookup.productionDateInvalid) {
      return Response.json({ success: false, error_code: 'invalid_date_input', writes_performed: false }, { status: 400 });
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
    const orderNumber = lookup.orderNumber || normalizeText(task?.order_number || nativeOrder?.shopify_order_number || customerOrder?.order_number).replace(/^#/, '');
    const batches = await findProductionBatches(base44, { orderNumber, customerOrder, nativeOrder, task });
    const complianceLogs = await complianceLogsForBatches(base44, batches);
    const deliveryDate = lookup.deliveryDate || isoDate(task?.delivery_date || task?.scheduled_date || customerOrder?.assigned_delivery_date || nativeOrder?.assigned_delivery_date) || DEFAULT_DELIVERY_DATE;
    const hubRowsByDate = await loadHubRowsForPreview({ deliveryDate, task });

    return Response.json(buildPreview({ customerOrder, nativeOrder, task, batches, complianceLogs, hubRowsByDate, lookup: { ...lookup, orderNumber, deliveryDate }, auth }));
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] failed safely: ${error?.message || 'unknown error'}`);
    return Response.json({ success: false, error_code: 'native_delivery_workflow_readiness_preview_failed', message: 'Native delivery workflow readiness preview failed safely.', writes_performed: false }, { status: 500 });
  }
});

export {
  buildPreview,
  buildOutForDeliveryPreview,
  buildDeliveredPreview,
  reconcileNativeAndHubRows,
  safeNativeDeliveryRow,
  safeHubRow,
  getLookup,
  READ_ONLY_SAFETY,
};
