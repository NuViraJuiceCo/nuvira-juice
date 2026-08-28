export const SITE_URL = 'https://nuvirajuice.com';

export function slugifyProductTitle(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeProductIdentifier(value = '') {
  const rawValue = String(value || '').trim();
  let decodedValue = rawValue;

  try {
    decodedValue = decodeURIComponent(rawValue);
  } catch {
    decodedValue = rawValue;
  }

  return decodedValue
    .toLowerCase()
    .replace(/^\/?(product|products|shop)\//, '')
    .replace(/\.html$/i, '')
    .replace(/\/+$/g, '');
}

export function productLookupKeys(product = {}) {
  return [
    product.id,
    product.slug,
    product.handle,
    product.shopify_handle,
    product.shopify_product_id,
    product.shopify_variant_id,
    product.sku,
    slugifyProductTitle(product.title || ''),
  ]
    .map(normalizeProductIdentifier)
    .filter(Boolean);
}

export function productPath(product) {
  const slug = slugifyProductTitle(product?.slug || product?.title || product?.id || '');
  return `/product/${slug}.html`;
}

export function absoluteUrl(path = '/') {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${SITE_URL}${normalizedPath}`;
}
