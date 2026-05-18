import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));
const CAPTURE_DATE = '2026-05-01'; // Production/capture day

/**
 * Batch-capture all authorized pre-order payments on May 1st.
 * Run once on May 1st morning via scheduled automation.
 * Admin-only. Finds all uncaptured payment intents from pre-orders and captures them.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const today = new Date().toISOString().split('T')[0];
    if (today !== CAPTURE_DATE) {
      return Response.json({
        message: `Not capture day yet. Today: ${today}, capture day: ${CAPTURE_DATE}`,
      });
    }

    // Fetch all CheckoutSessions created during pre-order window
    const checkoutSessions = await base44.asServiceRole.entities.CheckoutSession.filter({});
    const preorderCheckouts = checkoutSessions.filter(
      cs => cs.checkout_data?.is_preorder === true
    );

    console.log(`Found ${preorderCheckouts.length} pre-order checkout sessions`);

    const results = { captured: [], failed: [], skipped: [] };

    // Capture each authorized payment
    for (const checkout of preorderCheckouts) {
      try {
        const sessionId = checkout.stripe_session_id;

        // Retrieve Stripe session to get payment intent
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (!session.payment_intent) {
          results.skipped.push({ sessionId, reason: 'No payment intent' });
          continue;
        }

        // Retrieve the payment intent
        const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);

        // Check if already captured or in a capturable state
        if (paymentIntent.status === 'succeeded') {
          results.skipped.push({ sessionId, reason: 'Already captured' });
          continue;
        }

        if (paymentIntent.status !== 'requires_capture') {
          results.skipped.push({ sessionId, reason: `Status: ${paymentIntent.status}` });
          continue;
        }

        // Capture the authorized amount
        const captured = await stripe.paymentIntents.capture(session.payment_intent);
        results.captured.push({
          sessionId,
          paymentIntentId: captured.id,
          amount: captured.amount_captured / 100,
          email: checkout.customer_email,
        });

        console.log(`Captured pre-order payment: ${captured.id} ($${captured.amount_captured / 100})`);
      } catch (err) {
        results.failed.push({
          sessionId: checkout.stripe_session_id,
          error: err.message,
        });
        console.error(`Failed to capture ${checkout.stripe_session_id}:`, err.message);
      }
    }

    console.log('Capture complete:', {
      total_captured: results.captured.length,
      total_failed: results.failed.length,
      total_skipped: results.skipped.length,
    });

    return Response.json({
      success: results.failed.length === 0,
      summary: {
        captured: results.captured.length,
        failed: results.failed.length,
        skipped: results.skipped.length,
      },
      details: results,
    });
  } catch (error) {
    console.error('Capture batch error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});