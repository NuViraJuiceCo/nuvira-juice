// @ts-nocheck
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

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

const PROGRAM_COMPOSITIONS = [
  {
    matcher: /\bhydration\s+program\b/i,
    items: [
      { title: 'OASIS', quantity: 9 },
      { title: 'AURA', quantity: 3 },
    ],
  },
  {
    matcher: /\bradiance\s+program\b/i,
    items: [
      { title: 'AURA', quantity: 9 },
      { title: 'OASIS', quantity: 3 },
    ],
  },
  {
    matcher: /\breset\s+program\b/i,
    items: [
      { title: 'RE-NU', quantity: 9 },
      { title: 'OASIS', quantity: 3 },
    ],
  },
];

function safeQuantity(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function itemTitle(item) {
  return operationalText(item?.title || item?.name || item?.product_name || item?.product_title, 120);
}

function compositionItems(item) {
  const explicitComposition = Array.isArray(item?.bundle_composition)
    ? item.bundle_composition
    : Array.isArray(item?.composition)
      ? item.composition
      : [];

  return explicitComposition
    .map(component => ({
      title: operationalText(component?.product_name || component?.title || component?.name || component?.flavor, 120),
      quantity: safeQuantity(component?.quantity || component?.qty, 0),
    }))
    .filter(component => component.title && component.quantity > 0);
}

function operationalLineItems(items) {
  if (!Array.isArray(items)) return [];
  const expanded = [];

  for (const item of items) {
    const parentQuantity = safeQuantity(item?.quantity || item?.qty, 1);
    const explicitComposition = compositionItems(item);

    if (explicitComposition.length > 0) {
      for (const component of explicitComposition) {
        expanded.push({
          title: component.title,
          quantity: component.quantity * parentQuantity,
        });
      }
      continue;
    }

    const title = itemTitle(item);
    const programComposition = PROGRAM_COMPOSITIONS.find(program => program.matcher.test(title));

    if (programComposition) {
      for (const component of programComposition.items) {
        expanded.push({
          title: component.title,
          quantity: component.quantity * parentQuantity,
        });
      }
      continue;
    }

    if (title) {
      expanded.push({
        product_id: item?.shopify_line_item_id || item?.id || item?.product_id,
        title,
        price: item?.price,
        quantity: parentQuantity,
      });
    }
  }

  const byTitle = new Map();
  for (const item of expanded) {
    const key = item.title.toLowerCase();
    const current = byTitle.get(key) || { title: item.title, quantity: 0, product_id: item.product_id, price: item.price };
    current.quantity += item.quantity;
    byTitle.set(key, current);
  }

  return Array.from(byTitle.values());
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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

function lineItemsSummary(items) {
  return operationalLineItems(items)
    .slice(0, 8)
    .map(item => `${safeQuantity(item.quantity, 1)}x ${operationalText(item.title, 80)}`)
    .filter(item => !item.startsWith('0x '))
    .join(', ');
}

function taskItemsFromOrder(order) {
  if (!Array.isArray(order.line_items)) return [];
  return operationalLineItems(order.line_items).slice(0, SAFE_ARRAY_LIMIT).map(item => ({
    product_id: sanitizeId(item.product_id || item.shopify_line_item_id || item.id, 120),
    title: operationalText(item.title, 120) || 'Item',
    price: safeNumber(item.price) ?? 0,
    quantity: safeQuantity(item.quantity, 0),
  })).filter(item => item.title && item.quantity > 0);
}

function deliveryAddress(order) {
  return operationalText(order.delivery_address || order.address || [
    order.address_line1,
    order.address_city,
    order.address_state,
    order.address_postal_code,
  ].filter(Boolean).join(', '), 280);
}

function hasNativeMarker(order) {
  const tags = Array.isArray(order.tags) ? order.tags.map(normalizeLower) : [];
  return tags.includes('native_order_ops') ||
    normalizeLower(order.sync_status) === 'native_ops_ready' ||
    normalizeLower(order.source_type).includes('customer_app') ||
    normalizeLower(order.source_channel) === 'online';
}

function buildTaskDraft(order, body) {
  const deliveryDate = parseIsoDate(body.delivery_date || body.assigned_delivery_date || body.target_delivery_date, 'delivery_date');
  const productionDate = parseIsoDate(
    body.production_date ||
    body.target_production_date ||
    order.production_date ||
    order.assigned_production_day,
    'production_date',
  );
  const windowLabel = sanitizeText(body.delivery_window_label || order.delivery_window_label || order.requested_time_window, 120);
  const items = taskItemsFromOrder(order);
  const address = deliveryAddress(order);
  const addressComplete = Boolean(order.address_line1 && order.address_city && order.address_state && order.address_postal_code);

  return {
    order_id: order.id,
    base44_order_id: sanitizeId(order.base44_order_id, 120),
    shopify_order_id: order.id,
    native_shopify_order_id: order.id,
    shopify_order_number: operationalText(order.shopify_order_number || order.order_number, 120),
    order_number: operationalText(order.shopify_order_number || order.order_number, 120),
    customer_name: operationalText(order.customer_name, 160),
    customer_email: operationalText(order.customer_email, 180),
    customer_phone: operationalText(order.customer_phone, 80),
    source_channel: sanitizeText(order.source_channel || 'customer_app', 80),
    source_type: sanitizeText(order.source_type || 'customer_app_native', 80),
    task_source: 'previewNativeFulfillmentTaskMaterialization',
    created_from_native_ops: true,
    order_type: sanitizeText(order.order_type || 'one_time', 80),
    fulfillment_type: 'delivery',
    fulfillment_number: 1,
    delivery_date: deliveryDate,
    scheduled_date: deliveryDate,
    assigned_delivery_date: deliveryDate,
    ...(productionDate ? { production_date: productionDate } : {}),
    ...(windowLabel ? { time_window: windowLabel, delivery_window_label: windowLabel } : {}),
    address,
    delivery_address: address,
    address_line1: operationalText(order.address_line1, 120),
    address_line2: operationalText(order.address_line2, 120),
    address_city: operationalText(order.address_city, 100),
    address_state: operationalText(order.address_state, 80),
    address_postal_code: operationalText(order.address_postal_code, 40),
    items,
    items_summary: lineItemsSummary(order.line_items),
    line_item_count: items.length,
    total_price: safeNumber(order.total_price ?? order.total ?? order.subtotal),
    address_complete: addressComplete,
    status: 'scheduled',
    delivery_status: 'scheduled',
    production_status: sanitizeText(order.production_status, 80) || 'awaiting_production',
    payment_status: sanitizeText(order.payment_status || order.financial_status, 80),
    sync_status: 'native_task_materialized',
    schedule_source: 'native_admin_materialization',
    delivery_zone_key: sanitizeText(order.delivery_zone_key, 80),
    internal_notes: sanitizeText(`Native fulfillment task materialization preview for ${order.shopify_order_number || order.order_number}.`, 500),
    review_status: null,
    review_reason: null,
    audit_trail: [{
      timestamp: new Date().toISOString(),
      action: 'native_fulfillment_task_materialization_preview',
      performed_by: 'native_preview',
      request_id: sanitizeId(body.request_id) || null,
    }],
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
  if (!order?.id) {
    return {
      ready: false,
      blockers: ['order_not_found'],
      warnings,
      draft: null,
      projected_writes: [],
    };
  }
  if (existingTasks.length > 0) blockers.push('fulfillment_task_already_exists');
  if (!hasNativeMarker(order)) warnings.push('native_marker_not_present');
  if (normalizeLower(order.order_type) === 'subscription' || order.stripe_subscription_id) blockers.push('subscription_order_not_supported');
  if (normalizeLower(order.order_type) === 'pos' || normalizeLower(order.source_channel) === 'pos' || normalizeLower(order.fulfillment_method) === 'pos') blockers.push('pos_order_not_delivery_task');
  if (normalizeLower(order.fulfillment_method) !== 'delivery') blockers.push('not_delivery_order');
  if (!['paid', 'succeeded'].includes(normalizeLower(order.payment_status || order.financial_status))) blockers.push('payment_not_paid');
  if (['cancelled', 'canceled', 'refunded'].includes(normalizeLower(order.payment_status || order.financial_status || order.order_status))) blockers.push('order_cancelled_or_refunded');
  if (!deliveryAddress(order)) blockers.push('missing_delivery_address');
  if (!Array.isArray(order.line_items) || order.line_items.length === 0) blockers.push('missing_line_items');

  let draft = null;
  try {
    draft = buildTaskDraft(order, body);
    if (!draft.delivery_date) blockers.push('missing_delivery_date');
    if (!draft.production_date) warnings.push('production_date_not_provided');
  } catch (error) {
    blockers.push(error.message.includes('production_date') ? 'invalid_production_date' : 'invalid_delivery_date');
  }

  return {
    ready: blockers.length === 0,
    blockers: safeStringArray(blockers),
    warnings: safeStringArray(warnings),
    draft: blockers.length === 0 ? draft : null,
    projected_writes: blockers.length === 0
      ? ['ShopifyOrder.assigned_delivery_date', 'ShopifyOrder.selected_delivery_date', 'ShopifyOrder.requested_delivery_date', 'FulfillmentTask']
      : [],
  };
}

export default async function handler(req: Request) {
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
        task_materialization_ready: false,
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
      task_materialization_ready: plan.ready,
      native_write_allowed: false,
      order_id: sanitizeId(order?.id) || null,
      order_number: sanitizeText(order?.shopify_order_number || order?.order_number, 120) || sanitizeText(body.order_number, 120) || null,
      existing_task_count: existingTasks.length,
      blockers: plan.blockers,
      warnings: plan.warnings,
      projected_writes: plan.projected_writes,
      fulfillment_task_draft: plan.draft ? {
        order_id: plan.draft.order_id,
        order_number: plan.draft.order_number,
        delivery_date: plan.draft.delivery_date,
        production_date: plan.draft.production_date || null,
        item_count: plan.draft.items.length,
        items_summary: plan.draft.items_summary,
        status: plan.draft.status,
      } : null,
      side_effect_policy: {
        customer_app_order_update: false,
        inventory_or_po: false,
        notifications: false,
        provider_calls: false,
        stripe_calls: false,
        shopify_calls: false,
        sync_retry_repair: false,
      },
    });
  } catch (error) {
    console.error('[previewNativeFulfillmentTaskMaterialization] Error');
    return Response.json({
      success: false,
      error_code: 'internal_error',
      error: 'Unable to preview native fulfillment task materialization',
      detail: sanitizeText(error?.message, 120) || undefined,
    }, { status: 500 });
  }
}
