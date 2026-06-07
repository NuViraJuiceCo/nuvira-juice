import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DISPLAY_CRITICAL_FIELDS = [
  'base44_order_id',
  'shopify_order_id',
  'native_shopify_order_id',
  'shopify_order_number',
  'order_number',
  'source_type',
  'schedule_source',
  'production_date',
];
const APPROVED_REPAIR_PATCH_FIELDS = new Set([
  'base44_order_id',
  'shopify_order_id',
  'native_shopify_order_id',
  'shopify_order_number',
  'order_number',
  'source_channel',
  'source_type',
  'schedule_source',
  'task_source',
  'created_from_native_ops',
  'scheduled_date',
  'assigned_delivery_date',
  'production_date',
  'fulfillment_type',
  'delivery_status',
  'production_status',
  'payment_status',
  'sync_status',
  'address',
  'address_line1',
  'address_city',
  'address_state',
  'address_postal_code',
  'time_window',
  'delivery_window_label',
  'items_summary',
  'line_item_count',
  'total_price',
  'address_complete',
]);
const SCHEMA_UNSAFE_REPAIR_FIELDS = {
  delivery_address: 'object_field_not_required_for_metadata_repair',
  items: 'array_field_not_required_for_metadata_repair',
};
const APPROVED_REPAIR_PATCH_FIELD_TYPES = {
  base44_order_id: ['string'],
  shopify_order_id: ['string'],
  native_shopify_order_id: ['string'],
  shopify_order_number: ['string'],
  order_number: ['string'],
  source_channel: ['string'],
  source_type: ['string'],
  schedule_source: ['string'],
  task_source: ['string'],
  created_from_native_ops: ['boolean'],
  scheduled_date: ['string'],
  assigned_delivery_date: ['string'],
  production_date: ['string'],
  fulfillment_type: ['string'],
  delivery_status: ['string'],
  production_status: ['string'],
  payment_status: ['string'],
  sync_status: ['string'],
  address: ['string'],
  address_line1: ['string'],
  address_city: ['string'],
  address_state: ['string'],
  address_postal_code: ['string'],
  time_window: ['string'],
  delivery_window_label: ['string'],
  items_summary: ['string'],
  line_item_count: ['number'],
  total_price: ['number'],
  address_complete: ['boolean'],
};
const SAFE_ARRAY_LIMIT = 40;

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizeLower(value) {
  return normalizeSingleLine(value).toLowerCase();
}

function normalizeOrderNumber(value) {
  return normalizeSingleLine(value).replace(/^#/, '');
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

function operationalText(value, maxLength = 160) {
  const text = normalizeSingleLine(value).replace(/[\u0000-\u001f\u007f]/g, '');
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function sanitizeId(value, maxLength = 180) {
  const text = sanitizeText(value, maxLength);
  return /^[A-Za-z0-9._:@/#-]+$/.test(text) ? text : '';
}

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function compactObject(value) {
  const out = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (item !== undefined && item !== null && item !== '') out[key] = item;
  }
  return out;
}

function safeStringArray(value, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, SAFE_ARRAY_LIMIT).map(item => sanitizeText(item, maxLength)).filter(Boolean))];
}

function parseCsvSet(value) {
  return new Set(normalizeText(value).split(',').map(normalizeLower).filter(Boolean));
}

async function readJsonBody(req) {
  const raw = await req.text();
  if (!raw.trim()) return { ok: true, body: {} };
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ok: true, body: parsed }
      : { ok: false, body: null };
  } catch {
    return { ok: false, body: null };
  }
}

function previewSecret() {
  return Deno.env.get('NATIVE_FULFILLMENT_TASK_METADATA_REPAIR_PREVIEW_SECRET') ||
    Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET') ||
    Deno.env.get('CUSTOMER_APP_SYNC_SECRET') ||
    Deno.env.get('HUB_SYNC_SECRET') ||
    '';
}

function unauthorized() {
  return Response.json({ success: false, error_code: 'unauthorized', message: 'Unauthorized' }, { status: 401 });
}

function forbidden() {
  return Response.json({ success: false, error_code: 'forbidden', message: 'Admin access required' }, { status: 403 });
}

async function requirePreviewAccess({ base44, req, body }) {
  const providedSecret = normalizeText(req.headers.get('x-internal-secret') || body?._internal_secret || body?.internal_secret);
  if (providedSecret) {
    const expected = previewSecret();
    return expected && providedSecret === expected
      ? { ok: true, actor_type: 'system', actor_role: 'service', actor_email: 'system' }
      : { ok: false, response: unauthorized() };
  }

  try {
    const user = await base44.auth.me().catch(() => null);
    if (!user) return { ok: false, response: unauthorized() };
    if (user.role !== 'admin') return { ok: false, response: forbidden() };
    return { ok: true, actor_type: 'admin', actor_role: 'admin', actor_email: user.email || 'admin' };
  } catch {
    return { ok: false, response: unauthorized() };
  }
}

function getLookup(body) {
  return {
    taskId: sanitizeId(body?.task_id || body?.fulfillment_task_id),
    nativeOrderId: sanitizeId(body?.native_order_id || body?.shopify_order_id || body?.native_shopify_order_id),
    base44OrderId: sanitizeId(body?.base44_order_id || body?.customer_app_order_id || body?.order_id),
    orderNumber: normalizeOrderNumber(body?.order_number || body?.shopify_order_number || body?.order || body?.number),
  };
}

function hasExactLookup(lookup) {
  return Boolean(lookup.taskId || lookup.nativeOrderId || lookup.base44OrderId || lookup.orderNumber);
}

function taskDisplayMetadataComplete(task) {
  return DISPLAY_CRITICAL_FIELDS.every(field => Boolean(normalizeText(task?.[field])));
}

