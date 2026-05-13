import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

// ── Inline zone classifier (mirrors validateDeliveryEligibility, no inter-function call needed) ──
const ORIGIN_ADDRESS = "619 N Main St, O'Fallon, MO 63366";
const ZONE_RULES = [
  { zone_key: 'zone_1_core',      zone_name: 'Core Delivery Zone',          zone_type: 'core',         min: 0,     max: 15,    delivery_fee: 5.99,  minimum_order: null,  checkout_allowed: true,  manual_capture_required: false, allowed_for_subscriptions: true },
  { zone_key: 'zone_2_extended',  zone_name: 'Extended Delivery Zone',       zone_type: 'extended',     min: 15.01, max: 25,    delivery_fee: 9.99,  minimum_order: 49.99, checkout_allowed: true,  manual_capture_required: false, allowed_for_subscriptions: true },
  { zone_key: 'zone_3_route_review', zone_name: 'Route Review Zone',         zone_type: 'route_review', min: 25.01, max: 30,    delivery_fee: 12.99, minimum_order: 59.99, checkout_allowed: true,  manual_capture_required: true,  allowed_for_subscriptions: false },
  { zone_key: 'zone_3_route_review', zone_name: 'Extended Route Review Zone',zone_type: 'route_review', min: 30.01, max: 35,    delivery_fee: 15.99, minimum_order: 72.0,  checkout_allowed: true,  manual_capture_required: true,  allowed_for_subscriptions: false },
  { zone_key: 'waitlist_only',    zone_name: 'Delivery Waitlist Area',       zone_type: 'waitlist_only',min: 35.01, max: 99999, delivery_fee: null,  minimum_order: null,  checkout_allowed: false, manual_capture_required: false, allowed_for_subscriptions: false },
];

