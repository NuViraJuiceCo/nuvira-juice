import { verifyCheckoutCatalog } from './checkoutCatalogPreflight.js';
import { isEarnedRewardItem } from './rewardSelection.js';

export function rewardDeliveryErrorMessage(error) {
  const code = error?.response?.data?.error_code || error?.code;
  const messages = {
    REWARD_QUANTITY_MISMATCH: 'Your saved reward needs its own product selection. Choose the reward items, or remove the reward to buy only the items in your order.',
    REWARD_SELECTION_REQUIRED: 'A reward item is missing its reward selection. Choose your reward again, or remove the reward items.',
    REWARD_ITEM_MISMATCH: 'The reward items do not match your saved selection. Choose your reward again, or remove it from this order.',
    REWARD_UNAVAILABLE: 'This saved reward is no longer available. Choose another reward, or remove it from this order.',
    INSUFFICIENT_REWARD_POINTS: 'There are not enough available points for this saved reward. Choose another reward, or remove it from this order.',
    REWARD_AUTH_REQUIRED: 'Sign in to the account that owns this reward, or remove it from this order.',
    REWARD_PRODUCT_UNAVAILABLE: 'A product in this reward order is unavailable. Review your cart before continuing.',
    ORDER_MINIMUM_NOT_MET: 'Your order needs at least 3 juices, 6 shots, or an equivalent mix. Review your cart before continuing.',
  };
  return messages[code] || 'We could not confirm your saved reward. Try again, review your rewards, or remove the reward from this order.';
}
// Read-only UX preview. The payment handler independently recalculates this
// from the catalog; browser prices are never authority for delivery eligibility.
export async function rewardDeliveryMinimumSubtotal({ subtotal, items, activeReward, preview }) {
  const birthday = items?.some(item => item?.isBirthdayReward === true || item?.birthday_product_id || item?.product_id === '__birthday_reward__');
  if (birthday) {
    if (activeReward) throw new Error('birthday_reward_combination_unavailable');
    const quote = await verifyCheckoutCatalog((_name, payload) => preview(payload), items);
    return quote.catalog_subtotal;
  }
  if (!activeReward) {
    if (items?.some(isEarnedRewardItem)) {
      throw Object.assign(new Error('reward_selection_required'), { code: 'REWARD_SELECTION_REQUIRED' });
    }
    return Number(subtotal || 0);
  }
  const response = await preview({ mode: 'preview_reward_checkout', items,
    active_reward: { id: activeReward.id } });
  const data = response?.data;
  const value = data?.quote?.catalog_subtotal;
  if (data?.ok !== true || data.preview_only !== true || data.writes_performed !== false
    || data.quote?.revision !== '2026-09-08.reward-checkout-v1'
    || data.quote?.active_reward?.id !== activeReward.id || typeof value !== 'number'
    || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 100))) {
    throw Object.assign(new Error('reward_delivery_value_unconfirmed'), { code: data?.error_code });
  }
  return value;
}
