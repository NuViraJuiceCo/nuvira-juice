import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

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

const ORIGIN_ADDRESS = "619 N Main St, O'Fallon, MO 63366";
const ZONE_RULES = [
  { zone_key: 'zone_1_core',         zone_type: 'core',         min: 0,     max: 15,    delivery_fee: 5.99  },
  { zone_key: 'zone_2_extended',     zone_type: 'extended',     min: 15.01, max: 25,    delivery_fee: 9.99  },
  { zone_key: 'zone_3_route_review', zone_type: 'route_review', min: 25.01, max: 30,    delivery_fee: 12.99 },
  { zone_key: 'zone_3_route_review', zone_type: 'route_review', min: 30.01, max: 35,    delivery_fee: 15.99 },
  { zone_key: 'waitlist_only',       zone_type: 'waitlist_only',min: 35.01, max: 99999, delivery_fee: null  },
];

async function getDistanceAndZone(address) {
  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY not configured');
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(ORIGIN_ADDRESS)}&destinations=${encodeURIComponent(address)}&units=imperial&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK') throw new Error(`Maps API status: ${data.status}`);
  const element = data.rows?.[0]?.elements?.[0];
  if (element?.status !== 'OK') throw new Error(`Maps element: ${element?.status}`);
  const distanceMiles = Math.round((element.distance.value / 1609.344) * 10) / 10;
  const driveTimeMinutes = Math.round(element.duration.value / 60);
  const zone = ZONE_RULES.find(z => distanceMiles >= z.min && distanceMiles <= z.max) || ZONE_RULES[ZONE_RULES.length - 1];
  return { distanceMiles, driveTimeMinutes, zone };
}

