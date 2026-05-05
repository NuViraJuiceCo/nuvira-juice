/**
 * hubDriverAction
 * Proxies driver delivery actions to Hub updateDriverDeliveryTask.
 * Auth: driver or admin role only.
 * No local Order or FulfillmentTask writes.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ALLOWED_ACTIONS = [
  'mark_out_for_delivery',
  'mark_delivered',
  'mark_unable_to_deliver',
  'add_note',
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'driver' && user.role !== 'admin' && user.role !== 'operations') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const { task_id, action, note, failure_reason } = body;

    if (!task_id) return Response.json({ error: 'task_id is required' }, { status: 400 });
    if (!action || !ALLOWED_ACTIONS.includes(action)) {
      return Response.json({ error: `action must be one of: ${ALLOWED_ACTIONS.join(', ')}` }, { status: 400 });
    }

    const hubBase = (Deno.env.get('HUB_API_URL') || '').replace(/\/$/, '').replace(/\/functions\/.*$/, '');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

    if (!hubBase || !hubSecret) {
      return Response.json({ error: 'Hub not configured' }, { status: 500 });
    }

    const payload = {
      task_id,
      action,
      driver_email: user.email,
      driver_name: user.full_name || user.email,
      ...(note ? { note } : {}),
      ...(failure_reason ? { failure_reason } : {}),
    };

    console.log(`[hubDriverAction] action=${action} task_id=${task_id} driver=${user.email}`);

    const url = `${hubBase}/functions/updateDriverDeliveryTask`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hubSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[hubDriverAction] Hub error ${res.status}: ${text}`);
      return Response.json({ error: `Hub returned ${res.status}`, detail: text }, { status: 502 });
    }

    const data = await res.json();
    console.log(`[hubDriverAction] Hub confirmed: ${JSON.stringify(data)}`);
    return Response.json({ success: true, ...data });

  } catch (error) {
    console.error('[hubDriverAction] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});