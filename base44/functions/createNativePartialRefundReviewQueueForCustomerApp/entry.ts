import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const FUNCTION_NAME = 'createNativePartialRefundReviewQueueForCustomerApp';
const G35I_COMMAND_MARKER = 'g35i_default_off_partial_refund_review_queue_command';
const COMMAND_TYPE = 'native_partial_refund_review_queue_create';
const ENABLE_FLAG = 'ENABLE_NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE';
const KILL_SWITCH_FLAG = 'NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE_KILL_SWITCH';
const ALLOWED_EMAILS_FLAG = 'NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE_ALLOWED_EMAILS';
const ORDER_ALLOWLIST_FLAG = 'NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE_ORDER_ALLOWLIST';
const CUSTOMER_ORDER_ALLOWLIST_FLAG = 'NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE_CUSTOMER_ORDER_ALLOWLIST';
const SHOPIFY_ORDER_ALLOWLIST_FLAG = 'NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE_SHOPIFY_ORDER_ALLOWLIST';
const POLICY_FLAG = 'NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE_POLICY';
const REQUIRED_POLICY = 'PARTIAL_REFUND_REVIEW_QUEUE_ONLY_NO_NOTIFICATION';
const REQUIRED_NOTIFICATION_POLICY = 'NO_NOTIFICATION';
const REQUIRED_REFUND_TYPE = 'partial';
const CONFIRMATION_PHRASE = 'create_native_partial_refund_review_queue_no_notification';
const PREVIEW_MODE = 'NATIVE_PARTIAL_REFUND_REVIEW_IMPACT';
const MAX_TEXT = 180;

const ALLOWED_EVENT_SOURCES = new Set(['admin_review', 'stripe_webhook_shadow', 'manual_review']);
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
  'refund_type',
  'refund_amount',
  'refund_currency',
  'stripe_event_id',
  'stripe_refund_id',
  'refund_reason',
  'event_source',
  'notification_policy',
  'request_id',
  'confirmation',
]);

const FORBIDDEN_BODY_KEYS = new Set([
  'execute_refund',
  'process_refund',
  'provider_refund',
  'stripe_refund',
  'shopify_refund',
  'refund_execution',
  'refund_provider_call',
  'customer_app_order_status',
  'customer_app_order_status_override',
  'order_status_override',
  'native_shopify_order_status_override',
  'fulfillment_task_status_override',
  'production_batch_mutation',
  'batch_compliance_log_mutation',
  'compliance_mutation',
  'inventory_reversal',
  'purchase_order_reversal',
  'purchase_order',
  'notification',
  'notifications',
  'notification_payload',
  'send_notification',
  'push',
  'sms',
  'email',
  'in_app',
  'message_log',
  'message_logs',
  'sync',
  'repair',
  'replay',
  'raw_payload',
  'payload',
  'raw_body',
  'raw_stripe_payload',
  'raw_shopify_payload',
  'raw_provider_payload',
  'stripe_payload',
  'shopify_payload',
  'provider_payload',
  'headers',
  'authorization',
  'auth_header',
  'secret',
  'token',
  'api_key',
  'api-key',
  'bulk_order_ids',
  'bulk_ids',
]);

const ORDER_REVIEW_QUEUE_WRITABLE_FIELDS = new Set([
  'incident_type',
  'customer_email',
  'customer_name',
  'existing_order_id',
  'existing_order_number',
  'existing_order_type',
  'incoming_payload',
  'incoming_source',
  'issue_description',
  'recommended_action',
  'admin_notes',
  'status',
  'resolved_action',
  'resolved_at',
  'resolved_by',
  'idempotency_key',
  'occurrence_count',
  'first_seen_at',
  'last_seen_at',
  'queue_visibility_status',
  'archived_at',
  'archived_by',
  'archived_reason',
]);

const ORDER_REVIEW_STATUS_VALUES = new Set(['pending', 'reviewing', 'resolved', 'rejected', 'archived']);
const COMMAND_SUCCESS_STATUSES = new Set(['success', 'skipped']);

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

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
}

