import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * generateSubscriptionOrders is disabled as a live mutation path.
 * Subscription fulfillment must originate from Stripe webhook and approved
 * subscription sync paths.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    if (!user) {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.log('[generateSubscriptionOrders] Disabled subscription order generator requested');
    return Response.json({
      deprecated: true,
      mutated: false,
      replacement: 'stripeWebhook + syncSubscriptionWithFulfillments',
      message: 'generateSubscriptionOrders is disabled. Subscription fulfillment must originate from Stripe webhook and approved subscription sync paths.',
    }, { status: 410 });
  } catch (error) {
    console.error('Generate subscription orders error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
