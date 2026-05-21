import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Deprecated legacy Hub order sync endpoint.
 *
 * Controlled Hub-to-Customer-App status readback is syncHubDeliveryStatuses.
 * This function is retained as a disabled redirect so legacy operator tools
 * fail closed instead of creating or updating Customer App Orders.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.warn('⚠️ AUDIT: Admin invoked disabled syncOrdersFromHub — no mutation performed');
    return Response.json({
      error: 'DEPRECATED_FUNCTION_DISABLED',
      message: 'syncOrdersFromHub is disabled. Use syncHubDeliveryStatuses for controlled Hub status readback.',
      deprecated: true,
      mutated: false,
      replacement: 'syncHubDeliveryStatuses',
    }, { status: 410 });
  } catch (error) {
    console.error('Sync orders from hub error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
