import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

const ORIGIN_ADDRESS = "619 N Main St, O'Fallon, MO 63366";
const ZONE_RULES = [
  { zone_key: 'zone_3_route_review', zone_name: 'Route Review Zone',          zone_type: 'route_review', min: 25.01, max: 30,    delivery_fee: 12.99, minimum_order: 59.99 },
  { zone_key: 'zone_3_route_review', zone_name: 'Extended Route Review Zone', zone_type: 'route_review', min: 30.01, max: 35,    delivery_fee: 15.99, minimum_order: 72.0 },
  { zone_key: 'waitlist_only',       zone_name: 'Delivery Waitlist Area',      zone_type: 'waitlist_only',min: 35.01, max: 99999, delivery_fee: null,  minimum_order: null },
];
const ALL_ZONE_RULES = [
  { zone_key: 'zone_1_core',         zone_type: 'core',         min: 0,     max: 15 },
  { zone_key: 'zone_2_extended',     zone_type: 'extended',     min: 15.01, max: 25 },
  ...ZONE_RULES,
];

async function getEligibility(address, subtotal) {
  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY not configured');
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(ORIGIN_ADDRESS)}&destinations=${encodeURIComponent(address)}&units=imperial&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK') throw new Error(`Maps API: ${data.status}`);
  const element = data.rows?.[0]?.elements?.[0];
  if (element?.status !== 'OK') throw new Error(`Maps element: ${element?.status}`);
  const distanceMiles = Math.round((element.distance.value / 1609.344) * 10) / 10;
  const driveTimeMinutes = Math.round(element.duration.value / 60);
  const zone = ALL_ZONE_RULES.find(z => distanceMiles >= z.min && distanceMiles <= z.max) || ALL_ZONE_RULES[ALL_ZONE_RULES.length - 1];
  const z3 = ZONE_RULES.find(z => distanceMiles >= z.min && distanceMiles <= z.max) || null;
  const minimumMet = !z3?.minimum_order || subtotal >= z3.minimum_order;
  return { zone_key: zone.zone_key, zone_type: zone.zone_type, zone_name: z3?.zone_name || zone.zone_key, delivery_fee: z3?.delivery_fee || null, minimum_order: z3?.minimum_order || null, minimum_order_met: minimumMet, amount_needed: minimumMet ? 0 : Math.round((z3.minimum_order - subtotal) * 100) / 100, estimated_distance_miles: distanceMiles, estimated_drive_time_minutes: driveTimeMinutes };
}

