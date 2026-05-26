import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin-triggered manual resync of recent Shopify orders.
 * Payload: { limit?: number, order_id?: string }
 */

Deno.serve(async (req) => {
  if (Deno.env.get('ENABLE_ADMIN_SHOPIFY_RESYNC') !== 'true') {
    return Response.json({
      success: true,
      skipped: true,
      reason: 'admin_shopify_resync_disabled',
      message: 'Admin Shopify order resync is disabled for May 30 launch freeze.',
    }, { status: 409 });
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

  const body = await req.json().catch(() => ({}));
  const { limit = 50, order_id } = body;

  let url = `https://${SHOPIFY_STORE_URL}/admin/api/2024-01/orders.json?status=any&limit=${limit}`;
  if (order_id) {
    url = `https://${SHOPIFY_STORE_URL}/admin/api/2024-01/orders/${order_id}.json`;
  }

  console.log(`Manual resync from: ${url}`);

  const shopifyRes = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_API_TOKEN,
      'Content-Type': 'application/json',
    },
  });

  if (!shopifyRes.ok) {
    const errText = await shopifyRes.text();
    console.error('Shopify API error:', shopifyRes.status, errText);
    return Response.json({ error: `Shopify API returned ${shopifyRes.status}`, details: errText }, { status: 502 });
  }

  const data = await shopifyRes.json();
  const orders = order_id ? [data.order].filter(Boolean) : (data.orders || []);

  let synced = 0;
  let failed = 0;
  const results = [];

  for (const order of orders) {
    const shopifyOrderId = String(order.id);
    const orderNumber = String(order.order_number || order.name || order.id);
    const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_id: shopifyOrderId });

    const record = mapOrder(order);

    if (existing.length > 0) {
      await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, record);
      results.push({ order: orderNumber, action: 'updated' });
    } else {
      await base44.asServiceRole.entities.ShopifyOrder.create(record);
      results.push({ order: orderNumber, action: 'created' });
    }
    synced++;
  }

  await base44.asServiceRole.entities.ShopifySyncLog.create({
    sync_type: 'orders', status: failed > 0 ? 'partial' : 'success',
    records_synced: synced, records_failed: failed,
    started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    triggered_by: 'manual',
  });

  return Response.json({ ok: true, synced, failed, results });
});

function mapOrder(order) {
  const channel = detectChannel(order);
  return {
    shopify_order_id: String(order.id),
    shopify_order_number: String(order.order_number || order.name || order.id),
    source_channel: channel,
    customer_name: [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') || 'Guest',
    customer_email: order.email || order.customer?.email || '',
    customer_phone: order.phone || order.customer?.phone || '',
    line_items: (order.line_items || []).map(li => ({
      shopify_line_item_id: String(li.id),
      title: li.title, variant_title: li.variant_title || '',
      sku: li.sku || '', quantity: li.quantity,
      price: parseFloat(li.price || 0), total_discount: parseFloat(li.total_discount || 0),
    })),
    fulfillment_method: order.source_name === 'pos' ? 'pos' : 'delivery',
    delivery_address: extractAddress(order),
    payment_status: order.financial_status || '',
    shopify_fulfillment_status: order.fulfillment_status || 'unfulfilled',
    financial_status: order.financial_status || '',
    subtotal: parseFloat(order.subtotal_price || 0),
    total_tax: parseFloat(order.total_tax || 0),
    total_discounts: parseFloat(order.total_discounts || 0),
    tip_received: parseFloat(order.total_tip_received || 0),
    total_price: parseFloat(order.total_price || 0),
    discount_codes: (order.discount_codes || []).map(d => d.code),
    customer_notes: order.note || '',
    tags: (order.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    is_pos_order: order.source_name === 'pos',
    is_subscription: (order.tags || '').toLowerCase().includes('subscription'),
    shopify_synced_at: new Date().toISOString(),
  };
}

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

function extractAddress(order) {
  const addr = order.shipping_address || order.billing_address;
  if (!addr) return '';
  return [addr.address1, addr.city, addr.province_code, addr.zip].filter(Boolean).join(', ');
}
