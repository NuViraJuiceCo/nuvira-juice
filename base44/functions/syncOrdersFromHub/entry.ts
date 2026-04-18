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

    if (!body.id || !body.order_number) {
      console.error('syncOrdersFromHub: missing required fields');
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const existing = await base44.asServiceRole.entities.Order.filter({ order_number: body.order_number });

    let orderId;
    if (existing.length > 0) {
      await base44.asServiceRole.entities.Order.update(existing[0].id, body);
      orderId = existing[0].id;
    } else {
      const created = await base44.asServiceRole.entities.Order.create(body);
      orderId = created.id;
    }

    console.log(`syncOrdersFromHub: synced order ${body.order_number}`);
    return Response.json({ success: true, id: orderId });
  } catch (error) {
    console.error('syncOrdersFromHub error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});