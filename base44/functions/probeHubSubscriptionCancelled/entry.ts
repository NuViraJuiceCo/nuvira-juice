import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * One-shot probe: sends customer.subscription_cancelled directly to Hub
 * and returns the raw status + body so we can confirm whether cascade is active.
 * 
 * Payload: { dry_run?: boolean }  — pass dry_run:false to send actual payload
 */

const HUB_API_URL = `${(Deno.env.get('HUB_API_URL') || '').replace(/\/$/, '')}/api/functions/receiveCustomerAppEvent`;
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { dry_run = true } = await req.json().catch(() => ({}));

    const payload = {
      event: 'customer.subscription_cancelled',
      event_type: 'customer.subscription_cancelled',
      source: 'customer_app',
      customer_email: 'amark@nuvisionarymedia.com',
      data: {
        subscription_id: '69fd1b7e5994d9b6bfbafeaf',
        customer_app_subscription_id: '69fd1b7e5994d9b6bfbafeaf',
        stripe_subscription_id: 'sub_1TUah0IrzYHaHkt24AVgUtNY',
        customer_email: 'amark@nuvisionarymedia.com',
        cancellation_reason: 'refunded',
        refund_amount: 144.0,
        is_full_refund: true,
        payment_intent_id: 'pi_3TUah0IrzYHaHkt22cLZVhAx',
        cancelled_at: new Date().toISOString(),
      },
    };

    console.log(`[ProbeHubSubCancelled] dry_run=${dry_run}`);
    console.log(`[ProbeHubSubCancelled] Endpoint: ${HUB_API_URL}`);
    console.log(`[ProbeHubSubCancelled] Auth header: Authorization: Bearer ${(CUSTOMER_APP_SYNC_SECRET || 'NOT_SET').substring(0, 20)}...`);
    console.log(`[ProbeHubSubCancelled] Payload: ${JSON.stringify(payload)}`);

    if (dry_run) {
      return Response.json({
        dry_run: true,
        endpoint: HUB_API_URL,
        auth_configured: !!CUSTOMER_APP_SYNC_SECRET,
        payload,
        note: 'Pass dry_run:false to actually send to Hub',
      });
    }

    const response = await fetch(HUB_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let responseBody = null;
    try { responseBody = JSON.parse(responseText); } catch { responseBody = responseText; }

    console.log(`[ProbeHubSubCancelled] Hub response status: ${response.status}`);
    console.log(`[ProbeHubSubCancelled] Hub response body: ${responseText}`);

    return Response.json({
      dry_run: false,
      endpoint: HUB_API_URL,
      payload_sent: payload,
      hub_status: response.status,
      hub_body: responseBody,
      hub_raw: responseText,
      cascade_confirmed: response.status === 200 && responseBody?.action && responseBody.action !== 'acknowledged',
      note: response.status === 200 && responseBody?.note === 'Event received, no action required'
        ? 'Hub acknowledged but NO cascade action — cascade NOT active'
        : response.status === 200 && responseBody?.action
        ? `Hub action: ${responseBody.action} — verify if this triggers cascade`
        : `HTTP ${response.status} — check hub_body for details`,
    });

  } catch (err) {
    console.error(`[ProbeHubSubCancelled] Error: ${err.message}`);
    return Response.json({ error: err.message }, { status: 500 });
  }
});