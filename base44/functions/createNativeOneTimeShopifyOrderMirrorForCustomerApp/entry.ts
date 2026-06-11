import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const FUNCTION_NAME = 'createNativeOneTimeShopifyOrderMirrorForCustomerApp';
const G33C_MIRROR2_COMMAND_MARKER = 'g33c_mirror2_default_off_one_time_shopify_order_mirror_command';
const COMMAND_TYPE = 'native_one_time_shopify_order_mirror_create';
const ENABLE_FLAG = 'ENABLE_NATIVE_ONE_TIME_SHOPIFY_ORDER_MIRROR';
const KILL_SWITCH_FLAG = 'NATIVE_ONE_TIME_SHOPIFY_ORDER_MIRROR_KILL_SWITCH';
const ALLOWED_EMAILS_FLAG = 'NATIVE_ONE_TIME_SHOPIFY_ORDER_MIRROR_ALLOWED_EMAILS';
const ORDER_ALLOWLIST_FLAG = 'NATIVE_ONE_TIME_SHOPIFY_ORDER_MIRROR_ORDER_ALLOWLIST';
const CUSTOMER_ORDER_ALLOWLIST_FLAG = 'NATIVE_ONE_TIME_SHOPIFY_ORDER_MIRROR_CUSTOMER_ORDER_ALLOWLIST';
const POLICY_FLAG = 'NATIVE_ONE_TIME_SHOPIFY_ORDER_MIRROR_POLICY';
const REQUIRED_POLICY = 'EXACT_ONE_TIME_SHOPIFY_ORDER_MIRROR_ONLY_NO_NOTIFICATION';
const REQUIRED_CONFIRMATION = 'create_native_one_time_shopify_order_mirror_no_notification';
const REQUIRED_NOTIFICATION_POLICY = 'NO_NOTIFICATION';
const REQUIRED_PROVIDER_CALL_POLICY = 'NO_PROVIDER_CALLS';
const REQUIRED_HUB_MUTATION_POLICY = 'NO_HUB_MUTATION';
const REQUIRED_TASK_CREATION_POLICY = 'HELD_UNTIL_NATIVE_SHOPIFY_ORDER_EXISTS';
const PREVIEW_MODE = 'ONE_TIME_NATIVE_MIRROR_TASK_PARITY';
const PREVIEW_EXACT_MODE = 'EXACT_ORDER_PREVIEW';
const TARGET_ORDER_TYPE = 'one_time';
const TARGET_FULFILLMENT_TYPE = 'delivery';
const TARGET_SOURCE_CHANNEL = 'online';
const TARGET_SOURCE_TYPE = 'customer_app_one_time_native_mirror';
const TARGET_FULFILLMENT_MODE = 'single_delivery';
const TARGET_FULFILLMENT_METHOD = 'delivery';
const TARGET_PAYMENT_STATUS = 'paid';
const TARGET_FINANCIAL_STATUS = 'paid';
const TARGET_PRODUCTION_STATUS = 'bottled';
const TARGET_FULFILLMENT_STATUS = 'pending';
const TARGET_SYNC_STATUS = 'native_one_time_mirror_g33c_mirror2';
const TARGET_MISSING_NATIVE_REASON = 'native_ops_duplicate_hub_dedupe_only';
const MAX_TEXT = 180;

const SOURCE_CHANNEL_VALUES = new Set(['online', 'pos', 'draft', 'subscription', 'wholesale', 'admin', 'event']);
const ORDER_TYPE_VALUES = new Set(['one_time', 'subscription', 'pos', 'wholesale', 'admin', 'event']);
const FULFILLMENT_MODE_VALUES = new Set(['single_delivery', 'multi_delivery']);
const FULFILLMENT_METHOD_VALUES = new Set(['delivery', 'pickup', 'shipping', 'pos']);
const PRODUCTION_STATUS_VALUES = new Set(['new', 'awaiting_production', 'in_production', 'bottled', 'labeled', 'qc_checked', 'packed', 'in_cold_storage', 'assigned_for_pickup', 'assigned_for_delivery', 'not_required', 'fulfilled', 'canceled', 'refunded']);
const COMMAND_SUCCESS_STATUSES = new Set(['success', 'skipped']);

const SHOPIFY_ORDER_SCHEMA_FIELDS = new Set([
  'shopify_order_id',
  'shopify_order_number',
  'description',
  'base44_order_id',
  'source_channel',
  'line_items',
  'fulfillment_method',
  'requested_delivery_date',
  'requested_time_window',
  'payment_status',
  'fulfillment_status',
  'shopify_fulfillment_status',
  'financial_status',
  'subtotal',
  'total_tax',
  'total_discounts',
  'tip_received',
  'total_price',
  'discount_codes',
  'internal_notes',
  'tags',
  'is_pos_order',
  'is_subscription',
  'subscription_cadence',
  'event_name',
  'event_date',
  'event_location',
  'assigned_driver',
  'production_status',
  'workflow_checklist',
  'shopify_synced_at',
  'assigned_delivery_date',
  'order_type',
  'fulfillment_mode',
  'customer_order_date',
  'delivery_notes',
  'fulfillments',
  'production_snapshot',
  'selected_delivery_date',
  'production_date',
  'delivery_window_label',
  'order_lock_status',
  'order_status',
  'operational_visibility',
  'sync_status',
  'last_sync_at',
  'last_reconciliation_at',
  'source_type',
  'repair_status',
  'repair_timestamp',
  'repair_method',
  'subscription_parent_id',
  'fulfillment_instance_date',
  'fulfillment_sequence_number',
  'source_invoice_id',
  'data_quality_status',
  'last_verified_at',
  'manual_override',
  'manual_override_at',
  'manual_override_by',
  'audit_trail',
  'refund_status',
  'refund_type',
  'refund_amount',
  'refund_currency',
  'refunded_at',
  'refund_source',
  'refund_event_id',
  'refund_reason',
  'refund_review_required',
  'refund_review_status',
  'do_not_recover',
  'cancel_type',
  'excluded_from_production',
]);

