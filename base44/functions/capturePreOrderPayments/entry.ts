import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Allow admin calls or scheduled automation (no user auth for scheduled)
    let isAdmin = false;
    try {
      const user = await base44.auth.me();
      isAdmin = user?.role === 'admin';
    } catch (_) {
      // Called from scheduled automation — allow via service role
    }

    // Fetch all uncaptured pre-orders
    const allOrders = await base44.asServiceRole.entities.Order.list('-created_date', 500);
    const pending = allOrders.filter(o => o.is_preorder === true && o.payment_captured !== true && o.stripe_payment_intent_id);

    console.log(`Found ${pending.length} pre-orders awaiting payment capture`);

    const results = { captured: [], failed: [], skipped: [] };

    for (const order of pending) {
      try {
        // Capture the authorized payment
        const paymentIntent = await stripe.paymentIntents.capture(order.stripe_payment_intent_id);
        console.log(`Captured payment for order ${order.order_number}: ${paymentIntent.id}`);

        // Update order: captured + move to in_production
        const statusHistory = order.status_history || [];
        statusHistory.push({
          status: 'in_production',
          timestamp: new Date().toISOString(),
          message: "It's launch day! Payment captured — your pre-order is now in production. Delivery: May 2nd. 🎉",
        });

        await base44.asServiceRole.entities.Order.update(order.id, {
          payment_captured: true,
          status: 'in_production',
          status_history: statusHistory,
        });

        // Award loyalty points: 10 pts per $1
        if (order.customer_email) {
          const pointsToAward = Math.floor((order.total || 0) * 10);
          const existing = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: order.customer_email });
          const entry = {
            amount: pointsToAward,
            type: 'earned',
            description: `Pre-order payment of $${(order.total || 0).toFixed(2)}`,
            timestamp: new Date().toISOString(),
          };
          if (existing.length > 0) {
            const rec = existing[0];
            await base44.asServiceRole.entities.UserPoints.update(rec.id, {
              total_points: (rec.total_points || 0) + pointsToAward,
              lifetime_points: (rec.lifetime_points || 0) + pointsToAward,
              points_history: [...(rec.points_history || []), entry],
            });
          } else {
            await base44.asServiceRole.entities.UserPoints.create({
              customer_email: order.customer_email,
              total_points: pointsToAward,
              lifetime_points: pointsToAward,
              redeemed_points: 0,
              points_history: [entry],
            });
          }

          // Send notification email
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: order.customer_email,
            subject: "It's launch day! Your NuVira pre-order is in production 🌿",
            body: `Great news! Today is May 1st — NuVira Juice Co. is officially launching!\n\nYour pre-order #${order.order_number} has been confirmed and we're juicing it fresh right now. Expect delivery tomorrow, May 2nd.\n\nThank you for believing in us from the start.\n\n— The NuVira Team`,
          });
        }

        results.captured.push(order.order_number);
      } catch (err) {
        console.error(`Failed to capture payment for order ${order.order_number}:`, err.message);

        // Notify customer of payment failure
        if (order.customer_email) {
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: order.customer_email,
            subject: 'Action Required — NuVira Pre-Order Payment Issue',
            body: `Hi there,\n\nWe attempted to process your pre-order #${order.order_number} on launch day but encountered a payment issue.\n\nPlease contact us or update your payment method so we can fulfill your order.\n\nWe're sorry for the inconvenience.\n\n— The NuVira Team`,
          });
        }

        results.failed.push({ order_number: order.order_number, error: err.message });
      }
    }

    console.log(`Capture complete. Captured: ${results.captured.length}, Failed: ${results.failed.length}`);
    return Response.json({ success: true, results });
  } catch (error) {
    console.error('capturePreOrderPayments error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});