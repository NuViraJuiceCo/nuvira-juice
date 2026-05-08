import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

// One-time audit function for the two new subscriptions created 2026-05-08 ~18:18 UTC
// Kiran Kahlon: sub_1TUsyNIrzYHaHkt2KnKMMF1I
// Amar Kahlon (yahoo): sub_1TUsyNIrzYHaHkt2TfFbo8Ex

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const SUB_KIRAN = 'sub_1TUsyNIrzYHaHkt2KnKMMF1I';
    const SUB_AMAR_YAHOO = 'sub_1TUsyNIrzYHaHkt2TfFbo8Ex';

    const [subKiran, subAmarYahoo] = await Promise.all([
      stripe.subscriptions.retrieve(SUB_KIRAN, { expand: ['latest_invoice.payment_intent'] }),
      stripe.subscriptions.retrieve(SUB_AMAR_YAHOO, { expand: ['latest_invoice.payment_intent'] }),
    ]);

    const summarize = (sub) => ({
      id: sub.id,
      status: sub.status,
      customer: sub.customer,
      metadata_email: sub.metadata?.customer_email || null,
      metadata_plan_id: sub.metadata?.plan_id || null,
      metadata_pending_checkout_id: sub.metadata?.pending_subscription_checkout_id || null,
      cancel_at_period_end: sub.cancel_at_period_end,
      canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
      current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
      invoice: sub.latest_invoice ? {
        id: sub.latest_invoice.id,
        status: sub.latest_invoice.status,
        amount_paid: (sub.latest_invoice.amount_paid || 0) / 100,
        payment_intent_id: typeof sub.latest_invoice.payment_intent === 'string'
          ? sub.latest_invoice.payment_intent
          : sub.latest_invoice.payment_intent?.id || null,
        payment_intent_status: sub.latest_invoice.payment_intent?.status || null,
      } : null,
    });

    return Response.json({
      kiran_kahlon: summarize(subKiran),
      amar_kahlon_yahoo: summarize(subAmarYahoo),
    });

  } catch (err) {
    console.error('[auditNewSubscriptions]', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
});