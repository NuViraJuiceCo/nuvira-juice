import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * verifyOutForDeliveryNotification — Standing live test for out_for_delivery notification.
 *
 * Run this BEFORE and AFTER the Hub moves an order to assigned_for_delivery/In Transit.
 *
 * Steps:
 *   1. Call with { mode: "scan" }      → finds eligible active orders and their current state
 *   2. Call with { mode: "check", order_number: "NV-XXXXX" } → checks notification status for a specific order
 *   3. Call with { mode: "run_sync" }  → triggers syncHubDeliveryStatuses and reports what changed
 *   4. Call again with { mode: "check", order_number: "NV-XXXXX" } → confirms notification created, no duplicate
 *
 * Admin-only.
 */

const IDEMPOTENCY_KEY = (orderId, status) => `order_status_${orderId}_${status}`;

async function readJsonBody(req) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return { ok: true, body: {} };
  }

  const raw = await req.text();
  if (!raw.trim()) {
    return { ok: true, body: {} };
  }

  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, body: null };
  }
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
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const parsedBody = await readJsonBody(req);
    if (!parsedBody.ok) {
      return Response.json({ success: false, error: 'malformed_json', error_code: 'malformed_json' }, { status: 400 });
    }
    const body = parsedBody.body && typeof parsedBody.body === 'object' && !Array.isArray(parsedBody.body) ? parsedBody.body : {};
    const { mode = 'scan', order_number } = body;

    // ── MODE: scan — find all active non-terminal orders ─────────────────────
    if (mode === 'scan') {
      const TERMINAL = new Set(['delivered', 'picked_up', 'cancelled', 'refunded']);
      const allOrders = await base44.asServiceRole.entities.Order.list('-created_date', 200);
      const active = allOrders.filter(o =>
        o.payment_captured === true &&
        o.payment_status === 'paid' &&
        !TERMINAL.has(o.status) &&
        !o.is_test_order
      );

      const summary = active.map(o => ({
        order_number: o.order_number,
        customer_email: o.customer_email,
        status: o.status,
        assigned_delivery_date: o.assigned_delivery_date,
        order_id: o.id,
        idempotency_key_out_for_delivery: IDEMPOTENCY_KEY(o.id, 'out_for_delivery'),
      }));

      return Response.json({
        mode: 'scan',
        active_order_count: active.length,
        orders: summary,
        instructions: active.length === 0
          ? 'No active orders found. Wait for the next order cycle.'
          : 'Once Hub moves one of these to assigned_for_delivery, run mode=run_sync then mode=check with that order_number.',
      });
    }

    // ── MODE: check — inspect notification state for a specific order ─────────
    if (mode === 'check') {
      if (!order_number) return Response.json({ error: 'order_number required for mode=check' }, { status: 400 });

      const orders = await base44.asServiceRole.entities.Order.filter({ order_number });
      const order = orders[0];
      if (!order) return Response.json({ error: `Order ${order_number} not found` }, { status: 404 });

      const ikey_ofd = IDEMPOTENCY_KEY(order.id, 'out_for_delivery');
      const ikey_del = IDEMPOTENCY_KEY(order.id, 'delivered');

      // Check notifications for this order across the customer email
      const allNotifs = await base44.asServiceRole.entities.Notification.filter(
        { customer_email: order.customer_email },
        '-created_date',
        100
      );

      const ofdNotifs = allNotifs.filter(n => n.idempotency_key === ikey_ofd);
      const delNotifs = allNotifs.filter(n => n.idempotency_key === ikey_del);
      const allOrderNotifs = allNotifs.filter(n => n.order_id === order.id);

      return Response.json({
        mode: 'check',
        order_number: order.order_number,
        order_id: order.id,
        customer_email: order.customer_email,
        current_ca_status: order.status,
        status_history: order.status_history || [],
        out_for_delivery_notification: {
          idempotency_key: ikey_ofd,
          count: ofdNotifs.length,
          records: ofdNotifs.map(n => ({ id: n.id, created_date: n.created_date, is_read: n.is_read })),
          duplicate_risk: ofdNotifs.length > 1 ? '⚠️ DUPLICATE DETECTED' : ofdNotifs.length === 1 ? '✅ Exactly one' : '⏳ Not yet created',
        },
        delivered_notification: {
          idempotency_key: ikey_del,
          count: delNotifs.length,
          records: delNotifs.map(n => ({ id: n.id, created_date: n.created_date, is_read: n.is_read })),
          duplicate_risk: delNotifs.length > 1 ? '⚠️ DUPLICATE DETECTED' : delNotifs.length === 1 ? '✅ Exactly one' : '⏳ Not yet created',
        },
        all_notifications_for_order: allOrderNotifs.map(n => ({
          id: n.id,
          notification_subtype: n.notification_subtype,
          title: n.title,
          idempotency_key: n.idempotency_key,
          created_date: n.created_date,
        })),
      });
    }

    // ── MODE: run_sync — trigger syncHubDeliveryStatuses and report changes ───
    if (mode === 'run_sync') {
      if (Deno.env.get('ENABLE_OUT_FOR_DELIVERY_NOTIFICATION_RUN_SYNC') !== 'true') {
        return Response.json({
          success: true,
          skipped: true,
          mode: 'run_sync',
          reason: 'out_for_delivery_notification_run_sync_disabled',
          message: 'Out-for-delivery notification run_sync test is disabled for May 30 launch freeze.',
        });
      }

      console.log('[verifyOutForDeliveryNotification] Triggering syncHubDeliveryStatuses...');
      const syncResult = await base44.asServiceRole.functions.invoke('syncHubDeliveryStatuses', {});
      const syncData = syncResult?.data || syncResult || {};

      return Response.json({
        mode: 'run_sync',
        sync_result: syncData,
        instructions: syncData.updatedOrders?.length > 0
          ? `Status changes detected: ${JSON.stringify(syncData.updatedOrders)}. Now run mode=check with the order_number to verify notification.`
          : 'No status changes this run. Hub order may not be In Transit yet.',
      });
    }

    return Response.json({ error: `Unknown mode: ${mode}. Use scan | check | run_sync` }, { status: 400 });

  } catch (error) {
    console.error('[verifyOutForDeliveryNotification] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
