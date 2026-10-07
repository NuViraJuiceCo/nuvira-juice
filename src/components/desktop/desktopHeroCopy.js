export const DESKTOP_HERO_STATEMENTS = [
  ['100% All-Natural.', 'Cold-Pressed', 'Juice.'],
  ['Real Fruits.', 'Real Vegetables.', 'Real. Living. Nutrition.'],
  ['Freshly Pressed.', 'Made for Your', 'Everyday.'],
];

let pageStatement;

export function desktopHeroStatement() {
  if (typeof window === 'undefined') return DESKTOP_HERO_STATEMENTS[0];
  // Keep route returns and React remounts on the same statement for this document.
  if (pageStatement) return pageStatement;
  let index = 0;
  try {
    const key = 'nuvira:desktop-hero-next:v1';
    const next = window.sessionStorage.getItem(key);
    if (/^[0-2]$/.test(next || '')) index = Number(next);
    window.sessionStorage.setItem(key, String((index + 1) % DESKTOP_HERO_STATEMENTS.length));
  } catch {
    // Storage restrictions must never prevent the homepage from rendering.
  }
  pageStatement = DESKTOP_HERO_STATEMENTS[index];
  return pageStatement;
}
