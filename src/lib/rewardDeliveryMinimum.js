import { verifyCheckoutCatalog } from './checkoutCatalogPreflight.js';
// Read-only UX preview. The payment handler independently recalculates this
// from the catalog; browser prices are never authority for delivery eligibility.
export async function rewardDeliveryMinimumSubtotal({ subtotal, items, activeReward, preview }) {
  const birthday = items?.some(item => item?.isBirthdayReward === true || item?.birthday_product_id || item?.product_id === '__birthday_reward__');
  if (birthday) {
    if (activeReward) throw new Error('birthday_reward_combination_unavailable');
    const quote = await verifyCheckoutCatalog((_name, payload) => preview(payload), items);
    return quote.catalog_subtotal;
  }
  if (!activeReward) return Number(subtotal || 0);
  const response = await preview({ mode: 'preview_reward_checkout', items,
    active_reward: { id: activeReward.id } });
  const data = response?.data;
  const value = data?.quote?.catalog_subtotal;
  if (data?.ok !== true || data.preview_only !== true || data.writes_performed !== false
    || data.quote?.revision !== '2026-09-08.reward-checkout-v1'
    || data.quote?.active_reward?.id !== activeReward.id || typeof value !== 'number'
    || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 100))) {
    throw new Error('reward_delivery_value_unconfirmed');
  }
  return value;
}