const ALLOWED_BODY_KEYS = new Set([
  'order_number',
  'shopify_order_number',
  'customer_app_order_id',
  'base44_order_id',
  'order_id',
  'notification_policy',
  'provider_call_policy',
  'hub_mutation_policy',
  'task_creation_policy',
  'request_id',
  'confirmation',
]);

const FORBIDDEN_BODY_KEYS = new Set([
  'fulfillment_task_create',
  'native_fulfillment_task_create',
  'create_fulfillment_task',
  'task_payload',
  'customer_app_order_update',
  'update_customer_app_order',
  'customer_app_order_payload',
  'production_batch_create',
  'production_batch',
  'batch_compliance_log_create',
  'batch_compliance_log',
  'compliance_log',
  'notification',
  'notifications',
  'notification_payload',
  'push',
  'sms',
  'email',
  'in_app',
  'send_notification',
  'message_log',
  'message_logs',
  'proof',
  'proof_url',
  'proof_photo_url',
  'drop',
  'drop_location',
  'route',
  'route_id',
  'route_stop_sequence',
  'provider_payload',
  'provider_id',
  'provider_ids',
  'payment_payload',
  'shopify_api',
  'shopify_payload',
  'stripe_payload',
  'stripe_refund',
  'stripe_flags',
  'sync',
  'repair',
  'replay',
  'inventory',
  'inventory_deduction',
  'deduct_inventory',
  'purchase_order',
  'create_purchase_order',
  'raw_payload',
  'payload',
  'raw_body',
  'raw_customer_app_payload',
  'raw_hub_payload',
  'raw_shopify_payload',
  'raw_stripe_payload',
  'raw_provider_payload',
  'headers',
  'authorization',
  'auth_header',
  'secret',
  'token',
  'api_key',
  'api-key',
  'bulk_order_ids',
  'bulk_customer_order_ids',
  'broad_allowlist',
  'allowlist_all',
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

function safeReferenceId(value, maxLength = MAX_TEXT) {
  const text = normalizeSingleLine(value);
  if (!text || text.length > maxLength) return '';
  if (!/^[A-Za-z0-9._:@/#-]+$/.test(text)) return '';
  if (/^(?:Bearer|Basic)$/i.test(text)) return '';
  if (/^(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)/i.test(text)) return '';
  return text;
}

function safeActorEmail(value) {
  const email = normalizeSingleLine(value).toLowerCase();
  return email && email.length <= 180 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function safeNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseCsvSet(value) {
  return new Set(normalizeText(value).split(',').map(normalizeLower).filter(Boolean));
}

function uniqueStrings(values, limit = 160) {
  return [...new Set((values || []).map(value => safeText(value, 180)).filter(Boolean))].slice(0, limit);
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, item]) => item !== undefined && item !== null && item !== ''));
}

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
}

function safetyResult(overrides = {}) {
  return {
    writes_performed: false,
    native_shopify_order_created: false,
    command_log_created: false,
    customer_app_order_created: false,
    customer_app_order_updated: false,
    native_fulfillment_task_created: false,
    production_batch_created: false,
    batch_compliance_log_created: false,
    order_sync_log_created: false,
    order_review_queue_created: false,
    notifications_created: false,
    notifications_sent: false,
    message_logs_created: false,
    provider_calls: false,
    provider_calls_performed: false,
    stripe_calls_performed: false,
    shopify_api_calls_performed: false,
    hub_records_updated: false,
    hub_mutation_performed: false,
    sync_repair_replay_performed: false,
    inventory_mutation: false,
    purchase_order_created: false,
    ...overrides,
  };
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
    if (FORBIDDEN_BODY_KEYS.has(normalized)) return key;
    if (ALLOWED_BODY_KEYS.has(normalized)) continue;
    if (/(^|_)(raw|payload|provider|stripe|shopify_api|inventory|purchase|notification|message|sync|repair|replay|bulk|batch|compliance|task_create|customer_app_order_update|secret|token|headers|authorization|proof|drop|route)($|_)/i.test(normalized)) return key;
    return key;
  }
  return null;
}

function getLookup(body) {
  return {
    orderNumber: normalizeOrderNumber(body?.order_number || body?.shopify_order_number),
    customerAppOrderId: safeReferenceId(body?.customer_app_order_id || body?.base44_order_id || body?.order_id, 180),
    notificationPolicy: normalizeUpper(body?.notification_policy),
    providerCallPolicy: normalizeUpper(body?.provider_call_policy),
    hubMutationPolicy: normalizeUpper(body?.hub_mutation_policy),
    taskCreationPolicy: normalizeUpper(body?.task_creation_policy),
    requestId: safeReferenceId(body?.request_id, 180),
    confirmation: normalizeText(body?.confirmation),
  };
}

