// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * getCustomerAccountDashboardData
 *
 * Single authoritative backend function for all customer-facing Account data.
 * Uses service role to resolve all identity aliases (Apple relay, linked emails)
 * before querying Subscriptions, Orders, Credits, Points, and Notifications.
 *
 * This is the ONLY function pages should call for Account dashboard data.
 * Never query these entities directly from the frontend using only user.email.
 *
 * Returns:
 *   resolved_identity_emails, primary_customer_email, display_email,
 *   customer_profile, active_subscriptions, all_subscriptions,
 *   subscription_count, current_ritual, orders, order_count,
 *   credits, loyalty_points, notifications_unread_count
 */


const CUSTOMER_ORDER_HISTORY_NATIVE_FIRST_ENABLE = 'ENABLE_CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST';
const CUSTOMER_ORDER_HISTORY_NATIVE_FIRST_KILL_SWITCH = 'CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_KILL_SWITCH';
const CUSTOMER_ORDER_HISTORY_NATIVE_FIRST_ALLOWLIST = 'CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST';
const CUSTOMER_ORDER_HISTORY_SOURCE_MERGE_KILL_SWITCH = 'CUSTOMER_ORDER_HISTORY_SOURCE_MERGE_KILL_SWITCH';

const CUSTOMER_REWARDS_NATIVE_FIRST_READS_ENABLE = 'ENABLE_CUSTOMER_REWARDS_LIMITED_NATIVE_FIRST_READS';
const CUSTOMER_REWARDS_NATIVE_FIRST_READS_KILL_SWITCH = 'CUSTOMER_REWARDS_LIMITED_NATIVE_FIRST_KILL_SWITCH';
const CUSTOMER_REWARDS_NATIVE_FIRST_READS_USER_POINTS_ALLOWLIST = 'CUSTOMER_REWARDS_LIMITED_NATIVE_FIRST_USER_POINTS_ALLOWLIST';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeEmail(value) {
  return normalizeLower(value);
}

function normalizePhone(value) {
  const digits = normalizeText(value).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits.length === 10 ? digits : '';
}

function phoneQueryVariants(value) {
  const raw = normalizeText(value);
  const digits = normalizePhone(raw);
  if (!digits) return raw ? [raw] : [];
  const area = digits.slice(0, 3);
  const prefix = digits.slice(3, 6);
  const line = digits.slice(6);
  return Array.from(new Set([
    raw,
    digits,
    `1${digits}`,
    `+1${digits}`,
    `${area}-${prefix}-${line}`,
    `(${area}) ${prefix}-${line}`,
    `${area} ${prefix} ${line}`,
  ].filter(Boolean)));
}

