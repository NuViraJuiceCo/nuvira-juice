import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

/**
 * createSubscriptionPaymentIntentV2
 * Creates a PendingSubscriptionCheckout record with full metadata BEFORE creating Stripe session.
 * Stores calculated production and delivery dates for idempotent webhook handling.
 */

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

async function authorizeCheckoutCustomer(base44, customerEmail) {
  const user = await base44.auth.me().catch(() => null);
  const requested = String(customerEmail || '').trim().toLowerCase();
  const requester = String(user?.email || '').trim().toLowerCase();
  if (!user?.email || !requested) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (user.role === 'admin' || requester === requested) return null;
  return Response.json({ error: 'forbidden' }, { status: 403 });
}

// Inline the resolver since we can't import from lib
function resolveSubscriptionFirstFulfillment(orderTimestamp, options = {}) {
  const orderDate = new Date(orderTimestamp);
  const chicagoFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  const parts = chicagoFormatter.formatToParts(orderDate);
  const pm = {};
  parts.forEach(p => { pm[p.type] = p.value; });

  const chicagoDateTime = new Date(parseInt(pm.year), parseInt(pm.month) - 1, parseInt(pm.day), parseInt(pm.hour), parseInt(pm.minute));
  const dow = chicagoDateTime.getDay();
  const cutoffHour = 14;

  let daysToNextProduction = 0, reason = '';
  if (dow === 0) { daysToNextProduction = 2; reason = 'Sunday → Tuesday production'; }
  else if (dow === 1) { daysToNextProduction = 1; reason = 'Monday → Tuesday production'; }
  else if (dow === 2) { daysToNextProduction = chicagoFormatter < cutoffHour ? 0 : 3; reason = dow === 2 ? (chicagoFormatter < cutoffHour ? 'Tuesday before cutoff' : 'Tuesday after cutoff → Friday') : ''; }
  else if (dow === 3) { daysToNextProduction = 2; reason = 'Wednesday → Friday production'; }
  else if (dow === 4) { daysToNextProduction = 1; reason = 'Thursday → Friday production'; }
  else if (dow === 5) { daysToNextProduction = parseInt(pm.hour) < cutoffHour ? 0 : 1; reason = parseInt(pm.hour) < cutoffHour ? 'Friday before cutoff' : 'Friday after cutoff → Saturday'; }
  else if (dow === 6) { daysToNextProduction = parseInt(pm.hour) < cutoffHour ? 0 : 3; reason = parseInt(pm.hour) < cutoffHour ? 'Saturday before cutoff' : 'Saturday after cutoff → Tuesday'; }

  const productionDate = new Date(chicagoDateTime);
  productionDate.setDate(productionDate.getDate() + daysToNextProduction);
  const productionDateStr = productionDate.toISOString().split('T')[0];

  const deliveryDate = new Date(productionDate);
  deliveryDate.setDate(deliveryDate.getDate() + 1);
  const firstDeliveryDateStr = deliveryDate.toISOString().split('T')[0];

  const nextDeliveryDate = new Date(deliveryDate);
  if (options.plan_cadence === 'weekly') {
    nextDeliveryDate.setDate(nextDeliveryDate.getDate() + 7);
  } else {
    nextDeliveryDate.setMonth(nextDeliveryDate.getMonth() + 1);
  }

  return {
    production_date: productionDateStr,
    first_delivery_date: firstDeliveryDateStr,
    next_delivery_date: nextDeliveryDate.toISOString().split('T')[0],
    delivery_window_label: options.custom_delivery_window?.label || '5 PM – 8 PM',
    delivery_window_start: options.custom_delivery_window?.start || '17:00',
    delivery_window_end: options.custom_delivery_window?.end || '20:00',
    reason: reason,
    order_date: chicagoDateTime.toISOString().split('T')[0],
    order_time: `${String(parseInt(pm.hour)).padStart(2, '0')}:${String(parseInt(pm.minute)).padStart(2, '0')}`,
  };
}

Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_SUBSCRIPTION_CHECKOUTS') !== 'true') {
      return Response.json({
        success: false,
        skipped: true,
        reason: 'subscription_checkouts_disabled',
        message: 'Subscription checkout is currently unavailable. One-time orders are still available.',
      }, { status: 409 });
    }

    const base44 = createClientFromRequest(req);

    const {
      plan_id,
      bundle_id,
      customer_email,
      customer_name: checkoutCustomerName,
      contact_phone,
      address_line1,
      address_line2,
      address_city,
      address_state,
      address_postal_code,
      delivery_address,
    } = await req.json();
    const unauthorized = await authorizeCheckoutCustomer(base44, customer_email);
    if (unauthorized) return unauthorized;

    if (!plan_id || !customer_email) {
      return Response.json({ error: 'Missing plan_id or customer_email' }, { status: 400 });
    }

    // Resolve customer name
    let customer_name = checkoutCustomerName?.trim() || '';
    if (!customer_name && customer_email) {
      try {
        const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email });
        if (profiles[0]) {
          const { first_name, last_name } = profiles[0];
          customer_name = [first_name, last_name].filter(Boolean).join(' ');
        }
      } catch (err) {
        console.warn(`[SubPIv2] Failed to fetch UserProfile for ${customer_email}: ${err.message}`);
      }
    }

    if (!customer_name?.trim()) {
      return Response.json({ error: 'Customer name is required. Please complete your profile before subscribing.' }, { status: 400 });
    }

    // Fetch subscription plan
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({ id: plan_id });
    if (plans.length === 0) {
      return Response.json({ error: 'Subscription plan not found' }, { status: 404 });
    }
    const subscriptionPlan = plans[0];

    if (!subscriptionPlan.stripe_price_id) {
      return Response.json({
        error: 'This subscription plan is not yet available for purchase. Please contact support.'
      }, { status: 400 });
    }

    // Check for existing active subscription
    const existingSubs = await base44.asServiceRole.entities.Subscription.filter({ customer_email });
    const hasActiveSub = existingSubs.some(s => s.plan_id === plan_id && s.status === 'active');
    if (hasActiveSub) {
      return Response.json({ error: 'You already have an active subscription with this plan.' }, { status: 400 });
    }

    // Resolve delivery zone
    const allZones = await base44.asServiceRole.entities.DeliveryZone.filter({ is_active: true });
    const defaultZone = allZones[0]; // Use first active zone as default for subscriptions
    const delivery_zone_id = defaultZone?.id || null;

    const resolvedAddress = delivery_address ||
      [address_line1, address_city, address_state, address_postal_code].filter(Boolean).join(', ');

    // CRITICAL: Calculate production and delivery dates BEFORE creating Stripe session
    const now = new Date();
    const fulfillmentCalc = resolveSubscriptionFirstFulfillment(now.toISOString(), {
      plan_cadence: subscriptionPlan.frequency,
      custom_delivery_window: null,
    });

    console.log(`[SubPIv2] Fulfillment calculated: production=${fulfillmentCalc.production_date}, first_delivery=${fulfillmentCalc.first_delivery_date}, reason=${fulfillmentCalc.reason}`);

    // Get or create Stripe Customer
    let stripeCustomer = null;
    const customers = await stripe.customers.list({ email: customer_email, limit: 1 });
    if (customers.data.length > 0) {
      stripeCustomer = customers.data[0];
    } else {
      stripeCustomer = await stripe.customers.create({
        email: customer_email,
        name: customer_name || undefined,
        phone: contact_phone || undefined,
        metadata: {
          customer_name: customer_name || '',
          source_app: 'customer_app',
        },
      });
      console.log(`[SubPIv2] Created Stripe Customer: ${stripeCustomer.id} for ${customer_email}`);
    }

    // Hoist decomposition variables so they're available for both PendingCheckout and Stripe metadata
    const planComposition = subscriptionPlan.composition_template?.bottles_per_delivery || [];
    const products = planComposition.map(bottle => ({
      product_name: bottle.flavor || 'Juice',
      quantity: bottle.quantity || 1,
    }));
    const billingCadence = subscriptionPlan.frequency || 'monthly';
    const fulfillmentCadence = 'weekly';
    const fulfillmentsPerCycle = subscriptionPlan.composition_template?.deliveries_per_cycle || (billingCadence === 'monthly' ? 4 : 1);
    const itemsSummaryStr = products.length > 0
      ? products.map(p => `${p.quantity}x ${p.product_name}`).join(', ')
      : subscriptionPlan.name;

    console.log(`[SubPIv2] Plan decomposition: ${subscriptionPlan.name} → ${itemsSummaryStr} | billing=${billingCadence} fulfillment=${fulfillmentCadence} per_cycle=${fulfillmentsPerCycle}`);

    // Step 1: Create PendingSubscriptionCheckout record with full metadata
    let pendingCheckout = null;
    try {
      pendingCheckout = await base44.asServiceRole.entities.PendingSubscriptionCheckout.create({
        customer_email,
        customer_name,
        customer_phone: contact_phone || '',
        plan_id,
        plan_name: subscriptionPlan.name,
        cadence: billingCadence,
        bundle_id: bundle_id || null,
        delivery_address: resolvedAddress,
        address_line1: address_line1 || '',
        address_line2: address_line2 || '',
        address_city: address_city || '',
        address_state: address_state || '',
        address_postal_code: address_postal_code || '',
        address_country: 'US',
        delivery_zone_id: delivery_zone_id,
        products: products,
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
        // Fulfillment decomposition fields (stored as first-class fields)
        fulfillment_cadence: fulfillmentCadence,
        fulfillments_per_cycle: fulfillmentsPerCycle,
        fulfillment_number: 1,
        items_summary: itemsSummaryStr,
        decomposition_version: 'v2_weekly_decomposed',
        status: 'pending',
      });
      console.log(`[SubPIv2] Created PendingSubscriptionCheckout: ${pendingCheckout.id}`);
    } catch (pendingErr) {
      console.error(`[SubPIv2] Failed to create PendingSubscriptionCheckout: ${pendingErr.message}`);
      return Response.json({ error: 'Failed to prepare subscription checkout. Please try again.' }, { status: 500 });
    }

    // Step 2: Create Stripe Checkout Session with essential metadata + reference to pending record
    const subscriptionMetadata = {
      base44_app_id: Deno.env.get('BASE44_APP_ID'),
      source_app: 'customer_app',
      checkout_version: '3.0_embedded',
      // Recovery: webhook uses pending_subscription_checkout_id as primary lookup
      checkout_type: 'subscription',
      source_type: 'subscription_fulfillment',
      order_type: 'subscription',
      pending_subscription_checkout_id: pendingCheckout.id,
      // Customer identity
      customer_email: customer_email || '',
      customer_name: customer_name || '',
      customer_phone: contact_phone || '',
      // Plan
      plan_id: plan_id,
      plan_name: subscriptionPlan.name,
      billing_cadence: billingCadence,
      fulfillment_cadence: fulfillmentCadence,
      fulfillment_number: '1',
      fulfillments_per_cycle: String(fulfillmentsPerCycle),
      // Fulfillment dates
      production_date: fulfillmentCalc.production_date,
      first_delivery_date: fulfillmentCalc.first_delivery_date,
      delivery_window_label: fulfillmentCalc.delivery_window_label,
      // Products summary (flat string — Stripe metadata values must be strings)
      items_summary: itemsSummaryStr,
      // Address
      delivery_address: resolvedAddress,
      delivery_address_line1: address_line1 || '',
      delivery_address_line2: address_line2 || '',
      delivery_city: address_city || '',
      delivery_state: address_state || '',
      delivery_postal_code: address_postal_code || '',
      delivery_zone_id: delivery_zone_id || '',
      bundle_id: bundle_id || '',
    };

    const origin = req.headers.get('origin') || 'https://www.nuvirajuice.com';

    // Create embedded Stripe Checkout Session for subscription
    // Full structured payload stored on the Stripe Subscription object for Hub recovery
    const subscriptionStructuredMetadata = {
      ...subscriptionMetadata,
      // Structured address block (flat keys on Stripe Subscription metadata)
      'address.line1': address_line1 || '',
      'address.city': address_city || '',
      'address.state': address_state || '',
      'address.postal_code': address_postal_code || '',
      // First fulfillment block
      'first_fulfillment.fulfillment_number': '1',
      'first_fulfillment.production_date': fulfillmentCalc.production_date,
      'first_fulfillment.delivery_date': fulfillmentCalc.first_delivery_date,
      'first_fulfillment.delivery_window_label': fulfillmentCalc.delivery_window_label,
    };

    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      mode: 'subscription',
      customer: stripeCustomer.id,
      line_items: [
        { price: subscriptionPlan.stripe_price_id, quantity: 1 },
      ],
      subscription_data: { metadata: subscriptionStructuredMetadata },
      metadata: subscriptionMetadata,
      return_url: `${origin}/account/subscriptions?session_id={CHECKOUT_SESSION_ID}`,
    });

    // Step 3: Update PendingSubscriptionCheckout with session ID
    try {
      await base44.asServiceRole.entities.PendingSubscriptionCheckout.update(pendingCheckout.id, {
        stripe_checkout_session_id: session.id,
      });
    } catch (updateErr) {
      console.warn(`[SubPIv2] Failed to update PendingSubscriptionCheckout with session ID: ${updateErr.message}`);
    }

    console.log(`[SubPIv2] Created embedded subscription session ${session.id} for ${customer_email}, plan: ${subscriptionPlan.name}, pending_checkout=${pendingCheckout.id}`);

    return Response.json({
      success: true,
      clientSecret: session.client_secret,
      sessionId: session.id,
      pendingCheckoutId: pendingCheckout.id,
      publishableKey: Deno.env.get('STRIPE_PUBLISHABLE_KEY'),
      planName: subscriptionPlan.name,
      planFrequency: subscriptionPlan.frequency,
      basePriceAmt: subscriptionPlan.base_price,
      production_date: fulfillmentCalc.production_date,
      first_delivery_date: fulfillmentCalc.first_delivery_date,
    });

  } catch (error) {
    console.error('[SubPIv2] createSubscriptionPaymentIntentV2 error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
