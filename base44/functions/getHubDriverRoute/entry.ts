/**
 * getHubDriverRoute
 * Proxies Hub getDriverRouteForDate for the Customer App Driver Portal.
 * Auth: driver or admin role only.
 * No local Order or FulfillmentTask reads.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'driver' && user.role !== 'admin' && user.role !== 'operations') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { date } = await req.json();
    if (!date) return Response.json({ error: 'date is required' }, { status: 400 });

    const hubBase = (Deno.env.get('HUB_API_URL') || '').replace(/\/$/, '').replace(/\/functions\/.*$/, '');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

    if (!hubBase || !hubSecret) {
      return Response.json({ error: 'Hub not configured' }, { status: 500 });
    }

    const url = `${hubBase}/functions/getDriverRouteForDate`;
    console.log(`[getHubDriverRoute] Fetching Hub route for date=${date}, driver=${user.email}`);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hubSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ date }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[getHubDriverRoute] Hub error ${res.status}: ${text}`);
      return Response.json({ error: `Hub returned ${res.status}`, detail: text }, { status: 502 });
    }

    const data = await res.json();
    console.log(`[getHubDriverRoute] Hub returned ${data.tasks?.length ?? 0} tasks for ${date}`);
    return Response.json(data);

  } catch (error) {
    console.error('[getHubDriverRoute] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});