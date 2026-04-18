import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_SYNC_SECRET = Deno.env.get('HUB_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token || token !== HUB_SYNC_SECRET) {
      console.error('getEventsForSync: unauthorized request');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const events = await base44.asServiceRole.entities.Event.list();

    console.log(`getEventsForSync: returning ${events.length} events`);
    return Response.json({ events });
  } catch (error) {
    console.error('getEventsForSync error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});