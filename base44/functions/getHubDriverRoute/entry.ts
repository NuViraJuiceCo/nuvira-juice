/**
 * getHubDriverRoute
 *
 * Proxies Hub getDriverRouteForDate directly.
 * Returns real Hub FulfillmentTask IDs as task_id on every task card.
 * 
 * Auth: driver, admin, or operations role only.
 * No local Order or FulfillmentTask reads or writes.
 * No getOrderUpdatesForCustomerApp calls — route cards are built exclusively
 * from Hub getDriverRouteForDate which exposes real FulfillmentTask.id values.
 *
 * Returns Hub response verbatim with date and counts fields preserved.
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

    console.log(`[getHubDriverRoute] Calling Hub getDriverRouteForDate for date=${date}`);

    const url = `${hubBase}/functions/getDriverRouteForDate`;
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

    // Log task_id presence for each task for verification
    const allTasks = [
      ...(data.ready_tasks || []),
      ...(data.scheduled_tasks || []),
      ...(data.completed_tasks || []),
    ];

    for (const t of allTasks) {
      console.log(`[getHubDriverRoute] task: customer=${t.customer_name || 'unknown'} task_id=${t.task_id || 'MISSING'} status=${t.status || 'unknown'}`);
    }

    console.log(`[getHubDriverRoute] Hub returned ${allTasks.length} tasks for date=${date} (ready=${(data.ready_tasks||[]).length} scheduled=${(data.scheduled_tasks||[]).length} completed=${(data.completed_tasks||[]).length})`);

    // Return Hub response verbatim — task_id on each task is the real Hub FulfillmentTask.id
    return Response.json(data);

  } catch (error) {
    console.error('[getHubDriverRoute] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});