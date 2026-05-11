import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
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

    // Forward lookup: find profiles that share contact_email with this user's email
    const [primaryProfiles, contactProfiles] = await Promise.all([
      base44.asServiceRole.entities.UserProfile.filter({ customer_email: user.email }, null, 10),
      base44.asServiceRole.entities.UserProfile.filter({ contact_email: user.email }, null, 10),
    ]);

    for (const p of [...primaryProfiles, ...contactProfiles]) {
      if (p.customer_email) resolvedEmails.add(p.customer_email);
      if (p.contact_email) resolvedEmails.add(p.contact_email);
    }

    // Reverse: if we found aliases, look up their profiles too
    for (const email of [...resolvedEmails]) {
      const aliases = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: email }, null, 10);
      for (const a of aliases) {
        if (a.customer_email) resolvedEmails.add(a.customer_email);
      }
    }

    const emailList = [...resolvedEmails];
    debugPath.push(`resolved_emails: ${emailList.join(', ')}`);

    // ── 2. Multi-path order lookup (CA Order entity) ──────────────────────────
    let order = null;
    let lookupSource = null;

    // Priority 1: by order_id (entity primary key)
    if (!order && order_id) {
      debugPath.push('trying: CA Order by order_id');
      const rows = await base44.asServiceRole.entities.Order.filter({ id: order_id }, null, 1);
      if (rows[0]) { order = rows[0]; lookupSource = 'ca_order_by_id'; }
    }

    // Priority 2: by order_number
    if (!order && order_number) {
      debugPath.push('trying: CA Order by order_number');
      const rows = await base44.asServiceRole.entities.Order.filter({ order_number }, null, 1);
      if (rows[0]) { order = rows[0]; lookupSource = 'ca_order_by_number'; }
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
      const orderEmail = order.customer_email;
      if (!emailList.includes(orderEmail)) {
        debugPath.push('SECURITY: order email not in resolved identity — blocked');
        return Response.json({ found: false, error: 'Not authorized', debug_lookup_path: debugPath }, { status: 403 });
      }
    }

    // ── 4. Hub ShopifyOrder fallback ──────────────────────────────────────────
    let hubOrder = null;
    if (!order) {
      debugPath.push('CA Order not found — trying Hub ShopifyOrder fallback');
      const searchNum = order_number || null;
      const searchId = order_id || null;

      const hubRows = await (async () => {
        if (searchNum) return base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_number: searchNum }, null, 5);
        if (searchId) return base44.asServiceRole.entities.ShopifyOrder.filter({ base44_order_id: searchId }, null, 5);
        return [];
      })();

      // Match hub order by identity
      for (const h of hubRows) {
        if (user.role === 'admin' || emailList.includes(h.customer_email)) {
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
      ready_for_pickup: 'Ready for Pickup',
      picked_up: 'Picked Up',
      cancelled: 'Cancelled',
      refunded: 'Refunded',
      failed: 'Payment Failed',
      pending_payment: 'Pending Payment',
    };

    const TERMINAL_STATUSES = ['delivered', 'picked_up', 'cancelled', 'refunded', 'failed'];

    const orderStatus = order?.status || hubOrder?.production_status || 'unknown';
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
      delivered_at: order?.delivered_at || null,
      delivery_photo_url: order?.delivery_photo_url || null,
      delivery_drop_location: order?.delivery_drop_location || null,
      assigned_delivery_date: order?.assigned_delivery_date || order?.estimated_delivery_date || null,
      delivery_window_label: order?.delivery_window_label || null,
    };

    // ── 10. Customer-visible status ───────────────────────────────────────────
    const customerVisibleStatus = (() => {
      if (orderStatus === 'delivered') return 'Delivered ✓';
      if (orderStatus === 'picked_up') return 'Picked Up ✓';
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
      hub_order: hubOrder || null,
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
    console.error('getCustomerOrderDetail error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});