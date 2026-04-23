import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
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
      const customerEmail = session.customer_email || session.metadata?.customer_email;
      const amountPaid = session.amount_total / 100; // convert cents to dollars

      // Fetch checkout data from entity
      let orderData = {};
      const checkoutSessions = await base44.asServiceRole.entities.CheckoutSession.filter({ stripe_session_id: session.id });
      if (checkoutSessions.length > 0) {
        orderData = checkoutSessions[0].checkout_data || {};
      }

      // For pre-orders: create the order NOW, after payment authorization succeeds
      if (session.metadata?.is_preorder === 'true') {

        const orderNumber = orderData.order_number || session.metadata?.order_number;
        const paymentIntentId = session.payment_intent;

        // Validate referral code if provided
        if (orderData.referral_code && customerEmail) {
          const prevOrders = await base44.asServiceRole.entities.Order.filter({ customer_email: customerEmail });
          const alreadyUsed = prevOrders.some(o => o.referral_code === orderData.referral_code);
          if (alreadyUsed) {
            console.warn(`Referral code ${orderData.referral_code} already used by ${customerEmail}, ignoring`);
            orderData.referral_code = null;
          }
        }

        // Create the order in the database
        const order = await base44.asServiceRole.entities.Order.create({
          order_number: orderNumber,
          customer_email: customerEmail || '',
          items: orderData.items || [],
          subtotal: orderData.subtotal || 0,
          delivery_fee: orderData.delivery_fee || 0,
          total: orderData.total || 0,
          fulfillment_type: orderData.fulfillment_type || 'delivery',
          delivery_address: orderData.delivery_address || '',
          contact_phone: orderData.contact_phone || '',
          estimated_delivery_date: orderData.estimated_delivery_date,
          status: 'order_received',
          status_history: [{
            status: 'order_received',
            timestamp: new Date().toISOString(),
            message: "Pre-order authorized! Payment will be captured on May 1st when production begins. Delivery: May 2nd.",
          }],
          is_preorder: true,
          preorder_fulfillment_date: orderData.preorder_fulfillment_date,
          payment_captured: false,
          stripe_payment_intent_id: paymentIntentId,
          stripe_checkout_session_id: session.id,
          referral_code: orderData.referral_code || null,
        });

        console.log(`Pre-order ${order.id} (${orderNumber}) created after payment authorization. PaymentIntent: ${paymentIntentId}`);

        // Deduct points and credits after order is confirmed
        if (customerEmail && (orderData.points_used || orderData.active_reward?.points_required)) {
          const existing = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: customerEmail });
          if (existing[0]) {
            const deductPoints = (orderData.points_used || 0) + (orderData.active_reward?.points_required || 0);
            const historyEntries = [];
            if (orderData.points_used) {
              historyEntries.push({ amount: -orderData.points_used, type: 'redeemed', description: 'Redeemed at checkout', timestamp: new Date().toISOString() });
            }
            if (orderData.active_reward?.points_required) {
              historyEntries.push({ amount: -orderData.active_reward.points_required, type: 'redeemed', description: `Redeemed: ${orderData.active_reward.title}`, timestamp: new Date().toISOString() });
            }
            await base44.asServiceRole.entities.UserPoints.update(existing[0].id, {
              total_points: Math.max(0, (existing[0].total_points || 0) - deductPoints),
              redeemed_points: (existing[0].redeemed_points || 0) + deductPoints,
              points_history: [...(existing[0].points_history || []), ...historyEntries],
            });
          }
        }

        if (customerEmail && orderData.credits_discount > 0) {
          const creditRecs = await base44.asServiceRole.entities.NuViraCredit.filter({ customer_email: customerEmail });
          if (creditRecs[0]) {
            const rec = creditRecs[0];
            const entry = {
              amount: orderData.credits_discount,
              type: 'used',
              description: `Applied to order ${orderNumber}`,
              order_id: order.id,
              timestamp: new Date().toISOString(),
            };
            await base44.asServiceRole.entities.NuViraCredit.update(rec.id, {
              balance: Math.max(0, (rec.balance || 0) - orderData.credits_discount),
              lifetime_used: (rec.lifetime_used || 0) + orderData.credits_discount,
              history: [...(rec.history || []), entry],
            });
          }
        }

        // Send pre-order confirmation email
        base44.asServiceRole.functions.invoke('sendOrderReceivedNotification', {
          order_id: order.id,
          customer_email: customerEmail,
          order_number: orderNumber,
          is_preorder: true,
        })
          .catch(err => console.error('Failed to send pre-order confirmation email:', err.message));

        // Sync to hub
        base44.asServiceRole.functions.invoke('syncOrderToHub', { order_id: order.id })
          .catch(err => console.error('Failed to sync pre-order to hub:', err.message));
      }

      // Handle subscription checkout — create Subscription record
      if (session.mode === 'subscription' && session.metadata?.plan_id) {
        const planId = session.metadata.plan_id;
        const deliveryAddress = session.metadata.delivery_address || '';
        const stripeSubscriptionId = session.subscription;

        console.log(`Subscription checkout completed for ${customerEmail}, plan: ${planId}`);

        // Calculate next delivery date (next week for weekly, next month for monthly)
        const allPlans = await base44.asServiceRole.entities.SubscriptionPlan.list();
        const plan = allPlans.find(p => p.id === planId);
        const now = new Date();
        let nextDelivery = new Date(now);
        if (plan?.frequency === 'weekly') {
          nextDelivery.setDate(now.getDate() + 7);
        } else {
          nextDelivery.setMonth(now.getMonth() + 1);
        }
        const nextDeliveryStr = nextDelivery.toISOString().split('T')[0];

        // Check if subscription already exists (avoid duplicates)
        const existing = await base44.asServiceRole.entities.Subscription.filter({ customer_email: customerEmail });
        const alreadyExists = existing.some(s => s.plan_id === planId && s.status === 'active');

        if (!alreadyExists) {
          await base44.asServiceRole.entities.Subscription.create({
            customer_email: customerEmail,
            plan_id: planId,
            bundle_id: session.metadata.bundle_id || null,
            delivery_address: deliveryAddress,
            status: 'active',
            started_date: now.toISOString().split('T')[0],
            next_delivery_date: nextDeliveryStr,
          });
          console.log(`Subscription record created for ${customerEmail}`);
        } else {
          console.log(`Subscription already exists for ${customerEmail}, skipping creation`);
        }
      }

      // For regular orders (non-pre-order): create the order NOW after payment succeeds
      if (session.metadata?.is_preorder !== 'true') {
        const orderNumber = orderData.order_number || session.metadata?.order_number;

        // Validate referral code if provided
        if (orderData.referral_code && customerEmail) {
          const prevOrders = await base44.asServiceRole.entities.Order.filter({ customer_email: customerEmail });
          const alreadyUsed = prevOrders.some(o => o.referral_code === orderData.referral_code);
          if (alreadyUsed) {
            console.warn(`Referral code ${orderData.referral_code} already used by ${customerEmail}, ignoring`);
            orderData.referral_code = null;
          }
        }

        // Create the order
        const order = await base44.asServiceRole.entities.Order.create({
          order_number: orderNumber,
          customer_email: customerEmail || '',
          items: orderData.items || [],
          subtotal: orderData.subtotal || 0,
          delivery_fee: orderData.delivery_fee || 0,
          total: orderData.total || 0,
          fulfillment_type: orderData.fulfillment_type || 'delivery',
          delivery_address: orderData.delivery_address || '',
          contact_phone: orderData.contact_phone || '',
          estimated_delivery_date: orderData.estimated_delivery_date,
          status: 'scheduled_for_juicing',
          status_history: [{
            status: 'order_received',
            timestamp: new Date().toISOString(),
            message: 'We\'ve received your order!',
          }, {
            status: 'scheduled_for_juicing',
            timestamp: new Date().toISOString(),
            message: 'Payment confirmed — your order is scheduled for juicing!',
          }],
          is_preorder: false,
          payment_captured: true,
          stripe_checkout_session_id: session.id,
          referral_code: orderData.referral_code || null,
        });

        console.log(`Regular order ${order.id} (${orderNumber}) created after payment completed`);

        // Deduct points and credits after order is confirmed
        if (customerEmail && (orderData.points_used || orderData.active_reward?.points_required)) {
          const existing = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: customerEmail });
          if (existing[0]) {
            const deductPoints = (orderData.points_used || 0) + (orderData.active_reward?.points_required || 0);
            const historyEntries = [];
            if (orderData.points_used) {
              historyEntries.push({ amount: -orderData.points_used, type: 'redeemed', description: 'Redeemed at checkout', timestamp: new Date().toISOString() });
            }
            if (orderData.active_reward?.points_required) {
              historyEntries.push({ amount: -orderData.active_reward.points_required, type: 'redeemed', description: `Redeemed: ${orderData.active_reward.title}`, timestamp: new Date().toISOString() });
            }
            await base44.asServiceRole.entities.UserPoints.update(existing[0].id, {
              total_points: Math.max(0, (existing[0].total_points || 0) - deductPoints),
              redeemed_points: (existing[0].redeemed_points || 0) + deductPoints,
              points_history: [...(existing[0].points_history || []), ...historyEntries],
            });
          }
        }

        if (customerEmail && orderData.credits_discount > 0) {
          const creditRecs = await base44.asServiceRole.entities.NuViraCredit.filter({ customer_email: customerEmail });
          if (creditRecs[0]) {
            const rec = creditRecs[0];
            const entry = {
              amount: orderData.credits_discount,
              type: 'used',
              description: `Applied to order ${orderNumber}`,
              order_id: order.id,
              timestamp: new Date().toISOString(),
            };
            await base44.asServiceRole.entities.NuViraCredit.update(rec.id, {
              balance: Math.max(0, (rec.balance || 0) - orderData.credits_discount),
              lifetime_used: (rec.lifetime_used || 0) + orderData.credits_discount,
              history: [...(rec.history || []), entry],
            });
          }
        }

        // Push this order into Shopify
        base44.asServiceRole.functions.invoke('pushOrderToShopify', { order_id: order.id })
          .catch(err => console.error('Failed to push order to Shopify:', err.message));

        // Sync to hub
        base44.asServiceRole.functions.invoke('syncOrderToHub', { order_id: order.id })
          .catch(err => console.error('Failed to sync order to hub:', err.message));

        // Send order confirmation email
        base44.asServiceRole.functions.invoke('sendOrderReceivedNotification', {
          order_id: order.id,
          customer_email: customerEmail,
          order_number: orderNumber,
        })
          .catch(err => console.error('Failed to send order confirmation email:', err.message));

        // Send operations notification
        base44.asServiceRole.functions.invoke('notifyOrderProcessed', {
          order_id: order.id,
          order_number: orderNumber,
          customer_email: customerEmail,
        })
          .catch(err => console.error('Failed to send operations notification:', err.message));

        // Send SMS if phone provided
        if (orderData.contact_phone) {
          base44.asServiceRole.functions.invoke('sendOrderSms', {
            phone_number: orderData.contact_phone,
            order_number: orderNumber,
          })
            .catch(err => console.error('Failed to send order confirmation SMS:', err.message));
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

    // Pre-order cancellation: customer canceled before payment was captured
    if (event.type === 'payment_intent.canceled') {
      const paymentIntent = event.data.object;
      const paymentIntentId = paymentIntent.id;

      console.log(`payment_intent.canceled received for PaymentIntent: ${paymentIntentId}`);

      // Find the pre-order order linked to this payment intent
      const orders = await base44.asServiceRole.entities.Order.filter({ stripe_payment_intent_id: paymentIntentId });
      if (orders.length > 0) {
        const order = orders[0];
        const statusHistory = order.status_history || [];
        statusHistory.push({
          status: 'cancelled',
          timestamp: new Date().toISOString(),
          message: 'Pre-order cancelled by customer before payment was captured.',
        });
        await base44.asServiceRole.entities.Order.update(order.id, {
          status: 'cancelled',
          status_history: statusHistory,
        });
        console.log(`Pre-order ${order.id} (order #${order.order_number}) marked as cancelled due to PaymentIntent cancellation.`);

        // Create an operational alert so the team is notified
        await base44.asServiceRole.entities.OperationalAlert.create({
          alert_type: 'cancellation',
          title: `Pre-Order Cancelled: #${order.order_number || order.id}`,
          message: `Customer ${order.customer_email} cancelled their pre-order before payment capture. No juices should be made for this order.`,
          shopify_order_id: order.shopify_order_id || null,
          order_number: order.order_number || null,
          severity: 'warning',
        });
      } else {
        console.log(`payment_intent.canceled: no matching pre-order found for PaymentIntent ${paymentIntentId}`);
      }
    }

    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      const customerEmail = sub.metadata?.customer_email;
      if (customerEmail) {
        const existingSubs = await base44.asServiceRole.entities.Subscription.filter({ customer_email: customerEmail });
        const newStatus = sub.status === 'active' ? 'active' : sub.status === 'paused' ? 'paused' : 'cancelled';
        // Calculate next delivery from Stripe's current_period_end
        const nextDeliveryStr = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString().split('T')[0]
          : undefined;
        if (existingSubs.length > 0) {
          const updates = { status: newStatus };
          if (nextDeliveryStr) updates.next_delivery_date = nextDeliveryStr;
          await base44.asServiceRole.entities.Subscription.update(existingSubs[0].id, updates);
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