function generateRequestNumber() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = 'SUBR-';
  for (let i = 0; i < 8; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
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
      customer_email,
      customer_name,
      customer_phone,
      address_line1,
      address_line2,
      address_city,
      address_state,
      address_postal_code,
      delivery_address,
      save_payment_method,  // optional: true = create SetupIntent
    } = await req.json();
    const unauthorized = await authorizeCheckoutCustomer(base44, customer_email);
    if (unauthorized) return unauthorized;

    if (!plan_id || !customer_email || !delivery_address) {
      return Response.json({ error: 'Missing required fields: plan_id, customer_email, delivery_address' }, { status: 400 });
    }

    // Load plan
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({ id: plan_id });
    if (!plans[0]) return Response.json({ error: 'Plan not found' }, { status: 404 });
    const plan = plans[0];

    // Resolve customer name from profile if not provided
    let resolvedName = customer_name || '';
    let resolvedPhone = customer_phone || '';
    try {
      const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email });
      if (profiles[0]) {
        const p = profiles[0];
        resolvedName = resolvedName || [p.first_name, p.last_name].filter(Boolean).join(' ');
        resolvedPhone = resolvedPhone || p.phone || '';
      }
    } catch (err) {
      console.warn(`[Zone3SubReview] Profile fetch failed: ${err.message}`);
    }

    // Get delivery zone via Google Maps
    let distanceMiles, driveTimeMinutes, zone;
    try {
      ({ distanceMiles, driveTimeMinutes, zone } = await getDistanceAndZone(delivery_address));
    } catch (err) {
      return Response.json({ error: `Could not verify delivery address: ${err.message}` }, { status: 400 });
    }

    // Must be route_review zone
    if (zone.zone_type !== 'route_review') {
      return Response.json({
        error: 'Address is not in a Zone 3 route review area.',
        zone_type: zone.zone_type,
        zone_key: zone.zone_key,
      }, { status: 400 });
    }

    // Idempotency: check for existing pending DAR for this customer+plan
    const existingDARs = await base44.asServiceRole.entities.DeliveryApprovalRequest.filter({
      customer_email,
    });
    const activeDARForPlan = existingDARs.find(d =>
      d.request_type === 'subscription_route_review' &&
      d.selected_plan_id === plan_id &&
      ['draft', 'pending_authorization', 'pending_review'].includes(d.status)
    );
    if (activeDARForPlan) {
      console.log(`[Zone3SubReview] Existing active DAR ${activeDARForPlan.id} found for ${customer_email}, returning it`);
      return Response.json({
        success: true,
        dar_id: activeDARForPlan.id,
        request_number: activeDARForPlan.request_number,
        status: activeDARForPlan.status,
        setup_intent_client_secret: activeDARForPlan.stripe_setup_intent_client_secret || null,
        already_exists: true,
      });
    }

    // Create DeliveryApprovalRequest
    const requestNumber = generateRequestNumber();
    const dar = await base44.asServiceRole.entities.DeliveryApprovalRequest.create({
      request_number: requestNumber,
      request_type: 'subscription_route_review',
      customer_name: resolvedName,
      customer_email,
      customer_phone: resolvedPhone,
      delivery_address,
      address_line1: address_line1 || '',
      address_line2: address_line2 || '',
      address_city: address_city || '',
      address_state: address_state || '',
      address_postal_code: address_postal_code || '',
      address_country: 'US',
      selected_plan_id: plan_id,
      selected_plan_name: plan.name,
      selected_plan_price: plan.base_price,
      selected_plan_frequency: plan.frequency,
      cart_subtotal: plan.base_price,
      estimated_delivery_fee: zone.delivery_fee,
      estimated_total: plan.base_price + (zone.delivery_fee || 0),
      estimated_distance_miles: distanceMiles,
      estimated_drive_time_minutes: driveTimeMinutes,
      zone_key: zone.zone_key,
      zone_name: zone.zone_key,
      zone_type: zone.zone_type,
      status: 'pending_review',
      customer_acknowledged_hold: false,
      audit_trail: [{
        action: 'subscription_route_review_requested',
        performed_by: customer_email,
        timestamp: new Date().toISOString(),
        note: `Zone 3 subscription route review submitted for plan "${plan.name}" ($${plan.base_price}/${plan.frequency}). Distance: ${distanceMiles} mi.`,
      }],
    });

    console.log(`[Zone3SubReview] Created DAR ${dar.id} (${requestNumber}) for ${customer_email}, plan ${plan.name}`);

    // Optionally create SetupIntent to save payment method
    let setupIntentClientSecret = null;
    if (save_payment_method) {
      try {
        // Get or create Stripe Customer
        const customers = await stripe.customers.list({ email: customer_email, limit: 1 });
        const stripeCustomer = customers.data[0] || await stripe.customers.create({
          email: customer_email,
          name: resolvedName,
          phone: resolvedPhone || undefined,
          metadata: { source_app: 'customer_app' },
        });

        const setupIntent = await stripe.setupIntents.create({
          customer: stripeCustomer.id,
          payment_method_types: ['card'],
          usage: 'off_session',
          metadata: {
            base44_app_id: Deno.env.get('BASE44_APP_ID'),
            flow_type: 'zone3_subscription_route_review',
            dar_id: dar.id,
            customer_email,
            plan_id,
            plan_name: plan.name,
          },
        });

        setupIntentClientSecret = setupIntent.client_secret;

        // Save setup intent info back to DAR
        await base44.asServiceRole.entities.DeliveryApprovalRequest.update(dar.id, {
          stripe_setup_intent_id: setupIntent.id,
          stripe_setup_intent_client_secret: setupIntentClientSecret,
          stripe_customer_id: stripeCustomer.id,
          audit_trail: [...(dar.audit_trail || []), {
            action: 'setup_intent_created',
            performed_by: 'system',
            timestamp: new Date().toISOString(),
            note: `SetupIntent ${setupIntent.id} created for card save.`,
          }],
        });

        console.log(`[Zone3SubReview] SetupIntent ${setupIntent.id} created for ${customer_email}`);
      } catch (siErr) {
        console.warn(`[Zone3SubReview] SetupIntent creation failed (non-blocking): ${siErr.message}`);
      }
    }

    // Notify customer
    base44.asServiceRole.functions.invoke('sendCustomerNotification', {
      customer_email,
      type: 'general',
      title: 'Subscription Route Review Submitted ✅',
      message: `Your request to subscribe with delivery to ${delivery_address} has been submitted. We'll review your route and notify you within 24–48 hours. Request #${requestNumber}.`,
      deep_link: '/account/subscriptions',
      idempotency_key: `zone3_sub_review_submitted_${dar.id}`,
    }).catch(() => {});

    // Notify admin
    base44.asServiceRole.functions.invoke('sendCustomerNotification', {
      customer_email: 'info@nuvirajuice.com',
      type: 'general',
      title: '🗺️ Zone 3 Subscription Route Review',
      message: `New subscription route review from ${resolvedName || customer_email} for plan "${plan.name}" ($${plan.base_price}/${plan.frequency}). Address: ${delivery_address}. Distance: ${distanceMiles} mi. Request: ${requestNumber}.`,
      deep_link: '/admin/orders',
      idempotency_key: `zone3_sub_admin_notify_${dar.id}`,
    }).catch(() => {});

    return Response.json({
      success: true,
      dar_id: dar.id,
      request_number: requestNumber,
      status: dar.status,
      setup_intent_client_secret: setupIntentClientSecret,
    });

  } catch (error) {
    console.error('[Zone3SubReview] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
