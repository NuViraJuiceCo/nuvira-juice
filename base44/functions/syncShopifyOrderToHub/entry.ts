const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const { data } = await req.json();
    const shopifyOrder = data;

    if (!shopifyOrder || !shopifyOrder.id) {
      console.error('No Shopify order data in payload');
      return Response.json({ error: 'No order data' }, { status: 400 });
    }

    console.log(`Syncing Shopify order ${shopifyOrder.id} to hub`);

    const response = await fetch(HUB_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sync-secret': CUSTOMER_APP_SYNC_SECRET,
      },
      body: JSON.stringify(shopifyOrder),
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
});