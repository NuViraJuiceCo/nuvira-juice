import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

/**
 * Proxy endpoint for hub to fetch sync data.
 * Validates Bearer token, then calls internal sync functions with auth context.
 * This adds a layer of authenticated execution so the sync functions can use asServiceRole.
 */
Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token || token !== CUSTOMER_APP_SYNC_SECRET) {
      console.error('hubSyncProxy: unauthorized request');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { resource_type } = body;

    if (resource_type === 'products') {
      const products = await base44.asServiceRole.entities.Product.list();
      const formatted = products.map(p => ({
        id: p.id,
        name: p.title,
        price: p.price,
        sku: p.shopify_product_id || null,
        description: p.description,
        category: p.category,
        image_url: p.image_url,
        availability: p.is_available,
        compare_at_price: p.compare_at_price,
        size: p.size,
        tags: p.tags,
      }));
      console.log(`hubSyncProxy: returning ${formatted.length} products`);
      return Response.json({ products: formatted });
    }

    if (resource_type === 'orders') {
      const query = body.date ? { estimated_delivery_date: body.date } : {};
      const orders = await base44.asServiceRole.entities.Order.filter(query, '-created_date');
      console.log(`hubSyncProxy: returning ${orders.length} orders`);
      return Response.json({ success: true, orders, count: orders.length, synced_at: new Date().toISOString() });
    }

    if (resource_type === 'events') {
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
      console.log(`hubSyncProxy: returning ${formatted.length} events`);
      return Response.json({ events: formatted });
    }

    return Response.json({ error: 'Unknown resource_type' }, { status: 400 });
  } catch (error) {
    console.error('hubSyncProxy error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});