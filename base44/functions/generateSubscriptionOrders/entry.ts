import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin function: Generate orders for a subscription based on plan composition
 * Used for monthly subscriptions to create weekly delivery orders
 * Payload: { subscription_id: string }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { subscription_id } = await req.json();
    if (!subscription_id) {
      return Response.json({ error: 'subscription_id required' }, { status: 400 });
    }

    // Fetch subscription
    const subs = await base44.asServiceRole.entities.Subscription.filter({ id: subscription_id });
    if (subs.length === 0) {
      return Response.json({ error: 'Subscription not found' }, { status: 404 });
    }

    const subscription = subs[0];
    const plan = (await base44.asServiceRole.entities.SubscriptionPlan.list()).find(p => p.id === subscription.plan_id);

    if (!plan) {
      return Response.json({ error: 'Plan not found' }, { status: 404 });
    }

    const composition = plan.composition_template || getDefaultComposition(plan.name);
    const deliveries = [];
    let current = new Date(subscription.next_delivery_date || new Date());

    // Generate orders for each delivery in this cycle
    for (let i = 0; i < composition.deliveries_per_cycle; i++) {
      // Ensure weekday (skip weekends)
      while (current.getDay() === 0 || current.getDay() === 6) {
        current.setDate(current.getDate() + 1);
      }

      // Map composition to product items
      const items = composition.bottles_per_delivery.map(bottle => ({
        product_id: null, // Will be populated by frontend
        title: `${bottle.flavor} (${bottle.quantity}x)`,
        price: 0, // Subscription pricing handled at plan level
        quantity: bottle.quantity,
        image_url: null,
      }));

      const order = {
        order_number: `SUB-${subscription.id.substring(0, 8)}-${i + 1}`,
        customer_email: subscription.customer_email,
        items,
        subtotal: 0,
        delivery_fee: 0,
        total: 0,
        fulfillment_type: 'delivery',
        delivery_address: subscription.delivery_address,
        contact_phone: '',
        estimated_delivery_date: current.toISOString().split('T')[0],
        status: 'scheduled_for_juicing',
      };

      deliveries.push(order);
      current.setDate(current.getDate() + 7);
    }

    console.log(`Generated ${deliveries.length} delivery orders for subscription ${subscription_id}`);

    return Response.json({
      success: true,
      subscription_id,
      plan_name: plan.name,
      deliveries_count: deliveries.length,
      deliveries,
    });
  } catch (error) {
    console.error('Generate subscription orders error:', error);
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