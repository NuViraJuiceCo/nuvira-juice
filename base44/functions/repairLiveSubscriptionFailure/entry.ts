import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

/**
 * Emergency repair function for the live subscription that failed to create
 * a Customer App Subscription record after successful payment.
 * 
 * Uses Stripe data as source of truth to reconstruct the subscription lifecycle.
 */
Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_LEGACY_REPAIR_TOOLS') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'legacy_repair_tools_disabled',
        message: 'Legacy repair tools are disabled for May 30 launch freeze.',
      });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (user.role !== 'admin') {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }

    const { stripe_subscription_id, stripe_customer_id, stripe_invoice_id } = await req.json();

    if (!stripe_subscription_id) {
      return Response.json({ error: 'stripe_subscription_id is required' }, { status: 400 });
    }

    console.log(`[REPAIR] Starting repair for subscription ${stripe_subscription_id}`);

    // Fetch Stripe subscription details
    const stripeSubData = await stripe.subscriptions.retrieve(stripe_subscription_id, {
      expand: ['customer', 'latest_invoice.payment_intent', 'items.data.price.product'],
    });

    const customerEmail = stripeSubData.customer?.email || (typeof stripeSubData.customer === 'string' ? stripeSubData.customer : null);
    if (!customerEmail) {
      return Response.json({ error: 'Could not resolve customer email from Stripe subscription' }, { status: 400 });
    }

    console.log(`[REPAIR] Stripe subscription: ${stripe_subscription_id} for ${customerEmail}, status: ${stripeSubData.status}`);

    // Get the latest invoice for amount_paid
    const invoice = stripeSubData.latest_invoice || (stripe_invoice_id ? await stripe.invoices.retrieve(stripe_invoice_id) : null);
    const amountPaidCents = invoice?.amount_paid || stripeSubData.items.data[0]?.price?.unit_amount || 0;
    const amountPaid = amountPaidCents / 100;

    console.log(`[REPAIR] Amount paid: $${amountPaid}, Invoice status: ${invoice?.status}`);

    // Resolve plan from Stripe price
    let planId = null;
    let planName = 'Unknown Plan';
    let planFrequency = 'monthly';
    let productsArray = [];

    if (stripeSubData.items.data.length > 0) {
      const priceId = stripeSubData.items.data[0].price.id;
      planName = stripeSubData.items.data[0].price.product?.name || 'Subscription Plan';

      // Look up plan by Stripe price ID
      const plansMatching = await base44.asServiceRole.entities.SubscriptionPlan.filter({ stripe_price_id: priceId });
      if (plansMatching.length > 0) {
        planId = plansMatching[0].id;
        planName = plansMatching[0].name;
        planFrequency = plansMatching[0].frequency || 'monthly';
        if (plansMatching[0].composition_template?.bottles_per_delivery) {
          productsArray = plansMatching[0].composition_template.bottles_per_delivery.map(bottle => ({
            product_name: bottle.flavor || 'Juice',
            quantity: bottle.quantity || 1,
          }));
        }
      } else {
        console.warn(`[REPAIR] No SubscriptionPlan found for Stripe price ${priceId}, using generic plan`);
      }
    }

    // Fetch customer profile for details
    const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: customerEmail });
    const profile = profiles[0] || {};

    // Calculate next delivery date
    const now = new Date();
    let nextDelivery = new Date(now);
    if (planFrequency === 'weekly') {
      nextDelivery.setDate(now.getDate() + 7);
    } else {
      nextDelivery.setMonth(now.getMonth() + 1);
    }
    const nextDeliveryStr = nextDelivery.toISOString().split('T')[0];
    const startedDateStr = new Date(stripeSubData.created * 1000).toISOString().split('T')[0];

    // Check if subscription already exists
    const existing = await base44.asServiceRole.entities.Subscription.filter({ customer_email: customerEmail });
    const alreadyExists = existing.some(s => s.plan_id === planId && s.status === 'active');

    if (alreadyExists) {
      console.log(`[REPAIR] Subscription already exists for ${customerEmail}, skipping creation`);
      return Response.json({
        success: false,
        message: 'Subscription record already exists',
        stripe_subscription_id,
        customer_email: customerEmail,
      });
    }

    // Fetch a default delivery zone (zone 3 / 15 miles)
    const zones = await base44.asServiceRole.entities.DeliveryZone.filter({ is_active: true });
    const defaultZone = zones.find(z => z.max_miles >= 15) || zones[zones.length - 1] || {};
    
    // Fetch a default bundle (The Trio / Mix 3)
    const bundles = await base44.asServiceRole.entities.SubscriptionBundle.list();
    const defaultBundle = bundles[0] || {};

    // Create the Subscription record using Stripe data as source of truth
    const subscription = await base44.asServiceRole.entities.Subscription.create({
      customer_email: customerEmail,
      plan_id: planId,
      bundle_id: defaultBundle.id || '',
      delivery_zone_id: defaultZone.id || '',
      delivery_address: `${profile.address || ''}`,
      status: 'active',
      started_date: startedDateStr,
      next_delivery_date: nextDeliveryStr,
    });

    console.log(`[REPAIR] ✅ Subscription record created: ${subscription.id}`);

    // Award loyalty points: 10 per $1 spent
    const pointsToAward = Math.floor(amountPaid * 10);
    const pointsEntry = {
      amount: pointsToAward,
      type: 'earned',
      description: `Subscription payment of $${amountPaid.toFixed(2)} (recovery from webhook failure)`,
      timestamp: new Date().toISOString(),
    };

    const existingPoints = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: customerEmail });
    if (existingPoints.length > 0) {
      await base44.asServiceRole.entities.UserPoints.update(existingPoints[0].id, {
        total_points: (existingPoints[0].total_points || 0) + pointsToAward,
        lifetime_points: (existingPoints[0].lifetime_points || 0) + pointsToAward,
        points_history: [...(existingPoints[0].points_history || []), pointsEntry],
      });
    } else {
      await base44.asServiceRole.entities.UserPoints.create({
        customer_email: customerEmail,
        total_points: pointsToAward,
        lifetime_points: pointsToAward,
        redeemed_points: 0,
        points_history: [pointsEntry],
      });
    }

    console.log(`[REPAIR] ✅ Awarded ${pointsToAward} loyalty points to ${customerEmail}`);

    // Sync to Hub with customer.subscription_created
    const resolvedCustomerName = profile.first_name + ' ' + profile.last_name || customerEmail;
    const resolvedPhone = profile.phone || '';

    await base44.asServiceRole.functions.invoke('syncCustomerToHub', {
      event: 'customer.subscription_created',
      customer_email: customerEmail,
      data: {
        subscription_id: subscription.id,
        customer_name: resolvedCustomerName,
        phone: resolvedPhone,
        stripe_subscription_id: stripe_subscription_id,
        stripe_customer_id: stripeSubData.customer?.id || null,
        customer_app_subscription_id: subscription.id,
        payment_status: 'paid',
        financial_status: 'paid',
        first_invoice_id: invoice?.id || null,
        payment_intent_id: invoice?.payment_intent?.id || null,
        plan_id: planId,
        plan_name: planName,
        cadence: planFrequency,
        first_delivery_date: nextDeliveryStr,
        delivery_window_label: '5 PM – 8 PM',
        delivery_window_start: '17:00',
        delivery_window_end: '20:00',
        delivery_address: profile.address || '',
        address_line1: profile.address?.split(',')[0]?.trim() || '',
        address_city: '',
        address_state: '',
        address_postal_code: '',
        address_country: 'US',
        products: productsArray,
        subscription_started_date: startedDateStr,
        next_delivery_date: nextDeliveryStr,
      },
    }).catch(err => {
      console.error(`[REPAIR] Hub sync failed: ${err.message}`);
      throw err;
    });

    console.log(`[REPAIR] ✅ Synced customer.subscription_created to Hub`);

    return Response.json({
      success: true,
      message: 'Subscription repaired successfully',
      stripe_subscription_id,
      customer_email: customerEmail,
      app_subscription_id: subscription.id,
      loyalty_points_awarded: pointsToAward,
      hub_sync_attempted: true,
    });

  } catch (error) {
    console.error('[REPAIR] Error:', error.message);
    return Response.json({ error: error.message, success: false }, { status: 500 });
  }
});
