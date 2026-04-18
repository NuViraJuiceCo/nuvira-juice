import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

/**
 * Receives events synced from hub and upserts into Event entity
 * Called by: Hub app pushing event updates via syncEventToHub
 * Payload: { action: 'create' | 'update' | 'delete', hub_event_id, event: { ...event data } }
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token || token !== CUSTOMER_APP_SYNC_SECRET) {
      console.error('receiveEventSync: unauthorized request');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const { action, hub_event_id, event } = await req.json();

    if (!action || !hub_event_id) {
      return Response.json({ error: 'Missing action or hub_event_id' }, { status: 400 });
    }

    if (action === 'delete') {
      // Find and delete the event by hub_event_id
      const existing = await base44.asServiceRole.entities.Event.filter({ hub_event_id });
      if (existing.length > 0) {
        await base44.asServiceRole.entities.Event.delete(existing[0].id);
        console.log(`receiveEventSync: deleted event ${hub_event_id}`);
        return Response.json({ success: true, action: 'deleted' });
      }
      console.log(`receiveEventSync: event ${hub_event_id} not found for deletion`);
      return Response.json({ success: true, action: 'delete_ignored', reason: 'not_found' });
    }

    if (!event) {
      return Response.json({ error: 'Missing event data for create/update' }, { status: 400 });
    }

    // Upsert: check if event with this hub_event_id exists
    const existing = await base44.asServiceRole.entities.Event.filter({ hub_event_id });

    if (existing.length > 0) {
      // Update existing
      await base44.asServiceRole.entities.Event.update(existing[0].id, {
        ...event,
        hub_event_id,
      });
      console.log(`receiveEventSync: updated event ${hub_event_id}`);
      return Response.json({ success: true, action: 'updated' });
    } else {
      // Create new
      await base44.asServiceRole.entities.Event.create({
        ...event,
        hub_event_id,
      });
      console.log(`receiveEventSync: created event ${hub_event_id}`);
      return Response.json({ success: true, action: 'created' });
    }
  } catch (error) {
    console.error('receiveEventSync error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});