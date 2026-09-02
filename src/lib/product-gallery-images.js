import { SITE_URL, slugifyProductTitle } from './seo-slugs.js';

const PRODUCT_GALLERY_IMAGES = Object.freeze({
  aura: ['kitchen', 'ingredients', 'outdoor'],
  oasis: ['kitchen', 'ingredients', 'wellness'],
  're-nu': ['kitchen', 'ingredients', 'outdoor'],
  'the-nuvira-trio': ['kitchen', 'ingredients', 'lifestyle'],
  'nuvira-trio': ['kitchen', 'ingredients', 'lifestyle'],
  'orange-juice': ['kitchen', 'ingredients', 'lifestyle'],
  'pineapple-juice': ['kitchen', 'ingredients', 'lifestyle'],
  'watermelon-juice': ['kitchen', 'ingredients', 'lifestyle'],
  'radiance-shot': ['kitchen', 'ingredients', 'lifestyle'],
  'hydration-shot': ['kitchen', 'ingredients', 'lifestyle'],
  'reset-shot': ['kitchen', 'ingredients', 'lifestyle'],
});

const GALLERY_DIRECTORY = Object.freeze({
  aura: 'aura',
  oasis: 'oasis',
  're-nu': 're-nu',
  'the-nuvira-trio': 'nuvira-trio',
  'nuvira-trio': 'nuvira-trio',
  'orange-juice': 'orange-juice',
  'pineapple-juice': 'pineapple-juice',
  'watermelon-juice': 'watermelon-juice',
  'radiance-shot': 'radiance-shot',
  'hydration-shot': 'hydration-shot',
  'reset-shot': 'reset-shot',
});

const SCENE_LABELS = Object.freeze({
  kitchen: 'in a bright kitchen setting',
  ingredients: 'with its featured ingredients',
  outdoor: 'in a fresh outdoor setting',
  wellness: 'in a calm wellness setting',
  lifestyle: 'in a premium lifestyle setting',
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

  const directory = GALLERY_DIRECTORY[key];
  return PRODUCT_GALLERY_IMAGES[key].map(scene => {
    const imagePath = `/images/google-merchant/${directory}/${directory}-${scene}.jpg`;
    return absolute ? absoluteImageUrl(imagePath) : imagePath;
  });
}

export function buildProductGallery(product = {}, { absolute = false } = {}) {
  const title = String(product.title || product.name || 'NuVira product').trim();
  const key = productGalleryKey(product);
  const primary = String(product.image_url || '').trim();
  const existingSecondaryImages = Array.isArray(product.secondary_images)
    ? product.secondary_images.map(image => String(image || '').trim()).filter(Boolean)
    : [];
  const items = primary ? [{ src: absolute ? absoluteImageUrl(primary) : primary, alt: title, scene: 'primary' }] : [];

  existingSecondaryImages.forEach((src, index) => {
    items.push({
      src: absolute ? absoluteImageUrl(src) : src,
      alt: `${title} product photo ${index + 2}`,
      scene: 'catalog-secondary',
    });
  });

  if (!key) return items;

  const directory = GALLERY_DIRECTORY[key];
  for (const scene of PRODUCT_GALLERY_IMAGES[key]) {
    items.push({
      src: absolute
        ? absoluteImageUrl(`/images/google-merchant/${directory}/${directory}-${scene}.jpg`)
        : `/images/google-merchant/${directory}/${directory}-${scene}.jpg`,
      alt: `${title} ${SCENE_LABELS[scene]}`,
      scene,
    });
  }

  return items.filter((item, index, collection) => (
    collection.findIndex(candidate => candidate.src === item.src) === index
  ));
}
