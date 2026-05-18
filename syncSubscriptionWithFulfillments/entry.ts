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

    // ── PHASE 5: Calculate 4 fulfillments using central engine cadence ──────
    // subscription.started_date = first delivery date from calculateNuViraFulfillmentSchedule.
    // It will be either a Wednesday (Window 1) or Saturday (Window 2).
    // All 4 subsequent weekly deliveries must stay on that same day of week.
    // Production is always 1 day before (Tue before Wed, Fri before Sat).
    const fulfillments = calculateCentralEngineFulfillments(subscription.started_date, plan?.name);
    console.log(`[syncSubWithFulfillments] Calculated ${fulfillments.length} fulfillments (central engine cadence)`);

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

    // ── PHASE 5: Pre-send validation — reject invalid schedules before Hub push ──
    for (const f of fulfillments) {
      const delDow  = new Date(f.delivery_date + 'T12:00:00').getDay();
      const prodDow = new Date(f.production_date + 'T12:00:00').getDay();
      const validDel  = delDow  === 3 || delDow  === 6; // Wed or Sat
      const validProd = prodDow === 2 || prodDow === 5; // Tue or Fri
      if (!validDel || !validProd) {
        console.error(`[syncSubWithFulfillments] INVALID SCHEDULE in fulfillment #${f.fulfillment_number}: prod=${f.production_date}(dow=${prodDow}) del=${f.delivery_date}(dow=${delDow}). Aborting Hub push.`);
        return Response.json({
          success: false,
          error_code: 'INVALID_SCHEDULE',
          error: `Fulfillment #${f.fulfillment_number} has invalid production_date=${f.production_date} (must be Tue/Fri) or delivery_date=${f.delivery_date} (must be Wed/Sat). Hub push aborted.`,
          fulfillment: f,
        }, { status: 422 });
      }
    }
    console.log(`[syncSubWithFulfillments] All ${fulfillments.length} fulfillment schedules validated ✅`);

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
        // ── PHASE 5: Central engine schedule fields ──────────────────────────
        final_schedule_source: 'central_engine',
        schedule_timezone: 'America/Chicago',
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

      // ── 409 SUBSCRIPTION_QUARANTINED — terminal, do not retry ───────────────
      // Hub returns 409 when the subscription is quarantined (cancelled/refunded on Hub side).
      // Retrying subscription_created for a quarantined sub would create a new error loop.
      // Signal this as terminal so callers (retryFailedHubSyncs) write a skipped log instead.
      if (hubResponse.status === 409 && hubError.includes('SUBSCRIPTION_QUARANTINED')) {
        console.warn(`[syncSubWithFulfillments] Hub returned 409 SUBSCRIPTION_QUARANTINED for sub ${subscription_id}. Marking as terminal — no retry.`);
        // Also mark the CA Subscription hub_sync_status as skipped so it's clear in the DB
        await base44.asServiceRole.entities.Subscription.update(subscription_id, {
          hub_sync_status: 'skipped',
          hub_sync_error: 'Hub 409 SUBSCRIPTION_QUARANTINED — subscription is cancelled/refunded on Hub side. Admin reactivation required.',
          hub_sync_attempted_at: new Date().toISOString(),
          hub_sync_response_status: 409,
          hub_sync_response_body: hubError.substring(0, 500),
        }).catch(err => console.warn(`[syncSubWithFulfillments] Failed to update sub hub_sync_status: ${err.message}`));
        return Response.json({
          success: false,
          quarantined: true,
          subscription_id,
          error_code: 'SUBSCRIPTION_QUARANTINED',
          error: 'Hub has quarantined this subscription (cancelled/refunded). No retry will be attempted.',
        }, { status: 409 });
      }

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
 * PHASE 5: Central-engine-driven fulfillment calculator.
 *
 * startedDate = first delivery date set by calculateNuViraFulfillmentSchedule.
 * Will be a Wednesday (Window 1) or Saturday (Window 2).
 *
 * Rules:
 *   - Wednesday delivery → Tuesday production, window 5:00 PM – 8:00 PM
 *   - Saturday delivery  → Friday production,  window 12:00 PM – 3:00 PM
 *   - All 4 weekly deliveries stay on the SAME day of week as the first delivery.
 *   - Production is always the day before delivery (Tue→Wed, Fri→Sat).
 *   - Any other day of week is rejected before Hub push via pre-send validation.
 */
function calculateCentralEngineFulfillments(startedDate, planName) {
  const fulfillments = [];
  const firstDelivery = new Date(startedDate + 'T00:00:00');
  const dow = firstDelivery.getDay(); // 3=Wed, 6=Sat

  // Derive window from delivery day of week
  const isWednesday = dow === 3;
  const isSaturday  = dow === 6;

  // If neither Wed nor Sat, still generate fulfillments (validation will catch it pre-send)
  const windowLabel = isWednesday ? '5:00 PM – 8:00 PM' : isSaturday ? '12:00 PM – 3:00 PM' : '5:00 PM – 8:00 PM';
  const windowStart = isWednesday ? '17:00' : isSaturday ? '12:00' : '17:00';
  const windowEnd   = isWednesday ? '20:00' : isSaturday ? '15:00' : '20:00';

  // Product composition per plan
  let productsPerFulfillment;
  if (planName === 'VIP Wellness') {
    productsPerFulfillment = [
      { product_name: 'Aura', quantity: 2 },
      { product_name: 'Oasis', quantity: 2 },
      { product_name: 'Re-Nu', quantity: 2 },
    ];
  } else {
    // Monthly Ritual, Weekly Fresh, and default all get 1x each
    productsPerFulfillment = [
      { product_name: 'Aura', quantity: 1 },
      { product_name: 'Oasis', quantity: 1 },
      { product_name: 'Re-Nu', quantity: 1 },
    ];
  }

  const itemsSummary = productsPerFulfillment.map(p => `${p.quantity}x ${p.product_name}`).join(', ');

  for (let week = 0; week < 4; week++) {
    const deliveryDate = new Date(firstDelivery);
    deliveryDate.setDate(deliveryDate.getDate() + (week * 7));

    // Production is always exactly 1 day before delivery (Tue before Wed, Fri before Sat)
    const productionDate = new Date(deliveryDate);
    productionDate.setDate(productionDate.getDate() - 1);

    fulfillments.push({
      fulfillment_number: week + 1,
      delivery_date: deliveryDate.toISOString().split('T')[0],
      scheduled_date: deliveryDate.toISOString().split('T')[0], // backward compat alias
      production_date: productionDate.toISOString().split('T')[0],
      delivery_window_label: windowLabel,
      delivery_window_start: windowStart,
      delivery_window_end: windowEnd,
      delivery_day: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][deliveryDate.getDay()],
      production_day: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][productionDate.getDay()],
      products: productsPerFulfillment,
      items_summary: itemsSummary,
      final_schedule_source: 'central_engine',
      schedule_timezone: 'America/Chicago',
    });
  }

  return fulfillments;
}