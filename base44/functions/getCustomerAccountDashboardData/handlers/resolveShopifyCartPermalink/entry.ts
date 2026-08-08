// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const PUBLIC_SHOPIFY_CATALOG_URL = 'https://nuvira-juice-company.myshopify.com/products.json?limit=250';
const PUBLIC_SHOPIFY_CATALOG_CACHE_MS = 5 * 60 * 1000;

const KNOWN_VARIANT_PRODUCTS: Record<string, { productId: string; shopifyProductId: string; title: string }> = {
  // Current public Shopify/Meta variants. SKU values are Base44 Product ids.
  '43296833077338': { productId: '69e95a6b3b4d04fb9b9599d7', shopifyProductId: '7892143210586', title: 'Reset Shot' },
  '43296833011802': { productId: '69e95a6b3b4d04fb9b9599d6', shopifyProductId: '7892143177818', title: 'Hydration Shot' },
  '43296833044570': { productId: '69e95a6b3b4d04fb9b9599d5', shopifyProductId: '7892143145050', title: 'Radiance Shot' },
  '43220774944858': { productId: '69d490ce699b5f1ac4dde497', shopifyProductId: '7868010987610', title: 'OASIS' },
  '43220774846554': { productId: '69d490ce699b5f1ac4dde496', shopifyProductId: '7868010954842', title: 'RE-NU' },
  '43220774813786': { productId: '69d490ce699b5f1ac4dde495', shopifyProductId: '7868010922074', title: 'AURA' },
  '43222070198362': { productId: '69d490ce699b5f1ac4dde498', shopifyProductId: '7867922514010', title: 'The NuVira Trio' },
  '43222071115866': { productId: '69d5b9df48ee4ce27d9eb8fc', shopifyProductId: '7867922153562', title: 'Watermelon Juice' },
  '43222071181402': { productId: '69d5b9df48ee4ce27d9eb8fb', shopifyProductId: '7867922120794', title: 'Pineapple Juice' },
  '43255063445594': { productId: '69d5b9df48ee4ce27d9eb8fa', shopifyProductId: '7867922088026', title: 'Orange Juice' },
};

let publicShopifyCatalogCache: {
  expiresAt: number;
  products: Array<Record<string, unknown>>;
} | null = null;

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

