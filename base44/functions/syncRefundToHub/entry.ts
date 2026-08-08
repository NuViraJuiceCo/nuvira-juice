import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function bearerToken(req: Request): string {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function hasInternalSyncAuth(req: Request): boolean {
  const allowed = [
    Deno.env.get('CUSTOMER_APP_SYNC_SECRET'),
    Deno.env.get('HUB_SYNC_SECRET'),
  ].filter(Boolean);
  const candidates = [
    bearerToken(req),
    req.headers.get('x-internal-secret') || '',
  ].filter(Boolean);

  return candidates.some((candidate) => allowed.includes(candidate));
}

async function requireAdminOrInternalAuth(base44: any, req: Request) {
  if (hasInternalSyncAuth(req)) {
    return { ok: true };
  }

  const user = await base44.auth.me().catch(() => null);
  if (!user?.email) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  if (user.role !== 'admin') {
    return { ok: false, status: 403, error: 'forbidden' };
  }

  return { ok: true };
}

/**
 * Shared helper to sync a refund event to Hub.
 * Used by both charge.refunded webhook and manual repair.
 * 
 * This ensures both paths use identical endpoint, auth, and error handling.
 */
Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const auth = await requireAdminOrInternalAuth(base44, req);
    if (!auth.ok) {
      return Response.json({ error: auth.error }, { status: auth.status });
    }

    const { order_id, stripe_session, triggered_by } = await req.json();

    if (!order_id) {
      return Response.json({ error: 'order_id required' }, { status: 400 });
    }

    // Fetch the order
    const orders = await base44.asServiceRole.entities.Order.filter({ id: order_id });
    if (orders.length === 0) {
      return Response.json({ error: `Order not found: ${order_id}` }, { status: 404 });
    }

    const order = orders[0];
    const orderNumber = order.order_number;

    console.log(`[syncRefundToHub] Starting refund sync for ${orderNumber} (${triggered_by})`);
    console.log(`[syncRefundToHub] Order state: status=${order.status}, payment_status=${order.payment_status}`);
    const refundReference = order.stripe_refund_id || order.refund_event_id || order.refund_id || stripe_session?.id || null;
    const isFullRefund = order.refund_type === 'full' ||
      order.refund_status === 'fully_refunded' ||
      (order.refund_type == null && order.refund_status == null && order.is_partial_refund !== true);
    console.log(`[syncRefundToHub] Refund details: amount=$${order.refund_amount}, reference_present=${Boolean(refundReference)}, full=${isFullRefund}`);

    // Delegate to syncOrderToHub with refund event
    const syncInvokeResult = await base44.asServiceRole.functions.invoke('syncOrderToHub', {
      order_id: order.id,
      stripe_session: {
        payment_status: 'refunded',
        id: refundReference || 'manual_refund',
        refund_amount: order.refund_amount,
        is_full_refund: isFullRefund,
      },
      triggered_by: triggered_by || 'refund_sync_helper',
    });
    const syncResult = syncInvokeResult?.data || syncInvokeResult || {};

    console.log(`[syncRefundToHub] Sync result status: ${syncResult?.success ? 'success' : 'failed'}`);
    console.log(`[syncRefundToHub] Hub action: ${syncResult?.hub_action}`);
    console.log(`[syncRefundToHub] Hub response:`, JSON.stringify(syncResult?.hub_response).substring(0, 300));

    // Check for auth or endpoint errors
    if (syncResult?.error) {
      const err = syncResult.error;
      const is403 = err.includes('403') || err.includes('Forbidden');
      const is405 = err.includes('405') || err.includes('Method Not Allowed');
      const isAuth = err.includes('Bearer') || err.includes('Authorization');

      if (is403 || is405) {
        console.error(`[syncRefundToHub] ❌ ENDPOINT ERROR: ${err}`);
        console.error(`[syncRefundToHub] This indicates Hub endpoint mismatch:`);
        console.error(`  - Check HUB_API_URL and endpoint path`);
        console.error(`  - Check receiveCustomerAppEvent accepts order.refunded`);
        console.error(`  - Check HTTP method is POST`);
        console.error(`  - Check Authorization: Bearer token matches CUSTOMER_APP_SYNC_SECRET`);
      }
      if (isAuth) {
        console.error(`[syncRefundToHub] ❌ AUTH ERROR: ${err}`);
        console.error(`  - Check CUSTOMER_APP_SYNC_SECRET is set`);
        console.error(`  - Check Hub validates the same secret`);
      }
    }

    return Response.json({
      success: syncResult?.success || false,
      order_number: orderNumber,
      hub_action: syncResult?.hub_action,
      hub_response: syncResult?.hub_response,
      error: syncResult?.error,
    });

  } catch (error) {
    console.error('[syncRefundToHub] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
