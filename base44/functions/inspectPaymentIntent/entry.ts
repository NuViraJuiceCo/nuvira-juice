import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

/**
 * Admin-only diagnostic: retrieve a PaymentIntent and return its
 * payment_method_types, automatic_payment_methods, and amount.
 * Also creates a fresh test PI to verify the current createPaymentIntent config.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { pi_id } = await req.json();

    // If pi_id provided, inspect existing PI
    if (pi_id) {
      const pi = await stripe.paymentIntents.retrieve(pi_id);
      return Response.json({
        id: pi.id,
        status: pi.status,
        amount: pi.amount,
        currency: pi.currency,
        payment_method_types: pi.payment_method_types,
        automatic_payment_methods: pi.automatic_payment_methods,
        metadata_checkout_version: pi.metadata?.checkout_version || null,
      });
    }

    // Create a minimal fresh test PI mirroring production createPaymentIntent config
    const freshPi = await stripe.paymentIntents.create({
      amount: 100,
      currency: 'usd',
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      description: 'DIAGNOSTIC TEST — cancel immediately',
      metadata: { diagnostic: 'true', checkout_version: '3.0_embedded' },
    });

    await stripe.paymentIntents.cancel(freshPi.id);

    return Response.json({
      diagnostic: 'fresh_pi_test',
      id: freshPi.id,
      status: 'canceled_immediately',
      payment_method_types: freshPi.payment_method_types,
      automatic_payment_methods: freshPi.automatic_payment_methods,
      payment_method_options: freshPi.payment_method_options,
      amount: freshPi.amount,
    });

  } catch (error) {
    console.error('[inspectPaymentIntent]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});