import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Push a fulfillment event back to Shopify when Base44 marks an order as fulfilled.
 * Payload: { shopify_order_id: string, tracking_number?: string, tracking_company?: string }
 */

Deno.serve(async (req) => {
  if (Deno.env.get('ENABLE_SHOPIFY_FULFILLMENT_PUSH') !== 'true') {
    return Response.json({
      success: true,
      skipped: true,
      reason: 'shopify_fulfillment_push_disabled',
      message: 'Shopify fulfillment push is disabled for May 30 launch freeze.',
    });
  }

  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Admin only' }, { status: 403 });
  }

  const SHOPIFY_API_TOKEN = Deno.env.get('SHOPIFY_API_TOKEN');
  const SHOPIFY_STORE_URL = Deno.env.get('SHOPIFY_STORE_URL');

  if (!SHOPIFY_API_TOKEN || !SHOPIFY_STORE_URL) {
    return Response.json({ error: 'Shopify credentials not configured' }, { status: 500 });
  }

  const { shopify_order_id, tracking_number, tracking_company } = await req.json();
  if (!shopify_order_id) {
    return Response.json({ error: 'shopify_order_id required' }, { status: 400 });
  }

  // Get fulfillment order IDs from Shopify
  const foRes = await fetch(
    `https://${SHOPIFY_STORE_URL}/admin/api/2024-01/orders/${shopify_order_id}/fulfillment_orders.json`,
    { headers: { 'X-Shopify-Access-Token': SHOPIFY_API_TOKEN } }
  );
  if (!foRes.ok) {
    const txt = await foRes.text();
    console.error('Get FO error:', foRes.status, txt);
    return Response.json({ error: 'Failed to get fulfillment orders', details: txt }, { status: 502 });
  }

  const { fulfillment_orders = [] } = await foRes.json();
  const openFO = fulfillment_orders.filter(fo => fo.status === 'open' || fo.status === 'in_progress');

  if (openFO.length === 0) {
    return Response.json({ ok: false, message: 'No open fulfillment orders found — may already be fulfilled' });
  }

  // Create fulfillment
  const fulfillmentBody = {
    fulfillment: {
      line_items_by_fulfillment_order: openFO.map(fo => ({
        fulfillment_order_id: fo.id,
      })),
      ...(tracking_number ? { tracking_info: { number: tracking_number, company: tracking_company || '' } } : {}),
      notify_customer: true,
    }
  };

  const fulfillRes = await fetch(
    `https://${SHOPIFY_STORE_URL}/admin/api/2024-01/fulfillments.json`,
    {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': SHOPIFY_API_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(fulfillmentBody),
    }
  );

  if (!fulfillRes.ok) {
    const txt = await fulfillRes.text();
    console.error('Fulfillment create error:', fulfillRes.status, txt);
    return Response.json({ error: 'Failed to create fulfillment in Shopify', details: txt }, { status: 502 });
  }

  const result = await fulfillRes.json();
  console.log(`Shopify fulfillment created for order ${shopify_order_id}`);
  return Response.json({ ok: true, fulfillment: result.fulfillment });
});
