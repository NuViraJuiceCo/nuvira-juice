import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

async function requireAdmin(base44) {
  const user = await base44.auth.me().catch(() => null);
  if (!user?.email) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403 });
  return null;
}

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
    const unauthorized = await requireAdmin(base44);
    if (unauthorized) return unauthorized;

    // Audit the newest succeeded Stripe transaction for amark@nuvisionarymedia.com
    // without relying on Customer App records

    // 1. Find Stripe customer by email
    const customers = await stripe.customers.list({
      email: 'amark@nuvisionarymedia.com',
      limit: 10,
    });

    if (customers.data.length === 0) {
      return Response.json({ error: 'No Stripe customer found for amark@nuvisionarymedia.com' });
    }

    const stripeCustomer = customers.data[0];
    const customerId = stripeCustomer.id;
    console.log(`[auditLatestStripe] Found Stripe customer: ${customerId}, email: ${stripeCustomer.email}`);

    // 2. Get newest PaymentIntents
    const paymentIntents = await stripe.paymentIntents.list({
      customer: customerId,
      limit: 20,
    });

    console.log(`[auditLatestStripe] Found ${paymentIntents.data.length} PaymentIntents`);

    // Filter succeeded PIs
    const succeededPIs = paymentIntents.data.filter(pi => pi.status === 'succeeded');
    const newestSucceededPI = succeededPIs[0];

    // 3. Get newest subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit: 20,
    });

    console.log(`[auditLatestStripe] Found ${subscriptions.data.length} subscriptions`);

    // 4. Get newest invoices
    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit: 20,
    });

    console.log(`[auditLatestStripe] Found ${invoices.data.length} invoices`);

    // Find the newest paid invoice
    const paidInvoices = invoices.data.filter(inv => inv.status === 'paid');
    const newestPaidInvoice = paidInvoices[0];

    // 5. Build summary of newest transactions
    let piSummary = null;
    if (newestSucceededPI) {
      piSummary = {
        id: newestSucceededPI.id,
        status: newestSucceededPI.status,
        amount: newestSucceededPI.amount / 100,
        currency: newestSucceededPI.currency,
        created: new Date(newestSucceededPI.created * 1000).toISOString(),
        invoice: typeof newestSucceededPI.invoice === 'string' ? newestSucceededPI.invoice : newestSucceededPI.invoice?.id || null,
        description: newestSucceededPI.description,
        metadata: newestSucceededPI.metadata || {},
      };
    }

    let subSummary = null;
    if (subscriptions.data.length > 0) {
      const sub = subscriptions.data[0];
      subSummary = {
        id: sub.id,
        status: sub.status,
        current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        created: new Date(sub.created * 1000).toISOString(),
        latest_invoice: sub.latest_invoice,
        metadata: sub.metadata || {},
      };
    }

    let invoiceSummary = null;
    if (newestPaidInvoice) {
      invoiceSummary = {
        id: newestPaidInvoice.id,
        status: newestPaidInvoice.status,
        subscription: newestPaidInvoice.subscription,
        amount_paid: newestPaidInvoice.amount_paid / 100,
        amount_due: newestPaidInvoice.amount_due / 100,
        payment_intent: typeof newestPaidInvoice.payment_intent === 'string' ? newestPaidInvoice.payment_intent : newestPaidInvoice.payment_intent?.id || null,
        created: new Date(newestPaidInvoice.created * 1000).toISOString(),
      };
    }

    // 6. Get charges for this customer to find any recent refunds/payments
    const charges = await stripe.charges.list({
      customer: customerId,
      limit: 20,
    });

    const succeededCharges = charges.data.filter(c => c.status === 'succeeded');
    const newestSucceededCharge = succeededCharges[0];

    let chargeSummary = null;
    if (newestSucceededCharge) {
      chargeSummary = {
        id: newestSucceededCharge.id,
        amount: newestSucceededCharge.amount / 100,
        currency: newestSucceededCharge.currency,
        status: newestSucceededCharge.status,
        refunded: newestSucceededCharge.refunded,
        refunds_count: newestSucceededCharge.refunds?.data?.length || 0,
        created: new Date(newestSucceededCharge.created * 1000).toISOString(),
        payment_intent: newestSucceededCharge.payment_intent,
        invoice: newestSucceededCharge.invoice,
      };
    }

    // 7. Return comprehensive Stripe audit
    return Response.json({
      stripe_customer_id: customerId,
      stripe_customer_email: stripeCustomer.email,
      newest_succeeded_payment_intent: piSummary,
      newest_subscription: subSummary,
      newest_paid_invoice: invoiceSummary,
      newest_succeeded_charge: chargeSummary,
      all_subscriptions: subscriptions.data.map(s => ({
        id: s.id,
        status: s.status,
        created: new Date(s.created * 1000).toISOString(),
      })),
      all_paid_invoices: paidInvoices.map(inv => ({
        id: inv.id,
        subscription: inv.subscription,
        created: new Date(inv.created * 1000).toISOString(),
        status: inv.status,
      })),
    });

  } catch (err) {
    console.error('[auditLatestStripePaymentForAmark] Error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
});
