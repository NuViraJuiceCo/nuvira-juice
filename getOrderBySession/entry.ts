import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

/**
 * Look up an order by Stripe session_id.
 * 1. Check local Order entity by stripe_checkout_session_id
 * 2. Check CheckoutSession entity → get order_number → lookup Order
 * 3. Fetch Stripe session → get order_number from metadata → lookup Order
 * Returns { order, session_status, payment_status, order_number } or throws if not found yet.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { session_id } = await req.json();

    if (!session_id) {
      return Response.json({ error: 'session_id is required' }, { status: 400 });
    }

    console.log(`[getOrderBySession] Looking up session: ${session_id}`);

    // 1. Try local Order entity by stripe_checkout_session_id
    try {
      const ordersBySession = await base44.asServiceRole.entities.Order.filter({
        stripe_checkout_session_id: session_id,
      });
      if (ordersBySession.length > 0) {
        console.log(`[getOrderBySession] Found order by stripe_checkout_session_id: ${ordersBySession[0].order_number}`);
        return Response.json({ order: ordersBySession[0], found: true });
      }
    } catch (e) {
      console.warn('[getOrderBySession] Error querying by stripe_checkout_session_id:', e.message);
    }

    // 2. Look up CheckoutSession entity to get order_number
    let orderNumber = null;
    try {
      const checkoutSessions = await base44.asServiceRole.entities.CheckoutSession.filter({
        stripe_session_id: session_id,
      });
      if (checkoutSessions.length > 0) {
        orderNumber = checkoutSessions[0].order_number;
        console.log(`[getOrderBySession] Found order_number from CheckoutSession: ${orderNumber}`);
      }
    } catch (e) {
      console.warn('[getOrderBySession] Error querying CheckoutSession:', e.message);
    }

    // 3. If no local record, fetch from Stripe directly
    let stripeSession = null;
    try {
      stripeSession = await stripe.checkout.sessions.retrieve(session_id);
      if (!orderNumber && stripeSession.metadata?.order_number) {
        orderNumber = stripeSession.metadata.order_number;
        console.log(`[getOrderBySession] Got order_number from Stripe metadata: ${orderNumber}`);
      }
    } catch (e) {
      console.error('[getOrderBySession] Error fetching Stripe session:', e.message);
      return Response.json({ error: 'Failed to fetch session from Stripe' }, { status: 500 });
    }

    const sessionStatus = stripeSession?.status;
    const paymentStatus = stripeSession?.payment_status;

    // 4. Look up Order by order_number
    if (orderNumber) {
      try {
        const orders = await base44.asServiceRole.entities.Order.filter({ order_number: orderNumber });
        if (orders.length > 0) {
          console.log(`[getOrderBySession] Found order by order_number: ${orderNumber}`);
          return Response.json({
            order: orders[0],
            found: true,
            session_status: sessionStatus,
            payment_status: paymentStatus,
            order_number: orderNumber,
          });
        }
      } catch (e) {
        console.warn('[getOrderBySession] Error querying by order_number:', e.message);
      }
    }

    // Order not found yet — return session status so frontend knows whether to keep polling
    console.log(`[getOrderBySession] Order not found yet. session_status=${sessionStatus}, payment_status=${paymentStatus}, order_number=${orderNumber}`);
    return Response.json({
      found: false,
      session_status: sessionStatus,
      payment_status: paymentStatus,
      order_number: orderNumber || null,
    });

  } catch (error) {
    console.error('[getOrderBySession] Unexpected error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});