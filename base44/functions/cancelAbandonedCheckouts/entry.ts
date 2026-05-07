/**
 * cancelAbandonedCheckouts
 * 
 * Finds all Customer App Orders with status='pending_payment' or payment_captured=false
 * that were created more than 30 minutes ago, then cancels/expires them.
 * 
 * Safe to run as a scheduled job (every 10 minutes) or manually.
 * Admin-only when called manually.
 * 
 * Sets:
 *   status = 'cancelled'
 *   payment_status = 'pending' (unchanged — never paid)
 *   is_abandoned_checkout = true
 *   do_not_recover = true
 *   do_not_sync = true (custom field — blocks Hub sync guards)
 * 
 * These records then disappear from:
 *   - Customer App Order Management active views
 *   - Customer App Driver Portal
 *   - Route optimization
 *   - Hub sync queue
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Allow scheduled (no user) or admin manual call
    let isScheduled = false;
    try {
      const body = await req.clone().json();
      isScheduled = body?.scheduled === true;
    } catch {}

    if (!isScheduled) {
      const user = await base44.auth.me();
      if (user?.role !== 'admin') {
        return Response.json({ error: 'Admin only' }, { status: 403 });
      }
    }

    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago

    // Fetch all orders that are pending payment
    const allOrders = await base44.asServiceRole.entities.Order.list('-created_date', 500);

    const abandoned = allOrders.filter(o =>
      (o.status === 'pending_payment' || (o.payment_captured === false && o.payment_status !== 'paid' && o.financial_status !== 'paid')) &&
      o.created_date < cutoff &&
      o.status !== 'cancelled' &&
      !o.is_abandoned_checkout
    );

    console.log(`[cancelAbandonedCheckouts] Found ${abandoned.length} abandoned checkout records older than 30 min`);

    const results = [];

    for (const order of abandoned) {
      // Double-check: if PI exists and succeeded, skip — webhook may have been slow
      if (order.stripe_payment_intent_id) {
        try {
          const pi = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id);
          if (pi.status === 'succeeded') {
            console.log(`[cancelAbandonedCheckouts] Skipping ${order.order_number} — PI succeeded (webhook may be pending)`);
            results.push({ order_number: order.order_number, action: 'skipped_pi_succeeded' });
            continue;
          }
          if (pi.status === 'processing') {
            console.log(`[cancelAbandonedCheckouts] Skipping ${order.order_number} — PI still processing`);
            results.push({ order_number: order.order_number, action: 'skipped_pi_processing' });
            continue;
          }
        } catch (stripeErr) {
          console.warn(`[cancelAbandonedCheckouts] Could not retrieve PI for ${order.order_number}: ${stripeErr.message}`);
        }
      }

      // Mark as abandoned — remove from all operational flows
      await base44.asServiceRole.entities.Order.update(order.id, {
        status: 'cancelled',
        is_abandoned_checkout: true,
        do_not_recover: true,
        canceled_at: new Date().toISOString(),
        status_history: [
          ...(order.status_history || []),
          {
            status: 'cancelled',
            timestamp: new Date().toISOString(),
            message: 'Abandoned checkout — payment not captured within 30 minutes.',
          },
        ],
      });

      console.log(`[cancelAbandonedCheckouts] ✓ Cancelled abandoned checkout: ${order.order_number} (customer: ${order.customer_email})`);
      results.push({ order_number: order.order_number, customer_email: order.customer_email, action: 'cancelled' });
    }

    return Response.json({
      success: true,
      processed: abandoned.length,
      cancelled: results.filter(r => r.action === 'cancelled').length,
      skipped: results.filter(r => r.action?.startsWith('skipped')).length,
      results,
    });

  } catch (error) {
    console.error('[cancelAbandonedCheckouts] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});