function exactInputBlockers(lookup) {
  const blockers = [];
  if (!lookup.orderNumber) blockers.push('order_number_required');
  if (!lookup.customerAppOrderId) blockers.push('customer_app_order_id_required');
  if (lookup.notificationPolicy !== REQUIRED_NOTIFICATION_POLICY) blockers.push('notification_policy_must_be_no_notification');
  if (lookup.providerCallPolicy !== REQUIRED_PROVIDER_CALL_POLICY) blockers.push('provider_call_policy_must_be_no_provider_calls');
  if (lookup.hubMutationPolicy !== REQUIRED_HUB_MUTATION_POLICY) blockers.push('hub_mutation_policy_must_be_no_hub_mutation');
  if (lookup.taskCreationPolicy !== REQUIRED_TASK_CREATION_POLICY) blockers.push('task_creation_policy_must_be_held_until_native_shopify_order_exists');
  if (!lookup.requestId) blockers.push('request_id_required');
  if (lookup.confirmation !== REQUIRED_CONFIRMATION) blockers.push('confirmation_phrase_required');
  return blockers;
}

function gateFailure({ actorEmail, lookup }) {
  if (Deno.env.get(KILL_SWITCH_FLAG) === 'true') return 'kill_switch_active';
  if (Deno.env.get(ENABLE_FLAG) !== 'true') return 'native_one_time_shopify_order_mirror_disabled';
  if (normalizeText(Deno.env.get(POLICY_FLAG)) !== REQUIRED_POLICY) return 'native_one_time_shopify_order_mirror_policy_required';

  const allowedEmails = parseCsvSet(Deno.env.get(ALLOWED_EMAILS_FLAG) || '');
  if (allowedEmails.size === 0) return 'allowed_email_gate_required';
  if (!allowedEmails.has(normalizeLower(actorEmail))) return 'actor_email_not_allowlisted';

  const orderAllowlist = parseCsvSet(Deno.env.get(ORDER_ALLOWLIST_FLAG) || '');
  if (orderAllowlist.size === 0) return 'order_allowlist_required';
  if (!orderAllowlist.has(normalizeLower(lookup.orderNumber)) && !orderAllowlist.has(normalizeLower(`#${lookup.orderNumber}`))) return 'order_not_allowlisted';

  const customerOrderAllowlist = parseCsvSet(Deno.env.get(CUSTOMER_ORDER_ALLOWLIST_FLAG) || '');
  if (customerOrderAllowlist.size === 0) return 'customer_order_allowlist_required';
  if (!customerOrderAllowlist.has(normalizeLower(lookup.customerAppOrderId))) return 'customer_order_not_allowlisted';

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

async function filterEntity(base44, entityName, filter, sort = '-created_date', limit = 20) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity?.filter) return [];
  const rows = await entity.filter(filter, sort, limit).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function findExistingNativeOrders(base44, lookup) {
  const rows = [];
  if (lookup.customerAppOrderId) rows.push(...await filterEntity(base44, 'ShopifyOrder', { base44_order_id: lookup.customerAppOrderId }, '-created_date', 20));
  if (lookup.orderNumber) {
    rows.push(...await filterEntity(base44, 'ShopifyOrder', { shopify_order_number: lookup.orderNumber }, '-created_date', 20));
    rows.push(...await filterEntity(base44, 'ShopifyOrder', { shopify_order_number: `#${lookup.orderNumber}` }, '-created_date', 20));
  }
  return [...new Map(rows.map(row => [row?.id || JSON.stringify(row), row])).values()];
}

async function findExistingNativeTasks(base44, lookup) {
  const rows = [];
  if (lookup.customerAppOrderId) {
    rows.push(...await filterEntity(base44, 'FulfillmentTask', { order_id: lookup.customerAppOrderId }, '-created_date', 20));
    rows.push(...await filterEntity(base44, 'FulfillmentTask', { base44_order_id: lookup.customerAppOrderId }, '-created_date', 20));
  }
  if (lookup.orderNumber) {
    rows.push(...await filterEntity(base44, 'FulfillmentTask', { order_number: lookup.orderNumber }, '-created_date', 20));
    rows.push(...await filterEntity(base44, 'FulfillmentTask', { shopify_order_number: lookup.orderNumber }, '-created_date', 20));
    rows.push(...await filterEntity(base44, 'FulfillmentTask', { shopify_order_number: `#${lookup.orderNumber}` }, '-created_date', 20));
  }
  return [...new Map(rows.map(row => [row?.id || JSON.stringify(row), row])).values()];
}

async function findExistingCommandLog(base44, idempotencyKey) {
  return filterEntity(base44, 'CommandLog', { idempotency_key: idempotencyKey }, '-created_date', 5);
}

function successfulCommandLog(log) {
  return log && COMMAND_SUCCESS_STATUSES.has(normalizeLower(log.status)) && !log.error_code;
}

function nativeOrderCreatedByRequest(row, requestId) {
  return Array.isArray(row?.audit_trail) && row.audit_trail.some(entry => normalizeText(entry?.request_id) === requestId && normalizeText(entry?.source) === FUNCTION_NAME);
}

