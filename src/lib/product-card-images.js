import { slugifyProductTitle } from '@/lib/seo-slugs';

const PRODUCT_CARD_IMAGES = Object.freeze({
  aura: '/images/products/cards/aura.webp',
  're-nu': '/images/products/cards/re-nu.webp',
  oasis: '/images/products/cards/oasis.webp',
  'the-nuvira-trio': '/images/products/cards/the-nuvira-trio.webp',
  'nuvira-trio': '/images/products/cards/the-nuvira-trio.webp',
  'orange-juice': '/images/products/cards/orange-juice.webp',
  'pineapple-juice': '/images/products/cards/pineapple-juice.webp',
  'watermelon-juice': '/images/products/cards/watermelon-juice.webp',
  'radiance-shot': '/images/products/cards/radiance-shot.webp',
  'hydration-shot': '/images/products/cards/hydration-shot.webp',
  'reset-shot': '/images/products/cards/reset-shot.webp',
  'large-nuvira-tote-bag': '/images/brand/nuvira-tote-bag.webp',
});

export function productCardImage(product) {
  const titleKey = slugifyProductTitle(product?.title || product?.name || '');
  return PRODUCT_CARD_IMAGES[titleKey] || product?.image_url || '';
}
