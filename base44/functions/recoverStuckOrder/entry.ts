import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ADMIN FUNCTION: Safe, idempotent recovery for stuck paid orders.
 * 
 * Process:
 * 1. Find the stuck order in Customer App
 * 2. Call syncOrderToHub with explicit error handling
 * 3. Log the recovery attempt
 * 4. If successful, order syncs via approved safeSyncOrderUpdate path
 * 5. If fails again, log for Hub team escalation
 * 
 * Idempotency: Multiple calls for same order are safe (Hub dedupes via stripe_checkout_session_id)
 */
Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_ADMIN_STUCK_ORDER_RECOVERY') !== 'true') {
      return Response.json({
        error: 'stuck_order_recovery_disabled',
        message: 'Manual stuck-order recovery is disabled during the May 30 launch freeze.',
      }, { status: 409 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Admin-only
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { order_number } = await req.json();

    if (!order_number) {
      return Response.json({ error: 'order_number required' }, { status: 400 });
    }

    const startTime = new Date().toISOString();

    // Find the order in Customer App
    const orders = await base44.asServiceRole.entities.Order.filter({ order_number });
    if (!orders.length) {
      return Response.json(
        { error: `Order ${order_number} not found in Customer App` },
        { status: 404 }
      );
    }

    const order = orders[0];

    // Verify it's paid (safety check)
    if (!order.payment_captured && !order.is_preorder) {
      return Response.json(
        { error: `Order ${order_number} is not marked as paid (payment_captured=false, is_preorder=false)` },
        { status: 400 }
      );
    }

    console.log(`[RecoveryAttempt] Attempting to sync stuck order ${order_number} (id: ${order.id})`);

    // Attempt sync via syncOrderToHub
    try {
      await base44.asServiceRole.functions.invoke('syncOrderToHub', { order_id: order.id });
      console.log(`[RecoveryAttempt] ✅ Successfully synced ${order_number} to Hub`);

      // Log successful recovery
      try {
        await base44.asServiceRole.entities.OrderSyncLog.create({
          order_number,
          status: 'recovery',
          description: `Manual recovery: successfully re-synced to Hub via Admin recovery function`,
          started_at: startTime,
          completed_at: new Date().toISOString(),
          triggered_by: 'manual',
        });
      } catch (logErr) {
        console.warn(`Failed to log successful recovery: ${logErr.message}`);
      }

      return Response.json({
        success: true,
        order_number,
        message: `Order ${order_number} successfully synced to Hub. It should appear in Production Planning within 2-5 seconds.`,
        order_details: {
          customer_email: order.customer_email,
          customer_name: order.customer_name,
          total: order.total,
          delivery_date: order.estimated_delivery_date,
          stripe_session_id: order.stripe_checkout_session_id,
        },
      });
    } catch (syncErr) {
      console.error(`[RecoveryAttempt] ❌ Sync failed: ${syncErr.message}`);

      // Log failed recovery for Hub team escalation
      try {
        await base44.asServiceRole.entities.OrderSyncLog.create({
          order_number,
          status: 'error',
          description: `Manual recovery attempt failed: ${syncErr.message}. Escalate to Hub team.`,
          started_at: startTime,
          completed_at: new Date().toISOString(),
          triggered_by: 'manual',
        });
      } catch (logErr) {
        console.warn(`Failed to log recovery failure: ${logErr.message}`);
      }

      return Response.json(
        {
          success: false,
          order_number,
          error: `Sync attempt failed: ${syncErr.message}`,
          message: `Recovery failed. Order details logged in OrderSyncLog. Escalate to Hub team with order_number: ${order_number}`,
          order_details: {
            customer_email: order.customer_email,
            customer_name: order.customer_name,
            total: order.total,
            delivery_date: order.estimated_delivery_date,
            stripe_session_id: order.stripe_checkout_session_id,
          },
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[RecoveryAttempt] Unexpected error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
