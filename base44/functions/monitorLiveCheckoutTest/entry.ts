import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SAFE_ORDER_NUMBER_RE = /^[A-Z0-9_-]{3,80}$/;

function normalizeText(value) {
  return (value ?? '').toString().replace(/\s+/g, ' ').trim();
}

function normalizeOrderNumber(value) {
  const orderNumber = normalizeText(value).toUpperCase();
  if (!orderNumber) throw new Error('order_number is required');
  if (!SAFE_ORDER_NUMBER_RE.test(orderNumber)) {
    throw new Error('order_number contains unsupported characters');
  }
  return orderNumber;
}

function safeString(value, maxLength = 160) {
  const text = normalizeText(value);
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function safeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function safeBoolean(value) {
  return value === true;
}

function isFakeStripeId(value) {
  const text = normalizeText(value).toLowerCase();
  if (!text) return false;
  return text.includes('fake') || text.includes('test_fake') || text.includes('placeholder');
}

function redactProviderId(value) {
  const text = normalizeText(value);
  if (!text) return null;
  if (text.length <= 12) return '[redacted id]';
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function addressComplete(order) {
  if (!order) return false;
  if (normalizeText(order.fulfillment_type).toLowerCase() === 'pickup') return true;
  return Boolean(
    normalizeText(order.address_line1) &&
    normalizeText(order.address_city) &&
    normalizeText(order.address_state) &&
    normalizeText(order.address_postal_code)
  );
}

function statusLabel(pass, passLabel, failLabel) {
  return `${pass ? 'PASS' : 'FAIL'} - ${pass ? passLabel : failLabel}`;
}

function sanitizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 20).map(item => ({
    title: safeString(item?.title, 120),
    quantity: safeNumber(item?.quantity) ?? 0,
    price: safeNumber(item?.price),
  }));
}

function sanitizeSyncLog(log) {
  return {
    status: safeString(log?.status, 40),
    created_at: safeString(log?.created_date || log?.completed_at || log?.sync_timestamp, 80),
    triggered_by: safeString(log?.triggered_by || log?.sync_source, 80),
    description: safeString(log?.description || log?.reason || log?.error || log?.error_code, 300),
    hub_action: safeString(log?.hub_action || log?.action, 80),
    hub_order_id: safeString(log?.hub_order_id || log?.matched_hub_order_id, 120),
  };
}

