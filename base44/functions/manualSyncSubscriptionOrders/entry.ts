import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin function: Manually sync subscription orders for a specific customer
 * Fetches from local subscriptions and creates/updates orders
 * Payload: { customer_email: string }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { customer_email } = await req.json();
    if (!customer_email) {
      return Response.json({ error: 'customer_email required' }, { status: 400 });
    }

    // Fetch subscriptions and convert to orders
    console.log(`[Manual Sync] Fetching subscriptions for ${customer_email}`);

    const subscriptions = await base44.asServiceRole.entities.Subscription.filter({ customer_email });
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.list();
    const userProfile = (await base44.asServiceRole.entities.UserProfile.filter({ customer_email }))[0];

    const orders = [];

    for (const sub of subscriptions) {
      if (sub.status !== 'active') continue;

      const plan = plans.find(p => p.id === sub.plan_id);
      if (!plan) continue;

      const composition = plan.composition_template || getDefaultComposition(plan.name);
      let deliveryDate = new Date(sub.next_delivery_date || new Date());

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
          order_number: `SUB-${sub.id.substring(0, 8).toUpperCase()}-${i + 1}`,
          customer_email: sub.customer_email,
          items: lineItems,
          subtotal: plan.base_price / composition.deliveries_per_cycle,
          delivery_fee: 0,
          total: plan.base_price / composition.deliveries_per_cycle,
          fulfillment_type: 'delivery',
          delivery_address: sub.delivery_address,
          contact_phone: userProfile?.phone || '',
          estimated_delivery_date: deliveryDate.toISOString().split('T')[0],
          status: 'scheduled_for_juicing',
        });

        deliveryDate.setDate(deliveryDate.getDate() + 7);
      }
    }

    console.log(`[Manual Sync] Generated ${orders.length} orders from subscriptions for ${customer_email}`);

    let synced = 0;
    let skipped = 0;
    const errors = [];

    for (const order of orders) {
      try {
        const existing = await base44.asServiceRole.entities.Order.filter({ 
          order_number: order.order_number 
        });

        if (existing.length === 0) {
          await base44.asServiceRole.entities.Order.create({
            order_number: order.order_number,
            customer_email: order.customer_email,
            items: order.items,
            subtotal: order.subtotal,
            delivery_fee: order.delivery_fee,
            total: order.total,
            fulfillment_type: order.fulfillment_type,
            delivery_address: order.delivery_address,
            contact_phone: order.contact_phone,
            estimated_delivery_date: order.estimated_delivery_date,
            status: order.status,
            status_history: [{
              status: order.status,
              timestamp: new Date().toISOString(),
              message: 'Subscription order manually synced',
            }],
          });
          synced++;
          console.log(`[Manual Sync] Created order ${order.order_number}`);
        } else {
          skipped++;
          console.log(`[Manual Sync] Order ${order.order_number} already exists, skipped`);
        }
      } catch (err) {
        const msg = `Failed to sync ${order.order_number}: ${err.message}`;
        errors.push(msg);
        console.error(`[Manual Sync] ${msg}`);
      }
    }

    return Response.json({
      success: true,
      customer_email,
      subscriptions_found: subscriptions.length,
      orders_generated: orders.length,
      synced,
      skipped,
      errors: errors.length > 0 ? errors : null,
    });
  } catch (error) {
    console.error('[Manual Sync] Error:', error.message);
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