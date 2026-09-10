import { SITE_URL, slugifyProductTitle } from './seo-slugs.js';
import { approvedProductMedia } from './approved-product-media.js';
import { PUBLIC_PRODUCT_FALLBACKS } from './public-product-catalog.js';

const TRIO_GALLERY = Object.freeze([
  {
    path: '/images/authentic-products/trio/trio-outdoor-bag.jpg',
    alt: 'with the complete juice lineup and reusable NuVira bag outdoors',
    scene: 'authentic-outdoor-bag',
  },
  {
    path: '/images/authentic-products/trio/trio-outdoor-lineup.jpg',
    alt: 'complete juice lineup photographed outdoors',
    scene: 'authentic-outdoor-lineup',
  },
  {
    path: '/images/authentic-products/trio/trio-sunset-lineup.jpg',
    alt: 'complete juice lineup photographed in natural sunset light',
    scene: 'authentic-sunset-lineup',
  },
]);

// Supplemental photography is intentionally limited to products represented in
// NuVira's real photo library. Products without a verified lifestyle image keep
// their clean catalog primary instead of receiving a generated or mismatched one.
const PRODUCT_GALLERY_IMAGES = Object.freeze({
  aura: Object.freeze([
    {
      path: '/images/authentic-products/aura/aura-drinking.jpg',
      alt: 'being enjoyed directly from the bottle outdoors',
      scene: 'authentic-drinking',
    },
    {
      path: '/images/authentic-products/aura/aura-conversation.jpg',
      alt: 'held during an outdoor conversation',
      scene: 'authentic-conversation',
    },
    {
      path: '/images/authentic-products/aura/aura-bench.jpg',
      alt: 'held naturally during a relaxed outdoor moment',
      scene: 'authentic-bench',
    },
  ]),
  oasis: Object.freeze([
    {
      path: '/images/authentic-products/oasis/oasis-event-cooler.jpg',
      alt: 'chilled and ready to serve at a NuVira event',
      scene: 'authentic-event-cooler',
    },
    {
      path: '/images/authentic-products/oasis/oasis-sunset-bottle.jpg',
      alt: 'photographed outdoors in natural sunset light',
      scene: 'authentic-sunset-bottle',
    },
    {
      path: '/images/authentic-products/oasis/oasis-sunset-trio.jpg',
      alt: 'with the complete juice lineup and NuVira bag at sunset',
      scene: 'authentic-sunset-trio',
    },
  ]),
  're-nu': Object.freeze([
    {
      path: '/images/authentic-products/re-nu/re-nu-shared-drink.jpg',
      alt: 'being enjoyed directly from the bottle outdoors',
      scene: 'authentic-shared-drink',
    },
    {
      path: '/images/authentic-products/re-nu/re-nu-conversation.jpg',
      alt: 'present during a relaxed outdoor conversation',
      scene: 'authentic-conversation',
    },
    {
      path: '/images/authentic-products/re-nu/re-nu-bench.jpg',
      alt: 'held naturally during a relaxed outdoor moment',
      scene: 'authentic-bench',
    },
  ]),
  'the-nuvira-trio': TRIO_GALLERY,
  'nuvira-trio': TRIO_GALLERY,
});

function productGalleryKey(product = {}) {
  const candidates = [product.slug, product.handle, product.title, product.name]
    .map(value => slugifyProductTitle(value || ''))
    .filter(Boolean);

  return candidates.find(candidate => PRODUCT_GALLERY_IMAGES[candidate]) || '';
}

function absoluteImageUrl(imageUrl = '') {
  const value = String(imageUrl || '').trim();
  if (!value) return '';
  return value.startsWith('http://') || value.startsWith('https://')
    ? value
    : `${SITE_URL}${value.startsWith('/') ? value : `/${value}`}`;
}

export function productAdditionalImageUrls(product = {}, { absolute = false } = {}) {
  const key = productGalleryKey(product);
  if (!key) return [];

  return PRODUCT_GALLERY_IMAGES[key].map(image => (
    absolute ? absoluteImageUrl(image.path) : image.path
  ));
}

export function buildProductGallery(product = {}, { absolute = false } = {}) {
  const title = String(product.title || product.name || 'NuVira product').trim();
  const key = productGalleryKey(product);
  const primary = String(product.image_url || '').trim();
  const approved = approvedProductMedia(product);
  const retiredPrimary = approved
    ? PUBLIC_PRODUCT_FALLBACKS.find(item => item.id === approved.id)?.image_url || ''
    : '';
  const existingSecondaryImages = Array.isArray(product.secondary_images)
    ? product.secondary_images.map(image => String(image || '').trim()).filter(Boolean)
    : [];
  const items = approved ? [{ src: absolute ? absoluteImageUrl(approved.primary) : approved.primary, thumbnail: absolute ? absoluteImageUrl(approved.card) : approved.card, alt: approved.alt, scene: 'approved-primary', fit: 'contain' }] : [];
  // The owner retired these three old hero photos from the visible gallery.
  // Stored catalog/cart media stays unchanged and remains an error fallback.
  if (!approved && primary) {
    items.push({ src: absolute ? absoluteImageUrl(primary) : primary, alt: title, scene: 'primary' });
  }

  existingSecondaryImages.forEach((src, index) => {
    if (approved && [primary, retiredPrimary].some(retired => retired && absoluteImageUrl(src) === absoluteImageUrl(retired))) return;
    items.push({
      src: absolute ? absoluteImageUrl(src) : src,
      alt: `${title} product photo ${index + 2}`,
      scene: 'catalog-secondary',
    });
  });

  if (!key) return items;

  for (const image of PRODUCT_GALLERY_IMAGES[key]) {
    items.push({
      src: absolute ? absoluteImageUrl(image.path) : image.path,
      alt: `${title} ${image.alt}`,
      scene: image.scene,
    });
  }

  return items.filter((item, index, collection) => (
    collection.findIndex(candidate => candidate.src === item.src) === index
  ));
}