function safetyResult(overrides = {}) {
  return {
    writes_performed: false,
    order_review_queue_created: false,
    command_log_created: false,
    provider_calls: false,
    provider_calls_performed: false,
    stripe_calls_performed: false,
    shopify_api_calls_performed: false,
    notifications_sent: false,
    notifications_created: false,
    message_logs_created: false,
    customer_app_order_updated: false,
    native_shopify_order_updated: false,
    native_fulfillment_task_updated: false,
    production_batch_updated: false,
    compliance_log_updated: false,
    batch_compliance_log_updated: false,
    inventory_reversal: false,
    purchase_order_reversal: false,
    hub_records_updated: false,
    sync_repair_replay_performed: false,
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
    if (/(^|_)(raw|payload|provider|stripe|shopify|inventory|purchase|notification|message|sync|repair|replay|bulk|batch|compliance|status|override|secret|token|refund_execution|execute)($|_)/i.test(normalized)) return key;
    return key;
  }
  return null;
}

function getLookup(body) {
  return {
    orderNumber: normalizeOrderNumber(body?.order_number || body?.shopify_order_number),
    customerAppOrderId: safeId(body?.customer_app_order_id || body?.base44_order_id || body?.order_id, 120),
    nativeShopifyOrderId: safeId(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id, 120),
    nativeFulfillmentTaskId: safeId(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id, 120),
    refundType: normalizeLower(body?.refund_type),
    refundAmount: body?.refund_amount === undefined || body?.refund_amount === null || body?.refund_amount === '' ? null : safeNumber(body.refund_amount, null),
    refundCurrency: normalizeUpper(body?.refund_currency),
    stripeEventId: safeReferenceId(body?.stripe_event_id, 160),
    stripeRefundId: safeReferenceId(body?.stripe_refund_id, 160),
    refundReason: safeText(body?.refund_reason, 240),
    eventSource: normalizeLower(body?.event_source),
    notificationPolicy: normalizeUpper(body?.notification_policy),
    requestId: safeId(body?.request_id, 180),
    confirmation: normalizeText(body?.confirmation),
  };
}

function exactInputBlockers(lookup) {
  const blockers = [];
  if (!lookup.requestId) blockers.push('request_id_required');
  if (lookup.confirmation !== CONFIRMATION_PHRASE) blockers.push('confirmation_phrase_required');
  if (!lookup.orderNumber) blockers.push('order_number_required');
  if (!lookup.customerAppOrderId) blockers.push('customer_app_order_id_required');
  if (!lookup.nativeShopifyOrderId) blockers.push('native_shopify_order_id_required');
  if (lookup.refundType !== REQUIRED_REFUND_TYPE) blockers.push('refund_type_must_be_partial');
  if (lookup.refundAmount === null || lookup.refundAmount <= 0) blockers.push('refund_amount_required');
  if (!lookup.refundCurrency) blockers.push('refund_currency_required');
  if (!ALLOWED_EVENT_SOURCES.has(lookup.eventSource)) blockers.push('event_source_invalid');
  if (lookup.notificationPolicy !== REQUIRED_NOTIFICATION_POLICY) blockers.push('notification_policy_must_be_no_notification');
  return blockers;
}