function taskMissingDisplayFields(task) {
  return DISPLAY_CRITICAL_FIELDS.filter(field => !normalizeText(task?.[field]));
}

function lineItemsSummary(items) {
  if (!Array.isArray(items)) return '';
  return items
    .slice(0, 8)
    .map(item => `${safeNumber(item?.quantity) ?? 0}x ${operationalText(item?.title || item?.name || item?.product_title, 80)}`)
    .filter(item => !item.startsWith('0x '))
    .join(', ');
}

function taskItemsFromOrder(order) {
  const items = Array.isArray(order?.line_items) ? order.line_items : [];
  return items.slice(0, SAFE_ARRAY_LIMIT).map(item => compactObject({
    product_id: sanitizeId(item?.shopify_line_item_id || item?.id || item?.product_id, 120),
    title: operationalText(item?.title || item?.name || item?.product_title, 120) || 'Item',
    price: safeNumber(item?.price) ?? 0,
    quantity: safeNumber(item?.quantity) ?? 0,
  })).filter(item => item.title && item.quantity > 0);
}

function deliveryAddress(order) {
  return operationalText(order?.delivery_address || order?.address || [
    order?.address_line1,
    order?.address_city,
    order?.address_state,
    order?.address_postal_code,
  ].filter(Boolean).join(', '), 280);
}

function hasCompleteAddress(order) {
  return Boolean(order?.address_line1 && order?.address_city && order?.address_state && order?.address_postal_code);
}

function firstDate(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  }
  return '';
}

function chooseSourceChannel(nativeOrder, customerOrder) {
  return sanitizeText(nativeOrder?.source_channel || customerOrder?.source_channel || 'customer_app', 80) || 'customer_app';
}

function chooseSourceType(nativeOrder, customerOrder) {
  return sanitizeText(nativeOrder?.source_type || customerOrder?.source_type || 'customer_app_one_time', 80) || 'customer_app_one_time';
}

function chooseFulfillmentType(nativeOrder, customerOrder, task) {
  return sanitizeText(
    task?.fulfillment_type || nativeOrder?.fulfillment_method || customerOrder?.fulfillment_type || customerOrder?.fulfillment_method || 'delivery',
    80,
  ) || 'delivery';
}

function sourceMetadata({ task, nativeOrder, customerOrder }) {
  const deliveryDate = firstDate(
    task?.delivery_date,
    task?.assigned_delivery_date,
    task?.scheduled_date,
    nativeOrder?.assigned_delivery_date,
    nativeOrder?.selected_delivery_date,
    nativeOrder?.requested_delivery_date,
    customerOrder?.assigned_delivery_date,
    customerOrder?.selected_delivery_date,
    customerOrder?.estimated_delivery_date,
    customerOrder?.delivery_date,
  );
  const productionDate = firstDate(
    nativeOrder?.production_date,
    nativeOrder?.assigned_production_day,
    customerOrder?.production_date,
    customerOrder?.assigned_production_day,
    task?.production_date,
  );
  const lineItems = Array.isArray(nativeOrder?.line_items) ? nativeOrder.line_items : [];
  const taskItems = taskItemsFromOrder(nativeOrder || {});
  const orderNumber = normalizeOrderNumber(nativeOrder?.shopify_order_number || nativeOrder?.order_number || customerOrder?.order_number || task?.shopify_order_number || task?.order_number);
  const base44OrderId = sanitizeId(nativeOrder?.base44_order_id || customerOrder?.id || task?.base44_order_id, 120);

  return compactObject({
    order_id: sanitizeId(nativeOrder?.id || task?.order_id, 120),
    base44_order_id: base44OrderId,
    shopify_order_id: sanitizeId(nativeOrder?.id || task?.shopify_order_id, 120),
    native_shopify_order_id: sanitizeId(nativeOrder?.id || task?.native_shopify_order_id, 120),
    shopify_order_number: orderNumber,
    order_number: orderNumber,
    customer_name: operationalText(nativeOrder?.customer_name || customerOrder?.customer_name || task?.customer_name, 160),
    customer_email: operationalText(nativeOrder?.customer_email || customerOrder?.customer_email || task?.customer_email, 180),
    customer_phone: operationalText(nativeOrder?.customer_phone || customerOrder?.contact_phone || customerOrder?.customer_phone || task?.customer_phone, 80),
    source_channel: chooseSourceChannel(nativeOrder, customerOrder),
    source_type: chooseSourceType(nativeOrder, customerOrder),
    task_source: 'native_fulfillment_task_metadata_repair',
    created_from_native_ops: true,
    order_type: sanitizeText(nativeOrder?.order_type || customerOrder?.order_type || 'one_time', 80) || 'one_time',
    fulfillment_type: chooseFulfillmentType(nativeOrder, customerOrder, task),
    fulfillment_number: safeNumber(task?.fulfillment_number) ?? 1,
    delivery_date: deliveryDate,
    scheduled_date: firstDate(task?.scheduled_date, deliveryDate),
    assigned_delivery_date: firstDate(task?.assigned_delivery_date, deliveryDate),
    production_date: productionDate,
    time_window: sanitizeText(nativeOrder?.delivery_window_label || customerOrder?.delivery_window_label || task?.time_window, 120),
    delivery_window_label: sanitizeText(nativeOrder?.delivery_window_label || customerOrder?.delivery_window_label || task?.delivery_window_label, 120),
    address: deliveryAddress(nativeOrder) || deliveryAddress(customerOrder) || task?.address,
    delivery_address: nativeOrder?.delivery_address || customerOrder?.delivery_address || task?.delivery_address,
    address_line1: operationalText(nativeOrder?.address_line1 || customerOrder?.address_line1 || task?.address_line1, 120),
    address_line2: operationalText(nativeOrder?.address_line2 || customerOrder?.address_line2 || task?.address_line2, 120),
    address_city: operationalText(nativeOrder?.address_city || customerOrder?.address_city || task?.address_city, 100),
    address_state: operationalText(nativeOrder?.address_state || customerOrder?.address_state || task?.address_state, 80),
    address_postal_code: operationalText(nativeOrder?.address_postal_code || customerOrder?.address_postal_code || task?.address_postal_code, 40),
    items: taskItems,
    items_summary: lineItemsSummary(lineItems),
    line_item_count: taskItems.length || safeNumber(task?.line_item_count),
    total_price: safeNumber(nativeOrder?.total_price ?? nativeOrder?.total ?? customerOrder?.total ?? customerOrder?.total_price ?? task?.total_price),
    address_complete: hasCompleteAddress(nativeOrder) || hasCompleteAddress(customerOrder) || task?.address_complete === true,
    status: task?.status || 'pending',
    delivery_status: task?.delivery_status || task?.status || 'pending',
    production_status: sanitizeText(nativeOrder?.production_status || customerOrder?.production_status || task?.production_status, 80),
    payment_status: sanitizeText(nativeOrder?.payment_status || customerOrder?.payment_status || customerOrder?.financial_status || task?.payment_status, 80),
    sync_status: task?.sync_status || 'native_task_metadata_repaired',
    schedule_source: task?.schedule_source || 'native_customer_app_paid_order_mirror',
    delivery_zone_key: sanitizeText(nativeOrder?.delivery_zone_key || customerOrder?.delivery_zone_key || task?.delivery_zone_key, 80),
  });
}

function isEmptyValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return normalizeText(value) === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function isIdentityField(field) {
  return [
    'order_id',
    'base44_order_id',
    'shopify_order_id',
    'native_shopify_order_id',
    'shopify_order_number',
    'order_number',
  ].includes(field);
}

function isApprovedRepairPatchField(field) {
  return APPROVED_REPAIR_PATCH_FIELDS.has(field);
}

function validateRepairPatch(patch) {
  const unsupportedFields = [];
  const invalidTypeFields = [];

  for (const [field, value] of Object.entries(patch || {})) {
    if (!isApprovedRepairPatchField(field)) {
      unsupportedFields.push(field);
      continue;
    }

    const allowedTypes = APPROVED_REPAIR_PATCH_FIELD_TYPES[field] || ['string'];
    const actualType = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    if (!allowedTypes.includes(actualType)) invalidTypeFields.push(field);
  }

  return {
    ok: unsupportedFields.length === 0 && invalidTypeFields.length === 0,
    unsupported_patch_fields: safeStringArray([...new Set(unsupportedFields)].sort(), 80),
    invalid_patch_type_fields: safeStringArray([...new Set(invalidTypeFields)].sort(), 80),
  };
}

function unsupportedRepairPatchFields(patch) {
  const validation = validateRepairPatch(patch);
  return [...new Set([
    ...validation.unsupported_patch_fields,
    ...validation.invalid_patch_type_fields,
  ])].sort();
}

function excludedRepairFieldReasons(fields) {
  const reasons = {};
  for (const field of fields || []) {
    if (SCHEMA_UNSAFE_REPAIR_FIELDS[field]) reasons[field] = SCHEMA_UNSAFE_REPAIR_FIELDS[field];
  }
  return reasons;
}

function sameValue(a, b) {
  return normalizeLower(a) === normalizeLower(b);
}

function buildMetadataRepairPlan({ task, nativeOrder, customerOrder }) {
  const blockers = [];
  const warnings = [];

  if (!task?.id) blockers.push('fulfillment_task_missing');
  if (!nativeOrder?.id) blockers.push('native_shopify_order_missing');
  if (nativeOrder && normalizeLower(nativeOrder.order_type) === 'subscription') blockers.push('subscription_order_not_supported');
  if (nativeOrder && ['pos', 'shopify_pos'].includes(normalizeLower(nativeOrder.order_type || nativeOrder.source_channel || nativeOrder.fulfillment_method))) blockers.push('pos_order_not_supported');
  if (nativeOrder && !['paid', 'succeeded'].includes(normalizeLower(nativeOrder.payment_status || nativeOrder.financial_status))) blockers.push('payment_not_paid');

  if (task?.order_id && nativeOrder?.id && !sameValue(task.order_id, nativeOrder.id)) {
    blockers.push('task_order_link_conflict');
  }
  if (task?.base44_order_id && nativeOrder?.base44_order_id && !sameValue(task.base44_order_id, nativeOrder.base44_order_id)) {
    blockers.push('task_base44_order_link_conflict');
  }
  if (task?.shopify_order_number && nativeOrder?.shopify_order_number && !sameValue(task.shopify_order_number, nativeOrder.shopify_order_number)) {
    blockers.push('task_order_number_conflict');
  }
  if (task?.order_number && nativeOrder?.shopify_order_number && !sameValue(task.order_number, nativeOrder.shopify_order_number)) {
    blockers.push('task_order_number_conflict');
  }

  const source = sourceMetadata({ task, nativeOrder, customerOrder });
  const patch = {};
  const skippedExistingFields = [];
  const excludedUnapprovedFields = [];
  for (const [field, value] of Object.entries(source)) {
    if (isEmptyValue(value)) continue;
    if (!isApprovedRepairPatchField(field)) {
      if (isEmptyValue(task?.[field])) excludedUnapprovedFields.push(field);
      continue;
    }
    if (isEmptyValue(task?.[field])) patch[field] = value;
    else if (!isIdentityField(field)) skippedExistingFields.push(field);
  }

  const patchValidation = validateRepairPatch(patch);
  if (!patchValidation.ok) blockers.push('unsupported_repair_field');

  const excludedRepairFields = [...new Set(excludedUnapprovedFields.filter(field => SCHEMA_UNSAFE_REPAIR_FIELDS[field]))].sort();
  const missingDisplayFields = taskMissingDisplayFields({ ...task, ...patch });
  if (excludedUnapprovedFields.length > 0) warnings.push('excluded_unapproved_repair_fields');
  if (missingDisplayFields.length > 0) warnings.push('display_metadata_still_incomplete_after_patch');
  if (Object.keys(patch).length === 0) warnings.push('no_missing_metadata_fields_to_repair');

  return {
    ready: blockers.length === 0,
    action: Object.keys(patch).length === 0 ? 'noop_already_complete_or_no_patch' : 'repair_existing_task_metadata',
    blockers: safeStringArray([...new Set(blockers)]),
    warnings: safeStringArray([...new Set(warnings)]),
    patch,
    patch_fields: Object.keys(patch).sort(),
    unsupported_patch_fields: safeStringArray(patchValidation.unsupported_patch_fields, 80),
    invalid_patch_type_fields: safeStringArray(patchValidation.invalid_patch_type_fields, 80),
    excluded_unapproved_fields: safeStringArray([...new Set(excludedUnapprovedFields)].sort(), 80),
    excluded_repair_fields: safeStringArray(excludedRepairFields, 80),
    excluded_repair_reasons: excludedRepairFieldReasons(excludedRepairFields),
    missing_display_fields_before: taskMissingDisplayFields(task),
    missing_display_fields_after: missingDisplayFields,
    skipped_existing_fields: safeStringArray(skippedExistingFields.sort(), 80),
  };
}

