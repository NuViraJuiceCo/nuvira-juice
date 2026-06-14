import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const FUNCTION_NAME = 'createNativeOneTimeFulfillmentTaskMirrorForCustomerApp';
const G33C_TASK2_COMMAND_MARKER = 'g33c_task2_default_off_one_time_fulfillment_task_mirror_command';
const COMMAND_TYPE = 'native_one_time_fulfillment_task_mirror_create';
const ENABLE_FLAG = 'ENABLE_NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR';
const KILL_SWITCH_FLAG = 'NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_KILL_SWITCH';
const ALLOWED_EMAILS_FLAG = 'NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_ALLOWED_EMAILS';
const ORDER_ALLOWLIST_FLAG = 'NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_ORDER_ALLOWLIST';
const CUSTOMER_ORDER_ALLOWLIST_FLAG = 'NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_CUSTOMER_ORDER_ALLOWLIST';
const SHOPIFY_ORDER_ALLOWLIST_FLAG = 'NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_SHOPIFY_ORDER_ALLOWLIST';
const POLICY_FLAG = 'NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_POLICY';
const REQUIRED_POLICY = 'EXACT_ONE_TIME_FULFILLMENT_TASK_MIRROR_ONLY_NO_NOTIFICATION';
const REQUIRED_CONFIRMATION = 'create_native_one_time_fulfillment_task_mirror_no_notification';
const REQUIRED_TASK_CREATION_POLICY = 'EXACT_NATIVE_SHOPIFY_ORDER_LINK_ONLY';
const REQUIRED_NOTIFICATION_POLICY = 'NO_NOTIFICATION';
const REQUIRED_PROVIDER_CALL_POLICY = 'NO_PROVIDER_CALLS';
const REQUIRED_HUB_MUTATION_POLICY = 'NO_HUB_MUTATION';
const PREVIEW_MODE = 'ONE_TIME_NATIVE_FULFILLMENT_TASK_MIRROR_PACKET';
const TARGET_ORDER_NUMBER = 'NV-MP5SOQLJ';
const TARGET_CUSTOMER_APP_ORDER_ID = '6a060df457fc07751f3c7ded';
const TARGET_NATIVE_SHOPIFY_ORDER_ID = '6a2df0026e266e19c68046eb';
const TARGET_LINE_ITEM_COUNT = 3;
const TARGET_PAYMENT_STATUS = 'paid';
const TARGET_FULFILLMENT_TYPE = 'delivery';
const TARGET_SYNC_STATUS = 'native_one_time_fulfillment_task_mirror_g33c_task2';
const TARGET_SOURCE_CHANNEL = 'online';
const TARGET_SOURCE_TYPE = 'customer_app_one_time_native_mirror';
const TARGET_TASK_SOURCE = 'native_one_time_fulfillment_task_mirror';
const TARGET_SCHEDULE_SOURCE = 'customer_app_order';
const MAX_TEXT = 180;

const COMMAND_SUCCESS_STATUSES = new Set(['success', 'skipped']);
const FULFILLMENT_TASK_STATUS_VALUES = new Set([
  'pending',
  'scheduled',
  'assigned',
  'in_production',
  'packed',
  'bottled_packed',
  'ready_for_delivery',
  'out_for_delivery',
  'delivered',
  'unable_to_deliver',
  'needs_review',
  'cancelled',
  'Scheduled',
  'Packed',
  'Out For Delivery',
  'Delivered',
  'Cancelled',
]);

const FULFILLMENT_TASK_SCHEMA_FIELDS = new Set([
  'order_id',
  'base44_order_id',
  'shopify_order_id',
  'native_shopify_order_id',
  'shopify_order_number',
  'order_number',
  'fulfillment_task_id',
  'customer_name',
  'customer_email',
  'customer_phone',
  'source_channel',
  'source_type',
  'task_source',
  'created_from_native_ops',
  'order_type',
  'fulfillment_type',
  'fulfillment_number',
  'delivery_date',
  'scheduled_date',
  'assigned_delivery_date',
  'production_date',
  'time_window',
  'delivery_window_label',
  'address',
  'delivery_address',
  'address_line1',
  'address_line2',
  'address_city',
  'address_state',
  'address_postal_code',
  'items',
  'items_summary',
  'line_item_count',
  'total_price',
  'address_complete',
  'status',
  'delivery_status',
  'production_status',
  'payment_status',
  'sync_status',
  'schedule_source',
  'stripe_subscription_id',
  'customer_app_subscription_id',
  'plan_id',
  'plan_name',
  'cadence',
  'assigned_driver',
  'assigned_driver_id',
  'assigned_driver_email',
  'assigned_at',
  'packed_at',
  'out_for_delivery_at',
  'delivered_at',
  'route_id',
  'delivery_zone_key',
  'route_stop_sequence',
  'driver_notes',
  'internal_notes',
  'review_status',
  'review_reason',
  'created_from_order_sync_log_id',
  'command_log_id',
  'audit_trail',
  'notes',
]);

const ALLOWED_BODY_KEYS = new Set([
  'order_number',
  'shopify_order_number',
  'customer_app_order_id',
  'base44_order_id',
  'order_id',
  'native_shopify_order_id',
  'native_order_id',
  'shopify_order_id',
  'task_creation_policy',
  'notification_policy',
  'provider_call_policy',
  'hub_mutation_policy',
  'request_id',
  'confirmation',
]);

