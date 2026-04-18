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
      console.error('syncOrdersFromHub: unauthorized request');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const body = await req.json();

    if (!body.orders || !Array.isArray(body.orders)) {
      console.error('syncOrdersFromHub: invalid payload');
      return Response.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const results = [];
    for (const order of body.orders) {
      try {
        const existing = await base44.asServiceRole.entities.Order.filter({ order_number: order.order_number });
        
        if (existing.length > 0) {
          await base44.asServiceRole.entities.Order.update(existing[0].id, order);
          results.push({ order_number: order.order_number, action: 'updated' });
        } else {
          await base44.asServiceRole.entities.Order.create(order);
          results.push({ order_number: order.order_number, action: 'created' });
        }
      } catch (err) {
        console.error(`syncOrdersFromHub: error syncing ${order.order_number}:`, err.message);
        results.push({ order_number: order.order_number, action: 'failed', error: err.message });
      }
    }

    console.log(`syncOrdersFromHub: synced ${results.length} orders`);
    return Response.json({ success: true, results });
  } catch (error) {
    console.error('syncOrdersFromHub error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});