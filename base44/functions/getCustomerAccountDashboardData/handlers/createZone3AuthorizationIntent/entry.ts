import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

// Compatibility name retained. One authoritative root owns all catalog,
// offer, benefit, schedule, idempotency and recovery validation.
async function handle(req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.id || !user.email) return Response.json({ error: 'Sign in for route review.' }, { status: 401 });
    const body = await req.json();
    if (body.customer_acknowledged_hold !== true) return Response.json({ error: 'Route review agreement required.' }, { status: 400 });
    const response = await base44.functions.invoke('createPaymentIntent', {
      ...body, mode: 'prepare_route_review', guest_checkout: false,
    });
    return Response.json(response?.data || response);
  } catch (error) {
    const status = [400, 401, 403, 409].includes(error?.response?.status) ? error.response.status : 503;
    return Response.json({ error: 'Route review could not be prepared. Return to checkout to review this attempt.',
      payment_confirmation_attempted: false }, { status });
  }
}
export default handle;
