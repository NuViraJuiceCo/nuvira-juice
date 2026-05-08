import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

/**
 * Syncs customer profile/interaction data to the operations hub.
 * Called by: profile updates, bag return submissions, onboarding completion, subscription events, etc.
 * Payload: { event, customer_email, data }
 *   event: 'customer.profile_updated' | 'customer.bag_return' | 'customer.onboarding_complete' | 'customer.subscription_created'
 */
Deno.serve(async (req) => {
  try {
    const body = await req.json();

    const { event, customer_email, data } = body;

    if (!customer_email) {
      console.error('syncCustomerToHub: missing customer_email');
      return Response.json({ error: 'Missing customer_email' }, { status: 400 });
    }

    const hubBaseUrl = (Deno.env.get('HUB_API_URL') || '').trim();
    
    if (!hubBaseUrl) {
      console.log('syncCustomerToHub: HUB_API_URL not set, skipping');
      return Response.json({ success: true, skipped: true });
    }

    // Build URL safely: remove trailing slash from base, construct full path
    const hubUrl = hubBaseUrl.endsWith('/') 
      ? `${hubBaseUrl}api/functions/receiveCustomerAppEvent`
      : `${hubBaseUrl}/api/functions/receiveCustomerAppEvent`;

    const payload = {
      event: event || 'customer.interaction',
      source: 'customer_app',
      customer_email,
      data,
      synced_at: new Date().toISOString(),
    };

    // Log sanitized request details (no secret)
    console.log(`[syncCustomerToHub] Event: ${event}, Customer: ${customer_email}`);
    console.log(`[syncCustomerToHub] Hub URL: ${hubUrl}`);
    console.log(`[syncCustomerToHub] Auth: Bearer token`);
    console.log(`[syncCustomerToHub] Payload keys: ${Object.keys(payload).join(', ')}`);

    const response = await fetch(hubUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify(payload),
    });

    console.log(`[syncCustomerToHub] Hub response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[syncCustomerToHub] Hub error ${response.status}: ${errorText}`);
      return Response.json({ error: `Hub returned ${response.status}`, details: errorText }, { status: response.status });
    }

    const result = await response.json();
    console.log(`[syncCustomerToHub] ✅ "${event}" for ${customer_email} synced successfully`);
    return Response.json({ success: true, hub_response: result });
  } catch (error) {
    console.error('[syncCustomerToHub] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});