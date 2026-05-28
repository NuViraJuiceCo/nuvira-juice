import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function authorizeInternalSync(req) {
  const expected = Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || Deno.env.get('HUB_SYNC_SECRET') || '';
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!expected || !token || token !== expected) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const unauthorized = authorizeInternalSync(req);
    if (unauthorized) return unauthorized;

    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { date } = body;

    const query = date ? { estimated_delivery_date: date } : {};
    const orders = await base44.asServiceRole.entities.Order.filter(query, '-created_date');

    const formatted = orders.map(o => ({
      id: o.id,
      order_number: o.order_number,
      customer_email: o.customer_email,
      items: o.items,
      subtotal: o.subtotal,
      delivery_fee: o.delivery_fee,
      total: o.total,
      fulfillment_type: o.fulfillment_type,
      delivery_address: o.delivery_address,
      status: o.status,
      estimated_delivery_date: o.estimated_delivery_date,
      is_preorder: o.is_preorder,
      preorder_fulfillment_date: o.preorder_fulfillment_date,
      created_date: o.created_date,
    }));

    console.log(`getOrdersForSync: returning ${formatted.length} orders`);
    return Response.json({ orders: formatted, count: formatted.length });
  } catch (error) {
    console.error('getOrdersForSync error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
