export function normalizeCheckoutCode(value) {
  return String(value || '').trim().toUpperCase();
}

export function normalizeValidatedCheckoutCode(value) {
  const code = normalizeCheckoutCode(value?.code);
  const type = value?.type === 'referral' ? 'referral' : 'promotion';
  const amount = Number(value?.amount);
  const percent = Number(value?.percent || 0);
  const eligibleSubtotal = Number(value?.eligible_subtotal);

  if (!code || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(percent) || percent < 0 ||
      !Number.isFinite(eligibleSubtotal) || eligibleSubtotal < 0) {
    return null;
  }

  return {
    code,
    type,
    label: String(value?.label || `${code} discount`).trim(),
    discountType: value?.discount_type === 'fixed_amount' ? 'fixed_amount' : 'percent',
    percent,
    amount: Math.round(amount * 100) / 100,
    eligibleSubtotal: Math.round(eligibleSubtotal * 100) / 100,
  };
}