function summarizeTask(task) {
  return task ? {
    id: sanitizeId(task.id) || null,
    order_id: sanitizeId(task.order_id) || null,
    base44_order_id: sanitizeId(task.base44_order_id) || null,
    shopify_order_id: sanitizeId(task.shopify_order_id) || null,
    native_shopify_order_id: sanitizeId(task.native_shopify_order_id) || null,
    shopify_order_number: sanitizeText(task.shopify_order_number || task.order_number, 120) || null,
    source_type: sanitizeText(task.source_type, 80) || null,
    schedule_source: sanitizeText(task.schedule_source, 120) || null,
    delivery_date: sanitizeText(task.delivery_date || task.assigned_delivery_date, 40) || null,
    production_date: sanitizeText(task.production_date, 40) || null,
    status: sanitizeText(task.status, 80) || null,
    display_metadata_complete: taskDisplayMetadataComplete(task),
  } : null;
}

function summarizeOrder(order) {
  return order ? {
    id: sanitizeId(order.id) || null,
    order_number: sanitizeText(order.shopify_order_number || order.order_number, 120) || null,
    base44_order_id: sanitizeId(order.base44_order_id) || null,
    source_type: sanitizeText(order.source_type, 80) || null,
    order_type: sanitizeText(order.order_type, 80) || null,
    fulfillment_method: sanitizeText(order.fulfillment_method, 80) || null,
    payment_status: sanitizeText(order.payment_status || order.financial_status, 80) || null,
    production_status: sanitizeText(order.production_status, 80) || null,
    fulfillment_status: sanitizeText(order.fulfillment_status, 80) || null,
  } : null;
}

function summarizePatch(patch) {
  const summary = {};
  for (const [field, value] of Object.entries(patch || {})) {
    if (['customer_name', 'customer_email', 'customer_phone', 'address', 'delivery_address', 'address_line1', 'address_line2'].includes(field)) {
      summary[field] = sanitizeText(value, 120) || '[redacted]';
    } else if (field === 'items') {
      summary[field] = { item_count: Array.isArray(value) ? value.length : 0 };
    } else {
      summary[field] = value;
    }
  }
  return summary;
}

async function findCustomerOrder(base44, lookup, nativeOrder) {
  const filters = [];
  if (lookup.base44OrderId) filters.push({ id: lookup.base44OrderId });
  if (nativeOrder?.base44_order_id) filters.push({ id: nativeOrder.base44_order_id });
  if (lookup.orderNumber) filters.push({ order_number: lookup.orderNumber });
  if (nativeOrder?.shopify_order_number) filters.push({ order_number: nativeOrder.shopify_order_number });

  for (const filter of filters) {
    const rows = await base44.asServiceRole.entities.Order.filter(filter, '-created_date', 5).catch(() => []);
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
  }
  return null;
}

async function findNativeOrder(base44, lookup, task = null) {
  const filters = [];
  if (lookup.nativeOrderId) filters.push({ id: lookup.nativeOrderId });
  if (task?.order_id) filters.push({ id: task.order_id });
  if (task?.shopify_order_id) filters.push({ id: task.shopify_order_id });
  if (task?.native_shopify_order_id) filters.push({ id: task.native_shopify_order_id });
  if (lookup.base44OrderId) filters.push({ base44_order_id: lookup.base44OrderId });
  if (task?.base44_order_id) filters.push({ base44_order_id: task.base44_order_id });
  if (lookup.orderNumber) filters.push({ shopify_order_number: lookup.orderNumber });
  if (task?.shopify_order_number || task?.order_number) filters.push({ shopify_order_number: task.shopify_order_number || task.order_number });

  const matches = [];
  for (const filter of filters) {
    const rows = await base44.asServiceRole.entities.ShopifyOrder.filter(filter, '-created_date', 5).catch(() => []);
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row?.id && !matches.some(match => match.id === row.id)) matches.push(row);
    }
  }
  return { nativeOrder: matches.length === 1 ? matches[0] : null, nativeMatches: matches };
}

