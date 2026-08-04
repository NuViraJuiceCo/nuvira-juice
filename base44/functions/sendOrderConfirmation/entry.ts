import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const caller = await base44.auth.me().catch(() => null);
  if (!caller) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return Response.json({ error: 'Admin access required' }, { status: 403 });
  }

  return Response.json({
    deprecated: true,
    mutated: false,
    replacement: 'Stripe webhook -> sendOrderReceivedNotification + sendOrderSms',
    message: 'sendOrderConfirmation is disabled. Order confirmations are owned by the Customer App Stripe webhook confirmation path.',
  }, { status: 410 });
});
