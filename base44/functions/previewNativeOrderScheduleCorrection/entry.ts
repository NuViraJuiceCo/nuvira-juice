import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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

function safeStringArray(value, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, SAFE_ARRAY_LIMIT).map(item => sanitizeText(item, maxLength)).filter(Boolean);
}

function parseIsoDate(value, fieldName) {
  const text = normalizeText(value);
  if (!text) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${fieldName} must use YYYY-MM-DD format`);
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== text) throw new Error(`${fieldName} must be a valid calendar date`);
  return text;
}

async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function hasNativeMarker(order) {
  const tags = Array.isArray(order?.tags) ? order.tags.map(normalizeLower) : [];
  return tags.includes('native_order_ops') ||
    normalizeLower(order?.sync_status) === 'native_ops_ready' ||
    normalizeLower(order?.source_type).includes('customer_app') ||
    normalizeLower(order?.source_channel) === 'online';
}

function currentDeliveryDates(order) {
  return [
    order?.assigned_delivery_date,
    order?.selected_delivery_date,
    order?.requested_delivery_date,
    order?.estimated_delivery_date,
    order?.delivery_date,
  ].map(normalizeText).filter(Boolean);
}

function safeOrderSnapshot(order) {
  if (!order?.id) return null;
  return {
    id: sanitizeId(order.id),
    order_number: sanitizeText(order.shopify_order_number || order.order_number, 120) || null,
    source_channel: sanitizeText(order.source_channel, 80) || null,
    source_type: sanitizeText(order.source_type, 80) || null,
    order_type: sanitizeText(order.order_type, 80) || null,
    fulfillment_method: sanitizeText(order.fulfillment_method, 80) || null,
    payment_status: sanitizeText(order.payment_status || order.financial_status, 80) || null,
    order_status: sanitizeText(order.order_status || order.status, 80) || null,
    assigned_delivery_date: sanitizeText(order.assigned_delivery_date, 40) || null,
    selected_delivery_date: sanitizeText(order.selected_delivery_date, 40) || null,
    requested_delivery_date: sanitizeText(order.requested_delivery_date, 40) || null,
    production_date: sanitizeText(order.production_date, 40) || null,
    delivery_window_label: sanitizeText(order.delivery_window_label || order.requested_time_window, 120) || null,
    fulfillment_status: sanitizeText(order.fulfillment_status, 80) || null,
    line_item_count: Array.isArray(order.line_items) ? order.line_items.length : 0,
    audit_trail_count: Array.isArray(order.audit_trail) ? order.audit_trail.length : 0,
  };
}

function buildPatchDraft(order, body) {
  const deliveryDate = parseIsoDate(body.delivery_date || body.assigned_delivery_date || body.target_delivery_date, 'delivery_date');
  const productionDate = parseIsoDate(body.production_date || body.target_production_date, 'production_date');
  const windowLabel = sanitizeText(body.delivery_window_label || body.target_window_label || order?.delivery_window_label || order?.requested_time_window, 120);
  return {
    assigned_delivery_date: deliveryDate,
    selected_delivery_date: deliveryDate,
    requested_delivery_date: deliveryDate,
    production_date: productionDate,
    ...(windowLabel ? { delivery_window_label: windowLabel, requested_time_window: windowLabel } : {}),
  };
}

async function findOrder(base44, body) {
  const key = sanitizeId(body.shopify_order_id || body.native_order_id || body.order_id);
  if (key) {
    const byId = await base44.asServiceRole.entities.ShopifyOrder.get(key).catch(() => null);
    if (byId?.id) return { order: byId, matches: [byId] };
  }

  const orderNumber = sanitizeText(body.order_number || body.shopify_order_number, 120);
  const filters = [];
  if (orderNumber) {
    filters.push({ shopify_order_number: orderNumber });
    filters.push({ order_number: orderNumber });
  }

  const matches = [];
  for (const filter of filters) {
    const found = await base44.asServiceRole.entities.ShopifyOrder.filter(filter, '-created_date', 5).catch(() => []);
    for (const item of found || []) {
      if (item?.id && !matches.some(match => match.id === item.id)) matches.push(item);
    }
  }

  return { order: matches.length === 1 ? matches[0] : null, matches };
}

async function findExistingTasks(base44, order) {
  if (!order?.id) return [];
  const queries = [
    { order_id: order.id },
    { shopify_order_id: order.id },
    { shopify_order_number: order.shopify_order_number },
    { order_number: order.shopify_order_number || order.order_number },
  ].filter(filter => Object.values(filter)[0]);
  const matches = [];
  for (const filter of queries) {
    const found = await base44.asServiceRole.entities.FulfillmentTask.filter(filter, '-created_date', 10).catch(() => []);
    for (const item of found || []) {
      if (item?.id && !matches.some(match => match.id === item.id)) matches.push(item);
    }
  }
  return matches;
}

function buildPlan(order, existingTasks, body) {
  const blockers = [];
  const warnings = [];
  let patchDraft = null;

  if (!order?.id) {
    return { ready: false, blockers: ['order_not_found'], warnings, patchDraft: null, projected_writes: [] };
  }

  try {
    patchDraft = buildPatchDraft(order, body);
    if (!patchDraft.assigned_delivery_date) blockers.push('missing_delivery_date');
    if (!patchDraft.production_date) blockers.push('missing_production_date');
  } catch (error) {
    blockers.push(error.message.includes('production_date') ? 'invalid_production_date' : 'invalid_delivery_date');
  }

  if (!hasNativeMarker(order)) warnings.push('native_marker_not_present');
  if (existingTasks.length > 0) blockers.push('fulfillment_task_already_exists');
  if (normalizeLower(order.order_type) === 'subscription' || order.stripe_subscription_id) blockers.push('subscription_order_not_supported');
  if (normalizeLower(order.order_type) === 'pos' || normalizeLower(order.source_channel) === 'pos' || normalizeLower(order.fulfillment_method) === 'pos') blockers.push('pos_order_not_supported');
  if (normalizeLower(order.fulfillment_method || 'delivery') !== 'delivery') blockers.push('not_delivery_order');
  if (!['paid', 'succeeded'].includes(normalizeLower(order.payment_status || order.financial_status))) blockers.push('payment_not_paid');
  if (['cancelled', 'canceled', 'refunded'].includes(normalizeLower(order.payment_status || order.financial_status || order.order_status || order.status))) blockers.push('order_cancelled_or_refunded');

  const existingDates = currentDeliveryDates(order);
  const uniqueExistingDates = [...new Set(existingDates)];
  const targetDate = normalizeText(patchDraft?.assigned_delivery_date);
  if (uniqueExistingDates.length > 0 && !uniqueExistingDates.every(date => date === targetDate)) {
    blockers.push('existing_delivery_date_present');
  }
  if (normalizeText(order.production_date) && normalizeText(order.production_date) !== normalizeText(patchDraft?.production_date)) {
    blockers.push('existing_production_date_present');
  }
  if (!Array.isArray(order.line_items) || order.line_items.length === 0) warnings.push('missing_line_items');

  const ready = blockers.length === 0 && Boolean(patchDraft);
  return {
    ready,
    blockers: safeStringArray([...new Set(blockers)]),
    warnings: safeStringArray([...new Set(warnings)]),
    patchDraft: ready ? patchDraft : null,
    projected_writes: ready ? ['ShopifyOrder.assigned_delivery_date', 'ShopifyOrder.selected_delivery_date', 'ShopifyOrder.requested_delivery_date', 'ShopifyOrder.production_date', 'ShopifyOrder.audit_trail'] : [],
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', error: 'Method not allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const body = await readJsonBody(req);
    if (body === null) return Response.json({ success: false, error_code: 'malformed_json' }, { status: 400 });

    let user;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ success: false, error_code: 'unauthorized' }, { status: 401 });
    }
    if (user?.role !== 'admin') return Response.json({ success: false, error_code: 'forbidden' }, { status: 403 });

    const { order, matches } = await findOrder(base44, body);
    if (!order && matches.length > 1) {
      return Response.json({
        success: true,
        dry_run: true,
        schedule_correction_ready: false,
        native_write_allowed: false,
        blockers: ['multiple_order_matches'],
        warnings: [],
        projected_writes: [],
      });
    }

    const existingTasks = order ? await findExistingTasks(base44, order) : [];
    const plan = buildPlan(order, existingTasks, body);

    return Response.json({
      success: true,
      dry_run: true,
      schedule_correction_ready: plan.ready,
      native_write_allowed: false,
      order_id: sanitizeId(order?.id) || null,
      order_number: sanitizeText(order?.shopify_order_number || order?.order_number, 120) || sanitizeText(body.order_number, 120) || null,
      existing_task_count: existingTasks.length,
      before: safeOrderSnapshot(order),
      blockers: plan.blockers,
      warnings: plan.warnings,
      projected_writes: plan.projected_writes,
      patch_draft: plan.patchDraft,
      side_effect_policy: {
        customer_app_order_update: false,
        fulfillment_task_update: false,
        fulfillment_task_create: false,
        inventory_or_po: false,
        notifications: false,
        provider_calls: false,
        stripe_calls: false,
        shopify_calls: false,
        sync_retry_repair: false,
      },
    });
  } catch (error) {
    console.error('[previewNativeOrderScheduleCorrection] Error');
    return Response.json({
      success: false,
      error_code: 'internal_error',
      error: 'Unable to preview native order schedule correction',
      detail: sanitizeText(error?.message, 120) || undefined,
    }, { status: 500 });
  }
});
