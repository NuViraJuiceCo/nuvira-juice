import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ADMIN FUNCTION: Detect Customer App orders that are paid but not yet synced to Hub.
 * Runs on-demand or scheduled; creates OrderSyncLog entries for visibility.
 * 
 * SLA THRESHOLDS:
 * - Normal: Order reaches Hub within 2 minutes ✅
 * - Delayed: Order in Customer App but not Hub after 5 minutes ⚠️
 * - Stuck: Order in Customer App but not Hub after 10 minutes 🚨
 * 
 * (These thresholds are RECOMMENDED; adjust based on Hub team confirmation)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Admin-only function
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const now = new Date();
    const NORMAL_WINDOW_MS = 2 * 60 * 1000;     // 2 minutes
    const DELAYED_WINDOW_MS = 5 * 60 * 1000;    // 5 minutes
    const STUCK_WINDOW_MS = 10 * 60 * 1000;     // 10 minutes

    // Step 1: Fetch all paid orders from Customer App (order_received or later status)
    const allOrders = await base44.asServiceRole.entities.Order.list('-created_date', 200);
    const paidOrders = allOrders.filter(o => o.payment_captured || o.is_preorder);

    console.log(`[StuckOrders] Checking ${paidOrders.length} paid orders for Hub sync status...`);

    // Step 2: Fetch orders from Hub (via syncOrdersFromHub or direct Hub query)
    // For now, use the Hub API call available to us
    const HUB_API_URL = Deno.env.get('HUB_API_URL');
    const HUB_SYNC_SECRET = Deno.env.get('HUB_SYNC_SECRET');

    let hubOrderNumbers = new Set();
    if (HUB_API_URL && HUB_SYNC_SECRET) {
      try {
        const hubUrl = HUB_API_URL.replace(/\/$/, '') + '/getOrderUpdatesForSync';
        const hubRes = await fetch(hubUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${HUB_SYNC_SECRET}`,
          },
          body: JSON.stringify({ since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }),
        });

        if (hubRes.ok) {
          const hubData = await hubRes.json();
          hubOrderNumbers = new Set(
            (hubData.orders || []).map(o => (o.shopify_order_number || o.order_number || '').replace('#', ''))
          );
          console.log(`[StuckOrders] Hub has ${hubOrderNumbers.size} orders from last 24h`);
        } else {
          console.warn(`[StuckOrders] Hub query failed: ${hubRes.status}, proceeding with empty set`);
        }
      } catch (hubErr) {
        console.warn(`[StuckOrders] Hub fetch error: ${hubErr.message}, proceeding with empty set`);
      }
    }

    // Step 3: Classify orders by sync status
    const normal = [];
    const delayed = [];
    const stuck = [];

    for (const order of paidOrders) {
      const ageMs = now.getTime() - new Date(order.created_date).getTime();
      const inHub = hubOrderNumbers.has(order.order_number);

      if (inHub) {
        // Order reached Hub, status is normal
        normal.push({
          order_number: order.order_number,
          customer_email: order.customer_email,
          created_date: order.created_date,
          age_ms: ageMs,
          status: 'synced_to_hub',
        });
      } else if (ageMs <= DELAYED_WINDOW_MS) {
        // Within normal window, not synced yet (expected)
        normal.push({
          order_number: order.order_number,
          customer_email: order.customer_email,
          created_date: order.created_date,
          age_ms: ageMs,
          status: 'in_sync_window',
        });
      } else if (ageMs <= STUCK_WINDOW_MS) {
        // Beyond normal window, delayed
        delayed.push({
          order_number: order.order_number,
          customer_email: order.customer_email,
          customer_name: order.customer_name,
          created_date: order.created_date,
          age_minutes: Math.round(ageMs / 60000),
          stripe_session_id: order.stripe_checkout_session_id,
          total: order.total,
          delivery_date: order.estimated_delivery_date,
        });
      } else {
        // Beyond stuck window, stuck
        stuck.push({
          order_number: order.order_number,
          customer_email: order.customer_email,
          customer_name: order.customer_name,
          created_date: order.created_date,
          age_minutes: Math.round(ageMs / 60000),
          stripe_session_id: order.stripe_checkout_session_id,
          total: order.total,
          delivery_date: order.estimated_delivery_date,
        });
      }
    }

    // Step 4: Log stuck orders to OrderSyncLog for audit trail
    for (const order of stuck) {
      try {
        await base44.asServiceRole.entities.OrderSyncLog.create({
          order_number: order.order_number,
          status: 'error',
          description: `Order stuck in Customer App: paid but not synced to Hub after ${order.age_minutes} minutes. Last sync attempt: pending. Manual recovery may be required.`,
          started_at: order.created_date,
          completed_at: new Date().toISOString(),
          triggered_by: 'cron_poll',
        });
      } catch (logErr) {
        console.warn(`Failed to log stuck order ${order.order_number}: ${logErr.message}`);
      }
    }

    // Step 5: Log delayed orders (monitoring, not critical)
    for (const order of delayed) {
      try {
        await base44.asServiceRole.entities.OrderSyncLog.create({
          order_number: order.order_number,
          status: 'pending',
          description: `Order delayed: paid but not yet synced to Hub after ${order.age_minutes} minutes. Watching for Hub sync...`,
          started_at: order.created_date,
          completed_at: new Date().toISOString(),
          triggered_by: 'cron_poll',
        });
      } catch (logErr) {
        console.warn(`Failed to log delayed order ${order.order_number}: ${logErr.message}`);
      }
    }

    console.log(
      `[StuckOrders] Summary: ${normal.length} normal, ${delayed.length} delayed, ${stuck.length} stuck`
    );

    return Response.json({
      success: true,
      checked_at: now.toISOString(),
      windows: {
        normal_minutes: 2,
        delayed_minutes: 5,
        stuck_minutes: 10,
      },
      results: {
        normal_count: normal.length,
        delayed_count: delayed.length,
        stuck_count: stuck.length,
      },
      delayed_orders: delayed,
      stuck_orders: stuck,
      message: stuck.length > 0
        ? `🚨 ${stuck.length} orders are stuck. Review OrderSyncLog and initiate manual recovery if needed.`
        : delayed.length > 0
        ? `⚠️ ${delayed.length} orders are delayed but within normal sync window. Monitor.`
        : `✅ All paid orders are syncing normally.`,
    });
  } catch (error) {
    console.error('[StuckOrders] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});