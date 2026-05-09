import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Sync subscription to Hub with all 4 pre-calculated fulfillments.
 * Replaces individual fulfillment sends with a complete cycle payload.
 * Includes structured address field parsing.
 * 
 * Payload: { subscription_id, customer_email }
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // ── AUTH GATE ────────────────────────────────────────────────────────────
    // Allowed callers:
    //   1. Authenticated admin user (role === 'admin')
    //   2. Internal service callers passing the HUB_SYNC_SECRET as x-internal-secret header
    //      (used by retryFailedHubSyncs, stripeWebhook fire-and-forget, etc.)
    //
    // Rejected callers:
    //   - Unauthenticated public calls with no internal secret → 401
    //   - Authenticated non-admin customers → 403
    //
    // IMPORTANT: null from auth.me() is NOT treated as a service-role bypass.
    // All anonymous callers must supply x-internal-secret.

    const INTERNAL_SECRET = Deno.env.get('HUB_SYNC_SECRET');
    const internalSecretHeader = req.headers.get('x-internal-secret');
    const isInternalCall = INTERNAL_SECRET && internalSecretHeader === INTERNAL_SECRET;

    // Parse body once — needed for both auth check and payload
    const body = await req.json();

    if (!isInternalCall) {
      // Not an internal call — require admin user session
      const user = await base44.auth.me().catch(() => null);
      if (!user) {
        console.warn('[syncSubWithFulfillments] REJECTED: no auth session and no internal secret');
        return Response.json({ error_code: 'MISSING_AUTH', error: 'Authentication required' }, { status: 401 });
      }
      if (user.role !== 'admin') {
        console.warn(`[syncSubWithFulfillments] REJECTED: customer ${user.email} attempted internal sync`);
        return Response.json({ error_code: 'FORBIDDEN_CUSTOMER', error: 'Admin access required' }, { status: 403 });
      }
      console.log(`[syncSubWithFulfillments] Caller: admin user ${user.email}`);
    } else {
      console.log(`[syncSubWithFulfillments] Caller: internal service (x-internal-secret verified)`);
    }

    const { subscription_id, customer_email } = body;

    if (!subscription_id || !customer_email) {
      return Response.json({ error: 'Missing subscription_id or customer_email' }, { status: 400 });
    }

    console.log(`[syncSubWithFulfillments] Starting sync for ${customer_email}, sub ${subscription_id}`);

    // Fetch subscription
    const subs = await base44.asServiceRole.entities.Subscription.filter({
      id: subscription_id,
      customer_email: customer_email,
    });

    if (subs.length === 0) {
      return Response.json({ error: `Subscription ${subscription_id} not found` }, { status: 404 });
    }

    const subscription = subs[0];

    // Fetch plan
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({
      id: subscription.plan_id,
    });
    const plan = plans[0];

    // Calculate 4 fulfillments
    const fulfillments = calculateMonthlyFulfillments(subscription.started_date, plan?.name);
    console.log(`[syncSubWithFulfillments] Calculated ${fulfillments.length} fulfillments`);

    // Fetch user profile for customer name
    const profiles = await base44.asServiceRole.entities.UserProfile.filter({
      customer_email: customer_email,
    });
    const profile = profiles[0] || {};
    const customerName = profile.first_name && profile.last_name 
      ? `${profile.first_name} ${profile.last_name}` 
      : customer_email;

    // Build complete subscription payload with fulfillments
    // Parse address from subscription delivery_address string
    const addressParts = parseAddressString(subscription.delivery_address);

    const billingStart = subscription.started_date;
    const billingEnd = subscription.next_delivery_date || 
      new Date(new Date(billingStart).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const hubPayload = {
      event: 'customer.subscription_created',
      source: 'customer_app',
      customer_email: customer_email,
      data: {
        customer_app_subscription_id: subscription.id,
        stripe_subscription_id: subscription.stripe_subscription_id,
        stripe_customer_id: subscription.stripe_customer_id || null,
        customer_name: customerName,
        customer_email: customer_email,
        phone: profile.phone || null,
        delivery_address: subscription.delivery_address,
        address_line1: addressParts.address_line1,
        address_line2: null,
        address_city: addressParts.address_city,
        address_state: addressParts.address_state,
        address_postal_code: addressParts.address_postal_code,
        address_country: 'US',
        payment_status: 'paid',
        financial_status: 'paid',
        plan_name: plan?.name || 'Unknown',
        subscription_price: plan?.base_price || 0,
        amount_paid: plan?.base_price || 0,
        cycle_number: 1,
        billing_period_start: billingStart,
        billing_period_end: billingEnd,
        fulfillments: fulfillments,
      },
    };

    console.log(`[syncSubWithFulfillments] Payload built. Sending to Hub...`);
    console.log(`[syncSubWithFulfillments] Fulfillments: ${JSON.stringify(fulfillments.map(f => ({ fulfillment_number: f.fulfillment_number, scheduled_date: f.scheduled_date })))}`);

    // Send directly to Hub
    const hubBaseUrl = (Deno.env.get('HUB_API_URL') || '').trim();
    const hubUrl = hubBaseUrl.endsWith('/') 
      ? `${hubBaseUrl}functions/customerAppEventPublicGateway`
      : `${hubBaseUrl}/functions/customerAppEventPublicGateway`;

    const hubResponse = await fetch(hubUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('CUSTOMER_APP_SYNC_SECRET')}`,
      },
      body: JSON.stringify({
        event: 'customer.subscription_created',
        source: 'customer_app',
        customer_email: customer_email,
        data: hubPayload.data,
        synced_at: new Date().toISOString(),
      }),
    });

    console.log(`[syncSubWithFulfillments] Hub response status: ${hubResponse.status}`);

    if (!hubResponse.ok) {
      const hubError = await hubResponse.text();
      console.error(`[syncSubWithFulfillments] Hub error: ${hubError}`);
      return Response.json({ 
        error: `Hub returned ${hubResponse.status}`,
        details: hubError,
        fulfillments_calculated: fulfillments.length,
      }, { status: hubResponse.status });
    }

    const hubResult = await hubResponse.json();

    console.log(`[syncSubWithFulfillments] ✅ Hub sync completed`);

    return Response.json({
      success: true,
      subscription_id: subscription.id,
      customer_email: customer_email,
      fulfillments_sent: fulfillments.length,
      fulfillments: fulfillments,
      hub_response: hubResult,
    });

  } catch (error) {
    console.error('[syncSubWithFulfillments] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * Parse address string into structured fields.
 * Pattern: "Street, City, State ZipCode" or "Street, City, State, ZipCode"
 * Example: "206 West Pine Creek Ct, Wentzville, MO, 63385"
 */
function parseAddressString(fullAddress) {
  if (!fullAddress) {
    return {
      address_line1: null,
      address_city: null,
      address_state: null,
      address_postal_code: null,
    };
  }

  const parts = fullAddress.split(',').map(p => p.trim());
  let address_line1 = null;
  let address_city = null;
  let address_state = null;
  let address_postal_code = null;

  if (parts.length >= 1) address_line1 = parts[0] || null;
  if (parts.length >= 2) address_city = parts[1] || null;
  if (parts.length >= 3) {
    const stateZip = parts[2].trim().split(/\s+/);
    address_state = stateZip[0] || null;
    if (stateZip.length >= 2) {
      address_postal_code = stateZip[1] || null;
    }
  }
  if (parts.length >= 4) {
    address_postal_code = parts[3] || null;
  }

  return { address_line1, address_city, address_state, address_postal_code };
}

/**
 * Calculate 4 fulfillments for a monthly subscription cycle.
 */
function calculateMonthlyFulfillments(startedDate, planName) {
  const fulfillments = [];
  const start = new Date(startedDate + 'T00:00:00');
  
  // Determine product composition per fulfillment
  let productsPerFulfillment = [];
  if (planName === 'Monthly Ritual') {
    productsPerFulfillment = [
      { product_name: 'Aura', quantity: 1 },
      { product_name: 'Oasis', quantity: 1 },
      { product_name: 'Re-Nu', quantity: 1 },
    ];
  } else if (planName === 'VIP Wellness') {
    productsPerFulfillment = [
      { product_name: 'Aura', quantity: 2 },
      { product_name: 'Oasis', quantity: 2 },
      { product_name: 'Re-Nu', quantity: 2 },
    ];
  } else {
    productsPerFulfillment = [
      { product_name: 'Aura', quantity: 1 },
      { product_name: 'Oasis', quantity: 1 },
      { product_name: 'Re-Nu', quantity: 1 },
    ];
  }
  
  const itemsSummary = productsPerFulfillment
    .map(p => `${p.quantity}x ${p.product_name}`)
    .join(', ');
  
  // Generate 4 fulfillments: week 1, 2, 3, 4
  for (let week = 0; week < 4; week++) {
    const deliveryDate = new Date(start);
    deliveryDate.setDate(deliveryDate.getDate() + (week * 7));
    
    // Production date: NuVira produces on Tue/Fri only. Use the Friday immediately before delivery.
    // If delivery is Saturday (6), production is Friday (5) = 1 day back.
    // If delivery is Wednesday (3), production is Tuesday (2) = 1 day back.
    const productionDate = new Date(deliveryDate);
    const deliveryDayOfWeek = deliveryDate.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    
    // For Saturday delivery, go back 1 day to Friday. For any other day, go back to the nearest Tue or Fri.
    let daysBack;
    if (deliveryDayOfWeek === 6) { // Saturday -> Friday (1 day back)
      daysBack = 1;
    } else if (deliveryDayOfWeek === 3) { // Wednesday -> Tuesday (1 day back)
      daysBack = 1;
    } else {
      // For other days, calculate back to nearest valid production day (Fri or Tue)
      daysBack = ((deliveryDayOfWeek - 5) % 7 + 7) % 7; // Closest to Friday
      if (daysBack === 0 || daysBack > 3) daysBack = 2; // Fallback to closest valid day
    }
    productionDate.setDate(productionDate.getDate() - daysBack);
    
    const scheduledDateStr = deliveryDate.toISOString().split('T')[0];
    const productionDateStr = productionDate.toISOString().split('T')[0];
    
    fulfillments.push({
      fulfillment_number: week + 1,
      scheduled_date: scheduledDateStr,
      production_date: productionDateStr,
      delivery_window_label: '5 PM – 8 PM',
      delivery_window_start: '17:00',
      delivery_window_end: '20:00',
      products: productsPerFulfillment,
      items_summary: itemsSummary,
    });
  }
  
  return fulfillments;
}