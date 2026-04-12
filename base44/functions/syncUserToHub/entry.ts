import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const { email, full_name, phone, address, birthday } = body;

    if (!email) {
      return Response.json({ error: 'Missing email' }, { status: 400 });
    }

    // Sync to operations hub
    const hubUrl = Deno.env.get('OPS_HUB_URL');
    const hubToken = Deno.env.get('OPS_HUB_TOKEN');

    if (!hubUrl || !hubToken) {
      console.log('Hub credentials not configured, skipping sync');
      return Response.json({ success: true, skipped: true });
    }

    const response = await fetch(`${hubUrl}/api/customers`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hubToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        name: full_name,
        phone,
        address,
        birthday,
        synced_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Hub sync failed:', error);
      return Response.json({ success: false, error: error }, { status: 500 });
    }

    const result = await response.json();
    return Response.json({ success: true, hub_response: result });
  } catch (error) {
    console.error('Sync error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});