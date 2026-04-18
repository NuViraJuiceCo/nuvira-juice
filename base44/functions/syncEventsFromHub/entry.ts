import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token || token !== CUSTOMER_APP_SYNC_SECRET) {
      console.error('syncEventsFromHub: unauthorized request');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const { action, hub_event_id, event } = body;

    if (!action || !hub_event_id) {
      console.error('syncEventsFromHub: missing action or hub_event_id');
      return Response.json({ error: 'Missing action or hub_event_id' }, { status: 400 });
    }

    let result;

    if (action === 'create' || action === 'update') {
      if (!event) {
        return Response.json({ error: 'Missing event data for create/update' }, { status: 400 });
      }

      const existing = await base44.asServiceRole.entities.Event.filter({ hub_event_id });

      if (existing.length > 0) {
        await base44.asServiceRole.entities.Event.update(existing[0].id, event);
        result = { hub_event_id, action: 'updated' };
      } else {
        await base44.asServiceRole.entities.Event.create({ ...event, hub_event_id });
        result = { hub_event_id, action: 'created' };
      }
    } else if (action === 'delete') {
      const existing = await base44.asServiceRole.entities.Event.filter({ hub_event_id });
      
      if (existing.length > 0) {
        await base44.asServiceRole.entities.Event.delete(existing[0].id);
        result = { hub_event_id, action: 'deleted' };
      } else {
        result = { hub_event_id, action: 'not_found' };
      }
    } else {
      return Response.json({ error: 'Invalid action' }, { status: 400 });
    }

    console.log(`syncEventsFromHub: ${action} event ${hub_event_id}`);
    return Response.json({ success: true, result });
  } catch (error) {
    console.error('syncEventsFromHub error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});