async function previewMirrorPacket(base44, lookup) {
  const payload = {
    preview_mode: PREVIEW_MODE,
    mode: PREVIEW_EXACT_MODE,
    order_number: lookup.orderNumber,
    customer_app_order_id: lookup.customerAppOrderId,
    request_id: `${lookup.requestId}:g33c_mirror2_prewrite_preview`,
  };
  if (base44.functions?.invoke) {
    const res = await base44.functions.invoke('previewNativeOrderCutoverReadiness', payload);
    return res?.data || res?.response?.data || res;
  }
  if (base44.asServiceRole?.functions?.invoke) {
    const res = await base44.asServiceRole.functions.invoke('previewNativeOrderCutoverReadiness', payload);
    return res?.data || res?.response?.data || res;
  }
  if (typeof base44.__previewNativeOrderCutoverReadiness === 'function') return base44.__previewNativeOrderCutoverReadiness(payload);
  return { success: false, error_code: 'preview_invocation_unavailable', writes_performed: false };
}

function validatePreview(preview, lookup) {
  const blockers = [];
  const orderNumber = normalizeOrderNumber(preview?.order_number || preview?.native_shopify_order_mirror_preview?.shopify_order_number);
  if (!preview?.success) blockers.push(preview?.error_code || 'g33c_mirror1_preview_failed');
  if (preview?.dry_run !== true) blockers.push('g33c_mirror1_preview_not_dry_run');
  if (preview?.writes_performed !== false) blockers.push('g33c_mirror1_preview_writes_flag_not_false');
  if (preview?.preview_mode !== PREVIEW_MODE) blockers.push('g33c_mirror1_preview_mode_mismatch');
  if (preview?.mode !== PREVIEW_EXACT_MODE) blockers.push('g33c_mirror1_preview_exact_mode_mismatch');
  if (orderNumber !== lookup.orderNumber) blockers.push('g33c_mirror1_order_number_mismatch');
  if (normalizeText(preview?.customer_app_order_id) !== lookup.customerAppOrderId) blockers.push('g33c_mirror1_customer_app_order_id_mismatch');
  if (preview?.customer_app_order_present !== true) blockers.push('customer_app_order_missing');
  if (normalizeLower(preview?.payment_status) !== TARGET_PAYMENT_STATUS) blockers.push('payment_status_not_paid');
  if (preview?.payment_captured !== true) blockers.push('payment_not_captured');
  if (normalizeLower(preview?.order_type) !== TARGET_ORDER_TYPE) blockers.push('order_type_not_one_time');
  if (normalizeLower(preview?.fulfillment_type) !== TARGET_FULFILLMENT_TYPE) blockers.push('fulfillment_type_not_delivery');
  if (safeNumber(preview?.line_item_count, null) !== 3) blockers.push('line_item_count_must_be_3');
  if (preview?.native_shopify_order_present !== false) blockers.push('native_shopify_order_already_present_in_preview');
  if (preview?.native_fulfillment_task_present !== false) blockers.push('native_fulfillment_task_already_present_in_preview');
  if (normalizeText(preview?.missing_native_reason_classification) !== TARGET_MISSING_NATIVE_REASON) blockers.push('missing_native_reason_mismatch');
  if (normalizeText(preview?.source_audit?.hub_bridge_status) !== 'deduped') blockers.push('hub_bridge_status_not_deduped');
  if (safeNumber(preview?.source_audit?.order_review_queue_status?.count, 0) !== 0) blockers.push('order_review_queue_blocker_present');
  if (Array.isArray(preview?.blockers) && preview.blockers.length > 0) blockers.push('g33c_mirror1_preview_blockers_present');
  if (Array.isArray(preview?.schema_packet_blockers) && preview.schema_packet_blockers.length > 0) blockers.push('g33c_mirror1_schema_packet_blockers_present');
  if (Array.isArray(preview?.native_shopify_order_mirror_preview?.blockers) && preview.native_shopify_order_mirror_preview.blockers.length > 0) blockers.push('g33c_mirror1_native_shopify_order_packet_blockers_present');
  if (preview?.native_shopify_order_mirror_preview?.would_create_native_shopify_order !== true) blockers.push('g33c_mirror1_native_shopify_order_packet_not_ready');
  if (!preview?.native_shopify_order_mirror_preview?.schema_safe_field_packet) blockers.push('g33c_mirror1_native_shopify_order_packet_missing');
  if (preview?.native_fulfillment_task_preview?.would_create_native_fulfillment_task !== false) blockers.push('g33c_mirror1_task_preview_must_remain_held');
  if (preview?.native_fulfillment_task_preview?.task_create_depends_on_native_shopify_order !== true) blockers.push('task_dependency_not_confirmed');
  if (!(preview?.native_fulfillment_task_preview?.blockers || []).includes('task_create_depends_on_native_shopify_order')) blockers.push('task_dependency_blocker_missing');
  if (preview?.provider_call_impact !== false) blockers.push('provider_call_impact_not_false');
  if (preview?.notification_impact?.notification_held !== true) blockers.push('notifications_not_held');
  if (preview?.notification_impact?.notification_would_send === true) blockers.push('notification_would_send');
  if (preview?.safety?.hub_records_updated === true || preview?.safety?.hub_bridge_modified === true) blockers.push('hub_mutation_projected');
  return uniqueStrings(blockers);
}

