import { PUBLIC_PRODUCT_FALLBACKS } from './public-product-catalog.js';
import { normalizeProductIdentifier, slugifyProductTitle } from './seo-slugs.js';

export const DELIVERY_LANDING_SLUGS = Object.freeze(['the-nuvira-trio', 'oasis', 'aura', 're-nu']);

// Match only known catalog identities; never invent a product or substitute a
// different flavor when a live product is missing/unavailable.
export function deliveryLandingProducts(products = PUBLIC_PRODUCT_FALLBACKS) {
  if (!Array.isArray(products)) return [];
  const knownIds = new Set(PUBLIC_PRODUCT_FALLBACKS.map(product => product.id));
  return DELIVERY_LANDING_SLUGS.flatMap(slug => {
    const fallback = PUBLIC_PRODUCT_FALLBACKS.find(product => product.slug === slug);
    const live = products.find(product => product?.id === fallback.id) || products.find(product => product && !knownIds.has(product.id) && (
      normalizeProductIdentifier(product.slug) === slug ||
      slugifyProductTitle(product.title) === slug
    ));
    if (!live || live.is_available === false) return [];
    // Stable approved names also keep productCardImage mapped to the exact
    // flavor's local asset, even if an upstream title/slug drifts.
    return [{ ...fallback, ...live, title: fallback.title, slug }];
  });
}

export function deliveryLandingPrice(product) {
  const price = Number(product?.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 2,
  }).format(price);
}