function gateFailure({ actorEmail, lookup }) {
  if (Deno.env.get(KILL_SWITCH_FLAG) === 'true') return 'kill_switch_active';
  if (Deno.env.get(ENABLE_FLAG) !== 'true') return 'native_partial_refund_review_queue_create_disabled';
  if (normalizeText(Deno.env.get(POLICY_FLAG)) !== REQUIRED_POLICY) return 'partial_refund_review_queue_policy_required';

  const allowedEmails = parseCsvSet(Deno.env.get(ALLOWED_EMAILS_FLAG) || '');
  if (allowedEmails.size === 0) return 'allowed_email_gate_required';
  if (!allowedEmails.has(normalizeLower(actorEmail))) return 'actor_email_not_allowlisted';

  const orderAllowlist = parseCsvSet(Deno.env.get(ORDER_ALLOWLIST_FLAG) || '');
  if (orderAllowlist.size === 0) return 'order_allowlist_required';
  if (!orderAllowlist.has(normalizeLower(lookup.orderNumber))) return 'order_not_allowlisted';

  const customerOrderAllowlist = parseCsvSet(Deno.env.get(CUSTOMER_ORDER_ALLOWLIST_FLAG) || '');
  if (customerOrderAllowlist.size === 0) return 'customer_order_allowlist_required';
  if (!customerOrderAllowlist.has(normalizeLower(lookup.customerAppOrderId))) return 'customer_order_not_allowlisted';

  const shopifyOrderAllowlist = parseCsvSet(Deno.env.get(SHOPIFY_ORDER_ALLOWLIST_FLAG) || '');
  if (shopifyOrderAllowlist.size === 0) return 'shopify_order_allowlist_required';
  if (!shopifyOrderAllowlist.has(normalizeLower(lookup.nativeShopifyOrderId))) return 'shopify_order_not_allowlisted';

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

async function findExistingCommandLog(base44, idempotencyKey) {
  return filterEntity(base44, 'CommandLog', { idempotency_key: idempotencyKey }, '-created_date', 5);
}

function successfulCommandLog(log) {
  return log && COMMAND_SUCCESS_STATUSES.has(normalizeLower(log.status)) && log.error_code == null;
}

async function findExistingReviewRows(base44, lookup, idempotencyKey) {
  const rows = [];
  rows.push(...await filterEntity(base44, 'OrderReviewQueue', { idempotency_key: idempotencyKey }, '-created_date', 10));
  if (lookup.orderNumber) rows.push(...await filterEntity(base44, 'OrderReviewQueue', { existing_order_number: lookup.orderNumber }, '-created_date', 25));
  if (lookup.customerAppOrderId) rows.push(...await filterEntity(base44, 'OrderReviewQueue', { existing_order_id: lookup.customerAppOrderId }, '-created_date', 25));
  const byKey = new Map();
  for (const row of rows) {
    const key = row?.id || `${row?.existing_order_number}:${row?.idempotency_key}`;
    if (key) byKey.set(key, row);
  }
  return [...byKey.values()].filter(row => {
    const payload = row?.incoming_payload || {};
    const incident = normalizeLower(row?.incident_type);
    if (incident && incident !== 'partial_refund_review_required') return false;
    if (normalizeText(row?.idempotency_key) === idempotencyKey) return true;
    if (lookup.stripeEventId && normalizeText(payload?.stripe_event_id) === lookup.stripeEventId) return true;
    if (lookup.stripeRefundId && normalizeText(payload?.stripe_refund_id) === lookup.stripeRefundId) return true;
    return normalizeText(row?.existing_order_number) === lookup.orderNumber && normalizeText(row?.existing_order_id) === lookup.customerAppOrderId && normalizeLower(row?.status || 'pending') !== 'archived';
  });
}

async function previewPartialRefundReview(base44, lookup) {
  const payload = {
    preview_mode: PREVIEW_MODE,
    order_number: lookup.orderNumber,
    customer_app_order_id: lookup.customerAppOrderId,
    native_shopify_order_id: lookup.nativeShopifyOrderId,
    refund_type: 'partial',
    refund_amount: lookup.refundAmount,
    refund_currency: lookup.refundCurrency,
    event_source: lookup.eventSource === 'stripe_webhook_shadow' ? 'stripe_webhook_shadow' : 'admin_preview',
    request_id: `${lookup.requestId}:g35i_prewrite_preview`,
  };
  if (lookup.nativeFulfillmentTaskId) payload.native_fulfillment_task_id = lookup.nativeFulfillmentTaskId;
  if (lookup.stripeEventId) payload.stripe_event_id = lookup.stripeEventId;
  if (lookup.stripeRefundId) payload.stripe_refund_id = lookup.stripeRefundId;
  if (lookup.refundReason) payload.refund_reason = lookup.refundReason;

  if (base44.functions?.invoke) {
    const res = await base44.functions.invoke('previewNativeOrderCutoverReadiness', payload);
    return res?.data || res?.response?.data || res;
  }
  if (typeof base44.__previewNativeOrderCutoverReadiness === 'function') return base44.__previewNativeOrderCutoverReadiness(payload);
  return { success: false, error_code: 'preview_invocation_unavailable', writes_performed: false };
}

function validatePreview(preview, lookup) {
  const blockers = [];
  if (!preview?.success) blockers.push(preview?.error_code || 'partial_refund_review_preview_failed');
  if (preview?.dry_run !== true) blockers.push('partial_refund_review_preview_not_dry_run');
  if (preview?.writes_performed !== false) blockers.push('partial_refund_review_preview_writes_flag_not_false');
  if (preview?.preview_mode !== PREVIEW_MODE) blockers.push('partial_refund_review_preview_mode_mismatch');
  if (normalizeLower(preview?.refund_type) !== 'partial') blockers.push('partial_refund_review_preview_refund_type_mismatch');
  if (safeNumber(preview?.refund_amount, null) !== lookup.refundAmount) blockers.push('partial_refund_review_preview_refund_amount_mismatch');
  if (normalizeUpper(preview?.refund_currency) !== lookup.refundCurrency) blockers.push('partial_refund_review_preview_refund_currency_mismatch');
  if (normalizeOrderNumber(preview?.order_number) !== lookup.orderNumber) blockers.push('partial_refund_review_preview_order_number_mismatch');
  if (preview?.order_found !== true) blockers.push('partial_refund_review_preview_order_not_found');
  if (preview?.customer_app_order_present !== true) blockers.push('partial_refund_review_preview_customer_order_missing');
  if (preview?.native_shopify_order_present !== true) blockers.push('partial_refund_review_preview_native_order_missing');
  if (lookup.nativeFulfillmentTaskId && preview?.native_fulfillment_task_present !== true) blockers.push('partial_refund_review_preview_native_task_missing');
  if (preview?.preview_data_stable !== true) blockers.push('preview_data_unstable');
  if (preview?.read_consistency?.stable !== true) blockers.push('read_consistency_unstable');
  if (preview?.read_consistency?.blocker_required === true) blockers.push('read_consistency_blocker_required');
  if (Array.isArray(preview?.read_consistency?.inconsistent_sections) && preview.read_consistency.inconsistent_sections.length > 0) blockers.push('read_consistency_inconsistent_sections_present');
  if (Array.isArray(preview?.blockers) && preview.blockers.some(blocker => normalizeLower(blocker).includes('read_consistency'))) blockers.push('read_consistency_blocker_present');
  if (!preview?.proposed_order_review_queue_impact?.safe_queue_draft) blockers.push('partial_refund_review_queue_draft_missing');
  if (preview?.proposed_order_review_queue_impact?.draft_recommended_for_future_command !== true) blockers.push('partial_refund_review_queue_draft_not_recommended');
  if (preview?.provider_call_impact !== false) blockers.push('partial_refund_review_preview_provider_call_impact_not_false');
  if (preview?.notification_impact?.notification_held !== true) blockers.push('partial_refund_review_preview_notifications_not_held');
  if (preview?.notification_impact?.notification_would_send === true) blockers.push('partial_refund_review_preview_notification_would_send');
  if (preview?.production_batch_mutation_proposed === true) blockers.push('partial_refund_review_preview_batch_mutation_projected');
  if (preview?.compliance_log_mutation_proposed === true) blockers.push('partial_refund_review_preview_compliance_mutation_projected');
  if (preview?.proposed_fulfillment_task_impact?.would_cancel_task === true) blockers.push('partial_refund_review_preview_task_cancellation_projected');
  if (preview?.safety?.provider_calls_performed === true) blockers.push('partial_refund_review_preview_provider_safety_failed');
  if (preview?.safety?.notifications_sent === true) blockers.push('partial_refund_review_preview_notification_safety_failed');
  return uniqueStrings(blockers);
}

function buildQueuePayload({ lookup, preview, idempotencyKey }) {
  const draft = preview?.proposed_order_review_queue_impact?.safe_queue_draft || {};
  const now = new Date().toISOString();
  const payload = {
    incident_type: 'partial_refund_review_required',
    existing_order_id: lookup.customerAppOrderId,
    existing_order_number: lookup.orderNumber,
    existing_order_type: 'customer_app_native_one_time',
    incoming_source: 'native_refund_impact_preview',
    incoming_payload: {
      source: 'native_refund_impact_preview',
      order_number: lookup.orderNumber,
      customer_app_order_id: lookup.customerAppOrderId,
      native_shopify_order_id: lookup.nativeShopifyOrderId,
      native_fulfillment_task_id: lookup.nativeFulfillmentTaskId || null,
      refund_type: 'partial',
      refund_amount: lookup.refundAmount,
      refund_currency: lookup.refundCurrency,
      stripe_event_id: lookup.stripeEventId || null,
      stripe_refund_id: lookup.stripeRefundId || null,
      refund_reason_present: Boolean(lookup.refundReason),
      preview_data_stable: preview?.preview_data_stable === true,
      read_consistency_stable: preview?.read_consistency?.stable === true,
      production_batch_count: safeNumber(preview?.production_batch_count, 0),
      verified_logged_batch_count: safeNumber(preview?.verified_logged_batch_count, 0),
      batch_compliance_log_count: safeNumber(preview?.batch_compliance_log_count, 0),
      locked_compliance_log_count: safeNumber(preview?.locked_compliance_log_count, 0),
      raw_payload_included: false,
      customer_pii_included: false,
      provider_payload_included: false,
      notification_policy: REQUIRED_NOTIFICATION_POLICY,
      provider_call_impact: false,
    },
    issue_description: safeText(draft.review_reason || lookup.refundReason || 'Partial refund requires manual review. No refund was processed by Customer App.', 240),
    recommended_action: 'manual_review',
    admin_notes: safeText('G35I gated command created a no-notification partial refund review queue entry from stable G35H preview. Hub remains refund source of truth.', 240),
    status: 'pending',
    idempotency_key: idempotencyKey,
    occurrence_count: 1,
    first_seen_at: now,
    last_seen_at: now,
    queue_visibility_status: 'active',
  };
  return Object.fromEntries(Object.entries(payload).filter(([key, value]) => ORDER_REVIEW_QUEUE_WRITABLE_FIELDS.has(key) && value !== undefined));
}

function validateQueuePayload(payload) {
  const blockers = [];
  for (const key of Object.keys(payload || {})) if (!ORDER_REVIEW_QUEUE_WRITABLE_FIELDS.has(key)) blockers.push(`unsupported_order_review_queue_field:${key}`);
  if (payload?.incident_type !== 'partial_refund_review_required') blockers.push('order_review_queue_incident_type_invalid');
  if (!ORDER_REVIEW_STATUS_VALUES.has(payload?.status)) blockers.push('order_review_queue_status_invalid');
  if (!payload?.existing_order_id) blockers.push('order_review_queue_existing_order_id_missing');
  if (!payload?.existing_order_number) blockers.push('order_review_queue_existing_order_number_missing');
  if (!payload?.idempotency_key) blockers.push('order_review_queue_idempotency_key_missing');
  if (payload?.incoming_payload?.raw_payload_included !== false) blockers.push('order_review_queue_raw_payload_policy_failed');
  if (payload?.incoming_payload?.provider_payload_included !== false) blockers.push('order_review_queue_provider_payload_policy_failed');
  if (payload?.incoming_payload?.customer_pii_included !== false) blockers.push('order_review_queue_customer_pii_policy_failed');
  return uniqueStrings(blockers);
}

function buildSuccessResult({ lookup, queueRow = null, commandLog = null, skipped = false, idempotent = false, duplicate = false }) {
  return {
    success: true,
    skipped,
    idempotent,
    duplicate,
    dry_run: false,
    writes_performed: !skipped,
    command_type: COMMAND_TYPE,
    request_id: lookup.requestId,
    order_number: lookup.orderNumber,
    customer_app_order_id: lookup.customerAppOrderId,
    native_shopify_order_id: lookup.nativeShopifyOrderId,
    native_fulfillment_task_id: lookup.nativeFulfillmentTaskId || null,
    refund_type: 'partial',
    refund_amount: lookup.refundAmount,
    refund_currency: lookup.refundCurrency,
    notification_policy: REQUIRED_NOTIFICATION_POLICY,
    order_review_queue_created: Boolean(queueRow?.id) && !skipped,
    order_review_queue_id: queueRow?.id || null,
    command_log_created: Boolean(commandLog?.id),
    command_log_id: commandLog?.id || null,
    error_code: null,
    safety: safetyResult({
      writes_performed: !skipped,
      order_review_queue_created: Boolean(queueRow?.id) && !skipped,
      command_log_created: Boolean(commandLog?.id),
    }),
  };
}

function buildFailureResult({ lookup, errorCode, message, blockers = [], status = 409 }) {
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
      error_code: errorCode,
      message: safeText(message || errorCode, 240),
      blockers: uniqueStrings(blockers),
      safety: safetyResult(),
    },
  };
}

