import { normalizeProductIdentifier, productLookupKeys, slugifyProductTitle } from '@/lib/seo-slugs';
import { PUBLIC_PRODUCT_FALLBACKS } from '@/lib/public-product-catalog';

export { PUBLIC_PRODUCT_FALLBACKS };

export function findPublicProductFallback(identifier = '') {
  const normalizedIdentifier = normalizeProductIdentifier(identifier);
  const slugIdentifier = slugifyProductTitle(normalizedIdentifier);
  return PUBLIC_PRODUCT_FALLBACKS.find(product => {
    const keys = productLookupKeys(product);
    return keys.includes(normalizedIdentifier) || keys.includes(slugIdentifier);
  });
}
