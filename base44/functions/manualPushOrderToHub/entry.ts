import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * DEPRECATED: legacy manual Hub push.
 *
 * This function used to post directly to the legacy Hub ingestCustomerAppOrder
 * endpoint. Manual recovery must now use recoverStuckOrder, which routes
 * through syncOrderToHub and the hardened Hub safeSyncOrderUpdate path.
 *
 * Kept in place temporarily so existing admin UI/hooks receive a clear
 * non-mutating redirect response instead of silently failing.
 */
Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const orderNumber = typeof body.order_number === 'string'
      ? body.order_number.trim().replace(/^#/, '').toUpperCase().slice(0, 80)
      : null;

    console.log('[manualPushOrderToHub] Deprecated function called; no Hub mutation performed. Use recoverStuckOrder.');

    return Response.json({
      success: false,
      deprecated: true,
      replacement: 'recoverStuckOrder',
      mutated: false,
      order_number: orderNumber,
      live_lookup_performed: false,
      message: 'manualPushOrderToHub is deprecated. Use recoverStuckOrder for approved one-order recovery.',
    }, { status: 410 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown');
    console.error('[ManualPush] Error:', message);
    return Response.json({ error: 'manual_push_deprecated' }, { status: 410 });
  }
});
