import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Manually processes a refund for an order that was refunded in Stripe
 * but didn't propagate to Customer App, Hub, Production, or Fulfillment.
 * 
 * This is a repair function for the refund flow gap identified on 2026-05-07.
 * 
 * Usage:
 *   base44.functions.invoke('processManualRefund', {
 *     order_number: 'NV-MOVOAMIF',
 *     refund_amount: 74.99,
 *     is_full_refund: true,
 *     stripe_refund_id: 're_xxxxx',
 *   });
 */
Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_ADMIN_MANUAL_REFUNDS') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'admin_manual_refunds_disabled',
        message: 'Admin manual refunds are disabled by the current operational safety gate.',
      }, { status: 409 });
    }

    const base44 = createClientFromRequest(req);

    // Admin-only: this is a sensitive repair tool that processes refunds
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { order_number, refund_amount, is_full_refund = true, stripe_refund_id } = await req.json();

    if (!order_number) {
      return Response.json({ error: 'order_number is required' }, { status: 400 });
    }

    console.log(`[processManualRefund] Starting manual refund for ${order_number}`);

    // Find the order
    const orders = await base44.asServiceRole.entities.Order.filter({ order_number });
    if (orders.length === 0) {
      return Response.json({ error: `Order ${order_number} not found` }, { status: 404 });
    }

    const order = orders[0];
    console.log(`[processManualRefund] Found order ${order.id}, status=${order.status}, payment_status=${order.payment_status}`);

    // Check if already refunded
    if (order.payment_status === 'refunded' || order.status === 'refunded' || order.status === 'cancelled') {
      return Response.json({ 
        error: 'Order already refunded or cancelled',
        action: 'already_refunded',
        current_status: order.status
      }, { status: 400 });
    }

    const effectiveRefundAmount = refund_amount || order.total;
    const isFull = is_full_refund || (effectiveRefundAmount >= order.total);

    // Update Customer App Order
    const statusHistory = [...(order.status_history || []), {
      status: 'refunded',
      timestamp: new Date().toISOString(),
      message: `Manual refund processed: $${effectiveRefundAmount} (${isFull ? 'FULL' : 'PARTIAL'}). ${stripe_refund_id ? 'Refund ID: ' + stripe_refund_id : ''}`,
    }];

    await base44.asServiceRole.entities.Order.update(order.id, {
      status: 'refunded',
      payment_status: 'refunded',
      financial_status: 'refunded',
      payment_captured: false,
      refunded_at: new Date().toISOString(),
      refund_id: stripe_refund_id || 'manual_refund_' + new Date().toISOString(),
      refund_amount: effectiveRefundAmount,
      is_partial_refund: !isFull,
      sync_status: 'refund_pending_hub_sync',
      status_history: statusHistory,
    });

    console.log(`[processManualRefund] Order ${order_number} updated to refunded status`);

    // Reverse points earned on the refunded purchase. A refund must never
    // create additional available or lifetime points.
    if (isFull && order.customer_email) {
      const pointsToReverse = Math.floor(Number(effectiveRefundAmount || 0) * 10);
      const loyaltyResponse = await base44.asServiceRole.functions.invoke('enrollNewCustomerInLoyalty', {
        action: 'post',
        customer_email: order.customer_email,
        amount: -pointsToReverse,
        transaction_type: 'reversal',
        idempotency_key: `manual_refund:${stripe_refund_id || order.id}:${order.id}:reversal`,
        description: `Manual refund of order ${order_number}`,
        source_type: 'manual_refund',
        source_id: stripe_refund_id || order.id,
        order_id: order.id,
        order_number,
        metadata: { refund_amount: effectiveRefundAmount, full_refund: true },
      }, { headers: { 'x-internal-secret': Deno.env.get('LOYALTY_LEDGER_SECRET') || Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || '' } });
      const loyaltyResult = loyaltyResponse?.data || loyaltyResponse;
      if (loyaltyResult?.success !== true) throw new Error(loyaltyResult?.error || 'manual_refund_loyalty_transaction_failed');
      console.log(`[processManualRefund] Reversed ${pointsToReverse} points for ${order.customer_email}`);
    }

    // Sync to Hub with refund event via shared helper
    try {
      const syncResult = await base44.asServiceRole.functions.invoke('syncRefundToHub', {
        order_id: order.id,
        stripe_session: { id: stripe_refund_id || 'manual_refund' },
        triggered_by: 'manual_refund_process',
      }, {
        headers: { 'x-internal-secret': Deno.env.get('HUB_SYNC_SECRET') || Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || '' },
      });
      if (syncResult?.success) {
        console.log(`[processManualRefund] ✅ Hub refund sync succeeded`);
      } else {
        console.log(`[processManualRefund] ⚠️ Hub refund sync returned:`, syncResult);
      }
    } catch (syncErr) {
      console.error(`[processManualRefund] ❌ Hub refund sync helper failed: ${syncErr.message}`);
      await base44.asServiceRole.entities.OrderSyncLog.create({
        order_number: order_number,
        status: 'error',
        description: `Manual refund Hub sync failed: ${syncErr.message}. Manual Hub update required.`,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        triggered_by: 'manual_refund_process',
      });
    }

    // Create audit log
    await base44.asServiceRole.entities.OrderSyncLog.create({
      order_number: order_number,
      status: 'success',
      hub_action: 'manual_refund_processed',
      description: `MANUAL REFUND: $${effectiveRefundAmount} (${isFull ? 'FULL' : 'PARTIAL'}). Order updated in Customer App. Hub sync attempted. Earned points ${isFull ? 'reversed' : 'not changed for partial refund'}.`,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      triggered_by: 'manual_refund_process',
    });

    return Response.json({
      success: true,
      order_number: order_number,
      order_id: order.id,
      refund_amount: effectiveRefundAmount,
      is_full_refund: isFull,
      action: isFull ? 'full_refund_processed' : 'partial_refund_manual_review',
      hub_sync_attempted: true,
      points_reversed: isFull,
    });

  } catch (error) {
    console.error('[processManualRefund] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
