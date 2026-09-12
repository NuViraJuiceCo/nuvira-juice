import { SITE_URL } from './seo-slugs.js';

// Social previews only. Never use these graphic cards for product photos,
// galleries, Product JSON-LD, Merchant feeds, checkout or native hero images.
const BASE = `${SITE_URL}/images/social-share/20260911-approved-v1`;
const CARDS = Object.freeze({
  '/': ['homepage', 'NuVira cold-pressed juices: OASIS, AURA and RE-NU'],
  '/shop': ['shop', 'Find your favorite NuVira blend: OASIS, AURA and RE-NU'],
  '/product/oasis.html': ['oasis', 'OASIS cold-pressed watermelon and citrus juice'],
  '/product/aura.html': ['aura', 'AURA cold-pressed carrot, orange and pineapple juice'],
  '/product/re-nu.html': ['re-nu', 'RE-NU cold-pressed apple, cucumber and greens juice'],
  '/product/the-nuvira-trio.html': ['trio', 'The NuVira Trio: one OASIS, one AURA and one RE-NU'],
});
const RECORDS = Object.freeze(Object.fromEntries(Object.entries(CARDS).map(([route, [key, alt]]) => [route, Object.freeze({
  key, url: `${BASE}/${key}-share-1200x630.png`, width: 1200, height: 630, alt,
})])));

export function socialShareImageForUrl(value) {
  if (typeof value !== 'string' || !value || value.startsWith('//')) return null;
  try {
    const url = new URL(value, SITE_URL);
    if (url.origin !== SITE_URL || url.username || url.password) return null;
    // Query/hash are not product identity. Do not change routing or infer aliases.
    return RECORDS[url.pathname] || null;
  } catch {
    return null;
  }
}
