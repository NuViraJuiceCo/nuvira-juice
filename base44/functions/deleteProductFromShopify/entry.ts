import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Automation-triggered function: archives (deletes) a Base44 Product from Shopify on delete.
 * Payload comes from entity automation (delete on Product entity).
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const SHOPIFY_API_TOKEN = Deno.env.get('SHOPIFY_API_TOKEN');
  const SHOPIFY_STORE_URL = Deno.env.get('SHOPIFY_STORE_URL');

  if (!SHOPIFY_API_TOKEN || !SHOPIFY_STORE_URL) {
    console.error('Missing Shopify credentials');
    return Response.json({ error: 'Shopify credentials not configured' }, { status: 500 });
  }

  const body = await req.json();
  const { event, data } = body;

  console.log('deleteProductFromShopify triggered:', event?.type, 'product id:', event?.entity_id);

  // On delete, data may be null — we use old_data if available, or look up by shopify_product_id from data
  const product = data;
  const shopifyProductId = product?.shopify_product_id;

  if (!shopifyProductId) {
    console.log('No shopify_product_id on deleted product — nothing to remove from Shopify');
    return Response.json({ ok: true, message: 'No Shopify product linked, skipping' });
  }

  const storeHost = SHOPIFY_STORE_URL.replace(/^https?:\/\//, '');

  // Delete the product from Shopify
  const shopifyRes = await fetch(
    `https://${storeHost}/admin/api/2024-01/products/${shopifyProductId}.json`,
    {
      method: 'DELETE',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_API_TOKEN,
      },
    }
  );

  if (!shopifyRes.ok && shopifyRes.status !== 404) {
    const errText = await shopifyRes.text();
    console.error('Shopify delete error:', shopifyRes.status, errText);
    return Response.json({ error: `Shopify API ${shopifyRes.status}`, details: errText }, { status: 502 });
  }

  if (shopifyRes.status === 404) {
    console.log('Product not found in Shopify (already deleted?):', shopifyProductId);
  } else {
    console.log('Successfully deleted Shopify product:', shopifyProductId);
  }

  return Response.json({ ok: true, deleted_shopify_id: shopifyProductId });
});