async function findTasks(base44, lookup, nativeOrder = null) {
  const filters = [];
  if (lookup.taskId) filters.push({ id: lookup.taskId });
  if (nativeOrder?.id) {
    filters.push({ order_id: nativeOrder.id });
    filters.push({ shopify_order_id: nativeOrder.id });
    filters.push({ native_shopify_order_id: nativeOrder.id });
  }
  if (lookup.nativeOrderId) {
    filters.push({ order_id: lookup.nativeOrderId });
    filters.push({ shopify_order_id: lookup.nativeOrderId });
    filters.push({ native_shopify_order_id: lookup.nativeOrderId });
  }
  if (lookup.base44OrderId) filters.push({ base44_order_id: lookup.base44OrderId });
  if (lookup.orderNumber) {
    filters.push({ shopify_order_number: lookup.orderNumber });
    filters.push({ order_number: lookup.orderNumber });
  }
  if (nativeOrder?.shopify_order_number) {
    filters.push({ shopify_order_number: nativeOrder.shopify_order_number });
    filters.push({ order_number: nativeOrder.shopify_order_number });
  }

  const matches = [];
  for (const filter of filters) {
    const rows = await base44.asServiceRole.entities.FulfillmentTask.filter(filter, '-created_date', 10).catch(() => []);
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row?.id && !matches.some(match => match.id === row.id)) matches.push(row);
    }
  }
  return matches;
}

async function buildRepairPreview({ base44, body, actor }) {
  const lookup = getLookup(body);
  if (!hasExactLookup(lookup)) {
    return {
      success: false,
      status: 400,
      body: {
        success: false,
        dry_run: true,
        error_code: 'exact_task_or_order_required',
        message: 'Provide task_id, native_order_id, base44_order_id, or order_number for exact task metadata repair preview.',
        writes_performed: false,
      },
    };
  }

  let task = null;
  let tasks = [];
  let nativeOrder = null;
  let nativeMatches = [];

  if (lookup.taskId) {
    tasks = await findTasks(base44, lookup, null);
    task = tasks.length === 1 ? tasks[0] : null;
    const nativeResult = await findNativeOrder(base44, lookup, task);
    nativeOrder = nativeResult.nativeOrder;
    nativeMatches = nativeResult.nativeMatches;
  } else {
    const nativeResult = await findNativeOrder(base44, lookup, null);
    nativeOrder = nativeResult.nativeOrder;
    nativeMatches = nativeResult.nativeMatches;
    tasks = await findTasks(base44, lookup, nativeOrder);
    task = tasks.length === 1 ? tasks[0] : null;
  }

  const blockers = [];
  if (nativeMatches.length > 1) blockers.push('multiple_native_order_matches');
  if (tasks.length > 1 && !lookup.taskId) blockers.push('multiple_fulfillment_task_matches');
  if (!task) blockers.push('fulfillment_task_not_found');
  if (!nativeOrder) blockers.push('native_shopify_order_not_found');

  const customerOrder = nativeOrder ? await findCustomerOrder(base44, lookup, nativeOrder) : null;
  const plan = blockers.length === 0
    ? buildMetadataRepairPlan({ task, nativeOrder, customerOrder })
    : {
        ready: false,
        action: 'blocked',
        blockers,
        warnings: [],
        patch: {},
        patch_fields: [],
        unsupported_patch_fields: [],
        invalid_patch_type_fields: [],
        excluded_unapproved_fields: [],
        excluded_repair_fields: [],
        excluded_repair_reasons: {},
        missing_display_fields_before: task ? taskMissingDisplayFields(task) : [],
        missing_display_fields_after: task ? taskMissingDisplayFields(task) : [],
        skipped_existing_fields: [],
      };

  return {
    success: true,
    status: 200,
    body: {
      success: plan.ready,
      dry_run: true,
      function_name: 'previewNativeFulfillmentTaskMetadataRepair',
      generated_at: new Date().toISOString(),
      scope: 'specific_task_or_order',
      target: {
        lookup: {
          task_id: lookup.taskId || null,
          native_order_id: lookup.nativeOrderId || null,
          base44_order_id: lookup.base44OrderId || null,
          order_number: lookup.orderNumber || null,
        },
        native_order: summarizeOrder(nativeOrder),
        fulfillment_task: summarizeTask(task),
        customer_app_order_id: sanitizeId(customerOrder?.id) || null,
      },
      repair_plan: {
        ready: plan.ready,
        action: plan.action,
        blockers: safeStringArray(plan.blockers),
        warnings: safeStringArray(plan.warnings),
        patch_fields: safeStringArray(plan.patch_fields, 100),
        unsupported_patch_fields: safeStringArray(plan.unsupported_patch_fields, 80),
        invalid_patch_type_fields: safeStringArray(plan.invalid_patch_type_fields, 80),
        excluded_unapproved_fields: safeStringArray(plan.excluded_unapproved_fields, 80),
        excluded_repair_fields: safeStringArray(plan.excluded_repair_fields, 80),
        excluded_repair_reasons: plan.excluded_repair_reasons || {},
        patch_preview: summarizePatch(plan.patch),
        missing_display_fields_before: safeStringArray(plan.missing_display_fields_before, 80),
        missing_display_fields_after: safeStringArray(plan.missing_display_fields_after, 80),
        skipped_existing_fields: safeStringArray(plan.skipped_existing_fields, 80),
      },
      generated_by: {
        actor_type: sanitizeText(actor?.actor_type, 80),
        actor_role: sanitizeText(actor?.actor_role, 80),
        actor_email: sanitizeText(actor?.actor_email, 180),
      },
      safety: {
        dry_run_only: true,
        writes_performed: false,
        customer_app_order_updated: false,
        native_shopify_order_updated: false,
        provider_calls_performed: false,
        stripe_calls_performed: false,
        shopify_api_calls_performed: false,
        notifications_sent: false,
        sync_repair_replay_performed: false,
        production_inventory_delivery_mutations_performed: false,
        hub_bridge_modified: false,
        redaction_applied: true,
      },
    },
  };
}


