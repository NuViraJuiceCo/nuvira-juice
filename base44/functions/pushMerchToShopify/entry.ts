import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Automation-triggered function: pushes a Base44 Merch item to Shopify.
 * Triggered on create/update of the Merch entity.
 */

Deno.serve(async (req) => {
  if (Deno.env.get('ENABLE_MERCH_SHOPIFY_AUTOMATION') !== 'true') {
    return Response.json({
      success: true,
      skipped: true,
      reason: 'merch_shopify_automation_disabled',
      message: 'Merch Shopify automation is disabled by the current integration safety gate.',
    });
  }

  const base44 = createClientFromRequest(req);

  const SHOPIFY_API_TOKEN = Deno.env.get('SHOPIFY_API_TOKEN');
  const SHOPIFY_STORE_URL = Deno.env.get('SHOPIFY_STORE_URL');

  if (!SHOPIFY_API_TOKEN || !SHOPIFY_STORE_URL) {
    console.error('Missing Shopify credentials');
    return Response.json({ error: 'Shopify credentials not configured' }, { status: 500 });
  }

  const body = await req.json();
  const { event, data } = body;

  console.log('pushMerchToShopify triggered:', event?.type, 'merch id:', event?.entity_id);

  if (!data) {
    console.error('No merch data in payload');
    return Response.json({ error: 'No merch data' }, { status: 400 });
  }

  const item = data;
  const storeHost = SHOPIFY_STORE_URL.replace(/^https?:\/\//, '');

  // Build variants from sizes, or a single default variant
  const variants = item.sizes && item.sizes.length > 0
    ? item.sizes.map(size => ({ title: size, price: String(item.price || 0) }))
    : [{ title: 'Default', price: String(item.price || 0) }];

  const shopifyPayload = {
    product: {
      title: item.name,
      body_html: item.description || '',
      vendor: 'NuVira',
      product_type: 'Merch',
      status: item.is_available ? 'active' : 'draft',
      variants,
      images: item.image_url ? [{ src: item.image_url }] : [],
    }
  };

  let shopifyRes;
  const shopifyProductId = item.shopify_product_id;

  if (shopifyProductId) {
    console.log('Updating existing Shopify merch product:', shopifyProductId);
    shopifyRes = await fetch(
      `https://${storeHost}/admin/api/2024-01/products/${shopifyProductId}.json`,
      {
        method: 'PUT',
        headers: { 'X-Shopify-Access-Token': SHOPIFY_API_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify(shopifyPayload),
      }
    );
  } else {
    console.log('Creating new Shopify merch product:', item.name);
    shopifyRes = await fetch(
      `https://${storeHost}/admin/api/2024-01/products.json`,
      {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': SHOPIFY_API_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify(shopifyPayload),
      }
    );
  }

  if (!shopifyRes.ok) {
    const errText = await shopifyRes.text();
    console.error('Shopify API error:', shopifyRes.status, errText);
    return Response.json({ error: `Shopify API ${shopifyRes.status}`, details: errText }, { status: 502 });
  }

  const shopifyData = await shopifyRes.json();
  const createdProduct = shopifyData.product;

  // Save shopify_product_id back to Base44 on first create
  if (!shopifyProductId && createdProduct?.id) {
    await base44.asServiceRole.entities.Merch.update(item.id, {
      shopify_product_id: String(createdProduct.id),
    });
    console.log('Saved shopify_product_id back to Base44 merch:', createdProduct.id);
  }

  console.log('Successfully synced merch to Shopify:', createdProduct?.id);
  return Response.json({ ok: true, shopify_product_id: createdProduct?.id });
});
