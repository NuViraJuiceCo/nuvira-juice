import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Automation-triggered function: pushes a Base44 Product to Shopify.
 * Payload comes from entity automation (create/update on Product entity).
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

  console.log('pushProductToShopify triggered:', event?.type, 'product id:', event?.entity_id);

  if (!data) {
    console.error('No product data in payload');
    return Response.json({ error: 'No product data' }, { status: 400 });
  }

  const product = data;

  // Build SEO-friendly meta title and description from Base44 data
  const metaTitle = product.title + (product.size ? ` ${product.size}` : '') + ' | NuVira Juice';
  const metaDescription = product.short_description || product.description?.substring(0, 160) || `${product.title} — fresh cold-pressed juice from NuVira.`;

  // Build Shopify product payload
  const shopifyPayload = {
    product: {
      title: product.title,
      body_html: product.description || product.short_description || '',
      product_type: product.category || '',
      status: product.is_available !== false ? 'active' : 'draft',
      tags: (product.tags || []).join(', '),
      metafields_global_title_tag: metaTitle,
      metafields_global_description_tag: metaDescription,
      variants: [
        {
          price: String(product.price || 0),
          compare_at_price: product.compare_at_price ? String(product.compare_at_price) : null,
          sku: product.id,
          requires_shipping: false,
          taxable: true,
          inventory_management: null,
        }
      ],
      images: [
        ...(product.image_url ? [{ src: product.image_url }] : []),
        ...(product.secondary_images || []).map(url => ({ src: url })),
      ],
    }
  };

  // Check if this product already has a linked Shopify product
  const shopifyProductId = product.shopify_product_id;

  let shopifyRes;

  const storeHost = SHOPIFY_STORE_URL.replace(/^https?:\/\//, '');

  if (shopifyProductId) {
    // Update existing Shopify product
    console.log('Updating existing Shopify product:', shopifyProductId);
    shopifyRes = await fetch(
      `https://${storeHost}/admin/api/2024-01/products/${shopifyProductId}.json`,
      {
        method: 'PUT',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_API_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(shopifyPayload),
      }
    );
  } else {
    // Create new Shopify product
    console.log('Creating new Shopify product:', product.title);
    shopifyRes = await fetch(
      `https://${storeHost}/admin/api/2024-01/products.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_API_TOKEN,
          'Content-Type': 'application/json',
        },
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

  // If it was a new product, save the Shopify product ID back to Base44
  if (!shopifyProductId && createdProduct?.id) {
    await base44.asServiceRole.entities.Product.update(product.id, {
      shopify_product_id: String(createdProduct.id),
    });
    console.log('Saved shopify_product_id back to Base44 product:', createdProduct.id);
  }

  console.log('Successfully synced product to Shopify:', createdProduct?.id);
  return Response.json({ ok: true, shopify_product_id: createdProduct?.id });
});