const FORBIDDEN_BODY_KEYS = new Set([
  'customer_app_order_update',
  'update_customer_app_order',
  'customer_app_order_payload',
  'native_shopify_order_update',
  'shopify_order_update',
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
  'bulk_shopify_order_ids',
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

function operationalText(value, maxLength = MAX_TEXT) {
  const text = normalizeSingleLine(value).replace(/[\u0000-\u001f\u007f]/g, '');
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function safeReferenceId(value, maxLength = MAX_TEXT) {
  const text = safeText(value, maxLength);
  if (!text || text.length > maxLength) return '';
  if (!/^[A-Za-z0-9._:@/#-]+$/.test(text)) return '';
  return text;
}

function safeActorEmail(value) {
  const email = normalizeSingleLine(value).toLowerCase();
  return email && email.length <= 180 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function isValidEmail(value) {
  const email = normalizeSingleLine(value).toLowerCase();
  return email && email.length <= 180 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function safeNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, item]) => item !== undefined && item !== null && item !== ''));
}

function parseCsvSet(value) {
  return new Set(normalizeText(value).split(',').map(normalizeLower).filter(Boolean));
}

function uniqueStrings(values, limit = 160) {
  return [...new Set((values || []).map(value => safeText(value, 220)).filter(Boolean))].slice(0, limit);
}

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
}

function safetyResult(overrides = {}) {
  return {
    writes_performed: false,
    native_fulfillment_task_created: false,
    command_log_created: false,
    customer_app_order_updated: false,
    native_shopify_order_updated: false,
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
    if (/(^|_)(raw|payload|provider|stripe|shopify_api|inventory|purchase|notification|message|sync|repair|replay|bulk|batch|compliance|customer_app_order_update|native_shopify_order_update|secret|token|headers|authorization|proof|drop|route)($|_)/i.test(normalized)) return key;
    return key;
  }
  return null;
}

function getLookup(body) {
  return {
    orderNumber: normalizeOrderNumber(body?.order_number || body?.shopify_order_number),
    customerAppOrderId: safeReferenceId(body?.customer_app_order_id || body?.base44_order_id || body?.order_id, 180),
    nativeShopifyOrderId: safeReferenceId(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id, 180),
    taskCreationPolicy: normalizeUpper(body?.task_creation_policy),
    notificationPolicy: normalizeUpper(body?.notification_policy),
    providerCallPolicy: normalizeUpper(body?.provider_call_policy),
    hubMutationPolicy: normalizeUpper(body?.hub_mutation_policy),
    requestId: safeReferenceId(body?.request_id, 180),
    confirmation: normalizeText(body?.confirmation),
  };
}

function exactInputBlockers(lookup) {
  const blockers = [];
  if (lookup.orderNumber !== TARGET_ORDER_NUMBER) blockers.push('target_order_number_mismatch');
  if (lookup.customerAppOrderId !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('target_customer_app_order_id_mismatch');
  if (lookup.nativeShopifyOrderId !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('target_native_shopify_order_id_mismatch');
  if (lookup.taskCreationPolicy !== REQUIRED_TASK_CREATION_POLICY) blockers.push('task_creation_policy_must_be_exact_native_shopify_order_link_only');
  if (lookup.notificationPolicy !== REQUIRED_NOTIFICATION_POLICY) blockers.push('notification_policy_must_be_no_notification');
  if (lookup.providerCallPolicy !== REQUIRED_PROVIDER_CALL_POLICY) blockers.push('provider_call_policy_must_be_no_provider_calls');
  if (lookup.hubMutationPolicy !== REQUIRED_HUB_MUTATION_POLICY) blockers.push('hub_mutation_policy_must_be_no_hub_mutation');
  if (!lookup.requestId) blockers.push('request_id_required');
  if (lookup.confirmation !== REQUIRED_CONFIRMATION) blockers.push('confirmation_phrase_required');
  return blockers;
}

function gateFailure({ actorEmail, lookup }) {
  if (Deno.env.get(KILL_SWITCH_FLAG) === 'true') return 'kill_switch_active';
  if (Deno.env.get(ENABLE_FLAG) !== 'true') return 'native_one_time_fulfillment_task_mirror_disabled';
  if (normalizeText(Deno.env.get(POLICY_FLAG)) !== REQUIRED_POLICY) return 'native_one_time_fulfillment_task_mirror_policy_required';

  const allowedEmails = parseCsvSet(Deno.env.get(ALLOWED_EMAILS_FLAG) || '');
  if (allowedEmails.size === 0) return 'allowed_email_gate_required';
  if (!allowedEmails.has(normalizeLower(actorEmail))) return 'actor_email_not_allowlisted';

  const orderAllowlist = parseCsvSet(Deno.env.get(ORDER_ALLOWLIST_FLAG) || '');
  if (orderAllowlist.size === 0) return 'order_allowlist_required';
  if (!orderAllowlist.has(normalizeLower(lookup.orderNumber)) && !orderAllowlist.has(normalizeLower(`#${lookup.orderNumber}`))) return 'order_not_allowlisted';

  const customerOrderAllowlist = parseCsvSet(Deno.env.get(CUSTOMER_ORDER_ALLOWLIST_FLAG) || '');
  if (customerOrderAllowlist.size === 0) return 'customer_order_allowlist_required';
  if (!customerOrderAllowlist.has(normalizeLower(lookup.customerAppOrderId))) return 'customer_order_not_allowlisted';

  const shopifyOrderAllowlist = parseCsvSet(Deno.env.get(SHOPIFY_ORDER_ALLOWLIST_FLAG) || '');
  if (shopifyOrderAllowlist.size === 0) return 'native_shopify_order_allowlist_required';
  if (!shopifyOrderAllowlist.has(normalizeLower(lookup.nativeShopifyOrderId))) return 'native_shopify_order_not_allowlisted';

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

async function getEntity(base44, entityName, id) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity?.get || !id) return null;
  return entity.get(id).catch(() => null);
}

async function findCustomerOrder(base44, lookup) {
  const byId = await getEntity(base44, 'Order', lookup.customerAppOrderId);
  if (byId?.id) return byId;
  const rows = await filterEntity(base44, 'Order', { order_number: lookup.orderNumber }, '-created_date', 5);
  return rows.find(row => normalizeText(row?.id) === lookup.customerAppOrderId) || rows[0] || null;
}

async function findNativeShopifyOrder(base44, lookup) {
  const rows = [];
  const byId = await getEntity(base44, 'ShopifyOrder', lookup.nativeShopifyOrderId);
  if (byId?.id) rows.push(byId);
  rows.push(...await filterEntity(base44, 'ShopifyOrder', { id: lookup.nativeShopifyOrderId }, '-created_date', 5));
  rows.push(...await filterEntity(base44, 'ShopifyOrder', { base44_order_id: lookup.customerAppOrderId }, '-created_date', 20));
  rows.push(...await filterEntity(base44, 'ShopifyOrder', { shopify_order_number: lookup.orderNumber }, '-created_date', 20));
  rows.push(...await filterEntity(base44, 'ShopifyOrder', { shopify_order_number: `#${lookup.orderNumber}` }, '-created_date', 20));
  const unique = [...new Map(rows.map(row => [row?.id || JSON.stringify(row), row])).values()];
  return unique.find(row => normalizeText(row?.id) === lookup.nativeShopifyOrderId) || null;
}

async function findExistingNativeTasks(base44, lookup) {
  const rows = [];
  rows.push(...await filterEntity(base44, 'FulfillmentTask', { native_shopify_order_id: lookup.nativeShopifyOrderId }, '-created_date', 20));
  rows.push(...await filterEntity(base44, 'FulfillmentTask', { shopify_order_id: lookup.nativeShopifyOrderId }, '-created_date', 20));
  rows.push(...await filterEntity(base44, 'FulfillmentTask', { order_id: lookup.customerAppOrderId }, '-created_date', 20));
  rows.push(...await filterEntity(base44, 'FulfillmentTask', { base44_order_id: lookup.customerAppOrderId }, '-created_date', 20));
  rows.push(...await filterEntity(base44, 'FulfillmentTask', { order_number: lookup.orderNumber }, '-created_date', 20));
  rows.push(...await filterEntity(base44, 'FulfillmentTask', { shopify_order_number: lookup.orderNumber }, '-created_date', 20));
  rows.push(...await filterEntity(base44, 'FulfillmentTask', { shopify_order_number: `#${lookup.orderNumber}` }, '-created_date', 20));
  return [...new Map(rows.map(row => [row?.id || JSON.stringify(row), row])).values()];
}

async function findExistingCommandLog(base44, idempotencyKey) {
  return filterEntity(base44, 'CommandLog', { idempotency_key: idempotencyKey }, '-created_date', 5);
}

function successfulCommandLog(log) {
  return log && COMMAND_SUCCESS_STATUSES.has(normalizeLower(log.status)) && !log.error_code;
}

function nativeTaskCreatedByRequest(row, requestId) {
  return Array.isArray(row?.audit_trail) && row.audit_trail.some(entry => normalizeText(entry?.request_id) === requestId && normalizeText(entry?.source) === FUNCTION_NAME);
}

async function previewTaskPacket(base44, lookup) {
  const payload = {
    preview_mode: PREVIEW_MODE,
    order_number: lookup.orderNumber,
    customer_app_order_id: lookup.customerAppOrderId,
    native_shopify_order_id: lookup.nativeShopifyOrderId,
    task_creation_policy: 'HELD_UNTIL_NATIVE_SHOPIFY_ORDER_EXISTS',
    notification_policy: REQUIRED_NOTIFICATION_POLICY,
    provider_call_policy: REQUIRED_PROVIDER_CALL_POLICY,
    hub_mutation_policy: REQUIRED_HUB_MUTATION_POLICY,
    request_id: `${lookup.requestId}:g33c_task2_prewrite_preview`,
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

function definedEvidence(value) {
  return value !== undefined && value !== null && value !== '';
}

function firstEvidence(candidates) {
  for (const candidate of candidates) if (definedEvidence(candidate?.value)) return { value: candidate.value, path: candidate.path };
  return { value: undefined, path: candidates.map(candidate => candidate.path).join('|') };
}

function resolveTask1PreviewEvidence(preview) {
  const packet = preview?.proposed_native_fulfillment_task_packet || {};
  return {
    order_number: firstEvidence([
      { value: preview?.order_number, path: 'order_number' },
      { value: packet.order_number, path: 'proposed_native_fulfillment_task_packet.order_number' },
    ]),
    customer_app_order_id: firstEvidence([
      { value: preview?.customer_app_order_id, path: 'customer_app_order_id' },
      { value: packet.base44_order_id, path: 'proposed_native_fulfillment_task_packet.base44_order_id' },
      { value: packet.order_id, path: 'proposed_native_fulfillment_task_packet.order_id' },
    ]),
    native_shopify_order_id: firstEvidence([
      { value: preview?.native_shopify_order_id, path: 'native_shopify_order_id' },
      { value: packet.native_shopify_order_id, path: 'proposed_native_fulfillment_task_packet.native_shopify_order_id' },
      { value: packet.shopify_order_id, path: 'proposed_native_fulfillment_task_packet.shopify_order_id' },
    ]),
    payment_status: firstEvidence([
      { value: packet.payment_status, path: 'proposed_native_fulfillment_task_packet.payment_status' },
    ]),
    fulfillment_type: firstEvidence([
      { value: packet.fulfillment_type, path: 'proposed_native_fulfillment_task_packet.fulfillment_type' },
    ]),
    delivery_date: firstEvidence([
      { value: packet.delivery_date, path: 'proposed_native_fulfillment_task_packet.delivery_date' },
      { value: packet.scheduled_date, path: 'proposed_native_fulfillment_task_packet.scheduled_date' },
    ]),
    production_date: firstEvidence([
      { value: packet.production_date, path: 'proposed_native_fulfillment_task_packet.production_date' },
    ]),
    line_item_count: firstEvidence([
      { value: packet.line_item_count, path: 'proposed_native_fulfillment_task_packet.line_item_count' },
      { value: Array.isArray(packet.items) ? packet.items.length : undefined, path: 'proposed_native_fulfillment_task_packet.items.length' },
    ]),
    status: firstEvidence([
      { value: packet.status, path: 'proposed_native_fulfillment_task_packet.status' },
    ]),
    delivery_status: firstEvidence([
      { value: packet.delivery_status, path: 'proposed_native_fulfillment_task_packet.delivery_status' },
    ]),
    production_status: firstEvidence([
      { value: packet.production_status, path: 'proposed_native_fulfillment_task_packet.production_status' },
    ]),
    address_complete: firstEvidence([
      { value: packet.address_complete, path: 'proposed_native_fulfillment_task_packet.address_complete' },
    ]),
    provider_call_impact: firstEvidence([
      { value: preview?.provider_call_impact, path: 'provider_call_impact' },
    ]),
    notification_held: firstEvidence([
      { value: preview?.notification_impact?.notification_held, path: 'notification_impact.notification_held' },
    ]),
    notification_would_send: firstEvidence([
      { value: preview?.notification_impact?.notification_would_send, path: 'notification_impact.notification_would_send' },
    ]),
  };
}

function missingPreviewEvidenceBlocker(evidence, label) {
  return definedEvidence(evidence?.value) ? null : `missing_preview_evidence:${label}:${safeText(evidence?.path, 220)}`;
}

function validatePreview(preview, lookup) {
  const blockers = [];
  const evidence = resolveTask1PreviewEvidence(preview);
  if (!preview?.success) blockers.push(preview?.error_code || 'g33c_task1_preview_failed');
  if (preview?.dry_run !== true) blockers.push('g33c_task1_preview_not_dry_run');
  if (preview?.writes_performed !== false) blockers.push('g33c_task1_preview_writes_flag_not_false');
  if (preview?.preview_mode !== PREVIEW_MODE) blockers.push('g33c_task1_preview_mode_mismatch');
  if (normalizeOrderNumber(evidence.order_number.value) !== lookup.orderNumber) blockers.push('g33c_task1_order_number_mismatch');
  if (normalizeText(evidence.customer_app_order_id.value) !== lookup.customerAppOrderId) blockers.push('g33c_task1_customer_app_order_id_mismatch');
  if (normalizeText(evidence.native_shopify_order_id.value) !== lookup.nativeShopifyOrderId) blockers.push('g33c_task1_native_shopify_order_id_mismatch');
  if (preview?.native_shopify_order_present !== true) blockers.push('native_shopify_order_missing_in_preview');
  if (preview?.native_fulfillment_task_present !== false) blockers.push('native_fulfillment_task_already_present_in_preview');
  if (preview?.task_packet_ready !== true) blockers.push('task_packet_not_ready');
  if (preview?.duplicate_task_risk !== false) blockers.push('duplicate_task_risk_not_false');
  for (const [label, item] of Object.entries({
    payment_status: evidence.payment_status,
    fulfillment_type: evidence.fulfillment_type,
    delivery_date: evidence.delivery_date,
    production_date: evidence.production_date,
    line_item_count: evidence.line_item_count,
    status: evidence.status,
    provider_call_impact: evidence.provider_call_impact,
    notification_held: evidence.notification_held,
  })) {
    const missing = missingPreviewEvidenceBlocker(item, label);
    if (missing) blockers.push(missing);
  }
  if (normalizeLower(evidence.payment_status.value) !== TARGET_PAYMENT_STATUS) blockers.push('payment_status_not_paid');
  if (normalizeLower(evidence.fulfillment_type.value) !== TARGET_FULFILLMENT_TYPE) blockers.push('fulfillment_type_not_delivery');
  if (safeNumber(evidence.line_item_count.value, null) !== TARGET_LINE_ITEM_COUNT) blockers.push('line_item_count_must_be_3');
  if (!evidence.delivery_date.value) blockers.push('delivery_date_required');
  if (!evidence.production_date.value) blockers.push('production_date_required');
  if (!FULFILLMENT_TASK_STATUS_VALUES.has(normalizeText(evidence.status.value))) blockers.push('invalid_fulfillment_task_status');
  if (evidence.address_complete.value !== true) blockers.push('delivery_address_context_not_complete');
  if (evidence.provider_call_impact.value !== false) blockers.push('provider_call_impact_not_false');
  if (evidence.notification_held.value !== true) blockers.push('notifications_not_held');
  if (evidence.notification_would_send.value === true) blockers.push('notification_would_send');
  if (preview?.hub_mutation_performed === true || preview?.safety?.hub_records_updated === true || preview?.safety?.hub_bridge_modified === true) blockers.push('hub_mutation_projected');
  if (Array.isArray(preview?.blockers) && preview.blockers.length > 0) blockers.push('g33c_task1_preview_blockers_present');
  if (Array.isArray(preview?.schema_packet_blockers) && preview.schema_packet_blockers.length > 0) blockers.push('g33c_task1_schema_packet_blockers_present');
  return uniqueStrings(blockers);
}

function schemaAudit() {
  return {
    schema: 'FulfillmentTask',
    required_fields: ['order_id', 'customer_email', 'fulfillment_number', 'delivery_date'],
    customer_email_required: true,
    status_bottled_packed_supported: FULFILLMENT_TASK_STATUS_VALUES.has('bottled_packed'),
    command_log_supported: true,
    audit_trail_supported: FULFILLMENT_TASK_SCHEMA_FIELDS.has('audit_trail'),
    raw_payload_fields_omitted: true,
    customer_email_hydrated_internally_not_returned: true,
  };
}

function schemaBlockers({ customerOrder, preview }) {
  const blockers = [];
  const audit = schemaAudit();
  const evidence = resolveTask1PreviewEvidence(preview);
  const email = normalizeSingleLine(customerOrder?.customer_email || customerOrder?.email);
  if (!audit.status_bottled_packed_supported && normalizeText(evidence.status.value) === 'bottled_packed') blockers.push('status_bottled_packed_not_schema_supported');
  if (!audit.audit_trail_supported) blockers.push('audit_trail_not_supported');
  if (!isValidEmail(email)) blockers.push('customer_email_required_for_fulfillment_task_missing');
  return blockers;
}

function sanitizeItems(items) {
  return (Array.isArray(items) ? items : []).slice(0, 50).map(item => compactObject({
    product_id: safeReferenceId(item?.product_id, 120),
    title: safeText(item?.title || item?.name || 'Item', 140) || 'Item',
    quantity: safeNumber(item?.quantity, 1) || 1,
    price: safeNumber(item?.price, null),
  }));
}

function oneLineAddress(customerOrder) {
  return operationalText(customerOrder?.address || customerOrder?.delivery_address || [
    customerOrder?.address_line1,
    customerOrder?.address_city,
    customerOrder?.address_state,
    customerOrder?.address_postal_code,
  ].filter(Boolean).join(', '), 280);
}

function structuredAddress(customerOrder) {
  const source = customerOrder?.delivery_address && typeof customerOrder.delivery_address === 'object' && !Array.isArray(customerOrder.delivery_address)
    ? customerOrder.delivery_address
    : {};
  return compactObject({
    address_line1: operationalText(customerOrder?.address_line1 || source.address_line1 || source.line1, 160),
    address_line2: operationalText(customerOrder?.address_line2 || source.address_line2 || source.line2, 160),
    city: operationalText(customerOrder?.address_city || source.city, 120),
    state: operationalText(customerOrder?.address_state || source.state, 80),
    postal_code: operationalText(customerOrder?.address_postal_code || source.postal_code || source.zip, 40),
  });
}

function buildNativeFulfillmentTaskRecord({ lookup, preview, customerOrder, nativeShopifyOrder, user }) {
  const packet = preview?.proposed_native_fulfillment_task_packet || {};
  const now = new Date().toISOString();
  const addressObject = structuredAddress(customerOrder);
  const auditEntry = compactObject({
    at: now,
    source: FUNCTION_NAME,
    marker: G33C_TASK2_COMMAND_MARKER,
    source_preview: 'G33C-TASK1',
    action: 'create_native_one_time_fulfillment_task_mirror',
    request_id: lookup.requestId,
    actor_role: safeText(user?.role, 80) || 'admin',
    order_number: lookup.orderNumber,
    customer_app_order_id: lookup.customerAppOrderId,
    native_shopify_order_id: lookup.nativeShopifyOrderId,
    notification_policy: REQUIRED_NOTIFICATION_POLICY,
    provider_call_policy: REQUIRED_PROVIDER_CALL_POLICY,
    hub_mutation_policy: REQUIRED_HUB_MUTATION_POLICY,
    task_creation_policy: REQUIRED_TASK_CREATION_POLICY,
    customer_email_hydrated_internally: true,
    raw_payload_included: false,
    notification_sent: false,
    provider_call_performed: false,
    hub_mutation_performed: false,
    customer_app_order_updated: false,
    native_shopify_order_updated: false,
    production_batch_created: false,
    batch_compliance_log_created: false,
  });
  return compactObject({
    order_id: lookup.customerAppOrderId,
    base44_order_id: lookup.customerAppOrderId,
    shopify_order_id: lookup.nativeShopifyOrderId,
    native_shopify_order_id: lookup.nativeShopifyOrderId,
    shopify_order_number: packet.shopify_order_number || nativeShopifyOrder?.shopify_order_number || `#${lookup.orderNumber}`,
    order_number: lookup.orderNumber,
    customer_email: normalizeSingleLine(customerOrder?.customer_email || customerOrder?.email).toLowerCase(),
    source_channel: TARGET_SOURCE_CHANNEL,
    source_type: TARGET_SOURCE_TYPE,
    task_source: TARGET_TASK_SOURCE,
    created_from_native_ops: true,
    order_type: 'one_time',
    fulfillment_type: TARGET_FULFILLMENT_TYPE,
    fulfillment_number: safeNumber(packet.fulfillment_number, 1) || 1,
    delivery_date: safeText(packet.delivery_date, 40),
    scheduled_date: safeText(packet.scheduled_date || packet.delivery_date, 40),
    assigned_delivery_date: safeText(packet.assigned_delivery_date || packet.delivery_date, 40),
    production_date: safeText(packet.production_date, 40),
    time_window: safeText(packet.time_window, 120),
    delivery_window_label: safeText(packet.delivery_window_label, 120),
    address: oneLineAddress(customerOrder),
    delivery_address: Object.keys(addressObject).length ? addressObject : undefined,
    address_line1: operationalText(customerOrder?.address_line1 || addressObject.address_line1, 160),
    address_line2: operationalText(customerOrder?.address_line2 || addressObject.address_line2, 160),
    address_city: operationalText(customerOrder?.address_city || addressObject.city, 120),
    address_state: operationalText(customerOrder?.address_state || addressObject.state, 80),
    address_postal_code: operationalText(customerOrder?.address_postal_code || addressObject.postal_code, 40),
    items: sanitizeItems(packet.items),
    items_summary: safeText(packet.items_summary, 120) || `${TARGET_LINE_ITEM_COUNT} line items`,
    line_item_count: TARGET_LINE_ITEM_COUNT,
    total_price: safeNumber(packet.total_price, safeNumber(customerOrder?.total_price || customerOrder?.total, null)),
    address_complete: packet.address_complete === true,
    status: safeText(packet.status, 80),
    delivery_status: safeText(packet.delivery_status, 80) || 'pending',
    production_status: safeText(packet.production_status, 80) || 'bottled',
    payment_status: TARGET_PAYMENT_STATUS,
    sync_status: TARGET_SYNC_STATUS,
    schedule_source: TARGET_SCHEDULE_SOURCE,
    internal_notes: 'G33C-TASK2 exact gated native FulfillmentTask mirror. Customer App Order, native ShopifyOrder, ProductionBatch, BatchComplianceLog, notifications, providers, Hub mutation, sync/repair/replay, inventory, and PO are held.',
    review_status: 'mirror_created',
    review_reason: 'exact_owner_approved_native_task_mirror_only',
    audit_trail: [auditEntry],
    notes: 'No notification, provider call, Hub mutation, production batch, inventory, PO, proof, drop, or route action approved.',
  });
}

function validateNativeFulfillmentTaskRecord(record) {
  const blockers = [];
  for (const key of Object.keys(record || {})) if (!FULFILLMENT_TASK_SCHEMA_FIELDS.has(key)) blockers.push(`unsupported_fulfillment_task_field:${key}`);
  if (record.order_id !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('order_id_invalid');
  if (record.base44_order_id !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('base44_order_id_invalid');
  if (record.native_shopify_order_id !== TARGET_NATIVE_SHOPIFY_ORDER_ID || record.shopify_order_id !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('native_shopify_order_link_invalid');
  if (normalizeOrderNumber(record.order_number) !== TARGET_ORDER_NUMBER) blockers.push('order_number_invalid');
  if (!isValidEmail(record.customer_email)) blockers.push('customer_email_required_for_fulfillment_task_missing');
  if (record.source_channel !== TARGET_SOURCE_CHANNEL) blockers.push('source_channel_invalid');
  if (record.source_type !== TARGET_SOURCE_TYPE) blockers.push('source_type_invalid');
  if (record.task_source !== TARGET_TASK_SOURCE) blockers.push('task_source_invalid');
  if (record.fulfillment_type !== TARGET_FULFILLMENT_TYPE) blockers.push('fulfillment_type_invalid');
  if (record.payment_status !== TARGET_PAYMENT_STATUS) blockers.push('payment_status_invalid');
  if (record.line_item_count !== TARGET_LINE_ITEM_COUNT) blockers.push('line_item_count_invalid');
  if (!record.delivery_date) blockers.push('delivery_date_required');
  if (!record.production_date) blockers.push('production_date_required');
  if (!FULFILLMENT_TASK_STATUS_VALUES.has(record.status)) blockers.push('invalid_fulfillment_task_status');
  if (!Array.isArray(record.items) || record.items.length !== TARGET_LINE_ITEM_COUNT) blockers.push('items_invalid');
  if ('raw_payload' in record || 'raw_customer_app_payload' in record || 'raw_hub_payload' in record || 'raw_shopify_payload' in record || 'raw_stripe_payload' in record || 'provider_payload' in record || 'notification_payload' in record || 'proof_url' in record || 'drop_location' in record || 'route_stop_sequence' in record) blockers.push('forbidden_raw_provider_notification_or_delivery_field_present');
  return uniqueStrings(blockers);
}

function summarizeNativeFulfillmentTask(task, skippedReason = null) {
  return {
    native_fulfillment_task_id: safeReferenceId(task?.id, 160) || null,
    order_number: safeText(task?.order_number || task?.shopify_order_number, 80) || null,
    base44_order_id: safeReferenceId(task?.base44_order_id || task?.order_id, 160) || null,
    native_shopify_order_id: safeReferenceId(task?.native_shopify_order_id || task?.shopify_order_id, 160) || null,
    source_type: safeText(task?.source_type, 120) || null,
    source_channel: safeText(task?.source_channel, 80) || null,
    task_source: safeText(task?.task_source, 120) || null,
    sync_status: safeText(task?.sync_status, 140) || null,
    status: safeText(task?.status, 80) || null,
    delivery_status: safeText(task?.delivery_status, 80) || null,
    production_status: safeText(task?.production_status, 80) || null,
    payment_status: safeText(task?.payment_status, 80) || null,
    delivery_date: safeText(task?.delivery_date, 40) || null,
    production_date: safeText(task?.production_date, 40) || null,
    line_item_count: safeNumber(task?.line_item_count, Array.isArray(task?.items) ? task.items.length : 0),
    customer_email_present: Boolean(task?.customer_email),
    customer_email_returned: false,
    raw_payload_written: false,
    skipped_reason: skippedReason,
  };
}

async function createCommandLog({ base44, status, idempotencyKey, lookup, user, result, errorCode, errorMessage }) {
  const now = new Date().toISOString();
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: COMMAND_TYPE,
    command_source: 'customer_app_native_admin',
    status,
    target_entity: 'FulfillmentTask',
    target_id: lookup.customerAppOrderId,
    target_display_id: lookup.orderNumber,
    actor_email: safeActorEmail(user?.email) || null,
    actor_role: safeText(user?.role, 80) || null,
    actor_type: 'admin',
    payload: {
      marker: G33C_TASK2_COMMAND_MARKER,
      order_number: lookup.orderNumber,
      customer_app_order_id: lookup.customerAppOrderId,
      native_shopify_order_id: lookup.nativeShopifyOrderId,
      policy: REQUIRED_POLICY,
      notification_policy: REQUIRED_NOTIFICATION_POLICY,
      provider_call_policy: REQUIRED_PROVIDER_CALL_POLICY,
      hub_mutation_policy: REQUIRED_HUB_MUTATION_POLICY,
      task_creation_policy: REQUIRED_TASK_CREATION_POLICY,
      preview_mode: PREVIEW_MODE,
      confirmation_verified: true,
      customer_email_hydrated_internally_not_logged: true,
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
    notes: 'G33C-TASK2 default-off exact one-time native FulfillmentTask mirror command. Creates only one native FulfillmentTask and one safe CommandLog when gates are open. No Customer App Order update, native ShopifyOrder update, ProductionBatch, BatchComplianceLog, OrderSyncLog, OrderReviewQueue, notification/message log, provider call, Hub mutation, sync/repair/replay, inventory, or PO.',
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

async function createNativeFulfillmentTaskSafe(base44, record) {
  try {
    const row = await base44.asServiceRole.entities.FulfillmentTask.create(record);
    return { ok: true, row };
  } catch (error) {
    return { ok: false, error_code: error?.code || 'native_fulfillment_task_create_failed', message: error?.message || 'Native FulfillmentTask create failed' };
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
      native_shopify_order_id: lookup?.nativeShopifyOrderId || null,
      error_code: errorCode,
      message: safeText(message || errorCode, 240),
      blockers: uniqueStrings(blockers),
      safety: safetyResult(),
    },
  };
}

function successBody({ lookup, task = null, commandLog = null, skipped = false, idempotent = false, reason = null }) {
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
    native_shopify_order_id: lookup.nativeShopifyOrderId,
    native_fulfillment_task_created: Boolean(task?.id) && !skipped,
    created_native_fulfillment_task_id: task?.id || null,
    command_log_created: Boolean(commandLog?.id),
    command_log_id: commandLog?.id || null,
    customer_app_order_updated: false,
    native_shopify_order_updated: false,
    production_batch_created: false,
    batch_compliance_log_created: false,
    order_sync_log_created: false,
    order_review_queue_created: false,
    notifications_created: false,
    notifications_sent: false,
    provider_calls: false,
    stripe_calls: false,
    shopify_calls: false,
    hub_records_updated: false,
    inventory_mutation: false,
    purchase_order_created: false,
    notification_policy: REQUIRED_NOTIFICATION_POLICY,
    provider_call_policy: REQUIRED_PROVIDER_CALL_POLICY,
    hub_mutation_policy: REQUIRED_HUB_MUTATION_POLICY,
    task_creation_policy: REQUIRED_TASK_CREATION_POLICY,
    reason,
    error_code: null,
    native_fulfillment_task: task ? summarizeNativeFulfillmentTask(task, skipped ? reason : null) : null,
    safety: safetyResult({
      writes_performed: !skipped,
      native_fulfillment_task_created: Boolean(task?.id) && !skipped,
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
  if (inputBlockers.length > 0) return jsonResponse(failureBody({ lookup, errorCode: 'invalid_one_time_fulfillment_task_mirror_request', message: 'Required exact one-time FulfillmentTask mirror input contract was not satisfied.', blockers: inputBlockers, status: 400 }).body, 400);

  const gateError = gateFailure({ actorEmail: auth.user?.email, lookup });
  if (gateError) return jsonResponse(failureBody({ lookup, errorCode: gateError, message: 'Native one-time FulfillmentTask mirror gate is closed.', blockers: [gateError], status: 409 }).body, 409);

  const idempotencyKey = `${COMMAND_TYPE}:${lookup.orderNumber}:${lookup.customerAppOrderId}:${lookup.nativeShopifyOrderId}:${lookup.requestId}`;
  const existingLogs = await findExistingCommandLog(base44, idempotencyKey);
  const existingSuccess = existingLogs.find(successfulCommandLog);
  if (existingSuccess) return jsonResponse(successBody({ lookup, task: null, commandLog: existingSuccess, skipped: true, idempotent: true, reason: 'idempotency_log_present' }));
  if (existingLogs.some(log => normalizeLower(log.status) === 'failed')) return jsonResponse(failureBody({ lookup, errorCode: 'previous_failed_request_id_not_reusable', message: 'A failed prior CommandLog exists for this request id; choose a new approved request id after review.', blockers: ['previous_failed_request_id_not_reusable'], status: 409 }).body, 409);

  const customerOrder = await findCustomerOrder(base44, lookup);
  if (!customerOrder?.id) return jsonResponse(failureBody({ lookup, errorCode: 'customer_app_order_missing', message: 'Customer App Order was not found for exact target.', blockers: ['customer_app_order_missing'], status: 409 }).body, 409);

  const nativeShopifyOrder = await findNativeShopifyOrder(base44, lookup);
  if (!nativeShopifyOrder?.id) return jsonResponse(failureBody({ lookup, errorCode: 'native_shopify_order_missing', message: 'Native ShopifyOrder was not found for exact target.', blockers: ['native_shopify_order_missing'], status: 409 }).body, 409);

  const existingNativeTasks = await findExistingNativeTasks(base44, lookup);
  const sameRequestTask = existingNativeTasks.find(row => nativeTaskCreatedByRequest(row, lookup.requestId));
  if (sameRequestTask) return jsonResponse(successBody({ lookup, task: sameRequestTask, commandLog: null, skipped: true, idempotent: true, reason: 'native_fulfillment_task_already_created_by_same_request' }));
  if (existingNativeTasks.length > 0) return jsonResponse(failureBody({ lookup, errorCode: 'native_fulfillment_task_already_exists_for_order', message: 'Existing native FulfillmentTask context was found; duplicate task mirror creation is blocked.', blockers: ['native_fulfillment_task_already_exists_for_order'], status: 409 }).body, 409);

  const preview = await previewTaskPacket(base44, lookup);
  const previewBlockers = validatePreview(preview, lookup);
  if (previewBlockers.length > 0) return jsonResponse(failureBody({ lookup, errorCode: 'g33c_task1_preview_not_write_ready', message: 'Fresh G33C-TASK1 FulfillmentTask packet preview is required before native FulfillmentTask mirror creation.', blockers: previewBlockers, status: 409 }).body, 409);

  const schemaMappingBlockers = schemaBlockers({ customerOrder, preview });
  if (schemaMappingBlockers.length > 0) return jsonResponse(failureBody({ lookup, errorCode: 'schema_contract_blocker', message: 'FulfillmentTask schema contract is not satisfied.', blockers: schemaMappingBlockers, status: 409 }).body, 409);

  const nativeRecord = buildNativeFulfillmentTaskRecord({ lookup, preview, customerOrder, nativeShopifyOrder, user: auth.user });
  const recordBlockers = validateNativeFulfillmentTaskRecord(nativeRecord);
  if (recordBlockers.length > 0) return jsonResponse(failureBody({ lookup, errorCode: 'native_fulfillment_task_record_invalid', message: 'Native FulfillmentTask mirror record failed schema/safety validation.', blockers: recordBlockers, status: 409 }).body, 409);

  const runningLog = await createCommandLogSafe({
    base44,
    status: 'running',
    idempotencyKey,
    lookup,
    user: auth.user,
    result: {
      projected_entity: 'FulfillmentTask',
      projected_create_count: 1,
      preview_mode: PREVIEW_MODE,
      task_packet_ready: true,
      writes_performed: false,
      native_fulfillment_task_created: false,
      customer_email_hydrated_internally_not_logged: true,
      customer_app_order_updated: false,
      native_shopify_order_updated: false,
      production_batch_created: false,
      batch_compliance_log_created: false,
      notifications_sent: false,
      provider_calls: false,
      hub_records_updated: false,
    },
  });
  if (!runningLog.ok) return jsonResponse(failureBody({ lookup, errorCode: runningLog.error_code, message: 'CommandLog creation failed before native FulfillmentTask create.', blockers: [runningLog.error_code], status: 500 }).body, 500);

  const created = await createNativeFulfillmentTaskSafe(base44, nativeRecord);
  if (!created.ok) {
    await updateCommandLogSafe({
      base44,
      commandLogId: runningLog.commandLog?.id,
      status: 'failed',
      result: safetyResult(),
      errorCode: created.error_code,
      errorMessage: created.message,
    });
    return jsonResponse(failureBody({ lookup, errorCode: created.error_code, message: 'Native FulfillmentTask mirror create failed safely.', blockers: [created.error_code], status: 500 }).body, 500);
  }

  const result = successBody({ lookup, task: created.row, commandLog: runningLog.commandLog, skipped: false });
  const logUpdate = await updateCommandLogSafe({
    base44,
    commandLogId: runningLog.commandLog?.id,
    status: 'success',
    result,
    errorCode: null,
    errorMessage: null,
  });
  if (!logUpdate.ok) return jsonResponse({ ...result, success: false, error_code: logUpdate.error_code, message: 'Native FulfillmentTask mirror was created but CommandLog update failed. Manual reconciliation required before retry.', reconciliation_required: true }, 500);

  return jsonResponse({ ...result, command_log_id: logUpdate.commandLog?.id || runningLog.commandLog?.id || null });
});