/**
 * createZone3AuthorizationIntent
 * Creates a Stripe PaymentIntent with capture_method=manual for Zone 3 route review.
 * Does NOT create an Order, sync Hub, or seed production.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const {
      items, subtotal, delivery_fee, total,
      delivery_address, address_line1, address_line2, address_city, address_state, address_postal_code,
      contact_phone, customer_email, customer_name: inputCustomerName,
      customer_acknowledged_hold,
    } = await req.json();

    // Require customer acknowledgment
    if (!customer_acknowledged_hold) {
      return Response.json({ error: 'Customer must acknowledge the authorization hold before proceeding.' }, { status: 400 });
    }

    // Resolve customer name
    let customer_name = (inputCustomerName || '').trim();
    if (!customer_name && customer_email) {
      const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email });
      if (profiles[0]) customer_name = [profiles[0].first_name, profiles[0].last_name].filter(Boolean).join(' ');
    }
    if (!customer_name) return Response.json({ error: 'Customer name is required.' }, { status: 400 });

    const addrString = delivery_address || [address_line1, address_city, address_state, address_postal_code].filter(Boolean).join(', ');
    if (!addrString || addrString.trim().length < 5) return Response.json({ error: 'Valid delivery address is required.' }, { status: 400 });

    // Validate Zone 3
    let eligibility;
    try {
      eligibility = await getEligibility(addrString, subtotal || 0);
    } catch (err) {
      console.error(`[Zone3] Eligibility check failed: ${err.message}`);
      return Response.json({ error: 'Could not verify delivery eligibility. Please try again.' }, { status: 400 });
    }

    if (eligibility.zone_type !== 'route_review') {
      return Response.json({
        error: eligibility.zone_type === 'waitlist_only'
          ? 'Your address is outside our delivery area. You can join the waitlist.'
          : 'This address does not require route review. Please use the standard checkout.',
        zone_type: eligibility.zone_type,
        zone_key: eligibility.zone_key,
      }, { status: 400 });
    }

    if (!eligibility.minimum_order_met) {
      return Response.json({
        error: `A minimum order of $${eligibility.minimum_order?.toFixed(2)} is required for your delivery area. Add $${eligibility.amount_needed?.toFixed(2)} more to continue.`,
        reason_code: 'MINIMUM_ORDER_NOT_MET',
        amount_needed: eligibility.amount_needed,
      }, { status: 400 });
    }

    const estimatedDeliveryFee = eligibility.delivery_fee || (delivery_fee || 0);
    const effectiveTotal = Math.max(0, Math.round(((subtotal || 0) + estimatedDeliveryFee) * 100) / 100);
    const amountCents = Math.max(50, Math.round(effectiveTotal * 100));

    // Generate request number
    const requestNumber = `DAR-${Date.now().toString(36).toUpperCase()}`;

    // Store pre-authorization DeliveryApprovalRequest (draft)
    const darRecord = await base44.asServiceRole.entities.DeliveryApprovalRequest.create({
      request_number: requestNumber,
      customer_name,
      customer_email: customer_email || '',
      customer_phone: contact_phone || '',
      delivery_address: addrString,
      address_line1: address_line1 || '',
      address_line2: address_line2 || '',
      address_city: address_city || '',
      address_state: address_state || '',
      address_postal_code: address_postal_code || '',
      address_country: 'US',
      cart_items: (items || []).map(i => ({ product_id: i.product_id, title: i.title, price: i.price, quantity: i.quantity })),
      cart_subtotal: subtotal || 0,
      estimated_delivery_fee: estimatedDeliveryFee,
      estimated_total: effectiveTotal,
      estimated_distance_miles: eligibility.estimated_distance_miles,
      estimated_drive_time_minutes: eligibility.estimated_drive_time_minutes,
      zone_key: eligibility.zone_key,
      zone_name: eligibility.zone_name,
      zone_type: eligibility.zone_type,
      customer_acknowledged_hold: true,
      status: 'pending_authorization',
      audit_trail: [{
        action: 'authorization_initiated',
        performed_by: customer_email || 'customer',
        timestamp: new Date().toISOString(),
        note: `Zone 3 route review initiated. Distance: ${eligibility.estimated_distance_miles} miles. Zone: ${eligibility.zone_key}.`,
      }],
    });

    console.log(`[Zone3] DeliveryApprovalRequest created: ${darRecord.id} (${requestNumber})`);

    // Create Stripe PaymentIntent with manual capture
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      capture_method: 'manual',
      payment_method_types: ['card'],
      receipt_email: customer_email || undefined,
      description: `NuVira Zone 3 Route Review ${requestNumber}`,
      metadata: {
        base44_app_id: Deno.env.get('BASE44_APP_ID'),
        source_app: 'customer_app',
        checkout_version: 'zone3_manual_capture_v1',
        flow_type: 'zone3_route_review',
        request_number: requestNumber,
        dar_id: darRecord.id,
        order_type: 'one_time',
        customer_email: customer_email || '',
        customer_name,
        customer_phone: contact_phone || '',
        delivery_address_line1: address_line1 || '',
        delivery_address_line2: address_line2 || '',
        delivery_city: address_city || '',
        delivery_state: address_state || '',
        delivery_postal_code: address_postal_code || '',
        delivery_zone_key: eligibility.zone_key,
        delivery_zone_type: eligibility.zone_type,
        estimated_distance_miles: String(eligibility.estimated_distance_miles || ''),
        estimated_delivery_fee: String(estimatedDeliveryFee),
        cart_subtotal: String(subtotal || 0),
        effective_total: String(effectiveTotal),
        customer_acknowledged_hold: 'true',
      },
    });

    // Update DAR with Stripe PI ID
    await base44.asServiceRole.entities.DeliveryApprovalRequest.update(darRecord.id, {
      stripe_payment_intent_id: paymentIntent.id,
      amount_authorized: effectiveTotal,
      authorization_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // Stripe holds up to 7 days
    });

    console.log(`[Zone3] PI ${paymentIntent.id} created for DAR ${requestNumber}, amount=${amountCents}¢, capture_method=manual`);

    return Response.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      publishableKey: Deno.env.get('STRIPE_PUBLISHABLE_KEY'),
      requestNumber,
      darId: darRecord.id,
      effectiveTotal,
      estimatedDeliveryFee,
      zoneKey: eligibility.zone_key,
      zoneName: eligibility.zone_name,
      distanceMiles: eligibility.estimated_distance_miles,
    });

  } catch (error) {
    console.error('[Zone3] createZone3AuthorizationIntent error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});