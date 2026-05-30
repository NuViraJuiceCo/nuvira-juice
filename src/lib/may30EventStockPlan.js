export const MAY30_EVENT_STOCK_PLAN = {
  eventDate: '2026-05-30',
  eventCount: 2,
  target: 'Sell out all staged units across both events',
  totalUnits: 120,
  notes: 'Planning visibility only. Do not deduct inventory or create purchase orders from this plan.',
  items: [
    { productName: 'Oasis', quantity: 45, category: 'Cold-pressed juice' },
    { productName: 'Aura', quantity: 45, category: 'Cold-pressed juice' },
    { productName: 'Re-Nu', quantity: 15, category: 'Cold-pressed juice' },
    { productName: 'Hydration Shot', quantity: 9, category: 'Shot' },
    { productName: 'Reset Shot', quantity: 1, category: 'Shot' },
    { productName: 'Radiance Shot', quantity: 5, category: 'Shot' },
  ],
};

export function formatEventDate(value = MAY30_EVENT_STOCK_PLAN.eventDate) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