function normalizeOrderNumber(value) {
  return normalizeText(value).replace(/^#/, '').toUpperCase();
}

function envEnabled(name) {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(normalizeLower(Deno.env.get(name)));
}

function parseCsvSet(value) {
  return new Set(normalizeText(value).split(',').map(part => normalizeOrderNumber(part)).filter(Boolean));
}

function parseIdentifierCsvSet(value) {
  return new Set(normalizeText(value).split(',').map(part => normalizeText(part)).filter(Boolean));
}

function uniqueRows(rows) {
  const seen = new Set();
  const unique = [];
  for (const row of rows || []) {
    const key = row?.id || JSON.stringify(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

function isOpenReviewRow(row) {
  const status = normalizeLower(row?.status || row?.queue_visibility_status);
  return row && !['resolved', 'archived', 'rejected'].includes(status);
}

function rowTextIncludes(row, tokens) {
  const text = [
    row?.sync_source,
    row?.triggered_by,
    row?.reason,
    row?.description,
    row?.action,
    row?.hub_action,
    row?.native_parity_status,
    row?.bridge_action,
    row?.source,
  ].map(normalizeLower).join(' ');
  return tokens.some(token => text.includes(token));
}

function looksSubscriptionOrMultiDelivery(order, nativeOrder, task) {
  const values = [
    order?.order_type,
    order?.source_type,
    order?.fulfillment_mode,
    nativeOrder?.order_type,
    nativeOrder?.source_type,
    nativeOrder?.source_channel,
    nativeOrder?.fulfillment_mode,
    task?.order_type,
    task?.source_type,
    task?.fulfillment_type,
  ].map(normalizeLower);
  return Boolean(
    order?.is_subscription ||
    nativeOrder?.is_subscription ||
    values.some(value => value.includes('subscription') || value.includes('multi_delivery') || value.includes('multi-delivery'))
  );
}

function looksRefunded(order, nativeOrder) {
  return [
    order?.status,
    order?.payment_status,
    order?.financial_status,
    order?.refund_status,
    nativeOrder?.payment_status,
    nativeOrder?.financial_status,
    nativeOrder?.refund_status,
    nativeOrder?.production_status,
  ].some(value => normalizeLower(value).includes('refund')) || Boolean(order?.refunded_at || nativeOrder?.refunded_at);
}

function looksHistoricalLateMirror(order, nativeOrder, task) {
  const text = [
    order?.notes,
    order?.source_type,
    order?.sync_status,
    nativeOrder?.source_type,
    nativeOrder?.sync_status,
    nativeOrder?.repair_status,
    task?.source_type,
    task?.task_source,
    task?.sync_status,
  ].map(normalizeLower).join(' ');
  return ['historical', 'late_mirror', 'late-mirror', 'backfill'].some(token => text.includes(token));
}

function looksCancelled(order, nativeOrder, task) {
  return [
    order?.status,
    order?.payment_status,
    order?.financial_status,
    nativeOrder?.production_status,
    nativeOrder?.order_status,
    nativeOrder?.payment_status,
    task?.status,
    task?.delivery_status,
  ].some(value => ['cancelled', 'canceled', 'failed', 'voided'].includes(normalizeLower(value)));
}

function hasPaidCaptured(order) {
  return Boolean(
    order?.payment_captured === true &&
    ['paid', ''].includes(normalizeLower(order?.payment_status || 'paid')) &&
    ['paid', ''].includes(normalizeLower(order?.financial_status || 'paid'))
  );
}

function nativePaymentIsPaid(nativeOrder, task) {
  const paymentValues = [nativeOrder?.payment_status, nativeOrder?.financial_status, task?.payment_status].map(normalizeLower).filter(Boolean);
  return paymentValues.length === 0 || paymentValues.every(value => value === 'paid');
}

function mapProductionStatus(value) {
  const status = normalizeLower(value);
  const map = {
    new: 'scheduled_for_juicing',
    awaiting_production: 'scheduled_for_juicing',
    pending: 'scheduled_for_juicing',
    scheduled: 'scheduled_for_juicing',
    production_scheduled: 'scheduled_for_juicing',
    in_production: 'in_production',
    bottled: 'bottled_packed',
    labeled: 'bottled_packed',
    qc_checked: 'bottled_packed',
    packed: 'bottled_packed',
    in_cold_storage: 'bottled_packed',
    assigned_for_pickup: 'ready_for_pickup',
    assigned_for_delivery: 'out_for_delivery',
    out_for_delivery: 'out_for_delivery',
    arriving_soon: 'arriving_soon',
    fulfilled: 'delivered',
    delivered: 'delivered',
    picked_up: 'picked_up',
    ready_for_pickup: 'ready_for_pickup',
    order_received: 'order_received',
    scheduled_for_juicing: 'scheduled_for_juicing',
    scheduled_for_production: 'scheduled_for_juicing',
    bottled_packed: 'bottled_packed',
  };
  return map[status] || status;
}

function mapFulfillmentStatus(value) {
  const status = normalizeLower(value);
  const map = {
    pending_production: 'pending',
    pending: 'pending',
    scheduled: 'pending',
    assigned: 'pending',
    ready_for_delivery: 'packed',
    packed: 'packed',
    bottled_packed: 'packed',
    fulfilled: 'delivered',
    delivered: 'delivered',
    out_for_delivery: 'out_for_delivery',
    in_transit: 'out_for_delivery',
    cancelled: 'cancelled',
    canceled: 'cancelled',
  };
  return map[status] || status;
}

function comparableValuesDiffer(left, right, mapper = value => normalizeLower(value)) {
  const normalizedLeft = mapper(left);
  const normalizedRight = mapper(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft !== normalizedRight;
}

function deliveryDateForOrder(order) {
  return normalizeText(order?.assigned_delivery_date || order?.estimated_delivery_date || order?.delivery_date || order?.assigned_delivery_day);
}

function deliveryDateForNative(nativeOrder, task) {
  return normalizeText(task?.delivery_date || task?.scheduled_date || task?.assigned_delivery_date || nativeOrder?.assigned_delivery_date || nativeOrder?.selected_delivery_date || nativeOrder?.requested_delivery_date);
}

function buildNativeOrderHistoryPatch(order, nativeOrder, task) {
  const patch = {};
  const mappedStatus = mapProductionStatus(task?.delivery_status || task?.status || nativeOrder?.production_status || nativeOrder?.order_status);
  if (!order?.status && mappedStatus) patch.status = mappedStatus;
  const productionStatus = normalizeText(task?.production_status || nativeOrder?.production_status);
  if (productionStatus) patch.production_status = productionStatus;
  const fulfillmentStatus = normalizeText(nativeOrder?.fulfillment_status || task?.status);
  if (fulfillmentStatus) patch.fulfillment_status = fulfillmentStatus;
  const deliveryStatus = normalizeText(task?.delivery_status);
  if (deliveryStatus) patch.delivery_status = deliveryStatus;
  const deliveryWindowLabel = normalizeText(order?.delivery_window_label || task?.delivery_window_label || nativeOrder?.delivery_window_label);
  if (!order?.delivery_window_label && deliveryWindowLabel) patch.delivery_window_label = deliveryWindowLabel;
  return patch;
}

function hasDuplicateIdentity(nativeOrders, tasks) {
  return uniqueRows(nativeOrders).length !== 1 || uniqueRows(tasks).length !== 1;
}

function nativeContextEligible(order, nativeOrders, tasks, reviewRows, syncRows, parityRows) {
  const nativeOrderList = uniqueRows(nativeOrders);
  const taskList = uniqueRows(tasks);
  const nativeOrder = nativeOrderList[0] || null;
  const task = taskList[0] || null;
  const blockers = [];

  if (!order) blockers.push('customer_app_order_missing');
  if (hasDuplicateIdentity(nativeOrderList, taskList)) blockers.push('duplicate_or_missing_native_identity');
  if (!nativeOrder) blockers.push('native_shopify_order_missing');
  if (!task) blockers.push('native_fulfillment_task_missing');
  if (looksSubscriptionOrMultiDelivery(order, nativeOrder, task)) blockers.push('subscription_multi_delivery_hub_source_of_truth');
  if (looksRefunded(order, nativeOrder)) blockers.push('refund_payment_hub_source_of_truth');
  if (looksCancelled(order, nativeOrder, task)) blockers.push('cancelled_payment_risk');
  if (looksHistoricalLateMirror(order, nativeOrder, task)) blockers.push('historical_late_mirror_preserve_current_behavior');
  if (!hasPaidCaptured(order)) blockers.push('payment_not_paid_captured');
  if (!nativePaymentIsPaid(nativeOrder, task)) blockers.push('payment_mismatch');
  if ((reviewRows || []).some(isOpenReviewRow)) blockers.push('order_review_queue_hold');
  if ((syncRows || []).some(row => rowTextIncludes(row, ['repair', 'replay', 'retry', 'recovery']))) blockers.push('repair_replay_hold');
  if ((parityRows || []).some(row => ['mismatch', 'blocked', 'needs_manual_review'].includes(normalizeLower(row?.native_parity_status)))) blockers.push('repair_replay_hold');

  const customerStatus = order?.status;
  const nativeStatus = task?.delivery_status || task?.status || nativeOrder?.production_status || nativeOrder?.order_status;
  if (comparableValuesDiffer(customerStatus, nativeStatus, mapProductionStatus)) blockers.push('status_mismatch');

  const customerPayment = order?.payment_status || order?.financial_status;
  const nativePayment = nativeOrder?.payment_status || nativeOrder?.financial_status || task?.payment_status;
  if (comparableValuesDiffer(customerPayment, nativePayment)) blockers.push('payment_mismatch');

  const customerFulfillment = order?.fulfillment_status;
  const nativeFulfillment = nativeOrder?.fulfillment_status || task?.status;
  if (comparableValuesDiffer(customerFulfillment, nativeFulfillment, mapFulfillmentStatus)) blockers.push('fulfillment_mismatch');

  const customerDate = deliveryDateForOrder(order);
  const nativeDate = deliveryDateForNative(nativeOrder, task);
  if (customerDate && nativeDate && customerDate !== nativeDate) blockers.push('delivery_schedule_mismatch');

  return {
    eligible: blockers.length === 0,
    blockers: Array.from(new Set(blockers)),
    nativeOrder,
    task,
  };
}

async function safeFilter(entity, filter, sort = null, limit = 20) {
  if (!entity?.filter) return [];
  try {
    return await entity.filter(filter, sort, limit) || [];
  } catch (error) {
    console.warn('[getCustomerAccountDashboardData] native history context read skipped:', error?.message || error);
    return [];
  }
}

async function loadNativeHistoryContextForOrder(base44, order) {
  const entities = base44.asServiceRole.entities;
  const orderNumber = normalizeOrderNumber(order?.order_number);
  const nativeOrderQueries = [];
  if (order?.id) {
    nativeOrderQueries.push({ base44_order_id: order.id });
    nativeOrderQueries.push({ customer_app_order_id: order.id });
  }
  if (orderNumber) {
    nativeOrderQueries.push({ shopify_order_number: orderNumber });
    nativeOrderQueries.push({ order_number: orderNumber });
  }

  const nativeOrders = uniqueRows((await Promise.all(nativeOrderQueries.map(query => safeFilter(entities.ShopifyOrder, query, null, 5)))).flat())
    .filter(nativeOrder => {
      const nativeOrderNumber = normalizeOrderNumber(nativeOrder?.shopify_order_number || nativeOrder?.order_number);
      return (!order?.id || nativeOrder?.base44_order_id === order.id || nativeOrder?.customer_app_order_id === order.id || nativeOrderNumber === orderNumber) && (!orderNumber || !nativeOrderNumber || nativeOrderNumber === orderNumber);
    });

  const nativeOrder = nativeOrders[0] || null;
  const taskQueries = [];
  if (nativeOrder?.id) {
    taskQueries.push({ native_shopify_order_id: nativeOrder.id });
    taskQueries.push({ shopify_order_id: nativeOrder.id });
  }
  if (order?.id) taskQueries.push({ base44_order_id: order.id });
  if (orderNumber) taskQueries.push({ order_number: orderNumber });

  const tasks = uniqueRows((await Promise.all(taskQueries.map(query => safeFilter(entities.FulfillmentTask, query, null, 10)))).flat())
    .filter(task => {
      const taskOrderNumber = normalizeOrderNumber(task?.order_number || task?.shopify_order_number);
      const taskNativeLinkMatches = !nativeOrder?.id || task?.native_shopify_order_id === nativeOrder.id || task?.shopify_order_id === nativeOrder.id || taskOrderNumber === orderNumber;
      const taskCustomerLinkMatches = !order?.id || task?.base44_order_id === order.id || task?.order_id === order.id || taskOrderNumber === orderNumber;
      return taskNativeLinkMatches && taskCustomerLinkMatches && (!orderNumber || !taskOrderNumber || taskOrderNumber === orderNumber);
    });

  const reviewRows = uniqueRows([
    ...(order?.id ? await safeFilter(entities.OrderReviewQueue, { existing_order_id: order.id }, '-created_date', 10) : []),
    ...(orderNumber ? await safeFilter(entities.OrderReviewQueue, { existing_order_number: orderNumber }, '-created_date', 10) : []),
  ]);
  const syncRows = uniqueRows([
    ...(order?.id ? await safeFilter(entities.OrderSyncLog, { order_id: order.id }, '-created_date', 10) : []),
    ...(orderNumber ? await safeFilter(entities.OrderSyncLog, { order_number: orderNumber }, '-created_date', 10) : []),
  ]);
  const parityRows = uniqueRows([
    ...(order?.id ? await safeFilter(entities.SafeSyncParityLog, { order_id: order.id }, '-created_date', 10) : []),
    ...(orderNumber ? await safeFilter(entities.SafeSyncParityLog, { order_number: orderNumber }, '-created_date', 10) : []),
  ]);

  return { nativeOrders, tasks, reviewRows, syncRows, parityRows };
}

async function applyLimitedNativeFirstOrderHistory(base44, orders) {
  if (!envEnabled(CUSTOMER_ORDER_HISTORY_NATIVE_FIRST_ENABLE)) return orders;
  if (envEnabled(CUSTOMER_ORDER_HISTORY_NATIVE_FIRST_KILL_SWITCH)) return orders;

  const allowlist = parseCsvSet(Deno.env.get(CUSTOMER_ORDER_HISTORY_NATIVE_FIRST_ALLOWLIST));
  if (allowlist.size === 0) return orders;

  const enriched = [];
  for (const order of orders || []) {
    const orderNumber = normalizeOrderNumber(order?.order_number);
    if (!orderNumber || !allowlist.has(orderNumber)) {
      enriched.push(order);
      continue;
    }

    const context = await loadNativeHistoryContextForOrder(base44, order);
    const eligibility = nativeContextEligible(order, context.nativeOrders, context.tasks, context.reviewRows, context.syncRows, context.parityRows);
    if (!eligibility.eligible) {
      enriched.push(order);
      continue;
    }

    enriched.push({
      ...order,
      ...buildNativeOrderHistoryPatch(order, eligibility.nativeOrder, eligibility.task),
    });
  }

  return enriched;
}

function paymentWasCaptured(row) {
  return Boolean(
    row?.payment_captured === true
    || ['paid', 'refunded'].includes(normalizeLower(row?.payment_status))
    || ['paid', 'refunded'].includes(normalizeLower(row?.financial_status))
  );
}

function authoritativeCustomerOrderStatus(order) {
  const payment = normalizeLower(order?.payment_status || order?.financial_status);
  const refund = normalizeLower(order?.refund_status);
  if (payment === 'refunded' || refund.includes('refund') || order?.refunded_at) return 'refunded';

  const statusValues = [
    order?.order_status,
    order?.fulfillment_status,
    order?.shopify_fulfillment_status,
    order?.production_status,
  ].map(normalizeLower).filter(Boolean);
  if (statusValues.some(value => ['cancelled', 'canceled', 'failed', 'voided'].includes(value))) return 'cancelled';
  if (statusValues.some(value => ['fulfilled', 'delivered', 'picked_up'].includes(value))) {
    return ['pickup', 'pos'].includes(normalizeLower(order?.fulfillment_method)) ? 'picked_up' : 'delivered';
  }

  const mapped = mapProductionStatus(
    order?.order_status || order?.production_status || order?.fulfillment_status || order?.shopify_fulfillment_status,
  );
  if (mapped && mapped !== 'not_required') return mapped;
  return normalizeLower(order?.source_channel) === 'pos' ? 'picked_up' : 'order_received';
}

function sanitizeAuthoritativeHistoryOrder(order) {
  const orderNumber = normalizeOrderNumber(order?.shopify_order_number || order?.order_number);
  const items = (Array.isArray(order?.line_items) ? order.line_items : []).map(item => ({
    product_id: normalizeText(item?.product_id || item?.shopify_product_id) || null,
    title: normalizeText(item?.title || item?.name) || 'Item',
    price: finiteNumber(item?.price) ?? 0,
    quantity: finiteNumber(item?.quantity) ?? 1,
    image_url: normalizeText(item?.image_url) || null,
    size: normalizeText(item?.variant_title) || null,
  }));
  const total = finiteNumber(order?.total_price ?? order?.total) ?? 0;
  const subtotal = finiteNumber(order?.subtotal) ?? total;
  const fulfillmentMethod = normalizeLower(order?.fulfillment_method);

  return {
    id: `shopify_order_${normalizeText(order?.id) || orderNumber}`,
    order_number: orderNumber,
    customer_name: normalizeText(order?.customer_name) || null,
    items,
    subtotal,
    delivery_fee: Math.max(0, finiteNumber(order?.delivery_fee) ?? 0),
    total,
    fulfillment_type: ['pickup', 'pos'].includes(fulfillmentMethod)
      || normalizeLower(order?.source_channel) === 'pos'
      ? 'pickup'
      : 'delivery',
    estimated_delivery_date: normalizeText(order?.requested_delivery_date) || null,
    assigned_delivery_date: normalizeText(order?.assigned_delivery_date) || null,
    delivery_window_label: normalizeText(order?.delivery_window_label || order?.requested_time_window) || null,
    delivered_at: normalizeText(order?.delivered_at) || null,
    delivery_photo_url: normalizeText(order?.delivery_photo_url) || null,
    delivery_drop_location: normalizeText(order?.delivery_drop_location) || null,
    status: authoritativeCustomerOrderStatus(order),
    payment_captured: paymentWasCaptured(order),
    payment_status: normalizeLower(order?.payment_status || order?.financial_status) || 'paid',
    financial_status: normalizeLower(order?.financial_status || order?.payment_status) || 'paid',
    fulfillment_status: normalizeLower(order?.fulfillment_status || order?.shopify_fulfillment_status) || null,
    created_date: normalizeText(order?.customer_order_date || order?.created_date) || null,
    is_test_order: false,
    is_abandoned_checkout: false,
    source_channel: normalizeLower(order?.source_channel) || 'online',
    customer_history_source: 'authoritative_shopify_order',
  };
}

async function applyOwnedDeliveryProofToOrderHistory(base44, orders, identityEmails) {
  const deliveredOrders = (orders || []).filter(order => normalizeLower(order?.status) === 'delivered');
  if (deliveredOrders.length === 0) return orders;

  const taskRows = uniqueRows((await Promise.all(
    (identityEmails || [])
      .map(normalizeText)
      .filter(Boolean)
      .map(customerEmail => safeFilter(
        base44.asServiceRole.entities.FulfillmentTask,
        { customer_email: customerEmail },
        '-created_date',
        100,
      )),
  )).flat()).filter(task => !task?.is_test_task);

  if (taskRows.length === 0) return orders;

  return (orders || []).map(order => {
    if (normalizeLower(order?.status) !== 'delivered') return order;
    if (normalizeText(order?.delivery_photo_url) && normalizeText(order?.delivery_drop_location)) return order;

    const orderId = normalizeText(order?.id);
    const orderNumber = normalizeOrderNumber(order?.order_number);
    const proofTask = taskRows.find(task => {
      if (!normalizeText(task?.delivery_photo_url) && !normalizeText(task?.delivery_drop_location)) return false;
      const taskOrderNumber = normalizeOrderNumber(task?.order_number || task?.shopify_order_number);
      const linkedIds = [task?.base44_order_id, task?.order_id].map(normalizeText).filter(Boolean);
      return Boolean(
        (orderId && linkedIds.includes(orderId))
        || (orderNumber && taskOrderNumber === orderNumber)
      );
    });

    if (!proofTask) return order;
    return {
      ...order,
      delivered_at: normalizeText(order?.delivered_at || proofTask?.delivered_at) || null,
      delivery_photo_url: normalizeText(order?.delivery_photo_url || proofTask?.delivery_photo_url) || null,
      delivery_drop_location: normalizeText(order?.delivery_drop_location || proofTask?.delivery_drop_location) || null,
    };
  });
}

async function loadOwnedAuthoritativeOrders(base44, identityEmails, profiles) {
  const entity = base44.asServiceRole.entities.ShopifyOrder;
  const normalizedEmails = new Set((identityEmails || []).map(normalizeEmail).filter(Boolean));
  const normalizedPhones = new Set((profiles || []).map(profile => normalizePhone(profile?.phone)).filter(Boolean));
  const queries = [];

  for (const email of identityEmails || []) {
    const raw = normalizeText(email);
    if (raw) queries.push({ customer_email: raw });
    const normalized = normalizeEmail(raw);
    if (normalized && normalized !== raw) queries.push({ customer_email: normalized });
  }
  for (const profile of profiles || []) {
    for (const phone of phoneQueryVariants(profile?.phone)) queries.push({ customer_phone: phone });
  }

  const rows = uniqueRows((await Promise.all(
    queries.map(query => safeFilter(entity, query, '-created_date', 100)),
  )).flat());

  return rows.filter(row => {
    const ownedByEmail = normalizedEmails.has(normalizeEmail(row?.customer_email));
    const rowPhone = normalizePhone(row?.customer_phone);
    const ownedByPhone = Boolean(rowPhone && normalizedPhones.has(rowPhone));
    return (ownedByEmail || ownedByPhone)
      && paymentWasCaptured(row)
      && !row?.is_test_order
      && !row?.is_abandoned_checkout;
  });
}

function mergeOwnedAuthoritativeOrderHistory(currentOrders, authoritativeOrders) {
  if (envEnabled(CUSTOMER_ORDER_HISTORY_SOURCE_MERGE_KILL_SWITCH)) return currentOrders;

  const merged = [...(currentOrders || [])];
  const currentOrderNumbers = new Set(merged.map(order => normalizeOrderNumber(order?.order_number)).filter(Boolean));
  const currentIds = new Set(merged.map(order => normalizeText(order?.id)).filter(Boolean));

  for (const authoritativeOrder of authoritativeOrders || []) {
    const orderNumber = normalizeOrderNumber(authoritativeOrder?.shopify_order_number || authoritativeOrder?.order_number);
    const linkedCustomerOrderId = normalizeText(authoritativeOrder?.base44_order_id || authoritativeOrder?.customer_app_order_id);
    if ((orderNumber && currentOrderNumbers.has(orderNumber)) || (linkedCustomerOrderId && currentIds.has(linkedCustomerOrderId))) {
      continue;
    }

    const projected = sanitizeAuthoritativeHistoryOrder(authoritativeOrder);
    if (!projected.order_number) continue;
    merged.push(projected);
    currentOrderNumbers.add(projected.order_number);
  }

  return merged.sort((left, right) => {
    const leftTime = Date.parse(left?.created_date || '') || 0;
    const rightTime = Date.parse(right?.created_date || '') || 0;
    return rightTime - leftTime;
  });
}


const CUSTOMER_REWARDS_DISPLAY_TIERS = [
  { name: 'Seedling', min: 0, max: 499, next: 500 },
  { name: 'Silver', min: 500, max: 999, next: 1000 },
  { name: 'Gold', min: 1000, max: 2499, next: 2500 },
  { name: 'Platinum', min: 2500, max: 4999, next: 5000 },
  { name: 'Elite', min: 5000, max: Number.POSITIVE_INFINITY, next: null },
];

function customerRewardsLimitedNativeFirstConfig() {
  return {
    enabled: envEnabled(CUSTOMER_REWARDS_NATIVE_FIRST_READS_ENABLE),
    killSwitch: envEnabled(CUSTOMER_REWARDS_NATIVE_FIRST_READS_KILL_SWITCH),
    allowlist: parseIdentifierCsvSet(Deno.env.get(CUSTOMER_REWARDS_NATIVE_FIRST_READS_USER_POINTS_ALLOWLIST)),
  };
}

function customerRewardsLimitedNativeReadsActive(config = customerRewardsLimitedNativeFirstConfig()) {
  return Boolean(config.enabled && !config.killSwitch && config.allowlist?.size > 0);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function deriveCustomerRewardsTier(points) {
  const total = finiteNumber(points) ?? 0;
  return CUSTOMER_REWARDS_DISPLAY_TIERS.find(tier => total >= tier.min && total <= tier.max) || CUSTOMER_REWARDS_DISPLAY_TIERS[0];
}

function analyzeCustomerRewardsHistory(pointsRecord) {
  const history = Array.isArray(pointsRecord?.points_history) ? pointsRecord.points_history : [];
  let malformed = 0;
  let delta = 0;
  let missingIdempotency = 0;
  for (const entry of history) {
    const amount = finiteNumber(entry?.amount);
    if (amount === null) {
      malformed += 1;
      continue;
    }
    delta += amount;
    if (!normalizeText(entry?.idempotency_key)) missingIdempotency += 1;
  }
  const total = finiteNumber(pointsRecord?.total_points);
  return {
    historyEntryCount: history.length,
    malformedHistoryEntryCount: malformed,
    missingIdempotencyKeyCount: missingIdempotency,
    historyReconstructable: history.length > 0 && malformed === 0,
    reconstructableHistoryDelta: delta,
    balanceHistoryConsistent: total !== null && history.length > 0 && malformed === 0 && total === delta,
  };
}

function customerRewardsRepairReplayHold(pointsRecord) {
  const historyText = (Array.isArray(pointsRecord?.points_history) ? pointsRecord.points_history : [])
    .map(entry => [entry?.description, entry?.event_key, entry?.idempotency_key].map(normalizeLower).join(' '))
    .join(' ');
  const text = [
    pointsRecord?.description,
    pointsRecord?.sync_status,
    pointsRecord?.source,
    historyText,
  ].map(normalizeLower).join(' ');
  return ['repair', 'replay', 'retry', 'recovery', 'backfill', 'manual_review'].some(token => text.includes(token));
}

function customerRewardsTierCompatible(pointsRecord, derivedTier) {
  const storedTier = normalizeLower(pointsRecord?.current_tier || pointsRecord?.tier || pointsRecord?.tier_name || pointsRecord?.loyalty_tier);
  if (!storedTier) return true;
  return storedTier === normalizeLower(derivedTier?.name);
}

function customerRewardsCatalogReadiness(activeRewardTiers) {
  const rewards = Array.isArray(activeRewardTiers) ? activeRewardTiers : [];
  const blockers = [];
  const seenDefinitions = new Set();
  let duplicateRewardDefinitionCount = 0;
  let invalidRewardCostCount = 0;

  if (rewards.length === 0) blockers.push('static_fallback_catalog_active');

  for (const reward of rewards) {
    const title = normalizeLower(reward?.title);
    const rewardType = normalizeLower(reward?.reward_type);
    const cost = finiteNumber(reward?.points_required);
    const key = `${title}|${rewardType}|${cost ?? 'invalid'}`;
    if (!title || !rewardType || cost === null || cost < 0) invalidRewardCostCount += 1;
    if (seenDefinitions.has(key)) duplicateRewardDefinitionCount += 1;
    seenDefinitions.add(key);
  }

  if (duplicateRewardDefinitionCount > 0) blockers.push('duplicate_reward_definition_risk');
  if (invalidRewardCostCount > 0) blockers.push('invalid_reward_cost_risk');

  return {
    ready: blockers.length === 0,
    blockers,
    activeRewardCount: rewards.length,
    duplicateRewardDefinitionCount,
    invalidRewardCostCount,
  };
}

function customerRewardsNativeReadEligible(pointsRecord, ownedPointsRows, activeRewardTiers = []) {
  const pointsRows = uniqueRows(ownedPointsRows || []);
  const blockers = [];
  const total = finiteNumber(pointsRecord?.total_points);
  const lifetime = finiteNumber(pointsRecord?.lifetime_points);
  const redeemed = finiteNumber(pointsRecord?.redeemed_points);
  const derivedTier = deriveCustomerRewardsTier(total ?? 0);
  const history = analyzeCustomerRewardsHistory(pointsRecord);
  const catalog = customerRewardsCatalogReadiness(activeRewardTiers);

  if (!pointsRecord) blockers.push('user_points_missing');
  if (pointsRows.length !== 1) blockers.push('duplicate_loyalty_identity_risk');
  if (!normalizeText(pointsRecord?.id)) blockers.push('internal_user_points_id_missing');
  if (total === null || lifetime === null || redeemed === null) blockers.push('native_balance_missing');
  if ((total ?? 0) < 0 || (lifetime ?? 0) < 0 || (redeemed ?? 0) < 0) blockers.push('negative_or_impossible_points_state');
  if ((lifetime ?? 0) < (redeemed ?? 0)) blockers.push('negative_or_impossible_points_state');
  if (!history.historyReconstructable) blockers.push('points_history_not_reconstructable_for_read_parity');
  if (history.historyReconstructable && !history.balanceHistoryConsistent) blockers.push('native_balance_history_mismatch');
  if (!customerRewardsTierCompatible(pointsRecord, derivedTier)) blockers.push('tier_mismatch_manual_review');
  if (!catalog.ready) blockers.push(...catalog.blockers);
  if (customerRewardsRepairReplayHold(pointsRecord)) blockers.push('repair_replay_hold');

  return {
    eligible: blockers.length === 0,
    blockers: Array.from(new Set(blockers)),
    derivedTier,
    history,
    catalog,
  };
}

function sanitizeCustomerRewardsPointsRecord(pointsRecord, eligibility) {
  if (!pointsRecord) return null;
  const total = finiteNumber(pointsRecord.total_points) ?? 0;
  const lifetime = finiteNumber(pointsRecord.lifetime_points) ?? 0;
  const redeemed = finiteNumber(pointsRecord.redeemed_points) ?? 0;
  const tier = eligibility?.derivedTier || deriveCustomerRewardsTier(total);
  const pointsToNextTier = tier.next ? Math.max(0, tier.next - total) : 0;
  const tierProgressPercent = tier.next ? Math.min(100, Math.max(0, ((total - tier.min) / (tier.next - tier.min)) * 100)) : 100;

  return {
    total_points: total,
    lifetime_points: lifetime,
    redeemed_points: redeemed,
    current_tier: tier.name,
    points_to_next_tier: pointsToNextTier,
    tier_progress_percent: tierProgressPercent,
  };
}

function selectLimitedNativeFirstRewardsPointsRecord({ currentPointsRecord, ownedPointsRows, activeRewardTiers, config = customerRewardsLimitedNativeFirstConfig() }) {
  if (!customerRewardsLimitedNativeReadsActive(config)) {
    return { pointsRecord: currentPointsRecord, selected: false, reason: 'feature_disabled_or_unconfigured' };
  }

  const ownedRows = uniqueRows(ownedPointsRows || []);
  const allowlistedOwnedRows = ownedRows.filter(row => config.allowlist.has(normalizeText(row?.id)));
  if (allowlistedOwnedRows.length !== 1) {
    return { pointsRecord: currentPointsRecord, selected: false, reason: 'allowlisted_owned_points_record_not_exactly_one' };
  }

  const candidate = allowlistedOwnedRows[0];
  const eligibility = customerRewardsNativeReadEligible(candidate, ownedRows, activeRewardTiers);
  if (!eligibility.eligible) {
    return { pointsRecord: currentPointsRecord, selected: false, reason: 'eligibility_failed' };
  }

  return {
    pointsRecord: sanitizeCustomerRewardsPointsRecord(candidate, eligibility),
    selected: true,
    reason: 'limited_native_rewards_read_selected',
  };
}

export default async function handler(req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const authEmail = user.email;
    console.log('[getCustomerAccountDashboardData] Loading authenticated dashboard');

    // ── STEP 1: Resolve all identity emails via service role ──────────────────
    const identities = new Set([authEmail]);
    const resolvedProfiles = [];
    const seenProfileIds = new Set();
    const rememberProfile = (profile) => {
      if (!profile) return;
      const key = normalizeText(profile.id) || JSON.stringify(profile);
      if (seenProfileIds.has(key)) return;
      seenProfileIds.add(key);
      resolvedProfiles.push(profile);
    };

    // Forward lookup: profile where customer_email = authEmail
    const fwdProfiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: authEmail });
    fwdProfiles.forEach(rememberProfile);
    const fwdProfile = fwdProfiles[0] || null;
    if (fwdProfile?.contact_email) identities.add(fwdProfile.contact_email);
    if (fwdProfile?.customer_email) identities.add(fwdProfile.customer_email);

    // Reverse lookup: profile where contact_email = authEmail (Apple relay case)
    const revProfiles = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: authEmail });
    revProfiles.forEach(rememberProfile);
    for (const p of revProfiles) {
      if (p.customer_email) identities.add(p.customer_email);
      if (p.contact_email) identities.add(p.contact_email);
    }

    // Secondary forward lookups for any newly found emails
    for (const email of [...identities]) {
      if (email !== authEmail) {
        const extraProfiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: email });
        extraProfiles.forEach(rememberProfile);
        if (extraProfiles[0]?.contact_email) identities.add(extraProfiles[0].contact_email);
        const revExtra = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: email });
        revExtra.forEach(rememberProfile);
        for (const p of revExtra) {
          if (p.customer_email) identities.add(p.customer_email);
          if (p.contact_email) identities.add(p.contact_email);
        }
      }
    }

    const identityList = [...identities];
    console.log(`[getCustomerAccountDashboardData] Resolved ${identityList.length} identity email(s)`);

    // Determine primary canonical email (prefer real email over relay)
    // contact_email on the profile is always the real email
    const primaryEmail = fwdProfile?.contact_email
      || revProfiles[0]?.customer_email
      || authEmail;

    // ── STEP 2: Load customer profile ─────────────────────────────────────────
    // Use the best profile available (prefer profile under real email)
    let customerProfile = fwdProfile;
    if (!customerProfile && revProfiles[0]) {
      customerProfile = revProfiles[0];
    }
    if (!customerProfile) {
      for (const email of identityList) {
        const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: email });
        profiles.forEach(rememberProfile);
        if (profiles[0]) { customerProfile = profiles[0]; break; }
      }
    }
    rememberProfile(customerProfile);

    // ── STEP 3: Load subscriptions across all identities ─────────────────────
    const allSubs = [];
    const seenSubIds = new Set();
    for (const email of identityList) {
      const subs = await base44.asServiceRole.entities.Subscription.filter(
        { customer_email: email },
        '-created_date',
        50
      );
      for (const sub of subs) {
        const dedupeKey = sub.stripe_subscription_id || sub.id;
        if (!seenSubIds.has(dedupeKey)) {
          seenSubIds.add(dedupeKey);
          allSubs.push(sub);
        }
      }
    }

    // Active = status is active or paused (not cancelled, not refunded, not quarantined/failed)
    const activeSubs = allSubs.filter(s =>
      s.status === 'active' || s.status === 'paused'
    );
    const currentRitual = activeSubs.find(s => s.status === 'active') || activeSubs[0] || null;

    // ── STEP 4: Load orders across all identities ─────────────────────────────
    const allOrders = [];
    const seenOrderPIs = new Set();
    for (const email of identityList) {
      const orders = await base44.asServiceRole.entities.Order.filter(
        { customer_email: email },
        '-created_date',
        100
      );
      for (const order of orders) {
        // Dedupe by order_number first (most reliable), then PI, then entity id
        // Using order_number prevents hiding a refunded order that shares a PI with another attempt
        const dedupeKey = order.order_number || order.stripe_payment_intent_id || order.id;
        if (!seenOrderPIs.has(dedupeKey)) {
          seenOrderPIs.add(dedupeKey);
          allOrders.push(order);
        }
      }
    }

    // Valid paid orders (for count display — excludes test/abandoned/unpaid)
    const validOrders = allOrders.filter(o =>
      (o.payment_status === 'paid' || o.payment_status === 'refunded' || o.payment_captured === true || o.financial_status === 'paid' || o.financial_status === 'refunded') &&
      !o.is_abandoned_checkout &&
      !o.is_test_order
    );

    // All orders to show in Order History: everything real except test/abandoned/never-paid
    // Keep: paid, refunded, cancelled-after-payment, delivered, any status where payment was captured
    // Hide: test orders, abandoned checkouts, orders where payment was never captured (failed/pending with no capture)
    let allOrdersForHistory = allOrders.filter(o => {
      if (o.is_test_order) return false;
      if (o.is_abandoned_checkout) return false;
      // Never show orders where payment was never captured at all
      const paymentWasCaptured = o.payment_captured === true
        || o.payment_status === 'paid'
        || o.payment_status === 'refunded'
        || o.financial_status === 'paid'
        || o.financial_status === 'refunded';
      if (!paymentWasCaptured) return false;
      return true;
    });

    allOrdersForHistory = await applyLimitedNativeFirstOrderHistory(base44, allOrdersForHistory);
    const authoritativeOrders = await loadOwnedAuthoritativeOrders(base44, identityList, resolvedProfiles);
    allOrdersForHistory = mergeOwnedAuthoritativeOrderHistory(allOrdersForHistory, authoritativeOrders);
    allOrdersForHistory = await applyOwnedDeliveryProofToOrderHistory(base44, allOrdersForHistory, identityList);

    console.log(`[getCustomerAccountDashboardData] sourceOrders=${allOrders.length} sourceValidOrders=${validOrders.length} authoritativeOrders=${authoritativeOrders.length} customerHistoryOrders=${allOrdersForHistory.length}`);

    // ── STEP 5: Load credits across all identities ────────────────────────────
    let creditRecord = null;
    for (const email of identityList) {
      const credits = await base44.asServiceRole.entities.NuViraCredit.filter({ customer_email: email });
      if (credits[0]) { creditRecord = credits[0]; break; }
    }

    // ── STEP 6: Load loyalty points across all identities ─────────────────────
    let pointsRecord = null;
    let ownedPointsRows = [];
    const rewardsNativeReadConfig = customerRewardsLimitedNativeFirstConfig();
    const rewardsNativeReadActive = customerRewardsLimitedNativeReadsActive(rewardsNativeReadConfig);
    for (const email of identityList) {
      const pts = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: email });
      if (rewardsNativeReadActive) ownedPointsRows = uniqueRows([...ownedPointsRows, ...pts]);
      if (pts[0] && !pointsRecord) {
        pointsRecord = pts[0];
        if (!rewardsNativeReadActive) break;
      }
    }

    if (rewardsNativeReadActive) {
      const activeRewardTiers = await safeFilter(base44.asServiceRole.entities.RewardTier, { is_active: true }, 'sort_order', 20);
      const selectedRewardsRead = selectLimitedNativeFirstRewardsPointsRecord({
        currentPointsRecord: pointsRecord,
        ownedPointsRows,
        activeRewardTiers,
        config: rewardsNativeReadConfig,
      });
      pointsRecord = selectedRewardsRead.pointsRecord;
    }

    // ── STEP 7: Unread notification count ─────────────────────────────────────
    let unreadCount = 0;
    for (const email of identityList) {
      const notifs = await base44.asServiceRole.entities.Notification.filter(
        { customer_email: email, is_read: false },
        '-created_date',
        50
      );
      unreadCount += notifs.length;
    }

    console.log(`[getCustomerAccountDashboardData] Done. identities=${identityList.length} subs=${allSubs.length} active_subs=${activeSubs.length} orders=${allOrdersForHistory.length} credits=${creditRecord?.balance || 0} pts=${pointsRecord?.total_points || 0}`);

    return Response.json({
      // Identity resolution
      auth_email: authEmail,
      resolved_identity_emails: identityList,
      primary_customer_email: primaryEmail,
      display_email: customerProfile?.contact_email || authEmail,

      // Profile
      customer_profile: customerProfile || null,

      // Subscriptions
      all_subscriptions: allSubs,
      active_subscriptions: activeSubs,
      subscription_count: activeSubs.length,
      current_ritual: currentRitual,

      // Orders
      orders: allOrdersForHistory,
      all_orders_raw: allOrdersForHistory,
      order_count: allOrdersForHistory.length,

      // Credits
      credits: creditRecord?.balance || 0,
      lifetime_credits: creditRecord?.lifetime_issued || 0,
      applied_credits: creditRecord?.lifetime_used || 0,
      credit_record: creditRecord || null,

      // Loyalty
      loyalty_points: pointsRecord?.total_points || 0,
      loyalty_lifetime: pointsRecord?.lifetime_points || 0,
      loyalty_redeemed: pointsRecord?.redeemed_points || 0,
      points_record: pointsRecord || null,

      // Notifications
      notifications_unread_count: unreadCount,

      // Debug
      debug: {
        resolved_identity_emails: identityList,
        active_subscription_ids_found: activeSubs.map(s => s.stripe_subscription_id || s.id),
        orders_found: allOrdersForHistory.length,
        credits_found: creditRecord?.balance || 0,
        profile_email_displayed: customerProfile?.contact_email || authEmail,
        ritual_card_value: currentRitual ? 'Active' : 'None',
        data_source: 'getCustomerAccountDashboardData',
      },
    });

  } catch (error) {
    console.error('[getCustomerAccountDashboardData] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
