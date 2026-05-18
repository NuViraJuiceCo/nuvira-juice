import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_SYNC_SECRET = Deno.env.get('HUB_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    // Validate Bearer token
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token || token !== HUB_SYNC_SECRET) {
      console.error('receiveSyncedEvent: unauthorized request');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { action, hub_event_id, event } = body;

    if (!action || !hub_event_id) {
      return Response.json({ error: 'Missing required fields: action, hub_event_id' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);

    // Find existing record by hub_event_id
    const existing = await base44.asServiceRole.entities.Event.filter({ hub_event_id });
    const existingRecord = existing[0] || null;

    if (action === 'create' || action === 'update') {
      if (!event) {
        return Response.json({ error: 'Missing event data' }, { status: 400 });
      }

      const payload = { ...event, hub_event_id };

      if (existingRecord) {
        await base44.asServiceRole.entities.Event.update(existingRecord.id, payload);
        console.log(`receiveSyncedEvent: updated event ${hub_event_id}`);
      } else {
        await base44.asServiceRole.entities.Event.create(payload);
        console.log(`receiveSyncedEvent: created event ${hub_event_id}`);
      }

      return Response.json({ success: true });
    }

    if (action === 'delete') {
      if (!existingRecord) {
        console.log(`receiveSyncedEvent: event ${hub_event_id} not found, nothing to delete`);
        return Response.json({ success: true, note: 'Event not found, nothing deleted' });
      }

      await base44.asServiceRole.entities.Event.delete(existingRecord.id);
      console.log(`receiveSyncedEvent: deleted event ${hub_event_id}`);
      return Response.json({ success: true });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });

  } catch (error) {
    console.error('receiveSyncedEvent error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});