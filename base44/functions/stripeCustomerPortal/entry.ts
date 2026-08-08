import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    if (!user) {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    const origin = req.headers.get('origin') || 'https://app.base44.com';

    // Find the Stripe customer by email
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (!customers.data.length) {
      return Response.json({ error: 'No Stripe customer found for this account.' }, { status: 404 });
    }

    const customerId = customers.data[0].id;

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/account/subscriptions`,
    });

    return Response.json({ url: portalSession.url });
  } catch (error) {
    console.error('Stripe customer portal error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
