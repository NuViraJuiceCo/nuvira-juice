import { publicCatalogQueryOptions, PUBLIC_WEBSITE_CATALOG_STALE_TIME } from './publicCatalogQueries.js';
import { PUBLIC_PRODUCT_FALLBACKS } from './public-product-catalog.js';
import { normalizeProductIdentifier, productLookupKeys } from './seo-slugs.js';

function sameJsonValue(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => (
    Object.hasOwn(right, key) && sameJsonValue(left[key], right[key])
  ));
}

function isStaticFallback(product) {
  // Home/Shop currently return these records on an empty/failed read. Their
  // recent cache timestamp alone is not proof of current catalog data. Compare
  // values, not references: React Query can structurally share/clone records.
  return PUBLIC_PRODUCT_FALLBACKS.some(fallback => sameJsonValue(product, fallback));
}

function freshWebsiteCatalogProduct(queryClient, identifier, now) {
  const { queryKey } = publicCatalogQueryOptions('products', false);
  const state = queryClient.getQueryState(queryKey);
  if (!state || state.status !== 'success' || state.isInvalidated ||
      !Array.isArray(state.data) || !state.dataUpdatedAt ||
      now < state.dataUpdatedAt || now - state.dataUpdatedAt >= PUBLIC_WEBSITE_CATALOG_STALE_TIME) return null;
  const product = state.data.find(item => (
    item && item.is_available === true && productLookupKeys(item).includes(identifier)
  ));
  if (!product || isStaticFallback(product)) return null;
  return { product, updatedAt: state.dataUpdatedAt };
}

export function productDetailQueryOptions({
  identifier: value, isNative, queryClient, readProducts, findFallback, onReadError,
  now = Date.now(),
}) {
  const identifier = normalizeProductIdentifier(value);
  const queryFn = async () => {
    const fallbackProduct = findFallback(identifier);
    try {
      // A missing match in the shared 100-item cache is not proof of absence.
      // Keep the established complete lookup and ID retry on every cache miss,
      // stale read and explicit refresh; do not write a partial catalog cache.
      const availableProducts = await readProducts({ is_available: true }, 'sort_order', 200);
      const product = availableProducts.find(item => productLookupKeys(item).includes(identifier));
      if (product) return product;
      if (/^[a-f0-9]{24}$/.test(identifier)) {
        const productsById = await readProducts({ id: identifier });
        if (productsById?.[0]) return productsById[0];
      }
      return fallbackProduct;
    } catch (error) {
      onReadError?.(identifier, error);
      return fallbackProduct;
    }
  };
  const existingOptions = { queryKey: ['product-detail', identifier], queryFn, enabled: !!identifier };
  // Preserve native query keys, fetches and inherited remount policy exactly.
  if (isNative !== false) return existingOptions;

  const cached = identifier ? freshWebsiteCatalogProduct(queryClient, identifier, now) : null;
  return {
    ...existingOptions,
    queryKey: ['product-detail', 'public-website', identifier],
    initialData: cached?.product,
    initialDataUpdatedAt: cached?.updatedAt,
    // Match website catalog freshness only for real catalog data. A fallback
    // still retries on remount as it did before this optimization.
    staleTime: query => !query.state.data || isStaticFallback(query.state.data) ? 0 : PUBLIC_WEBSITE_CATALOG_STALE_TIME,
    refetchOnMount: true,
  };
}
