export const PUBLIC_WEBSITE_CATALOG_STALE_TIME = 2 * 60 * 1000;
export const PUBLIC_WEBSITE_PRODUCT_LIMIT = 100;

const publicReadContracts = {
  products: { is_available: true, sort: 'sort_order', limit: PUBLIC_WEBSITE_PRODUCT_LIMIT },
  banners: { is_active: true, sort: 'sort_order', limit: 10 },
  bundles: { sort: 'sort_order', limit: 100 },
};

// These options stay inside the existing principal-scoped, in-memory client.
// Native callers retain their original keys and the global refetch policy.
export function publicCatalogQueryOptions(resource, isNative) {
  if (isNative) return {};

  // Keep the resource prefix for existing invalidations, but do not accept a
  // fresh legacy cache entry with a smaller limit or a different entity shape.
  return {
    queryKey: [resource, 'public-website', publicReadContracts[resource]],
    staleTime: PUBLIC_WEBSITE_CATALOG_STALE_TIME,
    refetchOnMount: true,
  };
}
