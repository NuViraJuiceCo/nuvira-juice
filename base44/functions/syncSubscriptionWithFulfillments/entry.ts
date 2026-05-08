import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Sync subscription to Hub with all 4 pre-calculated fulfillments.
 * Replaces individual fulfillment sends with a complete cycle payload.
 * 
 * Payload: { subscription_id, customer_email }
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const { subscription_id, customer_email } = await req.json();

    if (!subscription_id || !customer_email) {
      return Response.json({ error: 'Missing subscription_id or customer_email' }, { status: 400 });
    }

    console.log(`[syncSubWithFulfillments] Starting sync for ${customer_email}, sub ${subscription_id}`);

    // Fetch subscription
    const subs = await base44.asServiceRole.entities.Subscription.filter({
      id: subscription_id,
      customer_email: customer_email,
    });

    if (subs.length === 0) {
      return Response.json({ error: `Subscription ${subscription_id} not found` }, { status: 404 });
    }

    const subscription = subs[0];

    // Fetch plan
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({
      id: subscription.plan_id,
    });
    const plan = plans[0];

    // Calculate 4 fulfillments
    const fulfillments = calculateMonthlyFulfillments(subscription.started_date, plan?.name);
    console.log(`[syncSubWithFulfillments] Calculated ${fulfillments.length} fulfillments`);

    // Fetch user profile for customer name
    const profiles = await base44.asServiceRole.entities.UserProfile.filter({
      customer_email: customer_email,
    });
    const profile = profiles[0] || {};
    const customerName = profile.first_name && profile.last_name 
      ? `${profile.first_name} ${profile.last_name}` 
      : customer_email;

    // Build complete subscription payload with fulfillments
    const billingStart = subscription.started_date;
    const billingEnd = subscription.next_delivery_date || 
      new Date(new Date(billingStart).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const hubPayload = {
      event: 'customer.subscription_created',
      source: 'customer_app',
      customer_email: customer_email,
      data: {
        customer_app_subscription_id: subscription.id,
        stripe_subscription_id: subscription.stripe_subscription_id,
        stripe_customer_id: subscription.stripe_customer_id || null,
        customer_name: customerName,
        payment_status: 'paid',
        financial_status: 'paid',
        plan_name: plan?.name || 'Unknown',
        cycle_number: 1,
        billing_period_start: billingStart,
        billing_period_end: billingEnd,
        fulfillments: fulfillments,
      },
    };

    console.log(`[syncSubWithFulfillments] Payload built. Sending to Hub...`);
    console.log(`[syncSubWithFulfillments] Fulfillments: ${JSON.stringify(fulfillments.map(f => ({ fulfillment_number: f.fulfillment_number, scheduled_date: f.scheduled_date })))}`);

    // Send directly to Hub
    const hubBaseUrl = (Deno.env.get('HUB_API_URL') || '').trim();
    const hubUrl = hubBaseUrl.endsWith('/') 
      ? `${hubBaseUrl}functions/customerAppEventPublicGateway`
      : `${hubBaseUrl}/functions/customerAppEventPublicGateway`;

    const hubResponse = await fetch(hubUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('CUSTOMER_APP_SYNC_SECRET')}`,
      },
      body: JSON.stringify({
        event: 'customer.subscription_created',
        source: 'customer_app',
        customer_email: customer_email,
        data: hubPayload.data,
        synced_at: new Date().toISOString(),
      }),
    });

    console.log(`[syncSubWithFulfillments] Hub response status: ${hubResponse.status}`);

    if (!hubResponse.ok) {
      const hubError = await hubResponse.text();
      console.error(`[syncSubWithFulfillments] Hub error: ${hubError}`);
      return Response.json({ 
        error: `Hub returned ${hubResponse.status}`,
        details: hubError,
        fulfillments_calculated: fulfillments.length,
      }, { status: hubResponse.status });
    }

    const hubResult = await hubResponse.json();

    console.log(`[syncSubWithFulfillments] ✅ Hub sync completed`);

    return Response.json({
      success: true,
      subscription_id: subscription.id,
      customer_email: customer_email,
      fulfillments_sent: fulfillments.length,
      fulfillments: fulfillments,
      hub_response: hubResult,
    });

  } catch (error) {
    console.error('[syncSubWithFulfillments] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * Calculate 4 fulfillments for a monthly subscription cycle.
 */
function calculateMonthlyFulfillments(startedDate, planName) {
  const fulfillments = [];
  const start = new Date(startedDate + 'T00:00:00');
  
  // Determine product composition per fulfillment
  let productsPerFulfillment = [];
  if (planName === 'Monthly Ritual') {
    productsPerFulfillment = [
      { product_name: 'Aura', quantity: 1 },
      { product_name: 'Oasis', quantity: 1 },
      { product_name: 'Re-Nu', quantity: 1 },
    ];
  } else if (planName === 'VIP Wellness') {
    productsPerFulfillment = [
      { product_name: 'Aura', quantity: 2 },
      { product_name: 'Oasis', quantity: 2 },
      { product_name: 'Re-Nu', quantity: 2 },
    ];
  } else {
    productsPerFulfillment = [
      { product_name: 'Aura', quantity: 1 },
      { product_name: 'Oasis', quantity: 1 },
      { product_name: 'Re-Nu', quantity: 1 },
    ];
  }
  
  const itemsSummary = productsPerFulfillment
    .map(p => `${p.quantity}x ${p.product_name}`)
    .join(', ');
  
  // Generate 4 fulfillments: week 1, 2, 3, 4
  for (let week = 0; week < 4; week++) {
    const deliveryDate = new Date(start);
    deliveryDate.setDate(deliveryDate.getDate() + (week * 7));
    
    // Production date: 2 days before delivery
    const productionDate = new Date(deliveryDate);
    productionDate.setDate(productionDate.getDate() - 2);
    
    const scheduledDateStr = deliveryDate.toISOString().split('T')[0];
    const productionDateStr = productionDate.toISOString().split('T')[0];
    
    fulfillments.push({
      fulfillment_number: week + 1,
      scheduled_date: scheduledDateStr,
      production_date: productionDateStr,
      delivery_window_label: '5 PM – 8 PM',
      delivery_window_start: '17:00',
      delivery_window_end: '20:00',
      products: productsPerFulfillment,
      items_summary: itemsSummary,
    });
  }
  
  return fulfillments;
}