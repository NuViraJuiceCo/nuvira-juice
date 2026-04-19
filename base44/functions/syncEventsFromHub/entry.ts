import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_SYNC_SECRET = Deno.env.get('HUB_SYNC_SECRET');

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token || token !== HUB_SYNC_SECRET) {
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

    if (action === 'create' || action === 'update') {
      if (!event) {
        return Response.json({ error: 'Missing event data for create/update' }, { status: 400 });
      }

      const eventData = { ...event, title: event.name };
      delete eventData.name;

      const existing = await base44.asServiceRole.entities.Event.filter({ hub_event_id });

      if (existing.length > 0) {
        await base44.asServiceRole.entities.Event.update(existing[0].id, eventData);
      } else {
        await base44.asServiceRole.entities.Event.create({ ...eventData, hub_event_id });
      }
    } else if (action === 'delete') {
      const existing = await base44.asServiceRole.entities.Event.filter({ hub_event_id });
      if (existing.length > 0) {
        await base44.asServiceRole.entities.Event.delete(existing[0].id);
      }
    } else {
      return Response.json({ error: 'Invalid action' }, { status: 400 });
    }

    console.log(`syncEventsFromHub: ${action} event ${hub_event_id}`);
    return Response.json({ success: true });
  } catch (error) {
    console.error('syncEventsFromHub error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});