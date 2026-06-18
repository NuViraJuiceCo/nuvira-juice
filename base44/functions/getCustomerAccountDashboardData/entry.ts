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

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const authEmail = user.email;
    console.log(`[getCustomerAccountDashboardData] Loading dashboard for auth_email=${authEmail}`);

    // ── STEP 1: Resolve all identity emails via service role ──────────────────
    const identities = new Set([authEmail]);

    // Forward lookup: profile where customer_email = authEmail
    const fwdProfiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: authEmail });
    const fwdProfile = fwdProfiles[0] || null;
    if (fwdProfile?.contact_email) identities.add(fwdProfile.contact_email);
    if (fwdProfile?.customer_email) identities.add(fwdProfile.customer_email);

    // Reverse lookup: profile where contact_email = authEmail (Apple relay case)
    const revProfiles = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: authEmail });
    for (const p of revProfiles) {
      if (p.customer_email) identities.add(p.customer_email);
      if (p.contact_email) identities.add(p.contact_email);
    }

    // Secondary forward lookups for any newly found emails
    for (const email of [...identities]) {
      if (email !== authEmail) {
        const extraProfiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: email });
        if (extraProfiles[0]?.contact_email) identities.add(extraProfiles[0].contact_email);
        const revExtra = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: email });
        for (const p of revExtra) {
          if (p.customer_email) identities.add(p.customer_email);
          if (p.contact_email) identities.add(p.contact_email);
        }
      }
    }

    const identityList = [...identities];
    console.log(`[getCustomerAccountDashboardData] Resolved identities: ${JSON.stringify(identityList)}`);

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
        if (profiles[0]) { customerProfile = profiles[0]; break; }
      }
    }

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

    console.log(`[getCustomerAccountDashboardData] allOrders=${allOrders.length} validOrders=${validOrders.length} allOrdersForHistory=${allOrdersForHistory.length}`);
    console.log(`[getCustomerAccountDashboardData] order details: ${JSON.stringify(allOrders.map(o => ({ num: o.order_number, id: o.id, status: o.status, payment_status: o.payment_status, captured: o.payment_captured, pi: o.stripe_payment_intent_id?.slice(0,12) })))}`);

    // ── STEP 5: Load credits across all identities ────────────────────────────
    let creditRecord = null;
    for (const email of identityList) {
      const credits = await base44.asServiceRole.entities.NuViraCredit.filter({ customer_email: email });
      if (credits[0]) { creditRecord = credits[0]; break; }
    }

    // ── STEP 6: Load loyalty points across all identities ─────────────────────
    let pointsRecord = null;
    for (const email of identityList) {
      const pts = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: email });
      if (pts[0]) { pointsRecord = pts[0]; break; }
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

    console.log(`[getCustomerAccountDashboardData] Done. identities=${identityList.length} subs=${allSubs.length} active_subs=${activeSubs.length} orders=${validOrders.length} credits=${creditRecord?.balance || 0} pts=${pointsRecord?.total_points || 0}`);

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
      orders: validOrders,
      all_orders_raw: allOrdersForHistory,
      order_count: validOrders.length,

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
        orders_found: validOrders.length,
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
});
