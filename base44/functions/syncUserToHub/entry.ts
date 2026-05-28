import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Syncs customer profile data to the operations hub.
 * Called by: AccountSettings on save, onboarding completion.
 * Payload: { email, first_name, last_name, phone, address, birthday }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { email, first_name, last_name, phone, address, birthday } = body;

    if (!email) {
      return Response.json({ error: 'Missing email' }, { status: 400 });
    }

    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (user.role !== 'admin' && normalizeEmail(user.email) !== normalizeEmail(email)) {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }

    if (!HUB_API_URL) {
      console.log('syncUserToHub: HUB_API_URL not set, skipping');
      return Response.json({ success: true, skipped: true });
    }

    const payload = {
      event: 'customer.profile_updated',
      source: 'customer_app',
      customer_email: email,
      data: {
        email,
        first_name,
        last_name,
        full_name: [first_name, last_name].filter(Boolean).join(' '),
        phone,
        address,
        birthday,
        synced_at: new Date().toISOString(),
      },
    };

    console.log(`syncUserToHub: syncing profile for ${email}`);

    const response = await fetch(HUB_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`syncUserToHub: hub returned ${response.status}:`, errorText);
      return Response.json({ error: `Hub returned ${response.status}`, details: errorText }, { status: response.status });
    }

    const result = await response.json();
    console.log(`syncUserToHub: profile for ${email} synced successfully`);
    return Response.json({ success: true, hub_response: result });
  } catch (error) {
    console.error('syncUserToHub error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