const COMMAND_TYPE = 'native_fulfillment_task_metadata_repair';
const ENABLE_WRITES_FLAG = 'ENABLE_NATIVE_FULFILLMENT_TASK_METADATA_REPAIR_WRITES';
const KILL_SWITCH_FLAG = 'NATIVE_FULFILLMENT_TASK_METADATA_REPAIR_KILL_SWITCH';
const ORDER_ALLOWLIST_FLAG = 'NATIVE_FULFILLMENT_TASK_METADATA_REPAIR_ORDER_ALLOWLIST';
const ALLOWED_EMAILS_FLAG = 'NATIVE_FULFILLMENT_TASK_METADATA_REPAIR_ALLOWED_EMAILS';
const CONFIRMATION_PHRASE = 'execute_native_fulfillment_task_metadata_repair';

function gateSummary() {
  const orderAllowlist = parseCsvSet(Deno.env.get(ORDER_ALLOWLIST_FLAG) || '');
  return {
    enabled: Deno.env.get(ENABLE_WRITES_FLAG) === 'true',
    kill_switch: Deno.env.get(KILL_SWITCH_FLAG) === 'true',
    order_allowlist_count: orderAllowlist.size,
    actor_allowlist_count: parseCsvSet(Deno.env.get(ALLOWED_EMAILS_FLAG) || '').size,
    broad_real_order_mode: Deno.env.get(ENABLE_WRITES_FLAG) === 'true' && orderAllowlist.size === 0,
  };
}

function allowlistIdentifiers({ lookup, task, nativeOrder, customerOrder }) {
  return [
    lookup?.taskId,
    lookup?.nativeOrderId,
    lookup?.base44OrderId,
    lookup?.orderNumber,
    task?.id,
    task?.order_id,
    task?.base44_order_id,
    task?.shopify_order_id,
    task?.native_shopify_order_id,
    task?.shopify_order_number,
    task?.order_number,
    nativeOrder?.id,
    nativeOrder?.base44_order_id,
    nativeOrder?.shopify_order_number,
    nativeOrder?.order_number,
    customerOrder?.id,
    customerOrder?.order_number,
  ].map(normalizeLower).filter(Boolean);
}

function envGateFailure({ actorEmail, lookup, task, nativeOrder, customerOrder }) {
  if (Deno.env.get(KILL_SWITCH_FLAG) === 'true') return 'kill_switch_active';
  if (Deno.env.get(ENABLE_WRITES_FLAG) !== 'true') return 'native_fulfillment_task_metadata_repair_writes_disabled';

  const allowedEmails = parseCsvSet(Deno.env.get(ALLOWED_EMAILS_FLAG) || '');
  if (allowedEmails.size === 0) return 'allowed_email_gate_required';
  if (!allowedEmails.has(normalizeLower(actorEmail))) return 'actor_email_not_allowlisted';

  const orderAllowlist = parseCsvSet(Deno.env.get(ORDER_ALLOWLIST_FLAG) || '');
  if (orderAllowlist.size === 0) return 'order_allowlist_required';
  const identifiers = allowlistIdentifiers({ lookup, task, nativeOrder, customerOrder });
  if (!identifiers.some(identifier => orderAllowlist.has(identifier))) return 'order_not_allowlisted';
  return null;
}

async function resolveRepairTarget(base44, body) {
  const lookup = getLookup(body);
  if (!hasExactLookup(lookup)) {
    return {
      lookup,
      task: null,
      tasks: [],
      nativeOrder: null,
      nativeMatches: [],
      customerOrder: null,
      blockers: ['exact_task_or_order_required'],
      plan: null,
    };
  }

  let task = null;
  let tasks = [];
  let nativeOrder = null;
  let nativeMatches = [];

  if (lookup.taskId) {
    tasks = await findTasks(base44, lookup, null);
    task = tasks.length === 1 ? tasks[0] : null;
    const nativeResult = await findNativeOrder(base44, lookup, task);
    nativeOrder = nativeResult.nativeOrder;
    nativeMatches = nativeResult.nativeMatches;
  } else {
    const nativeResult = await findNativeOrder(base44, lookup, null);
    nativeOrder = nativeResult.nativeOrder;
    nativeMatches = nativeResult.nativeMatches;
    tasks = await findTasks(base44, lookup, nativeOrder);
    task = tasks.length === 1 ? tasks[0] : null;
  }

  const blockers = [];
  if (nativeMatches.length > 1) blockers.push('multiple_native_order_matches');
  if (tasks.length > 1 && !lookup.taskId) blockers.push('multiple_fulfillment_task_matches');
  if (!task) blockers.push('fulfillment_task_not_found');
  if (!nativeOrder) blockers.push('native_shopify_order_not_found');

  const customerOrder = nativeOrder ? await findCustomerOrder(base44, lookup, nativeOrder) : null;
  const plan = blockers.length === 0 ? buildMetadataRepairPlan({ task, nativeOrder, customerOrder }) : null;
  return { lookup, task, tasks, nativeOrder, nativeMatches, customerOrder, blockers, plan };
}

async function findExistingCommandLog(base44, idempotencyKey) {
  return base44.asServiceRole.entities.CommandLog.filter({ idempotency_key: idempotencyKey }, '-created_date', 1).catch(() => []);
}

function shouldSkipForIdempotency(existingLog) {
  return Boolean(existingLog && existingLog.status !== 'failed');
}

