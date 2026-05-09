import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

/**
 * createSubscriptionPaymentElementIntent
 *
 * Creates a Stripe Subscription in default_incomplete state and returns
 * the first invoice's PaymentIntent client_secret for in-app Payment Element.
 *
 * This is the same pattern as one-time orders — customer stays inside the app,
 * no external redirect, no EmbeddedCheckout iframe.
 *
 * Flow:
 *  1. Validate plan + customer
 *  2. Create PendingSubscriptionCheckout with full metadata & delivery dates
 *  3. Get/create Stripe Customer
 *  4. Create Stripe Subscription (default_incomplete) — expand latest_invoice.payment_intent
 *  5. Return { paymentIntentClientSecret, stripeSubscriptionId, pendingCheckoutId, publishableKey, planName, amountDue }
 */

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));



Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const {
      plan_id,
      bundle_id,
      customer_email,
      contact_phone,
      address_line1,
      address_line2,
      address_city,
      address_state,
      address_postal_code,
      delivery_address,
    } = await req.json();

    if (!plan_id || !customer_email) {
      return Response.json({ error_code: 'MISSING_PARAMS', error: 'Missing plan_id or customer_email' }, { status: 400 });
    }

    // Resolve customer name from profile
    let customer_name = '';
    let profileFound = false;
    try {
      const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email });
      if (profiles[0]) {
        profileFound = true;
        const { first_name, last_name } = profiles[0];
        customer_name = [first_name, last_name].filter(Boolean).join(' ');
        console.log(`[SubPE] Profile found for ${customer_email}: first_name="${first_name}" last_name="${last_name}" → customer_name="${customer_name}"`);
      } else {
        console.warn(`[SubPE] No UserProfile found for ${customer_email}`);
      }
    } catch (err) {
      console.warn(`[SubPE] Failed to fetch UserProfile: ${err.message}`);
    }

    if (!profileFound) {
      return Response.json({ error_code: 'MISSING_PROFILE', error: 'Profile not found. Please complete your account setup before subscribing.' }, { status: 400 });
    }

    if (!customer_name?.trim()) {
      return Response.json({ error_code: 'MISSING_NAME', error: 'Your profile is missing a name. Please update your profile (first and last name) before subscribing.' }, { status: 400 });
    }

    // Fetch plan
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({ id: plan_id });
    if (!plans[0]) return Response.json({ error_code: 'PLAN_NOT_FOUND', error: 'Subscription plan not found' }, { status: 404 });
    const plan = plans[0];

    if (!plan.stripe_price_id) {
      return Response.json({ error_code: 'MISSING_STRIPE_PRICE_ID', error: 'This subscription plan is not yet available for purchase. Please contact support.' }, { status: 400 });
    }

    // Check for existing active subscription on same plan — check BOTH CA records AND Stripe directly.
    // CA records may be missing if webhook failed, so Stripe is authoritative.
    const existingSubs = await base44.asServiceRole.entities.Subscription.filter({ customer_email });
    const hasActiveSub = existingSubs.some(s => s.plan_id === plan_id && s.status === 'active');
    if (hasActiveSub) {
      return Response.json({ error_code: 'ALREADY_SUBSCRIBED', error: 'You already have an active subscription with this plan.' }, { status: 400 });
    }

    // CRITICAL: Also check Stripe directly — CA records can be missing even when Stripe has an active subscription.
    // This is the root cause of duplicate purchases when webhooks fail.
    try {
      const stripeCustomersCheck = await stripe.customers.list({ email: customer_email, limit: 1 });
      const existingStripeCustomer = stripeCustomersCheck.data[0];
      if (existingStripeCustomer) {
        const activeStripeSubs = await stripe.subscriptions.list({
          customer: existingStripeCustomer.id,
          status: 'active',
          limit: 10,
        });
        // CRITICAL: Block if ANY active subscription exists, not just matching plan.
        // Sukhwant's case: original active sub had no CA record; customer created duplicate.
        // Stripe is authoritative when CA record is missing.
        if (activeStripeSubs.data.length > 0) {
          const activeSubId = activeStripeSubs.data[0].id;
          console.warn(`[SubPE] Stripe has active sub ${activeSubId} for ${customer_email}. CA record may be missing. Blocking checkout and triggering reconciliation.`);

          // Fire reconciliation in background to create missing CA record
          base44.asServiceRole.functions.invoke('repairMissingCASubscriptionFromStripeAndHub', {
            stripe_subscription_id: activeSubId,
            customer_email,
          }).catch(err => console.warn(`[SubPE] Background reconcile failed: ${err.message}`));

          return Response.json({
            error_code: 'ALREADY_SUBSCRIBED_OR_ACTIVATING',
            error: 'You already have an active subscription. If you don\'t see it yet, it may still be activating — please check My Subscriptions in a moment or contact support.',
          }, { status: 400 });
        }

        // Also check incomplete/past_due subscriptions — don't create a duplicate
        const pendingStripeSubs = await stripe.subscriptions.list({
          customer: existingStripeCustomer.id,
          status: 'past_due',
          limit: 5,
        });
        if (pendingStripeSubs.data.length > 0) {
          console.warn(`[SubPE] Stripe has ${pendingStripeSubs.data.length} past_due sub(s) for ${customer_email}. Blocking new checkout.`);
          return Response.json({
            error_code: 'ALREADY_SUBSCRIBED_OR_ACTIVATING',
            error: 'You have a subscription with a payment issue. Please check My Subscriptions or contact support to resolve it.',
          }, { status: 400 });
        }
      }
    } catch (stripeCheckErr) {
      console.warn(`[SubPE] Stripe active sub check failed (non-blocking): ${stripeCheckErr.message}`);
    }

    // Check for existing incomplete Stripe subscription on this customer+plan (from a prior failed render attempt).
    // Stripe rejects creating a second subscription when one is already `incomplete` for the same customer.
    // Solution: find and reuse the existing incomplete subscription's PaymentIntent instead of creating a new one.
    try {
      const incompleteList = await stripe.subscriptions.list({
        customer: (await stripe.customers.list({ email: customer_email, limit: 1 })).data[0]?.id || '__none__',
        status: 'incomplete',
        limit: 5,
      });
      for (const incompleteSub of incompleteList.data) {
        if (incompleteSub.metadata?.plan_id !== plan_id) continue;
        if (incompleteSub.metadata?.source_app !== 'customer_app') continue;
        // Found a matching incomplete subscription — retrieve its PaymentIntent and reuse it
        const invoice = await stripe.invoices.retrieve(incompleteSub.latest_invoice, {
          expand: ['payment_intent'],
        });
        const existingPi = invoice.payment_intent;
        if (existingPi?.client_secret) {
          console.log(`[SubPE] Reusing existing incomplete subscription ${incompleteSub.id} / PI ${existingPi.id} for ${customer_email}`);
          // Update the pending checkout record if one exists for this sub
          const existingPending = await base44.asServiceRole.entities.PendingSubscriptionCheckout.filter({
            stripe_subscription_id: incompleteSub.id,
            customer_email,
          }).catch(() => []);
          const pendingRecord = existingPending[0];
          return Response.json({
            success: true,
            paymentIntentClientSecret: existingPi.client_secret,
            stripeSubscriptionId: incompleteSub.id,
            pendingCheckoutId: pendingRecord?.id || null,
            publishableKey: Deno.env.get('STRIPE_PUBLISHABLE_KEY'),
            planName: plan.name,
            amountDue: (invoice.amount_due || 0) / 100,
            reused: true,
          });
        }
      }
    } catch (reuseErr) {
      console.warn(`[SubPE] Incomplete subscription reuse check failed: ${reuseErr.message} — proceeding to create new`);
    }

    // Delivery zone
    const allZones = await base44.asServiceRole.entities.DeliveryZone.filter({ is_active: true });
    const delivery_zone_id = allZones[0]?.id || null;

    const resolvedAddress = delivery_address ||
      [address_line1, address_city, address_state, address_postal_code].filter(Boolean).join(', ');

    // ── CENTRAL SCHEDULE ENGINE ──────────────────────────────────────────
    // Call calculateNuViraFulfillmentSchedule as single source of truth for dates
    const now = new Date();
    let fulfillmentCalc;
    try {
      const scheduleResp = await base44.asServiceRole.functions.invoke('calculateNuViraFulfillmentSchedule', {
        created_at: now.toISOString(),
      });
      const scheduleResult = scheduleResp.data || scheduleResp;
      
      // Calculate next delivery date based on plan cadence
      const nextDeliveryDate = new Date(scheduleResult.delivery_date);
      if (plan.frequency === 'weekly') {
        nextDeliveryDate.setDate(nextDeliveryDate.getDate() + 7);
      } else {
        nextDeliveryDate.setMonth(nextDeliveryDate.getMonth() + 1);
      }

      fulfillmentCalc = {
        production_date: scheduleResult.production_date,
        first_delivery_date: scheduleResult.delivery_date,
        next_delivery_date: nextDeliveryDate.toISOString().split('T')[0],
        delivery_window_label: scheduleResult.delivery_window_label,
        delivery_window_start: scheduleResult.delivery_window_start,
        delivery_window_end: scheduleResult.delivery_window_end,
        reason: scheduleResult.schedule_reason,
        order_date: scheduleResult.production_date,
        order_time: now.toTimeString().substring(0, 5),
        cutoff_window_label: scheduleResult.cutoff_window_label,
      };
    } catch (schedErr) {
      console.error(`[SubPE] Schedule calculation failed: ${schedErr.message}`);
      return Response.json({ error: 'Failed to calculate delivery schedule. Please try again.' }, { status: 500 });
    }
    console.log(`[SubPE] Fulfillment: production=${fulfillmentCalc.production_date}, first_delivery=${fulfillmentCalc.first_delivery_date}, reason=${fulfillmentCalc.reason}`);

    // Get or create Stripe Customer
    const customers = await stripe.customers.list({ email: customer_email, limit: 1 });
    const stripeCustomer = customers.data[0] || await stripe.customers.create({
      email: customer_email,
      name: customer_name,
      phone: contact_phone || undefined,
      metadata: { source_app: 'customer_app' },
    });
    console.log(`[SubPE] Stripe customer: ${stripeCustomer.id}`);

    // Product decomposition
    const planComposition = plan.composition_template?.bottles_per_delivery || [];
    const products = planComposition.map(b => ({ product_name: b.flavor || 'Juice', quantity: b.quantity || 1 }));
    const billingCadence = plan.frequency || 'monthly';
    const fulfillmentsPerCycle = plan.composition_template?.deliveries_per_cycle || (billingCadence === 'monthly' ? 4 : 1);
    const itemsSummaryStr = products.length > 0
      ? products.map(p => `${p.quantity}x ${p.product_name}`).join(', ')
      : plan.name;

    // Build shared metadata object — centralized schedule fields
    const sharedMetadata = {
      base44_app_id: Deno.env.get('BASE44_APP_ID'),
      source_app: 'customer_app',
      checkout_version: '4.0_payment_element',
      checkout_type: 'subscription',
      source_type: 'subscription_fulfillment',
      order_type: 'subscription',
      customer_email: customer_email || '',
      customer_name: customer_name || '',
      customer_phone: contact_phone || '',
      plan_id,
      plan_name: plan.name,
      billing_cadence: billingCadence,
      fulfillment_cadence: 'weekly',
      fulfillment_number: '1',
      fulfillments_per_cycle: String(fulfillmentsPerCycle),
      production_date: fulfillmentCalc.production_date,
      first_delivery_date: fulfillmentCalc.first_delivery_date,
      selected_delivery_date: fulfillmentCalc.first_delivery_date,
      requested_delivery_date: fulfillmentCalc.first_delivery_date,
      delivery_window_label: fulfillmentCalc.delivery_window_label,
      delivery_window_start: fulfillmentCalc.delivery_window_start,
      delivery_window_end: fulfillmentCalc.delivery_window_end,
      schedule_reason: fulfillmentCalc.reason,
      cutoff_window_label: fulfillmentCalc.cutoff_window_label || '',
      schedule_timezone: 'America/Chicago',
      items_summary: itemsSummaryStr,
      delivery_address: resolvedAddress,
      delivery_address_line1: address_line1 || '',
      delivery_address_line2: address_line2 || '',
      delivery_city: address_city || '',
      delivery_state: address_state || '',
      delivery_postal_code: address_postal_code || '',
      delivery_zone_id: delivery_zone_id || '',
      bundle_id: bundle_id || '',
    };

    // Create PendingSubscriptionCheckout BEFORE creating the Stripe subscription
    let pendingCheckout = null;
    try {
      pendingCheckout = await base44.asServiceRole.entities.PendingSubscriptionCheckout.create({
        customer_email,
        customer_name,
        customer_phone: contact_phone || '',
        plan_id,
        plan_name: plan.name,
        cadence: billingCadence,
        bundle_id: bundle_id || null,
        delivery_address: resolvedAddress,
        address_line1: address_line1 || '',
        address_line2: address_line2 || '',
        address_city: address_city || '',
        address_state: address_state || '',
        address_postal_code: address_postal_code || '',
        address_country: 'US',
        delivery_zone_id,
        products,
        order_timestamp: now.toISOString(),
        order_date: fulfillmentCalc.order_date,
        order_time: fulfillmentCalc.order_time,
        production_date: fulfillmentCalc.production_date,
        first_delivery_date: fulfillmentCalc.first_delivery_date,
        next_delivery_date: fulfillmentCalc.next_delivery_date,
        delivery_window_label: fulfillmentCalc.delivery_window_label,
        delivery_window_start: fulfillmentCalc.delivery_window_start,
        delivery_window_end: fulfillmentCalc.delivery_window_end,
        date_calculation_reason: fulfillmentCalc.reason,
        date_calculation_version: 'v2_may_2026',
        stripe_customer_id: stripeCustomer.id,
        fulfillment_cadence: 'weekly',
        fulfillments_per_cycle: fulfillmentsPerCycle,
        fulfillment_number: 1,
        items_summary: itemsSummaryStr,
        decomposition_version: 'v2_weekly_decomposed',
        status: 'pending',
      });
      console.log(`[SubPE] Created PendingSubscriptionCheckout: ${pendingCheckout.id}`);
    } catch (pendingErr) {
      console.error(`[SubPE] Failed to create PendingSubscriptionCheckout: ${pendingErr.message}`);
      return Response.json({ error: 'Failed to prepare subscription checkout. Please try again.' }, { status: 500 });
    }

    const metadataWithPendingId = {
      ...sharedMetadata,
      pending_subscription_checkout_id: pendingCheckout.id,
    };

    // Create Stripe Subscription in default_incomplete state
    // This creates a subscription + first invoice + PaymentIntent — all in one call
    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomer.id,
      items: [{ price: plan.stripe_price_id }],
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
        payment_method_types: ['card'],
      },
      expand: ['latest_invoice.payment_intent'],
      metadata: metadataWithPendingId,
    });

    const invoice = subscription.latest_invoice;
    const paymentIntent = invoice?.payment_intent;

    if (!paymentIntent?.client_secret) {
      console.error(`[SubPE] No client_secret on PaymentIntent for subscription ${subscription.id}`);
      // Clean up the incomplete subscription
      await stripe.subscriptions.cancel(subscription.id).catch(() => {});
      return Response.json({ error: 'Failed to initialize payment. Please try again.' }, { status: 500 });
    }

    // Update subscription metadata on the PaymentIntent for webhook idempotency
    await stripe.paymentIntents.update(paymentIntent.id, {
      metadata: metadataWithPendingId,
    }).catch(err => console.warn(`[SubPE] Failed to update PI metadata: ${err.message}`));

    // Update PendingSubscriptionCheckout with stripe subscription + session IDs
    await base44.asServiceRole.entities.PendingSubscriptionCheckout.update(pendingCheckout.id, {
      stripe_checkout_session_id: subscription.id, // reuse field for stripe_subscription_id reference
      stripe_subscription_id: subscription.id,
      stripe_customer_id: stripeCustomer.id,
    }).catch(err => console.warn(`[SubPE] Failed to update pending checkout: ${err.message}`));

    console.log(`[SubPE] Subscription ${subscription.id} created (incomplete), PI ${paymentIntent.id} ready for ${customer_email}`);

    return Response.json({
      success: true,
      paymentIntentClientSecret: paymentIntent.client_secret,
      stripeSubscriptionId: subscription.id,
      pendingCheckoutId: pendingCheckout.id,
      publishableKey: Deno.env.get('STRIPE_PUBLISHABLE_KEY'),
      planName: plan.name,
      amountDue: (invoice.amount_due || 0) / 100,
    });

  } catch (error) {
    console.error('[SubPE] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});