// Item-count eligibility is independent of price or how an item was earned.
// Reward validation/points debit and delivery-area value checks are separate.
export function orderMinimumStatus(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { meetsMinimum: false, units: 0, remainingUnits: 3, error: 'Your cart is empty.' };
  }
  let units = 0;
  let hasJuiceItems = false;
  for (const item of items) {
    const quantity = Number(item?.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      return { meetsMinimum: false, units, remainingUnits: Math.max(0, 3 - units),
        error: 'Please review the quantities in your cart.' };
    }
    if (item.category === 'juice') {
      units += quantity;
      hasJuiceItems = true;
    } else if (item.category === 'shot') {
      units += quantity * 0.5;
      hasJuiceItems = true;
    } else if (item.category === 'bundle') {
      // Existing bundles default to 3. Reward bundles must carry their actual
      // catalog bottle count instead of guessing from a title or zero price.
      const isRewardBundle = item.isFreeReward === true || Boolean(item.reward_id);
      const count = Number(item.bottles_per_unit ?? (isRewardBundle ? NaN : 3));
      if (!Number.isInteger(count) || count < 1 || count > 100) {
        return { meetsMinimum: false, units, remainingUnits: Math.max(0, 3 - units),
          error: 'Please refresh this bundle so we can confirm its bottle count.' };
      }
      units += count * quantity;
      hasJuiceItems = true;
    }
  }
  const meetsMinimum = !hasJuiceItems || units >= 3;
  return {
    meetsMinimum,
    units,
    remainingUnits: hasJuiceItems ? Math.max(0, 3 - units) : 0,
    error: meetsMinimum ? null : 'Orders need at least 3 juices, 6 shots, or an equivalent mix. Earned reward items count toward this minimum.',
  };
}
