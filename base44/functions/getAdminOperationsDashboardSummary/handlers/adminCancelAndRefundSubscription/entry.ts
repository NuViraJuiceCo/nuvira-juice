import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

/**
 * adminCancelAndRefundSubscription
 * Admin-only: immediately cancels a Stripe subscription and refunds the latest invoice.
 * Used for internal test overrides and admin-initiated full cancel+refund.
 * NOT the customer self-service cancellation path.
 */

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

export default async (req: Request) => {
  try {
    if (Deno.env.get('ENABLE_ADMIN_SUBSCRIPTION_CANCEL_REFUND') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'admin_subscription_cancel_refund_disabled',
        message: 'Admin subscription cancel/refund is disabled by the current operational safety gate.',
      }, { status: 409 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { stripe_subscription_id, reason } = await req.json();
    if (!stripe_subscription_id) {
      return Response.json({ error: 'stripe_subscription_id is required' }, { status: 400 });
    }

    console.log(`[adminCancelAndRefundSubscription] Starting cancel+refund for ${stripe_subscription_id}, reason: ${reason}`);

    // 1. Cancel the Stripe subscription immediately
    let cancelResult = null;
    try {
      cancelResult = await stripe.subscriptions.cancel(stripe_subscription_id);
      console.log(`[adminCancelAndRefundSubscription] Stripe sub ${stripe_subscription_id} cancelled. Status: ${cancelResult.status}`);
    } catch (err) {
      if (err.code === 'resource_missing' || err.statusCode === 404) {
        console.warn(`[adminCancelAndRefundSubscription] Stripe sub ${stripe_subscription_id} not found — may already be cancelled`);
        cancelResult = { status: 'already_cancelled_or_not_found' };
      } else {
        throw err;
      }
    }

    // 2. Find the latest paid invoice and refund the payment intent
    let refundResult = null;
    try {
      const invoices = await stripe.invoices.list({ subscription: stripe_subscription_id, limit: 5 });
      const paidInvoice = invoices.data.find(inv => inv.status === 'paid' && inv.amount_paid > 0);

      if (paidInvoice) {
        const paymentIntentId = typeof paidInvoice.payment_intent === 'string'
          ? paidInvoice.payment_intent
          : paidInvoice.payment_intent?.id;

        if (paymentIntentId) {
          refundResult = await stripe.refunds.create({
            payment_intent: paymentIntentId,
            reason: 'requested_by_customer',
            metadata: {
              reason: reason || 'admin_cancel_refund',
              base44_app_id: Deno.env.get('BASE44_APP_ID'),
            },
          });
          console.log(`[adminCancelAndRefundSubscription] Refund created: ${refundResult.id}, amount: $${refundResult.amount / 100}, status: ${refundResult.status}`);
        } else {
          console.warn(`[adminCancelAndRefundSubscription] No payment_intent on invoice ${paidInvoice.id}`);
        }
      } else {
        console.warn(`[adminCancelAndRefundSubscription] No paid invoice found for sub ${stripe_subscription_id}`);
        refundResult = { status: 'no_paid_invoice_found' };
      }
    } catch (refundErr) {
      console.error(`[adminCancelAndRefundSubscription] Refund failed: ${refundErr.message}`);
      refundResult = { status: 'failed', error: refundErr.message };
    }

    return Response.json({
      success: true,
      stripe_subscription_id,
      cancel_result: { status: cancelResult?.status },
      refund_result: refundResult ? {
        id: refundResult.id,
        amount: refundResult.amount ? refundResult.amount / 100 : null,
        status: refundResult.status,
        currency: refundResult.currency,
      } : null,
    });

  } catch (error) {
    console.error('[adminCancelAndRefundSubscription] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
};
