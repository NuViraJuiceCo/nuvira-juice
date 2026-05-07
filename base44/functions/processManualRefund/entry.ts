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
    const base44 = createClientFromRequest(req);
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

    // Restore loyalty points if full refund
    if (isFull && order.customer_email) {
      const pointsToRestore = Math.floor(order.total * 10);
      const existing = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: order.customer_email });
      
      if (existing.length > 0) {
        const entry = {
          amount: pointsToRestore,
          type: 'adjustment',
          description: `Points restored due to manual refund of order ${order_number}`,
          timestamp: new Date().toISOString(),
        };
        await base44.asServiceRole.entities.UserPoints.update(existing[0].id, {
          total_points: (existing[0].total_points || 0) + pointsToRestore,
          lifetime_points: (existing[0].lifetime_points || 0) + pointsToRestore,
          points_history: [...(existing[0].points_history || []), entry],
        });
        console.log(`[processManualRefund] Restored ${pointsToRestore} points to ${order.customer_email}`);
      }
    }

    // Sync to Hub with refund event
    try {
      const syncResult = await base44.asServiceRole.functions.invoke('syncOrderToHub', {
        order_id: order.id,
        stripe_session: {
          payment_status: 'refunded',
          id: stripe_refund_id || 'manual_refund',
          refund_amount: effectiveRefundAmount,
          is_full_refund: isFull,
        },
        triggered_by: 'manual_refund_process',
      });
      console.log(`[processManualRefund] ✅ Hub sync result:`, syncResult);
    } catch (syncErr) {
      console.error(`[processManualRefund] ❌ Hub sync failed: ${syncErr.message}`);
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
      description: `💰 MANUAL REFUND: $${effectiveRefundAmount} (${isFull ? 'FULL' : 'PARTIAL'}). Order updated in Customer App. Hub sync attempted. Points ${isFull ? 'restored' : 'not restored (partial)'}.`,
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
      points_restored: isFull,
    });

  } catch (error) {
    console.error('[processManualRefund] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});