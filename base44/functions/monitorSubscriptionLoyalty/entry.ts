import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

/**
 * Monitors subscription loyalty behavior during/after purchase.
 * Verifies:
 * - Subscription created in Stripe
 * - First invoice paid
 * - Subscription record created in Customer App
 * - Points awarded exactly once (no duplication)
 * - Correct point amounts
 * 
 * Usage:
 *   base44.functions.invoke('monitorSubscriptionLoyalty', {
 *     customer_email: 'test@example.com',
 *     stripe_subscription_id: 'sub_xxx' // optional, will fetch from Stripe if not provided
 *   })
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
    const { customer_email, stripe_subscription_id } = await req.json();

    if (!customer_email) {
      return Response.json({ error: 'customer_email is required' }, { status: 400 });
    }

    console.log(`[monitorSubscriptionLoyalty] Starting loyalty monitoring for ${customer_email}`);

    // Fetch UserPoints before we check Stripe
    const pointsBefore = await base44.asServiceRole.entities.UserPoints.filter({ customer_email });
    const pointsBeforeCount = pointsBefore.length > 0 ? pointsBefore[0].total_points || 0 : 0;
    const pointsHistory = pointsBefore.length > 0 ? pointsBefore[0].points_history || [] : [];

    console.log(`[monitorSubscriptionLoyalty] Points before: ${pointsBeforeCount}`);

    // Find subscription in Stripe
    let subscription = null;
    let stripeSubId = stripe_subscription_id;

    if (!stripeSubId) {
      // Search for active subscription by customer email
      console.log(`[monitorSubscriptionLoyalty] Searching for Stripe subscription for ${customer_email}`);
      const subs = await stripe.subscriptions.list({ 
        email: customer_email,
        limit: 10,
        status: 'active',
      });
      if (subs.data.length > 0) {
        subscription = subs.data[0];
        stripeSubId = subscription.id;
        console.log(`[monitorSubscriptionLoyalty] Found Stripe subscription: ${stripeSubId}`);
      } else {
        console.warn(`[monitorSubscriptionLoyalty] No active Stripe subscription found for ${customer_email}`);
      }
    } else {
      // Fetch specific subscription
      subscription = await stripe.subscriptions.retrieve(stripeSubId);
      console.log(`[monitorSubscriptionLoyalty] Retrieved Stripe subscription: ${stripeSubId}`);
    }

    // Fetch first invoice
    let firstInvoice = null;
    let paymentIntentId = null;
    let invoiceAmount = 0;
    if (subscription) {
      console.log(`[monitorSubscriptionLoyalty] Subscription status: ${subscription.status}, latest invoice: ${subscription.latest_invoice}`);
      
      if (subscription.latest_invoice) {
        const invoiceId = typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : subscription.latest_invoice.id;
        const invoice = await stripe.invoices.retrieve(invoiceId);
        firstInvoice = invoice;
        paymentIntentId = invoice.payment_intent;
        invoiceAmount = invoice.amount_paid / 100;
        console.log(`[monitorSubscriptionLoyalty] First invoice: ${invoice.id}, status: ${invoice.status}, amount: $${invoiceAmount}, PI: ${paymentIntentId}`);
      }
    }

    // Fetch Customer App Subscription record
    const appSubs = await base44.asServiceRole.entities.Subscription.filter({ customer_email });
    const appSub = appSubs.length > 0 ? appSubs[0] : null;
    console.log(`[monitorSubscriptionLoyalty] Customer App Subscription: ${appSub ? appSub.id : 'NOT FOUND'}`);

    // Check for point awards from this subscription
    const subscriptionPointEntries = pointsHistory.filter(entry =>
      entry.description.includes('$' + invoiceAmount.toFixed(2)) ||
      entry.description.includes('payment of $')
    );

    const uniqueSubscriptionAwards = new Set();
    subscriptionPointEntries.forEach(entry => {
      // Key by timestamp and amount to detect exact duplicates
      uniqueSubscriptionAwards.add(`${entry.timestamp}:${entry.amount}`);
    });

    const isDuplicated = subscriptionPointEntries.length > uniqueSubscriptionAwards.size;
    const expectedPoints = invoiceAmount > 0 ? Math.floor(invoiceAmount * 10) : 0;
    const actualPointsAwarded = subscriptionPointEntries.reduce((sum, e) => sum + (e.amount || 0), 0);

    console.log(`[monitorSubscriptionLoyalty] Subscription point entries: ${subscriptionPointEntries.length}, Unique: ${uniqueSubscriptionAwards.size}, Expected: ${expectedPoints}, Actual awarded: ${actualPointsAwarded}, Duplicated: ${isDuplicated}`);

    // Fetch updated points
    const pointsAfter = await base44.asServiceRole.entities.UserPoints.filter({ customer_email });
    const pointsAfterCount = pointsAfter.length > 0 ? pointsAfter[0].total_points || 0 : 0;

    const report = {
      success: true,
      customer_email,
      test_timestamp: new Date().toISOString(),
      
      // Stripe subscription details
      stripe_subscription: subscription ? {
        id: subscription.id,
        status: subscription.status,
        customer_id: subscription.customer,
        current_period_start: subscription.current_period_start,
        current_period_end: subscription.current_period_end,
      } : null,
      
      // First invoice details
      first_invoice: firstInvoice ? {
        id: firstInvoice.id,
        status: firstInvoice.status,
        amount_paid: invoiceAmount,
        payment_intent_id: paymentIntentId,
        payment_status: firstInvoice.paid ? 'paid' : 'unpaid',
      } : null,
      
      // Customer App Subscription
      customer_app_subscription: appSub ? {
        id: appSub.id,
        plan_id: appSub.plan_id,
        status: appSub.status,
        next_delivery_date: appSub.next_delivery_date,
      } : null,
      
      // Loyalty points analysis
      loyalty_points: {
        before: pointsBeforeCount,
        after: pointsAfterCount,
        change: pointsAfterCount - pointsBeforeCount,
        subscription_point_entries: subscriptionPointEntries.length,
        unique_subscription_awards: uniqueSubscriptionAwards.size,
        expected_points_from_invoice: expectedPoints,
        actual_points_awarded: actualPointsAwarded,
        points_duplicated: isDuplicated,
        expected_total: pointsBeforeCount + expectedPoints,
        actual_total: pointsAfterCount,
      },
      
      // Pass/fail checks
      checks: {
        stripe_subscription_created: subscription ? 'PASS' : 'FAIL',
        first_invoice_paid: firstInvoice && firstInvoice.paid ? 'PASS' : 'FAIL',
        app_subscription_created: appSub ? 'PASS' : 'FAIL',
        points_awarded_once: !isDuplicated && actualPointsAwarded === expectedPoints ? 'PASS' : 'FAIL',
        points_amount_correct: actualPointsAwarded === expectedPoints ? 'PASS' : 'FAIL',
        final_points_correct: pointsAfterCount === (pointsBeforeCount + expectedPoints) ? 'PASS' : 'FAIL',
      },
      
      // Recommendation
      overall_status: 
        subscription && 
        firstInvoice?.paid && 
        appSub && 
        !isDuplicated && 
        actualPointsAwarded === expectedPoints && 
        pointsAfterCount === (pointsBeforeCount + expectedPoints)
        ? 'PASS - Subscription loyalty behavior correct'
        : 'FAIL - See individual checks above',
    };

    console.log(`[monitorSubscriptionLoyalty] Report: ${JSON.stringify(report, null, 2)}`);

    return Response.json(report);

  } catch (error) {
    console.error('[monitorSubscriptionLoyalty] Error:', error.message);
    return Response.json({ error: error.message, success: false }, { status: 500 });
  }
});
