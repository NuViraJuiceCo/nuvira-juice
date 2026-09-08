// Cart identities stay separate from canonical Product IDs used by fulfillment.
export function isEarnedRewardItem(item) {
  return item?.isFreeReward === true || Boolean(item?.reward_id)
    || String(item?.product_id || '').startsWith('__free_reward_');
}

export function rewardProductEligible(reward, product) {
  if (!product?.id || product.is_available === false) return false;
  const size = String(product.size || '').toLowerCase().replace(/\s+/g, '');
  if (reward?.reward_type === 'free_shot') {
    return product.category === 'shot' && /^(2oz|2floz|60ml)$/.test(size);
  }
  if (reward?.reward_type === 'free_bottle') {
    return product.category === 'juice' && /^(12oz|12floz|355ml)$/.test(size);
  }
  return false;
}

export function canonicalRewardSelection(data, requested) {
  const points = Number(data?.points_required);
  if (data?.success !== true || !requested?.id || data.reward_id !== requested.id
    || data.reward_title !== requested.title || data.reward_type !== requested.reward_type
    || !Number.isSafeInteger(points) || points <= 0) {
    throw new Error(data?.error || 'We could not confirm this reward. Please try again.');
  }
  return {
    id: data.reward_id, title: data.reward_title, reward_type: data.reward_type,
    points_required: points, description: data.description || '', icon: data.icon || '🎁',
  };
}

export function earnedRewardCartItem(reward, product) {
  if (!reward?.id || !Number.isSafeInteger(reward.points_required) || reward.points_required <= 0
    || !rewardProductEligible(reward, product)) {
    throw new Error('Please choose an eligible product for this reward.');
  }
  return {
    product_id: product.id,
    cart_line_key: `reward:${reward.id}:${product.id}`,
    title: product.title,
    price: 0,
    quantity: 1,
    image_url: product.image_url || null,
    size: product.size,
    category: product.category,
    shopify_product_id: product.shopify_product_id || null,
    shopify_variant_id: product.shopify_variant_id || null,
    meta_catalog_content_id: product.meta_catalog_content_id || null,
    isFreeReward: true,
    reward_id: reward.id,
    reward_type: reward.reward_type,
  };
}

export function replaceEarnedRewardItem(items, rewardItem = null) {
  const paidAndBirthdayItems = items.filter(item => !isEarnedRewardItem(item));
  return rewardItem ? [...paidAndBirthdayItems, rewardItem] : paidAndBirthdayItems;
}