async function createCommandLog({ base44, status, idempotencyKey, lookup, user, result, errorCode, errorMessage }) {
  const now = new Date().toISOString();
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: COMMAND_TYPE,
    command_source: 'customer_app_native_admin',
    status,
    target_entity: 'OrderReviewQueue',
    target_id: lookup.customerAppOrderId,
    target_display_id: lookup.orderNumber,
    actor_email: safeActorEmail(user?.email) || null,
    actor_role: safeText(user?.role, 80) || null,
    actor_type: 'admin',
    payload: {
      order_number: lookup.orderNumber,
      customer_app_order_id: lookup.customerAppOrderId,
      native_shopify_order_id: lookup.nativeShopifyOrderId,
      native_fulfillment_task_id: lookup.nativeFulfillmentTaskId || null,
      refund_type: 'partial',
      refund_amount: lookup.refundAmount,
      refund_currency: lookup.refundCurrency,
      stripe_event_id_present: Boolean(lookup.stripeEventId),
      stripe_refund_id_present: Boolean(lookup.stripeRefundId),
      notification_policy: REQUIRED_NOTIFICATION_POLICY,
      policy: REQUIRED_POLICY,
      confirmation_verified: true,
    },
    result,
    error_code: errorCode || null,
    error_message: errorMessage ? safeText(errorMessage, 220) : null,
    idempotency_key: idempotencyKey,
    idempotent_skipped: status === 'skipped',
    request_id: lookup.requestId,
    submitted_at: now,
    started_at: now,
    completed_at: now,
    duration_ms: 0,
    function_name: FUNCTION_NAME,
    related_stripe_event_id: lookup.stripeEventId || null,
    related_order_id: lookup.customerAppOrderId,
    related_order_number: lookup.orderNumber,
    notes: 'G35I default-off partial refund review queue command. Creates only OrderReviewQueue plus safe CommandLog. No refund processing, provider calls, notifications, order/task/batch/compliance, inventory, PO, sync, repair, replay, or Hub mutation.',
  });
}

