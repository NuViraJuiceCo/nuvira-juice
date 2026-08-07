import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { buildDeliveryLifecycleReadModel } from './deliveryLifecycleReadModel.js';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const CHICAGO_TZ = 'America/Chicago';
const MAX_LIMIT = 100;
const UNSCHEDULED_NATIVE_ORDER_REVIEW_DAYS = 14;
const NATIVE_DELIVERY_TASK_ACTION_WINDOW_DAYS = 14;
const DELIVERY_LIFECYCLE_READ_MODEL_ENABLE = 'ENABLE_ADMIN_DELIVERY_LIFECYCLE_READ_MODEL';
const DELIVERY_LIFECYCLE_READ_MODEL_KILL_SWITCH = 'ADMIN_DELIVERY_LIFECYCLE_READ_MODEL_KILL_SWITCH';
const DELIVERY_LIFECYCLE_READ_MODEL_VERSION = 'g48d_delivery_lifecycle_v1';
const DELIVERY_LIFECYCLE_READ_MODEL_MODE = 'DELIVERY_LIFECYCLE';

async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return (value || '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
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
  return normalizeText(item?.title || item?.name || item?.product_name || item?.product_title);
}

function compositionItems(item) {
  const explicitComposition = Array.isArray(item?.bundle_composition)
    ? item.bundle_composition
    : Array.isArray(item?.composition)
      ? item.composition
      : [];

  return explicitComposition
    .map(component => ({
      title: normalizeText(component?.product_name || component?.title || component?.name || component?.flavor),
      quantity: safeQuantity(component?.quantity || component?.qty, 0),
    }))
    .filter(component => component.title && component.quantity > 0);
}

function operationalLineItems(items) {
  if (!Array.isArray(items) || items.length === 0) return [];
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
      expanded.push({ title, quantity: parentQuantity });
    }
  }

  const byTitle = new Map();
  for (const item of expanded) {
    const key = item.title.toLowerCase();
    const current = byTitle.get(key) || { title: item.title, quantity: 0 };
    current.quantity += item.quantity;
    byTitle.set(key, current);
  }

  return Array.from(byTitle.values());
}

function envFlagEnabled(key) {
  const value = normalizeLower(Deno.env.get(key));
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(value);
}

function deliveryLifecycleReadModelEnabled() {
  return envFlagEnabled(DELIVERY_LIFECYCLE_READ_MODEL_ENABLE) && !envFlagEnabled(DELIVERY_LIFECYCLE_READ_MODEL_KILL_SWITCH);
}

function isDeliveryLifecycleReadModelRequest(body) {
  return normalizeText(body?.read_model_mode || body?.preview_mode || body?.mode).toUpperCase() === DELIVERY_LIFECYCLE_READ_MODEL_MODE;
}


function normalizeDate(value) {
  const text = normalizeText(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function lineItemsSummary(items) {
  const operationalItems = operationalLineItems(items);
  if (operationalItems.length === 0) return null;
  return operationalItems
    .slice(0, 8)
    .map(item => {
      const title = normalizeText(item?.title);
      const quantity = safeQuantity(item?.quantity, 1);
      return title ? `${quantity}x ${title}` : null;
    })
    .filter(Boolean)
    .join(', ');
}

function operationalSummaryFromText(value) {
  const text = normalizeText(value);
  if (!text) return null;

  const expanded = [];
  let changed = false;
  for (const segment of text.split(/[,;]/).map(normalizeText).filter(Boolean)) {
    const prefixMatch = segment.match(/^(\d+(?:\.\d+)?)\s*(?:x|×)\s+(.+)$/i);
    const suffixMatch = prefixMatch ? null : segment.match(/^(.+?)\s*(?:x|×)\s*(\d+(?:\.\d+)?)$/i);
    const parentQuantity = prefixMatch
      ? safeQuantity(prefixMatch[1], 1)
      : suffixMatch ? safeQuantity(suffixMatch[2], 1) : 1;
    const title = normalizeText(prefixMatch ? prefixMatch[2] : suffixMatch ? suffixMatch[1] : segment);
    const programComposition = PROGRAM_COMPOSITIONS.find(program => program.matcher.test(title));

    if (!programComposition) {
      expanded.push({ title: prefixMatch || suffixMatch ? `${parentQuantity}x ${title}` : title, passthrough: true });
      continue;
    }

    changed = true;
    for (const component of programComposition.items) {
      expanded.push({
        title: component.title,
        quantity: component.quantity * parentQuantity,
      });
    }
  }

  if (!changed) return text;

  const byTitle = new Map();
  const passthrough = [];
  for (const item of expanded) {
    if (item.passthrough) {
      passthrough.push(item.title);
      continue;
    }
    const key = item.title.toLowerCase();
    const current = byTitle.get(key) || { title: item.title, quantity: 0 };
    current.quantity += item.quantity;
    byTitle.set(key, current);
  }

  return [
    ...Array.from(byTitle.values()).map(item => `${safeQuantity(item.quantity, 1)}x ${item.title}`),
    ...passthrough,
  ].filter(Boolean).join(', ');
}

function operationalItemsSummary({ task = {}, order = {} }) {
  return (
    lineItemsSummary(task.items) ||
    lineItemsSummary(order.line_items) ||
    operationalSummaryFromText(task.items_summary) ||
    operationalSummaryFromText(order.items_summary)
  );
}

function itemCountFromSummary(summary) {
  const text = operationalSummaryFromText(summary);
  if (!text) return 0;
  return text.split(',').map(normalizeText).filter(Boolean).length;
}

function operationalLineItemCount({ task = {}, order = {} }) {
  const taskItems = operationalLineItems(task.items);
  if (taskItems.length > 0) return taskItems.length;

  const orderItems = operationalLineItems(order.line_items);
  if (orderItems.length > 0) return orderItems.length;

  return (
    itemCountFromSummary(task.items_summary) ||
    itemCountFromSummary(order.items_summary) ||
    safeLineItems(order).length ||
    (Array.isArray(task.items) ? task.items.length : null)
  );
}

function sanitizeAssignedDriver(value) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');

  if (!text) return null;
  return text.length > 120 ? `${text.slice(0, 119).trim()}...` : text;
}

function sanitizeCustomerName(value) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');

  if (!text) return null;
  return text.length > 120 ? `${text.slice(0, 119).trim()}...` : text;
}

