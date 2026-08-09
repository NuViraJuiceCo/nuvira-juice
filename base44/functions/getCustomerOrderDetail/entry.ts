// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_ORDER_TRACKER_NATIVE_FIRST_ENABLE = 'ENABLE_CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST';
const CUSTOMER_ORDER_TRACKER_NATIVE_FIRST_KILL_SWITCH = 'CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST_KILL_SWITCH';
const CUSTOMER_ORDER_TRACKER_NATIVE_FIRST_ALLOWLIST = 'CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST';

async function readJsonBody(req) {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false, body: null };
  }
}

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

function normalizeOrderNumber(value) {
  return normalizeText(value).replace(/^#/, '').toUpperCase();
}

function envEnabled(name) {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(normalizeLower(Deno.env.get(name)));
}

function parseCsvSet(value) {
  return new Set(normalizeText(value).split(',').map(part => normalizeOrderNumber(part)).filter(Boolean));
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

async function safeFilter(entity, filter, sort = null, limit = 20) {
  if (!entity?.filter) return [];
  try {
    return await entity.filter(filter, sort, limit) || [];
  } catch (error) {
    console.warn('[getCustomerOrderDetail] limited native tracker context read skipped:', error?.message || error);
    return [];
  }
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

function isOpenReviewRow(row) {
  const status = normalizeLower(row?.status || row?.queue_visibility_status);
  return row && !['resolved', 'archived', 'rejected'].includes(status);
}

function looksSubscriptionOrMultiDelivery(order, nativeOrder, task) {
  const values = [
    order?.order_type,
    order?.source_type,
    order?.fulfillment_mode,
    order?.fulfillment_type,
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
  const values = [nativeOrder?.payment_status, nativeOrder?.financial_status, task?.payment_status].map(normalizeLower).filter(Boolean);
  return values.length === 0 || values.every(value => value === 'paid');
}

function mapCustomerStatus(value) {
  const status = normalizeLower(value);
  const map = {
    new: 'order_received',
    pending: 'scheduled_for_juicing',
    awaiting_production: 'scheduled_for_juicing',
    production_scheduled: 'scheduled_for_juicing',
    scheduled: 'scheduled_for_juicing',
    scheduled_for_production: 'scheduled_for_juicing',
    in_production: 'in_production',
    preparing: 'in_production',
    bottled: 'bottled_packed',
    packed: 'bottled_packed',
    ready_for_delivery: 'bottled_packed',
    bottled_packed: 'bottled_packed',
    out_for_delivery: 'out_for_delivery',
    in_transit: 'out_for_delivery',
    arriving_soon: 'arriving_soon',
    fulfilled: 'delivered',
    delivered: 'delivered',
    picked_up: 'picked_up',
    ready_for_pickup: 'ready_for_pickup',
    order_received: 'order_received',
    scheduled_for_juicing: 'scheduled_for_juicing',
  };
  return map[status] || status;
}

function customerStatusForHubOrder(order) {
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

  const mapped = mapCustomerStatus(order?.order_status || order?.production_status || order?.fulfillment_status);
  if (mapped && mapped !== 'not_required') return mapped;
  return normalizeLower(order?.source_channel) === 'pos' ? 'picked_up' : 'order_received';
}

function sanitizeHubOrderForCustomer(order) {
  if (!order) return null;
  const customerStatus = customerStatusForHubOrder(order);
  const rawFulfillmentMethod = normalizeLower(order.fulfillment_method);
  const fulfillmentMethod = ['picked_up', 'ready_for_pickup'].includes(customerStatus)
    || rawFulfillmentMethod === 'pos'
    || normalizeLower(order.source_channel) === 'pos'
    ? 'pickup'
    : rawFulfillmentMethod || 'delivery';
  return {
    shopify_order_number: normalizeOrderNumber(order.shopify_order_number || order.order_number),
    customer_name: normalizeText(order.customer_name) || null,
    line_items: (Array.isArray(order.line_items) ? order.line_items : []).map(item => ({
      title: normalizeText(item?.title || item?.name) || 'Item',
      variant_title: normalizeText(item?.variant_title) || null,
      quantity: Number.isFinite(Number(item?.quantity)) ? Number(item.quantity) : 1,
      price: Number.isFinite(Number(item?.price)) ? Number(item.price) : 0,
      image_url: normalizeText(item?.image_url) || null,
    })),
    fulfillment_method: fulfillmentMethod,
    status: customerStatus,
    production_status: normalizeLower(order.production_status) || null,
    fulfillment_status: normalizeLower(order.fulfillment_status || order.shopify_fulfillment_status) || null,
    total_price: Number.isFinite(Number(order.total_price)) ? Number(order.total_price) : 0,
    requested_delivery_date: normalizeText(order.requested_delivery_date) || null,
    assigned_delivery_date: normalizeText(order.assigned_delivery_date) || null,
    requested_time_window: customerStatus === 'picked_up'
      ? 'Order complete'
      : normalizeText(order.requested_time_window) || null,
    delivery_window_label: normalizeText(order.delivery_window_label) || null,
    delivered_at: normalizeText(order.delivered_at) || null,
    delivery_photo_url: normalizeText(order.delivery_photo_url) || null,
    delivery_drop_location: normalizeText(order.delivery_drop_location) || null,
  };
}


function safeCustomerProductionStatus(value) {
  const status = normalizeLower(value);
  if (!status) return '';
  const blocked = new Set(['planned', 'completed_pending_verification', 'verified_logged']);
  if (blocked.has(status)) return '';
  return status;
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

function compatibleNativeOrderForCustomerOrder(order, nativeOrder) {
  const orderNumber = normalizeOrderNumber(order?.order_number);
  const nativeNumber = normalizeOrderNumber(nativeOrder?.shopify_order_number || nativeOrder?.order_number);
  const idMatches = Boolean(
    order?.id &&
    (nativeOrder?.base44_order_id === order.id || nativeOrder?.customer_app_order_id === order.id)
  );
  const numberMatches = Boolean(orderNumber && nativeNumber && orderNumber === nativeNumber);
  return idMatches || numberMatches;
}

function compatibleTaskForCustomerOrder(order, nativeOrder, task) {
  const orderNumber = normalizeOrderNumber(order?.order_number);
  const taskNumber = normalizeOrderNumber(task?.order_number || task?.shopify_order_number);
  const customerLinkMatches = Boolean(
    order?.id &&
    (task?.order_id === order.id || task?.base44_order_id === order.id)
  );
  const nativeLinkMatches = Boolean(
    nativeOrder?.id &&
    (task?.native_shopify_order_id === nativeOrder.id || task?.shopify_order_id === nativeOrder.id)
  );
  const numberMatches = Boolean(orderNumber && taskNumber && orderNumber === taskNumber);
  const compatibleNumber = !orderNumber || !taskNumber || orderNumber === taskNumber;
  return (customerLinkMatches || nativeLinkMatches || numberMatches) && compatibleNumber;
}

async function loadNativeTrackerContext(base44, order) {
  const entities = base44.asServiceRole.entities;
  const orderNumber = normalizeOrderNumber(order?.order_number);
  const nativeOrderQueries = [];
  if (order?.id) {
    nativeOrderQueries.push({ base44_order_id: order.id });
    nativeOrderQueries.push({ customer_app_order_id: order.id });
  }
  if (orderNumber) {
    nativeOrderQueries.push({ shopify_order_number: orderNumber });
    nativeOrderQueries.push({ shopify_order_number: `#${orderNumber}` });
    nativeOrderQueries.push({ order_number: orderNumber });
    nativeOrderQueries.push({ order_number: `#${orderNumber}` });
  }

  const nativeOrders = uniqueRows((await Promise.all(nativeOrderQueries.map(query => safeFilter(entities.ShopifyOrder, query, null, 5)))).flat())
    .filter(nativeOrder => compatibleNativeOrderForCustomerOrder(order, nativeOrder));

  const nativeOrder = nativeOrders[0] || null;
  const taskQueries = [];
  if (order?.id) {
    taskQueries.push({ order_id: order.id });
    taskQueries.push({ base44_order_id: order.id });
  }
  if (nativeOrder?.id) {
    taskQueries.push({ native_shopify_order_id: nativeOrder.id });
    taskQueries.push({ shopify_order_id: nativeOrder.id });
  }
  if (orderNumber) {
    taskQueries.push({ order_number: orderNumber });
    taskQueries.push({ order_number: `#${orderNumber}` });
    taskQueries.push({ shopify_order_number: orderNumber });
    taskQueries.push({ shopify_order_number: `#${orderNumber}` });
  }

  const tasks = uniqueRows((await Promise.all(taskQueries.map(query => safeFilter(entities.FulfillmentTask, query, '-created_date', 10)))).flat())
    .filter(task => compatibleTaskForCustomerOrder(order, nativeOrder, task));

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

function nativeTrackerContextEligible(order, nativeOrders, tasks, reviewRows, syncRows, parityRows) {
  const nativeOrderList = uniqueRows(nativeOrders);
  const taskList = uniqueRows(tasks);
  const nativeOrder = nativeOrderList[0] || null;
  const task = taskList[0] || null;
  const blockers = [];

  if (!order) blockers.push('customer_app_order_missing');
  if (nativeOrderList.length !== 1) blockers.push('duplicate_or_missing_native_identity');
  if (taskList.length !== 1) blockers.push('duplicate_or_missing_fulfillment_task_identity');
  if (!nativeOrder) blockers.push('native_shopify_order_missing');
  if (!task) blockers.push('native_fulfillment_task_missing');
  if (nativeOrder && !compatibleNativeOrderForCustomerOrder(order, nativeOrder)) blockers.push('native_shopify_order_identity_conflict');
  if (task && !compatibleTaskForCustomerOrder(order, nativeOrder, task)) blockers.push('native_fulfillment_task_identity_conflict');
  if (looksSubscriptionOrMultiDelivery(order, nativeOrder, task)) blockers.push('subscription_multi_delivery_hub_source_of_truth');
  if (looksRefunded(order, nativeOrder)) blockers.push('refund_payment_hub_source_of_truth');
  if (looksCancelled(order, nativeOrder, task)) blockers.push('cancelled_payment_risk');
  if (!hasPaidCaptured(order)) blockers.push('payment_not_paid_captured');
  if (!nativePaymentIsPaid(nativeOrder, task)) blockers.push('payment_mismatch');
  if ((reviewRows || []).some(isOpenReviewRow)) blockers.push('order_review_queue_hold');
  if ((syncRows || []).some(row => rowTextIncludes(row, ['repair', 'replay', 'retry', 'recovery']))) blockers.push('repair_replay_hold');
  if ((parityRows || []).some(row => ['mismatch', 'blocked', 'needs_manual_review'].includes(normalizeLower(row?.native_parity_status)))) blockers.push('repair_replay_hold');

  const nativeStatus = task?.delivery_status || task?.status || nativeOrder?.production_status || nativeOrder?.order_status;
  if (comparableValuesDiffer(order?.status, nativeStatus, mapCustomerStatus)) blockers.push('status_mismatch');

  const nativePayment = nativeOrder?.payment_status || nativeOrder?.financial_status || task?.payment_status;
  if (comparableValuesDiffer(order?.payment_status || order?.financial_status, nativePayment)) blockers.push('payment_mismatch');

  const nativeFulfillment = nativeOrder?.fulfillment_status || task?.status;
  if (comparableValuesDiffer(order?.fulfillment_status, nativeFulfillment, mapFulfillmentStatus)) blockers.push('fulfillment_mismatch');

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

function buildNativeTrackerOrderPatch(order, nativeOrder, task) {
  const patch = {};
  const nativeStatus = task?.delivery_status || task?.status || nativeOrder?.production_status || nativeOrder?.order_status;
  const mappedStatus = mapCustomerStatus(nativeStatus);
  if (!order?.status && mappedStatus) patch.status = mappedStatus;

  const productionStatus = safeCustomerProductionStatus(task?.production_status || nativeOrder?.production_status);
  if (productionStatus) patch.production_status = productionStatus;
  const fulfillmentStatus = normalizeText(nativeOrder?.fulfillment_status || task?.status);
  if (fulfillmentStatus) patch.fulfillment_status = fulfillmentStatus;
  const deliveryStatus = normalizeText(task?.delivery_status);
  if (deliveryStatus) patch.delivery_status = deliveryStatus;

  const nativeDate = deliveryDateForNative(nativeOrder, task);
  if (!order?.assigned_delivery_date && nativeDate) patch.assigned_delivery_date = nativeDate;
  if (!order?.estimated_delivery_date && nativeDate) patch.estimated_delivery_date = nativeDate;

  const deliveryWindowLabel = normalizeText(task?.delivery_window_label || nativeOrder?.delivery_window_label || task?.time_window || nativeOrder?.requested_time_window);
  if (!order?.delivery_window_label && deliveryWindowLabel) patch.delivery_window_label = deliveryWindowLabel;

  return patch;
}

async function applyLimitedNativeFirstTracker(base44, order) {
  if (!envEnabled(CUSTOMER_ORDER_TRACKER_NATIVE_FIRST_ENABLE)) return order;
  if (envEnabled(CUSTOMER_ORDER_TRACKER_NATIVE_FIRST_KILL_SWITCH)) return order;
  if (!order) return order;

  const allowlist = parseCsvSet(Deno.env.get(CUSTOMER_ORDER_TRACKER_NATIVE_FIRST_ALLOWLIST));
  const orderNumber = normalizeOrderNumber(order?.order_number);
  if (!orderNumber || !allowlist.has(orderNumber)) return order;

  const context = await loadNativeTrackerContext(base44, order);
  const eligibility = nativeTrackerContextEligible(order, context.nativeOrders, context.tasks, context.reviewRows, context.syncRows, context.parityRows);
  if (!eligibility.eligible) return order;

  return {
    ...order,
    ...buildNativeTrackerOrderPatch(order, eligibility.nativeOrder, eligibility.task),
  };
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

    const parsedBody = await readJsonBody(req);
    if (!parsedBody.ok) {
      return Response.json({ success: false, error: 'malformed_json', error_code: 'malformed_json' }, { status: 400 });
    }
    const body = parsedBody.body;
    const {
      order_number,
      order_id,
      stripe_payment_intent_id,
      stripe_checkout_session_id,
      source = 'order_history', // 'order_history' | 'post_checkout' | 'notification' | 'account'
    } = body;

    const debugPath = [];

    // ── 1. Resolve all identity emails for this customer ──────────────────────
    const resolvedEmails = new Set([user.email]);
    const resolvedProfiles = [];
    const seenProfileIds = new Set();
    const rememberProfile = (profile) => {
      if (!profile) return;
      const key = normalizeText(profile.id) || JSON.stringify(profile);
      if (seenProfileIds.has(key)) return;
      seenProfileIds.add(key);
      resolvedProfiles.push(profile);
    };

    // Forward lookup: find profiles that share contact_email with this user's email
    const [primaryProfiles, contactProfiles] = await Promise.all([
      base44.asServiceRole.entities.UserProfile.filter({ customer_email: user.email }, null, 10),
      base44.asServiceRole.entities.UserProfile.filter({ contact_email: user.email }, null, 10),
    ]);

    for (const p of [...primaryProfiles, ...contactProfiles]) {
      rememberProfile(p);
      if (p.customer_email) resolvedEmails.add(p.customer_email);
      if (p.contact_email) resolvedEmails.add(p.contact_email);
    }

    // Reverse: if we found aliases, look up their profiles too
    for (const email of [...resolvedEmails]) {
      const aliases = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: email }, null, 10);
      for (const a of aliases) {
        rememberProfile(a);
        if (a.customer_email) resolvedEmails.add(a.customer_email);
      }
    }

    const emailList = [...resolvedEmails];
    const normalizedEmailList = new Set(emailList.map(normalizeEmail).filter(Boolean));
    const normalizedPhoneList = new Set(resolvedProfiles.map(profile => normalizePhone(profile?.phone)).filter(Boolean));
    const orderBelongsToCustomer = (candidate) => {
      if (!candidate) return false;
      const emailMatches = normalizedEmailList.has(normalizeEmail(candidate.customer_email));
      const phone = normalizePhone(candidate.customer_phone || candidate.contact_phone);
      return emailMatches || Boolean(phone && normalizedPhoneList.has(phone));
    };
    debugPath.push(`resolved_identity_count: ${emailList.length}`);

    // ── 2. Multi-path order lookup (CA Order entity) ──────────────────────────
    let order = null;
    let lookupSource = null;

    // Priority 1: by order_number (most reliable for customer-facing links)
    if (!order && order_number) {
      debugPath.push('trying: CA Order by order_number');
      const rows = await base44.asServiceRole.entities.Order.filter({ order_number }, null, 1).catch(() => []);
      if (rows[0]) { order = rows[0]; lookupSource = 'ca_order_by_number'; }
    }

    // Priority 2: by order_id (entity primary key) — only if it looks like a real entity ID (not an order number)
    if (!order && order_id && !order_id.startsWith('NV-') && !order_id.startsWith('nv-')) {
      debugPath.push('trying: CA Order by order_id');
      const rows = await base44.asServiceRole.entities.Order.filter({ id: order_id }, null, 1).catch(() => []);
      if (rows[0]) { order = rows[0]; lookupSource = 'ca_order_by_id'; }
    }

    // If order_id looks like an order number, treat it as one
    if (!order && order_id && (order_id.startsWith('NV-') || order_id.startsWith('nv-'))) {
      debugPath.push('trying: CA Order by order_id-as-order_number');
      const rows = await base44.asServiceRole.entities.Order.filter({ order_number: order_id.toUpperCase() }, null, 1).catch(() => []);
      if (rows[0]) { order = rows[0]; lookupSource = 'ca_order_by_number_fallback'; }
    }

    // Priority 3: by stripe_payment_intent_id
    if (!order && stripe_payment_intent_id) {
      debugPath.push('trying: CA Order by stripe_payment_intent_id');
      const rows = await base44.asServiceRole.entities.Order.filter({ stripe_payment_intent_id }, null, 1);
      if (rows[0]) { order = rows[0]; lookupSource = 'ca_order_by_pi'; }
    }

    // Priority 4: by stripe_checkout_session_id
    if (!order && stripe_checkout_session_id) {
      debugPath.push('trying: CA Order by stripe_checkout_session_id');
      const rows = await base44.asServiceRole.entities.Order.filter({ stripe_checkout_session_id }, null, 1);
      if (rows[0]) { order = rows[0]; lookupSource = 'ca_order_by_session'; }
    }

    // ── 3. Security: verify order belongs to resolved identity ────────────────
    if (order && user.role !== 'admin') {
      if (!orderBelongsToCustomer(order)) {
        debugPath.push('SECURITY: order identity did not match — blocked');
        return Response.json({ found: false, error: 'Not authorized', debug_lookup_path: debugPath }, { status: 403 });
      }
    }

    // ── 4. Hub ShopifyOrder fallback ──────────────────────────────────────────
    let hubOrder = null;
    if (!order) {
      debugPath.push('CA Order not found — trying Hub ShopifyOrder fallback');
      const searchNum = normalizeOrderNumber(order_number || null);
      const searchId = order_id || null;

      const hubRows = await (async () => {
        if (searchNum) {
          const rows = await Promise.all([
            base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_number: searchNum }, null, 5),
            base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_number: `#${searchNum}` }, null, 5),
          ]);
          return uniqueRows(rows.flat());
        }
        if (searchId) return base44.asServiceRole.entities.ShopifyOrder.filter({ base44_order_id: searchId }, null, 5);
        return [];
      })();

      // Match hub order by identity
      for (const h of hubRows) {
        if (user.role === 'admin' || orderBelongsToCustomer(h)) {
          hubOrder = h;
          lookupSource = 'hub_shopify_order';
          debugPath.push('found: Hub ShopifyOrder');
          break;
        }
      }
    }

    // ── 5. FulfillmentTasks ───────────────────────────────────────────────────
    const resolvedOrderId = order?.id || hubOrder?.base44_order_id;
    const resolvedOrderNumber = order?.order_number || hubOrder?.shopify_order_number || order_number;

    let fulfillmentTasks = [];
    if (resolvedOrderId || resolvedOrderNumber) {
      const taskRows = await base44.asServiceRole.entities.FulfillmentTask.filter(
        resolvedOrderId ? { order_id: resolvedOrderId } : { order_id: 'NONE_USE_NUMBER' },
        '-created_date',
        10
      ).catch(() => []);
      fulfillmentTasks = taskRows;
      debugPath.push(`fulfillment_tasks: ${fulfillmentTasks.length}`);
    }

    // ── 6. OrderSyncLog (diagnostic only, not returned to customer) ──────────
    let syncLog = null;
    if (resolvedOrderNumber) {
      const logRows = await base44.asServiceRole.entities.OrderSyncLog.filter(
        { order_number: resolvedOrderNumber },
        '-created_date',
        1
      ).catch(() => []);
      syncLog = logRows[0] || null;
    }

    order = await applyLimitedNativeFirstTracker(base44, order);

    // ── 7. Not found ──────────────────────────────────────────────────────────
    if (!order && !hubOrder) {
      debugPath.push('not found in any source');

      // Determine if this could be a recent post_checkout sync pending
      const isRecentPostCheckout = source === 'post_checkout' && (stripe_payment_intent_id || stripe_checkout_session_id);

      return Response.json({
        found: false,
        is_recent_checkout_pending: isRecentPostCheckout,
        source_record: null,
        order: null,
        hub_order: null,
        fulfillment_tasks: [],
        resolved_identity_emails: emailList,
        debug_lookup_path: debugPath,
        sync_log: syncLog ? { status: syncLog.status, hub_action: syncLog.hub_action } : null,
      });
    }

    // ── 8. Build status timeline ──────────────────────────────────────────────
    const STATUS_LABELS = {
      order_received: 'Order Received',
      scheduled_for_juicing: 'Scheduled for Juicing',
      scheduled_for_production: 'Scheduled for Production',
      in_production: 'In Production',
      bottled_packed: 'Bottled & Packed',
      out_for_delivery: 'Out for Delivery',
      arriving_soon: 'Arriving Soon',
      delivered: 'Delivered',
      ready_for_pickup: 'Order Ready',
      picked_up: 'Order Complete',
      cancelled: 'Cancelled',
      refunded: 'Refunded',
      failed: 'Payment Failed',
      pending_payment: 'Pending Payment',
    };

    const TERMINAL_STATUSES = ['delivered', 'picked_up', 'cancelled', 'refunded', 'failed'];

    const orderStatus = order?.status || customerStatusForHubOrder(hubOrder) || 'unknown';
    const isTerminal = TERMINAL_STATUSES.includes(orderStatus);

    const statusTimeline = (order?.status_history || []).map(h => ({
      status: h.status,
      label: STATUS_LABELS[h.status] || h.status,
      timestamp: h.timestamp,
      message: h.message,
    }));

    // ── 9. Delivery status summary ────────────────────────────────────────────
    const deliveryStatus = {
      status: orderStatus,
      label: STATUS_LABELS[orderStatus] || orderStatus,
      delivered_at: order?.delivered_at || hubOrder?.delivered_at || null,
      delivery_photo_url: order?.delivery_photo_url || hubOrder?.delivery_photo_url || null,
      delivery_drop_location: order?.delivery_drop_location || hubOrder?.delivery_drop_location || null,
      assigned_delivery_date: order?.assigned_delivery_date || order?.estimated_delivery_date || hubOrder?.assigned_delivery_date || hubOrder?.requested_delivery_date || null,
      delivery_window_label: order?.delivery_window_label || hubOrder?.delivery_window_label || hubOrder?.requested_time_window || null,
    };

    // ── 10. Customer-visible status ───────────────────────────────────────────
    const customerVisibleStatus = (() => {
      if (orderStatus === 'delivered') return 'Delivered ✓';
      if (orderStatus === 'picked_up') return 'Order Complete ✓';
      if (orderStatus === 'cancelled') return 'Cancelled';
      if (orderStatus === 'refunded') return 'Refunded';
      if (orderStatus === 'failed') return 'Payment Failed';
      if (orderStatus === 'out_for_delivery') return 'Out for Delivery';
      if (orderStatus === 'arriving_soon') return 'Arriving Soon';
      if (orderStatus === 'in_production') return 'In Production';
      if (orderStatus === 'bottled_packed') return 'Bottled & Packed';
      if (orderStatus === 'scheduled_for_juicing') return 'Scheduled for Juicing';
      if (orderStatus === 'scheduled_for_production') return 'Scheduled for Production';
      return STATUS_LABELS[orderStatus] || 'Processing';
    })();

    return Response.json({
      found: true,
      source_record: lookupSource,
      order: order || null,
      hub_order: sanitizeHubOrderForCustomer(hubOrder),
      fulfillment_tasks: fulfillmentTasks,
      status_timeline: statusTimeline,
      delivery_status: deliveryStatus,
      customer_visible_status: customerVisibleStatus,
      is_terminal: isTerminal,
      is_recent_checkout_pending: false,
      resolved_identity_emails: emailList,
      debug_lookup_path: debugPath,
    });

  } catch (error) {
    console.error('getCustomerOrderDetail error:', error.message);
    // Return structured not-found instead of crashing — frontend isError check triggers for 5xx only
    return Response.json({
      found: false,
      is_recent_checkout_pending: false,
      reason: 'ORDER_LOOKUP_ERROR',
      error: error.message,
      source_record: null,
      order: null,
      hub_order: null,
      fulfillment_tasks: [],
    }, { status: 200 });
  }
});