function schemaAudit() {
  return {
    schema: 'ShopifyOrder',
    source_channel_online_supported: SOURCE_CHANNEL_VALUES.has(TARGET_SOURCE_CHANNEL),
    order_type_one_time_supported: ORDER_TYPE_VALUES.has(TARGET_ORDER_TYPE),
    fulfillment_mode_single_delivery_supported: FULFILLMENT_MODE_VALUES.has(TARGET_FULFILLMENT_MODE),
    fulfillment_method_delivery_supported: FULFILLMENT_METHOD_VALUES.has(TARGET_FULFILLMENT_METHOD),
    production_status_bottled_supported: PRODUCTION_STATUS_VALUES.has(TARGET_PRODUCTION_STATUS),
    audit_trail_supported: SHOPIFY_ORDER_SCHEMA_FIELDS.has('audit_trail'),
    sync_status_supported: SHOPIFY_ORDER_SCHEMA_FIELDS.has('sync_status'),
    raw_payload_fields_omitted: true,
    customer_pii_fields_omitted: true,
    source_channel_customer_app_unsupported_so_online_is_used: true,
  };
}

function schemaBlockers() {
  const audit = schemaAudit();
  const blockers = [];
  if (!audit.source_channel_online_supported) blockers.push('source_channel_online_not_supported');
  if (!audit.order_type_one_time_supported) blockers.push('order_type_one_time_not_supported');
  if (!audit.fulfillment_mode_single_delivery_supported) blockers.push('fulfillment_mode_single_delivery_not_supported');
  if (!audit.fulfillment_method_delivery_supported) blockers.push('fulfillment_method_delivery_not_supported');
  if (!audit.production_status_bottled_supported) blockers.push('production_status_bottled_not_supported');
  if (!audit.audit_trail_supported) blockers.push('audit_trail_not_supported');
  return blockers;
}

function sanitizeLineItems(lineItems) {
  return (Array.isArray(lineItems) ? lineItems : []).slice(0, 50).map(item => compactObject({
    title: safeText(item?.title || item?.name || 'Item', 140) || 'Item',
    variant_title: safeText(item?.variant_title, 140),
    sku: safeText(item?.sku, 80),
    quantity: safeNumber(item?.quantity, 1) || 1,
    price: safeNumber(item?.price, null),
    total_discount: safeNumber(item?.total_discount, 0) || 0,
  }));
}

function buildNativeShopifyOrderRecord({ lookup, preview, user }) {
  const now = new Date().toISOString();
  const previewPacket = preview?.native_shopify_order_mirror_preview?.schema_safe_field_packet || {};
  const lineItems = sanitizeLineItems(previewPacket.line_items);
  const auditEntry = compactObject({
    at: now,
    source: FUNCTION_NAME,
    marker: G33C_MIRROR2_COMMAND_MARKER,
    source_preview: 'G33C-MIRROR1',
    action: 'create_native_one_time_shopify_order_mirror',
    request_id: lookup.requestId,
    actor_role: safeText(user?.role, 80) || 'admin',
    order_number: lookup.orderNumber,
    customer_app_order_id: lookup.customerAppOrderId,
    missing_native_reason: TARGET_MISSING_NATIVE_REASON,
    hub_bridge_status: safeText(preview?.source_audit?.hub_bridge_status, 80) || 'deduped',
    task_creation_policy: REQUIRED_TASK_CREATION_POLICY,
    notification_policy: REQUIRED_NOTIFICATION_POLICY,
    provider_call_policy: REQUIRED_PROVIDER_CALL_POLICY,
    hub_mutation_policy: REQUIRED_HUB_MUTATION_POLICY,
    raw_payload_included: false,
    notification_sent: false,
    provider_call_performed: false,
    hub_mutation_performed: false,
    customer_app_order_updated: false,
    native_fulfillment_task_created: false,
  });
  return compactObject({
    shopify_order_number: previewPacket.shopify_order_number || `#${lookup.orderNumber}`,
    description: 'G33C-MIRROR2 exact gated native ShopifyOrder mirror for one-time Customer App order. FulfillmentTask, Customer App Order update, production, notifications, providers, Hub mutation, inventory, and PO held.',
    base44_order_id: lookup.customerAppOrderId,
    source_channel: TARGET_SOURCE_CHANNEL,
    source_type: TARGET_SOURCE_TYPE,
    order_type: TARGET_ORDER_TYPE,
    fulfillment_mode: TARGET_FULFILLMENT_MODE,
    fulfillment_method: TARGET_FULFILLMENT_METHOD,
    requested_delivery_date: previewPacket.requested_delivery_date,
    assigned_delivery_date: previewPacket.assigned_delivery_date,
    selected_delivery_date: previewPacket.selected_delivery_date,
    production_date: previewPacket.production_date,
    customer_order_date: previewPacket.customer_order_date,
    requested_time_window: previewPacket.requested_time_window,
    delivery_window_label: previewPacket.delivery_window_label,
    payment_status: TARGET_PAYMENT_STATUS,
    financial_status: TARGET_FINANCIAL_STATUS,
    fulfillment_status: TARGET_FULFILLMENT_STATUS,
    shopify_fulfillment_status: TARGET_FULFILLMENT_STATUS,
    production_status: TARGET_PRODUCTION_STATUS,
    order_status: safeText(previewPacket.order_status || preview?.order_status, 120) || 'bottled_packed',
    operational_visibility: 'one_time_native_mirror_recovery',
    sync_status: TARGET_SYNC_STATUS,
    data_quality_status: 'g33c_mirror2_exact_order_preview_passed_hub_active',
    is_pos_order: false,
    is_subscription: false,
    line_items: lineItems,
    total_price: safeNumber(previewPacket.total_price ?? preview?.native_shopify_order_mirror_preview?.total_price, null),
    tags: ['g33c_mirror2', 'one_time', 'native_mirror_recovery', 'hub_active', 'no_notification'],
    internal_notes: 'Native ShopifyOrder mirror only. FulfillmentTask, Customer App Order update, ProductionBatch, BatchComplianceLog, notifications, message logs, provider calls, Hub mutation, sync/repair/replay, inventory, and PO are held.',
    audit_trail: [auditEntry],
    last_reconciliation_at: now,
    last_verified_at: now,
    manual_override: true,
    manual_override_at: now,
  });
}

