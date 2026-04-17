import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return Response.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const base44 = createClientFromRequest(req);

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const orderId = session.metadata?.order_id;
      const customerEmail = session.customer_email || session.metadata?.customer_email;
      const amountPaid = session.amount_total / 100; // convert cents to dollars

      // Update order status to confirmed
      if (orderId) {
        const orders = await base44.asServiceRole.entities.Order.filter({ id: orderId });
        if (orders.length > 0) {
          const order = orders[0];

          // For pre-orders: payment is authorized but NOT captured yet.
          // Store the payment intent ID and leave status as order_received.
          const isPreorder = session.metadata?.is_preorder === 'true' || order.is_preorder;

          if (isPreorder) {
            // Capture the payment_intent ID from the session
            const paymentIntentId = session.payment_intent;
            const updates = {};
            if (paymentIntentId) updates.stripe_payment_intent_id = paymentIntentId;
            if (Object.keys(updates).length > 0) {
              await base44.asServiceRole.entities.Order.update(orderId, updates);
            }
            console.log(`Pre-order ${orderId} authorized. PaymentIntent: ${paymentIntentId}. Will capture on Apr 30.`);
          } else {
            // Regular order: mark as scheduled for juicing
            const statusHistory = order.status_history || [];
            statusHistory.push({
              status: 'scheduled_for_juicing',
              timestamp: new Date().toISOString(),
              message: 'Payment confirmed — your order is scheduled for juicing!',
            });
            await base44.asServiceRole.entities.Order.update(orderId, {
              status: 'scheduled_for_juicing',
              status_history: statusHistory,
              payment_captured: true,
            });
            console.log(`Order ${orderId} updated to scheduled_for_juicing`);

            // Push this order into Shopify so both systems stay in sync
            base44.asServiceRole.functions.invoke('pushOrderToShopify', { order_id: orderId })
              .catch(err => console.error('Failed to push order to Shopify:', err.message));
          }
        }
      }

      // Award loyalty points: 10 pts per $1 spent
      if (customerEmail) {
        const pointsToAward = Math.floor(amountPaid * 10);
        const existing = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: customerEmail });

        const entry = {
          amount: pointsToAward,
          type: 'earned',
          description: `Order payment of $${amountPaid.toFixed(2)}`,
          timestamp: new Date().toISOString(),
        };

        if (existing.length > 0) {
          const rec = existing[0];
          const history = rec.points_history || [];
          history.push(entry);
          await base44.asServiceRole.entities.UserPoints.update(rec.id, {
            total_points: (rec.total_points || 0) + pointsToAward,
            lifetime_points: (rec.lifetime_points || 0) + pointsToAward,
            points_history: history,
          });
          console.log(`Awarded ${pointsToAward} pts to ${customerEmail}`);
        } else {
          await base44.asServiceRole.entities.UserPoints.create({
            customer_email: customerEmail,
            total_points: pointsToAward,
            lifetime_points: pointsToAward,
            redeemed_points: 0,
            points_history: [entry],
          });
          console.log(`Created points record and awarded ${pointsToAward} pts to ${customerEmail}`);
        }
      }
    }

    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      const customerEmail = sub.metadata?.customer_email;
      if (customerEmail) {
        const existingSubs = await base44.asServiceRole.entities.Subscription.filter({ customer_email: customerEmail });
        const newStatus = sub.status === 'active' ? 'active' : sub.status === 'paused' ? 'paused' : 'cancelled';
        if (existingSubs.length > 0) {
          await base44.asServiceRole.entities.Subscription.update(existingSubs[0].id, { status: newStatus });
          console.log(`Subscription for ${customerEmail} updated to ${newStatus}`);
        }
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const customerEmail = sub.metadata?.customer_email;
      if (customerEmail) {
        const existingSubs = await base44.asServiceRole.entities.Subscription.filter({ customer_email: customerEmail });
        if (existingSubs.length > 0) {
          await base44.asServiceRole.entities.Subscription.update(existingSubs[0].id, { status: 'cancelled' });
          console.log(`Subscription for ${customerEmail} cancelled`);
        }
      }
    }

    return Response.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
});