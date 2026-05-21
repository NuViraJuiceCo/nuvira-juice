import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DISABLED_MESSAGE = 'Hub subscription pull/rebuild tools are disabled. Subscription fulfillment must originate from Stripe webhook and approved subscription sync paths.';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    return Response.json({
      deprecated: true,
      mutated: false,
      replacement: 'stripeWebhook + syncSubscriptionWithFulfillments',
      message: DISABLED_MESSAGE,
    }, { status: 410 });
  } catch (error) {
    console.error('[syncAllSubscriptionsFromHub] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
