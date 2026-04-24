import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Endpoint: Fetch subscription orders for hub sync.
 * Returns orders in the format expected by the hub.
 * Requires: customer_email in request body
 */
Deno.serve(async (req) => {
  try {
    // Validate hub secret token
    const authHeader = req.headers.get('authorization');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    if (authHeader !== `Bearer ${hubSecret}`) {
      return Response.json({ error: 'Invalid or missing authorization' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const { customer_email } = await req.json();

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

      // Create an order for each delivery in this cycle
      for (let i = 0; i < composition.deliveries_per_cycle; i++) {
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
          total_price: plan.base_price,
          payment_status: 'paid',
          created_date: sub.created_date || new Date().toISOString(),
        });
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