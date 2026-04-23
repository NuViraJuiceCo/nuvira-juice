import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { plan_id, bundle_id, address, customer_email } = await req.json();

    // Fetch the plan from Base44 to get the Stripe price ID
    const allPlans = await base44.asServiceRole.entities.SubscriptionPlan.list();
    const plan = allPlans.find(p => p.id === plan_id);
    if (!plan) {
      return Response.json({ error: 'Plan not found' }, { status: 404 });
    }
    
    // Use the stripe_price_id from the plan record
    const priceId = plan.stripe_price_id;
    if (!priceId) {
      return Response.json({ error: `No Stripe price configured for plan "${plan.name}"` }, { status: 400 });
    }

    const origin = req.headers.get('origin') || 'https://app.base44.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/account/subscriptions?subscribed=true`,
      cancel_url: `${origin}/subscribe`,
      customer_email: customer_email || undefined,
      metadata: {
        base44_app_id: Deno.env.get('BASE44_APP_ID'),
        plan_id,
        bundle_id,
        delivery_address: address || '',
        customer_email: customer_email || '',
        is_preorder_subscription: 'true',
      },
      subscription_data: {
        metadata: {
          plan_id,
          bundle_id,
          delivery_address: address || '',
          customer_email: customer_email || '',
          is_preorder_subscription: 'true',
        },
        payment_settings: {
          save_default_payment_method: 'on_subscription',
          payment_method_types: ['card'],
        },
      },
    });

    return Response.json({ url: session.url });
  } catch (error) {
    console.error('Stripe subscription session error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});