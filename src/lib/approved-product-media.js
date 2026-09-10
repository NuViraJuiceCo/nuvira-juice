import { normalizeProductIdentifier, slugifyProductTitle } from './seo-slugs.js';

// Owner-approved September 10 composites. These are deliberately separate from
// the unaltered authentic-product gallery and do not rewrite provider records.
const BASE = '/images/approved-lifestyle/20260910';
const MEDIA = Object.freeze([
  { key: 'aura', id: '69d490ce699b5f1ac4dde495', variant: '43220774813786', title: 'AURA', alt: 'AURA cold-pressed juice bottle with orange slices in warm garden light' },
  { key: 'oasis', id: '69d490ce699b5f1ac4dde497', variant: '43220774944858', title: 'OASIS', alt: 'OASIS cold-pressed juice bottle beside watermelon on a sunlit patio table' },
  { key: 're-nu', id: '69d490ce699b5f1ac4dde496', variant: '43220774846554', title: 'RE-NU', alt: 'RE-NU cold-pressed juice bottle with apple and cucumber by a sunlit window' },
].map(record => Object.freeze({ ...record, primary: `${BASE}/${record.key}-primary.webp`, card: `${BASE}/${record.key}-card.webp` })));

export function approvedProductMedia(product = {}) {
  if (!product || typeof product !== 'object') return null;
  const ids = [product.product_id, product.id, product.catalog_id, product.shopify_variant_id, product.variant_id,
    product.isBirthdayReward === true ? product.birthday_product_id : null]
    .map(value => String(value || '').trim());
  const exactMatches = MEDIA.filter(record => ids.includes(record.id) || ids.includes(record.variant));
  if (exactMatches.length > 1) return null; // Conflicting concrete identities: do not guess a flavor.
  if (exactMatches.length === 1) return exactMatches[0];
  if (product.category && product.category !== 'juice') return null;
  const names = [product.slug, product.handle, product.shopify_handle, product.product_id, product.title, product.name]
    .map(value => slugifyProductTitle(normalizeProductIdentifier(value || '')));
  const nameMatches = MEDIA.filter(record => [record.key, `${record.key}-cold-pressed-juice`, `nuvira-${record.key}-cold-pressed-juice-12-oz`, ...(record.key === 're-nu' ? ['renu'] : [])]
    .some(name => names.includes(name)));
  return nameMatches.length === 1 ? nameMatches[0] : null;
}

export function productPrimaryImage(product = {}) {
  return approvedProductMedia(product)?.primary || product?.image_url || '';
}

export function productThumbnailImage(product = {}) {
  return approvedProductMedia(product)?.card || product?.image_url || '';
}

export function isApprovedProductImage(src = '') {
  return MEDIA.some(record => src === record.primary || src === record.card
    || src === `https://nuvirajuice.com${record.primary}` || src === `https://nuvirajuice.com${record.card}`);
}
