import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin-triggered product sync from Shopify to Base44.
 */

Deno.serve(async (req) => {
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

  const shopifyRes = await fetch(
    `https://${SHOPIFY_STORE_URL}/admin/api/2024-01/products.json?limit=250&status=any`,
    { headers: { 'X-Shopify-Access-Token': SHOPIFY_API_TOKEN, 'Content-Type': 'application/json' } }
  );

  if (!shopifyRes.ok) {
    const errText = await shopifyRes.text();
    console.error('Shopify API error:', shopifyRes.status, errText);
    return Response.json({ error: `Shopify API ${shopifyRes.status}`, details: errText }, { status: 502 });
  }

  const { products = [] } = await shopifyRes.json();
  let synced = 0;

  for (const product of products) {
    const shopifyProductId = String(product.id);
    const existing = await base44.asServiceRole.entities.ShopifyProduct.filter({ shopify_product_id: shopifyProductId });
    const record = {
      shopify_product_id: shopifyProductId,
      title: product.title,
      handle: product.handle,
      product_type: product.product_type || '',
      status: product.status || 'active',
      vendor: product.vendor || '',
      tags: (product.tags || '').split(',').map(t => t.trim()).filter(Boolean),
      image_url: product.image?.src || product.images?.[0]?.src || '',
      variants: (product.variants || []).map(v => ({
        shopify_variant_id: String(v.id),
        title: v.title, sku: v.sku || '',
        price: parseFloat(v.price || 0),
        compare_at_price: parseFloat(v.compare_at_price || 0),
        inventory_quantity: v.inventory_quantity || 0,
        inventory_policy: v.inventory_policy || 'deny',
      })),
      synced_at: new Date().toISOString(),
    };
    if (existing.length > 0) {
      await base44.asServiceRole.entities.ShopifyProduct.update(existing[0].id, record);
    } else {
      await base44.asServiceRole.entities.ShopifyProduct.create(record);
    }
    synced++;
  }

  await base44.asServiceRole.entities.ShopifySyncLog.create({
    sync_type: 'products', status: 'success',
    records_synced: synced, records_failed: 0,
    started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    triggered_by: 'manual',
  });

  return Response.json({ ok: true, synced });
});