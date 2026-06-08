import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const COMMAND_TYPE = 'native_shopify_order_bottle';
const FUNCTION_NAME = 'bottleNativeProductionShopifyOrderForCustomerApp';
const ENABLE_FLAG = 'ENABLE_NATIVE_SHOPIFY_ORDER_BOTTLE';
const KILL_SWITCH_FLAG = 'NATIVE_SHOPIFY_ORDER_BOTTLE_KILL_SWITCH';
const ALLOWED_EMAILS_FLAG = 'NATIVE_SHOPIFY_ORDER_BOTTLE_ALLOWED_EMAILS';
const ORDER_ALLOWLIST_FLAG = 'NATIVE_SHOPIFY_ORDER_BOTTLE_ORDER_ALLOWLIST';
const SHOPIFY_ORDER_ALLOWLIST_FLAG = 'NATIVE_SHOPIFY_ORDER_BOTTLE_SHOPIFY_ORDER_ALLOWLIST';
const POLICY_FLAG = 'NATIVE_SHOPIFY_ORDER_BOTTLE_POLICY';
const REQUIRED_POLICY = 'EXACT_VERIFIED_PACKED_ONE_TIME_ORDER_ONLY';
const CONFIRMATION_PHRASE = 'bottle_native_shopify_order_for_customer_app';
const G31Z_MARKER = 'g31z_gated_native_shopify_order_bottle_command';
const TARGET_ORDER_NUMBER = 'NV-MPZNKGNT';
const TARGET_CUSTOMER_APP_ORDER_ID = '6a219a3f4adcda5856c3d579';
const TARGET_NATIVE_SHOPIFY_ORDER_ID = '6a22ffda400eb806eb3ca945';
const TARGET_NATIVE_FULFILLMENT_TASK_ID = '6a22ffdaf675ea79e30575aa';
const TARGET_PRODUCTION_DATE = '2026-06-05';
const TARGET_DELIVERY_DATE = '2026-06-06';
const TARGET_PRODUCTION_STATUS = 'bottled';
const MAX_TEXT = 180;
const MAX_ROWS = 60;

const EXPECTED_BATCH_PRODUCTS = Object.freeze({
  'NATIVE-NV-MPZNKGNT-2026-06-05-AURA': 'Aura',
  'NATIVE-NV-MPZNKGNT-2026-06-05-OASIS': 'Oasis',
  'NATIVE-NV-MPZNKGNT-2026-06-05-PINEAPPLE-JUICE': 'Pineapple Juice',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RADIANCE-SHOT': 'Radiance Shot',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RE-NU': 'Re-Nu',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RESET-SHOT': 'Reset Shot',
});
const EXPECTED_BATCH_IDS = Object.freeze(Object.keys(EXPECTED_BATCH_PRODUCTS).sort());
const EXPECTED_PRODUCTS = Object.freeze(Object.values(EXPECTED_BATCH_PRODUCTS).sort());

const TASK_PACKED_STATUSES = new Set(['packed', 'bottled_packed']);
const TASK_PACKED_PRODUCTION_STATUSES = new Set(['packed', 'bottled_packed']);
const TERMINAL_TASK_STATUSES = new Set(['delivered', 'unable_to_deliver', 'cancelled', 'canceled', 'out_for_delivery']);
const TERMINAL_DELIVERY_STATUSES = new Set(['out_for_delivery', 'delivered', 'unable_to_deliver', 'cancelled', 'canceled']);
const BOTTLE_ELIGIBLE_ORDER_STATUSES = new Set(['new', 'awaiting_production', 'in_production']);
const ALREADY_BOTTLED_ORDER_STATUSES = new Set(['bottled']);
const AFTER_BOTTLE_ORDER_STATUSES = new Set(['labeled', 'qc_checked', 'packed', 'in_cold_storage', 'assigned_for_pickup', 'assigned_for_delivery', 'fulfilled']);

const ALLOWED_BODY_KEYS = new Set([
  'mode',
  'confirmation',
  'order_number',
  'shopify_order_number',
  'customer_app_order_id',
  'base44_order_id',
  'native_shopify_order_id',
  'native_order_id',
  'shopify_order_id',
  'native_fulfillment_task_id',
  'fulfillment_task_id',
  'task_id',
  'production_date',
  'expected_production_date',
  'expected_delivery_date',
  'expected_production_status',
  'expected_preview_hash',
  'request_id',
]);