function sortByCreatedDesc(records) {
  return [...records].sort((a, b) => {
    const aTime = new Date(a?.created_date || a?.completed_at || 0).getTime();
    const bTime = new Date(b?.created_date || b?.completed_at || 0).getTime();
    return bTime - aTime;
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

    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const body = await req.json().catch(() => ({}));
    let orderNumber;

    try {
      orderNumber = normalizeOrderNumber(body.order_number);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const [orders, checkoutSessions, syncLogs] = await Promise.all([
      base44.asServiceRole.entities.Order.filter({ order_number: orderNumber }).catch(() => []),
      base44.asServiceRole.entities.CheckoutSession.filter({ order_number: orderNumber }).catch(() => []),
      base44.asServiceRole.entities.OrderSyncLog.filter({ order_number: orderNumber }).catch(() => []),
    ]);

    const sortedOrders = sortByCreatedDesc(orders);
    const order = sortedOrders[0] || null;
    const sortedSessions = sortByCreatedDesc(checkoutSessions);
    const checkoutSession = sortedSessions[0] || null;
    const sortedSyncLogs = sortByCreatedDesc(syncLogs);
    const lastSyncLog = sortedSyncLogs[0] || null;
    const emailOrders = order?.customer_email
      ? await base44.asServiceRole.entities.Order.filter({ customer_email: order.customer_email }).catch(() => [])
      : [];

    const paymentCaptured = safeBoolean(order?.payment_captured) || normalizeText(order?.payment_status).toLowerCase() === 'paid';
    const paymentStatusPaid = normalizeText(order?.payment_status).toLowerCase() === 'paid';
    const isAddressComplete = addressComplete(order);
    const fakeIdsDetected = isFakeStripeId(order?.stripe_checkout_session_id || checkoutSession?.stripe_session_id) ||
      isFakeStripeId(order?.stripe_payment_intent_id || checkoutSession?.checkout_data?.payment_intent);
    const duplicateSafe = sortedOrders.length === 1;
    const lastSyncStatus = normalizeText(lastSyncLog?.status).toLowerCase();
    const hubSyncOk = ['success', 'deduped'].includes(lastSyncStatus);

    const failures = [];
    if (!order) failures.push('Order was not found in Customer App.');
    if (order && !paymentCaptured) failures.push('Payment is not captured.');
    if (order && !paymentStatusPaid) failures.push(`payment_status is ${order.payment_status || 'missing'}.`);
    if (order && !isAddressComplete) failures.push('Delivery address is incomplete.');
    if (fakeIdsDetected) failures.push('Stripe identifier looks fake or placeholder.');
    if (!duplicateSafe) failures.push(`Found ${sortedOrders.length} Customer App orders with this order number.`);
    if (order && !hubSyncOk) failures.push('No successful or deduped Hub sync log was found.');

    const checks = {
      order_number: orderNumber,
      order_exists_in_customer_app: Boolean(order),
      order_count_for_number: sortedOrders.length,
      customer_name: safeString(order?.customer_name, 120),
      customer_email: safeString(order?.customer_email, 160),
      status: safeString(order?.status, 80),
      payment_status: safeString(order?.payment_status, 80),
      payment_captured: paymentCaptured,
      subtotal: safeNumber(order?.subtotal),
      delivery_fee: safeNumber(order?.delivery_fee),
      total: safeNumber(order?.total),
      fulfillment_type: safeString(order?.fulfillment_type, 80),
      estimated_delivery_date: safeString(order?.estimated_delivery_date || order?.assigned_delivery_date, 40),
      is_preorder: safeBoolean(order?.is_preorder),
      order_created_time: safeString(order?.created_date, 80),
      stripe_session_stored_at: safeString(checkoutSession?.created_date, 80),
      checkout_session_id: redactProviderId(order?.stripe_checkout_session_id || checkoutSession?.stripe_session_id),
      payment_intent_id: redactProviderId(order?.stripe_payment_intent_id || checkoutSession?.checkout_data?.payment_intent),
      fake_ids_detected: fakeIdsDetected,
      address_complete: isAddressComplete,
      address_fields: {
        address_line1: safeString(order?.address_line1, 160),
        address_city: safeString(order?.address_city, 80),
        address_state: safeString(order?.address_state, 40),
        address_postal_code: safeString(order?.address_postal_code, 40),
      },
      items: sanitizeItems(order?.items),
      sync_logs: sortedSyncLogs.slice(0, 10).map(sanitizeSyncLog),
      last_sync_status: lastSyncStatus || null,
      total_orders_for_email: emailOrders.length,
      email_orders: sortByCreatedDesc(emailOrders).slice(0, 10).map(emailOrder => ({
        order_number: safeString(emailOrder?.order_number, 80),
        total: safeNumber(emailOrder?.total),
        created_date: safeString(emailOrder?.created_date, 80),
      })),
      payment_status_check: statusLabel(Boolean(order) && paymentCaptured && paymentStatusPaid, 'paid/captured', 'not paid or not captured'),
      address_check: statusLabel(Boolean(order) && isAddressComplete, 'complete or pickup', 'incomplete'),
      stripe_id_check: statusLabel(!fakeIdsDetected, 'real-looking IDs', 'fake/placeholder ID detected'),
      duplicate_check: statusLabel(duplicateSafe, 'single order number', 'duplicate order number'),
      hub_sync_check: statusLabel(Boolean(order) && hubSyncOk, 'Hub sync success/dedupe', 'Hub sync not confirmed'),
    };

    return Response.json({
      success: true,
      read_only: true,
      captured_at: new Date().toISOString(),
      checks,
      verdict: {
        result: failures.length === 0 ? 'PASS' : 'FAIL',
        message: failures.length === 0
          ? 'Order chain is visible and Hub sync is confirmed.'
          : `${failures.length} checkout/order chain issue(s) found.`,
        failures,
      },
    });
  } catch (error) {
    console.error('[monitorLiveCheckoutTest] Error:', error.message);
    return Response.json({ error: 'Unable to monitor live checkout chain' }, { status: 500 });
  }
});
