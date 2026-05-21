import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));
const LOCKED_FINAL_SCHEDULE_SOURCES = new Set([
  'backend_cadence',
  'admin_override',
  'route_review_approval',
  'subscription_renewal',
  'legacy_migration',
  'unknown',
]);

function resolveFinalScheduleSource(source, fallback = 'backend_cadence') {
  const candidate = source || fallback;
  return LOCKED_FINAL_SCHEDULE_SOURCES.has(candidate) ? candidate : fallback;
}

function isStagingSafeMode() {
  return Deno.env.get('NUVIRA_STAGING_SAFE_MODE') === 'true';
}

function skipLoyaltyWrite(stagingSafeMode) {
  if (!stagingSafeMode) return false;
  console.log('[stripeWebhook] STAGING SAFE MODE: skipped loyalty/UserPoints write');
  return true;
}

function installStagingSideEffectGuards(base44, stagingSafeMode) {
  if (!stagingSafeMode) return;

  const sideEffectFunctions = new Set([
    'syncSubscriptionWithFulfillments',
    'pushOrderToShopify',
    'syncOrderToHub',
    'sendOrderReceivedNotification',
    'notifyOrderProcessed',
    'sendCustomerNotification',
    'sendOrderSms',
    'sendPushNotification',
    'syncCustomerToHub',
    'syncRefundToHub',
  ]);

  const originalInvoke = base44.asServiceRole.functions.invoke.bind(base44.asServiceRole.functions);
  base44.asServiceRole.functions.invoke = (name, payload) => {
    if (sideEffectFunctions.has(name)) {
      console.log(`[stripeWebhook] STAGING SAFE MODE: skipped side-effect function ${name}`);
      return Promise.resolve({ data: { skipped: true, function_name: name } });
    }
    return originalInvoke(name, payload);
  };

  const sendEmail = base44.asServiceRole.integrations?.Core?.SendEmail;
  if (sendEmail) {
    base44.asServiceRole.integrations.Core.SendEmail = (payload) => {
      console.log(`[stripeWebhook] STAGING SAFE MODE: skipped email send to ${payload?.to || 'unknown'}`);
      return Promise.resolve({ skipped: true });
    };
  }

  const userPoints = base44.asServiceRole.entities.UserPoints;
  if (userPoints) {
    userPoints.filter = () => {
      console.log('[stripeWebhook] STAGING SAFE MODE: skipped UserPoints lookup');
      return Promise.resolve([]);
    };
    userPoints.create = () => {
      console.log('[stripeWebhook] STAGING SAFE MODE: skipped UserPoints create');
      return Promise.resolve({ skipped: true });
    };
    userPoints.update = () => {
      console.log('[stripeWebhook] STAGING SAFE MODE: skipped UserPoints update');
      return Promise.resolve({ skipped: true });
    };
  }
}

