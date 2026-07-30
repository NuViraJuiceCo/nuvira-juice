export const BRCLUB_CODE = 'BRCLUB';
export const BRCLUB_DISCOUNT_PERCENT = 10;
export const NUVIRA_REFERRAL_CODE = 'NUVIRA26';
export const NUVIRA_REFERRAL_DISCOUNT = 5;

export function normalizeCheckoutCode(value) {
  return String(value || '').trim().toUpperCase();
}

export function resolveCheckoutCode(value, subtotal) {
  const code = normalizeCheckoutCode(value);
  const merchandiseSubtotal = Number(subtotal);

  if (!Number.isFinite(merchandiseSubtotal) || merchandiseSubtotal < 0) {
    return null;
  }

  if (code === BRCLUB_CODE) {
    return {
      code,
      type: 'promotion',
      label: 'BRClub 10% discount',
      percent: BRCLUB_DISCOUNT_PERCENT,
      amount: Math.round(merchandiseSubtotal * BRCLUB_DISCOUNT_PERCENT) / 100,
    };
  }

  if (code === NUVIRA_REFERRAL_CODE) {
    return {
      code,
      type: 'referral',
      label: 'NuVira referral discount',
      percent: 0,
      amount: NUVIRA_REFERRAL_DISCOUNT,
    };
  }

  return null;
}
