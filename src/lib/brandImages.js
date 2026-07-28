import { SITE_URL } from '@/lib/seo-slugs';

export const BRAND_IMAGES = {
  bottlesCoolerWide: '/images/brand/nuvira-bottles-cooler-wide.jpg',
  bottlesCoolerVertical: '/images/brand/nuvira-bottles-cooler-vertical.jpg',
  eventBoothField: '/images/brand/nuvira-event-booth-field.jpg',
  eventSampling: '/images/brand/nuvira-event-sampling.jpg',
  eventCollateral: '/images/brand/nuvira-event-collateral.jpg',
  aboutHeroEvent: '/images/brand/nuvira-about-hero-event.jpg',
  aboutHeroMobile: '/images/brand/nuvira-about-hero-mobile.jpg',
  aboutBottleCooler: '/images/brand/nuvira-about-bottle-cooler.jpg',
  aboutProductSignage: '/images/brand/nuvira-about-product-signage.jpg',
  aboutCommunityService: '/images/brand/nuvira-about-community-service.jpg',
  aboutMarketWide: '/images/brand/nuvira-about-market-wide.jpg',
  trioOutdoorEvent: '/images/brand/nuvira-trio-outdoor-event.jpg',
  toteBag: '/images/brand/nuvira-tote-bag.jpg',
  ogCooler: '/images/brand/nuvira-og-cooler.jpg',
};

export function brandImageUrl(path) {
  if (!path) return '';
  return path.startsWith('http') ? path : `${SITE_URL}${path}`;
}

export const BRAND_OG_IMAGE = brandImageUrl(BRAND_IMAGES.ogCooler);