function validateNativeShopifyOrderRecord(record) {
  const blockers = [];
  for (const key of Object.keys(record || {})) if (!SHOPIFY_ORDER_SCHEMA_FIELDS.has(key)) blockers.push(`unsupported_shopify_order_field:${key}`);
  if (!normalizeOrderNumber(record.shopify_order_number)) blockers.push('shopify_order_number_invalid');
  if (record.base44_order_id !== '6a060df457fc07751f3c7ded' && !record.base44_order_id) blockers.push('base44_order_id_missing');
  if (record.source_channel !== TARGET_SOURCE_CHANNEL) blockers.push('source_channel_invalid');
  if (record.source_type !== TARGET_SOURCE_TYPE) blockers.push('source_type_invalid');
  if (record.order_type !== TARGET_ORDER_TYPE) blockers.push('order_type_invalid');
  if (record.fulfillment_mode !== TARGET_FULFILLMENT_MODE) blockers.push('fulfillment_mode_invalid');
  if (record.fulfillment_method !== TARGET_FULFILLMENT_METHOD) blockers.push('fulfillment_method_invalid');
  if (record.payment_status !== TARGET_PAYMENT_STATUS || record.financial_status !== TARGET_FINANCIAL_STATUS) blockers.push('payment_status_invalid');
  if (record.fulfillment_status !== TARGET_FULFILLMENT_STATUS || record.production_status !== TARGET_PRODUCTION_STATUS) blockers.push('status_values_invalid');
  if (!Array.isArray(record.line_items) || record.line_items.length !== 3) blockers.push('line_items_invalid');
  if ('shopify_raw_payload' in record || 'customer_name' in record || 'customer_email' in record || 'customer_phone' in record || 'delivery_address' in record || 'address_line1' in record || 'address_line2' in record || 'address_city' in record || 'address_postal_code' in record || 'delivery_photo_url' in record || 'delivery_drop_location' in record || 'stripe_payment_intent_id' in record || 'stripe_customer_id' in record || 'stripe_charge_id' in record) blockers.push('forbidden_raw_provider_customer_or_delivery_field_present');
  return uniqueStrings(blockers);
}

function summarizeNativeShopifyOrder(order, skippedReason = null) {
  return {
    native_shopify_order_id: safeReferenceId(order?.id, 160) || null,
    shopify_order_number: safeText(order?.shopify_order_number, 80) || null,
    base44_order_id: safeReferenceId(order?.base44_order_id, 160) || null,
    source_type: safeText(order?.source_type, 120) || null,
    source_channel: safeText(order?.source_channel, 80) || null,
    sync_status: safeText(order?.sync_status, 140) || null,
    production_status: safeText(order?.production_status, 80) || null,
    fulfillment_status: safeText(order?.fulfillment_status, 80) || null,
    line_item_count: Array.isArray(order?.line_items) ? order.line_items.length : 0,
    customer_pii_written: Boolean(order?.customer_name || order?.customer_email || order?.customer_phone || order?.delivery_address || order?.address_line1),
    skipped_reason: skippedReason,
  };
}

async function createCommandLog({ base44, status, idempotencyKey, lookup, user, result, errorCode, errorMessage }) {
  const now = new Date().toISOString();
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: COMMAND_TYPE,
    command_source: 'customer_app_native_admin',
    status,
    target_entity: 'ShopifyOrder',
    target_id: lookup.customerAppOrderId,
    target_display_id: lookup.orderNumber,
    actor_email: safeActorEmail(user?.email) || null,
    actor_role: safeText(user?.role, 80) || null,
    actor_type: 'admin',
    payload: {
      marker: G33C_MIRROR2_COMMAND_MARKER,
      order_number: lookup.orderNumber,
      customer_app_order_id: lookup.customerAppOrderId,
      policy: REQUIRED_POLICY,
      notification_policy: REQUIRED_NOTIFICATION_POLICY,
      provider_call_policy: REQUIRED_PROVIDER_CALL_POLICY,
      hub_mutation_policy: REQUIRED_HUB_MUTATION_POLICY,
      task_creation_policy: REQUIRED_TASK_CREATION_POLICY,
      preview_mode: PREVIEW_MODE,
      confirmation_verified: true,
      raw_payload_included: false,
    },
    result,
    error_code: errorCode || null,
    error_message: errorMessage ? safeText(errorMessage, 220) : null,
    idempotency_key: idempotencyKey,
    idempotent_skipped: status === 'skipped',
    request_id: lookup.requestId,
    submitted_at: now,
    started_at: now,
    completed_at: status === 'running' ? null : now,
    duration_ms: 0,
    function_name: FUNCTION_NAME,
    related_order_id: lookup.customerAppOrderId,
    related_order_number: lookup.orderNumber,
    notes: 'G33C-MIRROR2 default-off exact one-time native ShopifyOrder mirror command. Creates only one native ShopifyOrder and one safe CommandLog when gates are open. No Customer App Order update, FulfillmentTask, ProductionBatch, BatchComplianceLog, OrderSyncLog, OrderReviewQueue, notification/message log, provider call, Hub mutation, sync/repair/replay, inventory, or PO.',
  });
}

