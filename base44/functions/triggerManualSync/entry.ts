import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Manual sync trigger endpoint for admin actions.
 * Allows admins to manually trigger specific sync operations on-demand.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { sync_type } = await req.json();

    if (!sync_type || !['products', 'loyalty', 'orders', 'status'].includes(sync_type)) {
      return Response.json({ error: 'Invalid sync_type. Must be: products, loyalty, orders, or status' }, { status: 400 });
    }

    console.log(`[MANUAL SYNC] Admin triggered manual ${sync_type} sync`);

    // Invoke the appropriate sync function
    const functionMap = {
      products: 'syncProductsToHub',
      loyalty: 'syncLoyaltyToHub',
      orders: 'receiveOrderFromCustomerApp',
      status: 'pollOrderStatusUpdates',
    };

    const result = await base44.asServiceRole.functions.invoke(functionMap[sync_type], {});

    console.log(`[MANUAL SYNC] ${sync_type} sync completed:`, result);

    return Response.json({ success: true, sync_type, result });
  } catch (error) {
    console.error('[MANUAL SYNC] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});