import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function parseCartItems(raw: unknown) {
  return String(raw || '')
    .split(',')
    .slice(0, 20)
    .map((entry) => {
      const [variantId, quantityRaw] = entry.split(':');
      const cleanVariantId = String(variantId || '').replace(/\D/g, '');
      const quantity = Math.max(1, Math.min(99, Number.parseInt(quantityRaw || '1', 10) || 1));
      return cleanVariantId ? { variantId: cleanVariantId, quantity } : null;
    })
    .filter(Boolean) as Array<{ variantId: string; quantity: number }>;
}

async function fetchShopifyVariantProductId(variantId: string) {
  const SHOPIFY_API_TOKEN = Deno.env.get('SHOPIFY_API_TOKEN');
  const SHOPIFY_STORE_URL = Deno.env.get('SHOPIFY_STORE_URL');

  if (!SHOPIFY_API_TOKEN || !SHOPIFY_STORE_URL) return null;

  const storeHost = SHOPIFY_STORE_URL.replace(/^https?:\/\//, '');
  const response = await fetch(`https://${storeHost}/admin/api/2024-01/variants/${variantId}.json`, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_API_TOKEN,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    console.warn('Unable to resolve Shopify variant from Admin API:', variantId, response.status);
    return null;
  }

  const data = await response.json();
  return data?.variant?.product_id ? String(data.variant.product_id) : null;
}

function sanitizeProduct(product: Record<string, unknown>) {
  return {
    id: product.id,
    title: product.title,
    short_description: product.short_description,
    description: product.description,
    ingredients: product.ingredients,
    category: product.category,
    price: product.price,
    compare_at_price: product.compare_at_price,
    image_url: product.image_url,
    secondary_images: product.secondary_images,
    size: product.size,
    bottle_count: product.bottle_count,
    tags: product.tags,
    is_featured: product.is_featured,
    is_best_seller: product.is_best_seller,
    is_seasonal: product.is_seasonal,
    is_available: product.is_available,
    is_preorder: product.is_preorder,
    preorder_ship_date: product.preorder_ship_date,
    sort_order: product.sort_order,
    shopify_product_id: product.shopify_product_id,
    shopify_handle: product.shopify_handle,
    shopify_variant_id: product.shopify_variant_id,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const requestedItems = parseCartItems(body.cart || body.items);

    if (requestedItems.length === 0) {
      return Response.json({ ok: false, error: 'invalid_cart_permalink', items: [] }, { status: 400 });
    }

    const [shopifyProducts, products] = await Promise.all([
      base44.asServiceRole.entities.ShopifyProduct.list('-synced_at', 250),
      base44.asServiceRole.entities.Product.filter({ is_available: true }, 'sort_order', 250),
    ]);

    const productByShopifyProductId = new Map<string, Record<string, unknown>>();
    const productByShopifyVariantId = new Map<string, Record<string, unknown>>();

    for (const product of products) {
      if (product.shopify_product_id) {
        productByShopifyProductId.set(String(product.shopify_product_id), product);
      }
      if (product.shopify_variant_id) {
        productByShopifyVariantId.set(String(product.shopify_variant_id), product);
      }
    }

    const resolvedItems = [];
    const unresolvedItems = [];

    for (const item of requestedItems) {
      let product = productByShopifyVariantId.get(item.variantId);
      let shopifyProductId = product?.shopify_product_id ? String(product.shopify_product_id) : null;

      if (!product) {
        const shopifyProduct = shopifyProducts.find((candidate) =>
          (candidate.variants || []).some((variant: Record<string, unknown>) =>
            String(variant.shopify_variant_id || '') === item.variantId
          )
        );

        shopifyProductId = shopifyProduct?.shopify_product_id ? String(shopifyProduct.shopify_product_id) : null;
        if (shopifyProductId) {
          product = productByShopifyProductId.get(shopifyProductId);
        }
      }

      if (!product) {
        shopifyProductId = await fetchShopifyVariantProductId(item.variantId);
        if (shopifyProductId) {
          product = productByShopifyProductId.get(shopifyProductId);
        }
      }

      if (!product) {
        unresolvedItems.push({ variant_id: item.variantId, quantity: item.quantity });
        continue;
      }

      resolvedItems.push({
        quantity: item.quantity,
        shopify_variant_id: item.variantId,
        shopify_product_id: shopifyProductId || product.shopify_product_id || null,
        product: sanitizeProduct(product),
      });
    }

    return Response.json({
      ok: resolvedItems.length > 0,
      items: resolvedItems,
      unresolved_items: unresolvedItems,
    });
  } catch (error) {
    console.error('resolveShopifyCartPermalink error:', error);
    return Response.json({ ok: false, error: 'resolver_failed', items: [] }, { status: 500 });
  }
});