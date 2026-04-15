import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin-only: pushes ALL Base44 products to Shopify.
 * Creates new ones, updates existing ones (if shopify_product_id is set).
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

  const storeHost = SHOPIFY_STORE_URL.replace(/^https?:\/\//, '');
  const products = await base44.asServiceRole.entities.Product.list();

  let synced = 0;
  let failed = 0;
  const errors = [];

  for (const product of products) {
    const shopifyPayload = {
      product: {
        title: product.title,
        body_html: product.description || product.short_description || '',
        product_type: product.category || '',
        status: product.is_available !== false ? 'active' : 'draft',
        tags: (product.tags || []).join(', '),
        variants: [{
          price: String(product.price || 0),
          compare_at_price: product.compare_at_price ? String(product.compare_at_price) : null,
          sku: product.id,
          requires_shipping: false,
          taxable: true,
          inventory_management: null,
        }],
        images: [
          ...(product.image_url ? [{ src: product.image_url }] : []),
          ...(product.secondary_images || []).map(url => ({ src: url })),
        ],
      }
    };

    const shopifyProductId = product.shopify_product_id;
    let shopifyRes;

    if (shopifyProductId) {
      shopifyRes = await fetch(
        `https://${storeHost}/admin/api/2024-01/products/${shopifyProductId}.json`,
        { method: 'PUT', headers: { 'X-Shopify-Access-Token': SHOPIFY_API_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(shopifyPayload) }
      );
    } else {
      shopifyRes = await fetch(
        `https://${storeHost}/admin/api/2024-01/products.json`,
        { method: 'POST', headers: { 'X-Shopify-Access-Token': SHOPIFY_API_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(shopifyPayload) }
      );
    }

    if (!shopifyRes.ok) {
      const err = await shopifyRes.text();
      console.error(`Failed to sync "${product.title}":`, err);
      errors.push({ title: product.title, error: err });
      failed++;
      continue;
    }

    const shopifyData = await shopifyRes.json();
    const createdId = shopifyData.product?.id;

    // Save shopify_product_id back if it was a new product
    if (!shopifyProductId && createdId) {
      await base44.asServiceRole.entities.Product.update(product.id, {
        shopify_product_id: String(createdId),
      });
    }

    console.log(`Synced: ${product.title} → Shopify ID ${createdId}`);
    synced++;
  }

  return Response.json({ ok: true, total: products.length, synced, failed, errors });
});