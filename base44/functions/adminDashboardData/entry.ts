import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin-only function to fetch dashboard data bypassing RLS
 * Uses service role to access restricted entities
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { type, limit = 50, skip = 0, filter = {} } = await req.json();

    let data;

    switch (type) {
      case 'shopifyProducts':
        data = await base44.asServiceRole.entities.ShopifyProduct.filter(filter, '-synced_at', limit, skip);
        break;
      case 'shopifyOrders':
        data = await base44.asServiceRole.entities.ShopifyOrder.filter(filter, '-shopify_synced_at', limit, skip);
        break;
      case 'shopifyWebhookLogs':
        data = await base44.asServiceRole.entities.ShopifyWebhookLog.filter(filter, '-created_date', limit, skip);
        break;
      case 'shopifySyncLogs':
        data = await base44.asServiceRole.entities.ShopifySyncLog.filter(filter, '-created_at', limit, skip);
        break;
      case 'subscriptions':
        data = await base44.asServiceRole.entities.Subscription.filter(filter, '-created_date', limit, skip);
        break;
      default:
        return Response.json({ error: 'Invalid type' }, { status: 400 });
    }

    return Response.json({ data });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});