import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

/**
 * Repairs live subscription sub_1TUah0IrzYHaHkt24AVgUtNY
 * Creates missing Subscription record, awards loyalty, syncs to Hub with production_date/first_delivery_date
 */

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

function resolveSubscriptionFirstFulfillment(orderTimestamp) {
  const orderDate = new Date(orderTimestamp);
  const chicagoFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  const parts = chicagoFormatter.formatToParts(orderDate);
  const pm = {};
  parts.forEach(p => { pm[p.type] = p.value; });

  const chicagoDateTime = new Date(parseInt(pm.year), parseInt(pm.month) - 1, parseInt(pm.day), parseInt(pm.hour), parseInt(pm.minute));
  const dow = chicagoDateTime.getDay();
  const hour = parseInt(pm.hour);
  const cutoffHour = 14;

  let daysToNextProduction = 0;
  if (dow === 0) daysToNextProduction = 2;
  else if (dow === 1) daysToNextProduction = 1;
  else if (dow === 2) daysToNextProduction = hour < cutoffHour ? 0 : 3;
  else if (dow === 3) daysToNextProduction = 2;
  else if (dow === 4) daysToNextProduction = 1;
  else if (dow === 5) daysToNextProduction = hour < cutoffHour ? 0 : 1;
  else if (dow === 6) daysToNextProduction = hour < cutoffHour ? 0 : 3;

  const productionDate = new Date(chicagoDateTime);
  productionDate.setDate(productionDate.getDate() + daysToNextProduction);
  const productionDateStr = productionDate.toISOString().split('T')[0];

  const deliveryDate = new Date(productionDate);
  deliveryDate.setDate(deliveryDate.getDate() + 1);
  const firstDeliveryDateStr = deliveryDate.toISOString().split('T')[0];

  const nextDeliveryDate = new Date(deliveryDate);
  nextDeliveryDate.setMonth(nextDeliveryDate.getMonth() + 1);

  return {
    production_date: productionDateStr,
    first_delivery_date: firstDeliveryDateStr,
    next_delivery_date: nextDeliveryDate.toISOString().split('T')[0],
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { stripe_subscription_id = 'sub_1TUah0IrzYHaHkt24AVgUtNY' } = await req.json();

    console.log(`[RepairSubV2] Starting repair for subscription ${stripe_subscription_id}`);

    // Fetch Stripe subscription
    const stripeSubscription = await stripe.subscriptions.retrieve(stripe_subscription_id);
    console.log(`[RepairSubV2] Stripe subscription status: ${stripeSubscription.status}`);

    const customerEmail = stripeSubscription.metadata?.customer_email || stripeSubscription.customer_email;
    const stripeCustomerId = typeof stripeSubscription.customer === 'string' ? stripeSubscription.customer : stripeSubscription.customer?.id;

    if (!customerEmail) {
      return Response.json({ error: 'Could not determine customer email from subscription' }, { status: 400 });
    }

    console.log(`[RepairSubV2] Customer email: ${customerEmail}`);

    // Fetch latest invoice for payment info
    const invoices = await stripe.invoices.list({ subscription: stripe_subscription_id, limit: 1 });
    const latestInvoice = invoices.data[0];
    const amountPaid = latestInvoice?.amount_paid ? latestInvoice.amount_paid / 100 : stripeSubscription.current_period_end ? 144 : 0; // Default to plan amount

    console.log(`[RepairSubV2] Latest invoice: ${latestInvoice?.id}, amount_paid: $${amountPaid}`);

    // Get metadata from subscription
    const planId = stripeSubscription.metadata?.plan_id;
    const bundleId = stripeSubscription.metadata?.bundle_id || '69dff325e191695828ee96a6'; // Default to "The Trio"
    const deliveryAddress = stripeSubscription.metadata?.delivery_address || '';
    const customerName = stripeSubscription.metadata?.customer_name || '';

    if (!planId) {
      return Response.json({ error: 'Could not determine plan from subscription metadata' }, { status: 400 });
    }

    // Fetch plan
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({ id: planId });
    const plan = plans[0];

    if (!plan) {
      return Response.json({ error: `Plan ${planId} not found` }, { status: 404 });
    }

    // Calculate fulfillment dates from paid timestamp (invoice paid_at)
    const paidTimestamp = latestInvoice?.paid_at ? new Date(latestInvoice.paid_at * 1000).toISOString() : new Date().toISOString();
    const fulfillmentCalc = resolveSubscriptionFirstFulfillment(paidTimestamp);

    console.log(`[RepairSubV2] Fulfillment dates: production=${fulfillmentCalc.production_date}, first_delivery=${fulfillmentCalc.first_delivery_date}`);

    // Get default delivery zone
    const allZones = await base44.asServiceRole.entities.DeliveryZone.filter({ is_active: true });
    const defaultZone = allZones[0];

    // Check if Subscription already exists
    const existingSubs = await base44.asServiceRole.entities.Subscription.filter({ customer_email: customerEmail });
    const alreadyExists = existingSubs.some(s => s.stripe_subscription_id === stripe_subscription_id);

    if (alreadyExists) {
      return Response.json({
        success: true,
        message: 'Subscription already exists',
        subscription_id: existingSubs.find(s => s.stripe_subscription_id === stripe_subscription_id)?.id,
      });
    }

    // Create Subscription record
    const subscription = await base44.asServiceRole.entities.Subscription.create({
      customer_email: customerEmail,
      stripe_subscription_id: stripe_subscription_id,
      plan_id: planId,
      bundle_id: bundleId,
      delivery_zone_id: defaultZone?.id || null,
      delivery_address: deliveryAddress,
      status: 'active',
      started_date: fulfillmentCalc.first_delivery_date,
      next_delivery_date: fulfillmentCalc.next_delivery_date,
    });

    console.log(`[RepairSubV2] Created Subscription record: ${subscription.id}`);

    // Award loyalty points if not already awarded — idempotency by stripe_subscription_id
    const pointsToAward = Math.floor(amountPaid * 10);
    const stripeSubId = stripe_subscription_id;

    const pointsRecords = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: customerEmail });
    if (pointsRecords[0]) {
      // Check by subscription ID to prevent duplicate awards
      const alreadyAwarded = pointsRecords[0].points_history?.some(h => 
        h.description?.includes(`(subscription ${stripeSubId})`) ||
        h.description?.includes(`stripe_subscription_id=${stripeSubId}`)
      );
      if (!alreadyAwarded) {
        const entry = {
          amount: pointsToAward,
          type: 'earned',
          description: `Subscription payment of $${amountPaid.toFixed(2)} (subscription ${stripeSubId})`,
          timestamp: new Date().toISOString(),
        };
        const history = [...(pointsRecords[0].points_history || []), entry];
        await base44.asServiceRole.entities.UserPoints.update(pointsRecords[0].id, {
          total_points: (pointsRecords[0].total_points || 0) + pointsToAward,
          lifetime_points: (pointsRecords[0].lifetime_points || 0) + pointsToAward,
          points_history: history,
        });
        console.log(`[RepairSubV2] Awarded ${pointsToAward} pts to ${customerEmail} for subscription ${stripeSubId}`);
      } else {
        console.log(`[RepairSubV2] Points already awarded for subscription ${stripeSubId}, skipping`);
      }
    } else {
      const entry = {
        amount: pointsToAward,
        type: 'earned',
        description: `Subscription payment of $${amountPaid.toFixed(2)} (subscription ${stripeSubId})`,
        timestamp: new Date().toISOString(),
      };
      await base44.asServiceRole.entities.UserPoints.create({
        customer_email: customerEmail,
        total_points: pointsToAward,
        lifetime_points: pointsToAward,
        redeemed_points: 0,
        points_history: [entry],
      });
      console.log(`[RepairSubV2] Created points record with ${pointsToAward} pts for subscription ${stripeSubId}`);
    }

    // Fetch customer profile
    const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: customerEmail });
    const profile = profiles[0] || {};
    const resolvedCustomerName = customerName || (profile.first_name && profile.last_name ? `${profile.first_name} ${profile.last_name}` : customerEmail);
    const resolvedPhone = profile.phone || '';

    // Resolve address from metadata
    const addressLine1 = stripeSubscription.metadata?.delivery_address_line1 || '';
    const addressCity = stripeSubscription.metadata?.delivery_city || '';
    const addressState = stripeSubscription.metadata?.delivery_state || '';
    const addressZip = stripeSubscription.metadata?.delivery_postal_code || '';

    // Products from plan
    const products = plan.composition_template?.bottles_per_delivery?.map(bottle => ({
      product_name: bottle.flavor || 'Juice',
      quantity: bottle.quantity || 1,
    })) || [];

    // Sync to Hub
    try {
      await base44.asServiceRole.functions.invoke('syncCustomerToHub', {
        event: 'customer.subscription_created',
        customer_email: customerEmail,
        data: {
          subscription_id: subscription.id,
          customer_name: resolvedCustomerName,
          phone: resolvedPhone,
          stripe_subscription_id: stripe_subscription_id,
          stripe_customer_id: stripeCustomerId,
          customer_app_subscription_id: subscription.id,
          payment_status: 'paid',
          financial_status: 'paid',
          first_invoice_id: latestInvoice?.id || null,
          plan_id: planId,
          plan_name: plan.name,
          cadence: plan.frequency,
          production_date: fulfillmentCalc.production_date,
          first_delivery_date: fulfillmentCalc.first_delivery_date,
          next_delivery_date: fulfillmentCalc.next_delivery_date,
          delivery_window_label: '5 PM – 8 PM',
          delivery_window_start: '17:00',
          delivery_window_end: '20:00',
          delivery_address: deliveryAddress,
          address_line1: addressLine1,
          address_city: addressCity,
          address_state: addressState,
          address_postal_code: addressZip,
          address_country: 'US',
          products: products,
          subscription_started_date: fulfillmentCalc.first_delivery_date,
          delivery_zone_id: defaultZone?.id || null,
        },
      });
      console.log(`[RepairSubV2] ✅ Synced to Hub`);
    } catch (syncErr) {
      console.error(`[RepairSubV2] Hub sync failed: ${syncErr.message}`);
    }

    return Response.json({
      success: true,
      subscription_id: subscription.id,
      customer_email: customerEmail,
      points_awarded: pointsToAward,
      production_date: fulfillmentCalc.production_date,
      first_delivery_date: fulfillmentCalc.first_delivery_date,
      next_delivery_date: fulfillmentCalc.next_delivery_date,
      message: 'Subscription repaired: record created, loyalty awarded, Hub sync sent',
    });

  } catch (error) {
    console.error('[RepairSubV2] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});