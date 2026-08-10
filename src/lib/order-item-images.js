import { findPublicProductFallback } from '@/lib/public-products';

const PROGRAM_IMAGES = [
  {
    matches: /(?:radiance.*program|program.*radiance)/i,
    imageUrl: 'https://media.base44.com/images/public/69d48d0c39891f7945481152/32667c02e_DSC02688.jpg',
  },
  {
    matches: /(?:hydration.*program|program.*hydration)/i,
    imageUrl: 'https://media.base44.com/images/public/69d48d0c39891f7945481152/bc50c9427_DSC02532.jpg',
  },
  {
    matches: /(?:reset.*program|program.*reset)/i,
    imageUrl: 'https://media.base44.com/images/public/69d48d0c39891f7945481152/3e9fe43e6_DSC02709.jpg',
  },
];

const PRODUCT_ALIASES = [
  { matches: /\b(?:the\s+)?nuvira\s+trio\b|\btrio\s+bundle\b/i, title: 'The NuVira Trio' },
  { matches: /\bradiance\s+shot\b/i, title: 'Radiance Shot' },
  { matches: /\bhydration\s+shot\b/i, title: 'Hydration Shot' },
  { matches: /\breset\s+shot\b/i, title: 'Reset Shot' },
  { matches: /\bre[\s-]?nu\b/i, title: 'RE-NU' },
  { matches: /\boasis\b/i, title: 'OASIS' },
  { matches: /\baura\b/i, title: 'AURA' },
  { matches: /\borange\s+juice\b/i, title: 'Orange Juice' },
  { matches: /\bpineapple\s+juice\b/i, title: 'Pineapple Juice' },
  { matches: /\bwatermelon\s+juice\b/i, title: 'Watermelon Juice' },
  { matches: /\b(?:large\s+)?nuvira\s+tote(?:\s+bag)?\b|\blarge\s+tote\b/i, title: 'Large NuVira Tote Bag' },
];

function safeImageUrl(value) {
  const url = String(value || '').trim();
  if (!url) return null;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function orderItemIdentifiers(item = {}) {
  return [
    item.product_id,
    item.id,
    item.sku,
    item.title,
    item.name,
    item.variant_title,
  ].map(value => String(value || '').trim()).filter(Boolean);
}

export function resolveOrderItemImage(item = {}) {
  const storedImage = safeImageUrl(item.image_url || item.image || item.product_image_url);
  if (storedImage) return storedImage;

  const identifiers = orderItemIdentifiers(item);
  for (const identifier of identifiers) {
    const catalogProduct = findPublicProductFallback(identifier);
    const catalogImage = safeImageUrl(catalogProduct?.image_url);
    if (catalogImage) return catalogImage;
  }

  const label = identifiers.join(' ');
  const program = PROGRAM_IMAGES.find(candidate => candidate.matches.test(label));
  if (program) return program.imageUrl;

  const alias = PRODUCT_ALIASES.find(candidate => candidate.matches.test(label));
  if (!alias) return null;
  return safeImageUrl(findPublicProductFallback(alias.title)?.image_url);
}
