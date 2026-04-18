import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token || token !== CUSTOMER_APP_SYNC_SECRET) {
      console.error('getEventsForSync: unauthorized request');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const events = await base44.asServiceRole.entities.Event.list();

    const formatted = events.map(e => ({
      id: e.id,
      hub_event_id: e.hub_event_id,
      title: e.title,
      date: e.date,
      time: e.time,
      location: e.location,
      is_active: e.is_active,
      description: e.description,
      image_url: e.image_url,
      tags: e.tags,
      website_link: e.website_link,
      tickets_link: e.tickets_link,
      price: e.price,
      capacity: e.capacity,
    }));

    console.log(`getEventsForSync: returning ${formatted.length} events`);
    return Response.json({ events: formatted });
  } catch (error) {
    console.error('getEventsForSync error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});