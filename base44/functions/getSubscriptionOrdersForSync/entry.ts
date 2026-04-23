import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin endpoint: fetch ALL subscriptions for hub sync (no date filter).
 * Returns paginated results to avoid timeout on large datasets.
 */
Deno.serve(async (req) => {
  try {
    // Validate hub secret token
    const authHeader = req.headers.get('authorization');
    const hubSecret = Deno.env.get('HUB_SYNC_SECRET');
    if (authHeader !== `Bearer ${hubSecret}`) {
      return Response.json({ error: 'Invalid or missing authorization' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const { limit = 100, offset = 0 } = await req.json();

    // Fetch subscriptions with pagination (service role)
    const allSubscriptions = await base44.asServiceRole.entities.Subscription.list('-updated_date', 999999);
    const paginatedSubscriptions = allSubscriptions.slice(offset, offset + limit);

    const subscriptionsForSync = paginatedSubscriptions.map(s => ({
      id: s.id,
      customer_email: s.customer_email,
      plan_id: s.plan_id,
      bundle_id: s.bundle_id,
      custom_composition: s.custom_composition,
      delivery_zone_id: s.delivery_zone_id,
      delivery_address: s.delivery_address,
      status: s.status,
      next_delivery_date: s.next_delivery_date,
      started_date: s.started_date,
      paused_until: s.paused_until,
      created_date: s.created_date,
      updated_date: s.updated_date,
    }));

    console.log(`Returning ${paginatedSubscriptions.length} subscriptions (offset: ${offset}, limit: ${limit})`);

    return Response.json({
      success: true,
      total: allSubscriptions.length,
      offset,
      limit,
      count: paginatedSubscriptions.length,
      subscriptions: subscriptionsForSync,
    });
  } catch (error) {
    console.error('Get subscription orders for sync error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});