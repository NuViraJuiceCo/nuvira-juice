import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * One-shot probe: sends customer.subscription_cancelled directly to Hub
 * and returns the raw status + body so we can confirm whether cascade is active.
 * 
 * Payload: { dry_run?: boolean }  — pass dry_run:false to send actual payload
 */

const HUB_API_URL = `${(Deno.env.get('HUB_API_URL') || '').replace(/\/$/, '')}/api/functions/receiveCustomerAppEvent`;
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

async function requireAdmin(base44) {
  const user = await base44.auth.me().catch(() => null);
  if (!user?.email) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403 });
  return null;
}

async function readJsonBody(req) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return { ok: true, body: {} };
  }

  const raw = await req.text();
  if (!raw.trim()) {
    return { ok: true, body: {} };
  }

  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, body: null };
  }
}

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
    const unauthorized = await requireAdmin(base44);
    if (unauthorized) return unauthorized;
    const parsedBody = await readJsonBody(req);
    if (!parsedBody.ok) {
      return Response.json({ success: false, error: 'malformed_json', error_code: 'malformed_json' }, { status: 400 });
    }
    const body = parsedBody.body && typeof parsedBody.body === 'object' && !Array.isArray(parsedBody.body) ? parsedBody.body : {};
    const { dry_run = true } = body;

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
    console.log(`[ProbeHubSubCancelled] Auth configured: ${!!CUSTOMER_APP_SYNC_SECRET}`);
    console.log(`[ProbeHubSubCancelled] Payload type: ${payload.event}`);

    if (dry_run) {
      return Response.json({
        dry_run: true,
        endpoint: HUB_API_URL,
        auth_configured: !!CUSTOMER_APP_SYNC_SECRET,
        payload_summary: {
          event: payload.event,
          source: payload.source,
          has_subscription_id: !!payload.data.subscription_id,
          has_payment_intent_id: !!payload.data.payment_intent_id,
          is_full_refund: payload.data.is_full_refund,
        },
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
      payload_sent: true,
      hub_status: response.status,
      hub_body: responseBody,
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