const FORBIDDEN_BODY_KEYS = new Set([
  'rows',
  'custom_rows',
  'raw_payload',
  'payload',
  'raw_body',
  'raw_order',
  'order',
  'raw_task',
  'task',
  'raw_provider_payload',
  'raw_payment_payload',
  'customer_app_order_update',
  'order_update',
  'status_history',
  'native_fulfillment_task_update',
  'fulfillment_task_update',
  'task_update',
  'production_batch_update',
  'batch_update',
  'batch_ids',
  'production_batch_ids',
  'compliance',
  'compliance_log',
  'batch_compliance_log',
  'inventory_deduction',
  'deduct_inventory',
  'inventory_update',
  'purchase_order',
  'create_purchase_order',
  'pack_task',
  'task_pack',
  'delivery_status',
  'fulfillment_status',
  'production_status',
  'status_override',
  'customer_status',
  'delivered_at',
  'proof',
  'proof_url',
  'proof_file',
  'proof_photo_url',
  'photo',
  'drop',
  'drop_location',
  'route',
  'route_id',
  'route_stop_sequence',
  'send_notification',
  'notify_customer',
  'notification',
  'sync',
  'repair',
  'replay',
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
  'bulk_task_ids',
  'bulk_order_ids',
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

function safeActorEmail(value) {
  const email = normalizeSingleLine(value).toLowerCase();
  return email && email.length <= 180 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function roundQuantity(value, decimals = 3) {
  const numberValue = safeNumber(value);
  if (numberValue === null) return null;
  const factor = 10 ** decimals;
  return Math.round(numberValue * factor) / factor;
}

function parseCsvSet(value) {
  return new Set(normalizeText(value).split(',').map(normalizeLower).filter(Boolean));
}

function uniqueStrings(values, limit = MAX_ROWS) {
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
    const normalized = normalizeLower(key);
    if (ALLOWED_BODY_KEYS.has(normalized)) continue;
    if (FORBIDDEN_BODY_KEYS.has(normalized)) return key;
    if (/(^|_)(custom|raw|payload|provider|stripe|shopify|inventory|purchase|notification|sync|repair|replay|bulk|status|task|order|batch|recipe|route|proof|delivery|drop|compliance|customer)($|_)/i.test(normalized)) {
      return key;
    }
    return key;
  }
  return null;
}

function expectedPreviewSecret() {
  return normalizeText(Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET')) ||
    normalizeText(Deno.env.get('CUSTOMER_APP_SYNC_SECRET')) ||
    normalizeText(Deno.env.get('HUB_SYNC_SECRET'));
}

function shouldUseServicePreview() {
  return Deno.env.get('NATIVE_SHOPIFY_ORDER_BOTTLE_USE_SERVICE_PREVIEW') === 'true';
}

function previewFailureCode(status) {
  return status === 408 || status === 504
    ? 'native_shopify_order_bottle_preview_timeout'
    : 'native_shopify_order_bottle_preview_failed';
}

function getLookup(body) {
  return {
    orderNumber: normalizeText(body?.order_number || body?.shopify_order_number).replace(/^#/, ''),
    customerAppOrderId: safeId(body?.customer_app_order_id || body?.base44_order_id, 120),
    nativeShopifyOrderId: safeId(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id, 120),
    nativeFulfillmentTaskId: safeId(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id, 120),
    productionDate: normalizeText(body?.production_date || body?.expected_production_date),
    expectedDeliveryDate: normalizeText(body?.expected_delivery_date),
    expectedProductionStatus: normalizeLower(body?.expected_production_status || TARGET_PRODUCTION_STATUS),
    expectedPreviewHash: safeId(body?.expected_preview_hash, 180),
    requestId: safeId(body?.request_id, 160),
  };
}

function exactTargetBlockers(lookup) {
  const blockers = [];
  if (lookup.orderNumber !== TARGET_ORDER_NUMBER) blockers.push('target_order_number_mismatch');
  if (lookup.productionDate !== TARGET_PRODUCTION_DATE) blockers.push('target_production_date_mismatch');
  if (lookup.expectedDeliveryDate && lookup.expectedDeliveryDate !== TARGET_DELIVERY_DATE) blockers.push('expected_delivery_date_mismatch');
  if (lookup.expectedProductionStatus && lookup.expectedProductionStatus !== TARGET_PRODUCTION_STATUS) blockers.push('expected_production_status_must_be_bottled');
  if (lookup.customerAppOrderId && lookup.customerAppOrderId !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('target_customer_app_order_id_mismatch');
  if (lookup.nativeShopifyOrderId !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('target_native_shopify_order_id_required');
  if (lookup.nativeFulfillmentTaskId !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('target_native_fulfillment_task_id_required');
  return blockers;
}

function gateFailure({ actorEmail, lookup }) {
  if (Deno.env.get(KILL_SWITCH_FLAG) === 'true') return 'kill_switch_active';
  if (Deno.env.get(ENABLE_FLAG) !== 'true') return 'native_shopify_order_bottle_disabled';
  if (normalizeText(Deno.env.get(POLICY_FLAG)) !== REQUIRED_POLICY) return 'exact_verified_packed_one_time_order_policy_required';

  const allowedEmails = parseCsvSet(Deno.env.get(ALLOWED_EMAILS_FLAG) || '');
  if (allowedEmails.size === 0) return 'allowed_email_gate_required';
  if (!allowedEmails.has(normalizeLower(actorEmail))) return 'actor_email_not_allowlisted';

  const orderAllowlist = parseCsvSet(Deno.env.get(ORDER_ALLOWLIST_FLAG) || '');
  if (orderAllowlist.size === 0) return 'order_allowlist_required';
  const orderCandidates = [
    lookup.orderNumber,
    lookup.customerAppOrderId,
    lookup.nativeShopifyOrderId,
    lookup.nativeFulfillmentTaskId,
    TARGET_CUSTOMER_APP_ORDER_ID,
    TARGET_NATIVE_SHOPIFY_ORDER_ID,
    TARGET_NATIVE_FULFILLMENT_TASK_ID,
  ].map(normalizeLower).filter(Boolean);
  if (!orderCandidates.some(candidate => orderAllowlist.has(candidate))) return 'order_not_allowlisted';

  const shopifyOrderAllowlist = parseCsvSet(Deno.env.get(SHOPIFY_ORDER_ALLOWLIST_FLAG) || '');
  if (shopifyOrderAllowlist.size === 0) return 'shopify_order_allowlist_required';
  if (!shopifyOrderAllowlist.has(normalizeLower(TARGET_NATIVE_SHOPIFY_ORDER_ID))) return 'target_native_shopify_order_not_allowlisted';
  if (!shopifyOrderAllowlist.has(normalizeLower(lookup.nativeShopifyOrderId))) return 'request_native_shopify_order_not_allowlisted';

  return null;
}

async function requireAdmin(base44) {
  try {
    const user = await base44.auth.me();
    if (!user) return { ok: false, status: 401, error_code: 'unauthorized', user: null };
    if (user.role !== 'admin') return { ok: false, status: 403, error_code: 'forbidden', user };
    return { ok: true, status: 200, error_code: null, user };
  } catch {
    return { ok: false, status: 401, error_code: 'unauthorized', user: null };
  }
}

async function fetchFreshPreview(base44, lookup) {
  const secret = expectedPreviewSecret();
  if (!secret) return { ok: false, status: 409, error_code: 'preview_secret_not_configured', data: null };

  try {
    const invokePromise = base44.asServiceRole.functions.invoke('previewNativeProductionVerifyCascades', {
      mode: 'dry_run',
      order_number: TARGET_ORDER_NUMBER,
      customer_app_order_id: lookup.customerAppOrderId || TARGET_CUSTOMER_APP_ORDER_ID,
      native_shopify_order_id: lookup.nativeShopifyOrderId || TARGET_NATIVE_SHOPIFY_ORDER_ID,
      native_fulfillment_task_id: lookup.nativeFulfillmentTaskId || TARGET_NATIVE_FULFILLMENT_TASK_ID,
      production_date: TARGET_PRODUCTION_DATE,
      request_id: `${lookup.requestId || 'g31z'}:fresh_post_verify_cascade_preview`,
      _internal_secret: secret,
    });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error('Fresh post-verify cascade preview invocation timed out');
        error.status = 504;
        error.code = 'native_shopify_order_bottle_preview_timeout';
        reject(error);
      }, 8000);
    });
    const response = await Promise.race([invokePromise, timeoutPromise]);
    const data = response?.data || response;
    if (!data?.success) {
      return { ok: false, status: 409, error_code: data?.error_code || 'native_shopify_order_bottle_preview_failed', data };
    }
    return { ok: true, status: 200, data };
  } catch (error) {
    const status = error?.response?.status || error?.status || 502;
    const data = error?.response?.data || error?.data || null;
    return { ok: false, status, error_code: data?.error_code || error?.code || previewFailureCode(status), data };
  }
}

function validateFreshPreview(preview) {
  const blockers = [];
  const warnings = [];
  const orderPreview = preview?.shopify_order_bottle_preview || {};
  const taskPreview = preview?.task_pack_preview || {};
  const customerImpact = preview?.customer_status_impact_preview || {};
  const notificationImpact = preview?.notification_impact_preview || {};
  const safety = preview?.safety || {};

  if (!preview?.success) blockers.push('fresh_post_verify_cascade_preview_failed');
  if (preview?.dry_run !== true) blockers.push('fresh_post_verify_cascade_preview_not_dry_run');
  if (preview?.writes_performed !== false) blockers.push('fresh_post_verify_cascade_preview_writes_flag_not_false');
  if (preview?.order_number !== TARGET_ORDER_NUMBER) blockers.push('fresh_preview_order_number_mismatch');
  if (preview?.customer_app_order_id !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('fresh_preview_customer_app_order_id_mismatch');
  if (preview?.native_shopify_order_id !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('fresh_preview_native_shopify_order_id_mismatch');
  if (preview?.native_fulfillment_task_id !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('fresh_preview_native_fulfillment_task_id_mismatch');
  if (preview?.production_date !== TARGET_PRODUCTION_DATE) blockers.push('fresh_preview_production_date_mismatch');
  if (preview?.customer_app_order_present !== true) blockers.push('fresh_preview_missing_customer_app_order');
  if (preview?.native_shopify_order_present !== true) blockers.push('fresh_preview_missing_native_shopify_order');
  if (preview?.native_fulfillment_task_present !== true) blockers.push('fresh_preview_missing_native_fulfillment_task');
  if (Number(preview?.verified_batch_count) !== EXPECTED_BATCH_IDS.length) blockers.push('fresh_preview_verified_batch_count_mismatch');
  if (Number(preview?.production_batch_count) !== EXPECTED_BATCH_IDS.length) blockers.push('fresh_preview_production_batch_count_mismatch');
  if (Number(preview?.compliance_log_count) < EXPECTED_BATCH_IDS.length) blockers.push('fresh_preview_compliance_log_count_mismatch');
  if (Array.isArray(preview?.cascade_blockers) && preview.cascade_blockers.length > 0) blockers.push('fresh_preview_cascade_blockers_present');
  if (preview?.shopify_order_bottle_ready !== true) blockers.push('fresh_preview_shopify_order_bottle_not_ready');
  if (orderPreview.order_bottle_cascade_allowed !== true) blockers.push('fresh_preview_order_bottle_cascade_not_allowed');
  if (orderPreview.proposed_production_status !== TARGET_PRODUCTION_STATUS) blockers.push('fresh_preview_proposed_order_status_mismatch');
  if (orderPreview.would_update_fulfillment_status === true) blockers.push('fresh_preview_fulfillment_status_update_projected');
  if (orderPreview.proposed_fulfillment_status && orderPreview.proposed_fulfillment_status !== orderPreview.current_fulfillment_status) blockers.push('fresh_preview_fulfillment_status_change_projected');
  if (taskPreview.task_already_satisfied !== true && taskPreview.task_pack_already_satisfied !== true && normalizeLower(taskPreview.current_task_status) !== 'packed') blockers.push('fresh_preview_task_pack_not_already_satisfied');
  if (customerImpact.would_touch_customer_app_order !== false) blockers.push('fresh_preview_customer_app_order_touch_projected');
  if (customerImpact.customer_facing_status_changes_held !== true) blockers.push('fresh_preview_customer_status_not_held');
  if (notificationImpact.would_send_notification !== false) blockers.push('fresh_preview_notification_projected');
  if (notificationImpact.non_confirmation_notifications_disabled_until_separate_approval !== true) blockers.push('fresh_preview_notifications_not_held');
  if (safety.writes_performed !== false) blockers.push('fresh_preview_safety_writes_not_false');
  if (safety.native_shopify_order_updated === true || safety.customer_app_order_updated === true || safety.fulfillment_task_updated === true || safety.production_batch_updated === true || safety.compliance_logs_created === true || safety.notifications_sent === true || safety.shopify_api_calls_performed === true || safety.provider_calls_performed === true) {
    blockers.push('fresh_preview_side_effect_projected');
  }

  if (Array.isArray(preview?.cascade_warnings)) warnings.push(...preview.cascade_warnings);
  return { ready: blockers.length === 0, blockers: uniqueStrings(blockers, 120), warnings: uniqueStrings(warnings, 120) };
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

async function findExistingCommandLog(base44, idempotencyKey) {
  return filterEntity(base44, 'CommandLog', { idempotency_key: idempotencyKey }, '-created_date', 3);
}

async function findCustomerOrder(base44) {
  const byId = await getEntity(base44, 'Order', TARGET_CUSTOMER_APP_ORDER_ID);
  if (byId?.id) return byId;
  const rows = await filterEntity(base44, 'Order', { order_number: TARGET_ORDER_NUMBER }, '-created_date', 5);
  return rows[0] || null;
}

async function findNativeShopifyOrder(base44) {
  const byId = await getEntity(base44, 'ShopifyOrder', TARGET_NATIVE_SHOPIFY_ORDER_ID);
  if (byId?.id) return byId;
  const rows = await filterEntity(base44, 'ShopifyOrder', { shopify_order_number: TARGET_ORDER_NUMBER }, '-created_date', 5);
  return rows.find(row => safeId(row?.id, 120) === TARGET_NATIVE_SHOPIFY_ORDER_ID) || rows[0] || null;
}

async function findTargetTask(base44) {
  const byId = await getEntity(base44, 'FulfillmentTask', TARGET_NATIVE_FULFILLMENT_TASK_ID);
  if (byId?.id) return byId;
  const rows = await filterEntity(base44, 'FulfillmentTask', { id: TARGET_NATIVE_FULFILLMENT_TASK_ID }, '-created_date', 5);
  if (rows[0]?.id) return rows[0];
  const byTaskId = await filterEntity(base44, 'FulfillmentTask', { fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID }, '-created_date', 5);
  return byTaskId[0] || null;
}

async function findBatchByBatchId(base44, batchId) {
  return filterEntity(base44, 'ProductionBatch', { batch_id: batchId }, '-created_date', 5);
}

async function findComplianceLogsForBatch(base44, batch) {
  const byDisplayId = batch?.batch_id ? await filterEntity(base44, 'BatchComplianceLog', { batch_id: batch.batch_id }, '-created_date', 20) : [];
  const bySourceId = batch?.id ? await filterEntity(base44, 'BatchComplianceLog', { source_production_batch_id: batch.id }, '-created_date', 20) : [];
  return [...new Map([...byDisplayId, ...bySourceId].map(row => [row.id || `${row.batch_id}:${row.source_production_batch_id}`, row])).values()];
}

function rowReferencesTarget(row) {
  const text = `${safeText(row?.order_number, 120)} ${safeText(row?.shopify_order_number, 120)} ${safeText(row?.order_id, 120)} ${safeText(row?.base44_order_id, 120)} ${safeText(row?.shopify_order_id, 120)} ${safeText(row?.native_shopify_order_id, 120)} ${safeText(row?.fulfillment_task_id, 120)} ${safeText(row?.id, 120)}`;
  return [TARGET_ORDER_NUMBER, TARGET_CUSTOMER_APP_ORDER_ID, TARGET_NATIVE_SHOPIFY_ORDER_ID, TARGET_NATIVE_FULFILLMENT_TASK_ID]
    .some(value => value && text.includes(value));
}

function batchHasTargetSource(batch) {
  const text = `${safeText(batch?.batch_id, 180)} ${safeText(batch?.source_order_number, 120)} ${safeText(batch?.order_number, 120)} ${safeText(batch?.source_order_id, 120)} ${safeText(batch?.base44_order_id, 120)} ${safeText(batch?.native_shopify_order_id, 120)} ${safeText(batch?.native_fulfillment_task_id, 120)} ${JSON.stringify(batch?.order_sources || [])} ${JSON.stringify(batch?.related_orders || [])}`;
  return [TARGET_ORDER_NUMBER, TARGET_CUSTOMER_APP_ORDER_ID, TARGET_NATIVE_SHOPIFY_ORDER_ID, TARGET_NATIVE_FULFILLMENT_TASK_ID]
    .some(value => value && text.includes(value));
}

function targetOrderType(customerOrder, nativeOrder, task) {
  if (nativeOrder?.is_subscription === true || customerOrder?.is_subscription === true || customerOrder?.subscription_id || nativeOrder?.subscription_parent_id || task?.customer_app_subscription_id || task?.stripe_subscription_id) return 'subscription';
  return normalizeLower(nativeOrder?.order_type || customerOrder?.order_type || task?.order_type || 'one_time') || 'one_time';
}

function targetFulfillmentMode(customerOrder, nativeOrder, task) {
  return normalizeLower(nativeOrder?.fulfillment_mode || customerOrder?.fulfillment_mode || task?.fulfillment_mode || task?.fulfillment_type || nativeOrder?.fulfillment_method || customerOrder?.fulfillment_type || 'single_delivery') || 'single_delivery';
}

function summarizeNativeOrder(order, previousStatus = null, skippedReason = null) {
  return {
    native_shopify_order_id: safeId(order?.id, 120) || null,
    shopify_order_number: safeText(order?.shopify_order_number || order?.order_number, 120) || null,
    previous_production_status: safeText(previousStatus || order?.production_status, 80) || null,
    production_status: safeText(order?.production_status, 80) || null,
    fulfillment_status: safeText(order?.fulfillment_status, 80) || null,
    order_type: safeText(order?.order_type, 80) || null,
    fulfillment_mode: safeText(order?.fulfillment_mode, 80) || null,
    audit_trail_count: Array.isArray(order?.audit_trail) ? order.audit_trail.length : 0,
    skipped_reason: skippedReason,
  };
}

function summarizeBatch(batch) {
  return {
    production_batch_id: safeId(batch?.id, 120) || null,
    batch_id: safeId(batch?.batch_id, 180) || null,
    product_name: safeText(batch?.product_name, 120) || null,
    status: safeText(batch?.status, 80) || null,
    production_date: safeText(batch?.production_date, 40) || null,
    actual_units: roundQuantity(batch?.actual_units, 3),
    verified_at_present: Boolean(batch?.verified_at),
    compliance_log_id_present: Boolean(batch?.compliance_log_id),
  };
}

function buildLocalFreshBottlePreview(preflight) {
  const nativeOrder = preflight?.nativeOrder || {};
  const task = preflight?.task || {};
  const alreadyBottled = ALREADY_BOTTLED_ORDER_STATUSES.has(normalizeLower(nativeOrder?.production_status));
  return {
    success: preflight?.ready === true,
    dry_run: true,
    writes_performed: false,
    preview_source: 'local_preflight',
    patch_marker: G31Z_MARKER,
    order_number: TARGET_ORDER_NUMBER,
    customer_app_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
    native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
    native_fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
    production_date: TARGET_PRODUCTION_DATE,
    delivery_date: TARGET_DELIVERY_DATE,
    customer_app_order_present: Boolean(preflight?.customerOrder?.id),
    native_shopify_order_present: Boolean(nativeOrder?.id),
    native_fulfillment_task_present: Boolean(task?.id),
    verified_batch_count: Array.isArray(preflight?.batches) ? preflight.batches.length : 0,
    production_batch_count: Array.isArray(preflight?.batches) ? preflight.batches.length : 0,
    compliance_log_count: Array.isArray(preflight?.complianceLogs) ? preflight.complianceLogs.length : 0,
    task_pack_ready: false,
    task_pack_already_satisfied: true,
    task_pack_preview: {
      task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
      current_task_status: safeText(task?.status, 80) || null,
      current_delivery_status: safeText(task?.delivery_status, 80) || null,
      current_production_status: safeText(task?.production_status, 80) || null,
      pack_cascade_allowed: true,
      task_pack_already_satisfied: true,
      task_already_satisfied: true,
      pack_action_state: 'already_packed',
      would_update_task_status: false,
      proposed_task_status: 'packed',
      would_update_production_status: false,
      proposed_production_status: 'packed',
      would_update_delivery_status: false,
      proposed_delivery_status: safeText(task?.delivery_status, 80) || null,
      blockers: [],
      warnings: uniqueStrings(['task_already_packed_or_bottled', ...(preflight?.warnings || [])], 40),
      pack_command_available: false,
      pack_command_gated: true,
      pack_requires_exact_approval: false,
    },
    shopify_order_bottle_ready: preflight?.ready === true,
    shopify_order_bottle_preview: {
      native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
      order_number: TARGET_ORDER_NUMBER,
      current_production_status: safeText(nativeOrder?.production_status, 80) || null,
      current_fulfillment_status: safeText(nativeOrder?.fulfillment_status, 80) || null,
      order_type: targetOrderType(preflight?.customerOrder, nativeOrder, task),
      fulfillment_mode: targetFulfillmentMode(preflight?.customerOrder, nativeOrder, task),
      is_subscription: false,
      order_bottle_cascade_allowed: preflight?.ready === true,
      bottle_command_available: preflight?.mode === 'bottle',
      bottle_command_gated: true,
      bottle_requires_exact_approval: preflight?.mode === 'bottle',
      already_bottled: alreadyBottled,
      would_update_native_shopify_order: preflight?.mode === 'bottle',
      proposed_production_status: TARGET_PRODUCTION_STATUS,
      proposed_fulfillment_status: safeText(nativeOrder?.fulfillment_status, 80) || null,
      would_update_fulfillment_status: false,
      customer_app_order_sync_deferred: true,
      notifications_deferred: true,
      blockers: [],
      warnings: uniqueStrings(alreadyBottled ? ['native_shopify_order_already_bottled'] : [], 40),
    },
    customer_status_impact_preview: {
      would_touch_customer_app_order: false,
      customer_facing_status_changes_held: true,
      status_history_append_held: true,
      delivered_status_held: true,
      production_status_customer_projection_held: true,
      expected_customer_status_after_this_phase: 'unchanged',
    },
    notification_impact_preview: {
      would_send_notification: false,
      notification_types_held: ['bottled', 'ready_for_delivery', 'delivered'],
      non_confirmation_notifications_disabled_until_separate_approval: true,
    },
    cascade_blockers: [],
    cascade_warnings: uniqueStrings([
      'customer_facing_status_held',
      'notifications_held',
      'task_pack_already_satisfied',
      'hub_fallback_required',
      ...(preflight?.warnings || []),
    ], 80),
    safety: safetyResult(),
  };
}

async function preflightTargetContext(base44) {
  const blockers = [];
  const warnings = [];
  const customerOrder = await findCustomerOrder(base44);
  const nativeOrder = await findNativeShopifyOrder(base44);
  const task = await findTargetTask(base44);
  const batches = [];
  const complianceLogs = [];
  const conflicts = [];

  if (!customerOrder) blockers.push('customer_app_order_not_found');
  if (!nativeOrder) blockers.push('native_shopify_order_not_found');
  if (!task) blockers.push('native_fulfillment_task_not_found');

  if (customerOrder) {
    if (safeId(customerOrder?.id, 120) !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('customer_app_order_id_mismatch');
    if (normalizeText(customerOrder?.order_number || customerOrder?.shopify_order_number).replace(/^#/, '') !== TARGET_ORDER_NUMBER) blockers.push('customer_app_order_number_mismatch');
    if (normalizeLower(customerOrder?.payment_status) !== 'paid') blockers.push('customer_app_order_not_paid');
    if (customerOrder?.payment_captured !== true) blockers.push('customer_app_order_payment_not_captured');
    if (['cancelled', 'canceled', 'refunded'].includes(normalizeLower(customerOrder?.status))) blockers.push('customer_app_order_cancelled_or_refunded');
    if (customerOrder?.is_subscription === true || customerOrder?.subscription_id) blockers.push('customer_app_subscription_order_blocked');
  }

  if (nativeOrder) {
    const orderStatus = normalizeLower(nativeOrder?.production_status || 'new');
    const fulfillmentStatus = normalizeLower(nativeOrder?.fulfillment_status);
    const paymentStatus = normalizeLower(nativeOrder?.payment_status || nativeOrder?.financial_status || customerOrder?.payment_status);
    if (safeId(nativeOrder?.id, 120) !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('native_shopify_order_id_mismatch');
    if (normalizeText(nativeOrder?.shopify_order_number || nativeOrder?.order_number).replace(/^#/, '') !== TARGET_ORDER_NUMBER) blockers.push('native_shopify_order_number_mismatch');
    if (nativeOrder?.base44_order_id && safeId(nativeOrder.base44_order_id, 120) !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('native_shopify_order_base44_order_mismatch');
    if (nativeOrder?.is_subscription === true || nativeOrder?.subscription_parent_id) blockers.push('native_shopify_order_subscription_blocked');
    const type = targetOrderType(customerOrder, nativeOrder, task);
    const mode = targetFulfillmentMode(customerOrder, nativeOrder, task);
    if (['subscription', 'multi_delivery'].includes(type) || mode === 'multi_delivery') blockers.push('subscription_multi_delivery_order_bottle_blocked');
    if (['cancelled', 'canceled', 'refunded'].includes(orderStatus) || ['cancelled', 'canceled', 'refunded', 'voided'].includes(paymentStatus) || ['cancelled', 'canceled'].includes(fulfillmentStatus)) blockers.push('native_shopify_order_cancelled_or_refunded');
    if (!BOTTLE_ELIGIBLE_ORDER_STATUSES.has(orderStatus) && !ALREADY_BOTTLED_ORDER_STATUSES.has(orderStatus)) {
      blockers.push(AFTER_BOTTLE_ORDER_STATUSES.has(orderStatus) ? 'native_shopify_order_already_after_bottle_status' : 'native_shopify_order_status_not_bottle_eligible');
    }
  }

  if (task) {
    const taskStatus = normalizeLower(task?.status);
    const productionStatus = normalizeLower(task?.production_status);
    if (safeId(task?.id, 120) !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('native_fulfillment_task_id_mismatch');
    if (!rowReferencesTarget(task)) blockers.push('native_fulfillment_task_order_context_mismatch');
    if (normalizeText(task?.production_date) !== TARGET_PRODUCTION_DATE) blockers.push('native_fulfillment_task_production_date_mismatch');
    if (TERMINAL_TASK_STATUSES.has(taskStatus)) blockers.push('native_fulfillment_task_terminal_or_delivery_advanced');
    if (task?.delivery_status && TERMINAL_DELIVERY_STATUSES.has(normalizeLower(task.delivery_status))) blockers.push('native_fulfillment_task_delivery_lifecycle_advanced');
    if (!TASK_PACKED_STATUSES.has(taskStatus)) blockers.push('native_fulfillment_task_not_packed');
    if (!TASK_PACKED_PRODUCTION_STATUSES.has(productionStatus)) blockers.push('native_fulfillment_task_production_status_not_packed');
    if (!task?.packed_at) blockers.push('native_fulfillment_task_missing_packed_at');
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
    const batchBlockers = [];
    if (safeText(batch?.product_name, 120) !== EXPECTED_BATCH_PRODUCTS[batchId]) batchBlockers.push('product_name_mismatch');
    if (normalizeText(batch?.production_date) !== TARGET_PRODUCTION_DATE) batchBlockers.push('production_date_mismatch');
    if (normalizeLower(batch?.status) !== 'verified_logged') batchBlockers.push('status_not_verified_logged');
    if (roundQuantity(batch?.actual_units, 3) === null) batchBlockers.push('missing_actual_units');
    if (!batch?.verified_at || !batch?.verified_by) batchBlockers.push('missing_verification_metadata');
    if (!batch?.compliance_log_id) batchBlockers.push('missing_compliance_log_id');
    if (!batchHasTargetSource(batch)) batchBlockers.push('target_order_source_missing');
    const logs = await findComplianceLogsForBatch(base44, batch);
    complianceLogs.push(...logs);
    if (logs.length === 0) batchBlockers.push('missing_batch_compliance_log');
    if (batchBlockers.length > 0) {
      blockers.push(`production_batch_context_blocked:${batchId}`);
      conflicts.push({ batch_id: batchId, product_name: EXPECTED_BATCH_PRODUCTS[batchId], status: safeText(batch?.status, 80) || null, blockers: batchBlockers });
    }
  }

  if (blockers.length > 0) {
    return { ready: false, mode: 'blocked', blockers: uniqueStrings(blockers, 120), warnings: uniqueStrings(warnings, 120), conflicts, customerOrder, nativeOrder, task, batches, complianceLogs, rowToUpdate: null, alreadyBottledOrder: null };
  }

  const orderStatus = normalizeLower(nativeOrder?.production_status || 'new');
  if (BOTTLE_ELIGIBLE_ORDER_STATUSES.has(orderStatus)) {
    return { ready: true, mode: 'bottle', blockers: [], warnings: uniqueStrings(warnings, 120), conflicts: [], customerOrder, nativeOrder, task, batches, complianceLogs, rowToUpdate: nativeOrder, alreadyBottledOrder: null };
  }
  if (ALREADY_BOTTLED_ORDER_STATUSES.has(orderStatus)) {
    return { ready: true, mode: 'already_bottled', blockers: [], warnings: uniqueStrings([...warnings, 'native_shopify_order_already_bottled'], 120), conflicts: [], customerOrder, nativeOrder, task, batches, complianceLogs, rowToUpdate: null, alreadyBottledOrder: nativeOrder };
  }

  return { ready: false, mode: 'blocked', blockers: ['native_shopify_order_status_not_bottle_eligible'], warnings: uniqueStrings(warnings, 120), conflicts: [], customerOrder, nativeOrder, task, batches, complianceLogs, rowToUpdate: null, alreadyBottledOrder: null };
}

function buildBottlePatch({ nativeOrder, actorEmail, requestId, now }) {
  const existingTrail = Array.isArray(nativeOrder.audit_trail) ? nativeOrder.audit_trail.slice(-100) : [];
  return {
    production_status: TARGET_PRODUCTION_STATUS,
    audit_trail: [
      ...existingTrail,
      {
        timestamp: now,
        action: 'native_shopify_order_bottle',
        performed_by: safeActorEmail(actorEmail) || 'native_admin_actor',
        before: {
          production_status: safeText(nativeOrder?.production_status, 80) || null,
          fulfillment_status: safeText(nativeOrder?.fulfillment_status, 80) || null,
        },
        after: {
          production_status: TARGET_PRODUCTION_STATUS,
          fulfillment_status: safeText(nativeOrder?.fulfillment_status, 80) || null,
        },
        reason: 'G31Z gated exact-order native ShopifyOrder Bottle command',
        request_id: safeId(requestId, 160) || null,
      },
    ],
  };
}

function validateBottlePatch(patch) {
  const blockers = [];
  const allowed = new Set(['production_status', 'audit_trail']);
  for (const key of Object.keys(patch || {})) if (!allowed.has(key)) blockers.push(`unapproved_native_shopify_order_bottle_field:${key}`);
  if (patch.production_status !== TARGET_PRODUCTION_STATUS) blockers.push('native_shopify_order_production_status_must_be_bottled');
  if (!Array.isArray(patch.audit_trail) || patch.audit_trail.length === 0) blockers.push('audit_trail_required');
  if ('fulfillment_status' in patch || 'order_status' in patch || 'status' in patch || 'status_history' in patch || 'delivered_at' in patch || 'delivery_status' in patch || 'delivery_photo_url' in patch || 'delivery_drop_location' in patch || 'route_id' in patch || 'customer_status' in patch || 'workflow_checklist' in patch || 'internal_notes' in patch) {
    blockers.push('forbidden_fulfillment_customer_delivery_or_workflow_field_present');
  }
  return blockers;
}

async function updateNativeShopifyOrderBottle({ base44, nativeOrder, actorEmail, requestId }) {
  const now = new Date().toISOString();
  const previousStatus = safeText(nativeOrder?.production_status, 80) || null;
  const patch = buildBottlePatch({ nativeOrder, actorEmail, requestId, now });
  const patchBlockers = validateBottlePatch(patch);
  if (patchBlockers.length > 0) {
    const error = new Error(`ShopifyOrder bottle patch validation failed: ${patchBlockers.join(',')}`);
    error.code = 'native_shopify_order_bottle_patch_invalid';
    throw error;
  }
  const updated = await base44.asServiceRole.entities.ShopifyOrder.update(nativeOrder.id, patch);
  return summarizeNativeOrder(updated, previousStatus);
}

async function createCommandLogSafe(args) {
  try {
    const commandLog = await createCommandLog(args);
    if (!commandLog?.id) {
      return { ok: false, error_code: 'native_shopify_order_bottle_command_log_missing_id', commandLog: null };
    }
    return { ok: true, commandLog };
  } catch (error) {
    return {
      ok: false,
      error_code: error?.code || 'native_shopify_order_bottle_command_log_create_failed',
      message: error?.message || 'CommandLog create failed',
      commandLog: null,
    };
  }
}

async function createCommandLog({ base44, status, idempotencyKey, requestId, user, result, errorCode, errorMessage }) {
  const now = new Date().toISOString();
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: COMMAND_TYPE,
    command_source: 'customer_app_native_admin',
    status,
    target_entity: 'ShopifyOrder',
    target_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
    target_display_id: TARGET_ORDER_NUMBER,
    actor_email: safeActorEmail(user?.email) || null,
    actor_role: safeText(user?.role, 80) || null,
    actor_type: 'admin',
    payload: {
      exact_order_allowlist: true,
      exact_native_shopify_order_allowlist: true,
      order_number: TARGET_ORDER_NUMBER,
      customer_app_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
      native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
      native_fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
      production_date: TARGET_PRODUCTION_DATE,
      delivery_date: TARGET_DELIVERY_DATE,
      policy: REQUIRED_POLICY,
      expected_batch_ids: EXPECTED_BATCH_IDS,
      expected_products: EXPECTED_PRODUCTS,
      proposed_native_shopify_order_production_status: TARGET_PRODUCTION_STATUS,
      proposed_native_shopify_order_fulfillment_status_change: false,
      preview_function: 'previewNativeProductionVerifyCascades',
    },
    result,
    error_code: errorCode || null,
    error_message: errorMessage ? safeText(errorMessage, 180) : null,
    idempotency_key: idempotencyKey,
    idempotent_skipped: status === 'skipped',
    request_id: requestId,
    submitted_at: now,
    completed_at: status === 'running' ? null : now,
    function_name: FUNCTION_NAME,
    related_order_number: TARGET_ORDER_NUMBER,
    related_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
    notes: 'G31Z exact gated native ShopifyOrder Bottle command. Updates only exact native ShopifyOrder production_status/audit metadata. No Customer App Order, FulfillmentTask, ProductionBatch, BatchComplianceLog, delivery/proof/drop/route, inventory, PurchaseOrder, provider, payment, notification, sync, repair, replay, or Hub mutation.',
  });
}

async function updateCommandLog({ base44, commandLogId, status, result, errorCode, errorMessage }) {
  if (!commandLogId) return null;
  return base44.asServiceRole.entities.CommandLog.update(commandLogId, {
    status,
    result,
    error_code: errorCode || null,
    error_message: errorMessage ? safeText(errorMessage, 180) : null,
    idempotent_skipped: status === 'skipped',
    completed_at: new Date().toISOString(),
  });
}

async function updateCommandLogSafe(args) {
  try {
    return { ok: true, commandLog: await updateCommandLog(args) };
  } catch (error) {
    return {
      ok: false,
      error_code: error?.code || 'native_shopify_order_bottle_command_log_update_failed',
      message: error?.message || 'CommandLog update failed',
    };
  }
}

function safetyResult(extra = {}) {
  return {
    writes_performed: false,
    fulfillment_task_updated: false,
    native_fulfillment_task_updated: false,
    task_packed: false,
    native_shopify_order_updated: false,
    shopify_order_bottled: false,
    customer_app_order_updated: false,
    customer_facing_status_updated: false,
    customer_status_history_appended: false,
    notifications_sent: false,
    delivery_status_updated: false,
    delivery_route_proof_drop_mutated: false,
    production_batches_updated: false,
    production_batches_created: false,
    manual_production_batches_created: false,
    compliance_logs_created: false,
    batch_compliance_logs_created: false,
    inventory_deducted: false,
    purchase_orders_created: false,
    provider_calls_performed: false,
    stripe_calls_performed: false,
    shopify_api_calls_performed: false,
    sync_repair_replay_performed: false,
    hub_bridge_modified: false,
    ...extra,
  };
}

function writeSafetyResult(extra = {}) {
  return safetyResult({
    writes_performed: true,
    ...extra,
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return jsonResponse({ success: false, error_code: 'method_not_allowed', message: 'POST required', writes_performed: false }, 405);
    }

    const parsed = await readJsonBody(req);
    if (!parsed.ok) return jsonResponse({ success: false, error_code: 'malformed_json', writes_performed: false }, 400);
    const body = parsed.body || {};

    const base44 = createClientFromRequest(req);
    const auth = await requireAdmin(base44);
    if (!auth.ok) return jsonResponse({ success: false, error_code: auth.error_code, writes_performed: false }, auth.status);

    const badKey = unsupportedBodyKey(body);
    if (badKey) return jsonResponse({ success: false, error_code: 'unsupported_request_field', field: safeText(badKey, 80), writes_performed: false }, 400);

    const lookup = getLookup(body);
    if (normalizeLower(body.mode) !== 'live' || normalizeText(body.confirmation) !== CONFIRMATION_PHRASE) {
      return jsonResponse({ success: false, error_code: 'confirmation_required', writes_performed: false }, 400);
    }
    if (!lookup.requestId) return jsonResponse({ success: false, error_code: 'request_id_required', writes_performed: false }, 400);

    const targetBlockers = exactTargetBlockers(lookup);
    if (targetBlockers.length > 0) {
      return jsonResponse({ success: false, skipped: true, error_code: 'exact_native_shopify_order_bottle_target_required', blockers: targetBlockers, writes_performed: false }, 409);
    }

    const gate = gateFailure({ actorEmail: auth.user?.email, lookup });
    if (gate) return jsonResponse({ success: false, skipped: true, error_code: gate, writes_performed: false }, 409);

    const idempotencyKey = `${COMMAND_TYPE}:${lookup.requestId}`;
    const existingLogs = await findExistingCommandLog(base44, idempotencyKey);
    const existingLog = Array.isArray(existingLogs) && existingLogs.length > 0 ? existingLogs[0] : null;
    if (existingLog && ['success', 'skipped'].includes(existingLog.status)) {
      return jsonResponse({
        success: true,
        skipped: true,
        idempotent: true,
        reason: 'idempotency_log_present',
        request_id: lookup.requestId,
        idempotency_key: idempotencyKey,
        command_log_id: safeId(existingLog.id, 120) || null,
        writes_performed: false,
        native_shopify_order_updated: false,
        duplicate_audit_entries_created: false,
        safety: safetyResult(),
      });
    }
    if (existingLog && existingLog.status === 'failed') {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: 'previous_failed_request_id_not_reusable',
        request_id: lookup.requestId,
        idempotency_key: idempotencyKey,
        writes_performed: false,
      }, 409);
    }

    const preflight = await preflightTargetContext(base44);
    if (!preflight.ready) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: 'native_shopify_order_bottle_preflight_blocked',
        blockers: preflight.blockers,
        warnings: preflight.warnings,
        conflicts: preflight.conflicts,
        writes_performed: false,
      }, 409);
    }

    if (preflight.mode === 'already_bottled') {
      const skippedLog = await createCommandLogSafe({
        base44,
        status: 'skipped',
        idempotencyKey,
        requestId: lookup.requestId,
        user: auth.user,
        result: {
          writes_performed: false,
          native_shopify_order_updated: false,
          already_bottled: true,
          native_order: summarizeNativeOrder(preflight.alreadyBottledOrder, preflight.alreadyBottledOrder?.production_status, 'already_bottled'),
          duplicate_audit_entries_created: false,
          ...safetyResult(),
        },
      });
      if (!skippedLog.ok) {
        return jsonResponse({
          success: false,
          skipped: true,
          error_code: skippedLog.error_code,
          message: 'Native ShopifyOrder bottle skipped but CommandLog creation failed safely.',
          writes_performed: false,
        }, 500);
      }
      return jsonResponse({
        success: true,
        skipped: true,
        idempotent: false,
        reason: 'native_shopify_order_already_bottled',
        request_id: lookup.requestId,
        idempotency_key: idempotencyKey,
        command_log_id: safeId(skippedLog.commandLog?.id, 120) || null,
        order_number: TARGET_ORDER_NUMBER,
        native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
        writes_performed: false,
        native_shopify_order_updated: false,
        shopify_order_bottled: true,
        native_order: summarizeNativeOrder(preflight.alreadyBottledOrder, preflight.alreadyBottledOrder?.production_status, 'already_bottled'),
        duplicate_audit_entries_created: false,
        safety: safetyResult({ shopify_order_bottled: true }),
      });
    }

    const freshPreview = shouldUseServicePreview()
      ? await fetchFreshPreview(base44, lookup)
      : { ok: true, status: 200, data: buildLocalFreshBottlePreview(preflight) };
    if (!freshPreview.ok) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: freshPreview.error_code || 'native_shopify_order_bottle_preview_failed',
        preview_status: freshPreview.status,
        writes_performed: false,
      }, 409);
    }

    const validation = validateFreshPreview(freshPreview.data);
    if (!validation.ready) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: 'fresh_post_verify_cascade_preview_not_clean',
        blockers: validation.blockers,
        warnings: validation.warnings,
        writes_performed: false,
      }, 409);
    }

    const commandLogCreate = await createCommandLogSafe({
      base44,
      status: 'running',
      idempotencyKey,
      requestId: lookup.requestId,
      user: auth.user,
      result: {
        writes_performed: false,
        projected_update_count: 1,
        projected_native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
        projected_production_status_to: TARGET_PRODUCTION_STATUS,
        projected_fulfillment_status_change: false,
        verified_batch_count: preflight.batches.length,
        compliance_log_count: preflight.complianceLogs.length,
        customer_app_order_updated: false,
        native_fulfillment_task_updated: false,
        notifications_sent: false,
        preview_source: freshPreview.data?.preview_source || 'service_preview',
        patch_marker: G31Z_MARKER,
      },
    });
    if (!commandLogCreate.ok) {
      return jsonResponse({
        success: false,
        skipped: false,
        error_code: commandLogCreate.error_code,
        message: 'Native ShopifyOrder bottle validation passed, but CommandLog creation failed before any order update.',
        writes_performed: false,
        native_shopify_order_updated: false,
      }, 500);
    }
    const commandLog = commandLogCreate.commandLog;

    let updatedOrder = null;
    try {
      updatedOrder = await updateNativeShopifyOrderBottle({
        base44,
        nativeOrder: preflight.rowToUpdate,
        actorEmail: auth.user?.email,
        requestId: lookup.requestId,
      });
    } catch (error) {
      await updateCommandLogSafe({
        base44,
        commandLogId: commandLog?.id,
        status: 'failed',
        result: {
          writes_performed: false,
          native_shopify_order_updated: false,
          projected_native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
          duplicate_audit_entries_created: false,
          ...safetyResult(),
        },
        errorCode: error?.code || 'native_shopify_order_bottle_write_failed',
        errorMessage: error?.message || 'Native ShopifyOrder bottle write failed',
      });
      return jsonResponse({
        success: false,
        skipped: false,
        error_code: error?.code || 'native_shopify_order_bottle_write_failed',
        message: 'Native ShopifyOrder bottle failed safely.',
        writes_performed: false,
      }, 500);
    }

    const successLogUpdate = await updateCommandLogSafe({
      base44,
      commandLogId: commandLog?.id,
      status: 'success',
      result: {
        ...writeSafetyResult({ native_shopify_order_updated: true, shopify_order_bottled: true }),
        writes_performed: true,
        native_shopify_order_updated: true,
        shopify_order_bottled: true,
        updated_native_order: updatedOrder,
        production_status_from: updatedOrder?.previous_production_status || null,
        production_status_to: TARGET_PRODUCTION_STATUS,
        fulfillment_status_updated: false,
        verified_batch_count: preflight.batches.length,
        compliance_log_count: preflight.complianceLogs.length,
        patch_marker: G31Z_MARKER,
      },
    });
    if (!successLogUpdate.ok) {
      return jsonResponse({
        success: false,
        skipped: false,
        error_code: successLogUpdate.error_code,
        message: 'Native ShopifyOrder was bottled, but CommandLog finalization failed. Reconciliation required before retry.',
        request_id: lookup.requestId,
        idempotency_key: idempotencyKey,
        command_log_id: safeId(commandLog?.id, 120) || null,
        order_number: TARGET_ORDER_NUMBER,
        native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
        writes_performed: true,
        reconciliation_required: true,
        native_shopify_order_updated: true,
        shopify_order_bottled: true,
        updated_native_order: updatedOrder,
        safety: writeSafetyResult({ native_shopify_order_updated: true, shopify_order_bottled: true }),
      }, 500);
    }

    return jsonResponse({
      success: true,
      skipped: false,
      idempotent: false,
      request_id: lookup.requestId,
      idempotency_key: idempotencyKey,
      command_log_id: safeId(commandLog?.id, 120) || null,
      order_number: TARGET_ORDER_NUMBER,
      native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
      writes_performed: true,
      native_shopify_order_updated: true,
      shopify_order_bottled: true,
      updated_native_order: updatedOrder,
      production_status_from: updatedOrder?.previous_production_status || null,
      production_status_to: TARGET_PRODUCTION_STATUS,
      fulfillment_status_updated: false,
      verified_batch_count: preflight.batches.length,
      compliance_log_count: preflight.complianceLogs.length,
      duplicate_audit_entries_created: false,
      native_fulfillment_task_updated: false,
      customer_app_order_updated: false,
      customer_facing_status_updated: false,
      notifications_sent: false,
      delivery_status_updated: false,
      delivery_route_proof_drop_mutated: false,
      production_batches_updated: false,
      compliance_logs_created: false,
      batch_compliance_logs_created: false,
      inventory_deducted: false,
      purchase_orders_created: false,
      provider_calls: false,
      stripe_calls: false,
      shopify_calls: false,
      sync_retry_repair_run: false,
      hub_records_updated: false,
      safety: writeSafetyResult({ native_shopify_order_updated: true, shopify_order_bottled: true }),
    });
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] failed safely: ${error?.message || 'unknown error'}`);
    return jsonResponse({
      success: false,
      error_code: 'native_shopify_order_bottle_failed',
      message: 'Native ShopifyOrder bottle failed safely.',
      writes_performed: false,
    }, 500);
  }
});
