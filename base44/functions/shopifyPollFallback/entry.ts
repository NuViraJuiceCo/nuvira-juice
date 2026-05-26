import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Scheduled fallback: polls Shopify for recent orders every 15 minutes
 * to catch any missed webhooks. Only syncs orders from the last 30 minutes.
 */

Deno.serve(async (req) => {
  if (Deno.env.get('ENABLE_SHOPIFY_POLL_FALLBACK') !== 'true') {
    return Response.json({
      ok: true,
      skipped: true,
      polled: 0,
      new_created: 0,
      reason: 'shopify_poll_fallback_disabled',
      message: 'Shopify poll fallback is disabled for May 30 launch freeze.',
    });
  }

  const SHOPIFY_API_TOKEN = Deno.env.get('SHOPIFY_API_TOKEN');
  const SHOPIFY_STORE_URL = Deno.env.get('SHOPIFY_STORE_URL');

  if (!SHOPIFY_API_TOKEN || !SHOPIFY_STORE_URL) {
    console.warn('Shopify credentials not set — skipping poll');
    return Response.json({ skipped: true });
  }

  const base44 = createClientFromRequest(req);

  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const storeHost = SHOPIFY_STORE_URL.replace(/^https?:\/\//, '');
  const url = `https://${storeHost}/admin/api/2024-01/orders.json?status=any&limit=50&updated_at_min=${since}`;

  let orders = [];
  const shopifyRes = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_API_TOKEN },
  });
  if (!shopifyRes.ok) {
    console.error('Shopify poll error:', shopifyRes.status);
    return Response.json({ error: 'Shopify API error', status: shopifyRes.status });
  }
  const data = await shopifyRes.json();
  orders = data.orders || [];
  console.log(`Poll found ${orders.length} recently updated orders`);

  let synced = 0;
  for (const order of orders) {
    const shopifyOrderId = String(order.id);
    const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_id: shopifyOrderId });
    if (existing.length === 0) {
      // New order missed by webhook — create it
      await base44.asServiceRole.entities.ShopifyOrder.create({
        shopify_order_id: shopifyOrderId,
        shopify_order_number: String(order.order_number || order.name || order.id),
        source_channel: detectChannel(order),
        customer_name: [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') || 'Guest',
        customer_email: order.email || order.customer?.email || '',
        customer_phone: order.phone || order.customer?.phone || '',
        line_items: (order.line_items || []).map(li => ({
          shopify_line_item_id: String(li.id),
          title: li.title, sku: li.sku || '',
          quantity: li.quantity, price: parseFloat(li.price || 0),
        })),
        fulfillment_method: order.source_name === 'pos' ? 'pos' : 'delivery',
        payment_status: order.financial_status || '',
        shopify_fulfillment_status: order.fulfillment_status || 'unfulfilled',
        financial_status: order.financial_status || '',
        total_price: parseFloat(order.total_price || 0),
        is_pos_order: order.source_name === 'pos',
        is_subscription: (order.tags || '').toLowerCase().includes('subscription'),
        shopify_synced_at: new Date().toISOString(),
        production_status: 'new',
      });
      synced++;
      console.log(`Poll-created missed order: #${order.order_number}`);
    }
  }

  // Only log when something was actually synced — avoid writing 96 empty records/day
  if (synced > 0) {
    await base44.asServiceRole.entities.ShopifySyncLog.create({
      sync_type: 'orders', status: 'success',
      records_synced: synced, records_failed: 0,
      started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
      triggered_by: 'cron',
    });
  }

  return Response.json({ ok: true, polled: orders.length, new_created: synced });
});

function detectChannel(order) {
  const tags = (order.tags || '').toLowerCase();
  const src = (order.source_name || '').toLowerCase();
  if (src === 'pos') return 'pos';
  if (tags.includes('subscription')) return 'subscription';
  if (tags.includes('wholesale')) return 'wholesale';
  if (tags.includes('event')) return 'event';
  if (src === 'draft_order') return 'draft';
  if (src === 'admin') return 'admin';
  return 'online';
}
