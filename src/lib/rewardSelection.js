// Cart identities stay separate from canonical Product IDs used by fulfillment.
export function isEarnedRewardItem(item) {
  return item?.isFreeReward === true || Boolean(item?.reward_id)
    || String(item?.product_id || '').startsWith('__free_reward_');
}

export function rewardProductEligible(reward, product) {
  if (!product?.id || product.is_available === false) return false;
  const size = String(product.size || '').toLowerCase().replace(/\s+/g, '');
  if (reward?.reward_type === 'free_shot') {
    return product.category === 'shot' && /^(?:(?:2oz|2floz)(?:\/60ml)?|60ml)$/.test(size);
  }
  if (['free_bottle', 'bundle_upgrade', 'vip_box'].includes(reward?.reward_type)) {
    return product.category === 'juice' && /^(?:(?:12oz|12floz)(?:\/355ml)?|355ml)$/.test(size);
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

export function rewardSelectionCount(reward) {
  return reward?.reward_type === 'vip_box' ? 6 : reward?.reward_type === 'bundle_upgrade' ? 3
    : ['free_shot', 'free_bottle'].includes(reward?.reward_type) ? 1 : 0;
}

export function earnedRewardCartItem(reward, product, quantity = 1) {
  if (!reward?.id || !Number.isSafeInteger(reward.points_required) || reward.points_required <= 0
    || !rewardProductEligible(reward, product) || !Number.isSafeInteger(quantity)
    || quantity < 1 || quantity > rewardSelectionCount(reward)) {
    throw new Error('Please choose an eligible product for this reward.');
  }
  const catalogCents = Math.round(Number(product.price) * 100);
  if (product.price === null || product.price === '' || typeof product.price === 'boolean'
    || !Number.isSafeInteger(catalogCents) || catalogCents < 0
    || Math.abs(Number(product.price) * 100 - catalogCents) > 0.00001) {
    throw new Error('This product price could not be confirmed. Please refresh and try again.');
  }
  const upgrade = reward.reward_type === 'bundle_upgrade';
  const unitDiscount = upgrade ? Math.floor(catalogCents / 2) : catalogCents;
  return {
    product_id: product.id,
    cart_line_key: `reward:${reward.id}:${product.id}`,
    title: product.title,
    price: (catalogCents - unitDiscount) / 100,
    quantity,
    catalog_unit_price: catalogCents / 100,
    reward_discount_amount: unitDiscount * quantity / 100,
    image_url: product.image_url || null,
    size: product.size,
    category: product.category,
    shopify_product_id: product.shopify_product_id || null,
    shopify_variant_id: product.shopify_variant_id || null,
    meta_catalog_content_id: product.meta_catalog_content_id || null,
    isFreeReward: !upgrade,
    reward_id: reward.id,
    reward_type: reward.reward_type,
  };
}

// One atomic cart replacement, only after the entire selection is validated.
// Repeated flavors are represented as a quantity on their canonical Product ID.
export function earnedRewardCartItems(reward, choices) {
  if (!Array.isArray(choices) || !choices.length) throw new Error('Choose your reward items first.');
  const seen = new Set();
  const lines = choices.map(({ product, quantity }) => {
    if (seen.has(product?.id)) throw new Error('A reward flavor was selected twice. Please review your selection.');
    seen.add(product?.id);
    return earnedRewardCartItem(reward, product, quantity);
  });
  if (lines.reduce((sum, item) => sum + item.quantity, 0) !== rewardSelectionCount(reward)) {
    throw new Error(`Choose exactly ${rewardSelectionCount(reward)} reward items.`);
  }
  return lines;
}

export function replaceEarnedRewardItems(items, rewardItems = []) {
  return [...items.filter(item => !isEarnedRewardItem(item)), ...rewardItems];
}

export function replaceEarnedRewardItem(items, rewardItem = null) {
  return replaceEarnedRewardItems(items, rewardItem ? [rewardItem] : []);
}
