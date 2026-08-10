export const PROGRAM_SCHEDULE_VERSION = '2026-08-09.v1';

export const PROGRAMS = Object.freeze([
  Object.freeze({
    key: 'radiance',
    name: 'Radiance',
    tagline: 'A bright daily rhythm',
    description: 'A vibrant, produce-forward routine featuring AURA and OASIS across three thoughtfully paced days.',
    composition: '9 AURA · 3 OASIS',
    bottles: 12,
    days: 3,
    price: 144,
    emoji: '✨',
    image: 'https://media.base44.com/images/public/69d48d0c39891f7945481152/32667c02e_DSC02688.jpg',
    imagePosition: 'object-[center_40%]',
    palette: Object.freeze({
      ink: '#3A2417',
      primary: '#9B5D20',
      accent: '#D69A48',
      soft: '#FBF1DF',
      border: '#E6C894',
      glow: '#F2C97A',
    }),
  }),
  Object.freeze({
    key: 'hydration',
    name: 'Hydration',
    tagline: 'A refreshing daily ritual',
    description: 'An OASIS-forward routine with AURA woven through each day for a refreshing, easy-to-follow rhythm.',
    composition: '9 OASIS · 3 AURA',
    bottles: 12,
    days: 3,
    price: 144,
    emoji: '◌',
    image: 'https://media.base44.com/images/public/69d48d0c39891f7945481152/bc50c9427_DSC02532.jpg',
    imagePosition: 'object-[center_35%]',
    palette: Object.freeze({
      ink: '#381619',
      primary: '#7A2630',
      accent: '#C67B3C',
      soft: '#F8EBDD',
      border: '#DDB895',
      glow: '#E5AA5C',
    }),
  }),
  Object.freeze({
    key: 'reset',
    name: 'Reset',
    tagline: 'A crisp, grounded routine',
    description: 'A crisp, produce-forward routine centered on RE-NU with OASIS for three structured, uncomplicated days.',
    composition: '9 RE-NU · 3 OASIS',
    bottles: 12,
    days: 3,
    price: 144,
    emoji: '🌿',
    image: 'https://media.base44.com/images/public/69d48d0c39891f7945481152/3e9fe43e6_DSC02709.jpg',
    imagePosition: 'object-[center_40%]',
    palette: Object.freeze({
      ink: '#102D22',
      primary: '#285743',
      accent: '#8B9C62',
      soft: '#EDF1E6',
      border: '#B9C7A3',
      glow: '#C6B56A',
    }),
  }),
]);

export const PROGRAM_BY_KEY = Object.freeze(
  Object.fromEntries(PROGRAMS.map((program) => [program.key, program])),
);

export const DAILY_PROGRAM_SCHEDULES = Object.freeze({
  radiance: Object.freeze([
    Object.freeze({ timeKey: 'morning', time: 'Morning', suggestedTime: '8:00 AM', product: 'AURA' }),
    Object.freeze({ timeKey: 'midday', time: 'Midday', suggestedTime: '12:30 PM', product: 'OASIS' }),
    Object.freeze({ timeKey: 'golden_hour', time: 'Golden Hour', suggestedTime: '4:30 PM', product: 'AURA' }),
    Object.freeze({ timeKey: 'evening', time: 'Evening', suggestedTime: '8:00 PM', product: 'AURA' }),
  ]),
  hydration: Object.freeze([
    Object.freeze({ timeKey: 'morning', time: 'Morning', suggestedTime: '8:00 AM', product: 'OASIS' }),
    Object.freeze({ timeKey: 'midday', time: 'Midday', suggestedTime: '12:30 PM', product: 'AURA' }),
    Object.freeze({ timeKey: 'golden_hour', time: 'Golden Hour', suggestedTime: '4:30 PM', product: 'OASIS' }),
    Object.freeze({ timeKey: 'evening', time: 'Evening', suggestedTime: '8:00 PM', product: 'OASIS' }),
  ]),
  reset: Object.freeze([
    Object.freeze({ timeKey: 'morning', time: 'Morning', suggestedTime: '8:00 AM', product: 'RE-NU' }),
    Object.freeze({ timeKey: 'midday', time: 'Midday', suggestedTime: '12:30 PM', product: 'OASIS' }),
    Object.freeze({ timeKey: 'golden_hour', time: 'Golden Hour', suggestedTime: '4:30 PM', product: 'RE-NU' }),
    Object.freeze({ timeKey: 'evening', time: 'Evening', suggestedTime: '8:00 PM', product: 'RE-NU' }),
  ]),
});

export function programForOrderItem(item) {
  const productId = String(item?.product_id || item?.id || '').trim().toLowerCase();
  const title = String(item?.title || item?.name || '').trim().toLowerCase();
  return PROGRAMS.find((program) => (
    productId === `program_${program.key}`
      || productId === `program-${program.key}`
      || title.includes(`${program.name.toLowerCase()} program`)
  )) || null;
}

export function orderContainsProgram(order) {
  return Array.isArray(order?.items) && order.items.some(programForOrderItem);
}

