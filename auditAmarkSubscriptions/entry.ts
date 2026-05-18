import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const SUB_OLD = 'sub_1TUah0IrzYHaHkt24AVgUtNY'; // original May 7 sub
    const SUB_NEW = 'sub_1TUsq1IrzYHaHkt2JnjTdP5a'; // today's paid sub
    const PI_PAID = 'pi_3TUsq2IrzYHaHkt22btoVsMf';

    // Fetch both subscriptions and the PI in parallel
    const [subOld, subNew, pi] = await Promise.all([
      stripe.subscriptions.retrieve(SUB_OLD).catch(e => ({ error: e.message })),
      stripe.subscriptions.retrieve(SUB_NEW).catch(e => ({ error: e.message })),
      stripe.paymentIntents.retrieve(PI_PAID).catch(e => ({ error: e.message })),
    ]);

    // Fetch invoice for new sub to confirm payment
    let invoiceNew = null;
    if (subNew && !subNew.error && subNew.latest_invoice) {
      const invoiceId = typeof subNew.latest_invoice === 'string' ? subNew.latest_invoice : subNew.latest_invoice.id;
      invoiceNew = await stripe.invoices.retrieve(invoiceId, { expand: ['payment_intent'] }).catch(e => ({ error: e.message }));
    }

    return Response.json({
      sub_old: {
        id: subOld.id || null,
        status: subOld.status || subOld.error,
        customer: subOld.customer || null,
        cancel_at_period_end: subOld.cancel_at_period_end || null,
        canceled_at: subOld.canceled_at ? new Date(subOld.canceled_at * 1000).toISOString() : null,
        current_period_end: subOld.current_period_end ? new Date(subOld.current_period_end * 1000).toISOString() : null,
        metadata_email: subOld.metadata?.customer_email || null,
      },
      sub_new: {
        id: subNew.id || null,
        status: subNew.status || subNew.error,
        customer: subNew.customer || null,
        cancel_at_period_end: subNew.cancel_at_period_end || null,
        canceled_at: subNew.canceled_at ? new Date(subNew.canceled_at * 1000).toISOString() : null,
        current_period_end: subNew.current_period_end ? new Date(subNew.current_period_end * 1000).toISOString() : null,
        metadata_email: subNew.metadata?.customer_email || null,
        latest_invoice_id: typeof subNew.latest_invoice === 'string' ? subNew.latest_invoice : subNew.latest_invoice?.id,
      },
      invoice_new: invoiceNew ? {
        id: invoiceNew.id || null,
        status: invoiceNew.status || invoiceNew.error,
        amount_paid: invoiceNew.amount_paid ? invoiceNew.amount_paid / 100 : null,
        payment_intent_id: typeof invoiceNew.payment_intent === 'string' ? invoiceNew.payment_intent : invoiceNew.payment_intent?.id,
        payment_intent_status: invoiceNew.payment_intent?.status || null,
      } : null,
      pi_paid: {
        id: pi.id || null,
        status: pi.status || pi.error,
        amount: pi.amount ? pi.amount / 100 : null,
        invoice: typeof pi.invoice === 'string' ? pi.invoice : pi.invoice?.id || null,
        customer: pi.customer || null,
      },
    });
  } catch (err) {
    console.error('[auditAmarkSubscriptions]', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
});