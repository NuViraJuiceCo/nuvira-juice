import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { email } = await req.json();

    const orders = await base44.asServiceRole.entities.Order.filter({ customer_email: email });
    return Response.json({ count: orders.length, orders });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});