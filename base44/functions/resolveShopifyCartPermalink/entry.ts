import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const KNOWN_VARIANT_PRODUCT_TITLES: Record<string, string> = {
  // Current Meta/Instagram Oasis cart permalink variant.
  '43220774944858': 'OASIS',
};

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

function normalizeLookup(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

function slugify(value: unknown) {
  return normalizeLookup(value)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function shopifyNumericId(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return '';
  const gidMatch = text.match(/\/(\d+)$/);
  if (gidMatch) return gidMatch[1];
  return text.replace(/\D/g, '');
}

function productLookupKeys(product: Record<string, unknown>) {
  return [
    product.id,
    product.title,
    slugify(product.title),
    product.shopify_handle,
    product.handle,
    product.shopify_product_id,
    product.shopify_variant_id,
  ]
    .filter(Boolean)
    .map(normalizeLookup);
}

function variantIdMatches(variant: Record<string, unknown>, requestedVariantId: string) {
  const candidates = [
    variant.shopify_variant_id,
    variant.variant_id,
    variant.id,
    variant.admin_graphql_api_id,
  ];
  return candidates.some((value) => {
    const direct = String(value || '');
    return direct === requestedVariantId || shopifyNumericId(direct) === requestedVariantId;
  });
}

async function fetchShopifyVariant(variantId: string) {
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
  if (!data?.variant) return null;
  return {
    productId: data.variant.product_id ? String(data.variant.product_id) : null,
    sku: data.variant.sku ? String(data.variant.sku) : '',
    title: data.variant.title ? String(data.variant.title) : '',
  };
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
    const productById = new Map<string, Record<string, unknown>>();
    const productByLookupKey = new Map<string, Record<string, unknown>>();

    for (const product of products) {
      if (product.id) {
        productById.set(String(product.id), product);
      }
      if (product.shopify_product_id) {
        productByShopifyProductId.set(String(product.shopify_product_id), product);
      }
      if (product.shopify_variant_id) {
        productByShopifyVariantId.set(String(product.shopify_variant_id), product);
      }
      for (const key of productLookupKeys(product)) {
        if (!productByLookupKey.has(key)) {
          productByLookupKey.set(key, product);
        }
      }
    }

    const findProductByLookup = (...values: unknown[]) => {
      for (const value of values) {
        const normalized = normalizeLookup(value);
        if (normalized && productByLookupKey.has(normalized)) return productByLookupKey.get(normalized);

        const slug = slugify(value);
        if (slug && productByLookupKey.has(slug)) return productByLookupKey.get(slug);
      }
      return null;
    };

    const findProductForShopifyProduct = (
      shopifyProduct: Record<string, unknown> | null | undefined,
      variant?: Record<string, unknown> | null
    ) => {
      if (!shopifyProduct) return null;

      const base44ProductId = shopifyProduct.base44_product_id ? String(shopifyProduct.base44_product_id) : '';
      if (base44ProductId && productById.has(base44ProductId)) return productById.get(base44ProductId);

      const variantSku = variant?.sku ? String(variant.sku) : '';
      if (variantSku && productById.has(variantSku)) return productById.get(variantSku);

      const shopifyProductId = shopifyProduct.shopify_product_id ? String(shopifyProduct.shopify_product_id) : '';
      if (shopifyProductId && productByShopifyProductId.has(shopifyProductId)) {
        return productByShopifyProductId.get(shopifyProductId);
      }

      return findProductByLookup(variantSku, shopifyProduct.handle, shopifyProduct.title);
    };

    const resolvedItems = [];
    const unresolvedItems = [];

    for (const item of requestedItems) {
      let product = productByShopifyVariantId.get(item.variantId) || findProductByLookup(KNOWN_VARIANT_PRODUCT_TITLES[item.variantId]);
      let shopifyProductId = product?.shopify_product_id ? String(product.shopify_product_id) : null;

      if (!product) {
        let matchedVariant: Record<string, unknown> | null = null;
        const shopifyProduct = shopifyProducts.find((candidate) => {
          matchedVariant = (candidate.variants || []).find((variant: Record<string, unknown>) =>
            variantIdMatches(variant, item.variantId)
          ) || null;
          return Boolean(matchedVariant);
        });

        shopifyProductId = shopifyProduct?.shopify_product_id ? String(shopifyProduct.shopify_product_id) : null;
        product = findProductForShopifyProduct(shopifyProduct, matchedVariant);
      }

      if (!product) {
        const shopifyVariant = await fetchShopifyVariant(item.variantId);
        shopifyProductId = shopifyVariant?.productId || null;
        if (shopifyProductId && productByShopifyProductId.has(shopifyProductId)) {
          product = productByShopifyProductId.get(shopifyProductId);
        }
        if (!product && shopifyVariant?.sku) {
          product = productById.get(shopifyVariant.sku) || findProductByLookup(shopifyVariant.sku);
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