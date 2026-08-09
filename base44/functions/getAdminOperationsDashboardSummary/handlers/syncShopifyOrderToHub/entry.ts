import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function bearerToken(req) {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function hasInternalSyncAuth(req) {
  const token = bearerToken(req);
  const allowed = [
    Deno.env.get('CUSTOMER_APP_SYNC_SECRET'),
    Deno.env.get('HUB_SYNC_SECRET'),
  ].filter(Boolean);
  return Boolean(token && allowed.includes(token));
}

export default async (req: Request) => {
  try {
    const base44 = createClientFromRequest(req);
    const internalAuth = hasInternalSyncAuth(req);
    const user = internalAuth ? null : await base44.auth.me().catch(() => null);
    if (!internalAuth && user?.role !== 'admin') {
      return Response.json({ error: user ? 'forbidden' : 'unauthorized' }, { status: user ? 403 : 401 });
    }

    const body = await req.json();
    // Support both entity automation payload (body.data) and direct call
    const shopifyOrder = body.data || body;

    if (!shopifyOrder || !shopifyOrder.id) {
      console.error('No Shopify order data in payload');
      return Response.json({ error: 'No order data' }, { status: 400 });
    }

    return Response.json({
      success: true,
      skipped: true,
      retired: true,
      source: 'customer_app_native_authoritative',
      shopify_order_id: shopifyOrder.id,
      hub_response: null,
      hub_operational_dependency: false,
      external_calls_performed: false,
    });
  } catch (error) {
    console.error('syncShopifyOrderToHub error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
};
