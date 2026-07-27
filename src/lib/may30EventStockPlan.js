export const MAY30_EVENT_STOCK_PLAN = {
  eventDate: '2026-07-11',
  eventCount: 1,
  target: 'Sell out all staged units at the event',
  totalUnits: 170,
  notes: 'Planning visibility only. Do not deduct inventory or create purchase orders from this plan.',
  items: [
    { productName: 'Oasis', quantity: 75, category: 'Cold-pressed juice' },
    { productName: 'Aura', quantity: 75, category: 'Cold-pressed juice' },
    { productName: 'Re-Nu', quantity: 20, category: 'Cold-pressed juice' },
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
