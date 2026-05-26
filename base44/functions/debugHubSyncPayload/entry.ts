import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Debug: Capture exact Hub sync request/response for payload comparison.
 * Admin-only diagnostic. Shows sanitized payload and full response body.
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

    const { subscription_id } = await req.json();
    if (!subscription_id) {
      return Response.json({ error: 'Missing subscription_id' }, { status: 400 });
    }

    // Fetch subscription
    const subs = await base44.asServiceRole.entities.Subscription.filter({
      id: subscription_id,
    });

    if (subs.length === 0) {
      return Response.json({ error: `Subscription ${subscription_id} not found` }, { status: 404 });
    }

    const subscription = subs[0];
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({
      id: subscription.plan_id,
    });
    const plan = plans[0];

    // Build exact payload as syncRepairedSubscriptionToHub would
    const hubPayload = {
      event: 'customer.subscription_created',
      source: 'customer_app',
      customer_email: subscription.customer_email,
      data: {
        subscription_id: subscription.id,
        customer_name: 'Amar Kahlon',
        phone: '',
        stripe_subscription_id: subscription.stripe_subscription_id,
        stripe_customer_id: subscription.stripe_customer_id,
        customer_app_subscription_id: subscription.id,
        payment_status: 'paid',
        financial_status: 'paid',
        first_invoice_id: null,
        plan_id: subscription.plan_id,
        plan_name: plan?.name || 'Unknown',
        cadence: plan?.frequency || 'monthly',
        production_date: subscription.started_date,
        first_delivery_date: subscription.started_date,
        next_delivery_date: subscription.next_delivery_date,
        delivery_window_label: '5 PM – 8 PM',
        delivery_window_start: '17:00',
        delivery_window_end: '20:00',
        delivery_address: subscription.delivery_address,
        address_line1: '',
        address_city: '',
        address_state: '',
        address_postal_code: '',
        address_country: 'US',
        products: subscription.custom_composition || [],
        subscription_started_date: subscription.started_date,
        delivery_zone_id: subscription.delivery_zone_id,
      },
      synced_at: new Date().toISOString(),
    };

    const hubBaseUrl = (Deno.env.get('HUB_API_URL') || '').trim();
    const hubUrl = hubBaseUrl.endsWith('/')
      ? `${hubBaseUrl}functions/customerAppEventPublicGateway`
      : `${hubBaseUrl}/functions/customerAppEventPublicGateway`;

    console.log('[debugHubSyncPayload] ====== REQUEST DETAILS ======');
    console.log(`[debugHubSyncPayload] URL: ${hubUrl}`);
    console.log('[debugHubSyncPayload] METHOD: POST');
    console.log('[debugHubSyncPayload] HEADERS:');
    console.log('[debugHubSyncPayload]   Content-Type: application/json');
    console.log('[debugHubSyncPayload]   Authorization: Bearer [CUSTOMER_APP_SYNC_SECRET]');
    console.log('[debugHubSyncPayload] ====== PAYLOAD ======');
    console.log(JSON.stringify(hubPayload, null, 2));

    const response = await fetch(hubUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('CUSTOMER_APP_SYNC_SECRET')}`,
      },
      body: JSON.stringify(hubPayload),
    });

    const responseText = await response.text();
    let responseBody = null;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = { raw: responseText };
    }

    console.log('[debugHubSyncPayload] ====== RESPONSE ======');
    console.log(`[debugHubSyncPayload] STATUS: ${response.status}`);
    console.log('[debugHubSyncPayload] BODY:');
    console.log(JSON.stringify(responseBody, null, 2));

    return Response.json({
      success: response.status < 300,
      request: {
        url: hubUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer CUSTOMER_APP_SYNC_SECRET',
        },
        payload: hubPayload,
      },
      response: {
        status: response.status,
        body: responseBody,
      },
      diagnostics: {
        payload_keys: Object.keys(hubPayload),
        data_keys: Object.keys(hubPayload.data),
        payload_size_bytes: JSON.stringify(hubPayload).length,
      },
    });

  } catch (error) {
    console.error('[debugHubSyncPayload] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
