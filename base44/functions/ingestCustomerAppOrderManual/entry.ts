import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * DEPRECATED: legacy manual Customer App order ingest test.
 *
 * This function used to post directly to the legacy Hub ingestCustomerAppOrder
 * endpoint. Manual recovery must now use recoverStuckOrder, which routes
 * through syncOrderToHub and the hardened Hub safeSyncOrderUpdate path.
 *
 * Kept in place temporarily so any old admin/test hooks receive a clear
 * non-mutating redirect response instead of silently failing.
 */
async function readJsonBody(req) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return { ok: true, body: {} };
  }

  const raw = await req.text();
  if (!raw.trim()) {
    return { ok: true, body: {} };
  }

  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, body: null };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const parsedBody = await readJsonBody(req);
    if (!parsedBody.ok) {
      return Response.json({ success: false, error: 'malformed_json', error_code: 'malformed_json' }, { status: 400 });
    }
    const body = parsedBody.body && typeof parsedBody.body === 'object' && !Array.isArray(parsedBody.body) ? parsedBody.body : {};
    const { order_number } = body;
    let orderSummary = null;

    if (order_number) {
      const orders = await base44.asServiceRole.entities.Order.filter({ order_number });
      const order = orders?.[0] || null;
      if (order) {
        orderSummary = {
          id: order.id,
          order_number: order.order_number,
          customer_email: order.customer_email || null,
          status: order.status || null,
          payment_status: order.payment_status || null,
          payment_captured: order.payment_captured === true,
        };
      }
    }

    console.log('[ingestCustomerAppOrderManual] Deprecated function called; no Hub mutation performed. Use recoverStuckOrder.');

    return Response.json({
      success: false,
      deprecated: true,
      replacement: 'recoverStuckOrder',
      mutated: false,
      order_number,
      order_found: !!orderSummary,
      order: orderSummary,
      message: 'ingestCustomerAppOrderManual is disabled. Use recoverStuckOrder for approved one-order recovery.',
    }, { status: 410 });
  } catch (error) {
    console.error('[IngestTest] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