async function updateCommandLogSafe({ base44, commandLogId, status, result, errorCode, errorMessage }) {
  try {
    if (!commandLogId) return { ok: false, error_code: 'command_log_id_missing' };
    const row = await base44.asServiceRole.entities.CommandLog.update(commandLogId, {
      status,
      result,
      error_code: errorCode || null,
      error_message: errorMessage ? safeText(errorMessage, 220) : null,
      idempotent_skipped: status === 'skipped',
      completed_at: new Date().toISOString(),
    });
    return { ok: true, commandLog: row };
  } catch (error) {
    return { ok: false, error_code: error?.code || 'command_log_update_failed', message: error?.message || 'CommandLog update failed' };
  }
}

async function createCommandLogSafe(args) {
  try {
    const row = await createCommandLog(args);
    return { ok: true, commandLog: row };
  } catch (error) {
    return { ok: false, error_code: error?.code || 'command_log_create_failed', message: error?.message || 'CommandLog create failed' };
  }
}

async function createNativeShopifyOrderSafe(base44, record) {
  try {
    const row = await base44.asServiceRole.entities.ShopifyOrder.create(record);
    return { ok: true, row };
  } catch (error) {
    return { ok: false, error_code: error?.code || 'native_shopify_order_create_failed', message: error?.message || 'Native ShopifyOrder create failed' };
  }
}

function failureBody({ lookup, errorCode, message, blockers = [], status = 409 }) {
  return {
    http_status: status,
    body: {
      success: false,
      skipped: false,
      idempotent: false,
      dry_run: false,
      writes_performed: false,
      command_type: COMMAND_TYPE,
      request_id: lookup?.requestId || null,
      order_number: lookup?.orderNumber || null,
      customer_app_order_id: lookup?.customerAppOrderId || null,
      error_code: errorCode,
      message: safeText(message || errorCode, 240),
      blockers: uniqueStrings(blockers),
      safety: safetyResult(),
    },
  };
}

