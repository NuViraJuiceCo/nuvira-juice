import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * validateDeliveryEligibility
 *
 * Single source of truth for NuVira delivery zone classification.
 * Classifies a customer address into Zone 1, Zone 2, Zone 3 route review, or waitlist.
 * Does NOT create any records or payment intents — read-only eligibility check only.
 *
 * Origin: 619 N Main St, O'Fallon, MO 63366
 */

const ORIGIN_ADDRESS = "619 N Main St, O'Fallon, MO 63366";

// Zone thresholds (driving miles)
const ZONES = [
  {
    zone_key: 'zone_1_core',
    zone_name: 'Core Delivery Zone',
    zone_type: 'core',
    min: 0,
    max: 15,
    delivery_fee: 5.99,
    minimum_order: null,
    approval_required: false,
    manual_capture_required: false,
    checkout_allowed: true,
    payment_capture_method: 'automatic',
    allowed_for_subscriptions: true,
  },
  {
    zone_key: 'zone_2_extended',
    zone_name: 'Extended Delivery Zone',
    zone_type: 'extended',
    min: 15.01,
    max: 25,
    delivery_fee: 9.99,
    minimum_order: 49.99,
    approval_required: false,
    manual_capture_required: false,
    checkout_allowed: true,
    payment_capture_method: 'automatic',
    allowed_for_subscriptions: true,
  },
  {
    zone_key: 'zone_3_route_review',
    zone_name: 'Route Review Zone',
    zone_type: 'route_review',
    min: 25.01,
    max: 30,
    delivery_fee: 12.99,
    minimum_order: 59.99,
    approval_required: true,
    manual_capture_required: true,
    checkout_allowed: true,
    payment_capture_method: 'manual',
    allowed_for_subscriptions: false,
  },
  {
    zone_key: 'zone_3_route_review',
    zone_name: 'Extended Route Review Zone',
    zone_type: 'route_review',
    min: 30.01,
    max: 35,
    delivery_fee: 15.99,
    minimum_order: 72.0,
    approval_required: true,
    manual_capture_required: true,
    checkout_allowed: true,
    payment_capture_method: 'manual',
    allowed_for_subscriptions: false,
  },
  {
    zone_key: 'waitlist_only',
    zone_name: 'Delivery Waitlist Area',
    zone_type: 'waitlist_only',
    min: 35.01,
    max: 99999,
    delivery_fee: null,
    minimum_order: null,
    approval_required: true,
    manual_capture_required: false,
    checkout_allowed: false,
    payment_capture_method: null,
    allowed_for_subscriptions: false,
  },
];

function classifyByMiles(miles) {
  for (const zone of ZONES) {
    if (miles >= zone.min && miles <= zone.max) return zone;
  }
  return ZONES[ZONES.length - 1]; // fallback to waitlist
}

