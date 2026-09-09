// No production SDK, credentials, provider calls, order or points writes.
export const fixtureState = { unavailable: false, unavailableOnRefresh: false, reads: 0, error: false, saves: 0 };
const products = [
  { id: 'fixture-oasis', title: 'OASIS', price: 13, category: 'juice', size: '12oz', image_url: '/images/products/cards/oasis.webp' },
  { id: 'fixture-aura', title: 'AURA', price: 13, category: 'juice', size: '12oz', image_url: '/images/products/cards/aura.webp' },
  { id: 'fixture-renu', title: 'RE-NU', price: 13, category: 'juice', size: '12oz', image_url: '/images/products/cards/re-nu.webp' },
  { id: 'fixture-shot', title: 'Hydration Shot', price: 6, category: 'shot', size: '2oz', image_url: '/images/products/cards/hydration-shot.webp' },
];
export const base44 = { entities: { Product: { filter: async () => {
  fixtureState.reads++;
  if (fixtureState.error) throw new Error('Synthetic catalog outage');
  const unavailable = fixtureState.unavailable || (fixtureState.unavailableOnRefresh && fixtureState.reads > 1);
  return products.map(product => ({ ...product, is_available: !(unavailable && product.id === 'fixture-oasis') }));
} } } };
