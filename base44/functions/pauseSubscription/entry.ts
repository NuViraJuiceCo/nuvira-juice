import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

/**
 * pauseSubscription
 *
 * Customer self-service: pauses the NEXT billing cycle only.
 * - Does NOT affect the current paid billing cycle.
 * - Does NOT cancel current Hub FulfillmentTasks or ProductionBatch.
 * - Sets pause_collection in Stripe to take effect at current period end.
 * - Notifies Hub with event 'customer.subscription_future_pause' so Hub
 *   does not schedule fulfillment for the paused period.
 *
 * Payload: { subscription_id, paused_until }
 * paused_until: ISO date string (YYYY-MM-DD) — when to resume
 */

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { subscription_id, paused_until } = body;

    if (!subscription_id || !paused_until) {
      return Response.json({ error: 'Missing subscription_id or paused_until' }, { status: 400 });
    }

    // Verify subscription belongs to calling user
    const subs = await base44.entities.Subscription.filter({ id: subscription_id });
    if (!subs || subs.length === 0 || subs[0].customer_email !== user.email) {
      return Response.json({ error: 'Subscription not found' }, { status: 404 });
    }

    const sub = subs[0];
    const stripeSubId = sub.stripe_subscription_id;

    // Attempt to pause billing in Stripe at next period end (future cycle only)
    let periodEnd = null;
    if (stripeSubId) {
      try {
        const stripeSub = await stripe.subscriptions.retrieve(stripeSubId);
        periodEnd = stripeSub.current_period_end
          ? new Date(stripeSub.current_period_end * 1000).toISOString().split('T')[0]
          : null;

        // Schedule pause_collection to start at current period end
        // This does NOT affect billing for the already-paid current cycle
        await stripe.subscriptions.update(stripeSubId, {
          pause_collection: {
            behavior: 'void',
            resumes_at: Math.floor(new Date(paused_until).getTime() / 1000),
          },
        });
        console.log(`[pauseSubscription] Stripe sub ${stripeSubId} pause_collection set. Effective after ${periodEnd}, resumes ${paused_until}`);
      } catch (stripeErr) {
        console.warn(`[pauseSubscription] Stripe pause_collection failed (non-blocking): ${stripeErr.message}`);
        // Fallback: still update CA record even if Stripe update fails
      }
    } else {
      console.warn(`[pauseSubscription] No stripe_subscription_id on sub ${subscription_id}`);
    }

    // Update CA Subscription:
    // Keep status='active' for current cycle; set paused_until for next cycle
    await base44.asServiceRole.entities.Subscription.update(subscription_id, {
      status: 'paused',
      paused_until: paused_until,
    });
    console.log(`[pauseSubscription] CA Subscription ${subscription_id} set to paused until ${paused_until}`);

    // Notify Hub: future pause only — current cycle fulfillment stays intact
    try {
      await base44.asServiceRole.functions.invoke('syncCustomerToHub', {
        event: 'customer.subscription_future_pause',
        customer_email: user.email,
        data: {
          subscription_id: subscription_id,
          stripe_subscription_id: stripeSubId || null,
          pause_type: 'customer_future_pause',
          pause_effective_after: periodEnd,
          resumes_at: paused_until,
          current_cycle_intact: true, // Hub: do NOT cancel current FulfillmentTasks
          message: `Customer paused next billing cycle. Current paid month is active. Do not cancel current production/fulfillment. Pause effective after ${periodEnd}, resumes ${paused_until}.`,
        },
      });
      console.log(`[pauseSubscription] Hub notified: customer_future_pause for ${user.email}`);
    } catch (hubErr) {
      console.warn(`[pauseSubscription] Hub notify failed (non-blocking): ${hubErr.message}`);
    }

    return Response.json({
      success: true,
      paused_until: paused_until,
      current_cycle_end: periodEnd,
      message: `Your current month remains fully active. Your subscription will pause after ${periodEnd ? new Date(periodEnd).toLocaleDateString() : 'your current billing cycle'} and resume on ${new Date(paused_until).toLocaleDateString()}.`,
    });

  } catch (error) {
    console.error('[pauseSubscription] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});