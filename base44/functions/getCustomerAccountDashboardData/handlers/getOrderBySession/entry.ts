// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

async function requireAuthenticatedUser(base44) {
  const user = await base44.auth.me().catch(() => null);
  if (!user?.email) {
    return { response: Response.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  return { user };
}

function authorizeOrderAccess(user, order) {
  const requester = String(user?.email || '').trim().toLowerCase();
  const owner = String(order?.customer_email || '').trim().toLowerCase();
  if (user?.role === 'admin' || requester === owner) {
    return null;
  }
  return Response.json({ error: 'forbidden' }, { status: 403 });
}

function isPlausibleStripeSessionId(value) {
  return /^cs_(?:(?:test|live)_)?[A-Za-z0-9]{16,}$/.test(String(value || '').trim());
}

function isStripeMissingResource(error) {
  return error?.code === 'resource_missing' || error?.statusCode === 404 || error?.status === 404;
}

/**
 * Look up an order by Stripe session_id.
 * 1. Check local Order entity by stripe_checkout_session_id
 * 2. Check CheckoutSession entity → get order_number → lookup Order
 * 3. Fetch Stripe session → get order_number from metadata → lookup Order
 * Returns { order, session_status, payment_status, order_number } or throws if not found yet.
 */
export default async function handler(req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const { session_id } = await req.json();

    if (!session_id) {
      return Response.json({ error: 'session_id is required' }, { status: 400 });
    }
    if (!isPlausibleStripeSessionId(session_id)) {
      return Response.json({ error: 'invalid session_id' }, { status: 400 });
    }
    const auth = await requireAuthenticatedUser(base44);
    if (auth.response) return auth.response;

    console.log(`[getOrderBySession] Looking up session: ${session_id}`);

    // 1. Try local Order entity by stripe_checkout_session_id
    try {
      const ordersBySession = await base44.asServiceRole.entities.Order.filter({
        stripe_checkout_session_id: session_id,
      });
      if (ordersBySession.length > 0) {
        console.log(`[getOrderBySession] Found order by stripe_checkout_session_id: ${ordersBySession[0].order_number}`);
        const forbidden = authorizeOrderAccess(auth.user, ordersBySession[0]);
        if (forbidden) return forbidden;
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
      if (isStripeMissingResource(e)) {
        console.warn('[getOrderBySession] Checkout session not found');
        return Response.json({
          found: false,
          session_status: null,
          payment_status: null,
          order_number: orderNumber || null,
        });
      }
      console.error('[getOrderBySession] Stripe session lookup unavailable:', e.message);
      return Response.json({ error: 'Unable to verify checkout session' }, { status: 502 });
    }

    const sessionStatus = stripeSession?.status;
    const paymentStatus = stripeSession?.payment_status;

    // 4. Look up Order by order_number
    if (orderNumber) {
      try {
        const orders = await base44.asServiceRole.entities.Order.filter({ order_number: orderNumber });
        if (orders.length > 0) {
          console.log(`[getOrderBySession] Found order by order_number: ${orderNumber}`);
          const forbidden = authorizeOrderAccess(auth.user, orders[0]);
          if (forbidden) return forbidden;
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
}
