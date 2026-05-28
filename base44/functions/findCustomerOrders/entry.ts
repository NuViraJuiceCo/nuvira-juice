import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

async function authorizeEmailLookup(base44, email) {
  const user = await base44.auth.me().catch(() => null);
  const requested = String(email || '').trim().toLowerCase();
  const requester = String(user?.email || '').trim().toLowerCase();
  if (!user?.email) {
    return { response: Response.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  if (user.role === 'admin' || requester === requested) {
    return { user };
  }
  return { response: Response.json({ error: 'forbidden' }, { status: 403 }) };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { email } = await req.json();
    const auth = await authorizeEmailLookup(base44, email);
    if (auth.response) return auth.response;

    const orders = await base44.asServiceRole.entities.Order.filter({ customer_email: email });
    return Response.json({ count: orders.length, orders });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
