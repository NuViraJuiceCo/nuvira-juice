import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const COMMAND_TYPE = 'native_production_batch_materialization';
const FUNCTION_NAME = 'materializeNativeProductionBatchesForCustomerApp';
const ENABLE_FLAG = 'ENABLE_NATIVE_PRODUCTION_BATCH_MATERIALIZATION';
const KILL_SWITCH_FLAG = 'NATIVE_PRODUCTION_BATCH_MATERIALIZATION_KILL_SWITCH';
const ALLOWED_EMAILS_FLAG = 'NATIVE_PRODUCTION_BATCH_MATERIALIZATION_ALLOWED_EMAILS';
const ORDER_ALLOWLIST_FLAG = 'NATIVE_PRODUCTION_BATCH_MATERIALIZATION_ORDER_ALLOWLIST';
const POLICY_FLAG = 'NATIVE_PRODUCTION_BATCH_MATERIALIZATION_POLICY';
const REQUIRED_POLICY = 'EXACT_PREVIEW_PACKET_ONLY';
const CONFIRMATION_PHRASE = 'materialize_native_production_batches_for_customer_app';
const TARGET_ORDER_NUMBER = 'NV-MPZNKGNT';
const TARGET_CUSTOMER_APP_ORDER_ID = '6a219a3f4adcda5856c3d579';
const TARGET_NATIVE_SHOPIFY_ORDER_ID = '6a22ffda400eb806eb3ca945';
const TARGET_NATIVE_FULFILLMENT_TASK_ID = '6a22ffdaf675ea79e30575aa';
const TARGET_PRODUCTION_DATE = '2026-06-05';
const TARGET_DELIVERY_DATE = '2026-06-06';
const MAX_TEXT = 180;
const MAX_ROWS = 20;

const EXPECTED_PRODUCT_UNITS = Object.freeze({
  Aura: 1,
  Oasis: 1,
  'Pineapple Juice': 1,
  'Radiance Shot': 1,
  'Re-Nu': 1,
  'Reset Shot': 1,
});
const EXPECTED_PRODUCTS = Object.freeze(Object.keys(EXPECTED_PRODUCT_UNITS).sort());

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
  'expected_production_date',
  'expected_delivery_date',
  'expected_preview_hash',
  'request_id',
]);

