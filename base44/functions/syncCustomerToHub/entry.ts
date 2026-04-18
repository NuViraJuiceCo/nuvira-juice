import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

/**
 * Syncs customer profile/interaction data to the operations hub.
 * Called by: profile updates, bag return submissions, onboarding completion, etc.
 * Payload: { event, customer_email, data }
 *   event: 'customer.profile_updated' | 'customer.bag_return' | 'customer.onboarding_complete'
 */
Deno.serve(async (req) => {
  try {
    const body = await req.json();

    const { event, customer_email, data } = body;

    if (!customer_email) {
      console.error('syncCustomerToHub: missing customer_email');
      return Response.json({ error: 'Missing customer_email' }, { status: 400 });
    }

    if (!HUB_API_URL) {
      console.log('syncCustomerToHub: HUB_API_URL not set, skipping');
      return Response.json({ success: true, skipped: true });
    }

    const payload = {
      event: event || 'customer.interaction',
      source: 'customer_app',
      customer_email,
      data,
      synced_at: new Date().toISOString(),
    };

    console.log(`syncCustomerToHub: syncing event "${event}" for ${customer_email}`);

    const response = await fetch(HUB_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sync-secret': CUSTOMER_APP_SYNC_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`syncCustomerToHub: hub returned ${response.status}:`, errorText);
      return Response.json({ error: `Hub returned ${response.status}`, details: errorText }, { status: response.status });
    }

    const result = await response.json();
    console.log(`syncCustomerToHub: "${event}" for ${customer_email} synced successfully`);
    return Response.json({ success: true, hub_response: result });
  } catch (error) {
    console.error('syncCustomerToHub error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});