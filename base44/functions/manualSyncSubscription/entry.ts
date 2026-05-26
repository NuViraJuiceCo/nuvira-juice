import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

/**
 * Admin function: manually look up and sync a Stripe subscription to the Subscription entity.
 * Useful for recovering missing subscription records.
 * Payload: { customer_email: string }
 */
Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_LEGACY_PAYMENT_SUBSCRIPTION_TOOLS') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'legacy_payment_subscription_tools_disabled',
        message: 'Legacy payment/subscription tools are disabled for May 30 launch freeze.',
      }, { status: 409 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.warn('⚠️ AUDIT: Admin invoked manualSyncSubscription — This syncs Stripe subscriptions to local database');

    const { customer_email } = await req.json();
    if (!customer_email) {
      return Response.json({ error: 'customer_email required' }, { status: 400 });
    }

    console.log(`Looking up Stripe subscriptions for ${customer_email}`);

    // Find all Stripe subscriptions for this customer
    const subscriptions = await stripe.subscriptions.list({
      customer: customer_email,
      limit: 100,
    });

    console.log(`Found ${subscriptions.data.length} Stripe subscriptions for ${customer_email}`);

    if (subscriptions.data.length === 0) {
      return Response.json({
        error: 'No Stripe subscriptions found',
        customer_email,
        stripeSubscriptions: [],
      });
    }

    const results = { synced: [], skipped: [], errors: [] };

    // Check each subscription and sync if missing from database
    for (const stripeSub of subscriptions.data) {
      try {
        const planId = stripeSub.metadata?.plan_id;
        const bundleId = stripeSub.metadata?.bundle_id || null;
        const deliveryAddress = stripeSub.metadata?.delivery_address || '';

        if (!planId) {
          results.skipped.push({
            stripeSubId: stripeSub.id,
            reason: 'No plan_id in metadata',
          });
          continue;
        }

        // Check if subscription already exists in database
        const existing = await base44.asServiceRole.entities.Subscription.filter({
          customer_email,
          plan_id: planId,
        });

        if (existing.length > 0) {
          results.skipped.push({
            stripeSubId: stripeSub.id,
            dbSubId: existing[0].id,
            reason: 'Already in database',
          });
          continue;
        }

        // Create the subscription record
        const now = new Date();
        let nextDelivery = new Date(now);
        const allPlans = await base44.asServiceRole.entities.SubscriptionPlan.list();
        const plan = allPlans.find(p => p.id === planId);

        if (plan?.frequency === 'weekly') {
          nextDelivery.setDate(now.getDate() + 7);
        } else {
          nextDelivery.setMonth(now.getMonth() + 1);
        }

        const subscription = await base44.asServiceRole.entities.Subscription.create({
          customer_email,
          plan_id: planId,
          bundle_id: bundleId,
          delivery_address: deliveryAddress,
          status: stripeSub.status === 'active' ? 'active' : 'paused',
          started_date: new Date(stripeSub.created * 1000).toISOString().split('T')[0],
          next_delivery_date: nextDelivery.toISOString().split('T')[0],
        });

        results.synced.push({
          stripeSubId: stripeSub.id,
          dbSubId: subscription.id,
          planId,
          status: stripeSub.status,
        });

        console.log(`Synced Stripe subscription ${stripeSub.id} → database ${subscription.id}`);
      } catch (err) {
        results.errors.push({
          stripeSubId: stripeSub.id,
          error: err.message,
        });
        console.error(`Failed to sync ${stripeSub.id}:`, err.message);
      }
    }

    return Response.json({
      success: results.errors.length === 0,
      customer_email,
      results,
    });
  } catch (error) {
    console.error('Manual sync subscription error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
