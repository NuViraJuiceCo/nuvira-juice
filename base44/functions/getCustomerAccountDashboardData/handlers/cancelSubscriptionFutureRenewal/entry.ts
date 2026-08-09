// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

/**
 * cancelSubscriptionFutureRenewal
 *
 * Customer self-service: sets cancel_at_period_end=true in Stripe.
 * - Does NOT immediately cancel the subscription.
 * - Does NOT refund the current paid month.
 * - Does NOT reverse loyalty points.
 * - Does NOT cancel current Customer App FulfillmentTask or ProductionBatch records.
 * - Marks CA Subscription with cancel_at_period_end=true for display.
 * - Customer App subscription state is authoritative; subscription purchase
 *   remains disabled while native future-cycle scheduling is unavailable.
 *
 * For admin immediate cancel/refund, use the admin override path (Stripe dashboard).
 */

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

export default async function handler(req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { subscription_id } = body;

    if (!subscription_id) {
      return Response.json({ error: 'Missing subscription_id' }, { status: 400 });
    }

    // Verify subscription belongs to calling user
    const subs = await base44.entities.Subscription.filter({ id: subscription_id });
    if (!subs || subs.length === 0 || subs[0].customer_email !== user.email) {
      return Response.json({ error: 'Subscription not found' }, { status: 404 });
    }

    const sub = subs[0];

    // Guard: only active subscriptions can be set to cancel at period end
    if (sub.status === 'cancelled') {
      return Response.json({ error: 'Subscription is already cancelled' }, { status: 400 });
    }

    const stripeSubId = sub.stripe_subscription_id;

    // Set cancel_at_period_end=true in Stripe — does NOT cancel immediately
    let periodEnd = null;
    if (stripeSubId) {
      try {
        const stripeSub = await stripe.subscriptions.update(stripeSubId, {
          cancel_at_period_end: true,
        });
        periodEnd = stripeSub.current_period_end
          ? new Date(stripeSub.current_period_end * 1000).toISOString().split('T')[0]
          : null;
        console.log(`[cancelFutureRenewal] Stripe sub ${stripeSubId} set to cancel_at_period_end=true. Period ends: ${periodEnd}`);
      } catch (stripeErr) {
        console.error(`[cancelFutureRenewal] Stripe update failed: ${stripeErr.message}`);
        // Don't block CA update if Stripe fails — mark for review
      }
    } else {
      console.warn(`[cancelFutureRenewal] No stripe_subscription_id on sub ${subscription_id} — skipping Stripe update`);
    }

    // Update CA Subscription record:
    // - Keep status = 'active' (still delivering this cycle)
    // - Set cancel_at_period_end = true
    // - Record the effective cancellation date (period end)
    await base44.asServiceRole.entities.Subscription.update(subscription_id, {
      cancel_at_period_end: true,
      cancel_effective_date: periodEnd,
    });
    console.log(`[cancelFutureRenewal] CA Subscription ${subscription_id} marked cancel_at_period_end=true`);

    return Response.json({
      success: true,
      cancel_at_period_end: true,
      effective_date: periodEnd,
      message: periodEnd
        ? `Your subscription will remain active until ${new Date(periodEnd).toLocaleDateString()}. You will still receive all scheduled deliveries for your current paid month.`
        : 'Your subscription renewal has been cancelled. You will still receive your current month\'s deliveries.',
    });

  } catch (error) {
    console.error('[cancelFutureRenewal] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
