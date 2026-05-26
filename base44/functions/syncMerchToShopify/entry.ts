import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_MERCH_SHOPIFY_BULK_SYNC') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'merch_shopify_bulk_sync_disabled',
        message: 'Merch Shopify bulk sync is disabled for May 30 launch freeze.',
      });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawStoreUrl = Deno.env.get('SHOPIFY_STORE_URL');
    const accessToken = Deno.env.get('SHOPIFY_API_TOKEN');

    if (!rawStoreUrl || !accessToken) {
      return Response.json({ error: 'Shopify credentials not configured' }, { status: 500 });
    }

    const storeUrl = rawStoreUrl.replace(/^https?:\/\//, '');

    // Fetch all merch items
    const merchItems = await base44.entities.Merch.filter({}, 'sort_order', 100);

    let synced = 0;
    const errors = [];

    for (const item of merchItems) {
      try {
        // Prepare product data
        const variants = item.sizes && item.sizes.length > 0
          ? item.sizes.map(size => ({
              title: size,
              price: item.price.toString(),
            }))
          : [{
              title: 'Default',
              price: item.price.toString(),
            }];

        const productData = {
          product: {
            title: item.name,
            bodyHtml: item.description || '',
            vendor: 'NuVira',
            productType: 'Merch',
            published: item.is_available,
            variants: variants.map(v => ({
              title: v.title,
              price: v.price,
            })),
            image: item.image_url ? { src: item.image_url } : undefined,
          },
        };

        // Remove image if not present
        if (!item.image_url) {
          delete productData.product.image;
        }

        // Check if product already exists (using item ID as reference)
        const shopifyRes = await fetch(
          `https://${storeUrl}/admin/api/2024-01/products.json?title=${encodeURIComponent(item.name)}&limit=1`,
          {
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json',
            },
          }
        );

        const shopifyData = await shopifyRes.json();
        const existingProduct = shopifyData.products?.[0];

        let response;
        if (existingProduct) {
          // Update existing product
          response = await fetch(
            `https://${storeUrl}/admin/api/2024-01/products/${existingProduct.id}.json`,
            {
              method: 'PUT',
              headers: {
                'X-Shopify-Access-Token': accessToken,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(productData),
            }
          );
        } else {
          // Create new product
          response = await fetch(
            `https://${storeUrl}/admin/api/2024-01/products.json`,
            {
              method: 'POST',
              headers: {
                'X-Shopify-Access-Token': accessToken,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(productData),
            }
          );
        }

        if (!response.ok) {
          const errorData = await response.json();
          errors.push({
            item: item.name,
            error: errorData.errors || 'Unknown error',
          });
        } else {
          synced++;
        }
      } catch (err) {
        errors.push({
          item: item.name,
          error: err.message,
        });
      }
    }

    return Response.json({
      message: `Synced ${synced} of ${merchItems.length} items to Shopify`,
      synced,
      total: merchItems.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