function buildCustomerMessage(zone, cartSubtotal, orderType) {
  if (zone.zone_type === 'core') {
    return 'Great news — your address is in our NuVira delivery zone.';
  }
  if (zone.zone_type === 'extended') {
    const minMet = !zone.minimum_order || cartSubtotal >= zone.minimum_order;
    if (minMet) {
      return `Your address is in our extended delivery zone. Extended delivery includes a $${zone.delivery_fee.toFixed(2)} delivery fee.`;
    }
    const needed = (zone.minimum_order - cartSubtotal).toFixed(2);
    return `Your address is in our extended delivery zone. Extended delivery requires a $${zone.minimum_order.toFixed(2)} minimum order. Add $${needed} more to continue.`;
  }
  if (zone.zone_type === 'route_review') {
    if (orderType === 'subscription') {
      return "Your address requires route review before we can activate a subscription. Submit your request and our team will review delivery availability.";
    }
    return "Your address is outside our automatic delivery routes, but we may still be able to deliver depending on route availability. We'll place a temporary authorization hold on your card, but you will not be charged unless your request is approved.";
  }
  if (zone.zone_type === 'waitlist_only') {
    return "We're not delivering to this address just yet. Join the delivery waitlist and we'll notify you when your area opens.";
  }
  return "We're unable to deliver to this address at this time.";
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const {
      delivery_address,
      address_line1,
      address_city,
      address_state,
      address_postal_code,
      cart_subtotal = 0,
      cart_items = [],
      customer_email,
      customer_phone,
      order_type = 'one_time',
    } = body;

    // Build normalized address string
    const normalizedAddress = delivery_address ||
      [address_line1, address_city, address_state, address_postal_code]
        .filter(Boolean).join(', ');

    if (!normalizedAddress || normalizedAddress.trim().length < 5) {
      return Response.json({
        eligible: false,
        checkout_allowed: false,
        automatic_checkout_allowed: false,
        approval_required: false,
        manual_capture_required: false,
        zone_key: null,
        zone_name: null,
        zone_type: null,
        delivery_fee: null,
        minimum_order: null,
        minimum_order_met: false,
        amount_needed: 0,
        estimated_distance_miles: null,
        estimated_drive_time_minutes: null,
        distance_confidence: null,
        suggested_delivery_fee: null,
        payment_capture_method: null,
        customer_message: 'Please enter a valid delivery address.',
        admin_message: 'Address string too short or missing.',
        reason_code: 'INVALID_ADDRESS',
      }, { status: 200 });
    }

    // ── DRIVING DISTANCE: Google Maps Distance Matrix ─────────────────────────
    let distanceMiles = null;
    let driveTimeMinutes = null;
    let distanceConfidence = 'estimated';
    let resolvedAddress = normalizedAddress;

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (apiKey) {
      try {
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?` +
          `origins=${encodeURIComponent(ORIGIN_ADDRESS)}` +
          `&destinations=${encodeURIComponent(normalizedAddress)}` +
          `&units=imperial` +
          `&key=${apiKey}`;

        const res = await fetch(url);
        const data = await res.json();

        console.log(`[validateDeliveryEligibility] Maps API status: ${data.status}`);

        if (data.status === 'OK') {
          const element = data.rows?.[0]?.elements?.[0];
          if (element?.status === 'OK') {
            distanceMiles = Math.round((element.distance.value / 1609.344) * 10) / 10;
            driveTimeMinutes = Math.round(element.duration.value / 60);
            distanceConfidence = 'driving';
            resolvedAddress = data.destination_addresses?.[0] || normalizedAddress;
            console.log(`[validateDeliveryEligibility] Distance: ${distanceMiles} miles, ${driveTimeMinutes} min drive`);
          } else {
            console.warn(`[validateDeliveryEligibility] Element status: ${element?.status}`);
          }
        } else {
          console.warn(`[validateDeliveryEligibility] Maps API returned status: ${data.status}`);
        }
      } catch (mapsErr) {
        console.error(`[validateDeliveryEligibility] Maps API error: ${mapsErr.message}`);
      }
    }

    // Fallback: if Maps API unavailable or failed, we cannot classify safely
    if (distanceMiles === null) {
      console.warn('[validateDeliveryEligibility] Could not determine driving distance — returning address_lookup_failed');
      return Response.json({
        eligible: false,
        checkout_allowed: false,
        automatic_checkout_allowed: false,
        approval_required: false,
        manual_capture_required: false,
        zone_key: null,
        zone_name: null,
        zone_type: null,
        delivery_fee: null,
        minimum_order: null,
        minimum_order_met: false,
        amount_needed: 0,
        estimated_distance_miles: null,
        estimated_drive_time_minutes: null,
        distance_confidence: 'unknown',
        suggested_delivery_fee: null,
        payment_capture_method: null,
        customer_message: 'Could not look up this address. Please check and try again.',
        admin_message: 'Google Maps Distance Matrix API returned no result.',
        reason_code: 'ADDRESS_LOOKUP_FAILED',
      }, { status: 200 });
    }

    // ── ZONE CLASSIFICATION ───────────────────────────────────────────────────
    const zone = classifyByMiles(distanceMiles);
    const minimumOrder = zone.minimum_order;
    const minimumOrderMet = minimumOrder === null || cart_subtotal >= minimumOrder;
    const amountNeeded = minimumOrderMet ? 0 : Math.round((minimumOrder - cart_subtotal) * 100) / 100;

    // Zone 3 subscriptions: flag but don't block outright — caller decides UI
    const subscriptionRouteReviewRequired = zone.zone_type === 'route_review' && order_type === 'subscription';
    const subscriptionBlocked = !zone.allowed_for_subscriptions && order_type === 'subscription';

    // checkout_allowed logic
    let checkoutAllowed = zone.checkout_allowed;
    let reasonCode = 'ELIGIBLE';

    if (!checkoutAllowed) {
      reasonCode = zone.zone_type === 'waitlist_only' ? 'WAITLIST_ONLY' : 'ZONE_BLOCKED';
    } else if (!minimumOrderMet) {
      checkoutAllowed = false;
      reasonCode = 'MINIMUM_ORDER_NOT_MET';
    } else if (subscriptionBlocked) {
      checkoutAllowed = false;
      reasonCode = 'SUBSCRIPTION_NOT_AVAILABLE_IN_ZONE';
    } else if (zone.zone_type === 'route_review') {
      reasonCode = 'ROUTE_REVIEW_REQUIRED';
    } else {
      reasonCode = 'ELIGIBLE';
    }

    const automaticCheckoutAllowed = checkoutAllowed && !zone.approval_required;
    const customerMessage = buildCustomerMessage(zone, cart_subtotal, order_type);

    const adminMessage = [
      `Zone: ${zone.zone_key} (${zone.zone_name})`,
      `Distance: ${distanceMiles} miles driving (${distanceConfidence})`,
      `Drive time: ${driveTimeMinutes ?? 'N/A'} min`,
      `Cart: $${cart_subtotal.toFixed(2)}`,
      `Minimum: ${minimumOrder ? '$' + minimumOrder.toFixed(2) : 'none'}`,
      `Minimum met: ${minimumOrderMet}`,
      `Order type: ${order_type}`,
      `Reason: ${reasonCode}`,
    ].join(' | ');

    console.log(`[validateDeliveryEligibility] ${adminMessage}`);

    return Response.json({
      eligible: checkoutAllowed,
      checkout_allowed: checkoutAllowed,
      automatic_checkout_allowed: automaticCheckoutAllowed,
      approval_required: zone.approval_required,
      manual_capture_required: zone.manual_capture_required,
      zone_key: zone.zone_key,
      zone_name: zone.zone_name,
      zone_type: zone.zone_type,
      delivery_fee: zone.delivery_fee,
      minimum_order: minimumOrder,
      minimum_order_met: minimumOrderMet,
      amount_needed: amountNeeded,
      estimated_distance_miles: distanceMiles,
      estimated_drive_time_minutes: driveTimeMinutes,
      distance_confidence: distanceConfidence,
      suggested_delivery_fee: zone.delivery_fee,
      payment_capture_method: zone.payment_capture_method,
      subscription_route_review_required: subscriptionRouteReviewRequired,
      allowed_for_subscriptions: zone.allowed_for_subscriptions,
      customer_message: customerMessage,
      admin_message: adminMessage,
      reason_code: reasonCode,
      resolved_address: resolvedAddress,
    }, { status: 200 });

  } catch (error) {
    console.error('[validateDeliveryEligibility] Error:', error.message);
    return Response.json({
      eligible: false,
      checkout_allowed: false,
      automatic_checkout_allowed: false,
      approval_required: false,
      manual_capture_required: false,
      zone_key: null,
      zone_name: null,
      zone_type: null,
      delivery_fee: null,
      minimum_order: null,
      minimum_order_met: false,
      amount_needed: 0,
      estimated_distance_miles: null,
      estimated_drive_time_minutes: null,
      distance_confidence: 'unknown',
      suggested_delivery_fee: null,
      payment_capture_method: null,
      customer_message: 'An error occurred checking your delivery address. Please try again.',
      admin_message: error.message,
      reason_code: 'INTERNAL_ERROR',
    }, { status: 200 }); // Always 200 so frontend can read the payload
  }
});