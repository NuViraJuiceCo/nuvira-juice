import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_SYNC_SECRET = Deno.env.get('HUB_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token || token !== HUB_SYNC_SECRET) {
      console.error('getOrderUpdatesForSync: unauthorized request');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const since = url.searchParams.get('since');

    const base44 = createClientFromRequest(req);
    const query = {};
    if (status) query.status = status;

    const orders = await base44.asServiceRole.entities.Order.list();
    
    let filtered = orders;
    if (since) {
      const sinceDate = new Date(since);
      filtered = orders.filter(o => new Date(o.updated_date) >= sinceDate);
    }
    if (status) {
      filtered = filtered.filter(o => o.status === status);
    }

    const formatted = filtered.map(o => ({
      id: o.id,
      shopify_order_id: o.stripe_checkout_session_id || null,
      stripe_checkout_session_id: o.stripe_checkout_session_id || null,
      order_number: o.order_number,
      customer_email: o.customer_email,
      status: o.status,
      total: o.total,
      fulfillment_type: o.fulfillment_type,
      estimated_delivery_date: o.estimated_delivery_date,
      created_date: o.created_date,
      updated_date: o.updated_date,
    }));

    console.log(`getOrderUpdatesForSync: returning ${formatted.length} order updates`);
    return Response.json({ orders: formatted });
  } catch (error) {
    console.error('getOrderUpdatesForSync error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});