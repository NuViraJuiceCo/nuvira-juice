import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Debug and retry Hub sync for repaired subscription.
 * Logs request/response details to identify 403 root cause.
 */

Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_LEGACY_REPAIR_TOOLS') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'legacy_repair_tools_disabled',
        message: 'Legacy repair tools are disabled for May 30 launch freeze.',
      });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const {
      subscription_id = '69fe3e960cba907fa6488355',
      customer_email = 'amark@nuvisionarymedia.com',
    } = await req.json();

    console.log(`[debugHubSync] Fetching subscription ${subscription_id}`);

    // Get subscription details
    const subs = await base44.asServiceRole.entities.Subscription.filter({
      id: subscription_id,
      customer_email: customer_email,
    });

    if (subs.length === 0) {
      return Response.json({ error: `Subscription ${subscription_id} not found` }, { status: 404 });
    }

    const sub = subs[0];
    console.log(`[debugHubSync] Found subscription, stripe_sub=${sub.stripe_subscription_id}`);

    // Get plan
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({
      id: sub.plan_id,
    });
    const plan = plans[0];

    // Build payload exactly as it should be sent to Hub
    const payload = {
      event: 'customer.subscription_created',
      event_type: 'customer.subscription_created',
      source: 'customer_app',
      customer_email: customer_email,
      data: {
        subscription_id: sub.id,
        customer_app_subscription_id: sub.id,
        stripe_subscription_id: sub.stripe_subscription_id,
        stripe_customer_id: sub.stripe_customer_id,
        customer_name: 'Amar Kahlon',
        customer_email: customer_email,
        phone: '',
        payment_status: 'paid',
        financial_status: 'paid',
        plan_id: sub.plan_id,
        plan_name: plan?.name || 'Unknown',
        billing_cadence: 'monthly',
        fulfillment_cadence: 'weekly',
        fulfillments_per_cycle: 4,
        fulfillment_number: 1,
        order_type: 'subscription',
        source_type: 'subscription_fulfillment',
        production_date: '2026-05-08',
        first_delivery_date: sub.started_date,
        next_delivery_date: sub.next_delivery_date,
        subscription_started_date: sub.started_date,
        delivery_window_label: '5 PM – 8 PM',
        delivery_window_start: '17:00',
        delivery_window_end: '20:00',
        delivery_address: sub.delivery_address,
        address_line1: '206 West Pine Creek Ct',
        address_line2: '',
        address_city: 'Wentzville',
        address_state: 'MO',
        address_postal_code: '63385',
        address_country: 'US',
        delivery_zone_id: sub.delivery_zone_id,
        products: sub.custom_composition || [],
        items_summary: '1x AURA, 1x RE-NU, 1x OASIS',
      },
    };

    console.log(`[debugHubSync] Payload ready. Event: ${payload.event}`);

    // Get Hub URL and secret
    const HUB_API_URL = Deno.env.get('HUB_API_URL');
    const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({
        error: 'Missing HUB_API_URL or CUSTOMER_APP_SYNC_SECRET',
        hub_url_set: !!HUB_API_URL,
        secret_set: !!CUSTOMER_APP_SYNC_SECRET,
      }, { status: 500 });
    }

    // Log request details (sanitized)
    console.log(`[debugHubSync] Hub URL: ${HUB_API_URL}`);
    console.log(`[debugHubSync] Auth scheme: Bearer`);
    console.log(`[debugHubSync] Secret length: ${CUSTOMER_APP_SYNC_SECRET.length}`);

    // Attempt Hub sync
    console.log(`[debugHubSync] Sending to Hub...`);
    const response = await fetch(`${HUB_API_URL}/api/functions/receiveCustomerAppEvent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify(payload),
    });

    console.log(`[debugHubSync] Hub response status: ${response.status}`);

    const responseText = await response.text();
    console.log(`[debugHubSync] Hub response body: ${responseText}`);

    let responseBody = null;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = { raw: responseText };
    }

    if (!response.ok) {
      return Response.json({
        success: false,
        status_code: response.status,
        response_body: responseBody,
        request_details: {
          url: `${HUB_API_URL}/api/functions/receiveCustomerAppEvent`,
          method: 'POST',
          auth_scheme: 'Bearer',
          auth_secret_set: true,
          payload_event: payload.event,
        },
        debug_message: `Hub returned ${response.status}. Check response_body for error details.`,
      }, { status: response.status });
    }

    // Success
    return Response.json({
      success: true,
      status_code: response.status,
      response_body: responseBody,
      subscription_id: subscription_id,
      message: `✅ Hub sync succeeded for ${sub.stripe_subscription_id}`,
    });

  } catch (error) {
    console.error('[debugHubSync] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