function normalizeAddressInput(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return [
      value.address_line1 || value.line1 || value.street || value.street1,
      value.address_line2 || value.line2 || value.street2,
      value.address_city || value.city,
      value.address_state || value.state || value.province,
      value.address_postal_code || value.postal_code || value.zip || value.zip_code,
      value.address_country || value.country,
    ].map(normalizeText).filter(Boolean).join(', ');
  }

  return normalizeText(value);
}

function sanitizeAddress(value) {
  const text = normalizeAddressInput(value)
    .replace(/\s+/g, ' ')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');

  if (!text) return null;
  return text.length > 240 ? `${text.slice(0, 239).trim()}...` : text;
}

function sanitizeDeliveryNotes(value) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');

  if (!text) return null;
  return text.length > 300 ? `${text.slice(0, 299).trim()}...` : text;
}

function todayChicagoDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value, fieldName) {
  const text = normalizeText(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD format`);
  }

  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const normalized = date.toISOString().slice(0, 10);
  if (normalized !== text) {
    throw new Error(`${fieldName} must be a valid calendar date`);
  }

  return text;
}

function normalizeLimit(value) {
  const text = normalizeText(value);
  if (!text) return MAX_LIMIT;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('limit must be a positive integer');
  }
  return Math.min(parsed, MAX_LIMIT);
}

function normalizeTestTaskMode(value) {
  const mode = normalizeLower(value || 'exclude');
  if (!['exclude', 'only'].includes(mode)) {
    throw new Error('test_task_mode must be exclude or only');
  }
  return mode;
}

function sanitizeStringArray(values, maxItems = 8) {
  if (!Array.isArray(values)) return [];
  return values.map(value => sanitizeAssignedDriver(value)).filter(Boolean).slice(0, maxItems);
}

function isCompletedDeliveryStatus(value) {
  const key = normalizeLower(value).replace(/\s+/g, '_');
  return ['completed', 'complete', 'delivered', 'fulfilled'].includes(key);
}

function isStalePendingProductionStatus(value) {
  const key = normalizeLower(value).replace(/\s+/g, '_');
  return ['awaiting_production', 'scheduled', 'pending', 'not_required'].includes(key);
}

function effectiveFulfillmentStatus(stop = {}) {
  if (isCompletedDeliveryStatus(stop.delivery_status) || isCompletedDeliveryStatus(stop.task_status)) {
    return 'delivered';
  }
  return stop.fulfillment_status || null;
}

function sanitizeStop(stop) {
  return {
    task_id: stop.task_id || null,
    order_number: stop.order_number || null,
    customer_app_order_id: stop.customer_app_order_id || null,
    native_shopify_order_id: stop.native_shopify_order_id || null,
    native_fulfillment_task_id: stop.native_fulfillment_task_id || null,
    is_test_task: stop.is_test_task === true,
    test_purpose: stop.is_test_task === true ? normalizeText(stop.test_purpose) || null : null,
    hub_task_id: stop.hub_task_id || null,
    customer_name: sanitizeCustomerName(stop.customer_name),
    fulfillment_number: stop.fulfillment_number ?? null,
    source_type: stop.source_type || null,
    assigned_driver: sanitizeAssignedDriver(stop.assigned_driver),
    task_status: stop.task_status || null,
    delivery_status: stop.delivery_status || null,
    production_status: stop.production_status || null,
    fulfillment_status: effectiveFulfillmentStatus(stop),
    fulfillment_type: stop.fulfillment_type || null,
    fulfillment_method: stop.fulfillment_method || null,
    payment_status: stop.payment_status || null,
    line_item_count: stop.line_item_count ?? null,
    delivery_date: stop.delivery_date || null,
    scheduled_date: stop.scheduled_date || null,
    assigned_delivery_date: stop.assigned_delivery_date || null,
    delivery_window_label: stop.delivery_window_label || null,
    delivery_address: sanitizeAddress(stop.delivery_address),
    items_summary: operationalSummaryFromText(stop.items_summary) || null,
    delivered_at: stop.delivered_at || null,
    proof_available: stop.proof_available === true || Boolean(stop.delivery_photo_url || stop.delivery_drop_location),
    delivery_photo_url: stop.delivery_photo_url || null,
    delivery_drop_location: stop.delivery_drop_location || null,
    delivery_notes: sanitizeDeliveryNotes(stop.delivery_notes),
    missing_address: stop.missing_address === true,
    bag_return_required: stop.bag_return_required ?? null,
    bag_return_count: stop.bag_return_count ?? null,
    data_source: stop.data_source || null,
    fallback_source: stop.fallback_source || null,
    fallback_reason: stop.fallback_reason || null,
    suppression_reason: stop.suppression_reason || null,
    suppressed_from_active_summary: stop.suppressed_from_active_summary === true,
    stale_hub_fallback_suppressed: stop.stale_hub_fallback_suppressed === true,
    native_primary: stop.native_primary === true,
    hub_fallback_used: stop.hub_fallback_used === true,
    warnings: sanitizeStringArray(stop.warnings),
    hub_fallback_context: stop.hub_fallback_context || null,
  };
}

function sanitizeSummary(summary) {
  return {
    total_stops: Number(summary?.total_stops) || 0,
    active: Number(summary?.active) || 0,
    completed: Number(summary?.completed) || 0,
    unscheduled: Number(summary?.unscheduled) || 0,
    bag_returns: summary?.bag_returns === null || summary?.bag_returns === undefined
      ? null
      : Number(summary.bag_returns) || 0,
  };
}

function summarizeStops(active, completed, unscheduled = []) {
  const bagReturnValues = [...active, ...completed, ...unscheduled]
    .map(stop => stop.bag_return_count)
    .filter(value => value !== null && value !== undefined);
  return sanitizeSummary({
    total_stops: active.length + completed.length,
    active: active.length,
    completed: completed.length,
    unscheduled: unscheduled.length,
    bag_returns: bagReturnValues.length
      ? bagReturnValues.reduce((sum, value) => sum + (Number(value) || 0), 0)
      : null,
  });
}

async function fetchHubJson(url, headers) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      return { ok: false, warning: `hub_delivery_queue_unavailable:${response.status}`, data: null };
    }

    const data = await response.json().catch(() => null);
    return { ok: true, warning: null, data };
  } catch {
    return { ok: false, warning: 'hub_delivery_queue_unavailable:fetch_failed', data: null };
  }
}

function orderReferenceDate(order) {
  return normalizeDate(
    order?.customer_order_date ||
    order?.created_date ||
    order?.shopify_synced_at ||
    order?.updated_date,
  );
}

function isInRecentUnscheduledWindow(referenceDate, targetDate) {
  if (!referenceDate || !targetDate) return false;
  const reviewStart = addDays(targetDate, -UNSCHEDULED_NATIVE_ORDER_REVIEW_DAYS);
  return referenceDate >= reviewStart && referenceDate <= targetDate;
}

function isUnscheduledNativeDeliveryOrderInReviewWindow(order, deliveryDate) {
  return isInRecentUnscheduledWindow(orderReferenceDate(order), deliveryDate);
}

function isDeliveryDateOutsideActiveTaskWindow(deliveryDate, currentDate = todayChicagoDate()) {
  if (!deliveryDate || !currentDate) return false;
  const activeStart = addDays(currentDate, -NATIVE_DELIVERY_TASK_ACTION_WINDOW_DAYS);
  return deliveryDate < activeStart;
}

function isNonTerminalRouteStop(stop = {}) {
  return !(
    isCompletedDeliveryStatus(stop.task_status) ||
    isCompletedDeliveryStatus(stop.delivery_status) ||
    isCompletedDeliveryStatus(stop.fulfillment_status)
  );
}

function shouldSuppressStaleNativeDeliveryTask(stop, deliveryDate, testTaskMode) {
  if (testTaskMode === 'only') return false;
  const stopDate = normalizeDate(stop?.delivery_date || stop?.scheduled_date || stop?.assigned_delivery_date || deliveryDate);
  if (!stopDate || stopDate !== deliveryDate) return false;
  return isNonTerminalRouteStop(stop) && isDeliveryDateOutsideActiveTaskWindow(stopDate);
}

function safeLineItems(order) {
  return Array.isArray(order?.line_items) ? order.line_items.slice(0, 60) : [];
}

function hasNativeOperationalMarker(order) {
  const tags = Array.isArray(order?.tags) ? order.tags.map(normalizeLower) : [];
  const sourceType = normalizeLower(order?.source_type);
  const sourceChannel = normalizeLower(order?.source_channel);
  const syncStatus = normalizeLower(order?.sync_status);
  return (
    tags.includes('native_order_ops') ||
    ['native_ops_ready', 'native_ops_refunded'].includes(syncStatus) ||
    ['customer_app_one_time', 'website_one_time'].includes(sourceType) ||
    order?.created_from_native_ops === true
  );
}

function isNativeDeliveryOrder(order) {
  const paymentStatus = normalizeLower(order?.payment_status || order?.financial_status);
  const orderType = normalizeLower(order?.order_type);
  const sourceChannel = normalizeLower(order?.source_channel);
  const fulfillmentMethod = normalizeLower(order?.fulfillment_method);
  const productionStatus = normalizeLower(order?.production_status);

  if (!hasNativeOperationalMarker(order)) return false;
  if (order?.excluded_from_production === true) return false;
  if (['canceled', 'cancelled', 'refunded'].includes(productionStatus)) return false;
  if (['refunded', 'partially_refunded'].includes(paymentStatus)) return false;
  if (paymentStatus && paymentStatus !== 'paid') return false;
  if (orderType === 'pos' || sourceChannel === 'pos' || fulfillmentMethod === 'pos') return false;
  if (orderType === 'subscription' || sourceChannel === 'subscription' || order?.stripe_subscription_id) return false;
  if (fulfillmentMethod && fulfillmentMethod !== 'delivery') return false;
  return safeLineItems(order).length > 0;
}

function preferredCustomerName({ customerOrder = {}, order = {}, task = {}, profilesByEmail = new Map() }) {
  const identityEmail = normalizeLower(
    customerOrder?.customer_email || order?.customer_email || task?.customer_email,
  );
  const profile = profilesByEmail.get(identityEmail);
  const profileName = [profile?.first_name, profile?.last_name]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ');
  return profileName || customerOrder?.customer_name || order?.customer_name || task?.customer_name;
}

async function loadNativeDeliveryStops(base44, deliveryDate, limit, testTaskMode = 'exclude') {
  const includeOrderSources = testTaskMode !== 'only';
  const [tasks, orders, customerOrders, userProfiles] = await Promise.all([
    base44.asServiceRole.entities.FulfillmentTask.list('-delivery_date', 500).catch(() => []),
    includeOrderSources
      ? base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500).catch(() => [])
      : Promise.resolve([]),
    includeOrderSources && base44.asServiceRole.entities.Order?.list
      ? base44.asServiceRole.entities.Order.list('-created_date', 500).catch(() => [])
      : Promise.resolve([]),
    includeOrderSources && base44.asServiceRole.entities.UserProfile?.list
      ? base44.asServiceRole.entities.UserProfile.list('-updated_date', 500).catch(() => [])
      : Promise.resolve([]),
  ]);
  const selectedTasks = tasks.filter(task => (
    testTaskMode === 'only' ? task?.is_test_task === true : task?.is_test_task !== true
  ));
  const ordersById = new Map();
  const ordersByBase44Id = new Map();
  for (const order of orders) {
    if (order.id) ordersById.set(order.id, order);
    if (order.base44_order_id) ordersByBase44Id.set(order.base44_order_id, order);
  }
  const customerOrdersById = new Map();
  const customerOrdersByNumber = new Map();
  for (const order of customerOrders) {
    if (order.id) customerOrdersById.set(order.id, order);
    const orderNumber = normalizeLower(order.order_number || order.shopify_order_number);
    if (orderNumber) customerOrdersByNumber.set(orderNumber, order);
  }
  const profilesByEmail = new Map();
  for (const profile of userProfiles) {
    for (const email of [profile?.customer_email, profile?.contact_email]) {
      const key = normalizeLower(email);
      if (key && !profilesByEmail.has(key)) profilesByEmail.set(key, profile);
    }
  }

  function customerAppOrderFor(order = {}, task = {}) {
    return (
      customerOrdersById.get(order.base44_order_id || task.base44_order_id || task.order_id) ||
      customerOrdersByNumber.get(normalizeLower(order.shopify_order_number || order.order_number || task.order_number || task.shopify_order_number)) ||
      null
    );
  }

  function displayCustomerName({ customerOrder, order = {}, task = {} }) {
    return preferredCustomerName({ customerOrder, order, task, profilesByEmail });
  }

  const mappedTaskStops = selectedTasks
    .filter(task => normalizeDate(task.delivery_date || task.scheduled_date) === deliveryDate)
    .map(task => {
      const order = ordersById.get(task.order_id) || ordersByBase44Id.get(task.order_id) || {};
      const customerOrder = customerAppOrderFor(order, task);
      return sanitizeStop({
        task_id: task.id,
        order_number: order.shopify_order_number || order.order_number || task.order_number,
        customer_app_order_id: order.base44_order_id || task.base44_order_id || null,
        native_shopify_order_id: order.id || null,
        native_fulfillment_task_id: task.id,
        is_test_task: task.is_test_task === true,
        test_purpose: task.test_purpose,
        customer_name: displayCustomerName({ customerOrder, order, task }),
        fulfillment_number: task.fulfillment_number,
        source_type: task.source_type || order.source_type || order.source_channel || 'customer_app_native',
        assigned_driver: task.assigned_driver || order.assigned_driver,
        task_status: task.status || 'pending',
        delivery_status: task.delivery_status || order.fulfillment_status,
        production_status: task.production_status || order.production_status,
        fulfillment_status: order.fulfillment_status,
        fulfillment_type: order.fulfillment_type || order.fulfillment_method,
        fulfillment_method: order.fulfillment_method,
        payment_status: order.payment_status || order.financial_status,
        line_item_count: operationalLineItemCount({ task, order }),
        delivery_date: normalizeDate(task.delivery_date || task.scheduled_date),
        scheduled_date: normalizeDate(task.scheduled_date),
        assigned_delivery_date: normalizeDate(task.assigned_delivery_date),
        delivery_window_label: task.delivery_window_label || order.delivery_window_label || order.requested_time_window,
        delivery_address: task.delivery_address || order.delivery_address || customerOrder?.delivery_address,
        items_summary: operationalItemsSummary({ task, order }),
        delivered_at: task.delivered_at,
        delivery_photo_url: task.delivery_photo_url,
        delivery_drop_location: task.delivery_drop_location,
        delivery_notes: task.delivery_notes,
        missing_address: !normalizeAddressInput(task.delivery_address || order.delivery_address || customerOrder?.delivery_address),
        data_source: 'customer_app_native_task',
      });
    });
  const staleNativeTaskRows = [];
  const fromTasks = [];
  for (const stop of mappedTaskStops) {
    if (shouldSuppressStaleNativeDeliveryTask(stop, deliveryDate, testTaskMode)) {
      staleNativeTaskRows.push(sanitizeStop({
        ...stop,
        suppression_reason: 'stale_nonterminal_native_fulfillment_task_outside_action_window',
        suppressed_from_active_summary: true,
        native_primary: true,
        warnings: [
          ...(Array.isArray(stop.warnings) ? stop.warnings : []),
          'stale_native_fulfillment_task_excluded_from_active_route',
        ],
      }));
      continue;
    }

    fromTasks.push(stop);
  }

  const allNativeTaskRows = selectedTasks
    .map(task => {
      const order = ordersById.get(task.order_id) || ordersByBase44Id.get(task.order_id) || {};
      const customerOrder = customerAppOrderFor(order, task);
      return sanitizeStop({
        task_id: task.id,
        order_number: order.shopify_order_number || order.order_number || task.order_number,
        customer_app_order_id: order.base44_order_id || task.base44_order_id || null,
        native_shopify_order_id: order.id || null,
        native_fulfillment_task_id: task.id,
        is_test_task: task.is_test_task === true,
        test_purpose: task.test_purpose,
        source_type: task.source_type || order.source_type || order.source_channel || 'customer_app_native',
        task_status: task.status || 'pending',
        delivery_status: task.delivery_status || order.fulfillment_status,
        production_status: task.production_status || order.production_status,
        fulfillment_status: order.fulfillment_status,
        fulfillment_type: order.fulfillment_type || order.fulfillment_method,
        fulfillment_method: order.fulfillment_method,
        payment_status: order.payment_status || order.financial_status,
        line_item_count: operationalLineItemCount({ task, order }),
        delivery_date: normalizeDate(task.delivery_date || task.scheduled_date || task.assigned_delivery_date),
        scheduled_date: normalizeDate(task.scheduled_date),
        assigned_delivery_date: normalizeDate(task.assigned_delivery_date),
        delivery_window_label: task.delivery_window_label || order.delivery_window_label || order.requested_time_window || customerOrder?.delivery_window_label,
        items_summary: operationalItemsSummary({ task, order }) || operationalSummaryFromText(customerOrder?.items_summary),
        delivered_at: task.delivered_at,
        delivery_photo_url: task.delivery_photo_url,
        delivery_drop_location: task.delivery_drop_location,
        delivery_notes: task.delivery_notes,
        data_source: 'customer_app_native_task',
      });
    })
    .filter(stop => stop.order_number && stop.delivery_date);

  const taskOrderNumbers = new Set(
    [...fromTasks, ...staleNativeTaskRows]
      .map(stop => normalizeLower(stop.order_number))
      .filter(Boolean),
  );
  const fromOrders = orders
    .filter(order => normalizeDate(order.assigned_delivery_date || order.selected_delivery_date || order.requested_delivery_date) === deliveryDate)
    .filter(order => normalizeLower(order.fulfillment_method) === 'delivery')
    .filter(order => !taskOrderNumbers.has(normalizeLower(order.shopify_order_number || order.order_number)))
    .map(order => {
      const customerOrder = customerAppOrderFor(order, {});
      return sanitizeStop({
        task_id: null,
        order_number: order.shopify_order_number || order.order_number,
        customer_app_order_id: order.base44_order_id || null,
        native_shopify_order_id: order.id || null,
        customer_name: displayCustomerName({ customerOrder, order }),
        fulfillment_number: 1,
        source_type: order.source_type || order.source_channel || 'customer_app_native',
        assigned_driver: order.assigned_driver,
        task_status: order.fulfillment_status || 'pending',
        delivery_status: order.fulfillment_status,
        production_status: order.production_status,
        fulfillment_status: order.fulfillment_status,
        fulfillment_type: order.fulfillment_type || order.fulfillment_method,
        fulfillment_method: order.fulfillment_method,
        payment_status: order.payment_status || order.financial_status,
        line_item_count: operationalLineItemCount({ order }),
        delivery_date: normalizeDate(order.assigned_delivery_date || order.selected_delivery_date || order.requested_delivery_date),
        scheduled_date: normalizeDate(order.selected_delivery_date || order.requested_delivery_date),
        assigned_delivery_date: normalizeDate(order.assigned_delivery_date),
        delivery_window_label: order.delivery_window_label || order.requested_time_window || customerOrder?.delivery_window_label,
        delivery_address: order.delivery_address || customerOrder?.delivery_address,
        items_summary: lineItemsSummary(order.line_items) || operationalSummaryFromText(customerOrder?.items_summary),
        delivered_at: order.delivered_at,
        delivery_photo_url: order.delivery_photo_url,
        delivery_drop_location: order.delivery_drop_location,
        delivery_notes: order.delivery_notes,
        missing_address: !normalizeAddressInput(order.delivery_address || customerOrder?.delivery_address),
        data_source: 'customer_app_native_order',
      });
    });

  const scheduledOrderNumbers = new Set([
    ...taskOrderNumbers,
    ...fromOrders.map(stop => normalizeLower(stop.order_number)).filter(Boolean),
  ]);
  const unscheduled = orders
    .filter(isNativeDeliveryOrder)
    .filter(order => !normalizeDate(order.assigned_delivery_date || order.selected_delivery_date || order.requested_delivery_date))
    .filter(order => isUnscheduledNativeDeliveryOrderInReviewWindow(order, deliveryDate))
    .filter(order => !scheduledOrderNumbers.has(normalizeLower(order.shopify_order_number || order.order_number)))
    .map(order => {
      const customerOrder = customerAppOrderFor(order, {});
      return sanitizeStop({
        task_id: null,
        order_number: order.shopify_order_number || order.order_number,
        customer_app_order_id: order.base44_order_id || null,
        native_shopify_order_id: order.id || null,
        customer_name: displayCustomerName({ customerOrder, order }),
        fulfillment_number: 1,
        source_type: order.source_type || order.source_channel || 'customer_app_native',
        assigned_driver: order.assigned_driver,
        task_status: 'date_pending',
        delivery_status: order.fulfillment_status || 'date_pending',
        production_status: order.production_status,
        fulfillment_status: order.fulfillment_status,
        fulfillment_type: order.fulfillment_type || order.fulfillment_method,
        fulfillment_method: order.fulfillment_method,
        payment_status: order.payment_status || order.financial_status,
        line_item_count: operationalLineItemCount({ order }),
        delivery_date: null,
        delivery_window_label: order.delivery_window_label || order.requested_time_window || customerOrder?.delivery_window_label,
        delivery_address: order.delivery_address || customerOrder?.delivery_address,
        items_summary: lineItemsSummary(order.line_items) || operationalSummaryFromText(customerOrder?.items_summary),
        missing_address: !normalizeAddressInput(order.delivery_address || customerOrder?.delivery_address),
        data_source: 'customer_app_native_order',
      });
    })
    .slice(0, limit);

  const allStops = [...fromTasks, ...fromOrders].slice(0, limit);
  const completed = allStops.filter(stop => ['delivered', 'completed', 'fulfilled'].includes(normalizeLower(stop.task_status || stop.delivery_status)));
  const active = allStops.filter(stop => !completed.includes(stop));

  return {
    summary: summarizeStops(active, completed, unscheduled),
    sections: {
      delivery_stops: active,
      completed,
      unscheduled_delivery_orders: unscheduled,
      suppressed_stale_delivery_tasks: staleNativeTaskRows,
    },
    native_schedule_index: allNativeTaskRows,
    source_available: allStops.length > 0 || unscheduled.length > 0 || staleNativeTaskRows.length > 0,
  };
}


async function loadDeliveryLifecycleReadModelSources(base44, testTaskMode = 'exclude') {
  const entities = base44.asServiceRole.entities;
  const [customerOrders, nativeOrders, fulfillmentTasks, reviewRows, orderSyncLogs, safeSyncParityLogs] = await Promise.all([
    entities.Order.list('-created_date', 500).catch(() => []),
    entities.ShopifyOrder.list('-created_date', 500).catch(() => []),
    entities.FulfillmentTask.list('-delivery_date', 500).catch(() => []),
    entities.OrderReviewQueue.list('-created_date', 500).catch(() => []),
    entities.OrderSyncLog.list('-created_date', 500).catch(() => []),
    entities.SafeSyncParityLog.list('-created_date', 500).catch(() => []),
  ]);

  return {
    customerOrders: testTaskMode === 'only'
      ? []
      : customerOrders.filter(order => order?.is_test_order !== true),
    nativeOrders: testTaskMode === 'only' ? [] : nativeOrders,
    fulfillmentTasks: fulfillmentTasks.filter(task => (
      testTaskMode === 'only' ? task?.is_test_task === true : task?.is_test_task !== true
    )),
    reviewRows: testTaskMode === 'only' ? [] : reviewRows,
    orderSyncLogs: testTaskMode === 'only' ? [] : orderSyncLogs,
    safeSyncParityLogs: testTaskMode === 'only' ? [] : safeSyncParityLogs,
  };
}

function orderKey(value) {
  return normalizeLower(value).replace(/^#/, '');
}

function routeDisplayMissingFields(stop) {
  const missing = [];
  if (!normalizeText(stop?.delivery_address) || stop?.missing_address === true) missing.push('delivery_address');
  if (!normalizeText(stop?.items_summary)) missing.push('items_summary');
  if (!normalizeText(stop?.delivery_window_label)) missing.push('delivery_window_label');
  return missing;
}

function fillNativeRouteDisplayFields(nativeRow, hubRow) {
  const merged = { ...nativeRow };
  for (const field of [
    'customer_name',
    'assigned_driver',
    'delivery_window_label',
    'delivery_address',
    'items_summary',
    'bag_return_required',
    'bag_return_count',
    'delivered_at',
    'delivery_photo_url',
    'delivery_drop_location',
    'delivery_notes',
  ]) {
    if ((merged[field] === null || merged[field] === undefined || merged[field] === '') && hubRow?.[field] !== undefined && hubRow?.[field] !== null && hubRow?.[field] !== '') {
      merged[field] = hubRow[field];
    }
  }
  if (normalizeText(merged.delivery_address)) merged.missing_address = false;
  if (hubRow?.proof_available === true && merged.proof_available !== true) merged.proof_available = true;
  return merged;
}

function mergeHubCompletionIntoNativeRouteRow(nativeRow, hubRow) {
  const merged = fillNativeRouteDisplayFields(nativeRow, hubRow);
  const hubCompleted = isCompletedDeliveryStatus(hubRow?.delivery_status || hubRow?.task_status || hubRow?.fulfillment_status);
  const hubProductionStatus = isStalePendingProductionStatus(hubRow?.production_status) ? null : hubRow?.production_status;
  return {
    ...merged,
    task_status: hubRow?.task_status || hubRow?.delivery_status || 'completed',
    delivery_status: hubRow?.delivery_status || hubRow?.task_status || 'delivered',
    production_status: hubProductionStatus || (hubCompleted && isStalePendingProductionStatus(merged.production_status) ? 'delivered' : merged.production_status),
    fulfillment_status: hubCompleted ? 'delivered' : (hubRow?.fulfillment_status || merged.fulfillment_status),
    delivered_at: hubRow?.delivered_at || merged.delivered_at,
    proof_available: hubRow?.proof_available === true || Boolean(hubRow?.delivery_photo_url || hubRow?.delivery_drop_location || merged.proof_available),
    delivery_photo_url: hubRow?.delivery_photo_url || merged.delivery_photo_url,
    delivery_drop_location: hubRow?.delivery_drop_location || merged.delivery_drop_location,
    delivery_notes: hubRow?.delivery_notes || merged.delivery_notes,
  };
}

function nativeFallbackContext({ nativeRow, hubRow, section, mergeStatus, fallbackReason, missingFields = [] }) {
  const hubDate = normalizeDate(hubRow?.delivery_date);
  const nativeDate = normalizeDate(nativeRow?.delivery_date);
  return {
    order_number: nativeRow?.order_number || hubRow?.order_number || null,
    section,
    hub_delivery_date: hubDate || null,
    native_delivery_date: nativeDate || null,
    native_task_id: nativeRow?.task_id || null,
    hub_task_id: hubRow?.task_id || null,
    merge_status: mergeStatus,
    fallback_reason: fallbackReason,
    missing_native_fields: missingFields,
  };
}

function decorateNativeRouteRow(row, metadata = {}) {
  return sanitizeStop({
    ...row,
    data_source: metadata.data_source || row?.data_source || 'customer_app_native_task',
    fallback_source: metadata.fallback_source || null,
    fallback_reason: metadata.fallback_reason || null,
    stale_hub_fallback_suppressed: metadata.stale_hub_fallback_suppressed === true,
    native_primary: metadata.native_primary !== false,
    hub_fallback_used: metadata.hub_fallback_used === true,
    hub_fallback_context: metadata.hub_fallback_context || row?.hub_fallback_context || null,
    warnings: Array.isArray(metadata.warnings) ? metadata.warnings : [],
  });
}

function decorateHubFallbackRow(row, metadata = {}) {
  return sanitizeStop({
    ...row,
    hub_task_id: row?.hub_task_id || row?.task_id || null,
    data_source: 'hub_fallback',
    fallback_source: 'hub_delivery_route_summary',
    fallback_reason: metadata.fallback_reason || 'native_route_row_missing',
    native_primary: false,
    hub_fallback_used: true,
    hub_fallback_context: metadata.hub_fallback_context || row?.hub_fallback_context || null,
    warnings: Array.isArray(metadata.warnings) ? metadata.warnings : [],
  });
}

function nativeFirstMergeSection({ nativeRows, hubRows, nativeScheduleIndex, section, limit }) {
  const visibleRows = [];
  const suppressed = [];
  const fallbackReasons = [];
  const matchedHubKeys = new Set();
  const nativeByOrder = new Map(
    (nativeRows || [])
      .filter(row => row.order_number)
      .map(row => [orderKey(row.order_number), row]),
  );
  const nativeScheduleByOrder = new Map(
    (nativeScheduleIndex || [])
      .filter(row => row.order_number)
      .map(row => [orderKey(row.order_number), row]),
  );
  const hubByOrder = new Map();
  for (const hubRow of hubRows || []) {
    const key = orderKey(hubRow.order_number);
    if (key && !hubByOrder.has(key)) hubByOrder.set(key, hubRow);
  }

  for (const nativeRow of nativeRows || []) {
    const key = orderKey(nativeRow.order_number);
    const hubRow = hubByOrder.get(key);
    const nativeDate = normalizeDate(nativeRow.delivery_date);
    const hubDate = normalizeDate(hubRow?.delivery_date);
    const missingFields = routeDisplayMissingFields(nativeRow);
    const hubCompleted = section === 'completed' && isCompletedDeliveryStatus(hubRow?.delivery_status || hubRow?.task_status || hubRow?.fulfillment_status);
    if (hubRow) matchedHubKeys.add(key);

    if (hubRow && nativeDate && hubDate && nativeDate !== hubDate) {
      const context = nativeFallbackContext({
        nativeRow,
        hubRow,
        section,
        mergeStatus: 'native_schedule_active_hub_fallback_stale_date',
        fallbackReason: 'native_corrected_date_suppresses_stale_hub_row',
      });
      suppressed.push({ ...context, suppressed_from_active_summary: true });
      visibleRows.push(decorateNativeRouteRow(nativeRow, {
        stale_hub_fallback_suppressed: true,
        hub_fallback_context: context,
        warnings: ['hub_fallback_stale_date_detected'],
      }));
      continue;
    }

    if (hubRow && hubCompleted) {
      const fallbackReason = 'hub_completed_state_preferred_for_native_duplicate';
      const context = nativeFallbackContext({
        nativeRow,
        hubRow,
        section,
        mergeStatus: fallbackReason,
        fallbackReason,
        missingFields,
      });
      suppressed.push({ ...context, suppressed_from_active_summary: true });
      visibleRows.push(decorateNativeRouteRow(mergeHubCompletionIntoNativeRouteRow(nativeRow, hubRow), {
        data_source: 'native_with_hub_completed_context',
        fallback_source: 'hub_delivery_route_summary',
        fallback_reason: fallbackReason,
        hub_fallback_used: true,
        hub_fallback_context: context,
        warnings: ['hub_completed_state_used_for_native_duplicate'],
      }));
      continue;
    }

    if (hubRow && missingFields.length > 0) {
      const fallbackReason = 'native_row_incomplete_for_route_display';
      fallbackReasons.push(fallbackReason);
      const context = nativeFallbackContext({
        nativeRow,
        hubRow,
        section,
        mergeStatus: 'native_primary_with_hub_fallback_context',
        fallbackReason,
        missingFields,
      });
      suppressed.push({ ...context, suppressed_from_active_summary: true });
      visibleRows.push(decorateNativeRouteRow(fillNativeRouteDisplayFields(nativeRow, hubRow), {
        data_source: 'native_with_hub_fallback_context',
        fallback_source: 'hub_delivery_route_summary',
        fallback_reason: fallbackReason,
        hub_fallback_used: true,
        hub_fallback_context: context,
        warnings: ['native_row_incomplete_hub_fallback_context_used'],
      }));
      continue;
    }

    if (hubRow) {
      const fallbackReason = 'duplicate_native_hub_row_deduped';
      const context = nativeFallbackContext({
        nativeRow,
        hubRow,
        section,
        mergeStatus: 'native_schedule_preferred_hub_duplicate',
        fallbackReason,
      });
      suppressed.push({ ...context, suppressed_from_active_summary: true });
      visibleRows.push(decorateNativeRouteRow(nativeRow, {
        hub_fallback_context: context,
      }));
      continue;
    }

    visibleRows.push(decorateNativeRouteRow(nativeRow));
  }

  for (const hubRow of hubRows || []) {
    const key = orderKey(hubRow.order_number);
    if (!key || matchedHubKeys.has(key) || nativeByOrder.has(key)) continue;
    const nativeScheduleRow = nativeScheduleByOrder.get(key);
    const hubDate = normalizeDate(hubRow.delivery_date);
    const nativeDate = normalizeDate(nativeScheduleRow?.delivery_date);
    if (nativeScheduleRow && nativeDate && hubDate && nativeDate !== hubDate) {
      suppressed.push({
        ...nativeFallbackContext({
          nativeRow: nativeScheduleRow,
          hubRow,
          section,
          mergeStatus: 'native_schedule_active_hub_fallback_stale_date',
          fallbackReason: 'native_corrected_date_suppresses_stale_hub_row',
        }),
        suppressed_from_active_summary: true,
      });
      continue;
    }

    const fallbackReason = nativeScheduleRow
      ? 'duplicate_native_hub_row_deduped'
      : 'native_route_row_missing';
    if (fallbackReason === 'native_route_row_missing') fallbackReasons.push(fallbackReason);
    const context = nativeFallbackContext({
      nativeRow: nativeScheduleRow,
      hubRow,
      section,
      mergeStatus: nativeScheduleRow && section === 'completed'
        ? 'hub_completed_state_preferred_for_native_duplicate'
        : nativeScheduleRow ? 'native_schedule_preferred_hub_duplicate' : 'hub_only_fallback_visible',
      fallbackReason,
    });
    if (nativeScheduleRow) {
      if (section === 'completed') {
        const completionFallbackReason = 'hub_completed_state_preferred_for_native_duplicate';
        const completionContext = {
          ...context,
          merge_status: completionFallbackReason,
          fallback_reason: completionFallbackReason,
        };
        suppressed.push({ ...completionContext, suppressed_from_active_summary: true });
        visibleRows.push(decorateNativeRouteRow(mergeHubCompletionIntoNativeRouteRow(nativeScheduleRow, hubRow), {
          data_source: 'native_with_hub_completed_context',
          fallback_source: 'hub_delivery_route_summary',
          fallback_reason: completionFallbackReason,
          hub_fallback_used: true,
          hub_fallback_context: completionContext,
          warnings: ['hub_completed_state_used_for_native_duplicate'],
        }));
        continue;
      }
      suppressed.push({ ...context, suppressed_from_active_summary: true });
      continue;
    }
    visibleRows.push(decorateHubFallbackRow(hubRow, {
      fallback_reason: fallbackReason,
      hub_fallback_context: context,
    }));
  }

  return {
    rows: visibleRows.slice(0, limit),
    suppressed,
    fallback_reasons: [...new Set(fallbackReasons)],
  };
}

function reconcileHubRowsWithNativeSchedule({ hubRows, nativeScheduleIndex, section, limit = MAX_LIMIT }) {
  return nativeFirstMergeSection({
    nativeRows: [],
    hubRows,
    nativeScheduleIndex,
    section,
    limit,
  });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await readJsonBody(req);
    if (body === null) {
      return Response.json({ success: false, error: 'malformed_json' }, { status: 400 });
    }
    const deliveryLifecycleReadModelRequested = isDeliveryLifecycleReadModelRequest(body);
    const deliveryLifecycleReadModelActive = deliveryLifecycleReadModelEnabled();
    let deliveryDate;
    let limit;
    let testTaskMode;

    try {
      deliveryDate = parseIsoDate(body.delivery_date || body.date, 'delivery_date') || todayChicagoDate();
      limit = normalizeLimit(body.limit);
      testTaskMode = normalizeTestTaskMode(body.test_task_mode);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const nativeData = await loadNativeDeliveryStops(base44, deliveryDate, limit, testTaskMode);

    let hubData = null;
    let hubWarning = null;
    if (testTaskMode === 'only') {
      hubWarning = null;
    } else if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      hubWarning = 'hub_delivery_queue_service_not_configured';
    } else {
      const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
      const params = new URLSearchParams({
        delivery_date: deliveryDate,
        limit: limit.toString(),
      });

      const hubResult = await fetchHubJson(
        `${hubBase}/functions/getDeliveryRouteSummaryForCustomerApp?${params.toString()}`,
        { Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}` },
      );

      if (!hubResult.ok) {
        hubWarning = hubResult.warning;
      } else {
        const parsedHubData = hubResult.data;
        if (
          !parsedHubData ||
          parsedHubData.success !== true ||
          !parsedHubData.sections ||
          !Array.isArray(parsedHubData.sections.delivery_stops) ||
          !Array.isArray(parsedHubData.sections.completed)
        ) {
          hubWarning = 'hub_delivery_queue_malformed_response';
        } else {
          hubData = parsedHubData;
        }
      }
    }

    const hubActiveRaw = hubData ? hubData.sections.delivery_stops.map(stop => sanitizeStop({ ...stop, data_source: 'hub' })) : [];
    const hubCompletedRaw = hubData ? hubData.sections.completed.map(stop => sanitizeStop({ ...stop, data_source: 'hub' })) : [];
    const activeReconciliation = nativeFirstMergeSection({
      nativeRows: nativeData.sections.delivery_stops,
      hubRows: hubActiveRaw,
      nativeScheduleIndex: nativeData.native_schedule_index,
      section: 'delivery_stops',
      limit,
    });
    const completedReconciliation = nativeFirstMergeSection({
      nativeRows: nativeData.sections.completed,
      hubRows: hubCompletedRaw,
      nativeScheduleIndex: nativeData.native_schedule_index,
      section: 'completed',
      limit,
    });
    const suppressedHubRows = [...activeReconciliation.suppressed, ...completedReconciliation.suppressed];
    const suppressedNativeStaleRows = (nativeData.sections.suppressed_stale_delivery_tasks || []).slice(0, limit);
    const completedOrderKeys = new Set(
      completedReconciliation.rows
        .map(stop => orderKey(stop.order_number))
        .filter(Boolean),
    );
    const visibleOrderNumbers = new Set([
      ...activeReconciliation.rows,
      ...completedReconciliation.rows,
    ].map(stop => normalizeLower(stop.order_number)).filter(Boolean));
    const unscheduledStops = (nativeData.sections.unscheduled_delivery_orders || [])
      .filter(stop => !visibleOrderNumbers.has(normalizeLower(stop.order_number)))
      .map(stop => decorateNativeRouteRow(stop))
      .slice(0, limit);
    const deliveryStops = activeReconciliation.rows
      .filter(stop => !completedOrderKeys.has(orderKey(stop.order_number)))
      .slice(0, limit);
    const completedStops = completedReconciliation.rows.slice(0, limit);
    const fallbackReasons = [...new Set([
      ...activeReconciliation.fallback_reasons,
      ...completedReconciliation.fallback_reasons,
      hubWarning ? 'hub_delivery_summary_unavailable_or_unconfigured' : null,
    ].filter(Boolean))];
    const allVisibleRows = [...deliveryStops, ...completedStops, ...unscheduledStops];
    const hubFallbackRowCount = allVisibleRows.filter(stop => stop?.hub_fallback_used === true || stop?.data_source === 'hub_fallback').length;
    const nativeRowCount = allVisibleRows.filter(stop => stop?.native_primary === true || (stop?.data_source || '').startsWith('customer_app_native') || stop?.data_source === 'native_with_hub_fallback_context').length;
    const staleHubFallbackDetected = suppressedHubRows.some(row => row.merge_status === 'native_schedule_active_hub_fallback_stale_date');
    const deliveryLifecycleReadModelRows = allVisibleRows;
    let deliveryLifecycleReadModel = null;
    const deliveryLifecycleReadModelCanBuild = deliveryLifecycleReadModelRequested && deliveryLifecycleReadModelActive && typeof buildDeliveryLifecycleReadModel === 'function';
    if (deliveryLifecycleReadModelCanBuild) {
      const readModelSources = await loadDeliveryLifecycleReadModelSources(base44, testTaskMode);
      deliveryLifecycleReadModel = buildDeliveryLifecycleReadModel({
        deliveryDate: hubData?.delivery_date || deliveryDate,
        routeSummaryRows: deliveryLifecycleReadModelRows,
        ...readModelSources,
        sourceMode: testTaskMode === 'only'
          ? 'native_internal_test_only'
          : hubData ? 'native_first_with_hub_fallback' : 'native_only',
      });
    }

    if (!hubData && !nativeData.source_available) {
      return Response.json({
        error: 'Unable to load delivery queue summary',
        warning: hubWarning,
      }, { status: 503 });
    }

    return Response.json({
      success: true,
      delivery_date: hubData?.delivery_date || deliveryDate,
      test_task_mode: testTaskMode,
      operational_totals_exclude_test_tasks: true,
      summary: summarizeStops(deliveryStops, completedStops, unscheduledStops),
      sections: {
        delivery_stops: deliveryStops,
        completed: completedStops,
        unscheduled_delivery_orders: unscheduledStops,
        suppressed_stale_delivery_tasks: suppressedNativeStaleRows,
      },
      native_row_count: nativeRowCount,
      hub_fallback_row_count: hubFallbackRowCount,
      suppressed_hub_row_count: suppressedHubRows.length,
      fallback_required: hubFallbackRowCount > 0 || fallbackReasons.length > 0,
      fallback_reasons: fallbackReasons,
      stale_hub_fallback_detected: staleHubFallbackDetected,
      stale_native_delivery_task_detected: suppressedNativeStaleRows.length > 0,
      suppressed_native_stale_task_count: suppressedNativeStaleRows.length,
      native_first_enabled: true,
      delivery_lifecycle_read_model_available: true,
      delivery_lifecycle_read_model_enabled: Boolean(deliveryLifecycleReadModelActive && deliveryLifecycleReadModelRequested),
      delivery_lifecycle_read_model_version: DELIVERY_LIFECYCLE_READ_MODEL_VERSION,
      ...(deliveryLifecycleReadModel ? { delivery_lifecycle_read_model: deliveryLifecycleReadModel } : {}),
      driver_assignment_write_ready: false,
      route_mutation_ready: false,
      out_for_delivery_write_ready: false,
      delivered_write_ready: false,
      shopify_fulfillment_write_ready: false,
      notification_expansion_ready: false,
      customer_status_write_ready: false,
      hub_write_suppression_ready: false,
      writes_performed: false,
      provider_call_impact: false,
      notifications_sent: false,
      hub_mutation_performed: false,
      data_sources: {
        hub_available: Boolean(hubData),
        native_available: nativeData.source_available,
        native_read_only: true,
        native_first_enabled: true,
        hub_fallback_available: Boolean(hubData),
        hub_fallback_row_count: hubFallbackRowCount,
        stale_native_delivery_task_suppression_ready: true,
      },
      hub_fallback_reconciliation: {
        merge_status: suppressedHubRows.length > 0
          ? 'native_first_hub_fallback_rows_suppressed_or_contextualized'
          : 'native_first_no_hub_fallback_rows_suppressed',
        stale_hub_fallback_detected: staleHubFallbackDetected,
        suppressed_hub_row_count: suppressedHubRows.length,
        suppressed_hub_rows: suppressedHubRows.slice(0, 20),
        native_schedule_preferred: suppressedHubRows.length > 0,
        native_first_enabled: true,
        hub_fallback_row_count: hubFallbackRowCount,
        fallback_reasons: fallbackReasons,
      },
      native_task_reconciliation: {
        stale_nonterminal_tasks_suppressed: suppressedNativeStaleRows.length,
        suppression_reason: suppressedNativeStaleRows.length > 0
          ? 'stale_nonterminal_native_fulfillment_task_outside_action_window'
          : null,
        suppressed_rows: suppressedNativeStaleRows.slice(0, 20),
        action_window_days: NATIVE_DELIVERY_TASK_ACTION_WINDOW_DAYS,
      },
      warnings: [
        hubWarning,
        staleHubFallbackDetected ? 'hub_fallback_stale_date_detected' : null,
        suppressedHubRows.length > 0 ? 'native_first_hub_fallback_rows_suppressed_or_contextualized' : null,
        suppressedNativeStaleRows.length > 0 ? 'stale_native_fulfillment_task_excluded_from_active_route' : null,
      ].filter(Boolean),
    });
  } catch (error) {
    console.error('[getAdminDeliveryRouteSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load delivery queue summary' }, { status: 500 });
  }
});
