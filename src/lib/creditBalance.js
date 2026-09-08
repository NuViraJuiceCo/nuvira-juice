// Display/selection only. The backend independently verifies the account and
// reserves credits before payment. Do not advertise held value as spendable.
export function availableCreditBalance(record) {
  const total = Number(record?.balance ?? 0);
  const held = Number(record?.reserved_balance ?? 0);
  if (![total, held].every(value => Number.isFinite(value) && value >= 0) || held > total) return 0;
  return Math.round((total - held) * 100) / 100;
}