const FORBIDDEN_BODY_KEYS = new Set([
  'rows',
  'custom_rows',
  'product_rows',
  'products',
  'quantities',
  'batch_rows',
  'production_batches',
  'raw_payload',
  'payload',
  'raw_body',
  'raw_order',
  'order',
  'raw_recipe',
  'recipe',
  'raw_provider_payload',
  'raw_payment_payload',
  'inventory_deduction',
  'deduct_inventory',
  'purchase_order',
  'create_purchase_order',
  'send_notification',
  'notify_customer',
  'sync',
  'repair',
  'replay',
  'status_override',
  'customer_status',
  'task_status',
  'shopify_status',
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

function normalizeKey(value) {
  return normalizeLower(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
    if (/(^|_)(custom|raw|payload|provider|stripe|shopify|inventory|purchase|notification|sync|repair|replay|bulk|status|task|order|batch|recipe|route|proof|delivery|compliance)($|_)/i.test(normalized)) {
      return key;
    }
    return key;
  }
  return null;
}

function getLookup(body) {
  return {
    orderNumber: normalizeText(body?.order_number || body?.shopify_order_number).replace(/^#/, ''),
    customerAppOrderId: safeId(body?.customer_app_order_id || body?.base44_order_id, 120),
    nativeShopifyOrderId: safeId(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id, 120),
    nativeFulfillmentTaskId: safeId(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id, 120),
    expectedProductionDate: normalizeText(body?.expected_production_date),
    expectedDeliveryDate: normalizeText(body?.expected_delivery_date),
    expectedPreviewHash: safeId(body?.expected_preview_hash, 180),
    requestId: safeId(body?.request_id, 160),
  };
}

function expectedPreviewSecret() {
  return normalizeText(Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET')) ||
    normalizeText(Deno.env.get('CUSTOMER_APP_SYNC_SECRET')) ||
    normalizeText(Deno.env.get('HUB_SYNC_SECRET'));
}

function exactTargetBlockers(lookup) {
  const blockers = [];
  if (lookup.orderNumber !== TARGET_ORDER_NUMBER) blockers.push('target_order_number_mismatch');
  if (lookup.customerAppOrderId && lookup.customerAppOrderId !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('target_customer_app_order_id_mismatch');
  if (lookup.nativeShopifyOrderId && lookup.nativeShopifyOrderId !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('target_native_shopify_order_id_mismatch');
  if (lookup.nativeFulfillmentTaskId && lookup.nativeFulfillmentTaskId !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('target_native_fulfillment_task_id_mismatch');
  if (lookup.expectedProductionDate && lookup.expectedProductionDate !== TARGET_PRODUCTION_DATE) blockers.push('expected_production_date_mismatch');
  if (lookup.expectedDeliveryDate && lookup.expectedDeliveryDate !== TARGET_DELIVERY_DATE) blockers.push('expected_delivery_date_mismatch');
  return blockers;
}

function gateFailure({ actorEmail, lookup }) {
  if (Deno.env.get(KILL_SWITCH_FLAG) === 'true') return 'kill_switch_active';
  if (Deno.env.get(ENABLE_FLAG) !== 'true') return 'native_production_batch_materialization_disabled';
  if (normalizeText(Deno.env.get(POLICY_FLAG)) !== REQUIRED_POLICY) return 'exact_preview_packet_policy_required';

  const allowedEmails = parseCsvSet(Deno.env.get(ALLOWED_EMAILS_FLAG) || '');
  if (allowedEmails.size === 0) return 'allowed_email_gate_required';
  if (!allowedEmails.has(normalizeLower(actorEmail))) return 'actor_email_not_allowlisted';

  const allowlist = parseCsvSet(Deno.env.get(ORDER_ALLOWLIST_FLAG) || '');
  if (allowlist.size === 0) return 'order_allowlist_required';
  const candidates = [
    lookup.orderNumber,
    lookup.customerAppOrderId,
    lookup.nativeShopifyOrderId,
    lookup.nativeFulfillmentTaskId,
    TARGET_CUSTOMER_APP_ORDER_ID,
    TARGET_NATIVE_SHOPIFY_ORDER_ID,
    TARGET_NATIVE_FULFILLMENT_TASK_ID,
  ].map(normalizeLower).filter(Boolean);
  if (!candidates.some(candidate => allowlist.has(candidate))) return 'order_not_allowlisted';
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
    const response = await base44.asServiceRole.functions.invoke('previewNativeProductionDemandMaterialization', {
      mode: 'dry_run',
      order_number: TARGET_ORDER_NUMBER,
      customer_app_order_id: lookup.customerAppOrderId || TARGET_CUSTOMER_APP_ORDER_ID,
      native_shopify_order_id: lookup.nativeShopifyOrderId || TARGET_NATIVE_SHOPIFY_ORDER_ID,
      native_fulfillment_task_id: lookup.nativeFulfillmentTaskId || TARGET_NATIVE_FULFILLMENT_TASK_ID,
      request_id: `${lookup.requestId || 'g31l'}:fresh_preview`,
      _internal_secret: secret,
    });
    const data = response?.data || response;
    if (!data?.success) {
      return { ok: false, status: 409, error_code: data?.error_code || 'fresh_preview_not_successful', data };
    }
    return { ok: true, status: 200, data };
  } catch (error) {
    const status = error?.response?.status || error?.status || 502;
    const data = error?.response?.data || error?.data || null;
    return { ok: false, status, error_code: data?.error_code || `fresh_preview_invoke_${status}`, data };
  }
}

function sortedProductNames(rows) {
  return (rows || []).map(row => safeText(row.product_name, 120)).filter(Boolean).sort();
}

function sameStringArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateFreshPreview(preview) {
  const blockers = [];
  const warnings = [];
  const rows = Array.isArray(preview?.proposed_production_batch_rows) ? preview.proposed_production_batch_rows : [];

  if (!preview?.success) blockers.push('fresh_preview_failed');
  if (preview?.dry_run !== true) blockers.push('fresh_preview_not_dry_run');
  if (preview?.writes_performed !== false) blockers.push('fresh_preview_writes_flag_not_false');
  if (preview?.order_number !== TARGET_ORDER_NUMBER) blockers.push('fresh_preview_target_order_mismatch');
  if (preview?.customer_app_order_id !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('fresh_preview_customer_app_order_id_mismatch');
  if (preview?.native_shopify_order_id !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('fresh_preview_native_shopify_order_id_mismatch');
  if (preview?.native_fulfillment_task_id !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('fresh_preview_native_task_id_mismatch');
  if (preview?.payment_status !== 'paid') blockers.push('fresh_preview_order_not_paid');
  if (preview?.payment_captured !== true) blockers.push('fresh_preview_payment_not_captured');
  if (preview?.production_ready !== true) blockers.push('fresh_preview_production_not_ready');
  if (preview?.materialization_ready !== true) blockers.push('fresh_preview_materialization_not_ready');
  if (preview?.production_date !== TARGET_PRODUCTION_DATE) blockers.push('fresh_preview_production_date_mismatch');
  if (preview?.delivery_date !== TARGET_DELIVERY_DATE) blockers.push('fresh_preview_delivery_date_mismatch');
  if (preview?.native_shopify_order_present !== true) blockers.push('fresh_preview_missing_native_shopify_order');
  if (preview?.native_fulfillment_task_present !== true) blockers.push('fresh_preview_missing_native_fulfillment_task');
  if (Array.isArray(preview?.blockers) && preview.blockers.length > 0) blockers.push('fresh_preview_contains_blockers');
  if (Array.isArray(preview?.materialization_blockers) && preview.materialization_blockers.length > 0) blockers.push('fresh_preview_contains_materialization_blockers');
  if (rows.length !== EXPECTED_PRODUCTS.length) blockers.push('unexpected_proposed_batch_count');
  if (!sameStringArray(sortedProductNames(rows), EXPECTED_PRODUCTS)) blockers.push('unexpected_proposed_batch_products');

  for (const row of rows) {
    const productName = safeText(row?.product_name, 120);
    const expectedUnits = EXPECTED_PRODUCT_UNITS[productName];
    if (!productName) blockers.push('proposed_batch_missing_product_name');
    if (expectedUnits === undefined) blockers.push(`unexpected_proposed_batch_product:${productName || 'missing'}`);
    if (roundQuantity(row?.planned_units, 3) !== expectedUnits) blockers.push(`unexpected_planned_units:${productName || 'missing'}`);
    if (row?.production_date !== TARGET_PRODUCTION_DATE) blockers.push(`proposed_batch_production_date_mismatch:${productName || 'missing'}`);
    if (row?.proposed_status !== 'planned') blockers.push(`proposed_batch_status_not_planned:${productName || 'missing'}`);
    if (Array.isArray(row?.blockers) && row.blockers.length > 0) blockers.push(`proposed_batch_contains_blockers:${productName || 'missing'}`);
    if (row?.would_update_existing === true) blockers.push(`existing_batch_update_not_allowed:${productName || 'missing'}`);
    if (row?.would_create !== true && row?.would_skip_existing !== true) blockers.push(`proposed_batch_not_create_or_skip:${productName || 'missing'}`);
  }

  if (preview?.inventory_deduction_ready !== false) blockers.push('inventory_deduction_should_remain_held');
  if (preview?.procurement_conversion_ready !== false) warnings.push('procurement_conversion_ready_unexpected_true');
  if (preview?.hub_fallback_required !== true) warnings.push('hub_fallback_required_flag_missing');

  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)].slice(0, 80),
    warnings: [...new Set(warnings.concat(preview?.warnings || []))].slice(0, 80),
    proposedRows: rows,
    proposedOrderSourceRows: Array.isArray(preview?.proposed_order_source_rows) ? preview.proposed_order_source_rows : [],
  };
}

function slugForBatch(value) {
  const key = normalizeKey(value).replace(/\s+/g, '-').toUpperCase();
  return key || 'PRODUCT';
}

function deterministicBatchId(row) {
  return `NATIVE-${TARGET_ORDER_NUMBER}-${TARGET_PRODUCTION_DATE}-${slugForBatch(row?.product_name)}`;
}

function productCategoryForBatch(productName) {
  return normalizeLower(productName).includes('shot') ? 'shot' : 'juice';
}

function batchSourceText(batch) {
  return `${JSON.stringify(batch?.order_sources || [])} ${JSON.stringify(batch?.related_orders || [])} ${safeText(batch?.notes, 500)} ${safeText(batch?.source_system, 120)}`;
}

function batchContainsTargetSource(batch) {
  const text = batchSourceText(batch);
  return [TARGET_ORDER_NUMBER, TARGET_CUSTOMER_APP_ORDER_ID, TARGET_NATIVE_SHOPIFY_ORDER_ID, TARGET_NATIVE_FULFILLMENT_TASK_ID]
    .some(value => value && text.includes(value));
}

function batchSameProductDate(batch, row) {
  return normalizeKey(batch?.product_name) === normalizeKey(row?.product_name) &&
    normalizeText(batch?.production_date) === TARGET_PRODUCTION_DATE;
}

function batchBlocksDedupe(batch) {
  const status = normalizeLower(batch?.status);
  return batch?.is_locked === true || ['in_production', 'completed_pending_verification', 'verified_logged', 'archived'].includes(status);
}

async function filterEntity(base44, entityName, filter, sort = '-created_date', limit = 10) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity?.filter) return [];
  const rows = await entity.filter(filter, sort, limit).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function findExistingCommandLog(base44, idempotencyKey) {
  return filterEntity(base44, 'CommandLog', { idempotency_key: idempotencyKey }, '-created_date', 3);
}

async function findExistingBatchesForRow(base44, row) {
  const batchId = deterministicBatchId(row);
  const productName = safeText(row?.product_name, 120);
  const byBatchId = await filterEntity(base44, 'ProductionBatch', { batch_id: batchId }, '-created_date', 10);
  const byProductDate = await filterEntity(base44, 'ProductionBatch', { product_name: productName, production_date: TARGET_PRODUCTION_DATE }, '-created_date', 20);
  const bySourceOrder = await filterEntity(base44, 'ProductionBatch', { production_date: TARGET_PRODUCTION_DATE }, '-created_date', 200);
  const all = [...byBatchId, ...byProductDate, ...bySourceOrder.filter(batch => batchContainsTargetSource(batch))];
  const seen = new Set();
  return all.filter(batch => {
    const key = batch?.id || batch?.batch_id || JSON.stringify(batch);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function preflightExistingBatches(base44, proposedRows) {
  const blockers = [];
  const rowsToCreate = [];
  const skippedExisting = [];
  const conflicts = [];

  for (const row of proposedRows || []) {
    const productName = safeText(row?.product_name, 120);
    const batchId = deterministicBatchId(row);
    const existing = await findExistingBatchesForRow(base44, row);
    const exact = existing.find(batch =>
      safeText(batch?.batch_id, 120) === batchId ||
      (batchSameProductDate(batch, row) && batchContainsTargetSource(batch))
    );
    if (exact) {
      skippedExisting.push({
        product_name: productName,
        batch_id: safeText(exact.batch_id || batchId, 120),
        production_batch_id: safeId(exact.id, 120) || null,
        reason: 'exact_native_batch_already_materialized',
      });
      continue;
    }

    const conflicting = existing.find(batch => batchSameProductDate(batch, row) && (batchBlocksDedupe(batch) || !batchContainsTargetSource(batch)));
    if (conflicting) {
      const conflict = {
        product_name: productName,
        batch_id: safeText(conflicting.batch_id, 120) || null,
        production_batch_id: safeId(conflicting.id, 120) || null,
        status: safeText(conflicting.status, 80) || null,
        is_locked: conflicting.is_locked === true,
        reason: batchBlocksDedupe(conflicting) ? 'existing_conflicting_batch_blocks_materialization' : 'existing_same_product_date_batch_requires_update_not_allowed',
      };
      conflicts.push(conflict);
      blockers.push(`production_batch_conflict:${productName}`);
      continue;
    }

    rowsToCreate.push(row);
  }

  return { ready: blockers.length === 0, blockers, rowsToCreate, skippedExisting, conflicts };
}

function sourceRowsForProduct(preview, productName) {
  const key = normalizeKey(productName);
  return (preview?.proposed_order_source_rows || [])
    .filter(row => normalizeKey(row?.product_name) === key)
    .slice(0, MAX_ROWS);
}

function sourceTypeForOrderSource(row) {
  return normalizeLower(row?.demand_source_type) === 'bundle_component' ? 'bundle' : 'direct';
}

function buildBatchPayload({ row, preview, commandLogId, actorEmail, requestId }) {
  const productName = safeText(row?.product_name, 120);
  const sourceRows = sourceRowsForProduct(preview, productName);
  const now = new Date().toISOString();
  const orderSources = sourceRows.length > 0 ? sourceRows.map(sourceRow => ({
    order_id: TARGET_CUSTOMER_APP_ORDER_ID,
    order_number: TARGET_ORDER_NUMBER,
    quantity: roundQuantity(sourceRow.quantity_contribution, 3) ?? roundQuantity(row?.planned_units, 3) ?? 0,
    source_type: sourceTypeForOrderSource(sourceRow),
    source_item: safeText(sourceRow.source_line_item || sourceRow.parent_bundle || productName, 120),
  })) : [{
    order_id: TARGET_CUSTOMER_APP_ORDER_ID,
    order_number: TARGET_ORDER_NUMBER,
    quantity: roundQuantity(row?.planned_units, 3) ?? 0,
    source_type: 'direct',
    source_item: productName,
  }];

  return {
    batch_id: deterministicBatchId(row),
    product_name: productName,
    product_category: productCategoryForBatch(productName),
    status: 'planned',
    planned_units: roundQuantity(row?.planned_units, 3) ?? 0,
    production_date: TARGET_PRODUCTION_DATE,
    is_locked: false,
    order_sources: orderSources,
    related_orders: [TARGET_NATIVE_SHOPIFY_ORDER_ID],
    notes: safeText(`Native ProductionBatch materialized from G31K preview for order ${TARGET_ORDER_NUMBER}. Inventory deduction, purchase orders, compliance, delivery, provider calls, notifications, and sync/repair/replay remain held.`, 500),
    audit_trail: [{
      timestamp: now,
      action: 'native_production_batch_materialized_from_preview',
      performed_by: safeText(actorEmail, 120) || 'native_admin_actor',
      reason: 'G31L gated exact-order native ProductionBatch materialization command',
      request_id: safeId(requestId, 160) || null,
      command_log_id: safeId(commandLogId, 120) || null,
    }],
    source_system: 'customer_app_native_order',
    command_log_ids: commandLogId ? [commandLogId] : [],
    ingredient_usage_status: 'not_started',
    procurement_needed: preview?.procurement_needed === true,
    inventory_deduction_status: 'held',
    native_owner_status: 'native_production_batch_materialized_from_g31k_preview',
  };
}

function validateBatchPayload(payload) {
  const blockers = [];
  const allowed = new Set([
    'batch_id',
    'product_name',
    'product_category',
    'status',
    'planned_units',
    'production_date',
    'is_locked',
    'order_sources',
    'related_orders',
    'notes',
    'audit_trail',
    'source_system',
    'command_log_ids',
    'ingredient_usage_status',
    'procurement_needed',
    'inventory_deduction_status',
    'native_owner_status',
  ]);
  for (const key of Object.keys(payload || {})) {
    if (!allowed.has(key)) blockers.push(`unapproved_production_batch_field:${key}`);
  }
  if (!payload.batch_id || !payload.batch_id.startsWith(`NATIVE-${TARGET_ORDER_NUMBER}-${TARGET_PRODUCTION_DATE}-`)) blockers.push('invalid_batch_id');
  if (!EXPECTED_PRODUCT_UNITS[payload.product_name]) blockers.push('unexpected_product_name');
  if (!['juice', 'shot', 'other'].includes(payload.product_category)) blockers.push('invalid_product_category');
  if (payload.status !== 'planned') blockers.push('status_must_be_planned');
  if (safeNumber(payload.planned_units) !== EXPECTED_PRODUCT_UNITS[payload.product_name]) blockers.push('planned_units_mismatch');
  if (payload.production_date !== TARGET_PRODUCTION_DATE) blockers.push('production_date_mismatch');
  if (!Array.isArray(payload.order_sources) || payload.order_sources.length === 0) blockers.push('order_sources_required');
  for (const source of payload.order_sources || []) {
    for (const key of Object.keys(source || {})) {
      if (!['order_id', 'order_number', 'quantity', 'source_type', 'source_item'].includes(key)) blockers.push(`unapproved_order_source_field:${key}`);
    }
    if (source.order_id !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('order_source_order_id_mismatch');
    if (source.order_number !== TARGET_ORDER_NUMBER) blockers.push('order_source_order_number_mismatch');
    if (!['direct', 'bundle'].includes(source.source_type)) blockers.push('order_source_type_invalid');
  }
  if (Array.isArray(payload.ingredients_used) || payload.actual_units !== undefined || payload.inventory_deduction_log_id || payload.compliance_log_id || payload.ccp_log_id) {
    blockers.push('forbidden_execution_or_compliance_field_present');
  }
  return blockers;
}

function summarizeBatch(row, created, skippedReason = null) {
  return {
    product_name: safeText(row?.product_name || created?.product_name, 120),
    batch_id: safeText(created?.batch_id || deterministicBatchId(row), 140),
    production_batch_id: safeId(created?.id, 120) || null,
    production_date: safeText(created?.production_date || TARGET_PRODUCTION_DATE, 40),
    planned_units: roundQuantity(created?.planned_units ?? row?.planned_units, 3),
    status: safeText(created?.status || 'planned', 80),
    skipped_reason: skippedReason,
  };
}

async function createCommandLog({ base44, status, idempotencyKey, requestId, user, result, errorCode, errorMessage }) {
  const now = new Date().toISOString();
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: COMMAND_TYPE,
    command_source: 'customer_app_native_admin',
    status,
    target_entity: 'ProductionBatch',
    target_id: TARGET_ORDER_NUMBER,
    target_display_id: TARGET_ORDER_NUMBER,
    actor_email: safeText(user?.email, 180) || null,
    actor_role: safeText(user?.role, 80) || null,
    actor_type: 'admin',
    payload: {
      exact_order_allowlist: true,
      order_number: TARGET_ORDER_NUMBER,
      customer_app_order_id: TARGET_CUSTOMER_APP_ORDER_ID,
      native_shopify_order_id: TARGET_NATIVE_SHOPIFY_ORDER_ID,
      native_fulfillment_task_id: TARGET_NATIVE_FULFILLMENT_TASK_ID,
      production_date: TARGET_PRODUCTION_DATE,
      policy: REQUIRED_POLICY,
      expected_products: EXPECTED_PRODUCTS,
      preview_function: 'previewNativeProductionDemandMaterialization',
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
    notes: 'G31L exact gated native ProductionBatch materialization command. Creates only schema-safe planned ProductionBatch rows from the fresh G31K preview. No inventory deduction, PurchaseOrder, compliance, order/task/status, provider, notification, sync, repair, replay, or Hub mutation.',
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

async function createProductionBatches({ base44, rows, preview, commandLogId, actorEmail, requestId }) {
  const createdRows = [];
  for (const row of rows) {
    const payload = buildBatchPayload({ row, preview, commandLogId, actorEmail, requestId });
    const payloadBlockers = validateBatchPayload(payload);
    if (payloadBlockers.length > 0) {
      const error = new Error(`ProductionBatch payload validation failed: ${payloadBlockers.join(',')}`);
      error.code = 'production_batch_payload_invalid';
      throw error;
    }
    const created = await base44.asServiceRole.entities.ProductionBatch.create(payload);
    createdRows.push(summarizeBatch(row, created));
  }
  return createdRows;
}

function safetyResult(extra = {}) {
  return {
    inventory_deducted: false,
    purchase_orders_created: false,
    compliance_logs_created: false,
    manual_production_batches_created: false,
    customer_app_order_updated: false,
    native_shopify_order_updated: false,
    native_fulfillment_task_updated: false,
    recipe_updated: false,
    bundle_updated: false,
    inventory_item_updated: false,
    ingredient_yield_updated: false,
    provider_calls_performed: false,
    stripe_calls_performed: false,
    shopify_api_calls_performed: false,
    notifications_sent: false,
    sync_repair_replay_performed: false,
    hub_bridge_modified: false,
    ...extra,
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
      return jsonResponse({ success: false, skipped: true, error_code: 'exact_target_required', blockers: targetBlockers, writes_performed: false }, 409);
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
        production_batches_created: false,
        duplicate_production_batches_created: false,
        safety: safetyResult({ production_batches_created: false }),
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

    const freshPreview = await fetchFreshPreview(base44, lookup);
    if (!freshPreview.ok) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: freshPreview.error_code || 'fresh_preview_failed',
        preview_status: freshPreview.status,
        writes_performed: false,
      }, freshPreview.status || 409);
    }

    const validation = validateFreshPreview(freshPreview.data);
    if (!validation.ready) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: 'fresh_materialization_preview_not_clean',
        blockers: validation.blockers,
        warnings: validation.warnings,
        writes_performed: false,
      }, 409);
    }

    const existingPreflight = await preflightExistingBatches(base44, validation.proposedRows);
    if (!existingPreflight.ready) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: 'production_batch_conflict',
        blockers: existingPreflight.blockers,
        conflicts: existingPreflight.conflicts,
        writes_performed: false,
      }, 409);
    }

    if (existingPreflight.rowsToCreate.length === 0) {
      const commandLog = await createCommandLog({
        base44,
        status: 'skipped',
        idempotencyKey,
        requestId: lookup.requestId,
        user: auth.user,
        result: {
          writes_performed: false,
          production_batches_created: false,
          skipped_existing_count: existingPreflight.skippedExisting.length,
          skipped_existing_rows: existingPreflight.skippedExisting,
          inventory_deducted: false,
          purchase_orders_created: false,
          compliance_logs_created: false,
          provider_calls_performed: false,
          notifications_sent: false,
          sync_repair_replay_performed: false,
        },
      });
      return jsonResponse({
        success: true,
        skipped: true,
        idempotent: false,
        reason: 'exact_native_batches_already_exist',
        request_id: lookup.requestId,
        idempotency_key: idempotencyKey,
        command_log_id: safeId(commandLog?.id, 120) || null,
        order_number: TARGET_ORDER_NUMBER,
        writes_performed: false,
        production_batches_created: false,
        created_batch_count: 0,
        skipped_existing_count: existingPreflight.skippedExisting.length,
        skipped_existing_rows: existingPreflight.skippedExisting,
        safety: safetyResult({ production_batches_created: false }),
      });
    }

    const commandLog = await createCommandLog({
      base44,
      status: 'running',
      idempotencyKey,
      requestId: lookup.requestId,
      user: auth.user,
      result: {
        writes_performed: false,
        projected_batch_count: existingPreflight.rowsToCreate.length,
        projected_products: existingPreflight.rowsToCreate.map(row => safeText(row.product_name, 120)),
        skipped_existing_count: existingPreflight.skippedExisting.length,
        production_date: TARGET_PRODUCTION_DATE,
        inventory_deducted: false,
        purchase_orders_created: false,
        compliance_logs_created: false,
      },
    });

    let createdRows = [];
    try {
      createdRows = await createProductionBatches({
        base44,
        rows: existingPreflight.rowsToCreate,
        preview: freshPreview.data,
        commandLogId: commandLog?.id,
        actorEmail: auth.user?.email,
        requestId: lookup.requestId,
      });
    } catch (error) {
      await updateCommandLog({
        base44,
        commandLogId: commandLog?.id,
        status: 'failed',
        result: {
          writes_performed: createdRows.length > 0,
          partial_create_count: createdRows.length,
          created_batches: createdRows,
          skipped_existing_rows: existingPreflight.skippedExisting,
          ...safetyResult({ production_batches_created: createdRows.length > 0 }),
        },
        errorCode: error?.code || 'production_batch_materialization_write_failed',
        errorMessage: error?.message || 'ProductionBatch materialization write failed',
      }).catch(() => null);
      return jsonResponse({
        success: false,
        skipped: false,
        error_code: error?.code || 'production_batch_materialization_write_failed',
        message: 'Native ProductionBatch materialization failed safely.',
        writes_performed: createdRows.length > 0,
        partial_create_count: createdRows.length,
      }, 500);
    }

    await updateCommandLog({
      base44,
      commandLogId: commandLog?.id,
      status: 'success',
      result: {
        writes_performed: true,
        production_batches_created: true,
        created_batch_count: createdRows.length,
        created_batches: createdRows,
        skipped_existing_count: existingPreflight.skippedExisting.length,
        skipped_existing_rows: existingPreflight.skippedExisting,
        production_date: TARGET_PRODUCTION_DATE,
        product_names: sortedProductNames(createdRows),
        ...safetyResult({ production_batches_created: true }),
      },
    });

    return jsonResponse({
      success: true,
      skipped: false,
      idempotent: false,
      request_id: lookup.requestId,
      idempotency_key: idempotencyKey,
      command_log_id: safeId(commandLog?.id, 120) || null,
      order_number: TARGET_ORDER_NUMBER,
      production_date: TARGET_PRODUCTION_DATE,
      writes_performed: true,
      production_batches_created: true,
      created_batch_count: createdRows.length,
      created_batches: createdRows,
      skipped_existing_count: existingPreflight.skippedExisting.length,
      skipped_existing_rows: existingPreflight.skippedExisting,
      inventory_deducted: false,
      purchase_orders_created: false,
      compliance_logs_created: false,
      provider_calls: false,
      stripe_calls: false,
      shopify_calls: false,
      notifications_sent: false,
      sync_retry_repair_run: false,
      customer_app_order_updated: false,
      native_shopify_order_updated: false,
      native_fulfillment_task_updated: false,
      hub_records_updated: false,
      safety: safetyResult({ production_batches_created: true }),
    });
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] failed safely: ${error?.message || 'unknown error'}`);
    return jsonResponse({
      success: false,
      error_code: 'native_production_batch_materialization_failed',
      message: 'Native ProductionBatch materialization failed safely.',
      writes_performed: false,
    }, 500);
  }
});
