import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Deprecated manual Hub status sync endpoint.
 *
 * Controlled Hub-to-Customer-App status readback is syncHubDeliveryStatuses.
 * This function is intentionally retained as a disabled redirect so legacy
 * operator tools fail closed instead of mutating Customer App Orders.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user?.role !== 'admin') {
      console.warn('⚠️ AUDIT: Non-admin attempted to run manualSyncOrders');
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.warn('⚠️ AUDIT: Admin invoked disabled manualSyncOrders — no mutation performed');
    return Response.json({
      error: 'DEPRECATED_FUNCTION_DISABLED',
      message: 'manualSyncOrders is disabled. Use syncHubDeliveryStatuses for controlled Hub status readback.',
      deprecated: true,
      mutated: false,
      replacement: 'syncHubDeliveryStatuses',
    }, { status: 410 });
  } catch (error) {
    console.error('manualSyncOrders error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