async function createCommandLog({ base44, task, nativeOrder, status, idempotencyKey, requestId, user, result, errorCode, errorMessage }) {
  const now = new Date().toISOString();
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: COMMAND_TYPE,
    command_source: 'customer_app_native_admin',
    status,
    target_entity: 'FulfillmentTask',
    target_id: task?.id || null,
    target_display_id: sanitizeText(task?.shopify_order_number || task?.order_number || nativeOrder?.shopify_order_number, 120) || null,
    actor_email: sanitizeText(user?.email, 180) || null,
    actor_role: sanitizeText(user?.role, 80) || null,
    actor_type: 'admin',
    payload: {
      exact_order_allowlist: true,
      patch_fields: safeStringArray(result?.patch_fields || [], 100),
    },
    result,
    error_code: errorCode || null,
    error_message: errorMessage ? sanitizeText(errorMessage, 180) : null,
    idempotency_key: idempotencyKey,
    idempotent_skipped: status === 'skipped',
    request_id: requestId,
    submitted_at: now,
    completed_at: status === 'running' ? null : now,
    function_name: 'executeNativeFulfillmentTaskMetadataRepair',
    related_order_id: nativeOrder?.id || null,
    related_order_number: sanitizeText(nativeOrder?.shopify_order_number || nativeOrder?.order_number, 120) || null,
    notes: 'Repairs display-critical metadata on one exact existing native FulfillmentTask. No Customer App Order, native ShopifyOrder, provider, notification, production, inventory, PO, sync, repair, or replay writes.',
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

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', message: 'POST required' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const parsed = await readJsonBody(req);
    if (!parsed.ok) {
      return Response.json({ success: false, error_code: 'malformed_json', message: 'Malformed JSON body' }, { status: 400 });
    }
    const body = parsed.body || {};

    let user;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ success: false, error_code: 'unauthorized', writes_performed: false }, { status: 401 });
    }
    if (user?.role !== 'admin') {
      return Response.json({ success: false, error_code: 'forbidden', writes_performed: false }, { status: 403 });
    }

    if (normalizeText(body.confirmation) !== CONFIRMATION_PHRASE || normalizeLower(body.mode) !== 'live') {
      return Response.json({ success: false, error_code: 'confirmation_required', writes_performed: false }, { status: 400 });
    }

    const requestId = sanitizeId(body.request_id, 160);
    if (!requestId) return Response.json({ success: false, error_code: 'request_id_required', writes_performed: false }, { status: 400 });
    const idempotencyKey = `${COMMAND_TYPE}:${requestId}`;
    const actorEmail = normalizeLower(user.email);

    const existingLogs = await findExistingCommandLog(base44, idempotencyKey);
    const existingLog = Array.isArray(existingLogs) && existingLogs.length > 0 ? existingLogs[0] : null;
    if (shouldSkipForIdempotency(existingLog)) {
      return Response.json({
        success: true,
        skipped: true,
        idempotent: true,
        reason: 'idempotency_log_present',
        request_id: requestId,
        idempotency_key: idempotencyKey,
        native_writer_enabled: gateSummary().enabled,
        writes_performed: false,
      });
    }

    const target = await resolveRepairTarget(base44, body);
    if (target.blockers.length > 0 || !target.plan) {
      return Response.json({
        success: false,
        skipped: true,
        error_code: 'metadata_repair_target_blocked',
        blockers: safeStringArray(target.blockers),
        gate_snapshot: gateSummary(),
        writes_performed: false,
      }, { status: 409 });
    }

    const gateFailure = envGateFailure({
      actorEmail,
      lookup: target.lookup,
      task: target.task,
      nativeOrder: target.nativeOrder,
      customerOrder: target.customerOrder,
    });
    if (gateFailure) {
      return Response.json({
        success: false,
        skipped: true,
        error_code: gateFailure,
        gate_snapshot: gateSummary(),
        native_writer_enabled: gateSummary().enabled,
        writes_performed: false,
      }, { status: 409 });
    }

    if (!target.plan.ready) {
      const preflightErrorCode = target.plan.blockers.includes('unsupported_repair_field')
        ? 'unsupported_repair_field'
        : 'metadata_repair_preflight_blocked';
      await createCommandLog({
        base44,
        task: target.task,
        nativeOrder: target.nativeOrder,
        status: 'rejected',
        idempotencyKey,
        requestId,
        user,
        result: {
          blockers: target.plan.blockers,
          warnings: target.plan.warnings,
          patch_fields: target.plan.patch_fields,
          unsupported_patch_fields: target.plan.unsupported_patch_fields,
          invalid_patch_type_fields: target.plan.invalid_patch_type_fields,
          excluded_unapproved_fields: target.plan.excluded_unapproved_fields,
          excluded_repair_fields: target.plan.excluded_repair_fields,
          excluded_repair_reasons: target.plan.excluded_repair_reasons,
          writes_performed: false,
        },
        errorCode: preflightErrorCode,
        errorMessage: target.plan.blockers.join(', '),
      });
      return Response.json({
        success: false,
        skipped: true,
        error_code: preflightErrorCode,
        blockers: target.plan.blockers,
        warnings: target.plan.warnings,
        unsupported_patch_fields: target.plan.unsupported_patch_fields,
        invalid_patch_type_fields: target.plan.invalid_patch_type_fields,
        excluded_unapproved_fields: target.plan.excluded_unapproved_fields,
        excluded_repair_fields: target.plan.excluded_repair_fields,
        excluded_repair_reasons: target.plan.excluded_repair_reasons,
        native_writer_enabled: true,
        writes_performed: false,
      }, { status: 409 });
    }

    const livePatchValidation = validateRepairPatch(target.plan.patch);
    if (!livePatchValidation.ok) {
      return Response.json({
        success: false,
        skipped: true,
        error_code: 'unsupported_repair_field',
        unsupported_patch_fields: livePatchValidation.unsupported_patch_fields,
        invalid_patch_type_fields: livePatchValidation.invalid_patch_type_fields,
        native_writer_enabled: true,
        writes_performed: false,
      }, { status: 409 });
    }

    if (target.plan.patch_fields.length === 0) {
      await createCommandLog({
        base44,
        task: target.task,
        nativeOrder: target.nativeOrder,
        status: 'skipped',
        idempotencyKey,
        requestId,
        user,
        result: {
          action: target.plan.action,
          warnings: target.plan.warnings,
          patch_fields: [],
          unsupported_patch_fields: target.plan.unsupported_patch_fields,
          invalid_patch_type_fields: target.plan.invalid_patch_type_fields,
          excluded_unapproved_fields: target.plan.excluded_unapproved_fields,
          excluded_repair_fields: target.plan.excluded_repair_fields,
          excluded_repair_reasons: target.plan.excluded_repair_reasons,
          writes_performed: false,
          fulfillment_task_updated: false,
        },
      });
      return Response.json({
        success: true,
        skipped: true,
        action: target.plan.action,
        request_id: requestId,
        idempotency_key: idempotencyKey,
        fulfillment_task_id: target.task?.id || null,
        patch_fields: [],
        warnings: target.plan.warnings,
        unsupported_patch_fields: target.plan.unsupported_patch_fields,
        invalid_patch_type_fields: target.plan.invalid_patch_type_fields,
        excluded_unapproved_fields: target.plan.excluded_unapproved_fields,
        excluded_repair_fields: target.plan.excluded_repair_fields,
        excluded_repair_reasons: target.plan.excluded_repair_reasons,
        native_writer_enabled: true,
        writes_performed: false,
        fulfillment_task_updated: false,
      });
    }

    const commandLog = await createCommandLog({
      base44,
      task: target.task,
      nativeOrder: target.nativeOrder,
      status: 'running',
      idempotencyKey,
      requestId,
      user,
      result: {
        action: target.plan.action,
        warnings: target.plan.warnings,
        patch_fields: target.plan.patch_fields,
        unsupported_patch_fields: target.plan.unsupported_patch_fields,
        invalid_patch_type_fields: target.plan.invalid_patch_type_fields,
        excluded_unapproved_fields: target.plan.excluded_unapproved_fields,
        excluded_repair_fields: target.plan.excluded_repair_fields,
        excluded_repair_reasons: target.plan.excluded_repair_reasons,
        writes_performed: false,
      },
    });

    let updatedTask;
    try {
      updatedTask = await base44.asServiceRole.entities.FulfillmentTask.update(target.task.id, target.plan.patch);
    } catch (error) {
      await updateCommandLog({
        base44,
        commandLogId: commandLog?.id,
        status: 'failed',
        result: {
          action: target.plan.action,
          warnings: target.plan.warnings,
          patch_fields: target.plan.patch_fields,
          unsupported_patch_fields: target.plan.unsupported_patch_fields,
          invalid_patch_type_fields: target.plan.invalid_patch_type_fields,
          excluded_unapproved_fields: target.plan.excluded_unapproved_fields,
          excluded_repair_fields: target.plan.excluded_repair_fields,
          excluded_repair_reasons: target.plan.excluded_repair_reasons,
          writes_performed: false,
          fulfillment_task_updated: false,
        },
        errorCode: 'metadata_repair_write_failed',
        errorMessage: error?.message || 'FulfillmentTask metadata repair write failed',
      }).catch(() => null);
      throw error;
    }

    await updateCommandLog({
      base44,
      commandLogId: commandLog?.id,
      status: 'success',
      result: {
        action: target.plan.action,
        warnings: target.plan.warnings,
        patch_fields: target.plan.patch_fields,
        unsupported_patch_fields: target.plan.unsupported_patch_fields,
        invalid_patch_type_fields: target.plan.invalid_patch_type_fields,
        excluded_unapproved_fields: target.plan.excluded_unapproved_fields,
        excluded_repair_fields: target.plan.excluded_repair_fields,
        excluded_repair_reasons: target.plan.excluded_repair_reasons,
        missing_display_fields_after: target.plan.missing_display_fields_after,
        writes_performed: true,
        fulfillment_task_updated: true,
        customer_app_order_updated: false,
        native_shopify_order_updated: false,
        customer_notification_sent: false,
        external_service_calls: false,
        inventory_or_po_mutation: false,
      },
    });

    return Response.json({
      success: true,
      skipped: false,
      action: target.plan.action,
      request_id: requestId,
      idempotency_key: idempotencyKey,
      fulfillment_task_id: updatedTask?.id || target.task.id,
      order_number: sanitizeText(target.nativeOrder?.shopify_order_number || target.task?.shopify_order_number || target.task?.order_number, 120) || null,
      command_log_id: sanitizeId(commandLog?.id) || null,
      patch_fields: target.plan.patch_fields,
      unsupported_patch_fields: target.plan.unsupported_patch_fields,
      invalid_patch_type_fields: target.plan.invalid_patch_type_fields,
      excluded_unapproved_fields: target.plan.excluded_unapproved_fields,
      excluded_repair_fields: target.plan.excluded_repair_fields,
      excluded_repair_reasons: target.plan.excluded_repair_reasons,
      missing_display_fields_after: target.plan.missing_display_fields_after,
      warnings: target.plan.warnings,
      native_writer_enabled: true,
      writes_performed: true,
      fulfillment_task_updated: true,
      customer_app_order_updated: false,
      native_shopify_order_updated: false,
      customer_notification_sent: false,
      provider_calls: false,
      stripe_calls: false,
      shopify_calls: false,
      inventory_or_po_mutation: false,
      sync_retry_repair_run: false,
      hub_bridge_modified: false,
    });
  } catch (error) {
    console.error(`[executeNativeFulfillmentTaskMetadataRepair] failed safely: ${error?.message || 'unknown error'}`);
    return Response.json({
      success: false,
      error_code: 'native_task_metadata_repair_failed',
      message: 'Native FulfillmentTask metadata repair failed safely.',
      writes_performed: false,
    }, { status: 500 });
  }
});