async function getDeliveryEligibility(address, cartSubtotal, orderType = 'one_time') {
  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY not configured');

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?` +
    `origins=${encodeURIComponent(ORIGIN_ADDRESS)}` +
    `&destinations=${encodeURIComponent(address)}` +
    `&units=imperial&key=${apiKey}`;

  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK') throw new Error(`Maps API status: ${data.status}`);

  const element = data.rows?.[0]?.elements?.[0];
  if (element?.status !== 'OK') throw new Error(`Maps element status: ${element?.status}`);

  const distanceMiles = Math.round((element.distance.value / 1609.344) * 10) / 10;
  const driveTimeMinutes = Math.round(element.duration.value / 60);

  const zone = ZONE_RULES.find(z => distanceMiles >= z.min && distanceMiles <= z.max) || ZONE_RULES[ZONE_RULES.length - 1];
  const minimumMet = !zone.minimum_order || cartSubtotal >= zone.minimum_order;
  const amountNeeded = minimumMet ? 0 : Math.round((zone.minimum_order - cartSubtotal) * 100) / 100;

  let checkoutAllowed = zone.checkout_allowed;
  let reasonCode = 'ELIGIBLE';
  if (!checkoutAllowed) {
    reasonCode = zone.zone_type === 'waitlist_only' ? 'WAITLIST_ONLY' : 'ZONE_BLOCKED';
  } else if (!minimumMet) {
    checkoutAllowed = false;
    reasonCode = 'MINIMUM_ORDER_NOT_MET';
  } else if (!zone.allowed_for_subscriptions && orderType === 'subscription') {
    checkoutAllowed = false;
    reasonCode = 'SUBSCRIPTION_NOT_AVAILABLE_IN_ZONE';
  } else if (zone.zone_type === 'route_review') {
    reasonCode = 'ROUTE_REVIEW_REQUIRED';
  }

  return {
    eligible: checkoutAllowed,
    checkout_allowed: checkoutAllowed,
    zone_key: zone.zone_key,
    zone_name: zone.zone_name,
    zone_type: zone.zone_type,
    delivery_fee: zone.delivery_fee,
    minimum_order: zone.minimum_order,
    minimum_order_met: minimumMet,
    amount_needed: amountNeeded,
    estimated_distance_miles: distanceMiles,
    estimated_drive_time_minutes: driveTimeMinutes,
    distance_confidence: 'driving',
    manual_capture_required: zone.manual_capture_required,
    reason_code: reasonCode,
    customer_message: buildZoneMessage(zone, cartSubtotal, orderType, amountNeeded),
  };
}

function buildZoneMessage(zone, cartSubtotal, orderType, amountNeeded) {
  if (zone.zone_type === 'core') return 'Great news — your address is in our NuVira delivery zone.';
  if (zone.zone_type === 'extended') {
    if (!zone.minimum_order || cartSubtotal >= zone.minimum_order)
      return `Your address is in our extended delivery zone. Extended delivery includes a $${zone.delivery_fee?.toFixed(2)} delivery fee.`;
    return `Your address is in our extended delivery zone. Extended delivery requires a $${zone.minimum_order?.toFixed(2)} minimum order. Add $${amountNeeded?.toFixed(2)} more to continue.`;
  }
  if (zone.zone_type === 'route_review') {
    if (orderType === 'subscription') return "Your address requires route review before we can activate a subscription.";
    return "Your address is outside our automatic delivery routes. We'll place a temporary authorization hold on your card, but you will not be charged unless your request is approved.";
  }
  return "We're not delivering to this address just yet. Join the delivery waitlist and we'll notify you when your area opens.";
}

/**
 * Creates a Stripe PaymentIntent for embedded in-app checkout.
 * Returns { clientSecret, orderNumber, effectiveTotal, ... } — NO redirect URL.
 *
 * A pending Order record is created immediately so the webhook can finalize it
 * on payment_intent.succeeded without needing a CheckoutSession lookup.
 *
 * Metadata mirrors createCheckoutSession for full backward compatibility.
 */


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const {
      items, subtotal, delivery_fee, total,
      fulfillment_type, delivery_address, contact_phone,
      customer_email, customer_name: checkoutCustomerName,
      address_line1, address_line2, address_city, address_state, address_postal_code,
      points_discount, points_used,
      active_reward, reward_discount, credits_discount,
      referral_discount, referral_code,
      selected_delivery_date, assigned_delivery_date, production_date,
      delivery_window_label, delivery_window_start, delivery_window_end,
      delivery_schedule_source,
      // Zone eligibility (may be pre-validated by frontend; we re-validate server-side)
      zone_key: clientZoneKey,
    } = await req.json();

    // ── SERVER-SIDE ELIGIBILITY GUARD ────────────────────────────────────────
    // Always re-validate delivery eligibility on the backend before creating a PI.
    let validatedEligibility = null;
    if (fulfillment_type === 'delivery') {
      const addrForCheck = delivery_address ||
        [address_line1, address_city, address_state, address_postal_code].filter(Boolean).join(', ');
      try {
        validatedEligibility = await getDeliveryEligibility(addrForCheck, subtotal || 0, 'one_time');
      } catch (eligErr) {
        console.error(`[PI] Eligibility check failed: ${eligErr.message}`);
        return Response.json({ error: 'Could not verify delivery eligibility. Please try again.' }, { status: 400 });
      }

      console.log(`[PI] Eligibility: zone=${validatedEligibility.zone_key}, checkout_allowed=${validatedEligibility.checkout_allowed}, reason=${validatedEligibility.reason_code}`);

      if (!validatedEligibility.checkout_allowed) {
        return Response.json({
          error: validatedEligibility.customer_message || 'Delivery is not available to this address.',
          reason_code: validatedEligibility.reason_code,
          zone_key: validatedEligibility.zone_key,
          zone_type: validatedEligibility.zone_type,
          amount_needed: validatedEligibility.amount_needed || 0,
        }, { status: 400 });
      }

      // Zone 3 must NOT go through normal PI — it requires manual capture / approval flow
      if (validatedEligibility.zone_type === 'route_review') {
        return Response.json({
          error: validatedEligibility.customer_message,
          reason_code: 'ZONE_3_REQUIRES_APPROVAL_FLOW',
          zone_key: validatedEligibility.zone_key,
          zone_type: validatedEligibility.zone_type,
          requires_approval_flow: true,
        }, { status: 400 });
      }
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
        console.warn(`[PI] Failed to fetch UserProfile for ${customer_email}: ${err.message}`);
      }
    }

    if (!customer_name?.trim()) {
      return Response.json({ error: 'Customer name is required. Please complete your profile.' }, { status: 400 });
    }

    // Subscription perks
    let subFreeDelivery = false;
    let subDiscountPct  = 0;
    if (customer_email) {
      const subs = await base44.asServiceRole.entities.Subscription.filter({ customer_email, status: 'active' });
      if (subs.length > 0) {
        const allPlans = await base44.asServiceRole.entities.SubscriptionPlan.list();
        const plan = allPlans.find(p => p.id === subs[0].plan_id);
        if (plan?.discount_percent > 0) {
          subDiscountPct  = plan.discount_percent;
          subFreeDelivery = true;
        }
      }
    }

    const effectiveDeliveryFee = subFreeDelivery ? 0 : (delivery_fee || 0);
    const subDiscountAmt       = subDiscountPct > 0 ? Math.round(subtotal * subDiscountPct) / 100 : 0;
    const effectiveTotal       = Math.max(0, total - (delivery_fee - effectiveDeliveryFee) - subDiscountAmt);

    const orderNumber = `NV-${Date.now().toString(36).toUpperCase()}`;

    // ── CENTRAL SCHEDULE ENGINE ──────────────────────────────────────────
    // Call calculateNuViraFulfillmentSchedule as single source of truth for dates
    let scheduleResult;
    try {
      const scheduleResp = await base44.asServiceRole.functions.invoke('calculateNuViraFulfillmentSchedule', {
        created_at: new Date().toISOString(),
      });
      scheduleResult = scheduleResp.data || scheduleResp;
    } catch (schedErr) {
      console.error(`[PI] Schedule calculation failed: ${schedErr.message} — using fallback defaults`);
      scheduleResult = {
        production_date: '',
        delivery_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        delivery_window_label: '5 PM – 8 PM',
        delivery_window_start: '17:00',
        delivery_window_end: '20:00',
        schedule_reason: 'fallback_defaults',
        cutoff_window_label: 'unknown',
        timezone: 'America/Chicago',
      };
    }

    const deliveryDate         = scheduleResult.delivery_date;
    const resolvedProdDate     = scheduleResult.production_date;
    const resolvedWindowLabel  = scheduleResult.delivery_window_label;
    const resolvedWindowStart  = scheduleResult.delivery_window_start;
    const resolvedWindowEnd    = scheduleResult.delivery_window_end;
    const resolvedScheduleSrc  = scheduleResult.schedule_reason || 'system_default';

    const eligibility = validatedEligibility;

    // Metadata — centralized schedule fields from calculateNuViraFulfillmentSchedule
    const intentMetadata = {
      base44_app_id:            Deno.env.get('BASE44_APP_ID'),
      source_app:               'customer_app',
      checkout_version:         '3.0_embedded',
      order_number:             orderNumber,
      order_type:               'one_time',
      fulfillment_mode:         'single_delivery',
      is_preorder:              'false',
      customer_email:           customer_email || '',
      customer_name:            customer_name  || '',
      customer_phone:           contact_phone  || '',
      delivery_method:          fulfillment_type || 'delivery',
      delivery_address_line1:   address_line1  || '',
      delivery_address_line2:   address_line2  || '',
      delivery_city:            address_city   || '',
      delivery_state:           address_state  || '',
      delivery_postal_code:     address_postal_code || '',
      requested_delivery_date:  deliveryDate,
      selected_delivery_date:   deliveryDate,
      production_date:          resolvedProdDate,
      delivery_window_label:    resolvedWindowLabel,
      delivery_window_start:    resolvedWindowStart,
      delivery_window_end:      resolvedWindowEnd,
      schedule_reason:          resolvedScheduleSrc,
      cutoff_window_label:      scheduleResult.cutoff_window_label || '',
      schedule_timezone:        'America/Chicago',
      // Zone eligibility fields
      delivery_zone_key:        eligibility?.zone_key        || '',
      delivery_zone_name:       eligibility?.zone_name       || '',
      delivery_zone_type:       eligibility?.zone_type       || '',
      delivery_zone_fee:        eligibility ? String(eligibility.delivery_fee ?? '') : '',
      delivery_zone_minimum:    eligibility ? String(eligibility.minimum_order  ?? '') : '',
      estimated_distance_miles: eligibility ? String(eligibility.estimated_distance_miles ?? '') : '',
      distance_confidence:      eligibility?.distance_confidence || '',
      zone_origin_address:      "619 N Main St, O'Fallon, MO 63366",
      eligibility_reason_code:  eligibility?.reason_code     || '',
    };

    // effectiveTotal already includes all discounts from the frontend (points, credits, referral, reward, sub discount).
    // Do NOT subtract again here — that would double-count.
    const amountCents = Math.max(50, Math.round(effectiveTotal * 100));

    // Create PaymentIntent with card only.
    // payment_method_types:['card'] enables Apple Pay and Google Pay via ExpressCheckoutElement
    // without opening the door to Bank, Klarna, ACH, or any redirect-based method.
    // automatic_payment_methods is intentionally omitted to prevent Bank from appearing.
    const paymentIntent = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: 'usd',
      payment_method_types: ['card'],
      metadata: intentMetadata,
      receipt_email: customer_email || undefined,
      description: `NuVira Order ${orderNumber}`,
    });

    console.log(`[PI] Created PI ${paymentIntent.id} for ${orderNumber}: automatic_payment_methods=enabled, allow_redirects=never. amount=${amountCents}¢, customer=${customer_email}`);

    // Pre-create a pending Order so webhook finalize is simple and idempotent
    const resolvedDeliveryAddress = delivery_address || [address_line1, address_city, address_state, address_postal_code].filter(Boolean).join(', ');

    try {
      await base44.asServiceRole.entities.Order.create({
        order_number:             orderNumber,
        customer_email:           customer_email || '',
        customer_name,
        items: items.map(i => ({
          product_id: i.product_id,
          title:      i.title,
          price:      i.price,
          quantity:   i.quantity,
          image_url:  i.image_url || null,
        })),
        subtotal,
        delivery_fee:             effectiveDeliveryFee,
        total:                    effectiveTotal,
        fulfillment_type:         fulfillment_type || 'delivery',
        delivery_address:         resolvedDeliveryAddress,
        address_line1:            address_line1  || '',
        address_line2:            address_line2  || '',
        address_city:             address_city   || '',
        address_state:            address_state  || '',
        address_postal_code:      address_postal_code || '',
        address_country:          'US',
        contact_phone:            contact_phone  || '',
        estimated_delivery_date:  deliveryDate,
        assigned_delivery_date:   deliveryDate,
        delivery_window_label:    resolvedWindowLabel,
        assigned_delivery_window_start: resolvedWindowStart,
        assigned_delivery_window_end:   resolvedWindowEnd,
        // CRITICAL: pending_payment is NOT an operational status.
        // This order must NOT sync to Hub, appear in Driver Portal, route optimization,
        // production, or Order Management active views until payment_intent.succeeded fires.
        status:                   'pending_payment',
        payment_status:           'pending',
        financial_status:         'pending',
        payment_captured:         false,
        stripe_payment_intent_id: paymentIntent.id,
        referral_code:            (referral_discount > 0 && referral_code) ? referral_code.toUpperCase() : null,
        is_preorder:              false,
        // Zone eligibility fields
        ...(eligibility ? {
          delivery_zone_id:         eligibility.zone_key || '',
        } : {}),
        status_history: [{
          status:    'pending_payment',
          timestamp: new Date().toISOString(),
          message:   'Order created — awaiting payment confirmation.',
        }],
      });
      console.log(`[PI] Pending Order ${orderNumber} pre-created`);
    } catch (orderErr) {
      // Non-fatal — webhook will create order if this fails
      console.error(`[PI] Failed to pre-create Order ${orderNumber}: ${orderErr.message}`);
    }

    // Also store CheckoutSession for legacy compatibility / admin tools
    try {
      await base44.asServiceRole.entities.CheckoutSession.create({
        stripe_session_id: paymentIntent.id, // re-use field for PI ID
        order_number:      orderNumber,
        customer_email:    customer_email || '',
        checkout_data: {
          order_number, customer_email, customer_name,
          address_line1, address_line2, address_city, address_state, address_postal_code,
          address_country: 'US',
          items, subtotal,
          delivery_fee:              effectiveDeliveryFee,
          total:                     effectiveTotal,
          fulfillment_type:          fulfillment_type || 'delivery',
          delivery_address:          resolvedDeliveryAddress,
          contact_phone:             contact_phone    || '',
          estimated_delivery_date:   deliveryDate,
          assigned_delivery_date:    deliveryDate,
          production_date:           resolvedProdDate || null,
          delivery_window_label:     resolvedWindowLabel,
          delivery_window_start:     resolvedWindowStart,
          delivery_window_end:       resolvedWindowEnd,
          delivery_schedule_source:  resolvedScheduleSrc,
          is_preorder:               false,
          referral_code:             (referral_discount > 0 && referral_code) ? referral_code.toUpperCase() : null,
          points_used:               points_used    || 0,
          points_discount:           points_discount|| 0,
          active_reward:             active_reward  || null,
          reward_discount:           reward_discount|| 0,
          credits_discount:          credits_discount || 0,
        },
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    } catch (csErr) {
      console.warn(`[PI] Failed to store CheckoutSession for ${orderNumber}: ${csErr.message}`);
    }

    return Response.json({
      clientSecret:         paymentIntent.client_secret,
      paymentIntentId:      paymentIntent.id,
      publishableKey:       Deno.env.get('STRIPE_PUBLISHABLE_KEY'),
      orderNumber,
      effectiveTotal,
      effectiveDeliveryFee,
      subFreeDelivery,
      subDiscountPct,
      subDiscountAmt,
    });

  } catch (error) {
    console.error('[PI] createPaymentIntent error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});