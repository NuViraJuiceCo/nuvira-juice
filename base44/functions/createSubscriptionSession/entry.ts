import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import Stripe from 'npm:stripe@14';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

const PRICE_IDS = {
  weekly: 'price_1TLDrGRGJIVhpC3aRqEFp1Ga',
  monthly: 'price_1TLDrGRGJIVhpC3aPmkjPydA',
  vip: 'price_1TLDrGRGJIVhpC3afCcPptZV',
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { plan_id, bundle_id, address, customer_email } = await req.json();

    const priceId = PRICE_IDS[plan_id];
    if (!priceId) {
      return Response.json({ error: 'Invalid plan selected' }, { status: 400 });
    }

    const origin = req.headers.get('origin') || 'https://app.base44.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/order-confirmation/sub_{CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/subscribe`,
      customer_email: customer_email || undefined,
      metadata: {
        base44_app_id: Deno.env.get('BASE44_APP_ID'),
        plan_id,
        bundle_id,
        delivery_address: address || '',
      },
      subscription_data: {
        metadata: {
          plan_id,
          bundle_id,
          delivery_address: address || '',
        },
      },
    });

    return Response.json({ url: session.url });
  } catch (error) {
    console.error('Stripe subscription session error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});