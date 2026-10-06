import { SITE_URL } from '@/lib/seo-slugs';

export const BRAND_IMAGES = {
  wordmark: '/images/brand/nuvira-wordmark.webp',
  bottlesCoolerWide: '/images/brand/nuvira-bottles-cooler-wide.jpg',
  bottlesCoolerVertical: '/images/brand/nuvira-bottles-cooler-vertical.jpg',
  eventBoothField: '/images/brand/nuvira-event-booth-field.jpg',
  eventSampling: '/images/brand/nuvira-event-sampling.jpg',
  eventCollateral: '/images/brand/nuvira-event-collateral.jpg',
  aboutHeroEvent: '/images/brand/nuvira-about-hero-event.jpg',
  aboutHeroMobile: '/images/brand/nuvira-about-hero-mobile.jpg',
  aboutBottleCooler: '/images/brand/nuvira-about-bottle-cooler.webp',
  aboutBottleCoolerMobile: '/images/brand/nuvira-about-bottle-cooler-840.webp',
  aboutProductSignage: '/images/brand/nuvira-about-product-signage.jpg',
  aboutCommunityService: '/images/brand/nuvira-about-community-service.jpg',
  aboutMarketWide: '/images/brand/nuvira-about-market-wide.jpg',
  trioOutdoorEvent: '/images/brand/nuvira-trio-outdoor-event.webp',
  toteBag: '/images/brand/nuvira-tote-bag.webp',
  ogCooler: '/images/brand/nuvira-og-cooler.jpg',
};

export function brandImageUrl(path) {
  if (!path) return '';
  return path.startsWith('http') ? path : `${SITE_URL}${path}`;
}

export const BRAND_OG_IMAGE = brandImageUrl(BRAND_IMAGES.ogCooler);

// Delivery-only derivatives of the same photos. Original/native/SEO URLs stay
// unchanged; callers must explicitly opt into the website's responsive sources.
const WEBSITE_HERO_SOURCES = Object.freeze({
  [BRAND_IMAGES.bottlesCoolerWide]: { widths: [1800], originalWidth: 1800 },
  [BRAND_IMAGES.bottlesCoolerVertical]: { widths: [800], originalWidth: 800 },
  [BRAND_IMAGES.eventBoothField]: { widths: [840, 1800], originalWidth: 1800 },
  [BRAND_IMAGES.aboutHeroEvent]: { widths: [1440], originalWidth: 1800 },
  [BRAND_IMAGES.aboutHeroMobile]: { widths: [1066], originalWidth: 1066 },
});

export function websiteBrandImageProps(src, { website = false, sizes = '100vw' } = {}) {
  const source = WEBSITE_HERO_SOURCES[src];
  if (website !== true || !source) return { src };
  const name = src.split('/').pop().replace(/\.jpg$/, '');
  const candidates = source.widths.map(width => `/images/website-performance-20261006/heroes/${name}-${width}.webp ${width}w`);
  // Keep the original resolution available for larger/high-DPR displays.
  if (source.originalWidth > Math.max(...source.widths)) candidates.push(`${src} ${source.originalWidth}w`);
  return {
    src, // The unmodified JPEG remains the browser/error fallback.
    srcSet: candidates.join(', '),
    sizes,
    decoding: 'async',
    onError: (event) => {
      const image = event.currentTarget;
      if (!image.getAttribute('srcset')) return;
      image.removeAttribute('srcset');
      // About's desktop source uses a different original photo from mobile.
      // Restore both picture branches instead of switching the selected crop.
      image.parentElement?.querySelectorAll('source[data-original-srcset]').forEach(source => {
        source.setAttribute('srcset', source.getAttribute('data-original-srcset'));
      });
    },
  };
}