function successBody({ lookup, nativeOrder = null, commandLog = null, skipped = false, idempotent = false, reason = null }) {
  return {
    success: true,
    skipped,
    idempotent,
    dry_run: false,
    writes_performed: !skipped,
    command_type: COMMAND_TYPE,
    request_id: lookup.requestId,
    order_number: lookup.orderNumber,
    customer_app_order_id: lookup.customerAppOrderId,
    native_shopify_order_created: Boolean(nativeOrder?.id) && !skipped,
    created_native_shopify_order_id: nativeOrder?.id || null,
    command_log_created: Boolean(commandLog?.id),
    command_log_id: commandLog?.id || null,
    customer_app_order_updated: false,
    native_fulfillment_task_created: false,
    production_batch_created: false,
    batch_compliance_log_created: false,
    notification_policy: REQUIRED_NOTIFICATION_POLICY,
    provider_call_policy: REQUIRED_PROVIDER_CALL_POLICY,
    hub_mutation_policy: REQUIRED_HUB_MUTATION_POLICY,
    task_creation_policy: REQUIRED_TASK_CREATION_POLICY,
    reason,
    error_code: null,
    native_shopify_order: nativeOrder ? summarizeNativeShopifyOrder(nativeOrder, skipped ? reason : null) : null,
    safety: safetyResult({
      writes_performed: !skipped,
      native_shopify_order_created: Boolean(nativeOrder?.id) && !skipped,
      command_log_created: Boolean(commandLog?.id),
    }),
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ success: false, error_code: 'method_not_allowed', message: 'POST required', writes_performed: false }, 405);

  const base44 = createClientFromRequest(req);
  const auth = await requireAdmin(base44);
  if (!auth.ok) return jsonResponse({ success: false, error_code: auth.error_code, message: auth.error_code === 'forbidden' ? 'Admin role required' : 'Unauthorized', writes_performed: false }, auth.status);

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return jsonResponse({ success: false, error_code: 'invalid_json_body', message: 'Valid JSON body required', writes_performed: false, safety: safetyResult() }, 400);

  const body = parsed.body || {};
  const badKey = unsupportedBodyKey(body);
  const lookup = getLookup(body);
  if (badKey) return jsonResponse(failureBody({ lookup, errorCode: 'unsupported_or_forbidden_input', message: `Unsupported or forbidden input: ${badKey}`, blockers: [`unsupported_or_forbidden_input:${badKey}`], status: 400 }).body, 400);

  const inputBlockers = exactInputBlockers(lookup);
  if (inputBlockers.length > 0) return jsonResponse(failureBody({ lookup, errorCode: 'invalid_one_time_shopify_order_mirror_request', message: 'Required exact one-time ShopifyOrder mirror input contract was not satisfied.', blockers: inputBlockers, status: 400 }).body, 400);

  const gateError = gateFailure({ actorEmail: auth.user?.email, lookup });
  if (gateError) return jsonResponse(failureBody({ lookup, errorCode: gateError, message: 'Native one-time ShopifyOrder mirror gate is closed.', blockers: [gateError], status: 409 }).body, 409);

  const idempotencyKey = `${COMMAND_TYPE}:${lookup.orderNumber}:${lookup.customerAppOrderId}:${lookup.requestId}`;
  const existingLogs = await findExistingCommandLog(base44, idempotencyKey);
  const existingSuccess = existingLogs.find(successfulCommandLog);
  if (existingSuccess) return jsonResponse(successBody({ lookup, nativeOrder: null, commandLog: existingSuccess, skipped: true, idempotent: true, reason: 'idempotency_log_present' }));
  if (existingLogs.some(log => normalizeLower(log.status) === 'failed')) return jsonResponse(failureBody({ lookup, errorCode: 'previous_failed_request_id_not_reusable', message: 'A failed prior CommandLog exists for this request id; choose a new approved request id after review.', blockers: ['previous_failed_request_id_not_reusable'], status: 409 }).body, 409);

  const existingNativeOrders = await findExistingNativeOrders(base44, lookup);
  const sameRequestNative = existingNativeOrders.find(row => nativeOrderCreatedByRequest(row, lookup.requestId));
  if (sameRequestNative) return jsonResponse(successBody({ lookup, nativeOrder: sameRequestNative, commandLog: null, skipped: true, idempotent: true, reason: 'native_shopify_order_already_created_by_same_request' }));
  if (existingNativeOrders.length > 0) return jsonResponse(failureBody({ lookup, errorCode: 'native_shopify_order_already_exists_for_order', message: 'Existing native ShopifyOrder context was found; duplicate mirror creation is blocked.', blockers: ['native_shopify_order_already_exists_for_order'], status: 409 }).body, 409);

  const existingNativeTasks = await findExistingNativeTasks(base44, lookup);
  if (existingNativeTasks.length > 0) return jsonResponse(failureBody({ lookup, errorCode: 'native_fulfillment_task_already_exists_for_order', message: 'Existing native FulfillmentTask context was found; task creation is not part of G33C-MIRROR2.', blockers: ['native_fulfillment_task_already_exists_for_order'], status: 409 }).body, 409);

  const preview = await previewMirrorPacket(base44, lookup);
  const previewBlockers = validatePreview(preview, lookup);
  if (previewBlockers.length > 0) return jsonResponse(failureBody({ lookup, errorCode: 'g33c_mirror1_preview_not_write_ready', message: 'Fresh G33C-MIRROR1 mirror/task parity preview is required before native ShopifyOrder mirror creation.', blockers: previewBlockers, status: 409 }).body, 409);

  const schemaMappingBlockers = schemaBlockers();
  if (schemaMappingBlockers.length > 0) return jsonResponse(failureBody({ lookup, errorCode: 'schema_contract_blocker', message: 'ShopifyOrder schema contract is not satisfied.', blockers: schemaMappingBlockers, status: 409 }).body, 409);

  const nativeRecord = buildNativeShopifyOrderRecord({ lookup, preview, user: auth.user });
  const recordBlockers = validateNativeShopifyOrderRecord(nativeRecord);
  if (recordBlockers.length > 0) return jsonResponse(failureBody({ lookup, errorCode: 'native_shopify_order_record_invalid', message: 'Native ShopifyOrder mirror record failed schema/safety validation.', blockers: recordBlockers, status: 409 }).body, 409);

  const runningLog = await createCommandLogSafe({
    base44,
    status: 'running',
    idempotencyKey,
    lookup,
    user: auth.user,
    result: {
      projected_entity: 'ShopifyOrder',
      projected_create_count: 1,
      preview_mode: PREVIEW_MODE,
      mirror_packet_ready: true,
      writes_performed: false,
      native_shopify_order_created: false,
      customer_app_order_updated: false,
      native_fulfillment_task_created: false,
      notifications_sent: false,
      provider_calls: false,
      hub_records_updated: false,
    },
  });
  if (!runningLog.ok) return jsonResponse(failureBody({ lookup, errorCode: runningLog.error_code, message: 'CommandLog creation failed before native ShopifyOrder create.', blockers: [runningLog.error_code], status: 500 }).body, 500);

  const created = await createNativeShopifyOrderSafe(base44, nativeRecord);
  if (!created.ok) {
    await updateCommandLogSafe({
      base44,
      commandLogId: runningLog.commandLog?.id,
      status: 'failed',
      result: safetyResult(),
      errorCode: created.error_code,
      errorMessage: created.message,
    });
    return jsonResponse(failureBody({ lookup, errorCode: created.error_code, message: 'Native ShopifyOrder mirror create failed safely.', blockers: [created.error_code], status: 500 }).body, 500);
  }

  const result = successBody({ lookup, nativeOrder: created.row, commandLog: runningLog.commandLog, skipped: false });
  const logUpdate = await updateCommandLogSafe({
    base44,
    commandLogId: runningLog.commandLog?.id,
    status: 'success',
    result,
    errorCode: null,
    errorMessage: null,
  });
  if (!logUpdate.ok) return jsonResponse({ ...result, success: false, error_code: logUpdate.error_code, message: 'Native ShopifyOrder mirror was created but CommandLog update failed. Manual reconciliation required before retry.', reconciliation_required: true }, 500);

  return jsonResponse({ ...result, command_log_id: logUpdate.commandLog?.id || runningLog.commandLog?.id || null });
});
