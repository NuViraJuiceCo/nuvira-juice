import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Endpoint: Fetch subscription orders for hub sync.
 * Called by: Hub's pullOrdersFromCustomerApp, or manual sync
 * Returns orders in the format expected by the hub.
 * Requires: customer_email in request body
 */
Deno.serve(async (req) => {
  try {
    // Validate hub secret token
    const authHeader = req.headers.get('authorization');
    const syncSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return Response.json({ error: 'Missing authorization header' }, { status: 401 });
    }
    
    const token = authHeader.substring(7);
    if (token !== syncSecret) {
      return Response.json({ error: 'Invalid authorization token' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { customer_email } = body;

    if (!customer_email) {
      return Response.json({ error: 'customer_email required' }, { status: 400 });
    }

    // Fetch subscriptions for this customer
    const subscriptions = await base44.asServiceRole.entities.Subscription.filter({ customer_email });
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.list();
    const userProfile = (await base44.asServiceRole.entities.UserProfile.filter({ customer_email }))[0];

    const orders = [];

    for (const sub of subscriptions) {
      if (sub.status !== 'active') continue;

      const plan = plans.find(p => p.id === sub.plan_id);
      if (!plan) continue;

      const composition = plan.composition_template || getDefaultComposition(plan.name);

      // Calculate next delivery date (start from next_delivery_date or today)
      let deliveryDate = new Date(sub.next_delivery_date || new Date());
      
      // Create an order for each delivery in this cycle
      for (let i = 0; i < composition.deliveries_per_cycle; i++) {
        // Skip weekends
        while (deliveryDate.getDay() === 0 || deliveryDate.getDay() === 6) {
          deliveryDate.setDate(deliveryDate.getDate() + 1);
        }

        const lineItems = composition.bottles_per_delivery.map(bottle => ({
          title: `${bottle.flavor} (${bottle.quantity}x)`,
          quantity: bottle.quantity,
          price: plan.base_price / composition.deliveries_per_cycle,
        }));

        orders.push({
          shopify_order_id: `sub_${sub.id.substring(0, 12)}_${i}`,
          shopify_order_number: `#SUB-${sub.id.substring(0, 8).toUpperCase()}-${i + 1}`,
          customer_email: sub.customer_email,
          customer_phone: userProfile?.phone || '',
          customer_name: userProfile?.contact_email?.split('@')[0] || customer_email.split('@')[0],
          source_channel: 'subscription',
          line_items: lineItems,
          fulfillment_method: 'delivery',
          delivery_address: sub.delivery_address,
          requested_delivery_date: deliveryDate.toISOString().split('T')[0],
          total_price: plan.base_price / composition.deliveries_per_cycle,
          payment_status: 'paid',
          created_date: sub.created_date || new Date().toISOString(),
        });

        // Move to next delivery date (7 days later for weekly/monthly)
        deliveryDate.setDate(deliveryDate.getDate() + 7);
      }
    }

    console.log(`Returning ${orders.length} subscription orders for ${customer_email}`);

    return Response.json({ orders });
  } catch (error) {
    console.error('Get subscription orders for sync error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function getDefaultComposition(planName) {
  const defaults = {
    'Weekly Fresh': {
      deliveries_per_cycle: 1,
      bottles_per_delivery: [
        { flavor: 'AURA', quantity: 1 },
        { flavor: 'RE-NU', quantity: 1 },
        { flavor: 'OASIS', quantity: 1 },
      ],
    },
    'Monthly Ritual': {
      deliveries_per_cycle: 4,
      bottles_per_delivery: [
        { flavor: 'AURA', quantity: 1 },
        { flavor: 'RE-NU', quantity: 1 },
        { flavor: 'OASIS', quantity: 1 },
      ],
    },
    'VIP Wellness': {
      deliveries_per_cycle: 4,
      bottles_per_delivery: [
        { flavor: 'AURA', quantity: 2 },
        { flavor: 'RE-NU', quantity: 2 },
        { flavor: 'OASIS', quantity: 2 },
      ],
    },
  };
  return defaults[planName] || defaults['Weekly Fresh'];
}