function getShopifyAdminConfig() {
  const SHOPIFY_API_TOKEN = Deno.env.get('SHOPIFY_API_TOKEN');
  const SHOPIFY_STORE_URL = Deno.env.get('SHOPIFY_STORE_URL');

  if (!SHOPIFY_API_TOKEN || !SHOPIFY_STORE_URL) return null;

  return {
    token: SHOPIFY_API_TOKEN,
    storeHost: SHOPIFY_STORE_URL.replace(/^https?:\/\//, ''),
  };
}

async function fetchShopifyVariant(variantId: string) {
  const config = getShopifyAdminConfig();
  if (!config) return null;

  const response = await fetch(`https://${config.storeHost}/admin/api/2024-01/variants/${variantId}.json`, {
    headers: {
      'X-Shopify-Access-Token': config.token,
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

async function fetchShopifyProduct(productId: string) {
  const config = getShopifyAdminConfig();
  const cleanProductId = shopifyNumericId(productId);
  if (!config || !cleanProductId) return null;

  const response = await fetch(`https://${config.storeHost}/admin/api/2024-01/products/${cleanProductId}.json`, {
    headers: {
      'X-Shopify-Access-Token': config.token,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    console.warn('Unable to resolve Shopify product from Admin API:', cleanProductId, response.status);
    return null;
  }

  const data = await response.json();
  if (!data?.product) return null;

  return {
    shopify_product_id: String(data.product.id),
    title: data.product.title,
    handle: data.product.handle,
    variants: (data.product.variants || []).map((variant: Record<string, unknown>) => ({
      shopify_variant_id: variant.id ? String(variant.id) : '',
      title: variant.title,
      sku: variant.sku || '',
    })),
  };
}

async function fetchPublicShopifyCatalog() {
  if (publicShopifyCatalogCache && publicShopifyCatalogCache.expiresAt > Date.now()) {
    return publicShopifyCatalogCache.products;
  }

  const response = await fetch(PUBLIC_SHOPIFY_CATALOG_URL, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    console.warn('Unable to resolve public Shopify catalog:', response.status);
    return [];
  }

  const data = await response.json();
  const products = (data?.products || []).map((product: Record<string, unknown>) => ({
    shopify_product_id: product.id ? String(product.id) : '',
    title: product.title,
    handle: product.handle,
    variants: (Array.isArray(product.variants) ? product.variants : []).map((variant: Record<string, unknown>) => ({
      shopify_variant_id: variant.id ? String(variant.id) : '',
      title: variant.title,
      sku: variant.sku || '',
    })),
  }));

  publicShopifyCatalogCache = {
    expiresAt: Date.now() + PUBLIC_SHOPIFY_CATALOG_CACHE_MS,
    products,
  };

  return products;
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

export default async function handler(req: Request) {
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

    const setProductByShopifyProductId = (shopifyProductId: unknown, product: Record<string, unknown>) => {
      const direct = String(shopifyProductId || '');
      const numeric = shopifyNumericId(shopifyProductId);
      if (direct) productByShopifyProductId.set(direct, product);
      if (numeric) productByShopifyProductId.set(numeric, product);
    };

    const getProductByShopifyProductId = (shopifyProductId: unknown) =>
      productByShopifyProductId.get(String(shopifyProductId || '')) ||
      productByShopifyProductId.get(shopifyNumericId(shopifyProductId));

    for (const product of products) {
      if (product.id) {
        productById.set(String(product.id), product);
      }
      if (product.shopify_product_id) {
        setProductByShopifyProductId(product.shopify_product_id, product);
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
      const productByShopifyId = getProductByShopifyProductId(shopifyProductId);
      if (productByShopifyId) return productByShopifyId;

      return findProductByLookup(variantSku, shopifyProduct.handle, shopifyProduct.title);
    };

    const getKnownVariantProduct = (variantId: string) => {
      const knownVariant = KNOWN_VARIANT_PRODUCTS[variantId];
      if (!knownVariant) return { product: null, shopifyProductId: null };

      const product =
        productById.get(knownVariant.productId) ||
        getProductByShopifyProductId(knownVariant.shopifyProductId) ||
        findProductByLookup(knownVariant.title);

      return {
        product,
        shopifyProductId: knownVariant.shopifyProductId,
      };
    };

    let publicShopifyProductsForRequest: Array<Record<string, unknown>> | null = null;
    const findPublicShopifyProductForVariant = async (variantId: string) => {
      if (!publicShopifyProductsForRequest) {
        publicShopifyProductsForRequest = await fetchPublicShopifyCatalog();
      }

      let matchedVariant: Record<string, unknown> | null = null;
      const shopifyProduct = publicShopifyProductsForRequest.find((candidate) => {
        matchedVariant = ((candidate.variants || []) as Array<Record<string, unknown>>).find((variant) =>
          variantIdMatches(variant, variantId)
        ) || null;
        return Boolean(matchedVariant);
      });

      return { shopifyProduct, matchedVariant };
    };

    const resolvedItems = [];
    const unresolvedItems = [];

    for (const item of requestedItems) {
      let product = productByShopifyVariantId.get(item.variantId);
      let shopifyProductId = product?.shopify_product_id ? String(product.shopify_product_id) : null;

      if (!product) {
        const knownVariant = getKnownVariantProduct(item.variantId);
        product = knownVariant.product;
        shopifyProductId = knownVariant.shopifyProductId;
      }

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
        const { shopifyProduct, matchedVariant } = await findPublicShopifyProductForVariant(item.variantId);
        shopifyProductId = shopifyProduct?.shopify_product_id ? String(shopifyProduct.shopify_product_id) : null;
        product = findProductForShopifyProduct(shopifyProduct, matchedVariant);
      }

      if (!product) {
        const shopifyVariant = await fetchShopifyVariant(item.variantId);
        shopifyProductId = shopifyVariant?.productId || null;
        product = getProductByShopifyProductId(shopifyProductId);
        if (!product && shopifyVariant?.sku) {
          product = productById.get(shopifyVariant.sku) || findProductByLookup(shopifyVariant.sku);
        }
        if (!product && shopifyProductId) {
          const shopifyProduct = await fetchShopifyProduct(shopifyProductId);
          const matchingVariant = shopifyProduct?.variants?.find((variant: Record<string, unknown>) =>
            variantIdMatches(variant, item.variantId)
          ) || null;
          product = findProductForShopifyProduct(shopifyProduct, matchingVariant || shopifyVariant);
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
}