async function createCommandLogSafe(args) {
  try {
    const commandLog = await createCommandLog(args);
    return { ok: true, commandLog };
  } catch (error) {
    return { ok: false, commandLog: null, error_code: error?.code || 'command_log_create_failed', message: error?.message || 'CommandLog create failed' };
  }
}

async function createReviewQueueSafe(base44, payload) {
  try {
    const row = await base44.asServiceRole.entities.OrderReviewQueue.create(payload);
    return { ok: true, row };
  } catch (error) {
    return { ok: false, row: null, error_code: error?.code || 'order_review_queue_create_failed', message: error?.message || 'OrderReviewQueue create failed' };
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ success: false, error_code: 'method_not_allowed', message: 'POST required', writes_performed: false }, 405);

  const base44 = createClientFromRequest(req);
  const auth = await requireAdmin(base44);
  if (!auth.ok) return jsonResponse({ success: false, error_code: auth.error_code, message: auth.error_code === 'forbidden' ? 'Admin role required' : 'Unauthorized', writes_performed: false }, auth.status);

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return jsonResponse({ success: false, error_code: 'invalid_json_body', message: 'Valid JSON body required', writes_performed: false, safety: safetyResult() }, 400);

  const body = parsed.body;
  const unsupported = unsupportedBodyKey(body);
  const lookup = getLookup(body);
  if (unsupported) return jsonResponse(buildFailureResult({ lookup, errorCode: 'unsupported_or_forbidden_input', message: `Unsupported or forbidden input: ${unsupported}`, blockers: [`unsupported_or_forbidden_input:${unsupported}`], status: 400 }).body, 400);

  const inputBlockers = exactInputBlockers(lookup);
  if (inputBlockers.length > 0) return jsonResponse(buildFailureResult({ lookup, errorCode: 'invalid_partial_refund_review_queue_request', message: 'Required exact input contract was not satisfied.', blockers: inputBlockers, status: 400 }).body, 400);

  const gateError = gateFailure({ actorEmail: auth.user.email, lookup });
  if (gateError) return jsonResponse(buildFailureResult({ lookup, errorCode: gateError, message: 'Partial refund review queue create gate is closed.', blockers: [gateError], status: 409 }).body, 409);

  const idempotencyKey = `${COMMAND_TYPE}:${lookup.orderNumber}:${lookup.customerAppOrderId}:${lookup.nativeShopifyOrderId}:${lookup.requestId}`;
  const existingLogs = await findExistingCommandLog(base44, idempotencyKey);
  const existingSuccess = existingLogs.find(successfulCommandLog);
  if (existingSuccess) {
    const result = buildSuccessResult({ lookup, queueRow: null, commandLog: existingSuccess, skipped: true, idempotent: true });
    return jsonResponse(result);
  }

  const existingReviewRows = await findExistingReviewRows(base44, lookup, idempotencyKey);
  if (existingReviewRows.length > 0) {
    const result = buildSuccessResult({ lookup, queueRow: existingReviewRows[0], commandLog: null, skipped: true, idempotent: false, duplicate: true });
    return jsonResponse({ ...result, duplicate_review_detected: true, writes_performed: false, order_review_queue_created: false, safety: safetyResult() });
  }

  const preview = await previewPartialRefundReview(base44, lookup);
  const previewBlockers = validatePreview(preview, lookup);
  if (previewBlockers.length > 0) {
    return jsonResponse(buildFailureResult({ lookup, errorCode: 'partial_refund_review_preview_not_write_ready', message: 'Stable G35H partial refund review preview is required before creating a review queue entry.', blockers: previewBlockers, status: 409 }).body, 409);
  }

  const queuePayload = buildQueuePayload({ lookup, preview, idempotencyKey });
  const payloadBlockers = validateQueuePayload(queuePayload);
  if (payloadBlockers.length > 0) {
    return jsonResponse(buildFailureResult({ lookup, errorCode: 'schema_contract_blocker', message: 'OrderReviewQueue schema contract is not satisfied.', blockers: payloadBlockers, status: 409 }).body, 409);
  }

  const queueCreate = await createReviewQueueSafe(base44, queuePayload);
  if (!queueCreate.ok) {
    return jsonResponse(buildFailureResult({ lookup, errorCode: queueCreate.error_code, message: queueCreate.message, blockers: [queueCreate.error_code], status: 500 }).body, 500);
  }

  const successResult = buildSuccessResult({ lookup, queueRow: queueCreate.row, commandLog: null, skipped: false });
  const commandLogCreate = await createCommandLogSafe({ base44, status: 'success', idempotencyKey, lookup, user: auth.user, result: successResult, errorCode: null, errorMessage: null });
  if (!commandLogCreate.ok) {
    return jsonResponse({ ...successResult, success: false, error_code: commandLogCreate.error_code, message: 'Review queue entry was created but CommandLog creation failed. Manual reconciliation required before retry.', reconciliation_required: true, command_log_created: false }, 500);
  }

  return jsonResponse({ ...successResult, command_log_created: true, command_log_id: commandLogCreate.commandLog.id, safety: safetyResult({ writes_performed: true, order_review_queue_created: true, command_log_created: true }) });
});
