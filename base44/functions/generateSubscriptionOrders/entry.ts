import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin function: Generate orders for a subscription based on plan composition
 * Used for monthly subscriptions to create weekly delivery orders
 * Payload: { subscription_id: string }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

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
    const createdOrders = [];
    let current = new Date(subscription.next_delivery_date || new Date());

    // Generate and create orders for each delivery in this cycle
    for (let i = 0; i < composition.deliveries_per_cycle; i++) {
      // Ensure weekday (skip weekends)
      while (current.getDay() === 0 || current.getDay() === 6) {
        current.setDate(current.getDate() + 1);
      }

      // Map composition to product items
      const items = composition.bottles_per_delivery.map(bottle => ({
        product_id: null,
        title: `${bottle.flavor} (${bottle.quantity}x)`,
        price: 0,
        quantity: bottle.quantity,
        image_url: null,
      }));

      const orderNumber = `SUB-${subscription.id.substring(0, 8)}-${i + 1}`;
      const orderData = {
        order_number: orderNumber,
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
        status_history: [{
          status: 'scheduled_for_juicing',
          timestamp: new Date().toISOString(),
          message: `Subscription order ${orderNumber} generated automatically`,
        }],
      };

      const createdOrder = await base44.asServiceRole.entities.Order.create(orderData);
      createdOrders.push(createdOrder);

      // Sync to hub
      base44.asServiceRole.functions.invoke('syncOrderToHub', { order_id: createdOrder.id })
        .catch(err => console.error(`Failed to sync order ${createdOrder.id} to hub:`, err.message));

      // Push to Shopify
      base44.asServiceRole.functions.invoke('pushOrderToShopify', { order_id: createdOrder.id })
        .catch(err => console.error(`Failed to push order ${createdOrder.id} to Shopify:`, err.message));

      current.setDate(current.getDate() + 7);
    }

    console.log(`Created and synced ${createdOrders.length} subscription orders for subscription ${subscription_id}`);

    return Response.json({
      success: true,
      subscription_id,
      plan_name: plan.name,
      orders_created: createdOrders.length,
      orders: createdOrders.map(o => ({ id: o.id, order_number: o.order_number, delivery_date: o.estimated_delivery_date })),
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