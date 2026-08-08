import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

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

    if (!HUB_API_URL) {
      console.log('syncShopifyOrderToHub: HUB_API_URL not set, skipping');
      return Response.json({ success: true, skipped: true });
    }

    console.log(`Syncing Shopify order ${shopifyOrder.shopify_order_number || shopifyOrder.id} to hub`);

    const response = await fetch(HUB_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify({ event: 'shopify_order.created', source: 'customer_app', order: shopifyOrder }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Hub sync failed (${response.status}):`, errorText);
      return Response.json({ error: `Hub returned ${response.status}`, details: errorText }, { status: response.status });
    }

    const result = await response.json();
    console.log(`Shopify order synced to hub successfully:`, result);
    return Response.json({ success: true, hub_response: result });
  } catch (error) {
    console.error('syncShopifyOrderToHub error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
};