Deno.serve(async (req) => {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    // TEMPORARY DIAGNOSTIC LOGGING FOR INVALID SIGNATURE
    const secretExists = !!webhookSecret;
    const secretLength = webhookSecret?.length || 0;
    const secretPrefix = webhookSecret ? `${webhookSecret.substring(0, 6)}...${webhookSecret.substring(secretLength - 4)}` : 'MISSING';
    const signatureExists = !!signature;
    const bodyLength = body?.length || 0;
    const requestPath = req.url;
    const webhookBuildId = 'canonical-we-1TVFMc-2026-05-09-v1';
    
    console.error('Webhook signature verification failed:', err.message);
    console.error(`[DIAGNOSTICS] STRIPE_WEBHOOK_SECRET exists: ${secretExists}`);
    console.error(`[DIAGNOSTICS] STRIPE_WEBHOOK_SECRET length: ${secretLength}`);
    console.error(`[DIAGNOSTICS] STRIPE_WEBHOOK_SECRET prefix/suffix: ${secretPrefix}`);
    console.error(`[DIAGNOSTICS] Stripe-Signature header exists: ${signatureExists}`);
    console.error(`[DIAGNOSTICS] Request body length: ${bodyLength}`);
    console.error(`[DIAGNOSTICS] Request path: ${requestPath}`);
    console.error(`[DIAGNOSTICS] WEBHOOK_BUILD_ID: ${webhookBuildId}`);
    
    return Response.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const base44 = createClientFromRequest(req);
  const stagingSafeMode = isStagingSafeMode();
  installStagingSideEffectGuards(base44, stagingSafeMode);

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

        // UNIQUENESS GUARD: Search directly by stripe_subscription_id — never by email alone.
        const existingSubs = await base44.asServiceRole.entities.Subscription.filter({ stripe_subscription_id: stripeSubscriptionId });
        const alreadyExists = existingSubs.length > 0;
        // Retire any extra duplicates found
        if (existingSubs.length > 1) {
          for (const dup of existingSubs.slice(1)) {
            console.warn(`[checkout.completed] Retiring duplicate CA record ${dup.id} for stripe_sub=${stripeSubscriptionId}`);
            await base44.asServiceRole.entities.Subscription.update(dup.id, {
              status: 'cancelled', hub_sync_status: 'skipped',
              description: `[DUPLICATE RETIRED] Retired by uniqueness guard in checkout.session.completed. Canonical: ${existingSubs[0].id}. ${new Date().toISOString()}`,
            }).catch(() => {});
          }
        }

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
            started_date: firstDeliveryDate,
            next_delivery_date: nextDeliveryDate || firstDeliveryDate,
          });
          console.log(`[stripeWebhook] Subscription record created: ${subscription.id}`);

          // In-app notification: subscription payment success
          base44.asServiceRole.functions.invoke('sendCustomerNotification', {
            customer_email: customerEmail,
            type: 'order_update',
            notification_subtype: 'subscription_payment_success',
            title: 'Subscription Active 🌿',
            message: `Your NuVira subscription is active. Your first delivery is scheduled for ${firstDeliveryDate || 'soon'}.`,
            deep_link: '/account/subscriptions',
            idempotency_key: `sub_payment_success_${stripeSubscriptionId}`,
          }).catch(err => console.warn('[stripeWebhook] Sub payment notif failed:', err.message));

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

          // Sync to Hub using the new 4-fulfillment payload builder
          // Fire-and-forget: Stripe already got 200 at this point.
          // On failure, write an error OrderSyncLog so retryFailedHubSyncs can pick it up.
          base44.asServiceRole.functions.invoke('syncSubscriptionWithFulfillments', {
            subscription_id: subscription.id,
            customer_email: customerEmail,
          }, { headers: { 'x-internal-secret': Deno.env.get('HUB_SYNC_SECRET') || '' } }).then(() => {
            console.log(`[stripeWebhook] ✅ Hub sync dispatched for subscription ${subscription.id}`);
          }).catch(err => {
            console.error(`[stripeWebhook] Hub sync failed for subscription ${subscription.id}: ${err.message}`);
            base44.asServiceRole.entities.OrderSyncLog.create({
              order_number: `SUB-${stripeSubscriptionId}`,
              status: 'error',
              description: `Hub sync failed after checkout.session.completed: ${err.message}. Subscription=${subscription.id}. Will be retried.`,
              started_at: new Date().toISOString(),
              completed_at: new Date().toISOString(),
              triggered_by: 'stripe_webhook',
            }).catch(() => {});
          });

        } else {
          console.log(`[stripeWebhook] Subscription already exists for ${customerEmail} (stripe_sub=${stripeSubscriptionId}), skipping creation`);
        }

        // Award loyalty points for subscription payment (10 pts per $1) — exactly once per stripe subscription
        if (skipLoyaltyWrite(stagingSafeMode)) {
          // Loyalty is intentionally suppressed in isolated staging smoke tests.
        } else if (customerEmail && amountPaid > 0) {
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
          // ── TERMINAL STATE GUARD ──────────────────────────────────────────
          // CRITICAL: Do NOT resurrect refunded/cancelled/terminal orders.
          const existingOrder = existingOrders[0];
          const isTerminal = existingOrder.status === 'refunded' || existingOrder.status === 'cancelled' ||
                             existingOrder.do_not_recover === true ||
                             (existingOrder.amount_refunded && existingOrder.amount_refunded > 0);
          if (isTerminal) {
            console.warn(`[checkout.completed] Order ${existingOrder.order_number} is terminal (${existingOrder.status}). Skipping resurrection. session=${session.id}`);
            return Response.json({ received: true, action: 'skipped_terminal_state' });
          }
          console.log(`Order already created for session ${session.id}: ${existingOrder.order_number}, skipping`);
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

        // Hydrate address/contact fields from CheckoutSession or Stripe metadata
        const resolvedAddressLine1   = orderData.address_line1   || session.metadata?.delivery_address_line1 || '';
        const resolvedAddressCity    = orderData.address_city    || session.metadata?.delivery_city    || '';
        const resolvedAddressState   = orderData.address_state   || session.metadata?.delivery_state   || '';
        const resolvedAddressZip     = orderData.address_postal_code || session.metadata?.delivery_postal_code || '';
        const resolvedPhone          = orderData.contact_phone   || session.metadata?.customer_phone   || '';
        const resolvedCustomerName   = orderData.customer_name   || session.metadata?.customer_name    || '';
        const resolvedDeliveryAddress = orderData.delivery_address || [resolvedAddressLine1, resolvedAddressCity, resolvedAddressState, resolvedAddressZip].filter(Boolean).join(', ');

        // ── CENTRAL SCHEDULE ENGINE: recalculate from webhook event timestamp (final authority) ──
        // Webhook event.created is when checkout.session.completed actually fired (when Stripe sent this event).
        // This overrides stale session.created (when session was first created) if they differ.
        // If payment crosses a cutoff boundary between session creation and actual completion, webhook time wins.
        let checkoutFinalSchedule = null;
        try {
          const completedTimestamp = new Date((event.created || Date.now()) * 1000).toISOString();
          const csResp = await base44.asServiceRole.functions.invoke('calculateNuViraFulfillmentSchedule', {
            paid_at: completedTimestamp,
          });
          checkoutFinalSchedule = csResp.data || csResp;
          console.log(`[checkout.completed] Final schedule from event.created (${completedTimestamp}): prod=${checkoutFinalSchedule.production_date} del=${checkoutFinalSchedule.delivery_date} window="${checkoutFinalSchedule.delivery_window_label}" reason="${checkoutFinalSchedule.schedule_reason}"`);
        } catch (schedErr) {
          console.error(`[checkout.completed] Schedule recalculation failed: ${schedErr.message} — falling back to metadata`);
        }

        // Final resolved dates: central engine wins over stale metadata
        const resolvedDeliveryDate   = checkoutFinalSchedule?.assigned_delivery_date || checkoutFinalSchedule?.delivery_date || orderData.estimated_delivery_date || session.metadata?.selected_delivery_date || null;
        const resolvedProductionDate = checkoutFinalSchedule?.assigned_production_day || checkoutFinalSchedule?.production_date || orderData.assigned_production_day || orderData.production_date || session.metadata?.assigned_production_day || session.metadata?.production_date || null;
        const resolvedWindowLabel    = checkoutFinalSchedule?.delivery_window_label  || orderData.delivery_window_label || session.metadata?.delivery_window_label || '5 PM – 8 PM';
        const resolvedWindowStart    = checkoutFinalSchedule?.assigned_delivery_window_start || checkoutFinalSchedule?.delivery_window_start || orderData.assigned_delivery_window_start || orderData.delivery_window_start || session.metadata?.assigned_delivery_window_start || session.metadata?.delivery_window_start || '17:00';
        const resolvedWindowEnd      = checkoutFinalSchedule?.assigned_delivery_window_end || checkoutFinalSchedule?.delivery_window_end || orderData.assigned_delivery_window_end || orderData.delivery_window_end || session.metadata?.assigned_delivery_window_end || session.metadata?.delivery_window_end || '20:00';
        const resolvedScheduleReason = checkoutFinalSchedule?.scheduling_reason || checkoutFinalSchedule?.schedule_reason || 'checkout_metadata_fallback';
        const resolvedFinalScheduleSource = resolveFinalScheduleSource(checkoutFinalSchedule?.final_schedule_source, checkoutFinalSchedule ? 'backend_cadence' : 'unknown');
        const resolvedScheduleTimezone = checkoutFinalSchedule?.schedule_timezone || checkoutFinalSchedule?.timezone || 'America/Chicago';
        const resolvedDeliveryWindowTimezone = checkoutFinalSchedule?.delivery_window_timezone || checkoutFinalSchedule?.timezone || 'America/Chicago';

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
          assigned_production_day: resolvedProductionDate,
          production_date: resolvedProductionDate,
          delivery_window_label: resolvedWindowLabel,
          delivery_window_start: resolvedWindowStart,
          delivery_window_end: resolvedWindowEnd,
          assigned_delivery_window_start: resolvedWindowStart,
          assigned_delivery_window_end: resolvedWindowEnd,
          delivery_window_timezone: resolvedDeliveryWindowTimezone,
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
          scheduling_reason: resolvedScheduleReason,
          final_schedule_source: resolvedFinalScheduleSource,
          schedule_timezone: resolvedScheduleTimezone,
          cutoff_window_label: checkoutFinalSchedule?.cutoff_window_label || 'unknown',
        });

        console.log(`Regular order ${order.id} (${orderNumber}) created after payment completed`);

        // Deduct points and credits after order is confirmed
        if (skipLoyaltyWrite(stagingSafeMode)) {
          // Loyalty redemption is intentionally suppressed in isolated staging smoke tests.
        } else if (customerEmail && (orderData.points_used || orderData.active_reward?.points_required)) {
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
        // CRITICAL: Do NOT throw here — Hub sync failures must not cause Stripe to receive 500.
        // Stripe would retry the entire webhook, potentially duplicating orders.
        base44.asServiceRole.functions.invoke('syncOrderToHub', {
          order_id: order.id,
          stripe_session: {
            payment_status: session.payment_status,
            id: session.id,
          },
          triggered_by: 'stripe_webhook',
        }).then(() => {
          console.log(`✅ Order ${orderNumber} synced to Hub successfully`);
        }).catch(syncErr => {
          console.error(`❌ Order ${orderNumber} (${order.id}) failed to sync to Hub: ${syncErr.message}`);
          base44.asServiceRole.entities.OrderSyncLog.create({
            order_number: orderNumber,
            status: 'error',
            description: `Failed to sync to Hub immediately after webhook: ${syncErr.message}`,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            triggered_by: 'stripe_webhook',
          }).catch(() => {});
        });

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

        // In-app notification: order confirmation
        base44.asServiceRole.functions.invoke('sendCustomerNotification', {
          customer_email: customerEmail,
          type: 'order_update',
          notification_subtype: 'order_confirmation',
          title: 'Order Confirmed ✅',
          message: `Your NuVira order #${orderNumber} has been confirmed and is scheduled for juicing.`,
          order_id: order.id,
          deep_link: `/order-tracker/${orderNumber}`,
          idempotency_key: `order_confirmation_${order.id}`,
        }).catch(err => console.warn('[stripeWebhook] Order confirmation notif failed:', err.message));

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

      // Award loyalty points for one-time orders only (subscriptions handle loyalty above)
      // NOT for pre-orders, NOT for subscription checkouts (already handled in subscription block)
      if (skipLoyaltyWrite(stagingSafeMode)) {
        // Loyalty is intentionally suppressed in isolated staging smoke tests.
      } else if (session.mode !== 'subscription' && customerEmail && session.metadata?.is_preorder !== 'true') {
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

    // ── ZONE 3: payment_intent.amount_capturable_updated ─────────────────────
    // Fires when Zone 3 manual capture PI becomes capturable (card authorized).
    if (event.type === 'payment_intent.amount_capturable_updated') {
      const pi = event.data.object;
      const meta = pi.metadata || {};

      if (meta.flow_type !== 'zone3_route_review') {
        return Response.json({ received: true });
      }

      const darId = meta.dar_id;
      if (!darId) {
        console.error(`[Zone3 webhook] No dar_id in PI ${pi.id} metadata`);
        return Response.json({ received: true });
      }

      const dars = await base44.asServiceRole.entities.DeliveryApprovalRequest.filter({ id: darId });
      const dar = dars[0];
      if (!dar) {
        console.error(`[Zone3 webhook] No DAR found for id=${darId}`);
        return Response.json({ received: true });
      }

      // Idempotent: already in pending_review
      if (dar.status === 'pending_review') {
        console.log(`[Zone3 webhook] DAR ${darId} already pending_review, skipping`);
        return Response.json({ received: true });
      }

      const amountCapturable = pi.amount_capturable / 100;
      // authorization_expires_at: Stripe holds uncaptured PIs for 7 days
      const authExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      await base44.asServiceRole.entities.DeliveryApprovalRequest.update(darId, {
        status: 'pending_review',
        stripe_authorization_status: 'requires_capture',
        amount_capturable: amountCapturable,
        authorization_expires_at: authExpiresAt,
        audit_trail: [...(dar.audit_trail || []), {
          action: 'authorization_succeeded',
          performed_by: 'stripe_webhook',
          timestamp: new Date().toISOString(),
          note: `PI ${pi.id} authorized. Amount capturable: $${amountCapturable}. Expires: ${authExpiresAt}`,
        }],
      });

      console.log(`[Zone3 webhook] DAR ${darId} set to pending_review. PI=${pi.id}, capturable=$${amountCapturable}`);

      // Notify admins
      base44.asServiceRole.functions.invoke('sendCustomerNotification', {
        customer_email: 'info@nuvirajuice.com',
        type: 'general',
        title: '🗺️ Zone 3 Route Review Pending',
        message: `New Zone 3 delivery request from ${dar.customer_name || dar.customer_email} (${dar.delivery_address}). Request: ${dar.request_number}. Distance: ${dar.estimated_distance_miles} miles. Auth hold: $${amountCapturable}. Review and approve/deny in Admin → Orders.`,
        deep_link: '/admin/orders',
        idempotency_key: `zone3_admin_notify_${darId}`,
      }).catch(() => {});

      // Notify customer
      base44.asServiceRole.functions.invoke('sendCustomerNotification', {
        customer_email: dar.customer_email,
        type: 'general',
        title: 'Route Review Submitted ✅',
        message: `Your delivery request to ${dar.delivery_address} has been submitted for review. We'll respond within 24–48 hours. No charge will be made until approved. Request #${dar.request_number}.`,
        deep_link: '/account/orders',
        idempotency_key: `zone3_customer_submitted_${darId}`,
      }).catch(() => {});

      return Response.json({ received: true });
    }

    // ── ZONE 3: payment_intent.canceled ──────────────────────────────────────
    // Also handled in the existing payment_intent.canceled block below, but
    // we add zone3-specific DAR update here before the general handler.
    if (event.type === 'payment_intent.canceled') {
      const pi = event.data.object;
      const meta = pi.metadata || {};
      if (meta.flow_type === 'zone3_route_review' && meta.dar_id) {
        const dars = await base44.asServiceRole.entities.DeliveryApprovalRequest.filter({ id: meta.dar_id });
        const dar = dars[0];
        if (dar && !['denied', 'expired', 'captured'].includes(dar.status)) {
          await base44.asServiceRole.entities.DeliveryApprovalRequest.update(meta.dar_id, {
            status: 'expired',
            stripe_authorization_status: 'canceled',
            audit_trail: [...(dar.audit_trail || []), {
              action: 'pi_canceled_by_stripe',
              performed_by: 'stripe_webhook',
              timestamp: new Date().toISOString(),
              note: `PI ${pi.id} canceled by Stripe. DAR auto-expired.`,
            }],
          });
          console.log(`[Zone3 webhook] DAR ${meta.dar_id} auto-expired via PI cancel`);
        }
        return Response.json({ received: true });
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

      // ── TERMINAL STATE GUARD ──────────────────────────────────────────
      // CRITICAL: Do NOT resurrect refunded/cancelled/terminal orders.
      // Webhook replay order is NOT guaranteed—later refunds can exist before earlier payment events.
      // Terminal states must always win.
      if (existingOrders.length > 0) {
        const order = existingOrders[0];
        const isTerminal = order.status === 'refunded' || order.status === 'cancelled' || 
                          order.do_not_recover === true || 
                          (order.amount_refunded && order.amount_refunded > 0);
        if (isTerminal) {
          console.warn(`[PI succeeded] Order ${orderNumber} is in terminal state (refunded/cancelled). Skipping state reset. PI=${pi.id}`);
          return Response.json({ received: true, action: 'skipped_terminal_state' });
        }
      }

      if (existingOrders.length > 0) {
        const order = existingOrders[0];

        // ── TERMINAL STATE GUARD ──────────────────────────────────────────
        // CRITICAL: Do NOT finalize or reactivate a refunded/cancelled order.
        // Terminal states must ALWAYS be protected, even if payment_captured=false.
        const isTerminalOrder = order.status === 'refunded' || order.status === 'cancelled' || 
                                order.do_not_recover === true || 
                                (order.amount_refunded && order.amount_refunded > 0);
        if (isTerminalOrder) {
          console.warn(`[PI succeeded] Order ${orderNumber} is in terminal state (${order.status}). Skipping finalization. PI=${pi.id}`);
          return Response.json({ received: true, action: 'skipped_terminal_state' });
        }

        // Idempotency: already finalized
        if (order.payment_captured === true) {
          console.log(`[PI succeeded] Order ${orderNumber} already finalized, skipping`);
          return Response.json({ received: true });
        }

        // Safety: do not finalize a cancelled/abandoned order
        if (order.is_abandoned_checkout) {
          console.warn(`[PI succeeded] Order ${orderNumber} is marked abandoned — skipping finalization`);
          return Response.json({ received: true });
        }

        // ── CENTRAL SCHEDULE ENGINE: recalculate from webhook event timestamp (final authority) ──────
        // Webhook event.created is when the success actually occurred (when Stripe sent this event).
        // This overrides stale pi.created (when PI was first created) if they differ.
        // If payment crosses a cutoff boundary between PI creation and actual success, webhook time wins.
        let finalSchedule = null;
        try {
          const successTimestamp = new Date((event.created || Date.now()) * 1000).toISOString();
          const schedResp = await base44.asServiceRole.functions.invoke('calculateNuViraFulfillmentSchedule', {
            paid_at: successTimestamp,
          });
          finalSchedule = schedResp.data || schedResp;
          console.log(`[PI succeeded] Final schedule from event.created (${successTimestamp}): prod=${finalSchedule.production_date} del=${finalSchedule.delivery_date} window="${finalSchedule.delivery_window_label}" reason="${finalSchedule.schedule_reason}"`);
        } catch (schedErr) {
          console.error(`[PI succeeded] Schedule recalculation failed: ${schedErr.message} — keeping pending order dates`);
        }

        // Finalize the order — promote from pending_payment to operational
        const statusHistory = [...(order.status_history || []), {
          status: 'scheduled_for_juicing',
          timestamp: new Date().toISOString(),
          message: 'Payment confirmed — your order is scheduled for juicing!',
        }];

        const finalOrderUpdate = {
          status:           'scheduled_for_juicing',
          payment_status:   'paid',
          financial_status: 'paid',
          payment_captured: true,
          status_history:   statusHistory,
        };

        // Override delivery dates if central engine returned a result
        if (finalSchedule) {
          const finalProductionDate = finalSchedule.assigned_production_day || finalSchedule.production_date || null;
          const finalDeliveryDate = finalSchedule.assigned_delivery_date || finalSchedule.delivery_date || null;
          const finalWindowStart = finalSchedule.assigned_delivery_window_start || finalSchedule.delivery_window_start || null;
          const finalWindowEnd = finalSchedule.assigned_delivery_window_end || finalSchedule.delivery_window_end || null;

          finalOrderUpdate.estimated_delivery_date  = finalDeliveryDate;
          finalOrderUpdate.assigned_delivery_date   = finalDeliveryDate;
          finalOrderUpdate.assigned_production_day  = finalProductionDate;
          finalOrderUpdate.production_date          = finalProductionDate;
          finalOrderUpdate.delivery_window_label    = finalSchedule.delivery_window_label;
          finalOrderUpdate.delivery_window_start    = finalWindowStart;
          finalOrderUpdate.delivery_window_end      = finalWindowEnd;
          finalOrderUpdate.assigned_delivery_window_start = finalWindowStart;
          finalOrderUpdate.assigned_delivery_window_end   = finalWindowEnd;
          finalOrderUpdate.delivery_window_timezone = finalSchedule.delivery_window_timezone || finalSchedule.timezone || 'America/Chicago';
          finalOrderUpdate.scheduling_reason        = finalSchedule.scheduling_reason || finalSchedule.schedule_reason;
          finalOrderUpdate.final_schedule_source    = resolveFinalScheduleSource(finalSchedule.final_schedule_source, 'backend_cadence');
          finalOrderUpdate.schedule_timezone        = finalSchedule.schedule_timezone || finalSchedule.timezone || 'America/Chicago';
          finalOrderUpdate.cutoff_window_label      = finalSchedule.cutoff_window_label || 'unknown';
        }

        await base44.asServiceRole.entities.Order.update(order.id, finalOrderUpdate);
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

        if (skipLoyaltyWrite(stagingSafeMode)) {
          // Loyalty redemption is intentionally suppressed in isolated staging smoke tests.
        } else if (customerEmail && (checkoutData.points_used || checkoutData.active_reward?.points_required)) {
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
        if (skipLoyaltyWrite(stagingSafeMode)) {
          // Loyalty is intentionally suppressed in isolated staging smoke tests.
        } else if (customerEmail) {
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
          const hubSyncResult = await base44.asServiceRole.functions.invoke('syncOrderToHub', {
            order_id:    order.id,
            stripe_session: { payment_status: 'paid', id: pi.id },
            triggered_by: 'stripe_webhook',
          });
          if (hubSyncResult?.data?.skipped) {
            console.log(`[PI succeeded] Hub sync skipped in staging-safe mode for ${orderNumber}`);
          } else {
            console.log(`[PI succeeded] ✅ Order ${orderNumber} synced to Hub`);
          }
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

        // In-app notification: order confirmation (embedded checkout path)
        base44.asServiceRole.functions.invoke('sendCustomerNotification', {
          customer_email: customerEmail,
          type: 'order_update',
          notification_subtype: 'order_confirmation',
          title: 'Order Confirmed ✅',
          message: `Your NuVira order #${orderNumber} has been confirmed and is scheduled for juicing.`,
          order_id: order.id,
          deep_link: `/order-tracker/${orderNumber}`,
          idempotency_key: `order_confirmation_${order.id}`,
        }).catch(err => console.warn('[PI succeeded] Order confirmation notif failed:', err.message));

      } else {
        // Pre-created Order not found — create it now (safety net), using central schedule engine
        console.warn(`[PI succeeded] Pre-created Order not found for PI ${pi.id}, creating from metadata`);
        const resolvedAddr = [meta.delivery_address_line1, meta.delivery_city, meta.delivery_state, meta.delivery_postal_code].filter(Boolean).join(', ');

        // ── CENTRAL SCHEDULE ENGINE: recalculate from webhook event timestamp (final authority) ──
        // Even for safety-net order creation, use event.created (when success actually occurred), not pi.created.
        let safetyNetSchedule = null;
        try {
          const successTs = new Date((event.created || Date.now()) * 1000).toISOString();
          const snResp = await base44.asServiceRole.functions.invoke('calculateNuViraFulfillmentSchedule', { paid_at: successTs });
          safetyNetSchedule = snResp.data || snResp;
        } catch (snErr) {
          console.error(`[PI succeeded] Safety-net schedule calc failed: ${snErr.message}`);
        }

        const safetyNetProductionDate = safetyNetSchedule?.assigned_production_day || safetyNetSchedule?.production_date || meta.assigned_production_day || meta.production_date || null;
        const safetyNetDeliveryDate = safetyNetSchedule?.assigned_delivery_date || safetyNetSchedule?.delivery_date || meta.assigned_delivery_date || meta.selected_delivery_date || null;
        const safetyNetWindowLabel = safetyNetSchedule?.delivery_window_label || meta.delivery_window_label || '5 PM – 8 PM';
        const safetyNetWindowStart = safetyNetSchedule?.assigned_delivery_window_start || safetyNetSchedule?.delivery_window_start || meta.assigned_delivery_window_start || meta.delivery_window_start || '17:00';
        const safetyNetWindowEnd = safetyNetSchedule?.assigned_delivery_window_end || safetyNetSchedule?.delivery_window_end || meta.assigned_delivery_window_end || meta.delivery_window_end || '20:00';
        const safetyNetScheduleTimezone = safetyNetSchedule?.schedule_timezone || safetyNetSchedule?.timezone || meta.schedule_timezone || 'America/Chicago';
        const safetyNetDeliveryWindowTimezone = safetyNetSchedule?.delivery_window_timezone || safetyNetSchedule?.timezone || meta.delivery_window_timezone || 'America/Chicago';
        const safetyNetScheduleSource = safetyNetSchedule
          ? resolveFinalScheduleSource(safetyNetSchedule.final_schedule_source, 'backend_cadence')
          : resolveFinalScheduleSource(meta.final_schedule_source, 'unknown');

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
          estimated_delivery_date:  safetyNetDeliveryDate,
          assigned_delivery_date:   safetyNetDeliveryDate,
          assigned_production_day:  safetyNetProductionDate,
          production_date:          safetyNetProductionDate,
          delivery_window_label:    safetyNetWindowLabel,
          delivery_window_start:    safetyNetWindowStart,
          delivery_window_end:      safetyNetWindowEnd,
          assigned_delivery_window_start: safetyNetWindowStart,
          assigned_delivery_window_end:   safetyNetWindowEnd,
          delivery_window_timezone: safetyNetDeliveryWindowTimezone,
          scheduling_reason:        safetyNetSchedule?.scheduling_reason || safetyNetSchedule?.schedule_reason || 'safety_net_creation',
          final_schedule_source:    safetyNetScheduleSource,
          schedule_timezone:        safetyNetScheduleTimezone,
          cutoff_window_label:      safetyNetSchedule?.cutoff_window_label || meta.cutoff_window_label || 'unknown',
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

    // ── invoice.payment_succeeded — handles subscription first invoice (Payment Element flow v4.0) ──
    // This fires when the PaymentIntent tied to the first subscription invoice succeeds.
    // Idempotent: uses stripe_subscription_id as dedupe key, same as checkout.session.completed path.
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      const stripeSubscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;

      // Only process subscription invoices (not standalone invoices)
      if (!stripeSubscriptionId) {
        console.log(`[invoice.payment_succeeded] No subscription ID, skipping invoice ${invoice.id}`);
        return Response.json({ received: true });
      }

      // Retrieve the subscription to get full metadata
      const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
        expand: ['latest_invoice.payment_intent'],
      });

      const meta = stripeSubscription.metadata || {};
      const customerEmail = meta.customer_email || invoice.customer_email;

      if (!customerEmail) {
        console.error(`[invoice.payment_succeeded] No customer_email in metadata for sub ${stripeSubscriptionId}`);
        return Response.json({ received: true });
      }

      console.log(`[invoice.payment_succeeded] Sub ${stripeSubscriptionId} paid, customer ${customerEmail}`);

      // UNIQUENESS GUARD: Always search by stripe_subscription_id — never by email alone.
      // This is the ONLY correct way to detect duplicates; email-based search can return wrong records.
      const existingSubsForInvoice = await base44.asServiceRole.entities.Subscription.filter({ stripe_subscription_id: stripeSubscriptionId });

      if (existingSubsForInvoice.length > 0) {
        const existingSubForInvoice = existingSubsForInvoice[0];
        // Retire any extra duplicates
        for (const dup of existingSubsForInvoice.slice(1)) {
          console.warn(`[invoice.payment_succeeded] Retiring duplicate CA record ${dup.id} for stripe_sub=${stripeSubscriptionId}`);
          await base44.asServiceRole.entities.Subscription.update(dup.id, {
            status: 'cancelled', hub_sync_status: 'skipped',
            description: `[DUPLICATE RETIRED] Retired by uniqueness guard in invoice.payment_succeeded. Canonical: ${existingSubForInvoice.id}. ${new Date().toISOString()}`,
          }).catch(() => {});
        }
        // CRITICAL: Do NOT reactivate a cancelled/refunded subscription via invoice replay
        const isTerminalSub = existingSubForInvoice.status === 'cancelled' || existingSubForInvoice.hub_sync_status === 'skipped';
        if (isTerminalSub) {
          console.warn(`[invoice.payment_succeeded] Subscription ${stripeSubscriptionId} is terminal (status=${existingSubForInvoice.status}). Skipping resurrection.`);
          return Response.json({ received: true, action: 'skipped_terminal_state' });
        }
        console.log(`[invoice.payment_succeeded] Subscription already created for ${stripeSubscriptionId}, skipping`);
        return Response.json({ received: true });
      }

      const planId = meta.plan_id;
      const pendingCheckoutId = meta.pending_subscription_checkout_id;

      if (!planId) {
        console.error(`[invoice.payment_succeeded] No plan_id in metadata for sub ${stripeSubscriptionId}`);
        return Response.json({ received: true });
      }

      // Load PendingSubscriptionCheckout for complete delivery metadata
      let pendingCheckout = null;
      if (pendingCheckoutId) {
        try {
          const pendings = await base44.asServiceRole.entities.PendingSubscriptionCheckout.filter({ id: pendingCheckoutId });
          pendingCheckout = pendings[0] || null;
          if (pendingCheckout) console.log(`[invoice.payment_succeeded] Loaded PendingSubscriptionCheckout ${pendingCheckoutId}`);
        } catch (err) {
          console.error(`[invoice.payment_succeeded] Failed to load pending checkout: ${err.message}`);
        }
      }

      // Fetch plan + delivery zone
      const allPlans = await base44.asServiceRole.entities.SubscriptionPlan.list();
      const plan = allPlans.find(p => p.id === planId);
      const allZones = await base44.asServiceRole.entities.DeliveryZone.filter({ is_active: true });
      const defaultZone = allZones[0];

      const deliveryAddress = pendingCheckout?.delivery_address || meta.delivery_address || '';
      const deliveryZoneId = pendingCheckout?.delivery_zone_id || defaultZone?.id || null;

      // ── CENTRAL SCHEDULE ENGINE: recalculate from actual paid timestamp ──────
      // invoice.status_transitions.paid_at or event created is final authority.
      // Stale pendingCheckout/metadata dates are treated as preview only.
      let invPaidSchedule = null;
      try {
        const invPaidAt = invoice.status_transitions?.paid_at
          ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
          : new Date((event.created || Date.now()) * 1000).toISOString();
        const invResp = await base44.asServiceRole.functions.invoke('calculateNuViraFulfillmentSchedule', {
          paid_at: invPaidAt,
        });
        invPaidSchedule = invResp.data || invResp;
        console.log(`[invoice.payment_succeeded] Final schedule: prod=${invPaidSchedule.production_date} del=${invPaidSchedule.delivery_date} reason="${invPaidSchedule.schedule_reason}"`);
      } catch (schedErr) {
        console.error(`[invoice.payment_succeeded] Schedule recalculation failed: ${schedErr.message} — falling back to pending checkout dates`);
      }

      // Central engine is authoritative; fall back to pendingCheckout only if engine failed
      const productionDate = invPaidSchedule?.production_date || pendingCheckout?.production_date || meta.production_date || null;
      const firstDeliveryDate = invPaidSchedule?.delivery_date || pendingCheckout?.first_delivery_date || meta.first_delivery_date || null;
      const deliveryWindowLabel = invPaidSchedule?.delivery_window_label || pendingCheckout?.delivery_window_label || '5 PM – 8 PM';
      const deliveryWindowStart = invPaidSchedule?.delivery_window_start || pendingCheckout?.delivery_window_start || '17:00';
      const deliveryWindowEnd = invPaidSchedule?.delivery_window_end || pendingCheckout?.delivery_window_end || '20:00';
      const scheduleReason = invPaidSchedule?.schedule_reason || 'invoice_payment_succeeded';

      const nextDeliveryDate = (() => {
        if (!firstDeliveryDate) return pendingCheckout?.next_delivery_date || firstDeliveryDate;
        const d = new Date(firstDeliveryDate + 'T12:00:00');
        d.setDate(d.getDate() + 7); // always next weekly delivery
        return d.toISOString().split('T')[0];
      })();

      if (!productionDate || !firstDeliveryDate) {
        console.error(`[invoice.payment_succeeded] Missing dates for sub ${stripeSubscriptionId}`);
        return Response.json({ received: true });
      }

      // Create Subscription record
      const newSubscription = await base44.asServiceRole.entities.Subscription.create({
        customer_email: customerEmail,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_customer_id: invoice.customer,
        plan_id: planId,
        bundle_id: pendingCheckout?.bundle_id || meta.bundle_id || null,
        delivery_zone_id: deliveryZoneId,
        delivery_address: deliveryAddress,
        status: 'active',
        started_date: firstDeliveryDate,
        next_delivery_date: nextDeliveryDate,
      });
      console.log(`[invoice.payment_succeeded] Subscription record created: ${newSubscription.id} (prod=${productionDate} del=${firstDeliveryDate} window="${deliveryWindowLabel}")`);

      // Award loyalty points (idempotent — check description includes stripeSubscriptionId)
      const amountPaid = (invoice.amount_paid || 0) / 100;
      if (skipLoyaltyWrite(stagingSafeMode)) {
        // Loyalty is intentionally suppressed in isolated staging smoke tests.
      } else if (amountPaid > 0) {
        const pointsToAward = Math.floor(amountPaid * 10);
        const existingPoints = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: customerEmail });
        const loyaltyEntry = {
          amount: pointsToAward,
          type: 'earned',
          description: `Subscription payment of $${amountPaid.toFixed(2)} (subscription ${stripeSubscriptionId})`,
          timestamp: new Date().toISOString(),
        };
        if (existingPoints[0]) {
          const alreadyAwarded = existingPoints[0].points_history?.some(h =>
            h.description?.includes(`subscription ${stripeSubscriptionId}`)
          );
          if (!alreadyAwarded) {
            await base44.asServiceRole.entities.UserPoints.update(existingPoints[0].id, {
              total_points: (existingPoints[0].total_points || 0) + pointsToAward,
              lifetime_points: (existingPoints[0].lifetime_points || 0) + pointsToAward,
              points_history: [...(existingPoints[0].points_history || []), loyaltyEntry],
            });
            console.log(`[invoice.payment_succeeded] Awarded ${pointsToAward} pts to ${customerEmail}`);
          }
        } else {
          await base44.asServiceRole.entities.UserPoints.create({
            customer_email: customerEmail,
            total_points: pointsToAward,
            lifetime_points: pointsToAward,
            redeemed_points: 0,
            points_history: [loyaltyEntry],
          });
        }
      }

      // Update PendingSubscriptionCheckout as completed
      if (pendingCheckoutId && pendingCheckout) {
        await base44.asServiceRole.entities.PendingSubscriptionCheckout.update(pendingCheckoutId, {
          status: 'completed',
          completed_at: new Date().toISOString(),
          stripe_subscription_id: stripeSubscriptionId,
        }).catch(err => console.warn(`[invoice.payment_succeeded] Failed to update pending checkout: ${err.message}`));
      }

      // Sync to Hub using the new 4-fulfillment payload builder (invoice.payment_succeeded path)
      // Fire-and-forget: write error log on failure so retryFailedHubSyncs can recover.
      base44.asServiceRole.functions.invoke('syncSubscriptionWithFulfillments', {
        subscription_id: newSubscription.id,
        customer_email: customerEmail,
      }, { headers: { 'x-internal-secret': Deno.env.get('HUB_SYNC_SECRET') || '' } }).then(() => {
        console.log(`[invoice.payment_succeeded] ✅ Hub sync dispatched for subscription ${newSubscription.id}`);
      }).catch(err => {
        console.error(`[invoice.payment_succeeded] Hub sync failed for subscription ${newSubscription.id}: ${err.message}`);
        base44.asServiceRole.entities.OrderSyncLog.create({
          order_number: `SUB-${stripeSubscriptionId}`,
          status: 'error',
          description: `Hub sync failed after invoice.payment_succeeded: ${err.message}. Subscription=${newSubscription.id}. Will be retried.`,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          triggered_by: 'stripe_webhook',
        }).catch(() => {});
      });

      console.log(`[invoice.payment_succeeded] ✅ Subscription ${stripeSubscriptionId} fully activated for ${customerEmail}`);
      return Response.json({ received: true });
    }

    // ── invoice.paid — handles subscription invoice paid (alternate to invoice.payment_succeeded) ──
    // Some Stripe flows emit invoice.paid instead of invoice.payment_succeeded.
    // This handler mirrors payment_succeeded logic with same idempotency.
    if (event.type === 'invoice.paid') {
      const invoice = event.data.object;
      const stripeSubscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;

      // Only process subscription invoices (not standalone invoices)
      if (!stripeSubscriptionId) {
        console.log(`[invoice.paid] No subscription ID, skipping invoice ${invoice.id}`);
        return Response.json({ received: true });
      }

      // Retrieve the subscription to get full metadata
      const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
        expand: ['latest_invoice.payment_intent'],
      });

      const meta = stripeSubscription.metadata || {};
      const customerEmail = meta.customer_email || invoice.customer_email;

      if (!customerEmail) {
        console.error(`[invoice.paid] No customer_email in metadata for sub ${stripeSubscriptionId}`);
        return Response.json({ received: true });
      }

      console.log(`[invoice.paid] Sub ${stripeSubscriptionId} paid, customer ${customerEmail}`);

      // UNIQUENESS GUARD: Always search by stripe_subscription_id — never by email alone.
      const existingSubsForPaidInvoice = await base44.asServiceRole.entities.Subscription.filter({ stripe_subscription_id: stripeSubscriptionId });

      if (existingSubsForPaidInvoice.length > 0) {
        const existingSubForPaidInvoice = existingSubsForPaidInvoice[0];
        // Retire any extra duplicates
        for (const dup of existingSubsForPaidInvoice.slice(1)) {
          console.warn(`[invoice.paid] Retiring duplicate CA record ${dup.id} for stripe_sub=${stripeSubscriptionId}`);
          await base44.asServiceRole.entities.Subscription.update(dup.id, {
            status: 'cancelled', hub_sync_status: 'skipped',
            description: `[DUPLICATE RETIRED] Retired by uniqueness guard in invoice.paid. Canonical: ${existingSubForPaidInvoice.id}. ${new Date().toISOString()}`,
          }).catch(() => {});
        }
        // CRITICAL: Do NOT reactivate a cancelled/refunded subscription via invoice replay
        const isTerminalSubPaid = existingSubForPaidInvoice.status === 'cancelled' || existingSubForPaidInvoice.hub_sync_status === 'skipped';
        if (isTerminalSubPaid) {
          console.warn(`[invoice.paid] Subscription ${stripeSubscriptionId} is terminal (status=${existingSubForPaidInvoice.status}). Skipping resurrection.`);
          return Response.json({ received: true, action: 'skipped_terminal_state' });
        }
        console.log(`[invoice.paid] Subscription already created for ${stripeSubscriptionId}, skipping`);
        return Response.json({ received: true });
      }

      const planId = meta.plan_id;
      const pendingCheckoutId = meta.pending_subscription_checkout_id;

      if (!planId) {
        console.error(`[invoice.paid] No plan_id in metadata for sub ${stripeSubscriptionId}`);
        return Response.json({ received: true });
      }

      // Load PendingSubscriptionCheckout for complete delivery metadata
      let pendingCheckoutPaid = null;
      if (pendingCheckoutId) {
        try {
          const pendings = await base44.asServiceRole.entities.PendingSubscriptionCheckout.filter({ id: pendingCheckoutId });
          pendingCheckoutPaid = pendings[0] || null;
          if (pendingCheckoutPaid) console.log(`[invoice.paid] Loaded PendingSubscriptionCheckout ${pendingCheckoutId}`);
        } catch (err) {
          console.error(`[invoice.paid] Failed to load pending checkout: ${err.message}`);
        }
      }

      // Fetch plan + delivery zone
      const allPlansPaid = await base44.asServiceRole.entities.SubscriptionPlan.list();
      const planPaid = allPlansPaid.find(p => p.id === planId);
      const allZonesPaid = await base44.asServiceRole.entities.DeliveryZone.filter({ is_active: true });
      const defaultZonePaid = allZonesPaid[0];

      const deliveryAddressPaid = pendingCheckoutPaid?.delivery_address || meta.delivery_address || '';
      const deliveryZoneIdPaid = pendingCheckoutPaid?.delivery_zone_id || defaultZonePaid?.id || null;

      // ── CENTRAL SCHEDULE ENGINE: recalculate from actual paid timestamp ──────
      let invPaidSchedulePaid = null;
      try {
        const invPaidAtPaid = invoice.status_transitions?.paid_at
          ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
          : new Date((event.created || Date.now()) * 1000).toISOString();
        const invRespPaid = await base44.asServiceRole.functions.invoke('calculateNuViraFulfillmentSchedule', {
          paid_at: invPaidAtPaid,
        });
        invPaidSchedulePaid = invRespPaid.data || invRespPaid;
        console.log(`[invoice.paid] Final schedule: prod=${invPaidSchedulePaid.production_date} del=${invPaidSchedulePaid.delivery_date} reason="${invPaidSchedulePaid.schedule_reason}"`);
      } catch (schedErrPaid) {
        console.error(`[invoice.paid] Schedule recalculation failed: ${schedErrPaid.message} — falling back to pending checkout dates`);
      }

      // Central engine is authoritative; fall back only if engine failed
      const productionDatePaid = invPaidSchedulePaid?.production_date || pendingCheckoutPaid?.production_date || meta.production_date || null;
      const firstDeliveryDatePaid = invPaidSchedulePaid?.delivery_date || pendingCheckoutPaid?.first_delivery_date || meta.first_delivery_date || null;
      const nextDeliveryDatePaid = (() => {
        if (!firstDeliveryDatePaid) return pendingCheckoutPaid?.next_delivery_date || firstDeliveryDatePaid;
        const d = new Date(firstDeliveryDatePaid + 'T12:00:00');
        d.setDate(d.getDate() + 7);
        return d.toISOString().split('T')[0];
      })();

      if (!productionDatePaid || !firstDeliveryDatePaid) {
        console.error(`[invoice.paid] Missing dates for sub ${stripeSubscriptionId}`);
        return Response.json({ received: true });
      }

      // Create Subscription record
      const newSubscriptionPaid = await base44.asServiceRole.entities.Subscription.create({
        customer_email: customerEmail,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_customer_id: invoice.customer,
        plan_id: planId,
        bundle_id: pendingCheckoutPaid?.bundle_id || meta.bundle_id || null,
        delivery_zone_id: deliveryZoneIdPaid,
        delivery_address: deliveryAddressPaid,
        status: 'active',
        started_date: firstDeliveryDatePaid,
        next_delivery_date: nextDeliveryDatePaid,
      });
      console.log(`[invoice.paid] Subscription record created: ${newSubscriptionPaid.id} (prod=${productionDatePaid} del=${firstDeliveryDatePaid}`);

      // Award loyalty points (idempotent — check description includes stripeSubscriptionId)
      const amountPaidInvoice = (invoice.amount_paid || 0) / 100;
      if (skipLoyaltyWrite(stagingSafeMode)) {
        // Loyalty is intentionally suppressed in isolated staging smoke tests.
      } else if (amountPaidInvoice > 0) {
        const pointsToAwardPaid = Math.floor(amountPaidInvoice * 10);
        const existingPointsPaid = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: customerEmail });
        const loyaltyEntryPaid = {
          amount: pointsToAwardPaid,
          type: 'earned',
          description: `Subscription payment of $${amountPaidInvoice.toFixed(2)} (subscription ${stripeSubscriptionId})`,
          timestamp: new Date().toISOString(),
        };
        if (existingPointsPaid[0]) {
          const alreadyAwardedPaid = existingPointsPaid[0].points_history?.some(h =>
            h.description?.includes(`subscription ${stripeSubscriptionId}`)
          );
          if (!alreadyAwardedPaid) {
            await base44.asServiceRole.entities.UserPoints.update(existingPointsPaid[0].id, {
              total_points: (existingPointsPaid[0].total_points || 0) + pointsToAwardPaid,
              lifetime_points: (existingPointsPaid[0].lifetime_points || 0) + pointsToAwardPaid,
              points_history: [...(existingPointsPaid[0].points_history || []), loyaltyEntryPaid],
            });
            console.log(`[invoice.paid] Awarded ${pointsToAwardPaid} pts to ${customerEmail}`);
          }
        } else {
          await base44.asServiceRole.entities.UserPoints.create({
            customer_email: customerEmail,
            total_points: pointsToAwardPaid,
            lifetime_points: pointsToAwardPaid,
            redeemed_points: 0,
            points_history: [loyaltyEntryPaid],
          });
        }
      }

      // Update PendingSubscriptionCheckout as completed
      if (pendingCheckoutId && pendingCheckoutPaid) {
        await base44.asServiceRole.entities.PendingSubscriptionCheckout.update(pendingCheckoutId, {
          status: 'completed',
          completed_at: new Date().toISOString(),
          stripe_subscription_id: stripeSubscriptionId,
        }).catch(err => console.warn(`[invoice.paid] Failed to update pending checkout: ${err.message}`));
      }

      // Sync to Hub using the new 4-fulfillment payload builder (invoice.paid path)
      // Fire-and-forget: write error log on failure so retryFailedHubSyncs can recover.
      base44.asServiceRole.functions.invoke('syncSubscriptionWithFulfillments', {
        subscription_id: newSubscriptionPaid.id,
        customer_email: customerEmail,
      }, { headers: { 'x-internal-secret': Deno.env.get('HUB_SYNC_SECRET') || '' } }).then(() => {
        console.log(`[invoice.paid] ✅ Hub sync dispatched for subscription ${newSubscriptionPaid.id}`);
      }).catch(err => {
        console.error(`[invoice.paid] Hub sync failed for subscription ${newSubscriptionPaid.id}: ${err.message}`);
        base44.asServiceRole.entities.OrderSyncLog.create({
          order_number: `SUB-${stripeSubscriptionId}`,
          status: 'error',
          description: `Hub sync failed after invoice.paid: ${err.message}. Subscription=${newSubscriptionPaid.id}. Will be retried.`,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          triggered_by: 'stripe_webhook',
        }).catch(() => {});
      });

      console.log(`[invoice.paid] ✅ Subscription ${stripeSubscriptionId} fully activated for ${customerEmail}`);
      return Response.json({ received: true });
    }

    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      const stripeSubId = sub.id;
      // CRITICAL: Match by stripe_subscription_id, NOT by customer_email alone.
      // Matching by email risks updating the wrong Subscription if a customer ever had multiple subs.
      const existingSubsUpdated = await base44.asServiceRole.entities.Subscription.filter({ stripe_subscription_id: stripeSubId });
      const newStatus = sub.status === 'active' ? 'active' : sub.status === 'paused' ? 'paused' : 'cancelled';
      const nextDeliveryStr = sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString().split('T')[0]
        : undefined;
      if (existingSubsUpdated.length > 0) {
        const existingForUpdate = existingSubsUpdated[0];
        // TERMINAL STATE GUARD: Do NOT reactivate a cancelled/skipped subscription via updated event
        // e.g. a quarantined refunded sub must not come back to 'active' from a stale Stripe event
        if (existingForUpdate.status === 'cancelled' && newStatus === 'active') {
          console.warn(`[sub.updated] Subscription ${stripeSubId} is cancelled in CA but Stripe says active. Skipping reactivation to prevent resurrection of terminal state.`);
        } else {
          const updates = { status: newStatus };
          if (nextDeliveryStr) updates.next_delivery_date = nextDeliveryStr;
          await base44.asServiceRole.entities.Subscription.update(existingForUpdate.id, updates);
          console.log(`[sub.updated] Subscription ${stripeSubId} updated to ${newStatus}`);
        }
      } else {
        console.log(`[sub.updated] No CA Subscription found for stripe_sub=${stripeSubId}, skipping`);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const stripeSubIdDeleted = sub.id;
      // CRITICAL: Match by stripe_subscription_id to avoid cancelling the wrong active subscription.
      const existingSubsDeleted = await base44.asServiceRole.entities.Subscription.filter({ stripe_subscription_id: stripeSubIdDeleted });
      if (existingSubsDeleted.length > 0) {
        const cancelledSub = existingSubsDeleted[0];
        // Determine if this was a customer-initiated period-end cancel or an admin immediate cancel
        const wasCustomerFutureCancel = sub.cancel_at_period_end === true || cancelledSub.cancel_at_period_end === true;
        const cancelType = wasCustomerFutureCancel ? 'customer_future_cancel_period_ended' : 'admin_immediate_cancel';

        await base44.asServiceRole.entities.Subscription.update(cancelledSub.id, {
          status: 'cancelled',
          cancel_at_period_end: false, // clear since it's now fully cancelled
        });
        console.log(`[sub.deleted] Subscription ${stripeSubIdDeleted} marked cancelled (type=${cancelType})`);

        // Notify Hub with cancel type so it can distinguish customer period-end vs admin refund
        base44.asServiceRole.functions.invoke('syncCustomerToHub', {
          event: wasCustomerFutureCancel ? 'customer.subscription_period_ended' : 'customer.subscription_cancelled',
          customer_email: cancelledSub.customer_email,
          data: {
            subscription_id: cancelledSub.id,
            stripe_subscription_id: stripeSubIdDeleted,
            cancel_type: cancelType,
            current_cycle_intact: wasCustomerFutureCancel, // Hub: keep fulfilled FulfillmentTasks if period-end cancel
            message: wasCustomerFutureCancel
              ? 'Customer subscription period ended after future cancellation. Current cycle was fully served. Stop all future fulfillment cycles.'
              : 'Subscription cancelled (admin/immediate). Stop all production and fulfillment.',
          },
        }).catch(err => console.warn(`[sub.deleted] Hub notify failed: ${err.message}`));
      } else {
        console.log(`[sub.deleted] No CA Subscription found for stripe_sub=${stripeSubIdDeleted}, skipping`);
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
          // IDEMPOTENCY: Check if points for this subscription have already been reversed (by admin override OR webhook)
          // Must detect both: "subscription refund" entries AND "admin cancel+refund" entries
          let loyaltyAction = 'skipped_no_record';
          if (skipLoyaltyWrite(stagingSafeMode)) {
            loyaltyAction = 'skipped_staging_safe_mode';
          } else {
            const pointsRecs = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: subEmail });
            if (pointsRecs[0]) {
              const rec = pointsRecs[0];
              // Check for ANY adjustment (admin or webhook) that mentions this subscription
              const alreadyReversed = rec.points_history?.some(h =>
                h.type === 'adjustment' && h.description?.includes(stripeSubscriptionId)
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
                console.log(`[charge.refunded] Loyalty already reversed for sub ${stripeSubscriptionId} (admin or prior webhook), skipping`);
              }
            } else {
              loyaltyAction = 'skipped_no_record';
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
      if (skipLoyaltyWrite(stagingSafeMode)) {
        // Loyalty is intentionally suppressed in isolated staging smoke tests.
      } else if (isFullRefund && order.customer_email) {
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

    // ── invoice.payment_failed — subscription payment failed ─────────────────
    // Log it and return 200 so Stripe doesn't keep retrying indefinitely with 500.
    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      const stripeSubscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
      const customerEmail = invoice.customer_email || invoice.metadata?.customer_email;
      console.warn(`[invoice.payment_failed] Invoice ${invoice.id} failed for sub=${stripeSubscriptionId}, customer=${customerEmail}`);

      // In-app notification: subscription payment failed (operational — always send)
      if (customerEmail) {
        base44.asServiceRole.functions.invoke('sendCustomerNotification', {
          customer_email: customerEmail,
          type: 'order_update',
          notification_subtype: 'subscription_payment_failed',
          title: 'Payment Needs Attention ⚠️',
          message: 'Your NuVira subscription payment could not be processed. Please update your billing information.',
          deep_link: '/account/subscriptions',
          idempotency_key: `sub_payment_failed_${invoice.id}`,
        }).catch(err => console.warn('[invoice.payment_failed] Notif failed:', err.message));
      }

      base44.asServiceRole.entities.OrderSyncLog.create({
        order_number: stripeSubscriptionId ? `SUB-${stripeSubscriptionId}` : 'SUB_PAYMENT_FAILED',
        status: 'error',
        description: `Stripe invoice.payment_failed: invoice=${invoice.id}, sub=${stripeSubscriptionId}, customer=${customerEmail}, attempt=${invoice.attempt_count}`,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        triggered_by: 'stripe_webhook',
      }).catch(() => {});
      return Response.json({ received: true });
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
        console.log(`[refund.updated] Order ${order.order_number} linked to refund ${refund.id}, status: ${refund.status}`);
        
        // REPAIR GUARD: If refund is 'succeeded' but order is NOT in terminal state, repair it now.
        // This catches cases where charge.refunded was missed but refund.updated arrives later.
        if (refund.status === 'succeeded') {
          const isAlreadyTerminal = order.status === 'refunded' || order.status === 'cancelled' || order.do_not_recover === true;
          if (!isAlreadyTerminal) {
            console.warn(`[refund.updated] Order ${order.order_number} is NOT in terminal state (status=${order.status}) but refund succeeded. Repairing to refunded.`);
            await base44.asServiceRole.entities.Order.update(order.id, {
              status: 'refunded',
              payment_status: 'refunded',
              financial_status: 'refunded',
              do_not_recover: true,
              status_history: [...(order.status_history || []), {
                status: 'refunded',
                timestamp: new Date().toISOString(),
                message: `Repaired to terminal state by refund.updated webhook. Refund ${refund.id} succeeded.`,
              }],
            });
            console.log(`[refund.updated] ✅ Repaired Order ${order.order_number} to terminal refunded state.`);
          }
        }
      }
      
      return Response.json({ received: true });
    }

    return Response.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
});
