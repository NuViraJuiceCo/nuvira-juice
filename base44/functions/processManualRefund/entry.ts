// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import {
  CUSTOMER_ORDER_ADJUSTMENT_ACTIONS,
  handleCustomerOrderAdjustmentRequest,
} from './customerOrderAdjustment.ts';

const FULL_ORDER_REFUND_ACTIONS = new Set(['preview_full_order_refund', 'execute_full_order_refund']);
const FULL_ORDER_REFUND_CONFIRMATION = 'refund_exact_paid_order';

function safeRefundId(value: unknown, maxLength = 180) {
  const normalized = String(value ?? '').trim();
  return normalized.length <= maxLength && /^[A-Za-z0-9._:@/-]+$/.test(normalized) ? normalized : '';
}

/**
 * Manually processes a refund for an order that was refunded in Stripe
 * but did not propagate to Customer App production or fulfillment records.
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
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }

    let body = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'malformed_json' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'malformed_json' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (CUSTOMER_ORDER_ADJUSTMENT_ACTIONS.has(String(body.action || '').trim())) {
      try {
        const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
        const stripeClient = stripeKey ? new Stripe(stripeKey, { apiVersion: '2023-10-16' }) : null;
        return await handleCustomerOrderAdjustmentRequest({ base44, body, caller: user, stripeClient });
      } catch (error) {
        console.error('[processManualRefund] Customer order-adjustment request failed', error instanceof Error ? error.name : 'unknown_error');
        return Response.json({ error: 'customer_order_adjustment_failed' }, { status: 500 });
      }
    }

    let providerRefundResult = null;
    const requestedAction = String(body.action || '').trim().toLowerCase();
    if (FULL_ORDER_REFUND_ACTIONS.has(requestedAction)) {
      if (!user || !['admin', 'owner'].includes(String(user.role || '').trim().toLowerCase())) {
        return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
      }

      const orderNumber = safeRefundId(body.order_number, 80).replace(/^#/, '');
      const expectedOrderId = safeRefundId(body.expected_order_id, 180);
      const requestId = safeRefundId(body.request_id, 180);
      if (!orderNumber || !expectedOrderId || !requestId) {
        return Response.json({ error: 'order_number, expected_order_id, and request_id are required' }, { status: 400 });
      }

      const orders = await base44.asServiceRole.entities.Order.filter({ order_number: orderNumber }, '-created_date', 2);
      if (orders.length !== 1 || orders[0]?.id !== expectedOrderId) {
        return Response.json({ error: 'exact_order_identity_mismatch' }, { status: 409 });
      }

      const refundOrder = orders[0];
      const amount = Math.round(Number(refundOrder.total || 0) * 100) / 100;
      const paymentIntentId = safeRefundId(refundOrder.stripe_payment_intent_id, 180);
      const paymentStatus = String(refundOrder.payment_status || '').trim().toLowerCase();
      const orderStatus = String(refundOrder.status || '').trim().toLowerCase();
      const subscriptionLike = Boolean(refundOrder.stripe_subscription_id) || String(refundOrder.order_type || '').trim().toLowerCase().includes('subscription');
      const blockers = [];
      if (!['paid', 'succeeded', 'complete'].includes(paymentStatus) || refundOrder.payment_captured !== true) blockers.push('order_payment_not_captured');
      if (['refunded', 'cancelled', 'canceled'].includes(orderStatus)) blockers.push('order_already_terminal');
      if (!paymentIntentId || !paymentIntentId.startsWith('pi_')) blockers.push('stripe_payment_intent_missing');
      if (!Number.isFinite(amount) || amount <= 0) blockers.push('refund_amount_invalid');
      if (subscriptionLike) blockers.push('subscription_order_not_supported');

      if (requestedAction === 'preview_full_order_refund') {
        return Response.json({
          success: true,
          dry_run: true,
          order_number: orderNumber,
          order_id: refundOrder.id,
          refund_amount: amount,
          currency: String(refundOrder.currency || 'usd').trim().toLowerCase(),
          eligible: blockers.length === 0,
          blockers,
          projected_writes: blockers.length === 0 ? [
            'Stripe.Refund',
            'Order.refund_status',
            'LoyaltyTransaction.reversal',
            'UserPoints.projection',
            'LoyaltyMember.projection',
            'CustomerApp.operational_refund_projection',
            'OrderSyncLog.audit',
          ] : [],
          provider_calls_performed: false,
          writes_performed: false,
        });
      }

      if (String(body.confirmation || '').trim() !== FULL_ORDER_REFUND_CONFIRMATION) {
        return Response.json({ error: 'confirmation phrase is required' }, { status: 400 });
      }
      if (blockers.length > 0) {
        return Response.json({ success: false, error: 'full_order_refund_preflight_blocked', blockers }, { status: 409 });
      }

      const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
      if (!stripeKey) return Response.json({ error: 'refund_service_unavailable' }, { status: 503 });
      const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
      const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        reason: 'requested_by_customer',
        metadata: {
          operation: 'exact_full_order_refund',
          order_number: orderNumber,
          request_id: requestId,
        },
      }, {
        idempotencyKey: `exact-full-order-refund:${refundOrder.id}:${requestId}`,
      });

      providerRefundResult = {
        id: safeRefundId(refund?.id, 180),
        status: String(refund?.status || '').trim().toLowerCase(),
        amount: Number(refund?.amount || 0) / 100,
        currency: String(refund?.currency || refundOrder.currency || 'usd').trim().toLowerCase(),
      };
      if (providerRefundResult.status !== 'succeeded') {
        return Response.json({
          success: false,
          pending: providerRefundResult.status === 'pending',
          error: providerRefundResult.status === 'pending' ? 'refund_processing' : 'refund_provider_failed',
          provider_refund: providerRefundResult,
          writes_performed: false,
        }, { status: providerRefundResult.status === 'pending' ? 202 : 502 });
      }

      body = {
        order_number: orderNumber,
        refund_amount: providerRefundResult.amount,
        is_full_refund: true,
        stripe_refund_id: providerRefundResult.id,
      };
    }

    if (!providerRefundResult && Deno.env.get('ENABLE_ADMIN_MANUAL_REFUNDS') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'admin_manual_refunds_disabled',
        message: 'Admin manual refunds are disabled by the current operational safety gate.',
      }, { status: 409 });
    }

    // Admin-only: this is a sensitive repair tool that processes refunds
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { order_number, refund_amount, is_full_refund = true, stripe_refund_id } = body;

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

    const refundTimestamp = new Date().toISOString();
    const refundReference = stripe_refund_id || `manual_refund_${order.id}_${refundTimestamp}`;
    await base44.asServiceRole.entities.Order.update(order.id, {
      status: isFull ? 'refunded' : order.status,
      payment_status: isFull ? 'refunded' : order.payment_status,
      financial_status: isFull ? 'refunded' : order.financial_status,
      payment_captured: isFull ? false : order.payment_captured,
      refund_status: isFull ? 'fully_refunded' : 'partially_refunded',
      refund_type: isFull ? 'full' : 'partial',
      refund_amount: effectiveRefundAmount,
      refund_currency: String(order.currency || 'usd').trim().toLowerCase(),
      refunded_at: refundTimestamp,
      refund_source: 'admin',
      refund_event_id: refundReference,
      stripe_refund_id: stripe_refund_id || null,
      refund_reason: 'Admin-authorized order refund.',
      refund_review_required: false,
      refund_review_status: 'resolved',
      do_not_recover: isFull,
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
        internal_secret: Deno.env.get('LOYALTY_LEDGER_SECRET') || Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || '',
      });
      const loyaltyResult = loyaltyResponse?.data || loyaltyResponse;
      if (loyaltyResult?.success !== true) throw new Error(loyaltyResult?.error || 'manual_refund_loyalty_transaction_failed');
      console.log(`[processManualRefund] Reversed ${pointsToReverse} points for ${order.customer_email}`);
    }

    // Project the refund into Customer App operational entities through the
    // retained compatibility entry point.
    try {
      const syncResponse = await base44.asServiceRole.functions.fetch('/syncRefundToHub', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-secret': Deno.env.get('HUB_SYNC_SECRET') || Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || '',
        },
        body: JSON.stringify({
          order_id: order.id,
          stripe_session: { id: stripe_refund_id || 'manual_refund' },
          triggered_by: 'manual_refund_process',
        }),
      });
      const syncResult = await syncResponse.json().catch(() => ({}));
      if (!syncResponse.ok) throw new Error(syncResult?.error || `syncRefundToHub_http_${syncResponse.status}`);
      if (syncResult?.success) {
        console.log(`[processManualRefund] ✅ Native refund projection succeeded`);
      } else {
        console.log(`[processManualRefund] ⚠️ Native refund projection returned:`, syncResult);
      }
    } catch (syncErr) {
      console.error(`[processManualRefund] ❌ Native refund projection failed: ${syncErr.message}`);
      await base44.asServiceRole.entities.OrderSyncLog.create({
        order_number: order_number,
        status: 'error',
        description: `Manual refund native operational projection failed: ${syncErr.message}. Review Customer App order and task state.`,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        triggered_by: 'manual_refund_process',
      });
    }

    // Service-role entity writes do not consistently emit the customer-facing
    // status automation. Send through the canonical transactional pipeline;
    // its refund marker makes this idempotent with any automation replay.
    let customerCommunication: any = null;
    try {
      const communicationResponse = await base44.asServiceRole.functions.invoke('sendOrderStatusNotification', {
        order_id: order.id,
        new_status: 'refunded',
        event_id: refundReference,
        refund_amount: effectiveRefundAmount,
      });
      customerCommunication = communicationResponse?.data || communicationResponse || null;
    } catch (communicationError) {
      customerCommunication = {
        success: false,
        error: communicationError instanceof Error ? communicationError.message : String(communicationError),
      };
      await base44.asServiceRole.entities.OrderSyncLog.create({
        order_number,
        status: 'error',
        description: `Refund completed, but the customer refund communication requires retry: ${customerCommunication.error}`,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        triggered_by: 'manual_refund_process',
      });
    }

    // Create audit log
    await base44.asServiceRole.entities.OrderSyncLog.create({
      order_number: order_number,
      status: 'success',
      hub_action: 'native_manual_refund_processed',
      description: `MANUAL REFUND: $${effectiveRefundAmount} (${isFull ? 'FULL' : 'PARTIAL'}). Order and native operational projection processed in Customer App. Earned points ${isFull ? 'reversed' : 'not changed for partial refund'}.`,
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
      hub_sync_attempted: false,
      native_operational_projection_attempted: true,
      points_reversed: isFull,
      provider_refund: providerRefundResult,
      customer_communication: customerCommunication,
    });

  } catch (error) {
    console.error('[processManualRefund] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
