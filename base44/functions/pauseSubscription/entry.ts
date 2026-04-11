import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { subscription_id, paused_until } = body;

    if (!subscription_id || !paused_until) {
      return Response.json({ error: 'Missing subscription_id or paused_until' }, { status: 400 });
    }

    // Verify subscription belongs to user
    const subscription = await base44.entities.Subscription.filter({ id: subscription_id });
    if (!subscription || subscription.length === 0 || subscription[0].customer_email !== user.email) {
      return Response.json({ error: 'Subscription not found' }, { status: 404 });
    }

    // Update subscription status
    await base44.entities.Subscription.update(subscription_id, {
      status: 'paused',
      paused_until: paused_until,
    });

    return Response.json({
      success: true,
      message: `Subscription paused until ${paused_until}`,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});