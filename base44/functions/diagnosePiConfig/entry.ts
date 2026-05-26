import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

/**
 * Admin-only: retrieve a specific PaymentIntent and return its exact config.
 * Pass { pi_id: "pi_3T..." } to inspect.
 * This proves whether the VISIBLE PI on checkout is card-only or not.
 */
Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_LEGACY_PAYMENT_SUBSCRIPTION_TOOLS') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'legacy_payment_subscription_tools_disabled',
        message: 'Legacy payment/subscription tools are disabled for May 30 launch freeze.',
      }, { status: 409 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { pi_id } = await req.json();
    if (!pi_id) {
      return Response.json({ error: 'pi_id required' }, { status: 400 });
    }

    const pi = await stripe.paymentIntents.retrieve(pi_id);

    const result = {
      id: pi.id,
      status: pi.status,
      amount: pi.amount,
      amount_dollars: (pi.amount / 100).toFixed(2),
      currency: pi.currency,
      payment_method_types: pi.payment_method_types,
      automatic_payment_methods: pi.automatic_payment_methods,
      payment_method_options: pi.payment_method_options,
      description: pi.description,
      receipt_email: pi.receipt_email,
      metadata_checkout_version: pi.metadata?.checkout_version || null,
      metadata_order_number: pi.metadata?.order_number || null,
      metadata_source_app: pi.metadata?.source_app || null,
      created: new Date(pi.created * 1000).toISOString(),
      // Key verdict
      verdict: {
        is_card_only: JSON.stringify(pi.payment_method_types) === JSON.stringify(['card']),
        has_automatic_methods: pi.automatic_payment_methods !== null,
        bank_should_appear: pi.automatic_payment_methods !== null || (pi.payment_method_types || []).some(t => ['us_bank_account', 'sepa_debit', 'bacs_debit', 'acss_debit', 'klarna', 'afterpay_clearpay'].includes(t)),
      },
    };

    console.log(`[diagnosePiConfig] PI ${pi_id}:`, JSON.stringify(result.verdict));

    return Response.json(result);
  } catch (error) {
    console.error('[diagnosePiConfig] error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
