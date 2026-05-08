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

      // Fetch checkout data from entity (recovery layer)
      let orderData = {};
      try {
        const checkoutSessions = await base44.asServiceRole.entities.CheckoutSession.filter({ stripe_session_id: session.id });
        if (checkoutSessions.length > 0) {
          orderData = checkoutSessions[0].checkout_data || {};
          console.log(`CheckoutSession found for ${session.id}, checkout_data loaded`);
        } else {
          console.warn(`CheckoutSession not found for ${session.id} — will use metadata fallback`);
        }
      } catch (err) {
        console.error(`Failed to fetch CheckoutSession for ${session.id}: ${err.message} — using metadata fallback`);
      }

      // Build fallback orderData from Stripe metadata if CheckoutSession is missing
      // This ensures orders are NEVER lost due to CheckoutSession lookup failures
      if (!orderData.order_number && session.metadata?.order_number) {
        console.log(`Reconstructing orderData from Stripe metadata for order ${session.metadata.order_number}`);
        orderData = {
          order_number: session.metadata.order_number,
          customer_email: customerEmail || '',
          customer_name: session.metadata?.customer_name || '',
          address_line1: session.metadata?.delivery_address_line1 || '',
          address_line2: session.metadata?.delivery_address_line2 || '',
          address_city: session.metadata?.delivery_city || '',
          address_state: session.metadata?.delivery_state || '',
          address_postal_code: session.metadata?.delivery_postal_code || '',
          address_country: 'US',
          contact_phone: session.metadata?.customer_phone || '',
          items: [], // Metadata cannot store full items array, will be reconstructed from line_items
          subtotal: Math.round((session.amount_total || 0) / 100),
          delivery_fee: 0, // Cannot fully recover from metadata
          total: Math.round((session.amount_total || 0) / 100),
          fulfillment_type: session.metadata?.delivery_method || 'delivery',
          estimated_delivery_date: session.metadata?.requested_delivery_date || null,
          preorder_fulfillment_date: null,
        };
      }

      // Handle subscription checkout — create Subscription record
      if (session.mode === 'subscription' && session.metadata?.plan_id) {
        const planId = session.metadata.plan_id;
        const stripeSubscriptionId = session.subscription;

        if (!stripeSubscriptionId) {
          console.error(`[stripeWebhook] CRITICAL: Subscription checkout missing session.subscription for ${customerEmail}, plan ${planId}. Cannot proceed.`);
          await base44.asServiceRole.entities.OrderSyncLog.create({
            order_number: 'SUB_FAILED',
            status: 'error',
            description: `Subscription checkout for ${customerEmail} (plan ${planId}) failed: session.subscription is null/undefined. Stripe session: ${session.id}`,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            triggered_by: 'stripe_webhook',
          }).catch(() => {});
          return Response.json({ received: true });
        }

        console.log(`[stripeWebhook] Subscription checkout completed for ${customerEmail}, plan: ${planId}, stripe sub: ${stripeSubscriptionId}`);

        // CRITICAL: Load PendingSubscriptionCheckout for complete metadata
        const pendingCheckoutId = session.metadata?.pending_subscription_checkout_id;
        let pendingCheckout = null;
        
        if (pendingCheckoutId) {
          try {
            const pendings = await base44.asServiceRole.entities.PendingSubscriptionCheckout.filter({ id: pendingCheckoutId });
            if (pendings[0]) {
              pendingCheckout = pendings[0];
              console.log(`[stripeWebhook] Loaded PendingSubscriptionCheckout: ${pendingCheckoutId}`);
            }
          } catch (pendingErr) {
            console.error(`[stripeWebhook] Failed to load PendingSubscriptionCheckout ${pendingCheckoutId}: ${pendingErr.message}`);
          }
        }

        // Check if subscription already exists (avoid duplicates by stripe_subscription_id)
        const existingSubs = await base44.asServiceRole.entities.Subscription.filter({ customer_email: customerEmail });
        const alreadyExists = existingSubs.some(s => s.stripe_subscription_id === stripeSubscriptionId);

        if (!alreadyExists) {
          // Fetch plan + delivery zone
          const allPlans = await base44.asServiceRole.entities.SubscriptionPlan.list();
          const plan = allPlans.find(p => p.id === planId);
          
          const allZones = await base44.asServiceRole.entities.DeliveryZone.filter({ is_active: true });
          const defaultZone = allZones[0];

          // Use pending checkout data if available, fallback to metadata
          const bundleId = pendingCheckout?.bundle_id || session.metadata?.bundle_id || null;
          const deliveryAddress = pendingCheckout?.delivery_address || session.metadata?.delivery_address || '';
          const deliveryZoneId = pendingCheckout?.delivery_zone_id || defaultZone?.id || null;
          
          const productionDate = pendingCheckout?.production_date || session.metadata?.production_date || null;
          const firstDeliveryDate = pendingCheckout?.first_delivery_date || session.metadata?.first_delivery_date || null;
          const nextDeliveryDate = pendingCheckout?.next_delivery_date || null;

          if (!productionDate || !firstDeliveryDate) {
            console.error(`[stripeWebhook] CRITICAL: Missing production/delivery dates for subscription. pending=${pendingCheckoutId}, prod=${productionDate}, delivery=${firstDeliveryDate}`);
            await base44.asServiceRole.entities.OrderSyncLog.create({
              order_number: 'SUB_DATE_MISSING',
              status: 'error',
              description: `Subscription for ${customerEmail} missing production_date or first_delivery_date. Pending checkout: ${pendingCheckoutId}`,
              started_at: new Date().toISOString(),
              completed_at: new Date().toISOString(),
              triggered_by: 'stripe_webhook',
            }).catch(() => {});
            return Response.json({ received: true });
          }

          const subscription = await base44.asServiceRole.entities.Subscription.create({
            customer_email: customerEmail,
            stripe_subscription_id: stripeSubscriptionId,
            plan_id: planId,
            bundle_id: bundleId,
            delivery_zone_id: deliveryZoneId,
            delivery_address: deliveryAddress,
            status: 'active',
            started_date: firstDeliveryDate, // First delivery date as started date
            next_delivery_date: nextDeliveryDate || firstDeliveryDate,
          });
          console.log(`[stripeWebhook] Subscription record created: ${subscription.id}`);

          // Fetch customer profile
          const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: customerEmail });
          const profile = profiles[0] || {};
          const resolvedCustomerName = session.metadata?.customer_name || (profile.first_name && profile.last_name ? `${profile.first_name} ${profile.last_name}` : customerEmail);
          const resolvedPhone = session.metadata?.customer_phone || profile.phone || '';

          // Resolve address fields
          const resolvedAddressLine1 = pendingCheckout?.address_line1 || session.metadata?.delivery_address_line1 || '';
          const resolvedAddressLine2 = pendingCheckout?.address_line2 || session.metadata?.delivery_address_line2 || '';
          const resolvedAddressCity = pendingCheckout?.address_city || session.metadata?.delivery_city || '';
          const resolvedAddressState = pendingCheckout?.address_state || session.metadata?.delivery_state || '';
          const resolvedAddressZip = pendingCheckout?.address_postal_code || session.metadata?.delivery_postal_code || '';
          const resolvedDeliveryWindowLabel = pendingCheckout?.delivery_window_label || session.metadata?.delivery_window_label || '5 PM – 8 PM';
          const resolvedDeliveryWindowStart = pendingCheckout?.delivery_window_start || session.metadata?.delivery_window_start || '17:00';
          const resolvedDeliveryWindowEnd = pendingCheckout?.delivery_window_end || session.metadata?.delivery_window_end || '20:00';

          // Resolve decomposed weekly fulfillment products (NEVER send plan totals to Hub)
          // Priority: PendingSubscriptionCheckout.products → plan.composition_template → fallback
          let productsArray = pendingCheckout?.products || [];
          if (productsArray.length === 0 && plan?.composition_template?.bottles_per_delivery?.length > 0) {
            // Use per-delivery quantities (already decomposed — e.g. 1x AURA not 4x)
            productsArray = plan.composition_template.bottles_per_delivery.map(bottle => ({
              product_name: bottle.flavor || 'Juice',
              quantity: bottle.quantity || 1,
            }));
          }

          // Build items_summary from actual decomposed products
          const resolvedItemsSummary = productsArray.length > 0
            ? productsArray.map(p => `${p.quantity}x ${p.product_name}`).join(', ')
            : (session.metadata?.items_summary || plan?.name || 'Unknown');

          // Fulfillment cadence fields
          const billingCadence = plan?.frequency || session.metadata?.billing_cadence || 'monthly';
          const fulfillmentCadence = 'weekly';
          const fulfillmentsPerCycle = plan?.composition_template?.deliveries_per_cycle
            || parseInt(session.metadata?.fulfillments_per_cycle || '0')
            || (billingCadence === 'monthly' ? 4 : 1);

          console.log(`[stripeWebhook] Hub products (decomposed): ${resolvedItemsSummary} | billing=${billingCadence} fulfillment=${fulfillmentCadence} fulfillments_per_cycle=${fulfillmentsPerCycle}`);

          // Build complete Hub payload per required contract
          const hubPayload = {
            event: 'customer.subscription_created',
            event_type: 'customer.subscription_created',
            source: 'customer_app',
            customer_email: customerEmail,
            data: {
              // IDs
              subscription_id: subscription.id,
              customer_app_subscription_id: subscription.id,
              stripe_subscription_id: stripeSubscriptionId,
              stripe_customer_id: session.customer || null,
              first_invoice_id: session.invoice || null,
              payment_intent_id: session.payment_intent || null,
              // Customer
              customer_name: resolvedCustomerName,
              customer_email: customerEmail,
              phone: resolvedPhone,
              // Payment
              payment_status: 'paid',
              financial_status: 'paid',
              // Plan
              plan_id: planId,
              plan_name: plan?.name || 'Unknown',
              billing_cadence: billingCadence,
              fulfillment_cadence: fulfillmentCadence,
              fulfillments_per_cycle: fulfillmentsPerCycle,
              fulfillment_number: 1,
              // Order type
              order_type: 'subscription',
              source_type: 'subscription_fulfillment',
              // Dates
              production_date: productionDate,
              first_delivery_date: firstDeliveryDate,
              next_delivery_date: nextDeliveryDate || firstDeliveryDate,
              subscription_started_date: firstDeliveryDate,
              // Delivery window
              delivery_window_label: resolvedDeliveryWindowLabel,
              delivery_window_start: resolvedDeliveryWindowStart,
              delivery_window_end: resolvedDeliveryWindowEnd,
              // Address
              delivery_address: deliveryAddress,
              address_line1: resolvedAddressLine1,
              address_line2: resolvedAddressLine2,
              address_city: resolvedAddressCity,
              address_state: resolvedAddressState,
              address_postal_code: resolvedAddressZip,
              address_country: 'US',
              delivery_zone_id: deliveryZoneId,
              // Products — decomposed weekly quantities, NOT monthly totals
              products: productsArray,
              items_summary: resolvedItemsSummary,
            },
          };

          // Update pending checkout as completed
          if (pendingCheckoutId) {
            try {
              await base44.asServiceRole.entities.PendingSubscriptionCheckout.update(pendingCheckoutId, {
                status: 'completed',
                completed_at: new Date().toISOString(),
                stripe_subscription_id: stripeSubscriptionId,
                hub_payload: hubPayload,
              });
              console.log(`[stripeWebhook] PendingSubscriptionCheckout ${pendingCheckoutId} marked completed`);
            } catch (updateErr) {
              console.warn(`[stripeWebhook] Failed to update PendingSubscriptionCheckout: ${updateErr.message}`);
            }
          }

          // Sync to Hub
          base44.asServiceRole.functions.invoke('syncCustomerToHub', hubPayload)
            .catch(err => console.error('[stripeWebhook] Failed to sync subscription to hub:', err.message));

        } else {
          console.log(`[stripeWebhook] Subscription already exists for ${customerEmail} (stripe_sub=${stripeSubscriptionId}), skipping creation`);
        }

        // Award loyalty points for subscription payment (10 pts per $1) — exactly once per stripe subscription
        if (customerEmail && amountPaid > 0) {
        const pointsToAward = Math.floor(amountPaid * 10);
        const stripeSubId = session.subscription;

        // Idempotency: check if points already awarded for this subscription
        const existing = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: customerEmail });
        if (existing[0]) {
          // Check by subscription ID in description to prevent duplicate awards
          const alreadyAwarded = existing[0].points_history?.some(h => 
            h.description?.includes(`(subscription ${stripeSubId})`) ||
            h.description?.includes(`stripe_subscription_id=${stripeSubId}`)
          );
          if (!alreadyAwarded) {
            const entry = {
              amount: pointsToAward,
              type: 'earned',
              description: `Subscription payment of $${amountPaid.toFixed(2)} (subscription ${stripeSubId})`,
              timestamp: new Date().toISOString(),
            };
            const history = [...(existing[0].points_history || []), entry];
            await base44.asServiceRole.entities.UserPoints.update(existing[0].id, {
              total_points: (existing[0].total_points || 0) + pointsToAward,
              lifetime_points: (existing[0].lifetime_points || 0) + pointsToAward,
              points_history: history,
            });
            console.log(`[stripeWebhook] Awarded ${pointsToAward} pts to ${customerEmail} for subscription ${stripeSubId}`);
          } else {
            console.log(`[stripeWebhook] Points already awarded for subscription ${stripeSubId}, skipping`);
          }
        } else {
          const entry = {
            amount: pointsToAward,
            type: 'earned',
            description: `Subscription payment of $${amountPaid.toFixed(2)} (subscription ${stripeSubId})`,
            timestamp: new Date().toISOString(),
          };
          await base44.asServiceRole.entities.UserPoints.create({
            customer_email: customerEmail,
            total_points: pointsToAward,
            lifetime_points: pointsToAward,
            redeemed_points: 0,
            points_history: [entry],
          });
          console.log(`[stripeWebhook] Created points record and awarded ${pointsToAward} pts to ${customerEmail} for subscription ${stripeSubId}`);
        }
        }
      }

      // For regular one-time orders: create the order NOW after payment succeeds
      // NOTE: Skip order creation for subscription checkouts — Hub owns subscription delivery generation
      if (session.mode !== 'subscription') {
        const orderNumber = orderData.order_number || session.metadata?.order_number;

        // IDEMPOTENCY: Check if order already exists by stripe_checkout_session_id or order_number
        // This prevents duplicate orders if webhook retries or fires multiple times
        const existingOrders = await base44.asServiceRole.entities.Order.filter({ 
          stripe_checkout_session_id: session.id 
        });
        if (existingOrders.length > 0) {
          console.log(`Order already created for session ${session.id}: ${existingOrders[0].order_number}, skipping`);
          return Response.json({ received: true }); // Idempotent: return success without re-creating
        }

        // Fallback: if CheckoutSession lookup failed, log warning but continue with metadata
        if (!orderData.order_number) {
          console.warn(`CheckoutSession not found for session ${session.id}, using metadata fallback`);
        }

        // Validate referral code if provided
        if (orderData.referral_code && customerEmail) {
          const prevOrders = await base44.asServiceRole.entities.Order.filter({ customer_email: customerEmail });
          const alreadyUsed = prevOrders.some(o => o.referral_code === orderData.referral_code);
          if (alreadyUsed) {
            console.warn(`Referral code ${orderData.referral_code} already used by ${customerEmail}, ignoring`);
            orderData.referral_code = null;
          }
        }

        // Hydrate items from Stripe line_items if orderData.items is empty (metadata fallback path)
        let resolvedItems = orderData.items || [];
        if (resolvedItems.length === 0) {
          try {
            const stripeLineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 20 });
            resolvedItems = (stripeLineItems.data || [])
              .filter(li => li.description !== 'Delivery Fee')
              .map(li => ({
                title: li.description || li.price?.product?.name || 'Item',
                quantity: li.quantity || 1,
                price: (li.price?.unit_amount || 0) / 100,
                product_id: li.price?.product || '',
              }));
            console.log(`[stripeWebhook] Hydrated ${resolvedItems.length} items from Stripe line_items for ${orderNumber}`);
          } catch (liErr) {
            console.warn(`[stripeWebhook] Could not fetch line_items for ${session.id}: ${liErr.message}`);
          }
        }

        // Hydrate delivery fields from Stripe metadata if missing from CheckoutSession
        const resolvedAddressLine1   = orderData.address_line1   || session.metadata?.delivery_address_line1 || '';
        const resolvedAddressCity    = orderData.address_city    || session.metadata?.delivery_city    || '';
        const resolvedAddressState   = orderData.address_state   || session.metadata?.delivery_state   || '';
        const resolvedAddressZip     = orderData.address_postal_code || session.metadata?.delivery_postal_code || '';
        const resolvedPhone          = orderData.contact_phone   || session.metadata?.customer_phone   || '';
        const resolvedCustomerName   = orderData.customer_name   || session.metadata?.customer_name    || '';
        const resolvedDeliveryDate   = orderData.estimated_delivery_date || session.metadata?.selected_delivery_date || session.metadata?.requested_delivery_date || null;
        const resolvedProductionDate = orderData.production_date || session.metadata?.production_date  || null;
        const resolvedWindowLabel    = orderData.delivery_window_label || session.metadata?.delivery_window_label || '5 PM – 8 PM';
        const resolvedWindowStart    = orderData.delivery_window_start || session.metadata?.delivery_window_start || '17:00';
        const resolvedWindowEnd      = orderData.delivery_window_end   || session.metadata?.delivery_window_end   || '20:00';
        const resolvedDeliveryAddress = orderData.delivery_address || [resolvedAddressLine1, resolvedAddressCity, resolvedAddressState, resolvedAddressZip].filter(Boolean).join(', ');

        console.log(`[stripeWebhook] Resolved order fields: name="${resolvedCustomerName}" addr="${resolvedAddressLine1}, ${resolvedAddressCity}" delivery="${resolvedDeliveryDate}" window="${resolvedWindowLabel}" items=${resolvedItems.length}`);

        // Create the order
        const order = await base44.asServiceRole.entities.Order.create({
          order_number: orderNumber,
          customer_email: customerEmail || '',
          customer_name: resolvedCustomerName,
          items: resolvedItems,
          subtotal: orderData.subtotal || 0,
          delivery_fee: orderData.delivery_fee || 0,
          total: orderData.total || 0,
          fulfillment_type: orderData.fulfillment_type || 'delivery',
          delivery_address: resolvedDeliveryAddress,
          address_line1: resolvedAddressLine1,
          address_line2: orderData.address_line2 || session.metadata?.delivery_address_line2 || '',
          address_city: resolvedAddressCity,
          address_state: resolvedAddressState,
          address_postal_code: resolvedAddressZip,
          address_country: orderData.address_country || 'US',
          contact_phone: resolvedPhone,
          estimated_delivery_date: resolvedDeliveryDate,
          assigned_delivery_date: resolvedDeliveryDate,
          production_date: resolvedProductionDate,
          delivery_window_label: resolvedWindowLabel,
          assigned_delivery_window_start: resolvedWindowStart,
          assigned_delivery_window_end: resolvedWindowEnd,
          payment_status: 'paid',
          financial_status: 'paid',
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
          is_preorder: orderData.is_preorder || false,
          payment_captured: true,
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: session.payment_intent || null,
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

        // Sync to hub — pass stripe session for correct payment_status mapping
        try {
          await base44.asServiceRole.functions.invoke('syncOrderToHub', {
            order_id: order.id,
            stripe_session: {
              payment_status: session.payment_status, // 'paid' from Stripe
              id: session.id,
            },
            triggered_by: 'stripe_webhook',
          });
          console.log(`✅ Order ${orderNumber} synced to Hub successfully`);
        } catch (syncErr) {
          console.error(`❌ CRITICAL: Order ${orderNumber} (${order.id}) failed to sync to Hub: ${syncErr.message}`);
          try {
            await base44.asServiceRole.entities.OrderSyncLog.create({
              order_number: orderNumber,
              status: 'error',
              description: `Failed to sync to Hub immediately after webhook: ${syncErr.message}`,
              started_at: new Date().toISOString(),
              completed_at: new Date().toISOString(),
              triggered_by: 'stripe_webhook',
            });
          } catch (logErr) {
            console.error(`Failed to log sync failure: ${logErr.message}`);
          }
          throw new Error(`Hub sync failed for order ${orderNumber}: ${syncErr.message}`);
        }

        // Send order confirmation email
        base44.asServiceRole.functions.invoke('sendOrderReceivedNotification', {
          order_id: order.id,
          customer_email: customerEmail,
          order_number: orderNumber,
          items: resolvedItems,
          total: order.total || orderData.total || 0,
          delivery_address: resolvedDeliveryAddress,
          estimated_delivery_date: resolvedDeliveryDate,
          assigned_delivery_date: resolvedDeliveryDate,
          delivery_window_label: resolvedWindowLabel,
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
        if (resolvedPhone) {
          base44.asServiceRole.functions.invoke('sendOrderSms', {
            phone_number: resolvedPhone,
            order_number: orderNumber,
            items: resolvedItems,
            total: order.total || orderData.total || 0,
            assigned_delivery_date: resolvedDeliveryDate,
            delivery_window_label: resolvedWindowLabel,
          })
            .catch(err => console.error('Failed to send order confirmation SMS:', err.message));
        }
      }

      // Award loyalty points: 10 pts per $1 spent — BUT NOT FOR PRE-ORDERS until May 1st
      if (customerEmail && session.metadata?.is_preorder !== 'true') {
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

    // ── EMBEDDED CHECKOUT: payment_intent.succeeded ──────────────────────────
    // Triggered when the in-app PaymentElement flow completes successfully.
    // Finds the pre-created pending Order and finalizes it.
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      const meta = pi.metadata || {};
      const orderNumber   = meta.order_number;
      const customerEmail = meta.customer_email || pi.receipt_email;
      const amountPaid    = pi.amount_received / 100;

      // Only handle orders created by the embedded flow (checkout_version 3.0_embedded)
      if (meta.checkout_version !== '3.0_embedded') {
        console.log(`[PI succeeded] Skipping PI ${pi.id} — not embedded checkout (version=${meta.checkout_version})`);
        return Response.json({ received: true });
      }

      if (!orderNumber) {
        console.error(`[PI succeeded] No order_number in metadata for PI ${pi.id}`);
        return Response.json({ received: true });
      }

      console.log(`[PI succeeded] PI ${pi.id} for order ${orderNumber}, customer ${customerEmail}, amount $${amountPaid}`);

      // Find pre-created pending Order
      const existingOrders = await base44.asServiceRole.entities.Order.filter({ stripe_payment_intent_id: pi.id });

      if (existingOrders.length > 0) {
        const order = existingOrders[0];

        // Idempotency: already finalized
        if (order.payment_captured === true) {
          console.log(`[PI succeeded] Order ${orderNumber} already finalized, skipping`);
          return Response.json({ received: true });
        }

        // Safety: do not finalize a cancelled/abandoned order
        if (order.is_abandoned_checkout || order.do_not_recover) {
          console.warn(`[PI succeeded] Order ${orderNumber} is marked abandoned/do_not_recover — skipping finalization`);
          return Response.json({ received: true });
        }

        // Finalize the order — promote from pending_payment to operational
        const statusHistory = [...(order.status_history || []), {
          status: 'scheduled_for_juicing',
          timestamp: new Date().toISOString(),
          message: 'Payment confirmed — your order is scheduled for juicing!',
        }];

        await base44.asServiceRole.entities.Order.update(order.id, {
          status:           'scheduled_for_juicing',
          payment_status:   'paid',
          financial_status: 'paid',
          payment_captured: true,
          status_history:   statusHistory,
        });
        console.log(`[PI succeeded] Order ${orderNumber} finalized`);

        // Validate referral code
        if (order.referral_code && customerEmail) {
          const prevOrders = await base44.asServiceRole.entities.Order.filter({ customer_email: customerEmail });
          const alreadyUsed = prevOrders.filter(o => o.id !== order.id).some(o => o.referral_code === order.referral_code);
          if (alreadyUsed) {
            await base44.asServiceRole.entities.Order.update(order.id, { referral_code: null });
          }
        }

        // Deduct points / credits from CheckoutSession data
        let checkoutData = {};
        try {
          const csSessions = await base44.asServiceRole.entities.CheckoutSession.filter({ stripe_session_id: pi.id });
          if (csSessions[0]) checkoutData = csSessions[0].checkout_data || {};
        } catch {}

        if (customerEmail && (checkoutData.points_used || checkoutData.active_reward?.points_required)) {
          const existing = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: customerEmail });
          if (existing[0]) {
            const deductPoints = (checkoutData.points_used || 0) + (checkoutData.active_reward?.points_required || 0);
            const historyEntries = [];
            if (checkoutData.points_used) historyEntries.push({ amount: -checkoutData.points_used, type: 'redeemed', description: 'Redeemed at checkout', timestamp: new Date().toISOString() });
            if (checkoutData.active_reward?.points_required) historyEntries.push({ amount: -checkoutData.active_reward.points_required, type: 'redeemed', description: `Redeemed: ${checkoutData.active_reward.title}`, timestamp: new Date().toISOString() });
            await base44.asServiceRole.entities.UserPoints.update(existing[0].id, {
              total_points:    Math.max(0, (existing[0].total_points || 0) - deductPoints),
              redeemed_points: (existing[0].redeemed_points || 0) + deductPoints,
              points_history:  [...(existing[0].points_history || []), ...historyEntries],
            });
          }
        }

        if (customerEmail && checkoutData.credits_discount > 0) {
          const creditRecs = await base44.asServiceRole.entities.NuViraCredit.filter({ customer_email: customerEmail });
          if (creditRecs[0]) {
            const rec = creditRecs[0];
            await base44.asServiceRole.entities.NuViraCredit.update(rec.id, {
              balance:       Math.max(0, (rec.balance || 0) - checkoutData.credits_discount),
              lifetime_used: (rec.lifetime_used || 0) + checkoutData.credits_discount,
              history: [...(rec.history || []), { amount: checkoutData.credits_discount, type: 'used', description: `Applied to order ${orderNumber}`, order_id: order.id, timestamp: new Date().toISOString() }],
            });
          }
        }

        // Award loyalty points
        if (customerEmail) {
          const pointsToAward = Math.floor(amountPaid * 10);
          const existing = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: customerEmail });
          const entry = { amount: pointsToAward, type: 'earned', description: `Order payment of $${amountPaid.toFixed(2)}`, timestamp: new Date().toISOString() };
          if (existing.length > 0) {
            await base44.asServiceRole.entities.UserPoints.update(existing[0].id, {
              total_points:    (existing[0].total_points || 0) + pointsToAward,
              lifetime_points: (existing[0].lifetime_points || 0) + pointsToAward,
              points_history:  [...(existing[0].points_history || []), entry],
            });
          } else {
            await base44.asServiceRole.entities.UserPoints.create({ customer_email: customerEmail, total_points: pointsToAward, lifetime_points: pointsToAward, redeemed_points: 0, points_history: [entry] });
          }
        }

        // Push to Shopify
        base44.asServiceRole.functions.invoke('pushOrderToShopify', { order_id: order.id })
          .catch(err => console.error('[PI succeeded] Shopify push failed:', err.message));

        // Sync to Hub
        try {
          await base44.asServiceRole.functions.invoke('syncOrderToHub', {
            order_id:    order.id,
            stripe_session: { payment_status: 'paid', id: pi.id },
            triggered_by: 'stripe_webhook',
          });
          console.log(`[PI succeeded] ✅ Order ${orderNumber} synced to Hub`);
        } catch (syncErr) {
          console.error(`[PI succeeded] ❌ Hub sync failed for ${orderNumber}: ${syncErr.message}`);
          try {
            await base44.asServiceRole.entities.OrderSyncLog.create({
              order_number: orderNumber, status: 'error',
              description: `Hub sync failed after PI succeeded: ${syncErr.message}`,
              started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
              triggered_by: 'stripe_webhook',
            });
          } catch {}
        }

        // Send notifications
        base44.asServiceRole.functions.invoke('sendOrderReceivedNotification', {
          order_id: order.id, customer_email: customerEmail, order_number: orderNumber,
          items:                  order.items,
          total:                  order.total,
          delivery_address:       order.delivery_address,
          assigned_delivery_date: order.assigned_delivery_date,
          delivery_window_label:  order.delivery_window_label,
        }).catch(err => console.error('[PI succeeded] Email failed:', err.message));

        if (order.contact_phone) {
          base44.asServiceRole.functions.invoke('sendOrderSms', {
            phone_number:           order.contact_phone,
            order_number:           orderNumber,
            items:                  order.items,
            total:                  order.total,
            assigned_delivery_date: order.assigned_delivery_date,
            delivery_window_label:  order.delivery_window_label,
          }).catch(err => console.error('[PI succeeded] SMS failed:', err.message));
        }

        base44.asServiceRole.functions.invoke('notifyOrderProcessed', {
          order_id: order.id, order_number: orderNumber, customer_email: customerEmail,
        }).catch(err => console.error('[PI succeeded] Ops notify failed:', err.message));

      } else {
        // Pre-created Order not found — create it now from metadata (safety net)
        console.warn(`[PI succeeded] Pre-created Order not found for PI ${pi.id}, creating from metadata`);
        const resolvedAddr = [meta.delivery_address_line1, meta.delivery_city, meta.delivery_state, meta.delivery_postal_code].filter(Boolean).join(', ');
        const newOrder = await base44.asServiceRole.entities.Order.create({
          order_number:    orderNumber,
          customer_email:  customerEmail || '',
          customer_name:   meta.customer_name || '',
          items:           [],
          subtotal:        amountPaid,
          total:           amountPaid,
          fulfillment_type: meta.delivery_method || 'delivery',
          delivery_address: resolvedAddr,
          address_line1:   meta.delivery_address_line1 || '',
          address_city:    meta.delivery_city    || '',
          address_state:   meta.delivery_state   || '',
          address_postal_code: meta.delivery_postal_code || '',
          address_country: 'US',
          contact_phone:   meta.customer_phone   || '',
          estimated_delivery_date:  meta.selected_delivery_date || null,
          assigned_delivery_date:   meta.selected_delivery_date || null,
          delivery_window_label:    meta.delivery_window_label  || '5 PM – 8 PM',
          assigned_delivery_window_start: meta.delivery_window_start || '17:00',
          assigned_delivery_window_end:   meta.delivery_window_end   || '20:00',
          status:           'scheduled_for_juicing',
          payment_status:   'paid',
          financial_status: 'paid',
          payment_captured: true,
          stripe_payment_intent_id: pi.id,
          is_preorder:      false,
          status_history: [
            { status: 'order_received', timestamp: new Date().toISOString(), message: 'Order received.' },
            { status: 'scheduled_for_juicing', timestamp: new Date().toISOString(), message: 'Payment confirmed.' },
          ],
        });
        console.log(`[PI succeeded] Safety-net Order created: ${newOrder.id}`);

        // Sync safety-net order to Hub
        base44.asServiceRole.functions.invoke('syncOrderToHub', {
          order_id: newOrder.id,
          stripe_session: { payment_status: 'paid', id: pi.id },
          triggered_by: 'stripe_webhook',
        }).catch(err => console.error('[PI succeeded] Hub sync failed (safety-net):', err.message));

        // Notifications
        base44.asServiceRole.functions.invoke('sendOrderReceivedNotification', {
          order_id: newOrder.id, customer_email: customerEmail, order_number: orderNumber,
          items: [], total: amountPaid,
          assigned_delivery_date: meta.selected_delivery_date,
          delivery_window_label:  meta.delivery_window_label || '5 PM – 8 PM',
        }).catch(() => {});
      }

      return Response.json({ received: true });
    }

    // Embedded checkout: payment failed — mark pending order as cancelled/abandoned
    if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object;
      const orderNumber = pi.metadata?.order_number;
      if (orderNumber && pi.metadata?.checkout_version === '3.0_embedded') {
        console.log(`[PI payment_failed] PI ${pi.id} failed for order ${orderNumber}`);
        const orders = await base44.asServiceRole.entities.Order.filter({ stripe_payment_intent_id: pi.id });
        if (orders.length > 0 && !orders[0].payment_captured) {
          await base44.asServiceRole.entities.Order.update(orders[0].id, {
            status: 'cancelled',
            is_abandoned_checkout: true,
            do_not_recover: true,
            canceled_at: new Date().toISOString(),
            status_history: [
              ...(orders[0].status_history || []),
              { status: 'cancelled', timestamp: new Date().toISOString(), message: 'Payment failed — checkout abandoned.' },
            ],
          });
          console.log(`[PI payment_failed] Marked order ${orderNumber} as abandoned`);
        }
      }
      return Response.json({ received: true });
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

    // ── REFUND HANDLER: charge.refunded ──────────────────────────────────────
    // Triggered when Stripe issues a refund (full or partial).
    // ROUTING: subscription PIs are detected FIRST via Stripe PI→invoice→subscription lookup.
    // One-time order path only runs if no subscription is found.
    if (event.type === 'charge.refunded') {
      const charge = event.data.object;
      // Normalize: charge.payment_intent may be a string ID or an expanded object
      const paymentIntentId = typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id || null;
      const refundAmount = charge.amount_refunded / 100; // cents to dollars
      const isFullRefund = charge.amount_refunded === charge.amount;
      const stripeEventId = event.id; // for idempotency logging

      console.log(`[charge.refunded] event=${stripeEventId} PI=${paymentIntentId}, refunded $${refundAmount} (${isFullRefund ? 'FULL' : 'PARTIAL'})`);

      if (!paymentIntentId) {
        console.error('[charge.refunded] No payment_intent in charge event');
        return Response.json({ received: true });
      }

      // ── STEP 1: Always check if PI belongs to a subscription invoice FIRST ──
      // Subscriptions never create Customer App Order records, so we must probe
      // Stripe before falling through to the Order lookup.
      let stripeSubscriptionId = null;
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (pi.invoice) {
          const invoiceId = typeof pi.invoice === 'string' ? pi.invoice : pi.invoice.id;
          const invoice = await stripe.invoices.retrieve(invoiceId);
          stripeSubscriptionId = typeof invoice.subscription === 'string'
            ? invoice.subscription
            : invoice.subscription?.id || null;
          console.log(`[charge.refunded] PI belongs to invoice ${invoice.id}, subscription=${stripeSubscriptionId || 'none'}`);
        } else {
          console.log(`[charge.refunded] PI has no invoice — one-time order path`);
        }
      } catch (piErr) {
        console.error(`[charge.refunded] Failed to retrieve PI/invoice for ${paymentIntentId}: ${piErr.message}`);
      }

      // ── STEP 2: Subscription refund path ────────────────────────────────────
      if (stripeSubscriptionId) {
        console.log(`[charge.refunded] SUBSCRIPTION REFUND PATH — stripe_sub=${stripeSubscriptionId}`);

        const subResults = await base44.asServiceRole.entities.Subscription.filter({ stripe_subscription_id: stripeSubscriptionId });
        const subscription = subResults[0];

        if (subscription) {
          const subEmail = subscription.customer_email;
          const pointsToReverse = Math.floor(refundAmount * 10); // $144 → 1440

          // --- Loyalty reversal (idempotent) ---
          const pointsRecs = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: subEmail });
          let loyaltyAction = 'skipped_no_record';
          if (pointsRecs[0]) {
            const rec = pointsRecs[0];
            const alreadyReversed = rec.points_history?.some(h =>
              h.description?.includes('subscription refund') && h.description?.includes(stripeSubscriptionId)
            );
            if (!alreadyReversed) {
              const entry = {
                amount: -pointsToReverse,
                type: 'adjustment',
                description: `Points reversed: subscription refund (subscription ${stripeSubscriptionId}), refund $${refundAmount.toFixed(2)}`,
                timestamp: new Date().toISOString(),
              };
              await base44.asServiceRole.entities.UserPoints.update(rec.id, {
                total_points: Math.max(0, (rec.total_points || 0) - pointsToReverse),
                points_history: [...(rec.points_history || []), entry],
              });
              loyaltyAction = `reversed_${pointsToReverse}_pts`;
              console.log(`[charge.refunded] ✅ Reversed ${pointsToReverse} loyalty pts for ${subEmail}`);
            } else {
              loyaltyAction = 'already_reversed_idempotent';
              console.log(`[charge.refunded] Loyalty already reversed for sub ${stripeSubscriptionId}, skipping`);
            }
          }

          // --- Mark Subscription cancelled (idempotent) ---
          let subAction = 'already_cancelled';
          if (subscription.status !== 'cancelled') {
            await base44.asServiceRole.entities.Subscription.update(subscription.id, { status: 'cancelled' });
            subAction = 'marked_cancelled';
            console.log(`[charge.refunded] ✅ Subscription ${subscription.id} marked cancelled`);
          } else {
            console.log(`[charge.refunded] Subscription ${subscription.id} already cancelled, skipping`);
          }

          // --- Notify Hub (await, tolerate no-op) ---
          let hubResult = 'not_sent';
          try {
            const hubResp = await base44.asServiceRole.functions.invoke('syncCustomerToHub', {
              event: 'customer.subscription_cancelled',
              customer_email: subEmail,
              data: {
                subscription_id: subscription.id,
                customer_app_subscription_id: subscription.id,
                stripe_subscription_id: stripeSubscriptionId,
                customer_email: subEmail,
                cancellation_reason: 'refunded',
                refund_amount: refundAmount,
                is_full_refund: isFullRefund,
                payment_intent_id: paymentIntentId,
                cancelled_at: new Date().toISOString(),
              },
            });
            hubResult = hubResp?.hub_response?.status || hubResp?.success ? 'sent_ok' : 'sent_noop';
            console.log(`[charge.refunded] Hub cancel notify result: ${hubResult}`);
          } catch (hubErr) {
            hubResult = `failed: ${hubErr.message}`;
            console.error(`[charge.refunded] Hub cancel notify failed: ${hubErr.message}`);
          }

          // --- Audit log ---
          await base44.asServiceRole.entities.OrderSyncLog.create({
            order_number: `SUB-${stripeSubscriptionId}`,
            status: 'success',
            hub_action: 'subscription_refund_cancelled',
            description: `Subscription refund processed: $${refundAmount} (${isFullRefund ? 'FULL' : 'PARTIAL'}). sub_action=${subAction}. loyalty=${loyaltyAction}. hub=${hubResult}. event=${stripeEventId}. Sub ID=${subscription.id}`,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            triggered_by: 'stripe_refund_webhook',
          }).catch(() => {});

          return Response.json({ received: true, path: 'subscription_refund', sub_action: subAction, loyalty_action: loyaltyAction, hub_result: hubResult });

        } else {
          // Subscription found in Stripe but not in CA — log for manual review
          console.warn(`[charge.refunded] No CA Subscription found for stripe_subscription_id=${stripeSubscriptionId}`);
          await base44.asServiceRole.entities.OrderSyncLog.create({
            order_number: `SUB-${stripeSubscriptionId}`,
            status: 'error',
            description: `Subscription refund received but no CA Subscription record found. stripe_sub=${stripeSubscriptionId}, PI=${paymentIntentId}, amount=$${refundAmount}. Manual review required.`,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            triggered_by: 'stripe_refund_webhook',
          }).catch(() => {});
          return Response.json({ received: true, path: 'subscription_refund_no_ca_record' });
        }
      }

      // ── STEP 3: One-time order refund path (only if NOT a subscription PI) ──
      const orders = await base44.asServiceRole.entities.Order.filter({ stripe_payment_intent_id: paymentIntentId });

      if (orders.length === 0) {
        console.warn(`[charge.refunded] No order or subscription found for PI ${paymentIntentId}`);
        try {
          await base44.asServiceRole.entities.OrderSyncLog.create({
            order_number: 'UNKNOWN',
            status: 'error',
            description: `[charge.refunded] No CA order or subscription found for PI ${paymentIntentId}. Refund: $${refundAmount}. Manual review required.`,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            triggered_by: 'stripe_refund_webhook',
          });
        } catch {}
        return Response.json({ received: true });
      }

      const order = orders[0];
      const orderNumber = order.order_number;

      // IDEMPOTENCY: Check if already refunded
      if (order.payment_status === 'refunded' || order.status === 'refunded' || order.status === 'cancelled') {
        console.log(`[charge.refunded] Order ${orderNumber} already refunded/cancelled, skipping`);
        return Response.json({ received: true, action: 'already_refunded' });
      }

      console.log(`[charge.refunded] Processing refund for Order ${orderNumber} (${order.id}), customer ${order.customer_email}`);

      // Determine refund type and action
      let newStatus = 'refunded';
      let action = 'full_refund_processed';
      
      if (!isFullRefund) {
        // Partial refund policy: flag for manual review, do NOT auto-cancel
        console.warn(`[charge.refunded] PARTIAL refund detected for ${orderNumber}. Flagging for manual review.`);
        action = 'partial_refund_manual_review';
        // For partial refunds, we still mark as refunded but operations should review
        newStatus = 'refunded';
      }

      // Update Customer App Order
      const statusHistory = [...(order.status_history || []), {
        status: newStatus,
        timestamp: new Date().toISOString(),
        message: `Stripe refund received: $${refundAmount} (${isFullRefund ? 'full' : 'partial'} refund). Refund ID: ${charge.id}`,
      }];

      await base44.asServiceRole.entities.Order.update(order.id, {
        status: newStatus,
        payment_status: 'refunded',
        financial_status: 'refunded',
        payment_captured: false,
        refunded_at: new Date().toISOString(),
        refund_id: charge.id,
        refund_amount: refundAmount,
        is_partial_refund: !isFullRefund,
        sync_status: 'refund_pending_hub_sync',
        status_history: statusHistory,
      });

      console.log(`[charge.refunded] Order ${orderNumber} updated: payment_status=refunded, status=${newStatus}`);

      // Create RefundSyncLog for audit trail
      try {
        await base44.asServiceRole.entities.OrderSyncLog.create({
          order_number: orderNumber,
          status: 'success',
          hub_action: 'refund_received',
          description: `💰 Stripe refund received: $${refundAmount} (${isFullRefund ? 'FULL' : 'PARTIAL'}). Refund ID: ${charge.id}. Customer App order updated. Syncing to Hub...`,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          triggered_by: 'stripe_webhook',
        });
      } catch (logErr) {
        console.warn(`[charge.refunded] Failed to log refund: ${logErr.message}`);
      }

      // Sync refund to Hub via shared helper
      try {
        const refundSyncResult = await base44.asServiceRole.functions.invoke('syncRefundToHub', {
          order_id: order.id,
          stripe_session: { id: charge.id },
          triggered_by: 'stripe_refund_webhook',
        });
        if (refundSyncResult?.success) {
          console.log(`[charge.refunded] ✅ Order ${orderNumber} refund synced to Hub successfully`);
        } else {
          console.error(`[charge.refunded] ⚠️ Order ${orderNumber} refund sync returned: ${refundSyncResult?.error}`);
        }
      } catch (syncErr) {
        console.error(`[charge.refunded] ❌ Hub sync helper failed for ${orderNumber}: ${syncErr.message}`);
        try {
          await base44.asServiceRole.entities.OrderSyncLog.create({
            order_number: orderNumber,
            status: 'error',
            description: `Failed to sync refund to Hub: ${syncErr.message}. Manual sync required.`,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            triggered_by: 'stripe_refund_webhook',
          });
        } catch {}
      }

      // Restore loyalty points if full refund
      if (isFullRefund && order.customer_email) {
        const pointsToRestore = Math.floor(order.total * 10);
        const existing = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: order.customer_email });
        
        if (existing.length > 0) {
          const entry = {
            amount: pointsToRestore,
            type: 'adjustment',
            description: `Points restored due to refund of order ${orderNumber}`,
            timestamp: new Date().toISOString(),
          };
          await base44.asServiceRole.entities.UserPoints.update(existing[0].id, {
            total_points: (existing[0].total_points || 0) + pointsToRestore,
            lifetime_points: (existing[0].lifetime_points || 0) + pointsToRestore,
            points_history: [...(existing[0].points_history || []), entry],
          });
          console.log(`[charge.refunded] Restored ${pointsToRestore} points to ${order.customer_email}`);
        }
      }

      // Send refund notification email
      base44.asServiceRole.functions.invoke('sendOrderReceivedNotification', {
        order_id: order.id,
        customer_email: order.customer_email,
        order_number: orderNumber,
        items: order.items,
        total: order.total,
        delivery_address: order.delivery_address,
        estimated_delivery_date: order.estimated_delivery_date,
        assigned_delivery_date: order.assigned_delivery_date,
        delivery_window_label: order.delivery_window_label,
        refund_notification: true,
        refund_amount: refundAmount,
        is_full_refund: isFullRefund,
      }).catch(err => console.error('[charge.refunded] Email failed:', err.message));

      return Response.json({ received: true, action, refund_amount: refundAmount });
    }

    // ── REFUND UPDATE: refund.updated (for status changes) ───────────────────
    // Optional: Handle refund status updates if needed
    if (event.type === 'refund.updated') {
      const refund = event.data.object;
      const paymentIntentId = refund.payment_intent;
      
      console.log(`[refund.updated] Refund ${refund.id} for PI ${paymentIntentId} updated to status: ${refund.status}`);
      
      if (!paymentIntentId) {
        return Response.json({ received: true });
      }

      const orders = await base44.asServiceRole.entities.Order.filter({ stripe_payment_intent_id: paymentIntentId });
      if (orders.length > 0) {
        const order = orders[0];
        // Update refund status if needed (mostly for audit)
        console.log(`[refund.updated] Order ${order.order_number} linked to refund ${refund.id}, status: ${refund.status}`);
      }
      
      return Response.json({ received: true });
    }

    return Response.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
});