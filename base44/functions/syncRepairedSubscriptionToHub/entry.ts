import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Syncs an already-repaired Subscription record to Hub without re-creating it locally.
 * Used when Subscription exists but Hub sync failed.
 * 
 * Payload: { subscription_id }
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
    const { subscription_id } = await req.json();

    if (!subscription_id) {
      return Response.json({ error: 'Missing subscription_id' }, { status: 400 });
    }

    console.log(`[SyncReparedSubToHub] Starting sync for subscription ${subscription_id}`);

    // Fetch the existing Subscription record
    const subs = await base44.asServiceRole.entities.Subscription.filter({ id: subscription_id });
    if (subs.length === 0) {
      return Response.json({ error: `Subscription ${subscription_id} not found` }, { status: 404 });
    }

    const subscription = subs[0];
    const customerEmail = subscription.customer_email;
    const planId = subscription.plan_id;

    console.log(`[SyncReparedSubToHub] Subscription: ${customerEmail}, plan: ${planId}`);

    // Fetch plan details
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({ id: planId });
    const plan = plans[0];
    if (!plan) {
      return Response.json({ error: `Plan ${planId} not found` }, { status: 404 });
    }

    // Fetch customer profile
    const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: customerEmail });
    const profile = profiles[0] || {};
    const customerName = profile.first_name && profile.last_name ? `${profile.first_name} ${profile.last_name}` : customerEmail;
    const phone = profile.phone || '';

    // Fetch Stripe subscription for payment info
    const Stripe = (await import('npm:stripe@14.21.0')).default;
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
    const invoices = await stripe.invoices.list({ subscription: subscription.stripe_subscription_id, limit: 1 });
    const latestInvoice = invoices.data[0];

    // Products from plan
    const products = plan.composition_template?.bottles_per_delivery?.map(bottle => ({
      product_name: bottle.flavor || 'Juice',
      quantity: bottle.quantity || 1,
    })) || [];

    // Fetch delivery zone
    const zones = await base44.asServiceRole.entities.DeliveryZone.filter({ id: subscription.delivery_zone_id });
    const zone = zones[0];

    // Build Hub payload
    const hubPayload = {
      event: 'customer.subscription_created',
      source: 'customer_app',
      customer_email: customerEmail,
      data: {
        subscription_id: subscription.id,
        customer_name: customerName,
        phone: phone,
        stripe_subscription_id: subscription.stripe_subscription_id,
        stripe_customer_id: typeof stripeSubscription.customer === 'string' ? stripeSubscription.customer : stripeSubscription.customer?.id,
        customer_app_subscription_id: subscription.id,
        payment_status: 'paid',
        financial_status: 'paid',
        first_invoice_id: latestInvoice?.id || null,
        plan_id: planId,
        plan_name: plan.name,
        cadence: plan.frequency,
        production_date: subscription.started_date, // Use started_date as production reference
        first_delivery_date: subscription.started_date,
        next_delivery_date: subscription.next_delivery_date,
        delivery_window_label: '5 PM – 8 PM',
        delivery_window_start: '17:00',
        delivery_window_end: '20:00',
        delivery_address: subscription.delivery_address,
        address_line1: '',
        address_city: '',
        address_state: '',
        address_postal_code: '',
        address_country: 'US',
        products: products,
        subscription_started_date: subscription.started_date,
        delivery_zone_id: subscription.delivery_zone_id,
      },
      synced_at: new Date().toISOString(),
    };

    console.log(`[SyncReparedSubToHub] Payload ready, invoking syncCustomerToHub`);
    console.log(`[SyncReparedSubToHub] Hub event: customer.subscription_created`);
    console.log(`[SyncReparedSubToHub] Data keys: ${Object.keys(hubPayload.data).join(', ')}`);

    // Invoke syncCustomerToHub to send to Hub
    try {
      const syncResult = await base44.asServiceRole.functions.invoke('syncCustomerToHub', {
        event: 'customer.subscription_created',
        customer_email: customerEmail,
        data: hubPayload.data,
      });
      console.log(`[SyncReparedSubToHub] ✅ Hub sync result:`, syncResult);

      // Mark Subscription as synced
      await base44.asServiceRole.entities.Subscription.update(subscription.id, {
        hub_sync_status: 'synced',
        hub_synced_at: new Date().toISOString(),
      });

      return Response.json({
        success: true,
        subscription_id: subscription.id,
        customer_email: customerEmail,
        message: 'Repaired subscription synced to Hub',
        hub_response: syncResult,
      });
    } catch (syncErr) {
      console.error(`[SyncReparedSubToHub] Hub sync failed: ${syncErr.message}`);

      // Mark sync as failed
      await base44.asServiceRole.entities.Subscription.update(subscription.id, {
        hub_sync_status: 'failed',
        hub_sync_error: syncErr.message,
        hub_sync_error_at: new Date().toISOString(),
      });

      return Response.json({
        success: false,
        error: `Hub sync failed: ${syncErr.message}`,
        subscription_id: subscription.id,
      }, { status: 500 });
    }

  } catch (error) {
    console.error('[SyncReparedSubToHub] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
