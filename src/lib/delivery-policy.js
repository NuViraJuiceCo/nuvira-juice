import { SITE_URL } from './seo-slugs.js';

export const DELIVERY_POLICY_PATH = '/delivery.html';
export const DELIVERY_POLICY_URL = `${SITE_URL}${DELIVERY_POLICY_PATH}`;

export const DELIVERY_WINDOWS = [
  {
    productionDay: 'Tuesday',
    deliveryDay: 'Wednesday',
    deliveryWindow: '5 PM - 8 PM',
    cutoff: 'Tuesday at 2 PM Central',
  },
  {
    productionDay: 'Friday',
    deliveryDay: 'Saturday',
    deliveryWindow: '12 PM - 3 PM',
    cutoff: 'Friday at 2 PM Central',
  },
];

export const DELIVERY_ZONE_SUMMARY = [
  { distance: '0-5 driving miles', fee: '$3.99', minimum: 'No additional minimum', review: false },
  { distance: '5.01-10 driving miles', fee: '$5.99', minimum: 'No additional minimum', review: false },
  { distance: '10.01-15 driving miles', fee: '$7.99', minimum: 'No additional minimum', review: false },
  { distance: '15.01-25 driving miles', fee: '$9.99', minimum: '$49.99 order minimum', review: false },
  { distance: '25.01-30 driving miles', fee: '$12.99', minimum: '$59.99 order minimum', review: true },
  { distance: '30.01-35 driving miles', fee: '$15.99', minimum: '$72.00 order minimum', review: true },
];

export const DELIVERY_POLICY_CONTENT = {
  addressCheck: 'Delivery eligibility and fees are calculated from the full delivery address using driving distance from NuVira\'s active dispatch point. A ZIP-code check is preliminary; checkout provides the final address-level result.',
  routeReview: 'Addresses from 25.01 to 35 driving miles require route review. Checkout may place a temporary authorization hold, but the payment is not captured unless NuVira approves the route.',
  waitlist: 'Addresses beyond 35 driving miles are not currently available for checkout and may join the delivery waitlist.',
  schedule: 'NuVira regularly produces on Tuesday and Friday for Wednesday and Saturday local delivery. Checkout displays the available delivery date and window before payment.',
  exceptions: 'Delivery availability may change for holidays, severe weather, capacity, or an approved customer-specific arrangement. The date and window confirmed with the order are authoritative.',
};

export const DELIVERY_POLICY_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': `${DELIVERY_POLICY_URL}#page`,
  url: DELIVERY_POLICY_URL,
  name: 'Local Delivery Information | NuVira Juice Co.',
  description: 'NuVira Juice Co. local delivery windows, address-level eligibility, delivery fees, order minimums, route review, and waitlist information.',
  about: {
    '@type': 'Service',
    name: 'NuVira local juice delivery',
    provider: {
      '@type': 'Organization',
      name: 'NuVira Juice Co.',
      url: SITE_URL,
    },
    areaServed: 'Greater St. Louis and St. Charles County, Missouri, subject to address-level checkout validation',
  },
};
