import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

/**
 * Retries Hub sync for an already-repaired Subscription record.
 * Idempotent: does NOT create Subscription or award loyalty (already done).
 * Updates Subscription.hub_sync_status based on Hub response.
 * 
 * Payload: { subscription_id } OR { stripe_subscription_id }
 * 
 * Hub endpoint/auth contract: Will be confirmed by Hub team.
 * Currently uses receiveCustomerAppEvent + CUSTOMER_APP_SYNC_SECRET
 * If Hub requires different endpoint, update HUB_SUBSCRIPTION_SYNC_URL and auth header.
 */

const HUB_API_URL = `${(Deno.env.get('HUB_API_URL') || '').replace(/\/$/, '')}/api/functions/receiveCustomerAppEvent`;
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_LEGACY_PAYMENT_SUBSCRIPTION_TOOLS') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'legacy_payment_subscription_tools_disabled',
        message: 'Legacy payment/subscription tools are disabled for May 30 launch freeze.',
      }, { status: 409 });
    }

    const base44 = createClientFromRequest(req);
    const { subscription_id, stripe_subscription_id, force = false } = await req.json();

    if (!subscription_id && !stripe_subscription_id) {
      return Response.json({ error: 'Must provide subscription_id or stripe_subscription_id' }, { status: 400 });
    }

    console.log(`[RetrySubHubSync] Starting for subscription_id=${subscription_id || 'none'}, stripe_sub=${stripe_subscription_id || 'none'}`);

    // Fetch Subscription record
    let subscription = null;
    if (subscription_id) {
      const results = await base44.asServiceRole.entities.Subscription.filter({ id: subscription_id });
      subscription = results[0];
    } else {
      const results = await base44.asServiceRole.entities.Subscription.filter({ stripe_subscription_id });
      subscription = results[0];
    }

    if (!subscription) {
      const lookupKey = subscription_id ? `id=${subscription_id}` : `stripe_subscription_id=${stripe_subscription_id}`;
      return Response.json({ error: `Subscription not found (${lookupKey})` }, { status: 404 });
    }

    const customerEmail = subscription.customer_email;
    const planId = subscription.plan_id;
    const stripeSubId = subscription.stripe_subscription_id;

    console.log(`[RetrySubHubSync] Subscription found: ${subscription.id}, customer=${customerEmail}, plan=${planId}, stripe_sub=${stripeSubId}`);

    // Idempotency check: if already synced successfully, return early unless force=true
    if (subscription.hub_sync_status === 'synced' && subscription.hub_synced_at && !force) {
      console.log(`[RetrySubHubSync] Subscription already synced at ${subscription.hub_synced_at}, returning early (use force=true to override)`);
      return Response.json({
        success: true,
        message: 'Already synced — pass force=true to retry anyway',
        subscription_id: subscription.id,
        hub_sync_status: 'synced',
        hub_synced_at: subscription.hub_synced_at,
      });
    }
    if (force) {
      console.log(`[RetrySubHubSync] force=true — bypassing idempotency guard`);
    }

    // Fetch plan
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({ id: planId });
    const plan = plans[0];
    if (!plan) {
      return Response.json({ error: `Plan ${planId} not found` }, { status: 404 });
    }

    // Fetch customer profile
    const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: customerEmail });
    const profile = profiles[0] || {};
    const customerName = profile.first_name && profile.last_name 
      ? `${profile.first_name} ${profile.last_name}` 
      : customerEmail;
    const phone = profile.phone || '';

    // Fetch Stripe subscription for payment info and address metadata
    let paymentIntentId = null;
    let invoiceId = null;
    let stripeCustomerId = null;
    let addressLine1 = '';
    let addressCity = '';
    let addressState = '';
    let addressZip = '';
    try {
      const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubId);
      stripeCustomerId = typeof stripeSubscription.customer === 'string' ? stripeSubscription.customer : stripeSubscription.customer?.id;
      // Pull address from Stripe metadata if stored there
      addressLine1 = stripeSubscription.metadata?.delivery_address_line1 || '';
      addressCity  = stripeSubscription.metadata?.delivery_city  || '';
      addressState = stripeSubscription.metadata?.delivery_state || '';
      addressZip   = stripeSubscription.metadata?.delivery_postal_code || '';
      const invoices = await stripe.invoices.list({ subscription: stripeSubId, limit: 1 });
      const latestInvoice = invoices.data[0];
      if (latestInvoice) {
        invoiceId = latestInvoice.id;
        paymentIntentId = typeof latestInvoice.payment_intent === 'string'
          ? latestInvoice.payment_intent
          : latestInvoice.payment_intent?.id || null;
      }
      console.log(`[RetrySubHubSync] Stripe data: customer=${stripeCustomerId}, invoice=${invoiceId}, payment_intent=${paymentIntentId}`);
      console.log(`[RetrySubHubSync] Address from Stripe metadata: "${addressLine1}, ${addressCity}, ${addressState} ${addressZip}"`);
    } catch (stripeErr) {
      console.warn(`[RetrySubHubSync] Failed to fetch Stripe data: ${stripeErr.message}`);
    }

    // Fetch delivery zone
    const zones = await base44.asServiceRole.entities.DeliveryZone.filter({ id: subscription.delivery_zone_id });
    const zone = zones[0];

    // Products from plan
    const products = plan.composition_template?.bottles_per_delivery?.map(bottle => ({
      product_name: bottle.flavor || 'Juice',
      quantity: bottle.quantity || 1,
    })) || [];

    // Build Hub payload per requirements
    const hubData = {
      subscription_id: subscription.id,
      customer_name: customerName,
      customer_email: customerEmail,
      phone: phone,
      stripe_subscription_id: stripeSubId,
      stripe_customer_id: stripeCustomerId || null,
      customer_app_subscription_id: subscription.id,
      payment_status: 'paid',
      financial_status: 'paid',
      first_invoice_id: invoiceId || null,
      payment_intent_id: paymentIntentId || null,
      plan_id: planId,
      plan_name: plan.name,
      cadence: plan.frequency,
      production_date: subscription.started_date,
      first_delivery_date: subscription.started_date,
      next_delivery_date: subscription.next_delivery_date,
      delivery_window_label: '5 PM – 8 PM',
      delivery_window_start: '17:00',
      delivery_window_end: '20:00',
      delivery_address: subscription.delivery_address,
      address_line1: addressLine1,
      address_line2: '',
      address_city: addressCity,
      address_state: addressState,
      address_postal_code: addressZip,
      address_country: 'US',
      products: products,
      subscription_started_date: subscription.started_date,
      delivery_zone_id: subscription.delivery_zone_id,
      source_type: 'subscription_fulfillment',
      order_type: 'subscription',
      fulfillment_number: 1,
      requires_hub_fulfillment: true,
      requires_production_batch: true,
    };

    const hubPayload = {
      event: 'customer.subscription_created',
      event_type: 'customer.subscription_created',
      source: 'customer_app',
      customer_email: customerEmail,
      data: hubData,
      synced_at: new Date().toISOString(),
    };

    console.log(`[RetrySubHubSync] Hub payload ready. Endpoint: ${HUB_API_URL}`);
    console.log(`[RetrySubHubSync] Payload event: ${hubPayload.event}, data keys: ${Object.keys(hubData).join(', ')}`);

    if (!HUB_API_URL) {
      return Response.json({ error: 'HUB_API_URL not configured' }, { status: 400 });
    }

    if (!CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'CUSTOMER_APP_SYNC_SECRET not configured' }, { status: 400 });
    }

    // Call Hub
    console.log(`[RetrySubHubSync] Calling Hub endpoint...`);
    const response = await fetch(HUB_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify(hubPayload),
    });

    const responseText = await response.text();
    let hubResponse = null;
    try {
      hubResponse = JSON.parse(responseText);
    } catch {
      hubResponse = { raw: responseText };
    }

    console.log(`[RetrySubHubSync] Hub response status: ${response.status}`);
    console.log(`[RetrySubHubSync] Hub response body: ${responseText.substring(0, 500)}`);

    // Handle response
    let syncStatus = 'failed';
    let hubAction = null;
    let hubOrderId = null;
    let result = null;

    if (response.status === 200 || response.status === 201) {
      // Success responses
      if (typeof hubResponse === 'object') {
        hubAction = hubResponse?.action || hubResponse?.status || 'success';
        hubOrderId = hubResponse?.hub_order_id || hubResponse?.subscription_id || null;

        if (hubAction === 'created' || hubAction === 'updated') {
          syncStatus = 'synced';
          console.log(`[RetrySubHubSync] ✅ Hub ${hubAction} subscription. hub_order_id=${hubOrderId}`);
        } else if (hubAction === 'dedupe_exact_match') {
          syncStatus = 'synced';
          console.log(`[RetrySubHubSync] ✅ Hub dedupe_exact_match`);
        } else {
          // 200 but no confirmed action
          syncStatus = 'pending_review';
          console.warn(`[RetrySubHubSync] ⚠️ Hub returned 200 but no confirmed action: ${hubAction}`);
        }
      } else {
        syncStatus = 'synced';
        console.log(`[RetrySubHubSync] ✅ Hub returned 200`);
      }
    } else if (response.status === 410) {
      // Deprecated — Hub uses pull model
      syncStatus = 'skipped';
      console.log(`[RetrySubHubSync] Hub returned 410 (pull model) — order safe in Customer App DB`);
    } else {
      // Error response
      console.error(`[RetrySubHubSync] ❌ Hub returned ${response.status}: ${responseText.substring(0, 300)}`);
      syncStatus = 'failed';
    }

    // Update Subscription record with sync status
    const updatePayload = {
      hub_sync_status: syncStatus,
      hub_sync_response_status: response.status,
      hub_sync_response_body: responseText.substring(0, 1000),
      hub_sync_attempted_at: new Date().toISOString(),
    };

    if (syncStatus === 'synced') {
      updatePayload.hub_synced_at = new Date().toISOString();
    }

    if (syncStatus === 'failed') {
      updatePayload.hub_sync_error = `HTTP ${response.status}: ${responseText.substring(0, 200)}`;
    }

    await base44.asServiceRole.entities.Subscription.update(subscription.id, updatePayload);
    console.log(`[RetrySubHubSync] Updated Subscription ${subscription.id} with hub_sync_status=${syncStatus}`);

    result = {
      success: syncStatus === 'synced' || syncStatus === 'skipped',
      subscription_id: subscription.id,
      customer_email: customerEmail,
      stripe_subscription_id: stripeSubId,
      hub_sync_status: syncStatus,
      hub_response_status: response.status,
      hub_response_body: hubResponse,
      hub_action: hubAction,
      hub_order_id: hubOrderId,
      message: syncStatus === 'synced' 
        ? 'Subscription synced to Hub successfully'
        : syncStatus === 'skipped'
        ? 'Hub uses pull model — subscription safe in app DB'
        : `Hub sync status: ${syncStatus}`,
    };

    console.log(`[RetrySubHubSync] Final result: success=${result.success}, status=${syncStatus}`);

    return Response.json(result, { status: response.ok ? 200 : response.status });

  } catch (error) {
    console.error('[RetrySubHubSync] Error:', error.message);
    console.error('[RetrySubHubSync] Stack:', error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
