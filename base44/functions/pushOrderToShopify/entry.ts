import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Called after a successful Stripe checkout to push the order into Shopify
 * so Shopify and Base44 stay in sync for app-originated purchases.
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();

  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const SHOPIFY_API_TOKEN = Deno.env.get('SHOPIFY_API_TOKEN');
  const SHOPIFY_STORE_URL = Deno.env.get('SHOPIFY_STORE_URL');

  if (!SHOPIFY_API_TOKEN || !SHOPIFY_STORE_URL) {
    console.error('Missing Shopify credentials');
    return Response.json({ error: 'Shopify credentials not configured' }, { status: 500 });
  }

  const { order_id } = await req.json();

  if (!order_id) {
    return Response.json({ error: 'Missing order_id' }, { status: 400 });
  }

  // Fetch the order from Base44
  const orders = await base44.asServiceRole.entities.Order.filter({ id: order_id });
  if (!orders.length) {
    return Response.json({ error: 'Order not found' }, { status: 404 });
  }
  const order = orders[0];

  const storeHost = SHOPIFY_STORE_URL.replace(/^https?:\/\//, '');

  // Build Shopify draft order payload
  const shopifyPayload = {
    draft_order: {
      line_items: order.items.map(item => ({
        title: item.title,
        price: String(item.price),
        quantity: item.quantity,
      })),
      email: order.customer_email || '',
      note: `Base44 Order #${order.order_number}`,
      shipping_address: order.delivery_address ? {
        address1: order.delivery_address,
      } : undefined,
      tags: 'base44-app',
      applied_discount: order.delivery_fee > 0 ? undefined : {
        description: 'Free Delivery',
        value_type: 'fixed_amount',
        value: '0',
        amount: '0',
      },
    }
  };

  // Add delivery fee as shipping line if applicable
  if (order.delivery_fee > 0) {
    shopifyPayload.draft_order.shipping_line = {
      title: 'Delivery',
      price: String(order.delivery_fee),
    };
  }

  const shopifyRes = await fetch(
    `https://${storeHost}/admin/api/2024-01/draft_orders.json`,
    {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': SHOPIFY_API_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(shopifyPayload),
    }
  );

  if (!shopifyRes.ok) {
    const errText = await shopifyRes.text();
    console.error('Shopify draft order error:', shopifyRes.status, errText);
    return Response.json({ error: `Shopify API ${shopifyRes.status}`, details: errText }, { status: 502 });
  }

  const shopifyData = await shopifyRes.json();
  const draftOrder = shopifyData.draft_order;

  // Mark draft order as complete (converts to a real Shopify order since payment was via Stripe)
  const completeRes = await fetch(
    `https://${storeHost}/admin/api/2024-01/draft_orders/${draftOrder.id}/complete.json?payment_pending=false`,
    {
      method: 'PUT',
      headers: { 'X-Shopify-Access-Token': SHOPIFY_API_TOKEN, 'Content-Type': 'application/json' },
    }
  );

  if (!completeRes.ok) {
    const errText = await completeRes.text();
    console.error('Shopify complete draft order error:', completeRes.status, errText);
    // Not fatal — draft order was still created
    return Response.json({ ok: true, draft_order_id: draftOrder.id, warning: 'Could not complete draft order' });
  }

  const completedData = await completeRes.json();
  const shopifyOrderId = String(completedData.draft_order?.order_id || '');

  console.log(`Pushed Base44 order ${order_id} to Shopify as order ${shopifyOrderId}`);
  return Response.json({ ok: true, shopify_order_id: shopifyOrderId });
});