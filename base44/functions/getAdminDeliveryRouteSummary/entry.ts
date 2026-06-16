import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const CHICAGO_TZ = 'America/Chicago';
const MAX_LIMIT = 100;
const MAY30_NATIVE_ORDER_START_DATE = '2026-05-28';

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

function normalizeDate(value) {
  const text = normalizeText(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function lineItemsSummary(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items
    .slice(0, 8)
    .map(item => {
      const title = normalizeText(item?.title || item?.name || item?.product_name);
      const quantity = Number(item?.quantity) || 1;
      return title ? `${quantity}x ${title}` : null;
    })
    .filter(Boolean)
    .join(', ');
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

function sanitizeAddress(value) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');

  if (!text) return null;
  return text.length > 240 ? `${text.slice(0, 239).trim()}...` : text;
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

function sanitizeStringArray(values, maxItems = 8) {
  if (!Array.isArray(values)) return [];
  return values.map(value => sanitizeAssignedDriver(value)).filter(Boolean).slice(0, maxItems);
}

function sanitizeStop(stop) {
  return {
    task_id: stop.task_id || null,
    order_number: stop.order_number || null,
    customer_app_order_id: stop.customer_app_order_id || null,
    native_shopify_order_id: stop.native_shopify_order_id || null,
    native_fulfillment_task_id: stop.native_fulfillment_task_id || null,
    hub_task_id: stop.hub_task_id || null,
    customer_name: sanitizeCustomerName(stop.customer_name),
    fulfillment_number: stop.fulfillment_number ?? null,
    source_type: stop.source_type || null,
    assigned_driver: sanitizeAssignedDriver(stop.assigned_driver),
    task_status: stop.task_status || null,
    delivery_status: stop.delivery_status || null,
    production_status: stop.production_status || null,
    fulfillment_status: stop.fulfillment_status || null,
    fulfillment_type: stop.fulfillment_type || null,
    fulfillment_method: stop.fulfillment_method || null,
    payment_status: stop.payment_status || null,
    line_item_count: stop.line_item_count ?? null,
    delivery_date: stop.delivery_date || null,
    scheduled_date: stop.scheduled_date || null,
    assigned_delivery_date: stop.assigned_delivery_date || null,
    delivery_window_label: stop.delivery_window_label || null,
    delivery_address: sanitizeAddress(stop.delivery_address),
    items_summary: stop.items_summary || null,
    delivered_at: stop.delivered_at || null,
    proof_available: stop.proof_available === true,
    delivery_photo_url: stop.delivery_photo_url || null,
    delivery_drop_location: stop.delivery_drop_location || null,
    missing_address: stop.missing_address === true,
    bag_return_required: stop.bag_return_required ?? null,
    bag_return_count: stop.bag_return_count ?? null,
    data_source: stop.data_source || null,
    fallback_source: stop.fallback_source || null,
    fallback_reason: stop.fallback_reason || null,
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

function safeLineItems(order) {
  return Array.isArray(order?.line_items) ? order.line_items.slice(0, 60) : [];
}

function hasNativeLaunchMarker(order) {
  const tags = Array.isArray(order?.tags) ? order.tags.map(normalizeLower) : [];
  const sourceType = normalizeLower(order?.source_type);
  const sourceChannel = normalizeLower(order?.source_channel);
  const syncStatus = normalizeLower(order?.sync_status);
  const referenceDate = orderReferenceDate(order);
  const isRecentLaunchOrder = Boolean(referenceDate && referenceDate >= MAY30_NATIVE_ORDER_START_DATE);

  return (
    tags.includes('may30_native_ops') ||
    syncStatus === 'native_may30_ready' ||
    ['customer_app_one_time', 'website_one_time'].includes(sourceType) ||
    ((sourceChannel === 'online' || sourceChannel === 'customer_app' || sourceChannel === 'website') && isRecentLaunchOrder)
  );
}

function isNativeMay30DeliveryOrder(order) {
  const paymentStatus = normalizeLower(order?.payment_status || order?.financial_status);
  const orderType = normalizeLower(order?.order_type);
  const sourceChannel = normalizeLower(order?.source_channel);
  const fulfillmentMethod = normalizeLower(order?.fulfillment_method);
  const productionStatus = normalizeLower(order?.production_status);

  if (!hasNativeLaunchMarker(order)) return false;
  if (order?.excluded_from_production === true) return false;
  if (['canceled', 'cancelled', 'refunded'].includes(productionStatus)) return false;
  if (['refunded', 'partially_refunded'].includes(paymentStatus)) return false;
  if (paymentStatus && paymentStatus !== 'paid') return false;
  if (orderType === 'pos' || sourceChannel === 'pos' || fulfillmentMethod === 'pos') return false;
  if (orderType === 'subscription' || sourceChannel === 'subscription' || order?.stripe_subscription_id) return false;
  if (fulfillmentMethod && fulfillmentMethod !== 'delivery') return false;
  return safeLineItems(order).length > 0;
}

async function loadNativeDeliveryStops(base44, deliveryDate, limit) {
  const [tasks, orders] = await Promise.all([
    base44.asServiceRole.entities.FulfillmentTask.list('-delivery_date', 500).catch(() => []),
    base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500).catch(() => []),
  ]);
  const ordersById = new Map();
  const ordersByBase44Id = new Map();
  for (const order of orders) {
    if (order.id) ordersById.set(order.id, order);
    if (order.base44_order_id) ordersByBase44Id.set(order.base44_order_id, order);
  }

  const fromTasks = tasks
    .filter(task => normalizeDate(task.delivery_date || task.scheduled_date) === deliveryDate)
    .map(task => {
      const order = ordersById.get(task.order_id) || ordersByBase44Id.get(task.order_id) || {};
      return sanitizeStop({
        task_id: task.id,
        order_number: order.shopify_order_number || order.order_number || task.order_number,
        customer_app_order_id: order.base44_order_id || task.base44_order_id || null,
        native_shopify_order_id: order.id || null,
        native_fulfillment_task_id: task.id,
        customer_name: order.customer_name || task.customer_name,
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
        line_item_count: safeLineItems(order).length || (Array.isArray(task.items) ? task.items.length : null),
        delivery_date: normalizeDate(task.delivery_date || task.scheduled_date),
        scheduled_date: normalizeDate(task.scheduled_date),
        assigned_delivery_date: normalizeDate(task.assigned_delivery_date),
        delivery_window_label: task.delivery_window_label || order.delivery_window_label || order.requested_time_window,
        delivery_address: task.delivery_address || order.delivery_address,
        items_summary: task.items_summary || lineItemsSummary(task.items || order.line_items),
        delivered_at: task.delivered_at,
        delivery_photo_url: task.delivery_photo_url,
        delivery_drop_location: task.delivery_drop_location,
        missing_address: !normalizeText(task.delivery_address || order.delivery_address),
        data_source: 'customer_app_native_task',
      });
    });

  const allNativeTaskRows = tasks
    .map(task => {
      const order = ordersById.get(task.order_id) || ordersByBase44Id.get(task.order_id) || {};
      return sanitizeStop({
        task_id: task.id,
        order_number: order.shopify_order_number || order.order_number || task.order_number,
        customer_app_order_id: order.base44_order_id || task.base44_order_id || null,
        native_shopify_order_id: order.id || null,
        native_fulfillment_task_id: task.id,
        source_type: task.source_type || order.source_type || order.source_channel || 'customer_app_native',
        task_status: task.status || 'pending',
        delivery_status: task.delivery_status || order.fulfillment_status,
        production_status: task.production_status || order.production_status,
        fulfillment_status: order.fulfillment_status,
        fulfillment_type: order.fulfillment_type || order.fulfillment_method,
        fulfillment_method: order.fulfillment_method,
        payment_status: order.payment_status || order.financial_status,
        line_item_count: safeLineItems(order).length || (Array.isArray(task.items) ? task.items.length : null),
        delivery_date: normalizeDate(task.delivery_date || task.scheduled_date || task.assigned_delivery_date),
        scheduled_date: normalizeDate(task.scheduled_date),
        assigned_delivery_date: normalizeDate(task.assigned_delivery_date),
        delivery_window_label: task.delivery_window_label || order.delivery_window_label || order.requested_time_window,
        data_source: 'customer_app_native_task',
      });
    })
    .filter(stop => stop.order_number && stop.delivery_date);

  const taskOrderNumbers = new Set(fromTasks.map(stop => normalizeLower(stop.order_number)).filter(Boolean));
  const fromOrders = orders
    .filter(order => normalizeDate(order.assigned_delivery_date || order.selected_delivery_date || order.requested_delivery_date) === deliveryDate)
    .filter(order => normalizeLower(order.fulfillment_method) === 'delivery')
    .filter(order => !taskOrderNumbers.has(normalizeLower(order.shopify_order_number || order.order_number)))
    .map(order => sanitizeStop({
      task_id: null,
      order_number: order.shopify_order_number || order.order_number,
      customer_app_order_id: order.base44_order_id || null,
      native_shopify_order_id: order.id || null,
      customer_name: order.customer_name,
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
      line_item_count: safeLineItems(order).length,
      delivery_date: normalizeDate(order.assigned_delivery_date || order.selected_delivery_date || order.requested_delivery_date),
      scheduled_date: normalizeDate(order.selected_delivery_date || order.requested_delivery_date),
      assigned_delivery_date: normalizeDate(order.assigned_delivery_date),
      delivery_window_label: order.delivery_window_label || order.requested_time_window,
      delivery_address: order.delivery_address,
      items_summary: lineItemsSummary(order.line_items),
      missing_address: !normalizeText(order.delivery_address),
      data_source: 'customer_app_native_order',
    }));

  const scheduledOrderNumbers = new Set([
    ...taskOrderNumbers,
    ...fromOrders.map(stop => normalizeLower(stop.order_number)).filter(Boolean),
  ]);
  const unscheduled = orders
    .filter(isNativeMay30DeliveryOrder)
    .filter(order => !normalizeDate(order.assigned_delivery_date || order.selected_delivery_date || order.requested_delivery_date))
    .filter(order => !scheduledOrderNumbers.has(normalizeLower(order.shopify_order_number || order.order_number)))
    .map(order => sanitizeStop({
      task_id: null,
      order_number: order.shopify_order_number || order.order_number,
      customer_app_order_id: order.base44_order_id || null,
      native_shopify_order_id: order.id || null,
      customer_name: order.customer_name,
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
      line_item_count: safeLineItems(order).length,
      delivery_date: null,
      delivery_window_label: order.delivery_window_label || order.requested_time_window,
      delivery_address: order.delivery_address,
      items_summary: lineItemsSummary(order.line_items),
      missing_address: !normalizeText(order.delivery_address),
      data_source: 'customer_app_native_order',
    }))
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
    },
    native_schedule_index: allNativeTaskRows,
    source_available: allStops.length > 0 || unscheduled.length > 0,
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
  ]) {
    if ((merged[field] === null || merged[field] === undefined || merged[field] === '') && hubRow?.[field] !== undefined && hubRow?.[field] !== null && hubRow?.[field] !== '') {
      merged[field] = hubRow[field];
    }
  }
  if (normalizeText(merged.delivery_address)) merged.missing_address = false;
  if (hubRow?.proof_available === true && merged.proof_available !== true) merged.proof_available = true;
  return merged;
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
      mergeStatus: nativeScheduleRow ? 'native_schedule_preferred_hub_duplicate' : 'hub_only_fallback_visible',
      fallbackReason,
    });
    if (nativeScheduleRow) {
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
    let deliveryDate;
    let limit;

    try {
      deliveryDate = parseIsoDate(body.delivery_date || body.date, 'delivery_date') || todayChicagoDate();
      limit = normalizeLimit(body.limit);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const nativeData = await loadNativeDeliveryStops(base44, deliveryDate, limit);

    let hubData = null;
    let hubWarning = null;
    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
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
    const visibleOrderNumbers = new Set([
      ...activeReconciliation.rows,
      ...completedReconciliation.rows,
    ].map(stop => normalizeLower(stop.order_number)).filter(Boolean));
    const unscheduledStops = (nativeData.sections.unscheduled_delivery_orders || [])
      .filter(stop => !visibleOrderNumbers.has(normalizeLower(stop.order_number)))
      .map(stop => decorateNativeRouteRow(stop))
      .slice(0, limit);
    const deliveryStops = activeReconciliation.rows.slice(0, limit);
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

    if (!hubData && !nativeData.source_available) {
      return Response.json({
        error: 'Unable to load delivery queue summary',
        warning: hubWarning,
      }, { status: 503 });
    }

    return Response.json({
      success: true,
      delivery_date: hubData?.delivery_date || deliveryDate,
      summary: summarizeStops(deliveryStops, completedStops, unscheduledStops),
      sections: {
        delivery_stops: deliveryStops,
        completed: completedStops,
        unscheduled_delivery_orders: unscheduledStops,
      },
      native_row_count: nativeRowCount,
      hub_fallback_row_count: hubFallbackRowCount,
      suppressed_hub_row_count: suppressedHubRows.length,
      fallback_required: hubFallbackRowCount > 0 || fallbackReasons.length > 0,
      fallback_reasons: fallbackReasons,
      stale_hub_fallback_detected: staleHubFallbackDetected,
      native_first_enabled: true,
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
      warnings: [
        hubWarning,
        staleHubFallbackDetected ? 'hub_fallback_stale_date_detected' : null,
        suppressedHubRows.length > 0 ? 'native_first_hub_fallback_rows_suppressed_or_contextualized' : null,
      ].filter(Boolean),
    });
  } catch (error) {
    console.error('[getAdminDeliveryRouteSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load delivery queue summary' }, { status: 500 });
  }
});
