import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    if (Deno.env.get('ENABLE_ZONE3_ROUTE_REVIEW_DECISIONS') !== 'true') {
      return Response.json({
        success: false,
        skipped: true,
        reason: 'zone3_route_review_decisions_disabled',
        message: 'Zone 3 subscription route review approvals are disabled for May 30 launch freeze.',
      }, { status: 409 });
    }

    const {
      dar_id,
      approved_delivery_fee,
      admin_decision_reason,
    } = await req.json();

    if (!dar_id) return Response.json({ error: 'dar_id is required' }, { status: 400 });
    if (!admin_decision_reason?.trim()) return Response.json({ error: 'admin_decision_reason is required' }, { status: 400 });

    // Load DAR
    const dars = await base44.asServiceRole.entities.DeliveryApprovalRequest.filter({ id: dar_id });
    const dar = dars[0];
    if (!dar) return Response.json({ error: 'DeliveryApprovalRequest not found' }, { status: 404 });

    // Validate request type and status
    if (dar.request_type !== 'subscription_route_review') {
      return Response.json({ error: 'This request is not a subscription route review.' }, { status: 400 });
    }
    if (!['pending_review', 'pending_authorization'].includes(dar.status)) {
      return Response.json({ error: `Request is in status ${dar.status}. Cannot approve.`, status: dar.status }, { status: 400 });
    }

    // Idempotency: already approved
    if (dar.status === 'approved' || dar.status === 'captured') {
      return Response.json({
        success: true,
        already_approved: true,
        dar_status: dar.status,
        created_subscription_id: dar.created_subscription_stripe_id || null,
      });
    }

    const { customer_email, selected_plan_id } = dar;
    if (!customer_email || !selected_plan_id) {
      return Response.json({ error: 'DAR missing customer_email or selected_plan_id' }, { status: 400 });
    }

    // Load plan
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({ id: selected_plan_id });
    const plan = plans[0];
    if (!plan) return Response.json({ error: 'Subscription plan not found' }, { status: 404 });
    if (!plan.stripe_price_id) return Response.json({ error: 'Plan has no Stripe price ID. Sync plan to Stripe first.' }, { status: 400 });

    // Idempotency guard: check for existing Stripe subscription for this customer+plan
    const existingSubs = await base44.asServiceRole.entities.Subscription.filter({ customer_email });
    const existingForPlan = existingSubs.find(s => s.plan_id === selected_plan_id && ['active', 'paused'].includes(s.status));
    if (existingForPlan) {
      // Mark DAR approved
      await base44.asServiceRole.entities.DeliveryApprovalRequest.update(dar_id, {
        status: 'approved',
        admin_decision: 'approved',
        admin_decision_reason,
        approved_delivery_fee: approved_delivery_fee ?? dar.estimated_delivery_fee,
        approved_by: user.email,
        approved_at: new Date().toISOString(),
        audit_trail: [...(dar.audit_trail || []), {
          action: 'approved_idempotent',
          performed_by: user.email,
          timestamp: new Date().toISOString(),
          note: `Subscription already exists (${existingForPlan.id}). Marked DAR approved without creating duplicate.`,
        }],
      });
      return Response.json({
        success: true,
        already_approved: true,
        existing_subscription_id: existingForPlan.id,
      });
    }

    // Get or create Stripe customer
    const stripeCustomerId = dar.stripe_customer_id;
    let stripeCustomer;
    if (stripeCustomerId) {
      stripeCustomer = await stripe.customers.retrieve(stripeCustomerId);
    } else {
      const customers = await stripe.customers.list({ email: customer_email, limit: 1 });
      stripeCustomer = customers.data[0] || await stripe.customers.create({
        email: customer_email,
        name: dar.customer_name || customer_email,
        phone: dar.customer_phone || undefined,
        metadata: { source_app: 'customer_app' },
      });
    }

    // Determine payment method: use saved SetupIntent PM if available
    let defaultPaymentMethod;
    if (dar.stripe_setup_intent_id) {
      try {
        const si = await stripe.setupIntents.retrieve(dar.stripe_setup_intent_id);
        if (si.status === 'succeeded' && si.payment_method) {
          defaultPaymentMethod = si.payment_method;
          console.log(`[Zone3SubApprove] Using saved PM ${defaultPaymentMethod} from SetupIntent ${si.id}`);
        }
      } catch (siErr) {
        console.warn(`[Zone3SubApprove] SetupIntent retrieve failed: ${siErr.message}`);
      }
    }

    // Calculate fulfillment schedule
    const now = new Date();
    let fulfillmentCalc;
    try {
      const schedResp = await base44.asServiceRole.functions.invoke('calculateNuViraFulfillmentSchedule', {
        created_at: now.toISOString(),
      });
      const s = schedResp.data || schedResp;
      const nextDel = new Date(s.delivery_date + 'T12:00:00');
      nextDel.setDate(nextDel.getDate() + 7);
      fulfillmentCalc = {
        production_date: s.production_date,
        first_delivery_date: s.delivery_date,
        next_delivery_date: nextDel.toISOString().split('T')[0],
        delivery_window_label: s.delivery_window_label,
        delivery_window_start: s.delivery_window_start,
        delivery_window_end: s.delivery_window_end,
        reason: s.schedule_reason,
      };
    } catch (schedErr) {
      console.error(`[Zone3SubApprove] Schedule calc failed: ${schedErr.message}`);
      return Response.json({ error: 'Failed to calculate fulfillment schedule. Please try again.' }, { status: 500 });
    }

    // Resolve delivery zone record
    const allZones = await base44.asServiceRole.entities.DeliveryZone.filter({ is_active: true });
    const matchedZone = allZones.find(z => z.zone_key === dar.zone_key) || allZones[0];
    const delivery_zone_id = matchedZone?.id || null;

    // Build shared metadata
    const finalFee = approved_delivery_fee ?? dar.estimated_delivery_fee ?? 12.99;
    const sharedMetadata = {
      base44_app_id: Deno.env.get('BASE44_APP_ID'),
      source_app: 'customer_app',
      checkout_version: '4.0_payment_element',
      checkout_type: 'subscription',
      order_type: 'subscription',
      customer_email,
      customer_name: dar.customer_name || '',
      customer_phone: dar.customer_phone || '',
      plan_id: selected_plan_id,
      plan_name: plan.name,
      billing_cadence: plan.frequency || 'monthly',
      fulfillment_cadence: 'weekly',
      fulfillment_number: '1',
      fulfillments_per_cycle: String(plan.composition_template?.deliveries_per_cycle || (plan.frequency === 'monthly' ? 4 : 1)),
      production_date: fulfillmentCalc.production_date,
      first_delivery_date: fulfillmentCalc.first_delivery_date,
      selected_delivery_date: fulfillmentCalc.first_delivery_date,
      delivery_window_label: fulfillmentCalc.delivery_window_label,
      delivery_window_start: fulfillmentCalc.delivery_window_start,
      delivery_window_end: fulfillmentCalc.delivery_window_end,
      schedule_reason: fulfillmentCalc.reason,
      schedule_timezone: 'America/Chicago',
      delivery_address: dar.delivery_address,
      delivery_address_line1: dar.address_line1 || '',
      delivery_address_line2: dar.address_line2 || '',
      delivery_city: dar.address_city || '',
      delivery_state: dar.address_state || '',
      delivery_postal_code: dar.address_postal_code || '',
      delivery_zone_id: delivery_zone_id || '',
      approved_delivery_fee: String(finalFee),
      zone3_dar_id: dar_id,
      zone3_request_number: dar.request_number || '',
    };

    // Create PendingSubscriptionCheckout
    const planComposition = plan.composition_template?.bottles_per_delivery || [];
    const products = planComposition.map(b => ({ product_name: b.flavor || 'Juice', quantity: b.quantity || 1 }));
    const fulfillmentsPerCycle = plan.composition_template?.deliveries_per_cycle || (plan.frequency === 'monthly' ? 4 : 1);
    const itemsSummary = products.length > 0 ? products.map(p => `${p.quantity}x ${p.product_name}`).join(', ') : plan.name;

    let pendingCheckout;
    try {
      pendingCheckout = await base44.asServiceRole.entities.PendingSubscriptionCheckout.create({
        customer_email,
        customer_name: dar.customer_name || '',
        customer_phone: dar.customer_phone || '',
        plan_id: selected_plan_id,
        plan_name: plan.name,
        cadence: plan.frequency || 'monthly',
        delivery_address: dar.delivery_address,
        address_line1: dar.address_line1 || '',
        address_line2: dar.address_line2 || '',
        address_city: dar.address_city || '',
        address_state: dar.address_state || '',
        address_postal_code: dar.address_postal_code || '',
        address_country: 'US',
        delivery_zone_id,
        products,
        order_timestamp: now.toISOString(),
        order_date: fulfillmentCalc.production_date,
        order_time: now.toTimeString().substring(0, 5),
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
        items_summary: itemsSummary,
        decomposition_version: 'v2_weekly_decomposed',
        notes: `Zone 3 subscription approved by ${user.email}. Request: ${dar.request_number}. Fee: $${finalFee}.`,
        status: 'pending',
      });
      console.log(`[Zone3SubApprove] Created PendingSubscriptionCheckout: ${pendingCheckout.id}`);
    } catch (pcErr) {
      console.error(`[Zone3SubApprove] PendingCheckout creation failed: ${pcErr.message}`);
      return Response.json({ error: 'Failed to prepare subscription. Please try again.' }, { status: 500 });
    }

    const metaWithPending = { ...sharedMetadata, pending_subscription_checkout_id: pendingCheckout.id };

    // Create Stripe Subscription
    const subCreateParams = {
      customer: stripeCustomer.id,
      items: [{ price: plan.stripe_price_id }],
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
        payment_method_types: ['card'],
      },
      expand: ['latest_invoice.payment_intent'],
      metadata: metaWithPending,
    };

    // If we have a saved payment method from SetupIntent, attach it and use error_if_incomplete
    if (defaultPaymentMethod) {
      subCreateParams.default_payment_method = defaultPaymentMethod;
      subCreateParams.payment_behavior = 'error_if_incomplete';
    }

    let stripeSubscription;
    try {
      stripeSubscription = await stripe.subscriptions.create(subCreateParams);
    } catch (stripeErr) {
      console.error(`[Zone3SubApprove] Stripe subscription creation failed: ${stripeErr.message}`);
      // Clean up pending checkout
      await base44.asServiceRole.entities.PendingSubscriptionCheckout.update(pendingCheckout.id, {
        status: 'failed',
        error_message: stripeErr.message,
      }).catch(() => {});
      return Response.json({ error: `Payment processing failed: ${stripeErr.message}` }, { status: 500 });
    }

    const invoice = stripeSubscription.latest_invoice;
    const paymentIntent = invoice?.payment_intent;

    // Update pending checkout with stripe IDs
    await base44.asServiceRole.entities.PendingSubscriptionCheckout.update(pendingCheckout.id, {
      stripe_checkout_session_id: stripeSubscription.id,
      stripe_subscription_id: stripeSubscription.id,
      stripe_customer_id: stripeCustomer.id,
    }).catch(() => {});

    // Mark DAR approved
    await base44.asServiceRole.entities.DeliveryApprovalRequest.update(dar_id, {
      status: 'approved',
      admin_decision: 'approved',
      admin_decision_reason,
      approved_delivery_fee: finalFee,
      approved_by: user.email,
      approved_at: new Date().toISOString(),
      created_subscription_stripe_id: stripeSubscription.id,
      audit_trail: [...(dar.audit_trail || []), {
        action: 'subscription_approved',
        performed_by: user.email,
        timestamp: new Date().toISOString(),
        note: `Stripe subscription ${stripeSubscription.id} created. Delivery fee: $${finalFee}. Reason: ${admin_decision_reason}`,
      }],
    });

    console.log(`[Zone3SubApprove] ✅ Stripe subscription ${stripeSubscription.id} created for ${customer_email}`);

    // If subscription is already active (PM was saved), trigger Hub sync directly
    if (stripeSubscription.status === 'active') {
      // Create CA Subscription record immediately
      const caSubscription = await base44.asServiceRole.entities.Subscription.create({
        customer_email,
        stripe_subscription_id: stripeSubscription.id,
        stripe_customer_id: stripeCustomer.id,
        plan_id: selected_plan_id,
        delivery_zone_id,
        delivery_address: dar.delivery_address,
        status: 'active',
        started_date: fulfillmentCalc.first_delivery_date,
        next_delivery_date: fulfillmentCalc.next_delivery_date,
      });

      await base44.asServiceRole.entities.PendingSubscriptionCheckout.update(pendingCheckout.id, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        stripe_subscription_id: stripeSubscription.id,
      }).catch(() => {});

      // Sync to Hub
      base44.asServiceRole.functions.invoke('syncSubscriptionWithFulfillments', {
        subscription_id: caSubscription.id,
        customer_email,
      }, { headers: { 'x-internal-secret': Deno.env.get('HUB_SYNC_SECRET') || '' } })
        .catch(err => console.error(`[Zone3SubApprove] Hub sync failed: ${err.message}`));

      // Notify customer
      base44.asServiceRole.functions.invoke('sendCustomerNotification', {
        customer_email,
        type: 'order_update',
        notification_subtype: 'subscription_payment_success',
        title: 'Subscription Approved & Active! 🎉',
        message: `Great news! Your Zone 3 delivery route has been approved and your ${plan.name} subscription is now active. First delivery: ${fulfillmentCalc.first_delivery_date}.`,
        deep_link: '/account/subscriptions',
        idempotency_key: `zone3_sub_approved_active_${dar_id}`,
      }).catch(() => {});

      return Response.json({
        success: true,
        stripe_subscription_id: stripeSubscription.id,
        subscription_status: 'active',
        ca_subscription_id: caSubscription.id,
        hub_sync_dispatched: true,
        requires_payment: false,
      });
    }

    // Subscription is incomplete — needs payment
    // Notify customer to complete payment
    base44.asServiceRole.functions.invoke('sendCustomerNotification', {
      customer_email,
      type: 'general',
      title: 'Subscription Route Approved! 🎉',
      message: `Your delivery route has been approved! Please complete your subscription payment to activate your ${plan.name} plan. Check your subscriptions page.`,
      deep_link: '/account/subscriptions',
      idempotency_key: `zone3_sub_approved_needs_payment_${dar_id}`,
    }).catch(() => {});

    return Response.json({
      success: true,
      stripe_subscription_id: stripeSubscription.id,
      subscription_status: stripeSubscription.status,
      payment_intent_client_secret: paymentIntent?.client_secret || null,
      requires_payment: stripeSubscription.status === 'incomplete',
      pending_checkout_id: pendingCheckout.id,
    });

  } catch (error) {
    console.error('[Zone3SubApprove] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
