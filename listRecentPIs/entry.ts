import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get last 10 real (non-cancelled) PIs
    const list = await stripe.paymentIntents.list({ limit: 10 });

    const results = list.data.map(pi => ({
      id: pi.id,
      status: pi.status,
      amount_dollars: (pi.amount / 100).toFixed(2),
      payment_method_types: pi.payment_method_types,
      automatic_payment_methods: pi.automatic_payment_methods,
      order_number: pi.metadata?.order_number || null,
      checkout_version: pi.metadata?.checkout_version || null,
      created: new Date(pi.created * 1000).toISOString(),
      verdict_card_only: JSON.stringify(pi.payment_method_types) === JSON.stringify(['card']) && pi.automatic_payment_methods === null,
    }));

    return Response.json({ recent_pis: results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});