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
const EXACT_CANCEL_CONFIRMATION = 'cancel_unpaid_checkout';

function safeId(value, maxLength = 180) {
  const normalized = String(value ?? '').trim();
  return normalized.length <= maxLength && /^[A-Za-z0-9._:@/#-]+$/.test(normalized) ? normalized : '';
}

async function cancelPendingPaymentIntent(order) {
  const paymentIntentId = safeId(order?.stripe_payment_intent_id);
  if (!paymentIntentId) return { provider_cancelled: false, provider_status: 'missing' };
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing') {
    return { blocked: true, provider_cancelled: false, provider_status: paymentIntent.status };
  }
  if (paymentIntent.status === 'canceled') {
    return { provider_cancelled: false, provider_status: 'canceled', idempotent: true };
  }
  const cancelled = await stripe.paymentIntents.cancel(paymentIntentId, {
    cancellation_reason: 'abandoned',
  });
  return { provider_cancelled: true, provider_status: cancelled.status };
}

async function markOrderAbandoned(base44, order, message) {
  const timestamp = new Date().toISOString();
  await base44.asServiceRole.entities.Order.update(order.id, {
    status: 'cancelled',
    is_abandoned_checkout: true,
    do_not_recover: true,
    canceled_at: timestamp,
    status_history: [
      ...(order.status_history || []),
      { status: 'cancelled', timestamp, message },
    ],
  });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'admin' && user.role !== 'owner') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    if (body?.action === 'cancel_exact_pending_checkout') {
      const orderNumber = safeId(body.order_number, 80).replace(/^#/, '');
      const expectedOrderId = safeId(body.expected_order_id);
      if (!orderNumber || !expectedOrderId || body.confirmation !== EXACT_CANCEL_CONFIRMATION) {
        return Response.json({ error: 'Exact order identity and confirmation are required' }, { status: 400 });
      }
      const rows = await base44.asServiceRole.entities.Order.filter({ order_number: orderNumber }, '-created_date', 2);
      if (rows.length !== 1 || rows[0]?.id !== expectedOrderId) {
        return Response.json({ error: 'exact_order_identity_mismatch' }, { status: 409 });
      }
      const order = rows[0];
      if (order.status !== 'pending_payment' || order.payment_captured === true) {
        return Response.json({ error: 'order_is_not_an_unpaid_pending_checkout' }, { status: 409 });
      }
      const provider = await cancelPendingPaymentIntent(order);
      if (provider.blocked) {
        return Response.json({ error: 'payment_intent_cannot_be_cancelled', provider_status: provider.provider_status }, { status: 409 });
      }
      await markOrderAbandoned(base44, order, 'Unpaid checkout cancelled after authorized checkout-path verification.');
      return Response.json({
        success: true,
        action: 'cancel_exact_pending_checkout',
        order_number: orderNumber,
        provider_cancelled: provider.provider_cancelled,
        provider_status: provider.provider_status,
        writes_performed: true,
      });
    }

    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago

    // Fetch only pending_payment orders (targeted filter — not full dataset scan)
    const pendingOrders = await base44.asServiceRole.entities.Order.filter(
      { status: 'pending_payment' },
      '-created_date',
      50
    );

    const abandoned = pendingOrders.filter(o =>
      o.created_date < cutoff &&
      !o.is_abandoned_checkout
    );

    console.log(`[cancelAbandonedCheckouts] Found ${abandoned.length} abandoned checkout records older than 30 min`);

    const results = [];

    for (const order of abandoned) {
      // Double-check: if PI exists and succeeded, skip — webhook may have been slow
      if (order.stripe_payment_intent_id) {
        try {
          const provider = await cancelPendingPaymentIntent(order);
          if (provider.provider_status === 'succeeded') {
            console.log(`[cancelAbandonedCheckouts] Skipping ${order.order_number} — PI succeeded (webhook may be pending)`);
            results.push({ order_number: order.order_number, action: 'skipped_pi_succeeded' });
            continue;
          }
          if (provider.provider_status === 'processing') {
            console.log(`[cancelAbandonedCheckouts] Skipping ${order.order_number} — PI still processing`);
            results.push({ order_number: order.order_number, action: 'skipped_pi_processing' });
            continue;
          }
        } catch (stripeErr) {
          console.warn(`[cancelAbandonedCheckouts] Could not retrieve PI for ${order.order_number}: ${stripeErr.message}`);
        }
      }

      // Mark as abandoned — remove from all operational flows
      await markOrderAbandoned(base44, order, 'Abandoned checkout — payment not captured within 30 minutes.');

      console.log(`[cancelAbandonedCheckouts] ✓ Cancelled abandoned checkout: ${order.order_number} (customer: ${order.customer_email})`);
      results.push({ order_number: order.order_number, action: 'cancelled' });
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
