// Preserve the checkout's real catalog identity separately from Shopify line IDs.
// This helper never calculates prices, grants rewards, or expands bottle counts.
export function nativeItemSnapshot(item, strict = false) {
  const result = {};
  const strings = { product_id: 120, image_url: 2048, category: 40, size: 40,
    cart_line_key: 250, reward_id: 120, reward_type: 60,
    shopify_product_id: 120, shopify_variant_id: 120, meta_catalog_content_id: 120,
    program_key: 40, program_schedule_version: 120, program_addon_for: 40,
    program_addon_schedule_version: 120 };
  const accept = (condition, field) => {
    if (!condition && strict) throw new Error(`native_item_snapshot_invalid:${field}`);
    return condition;
  };
  for (const [key, max] of Object.entries(strings)) {
    const value = item?.[key];
    if (value === undefined || value === null || value === '') continue;
    if (accept(typeof value === 'string' && value.trim() === value && value.length <= max
      && !/[\u0000-\u001f]/.test(value), key)) result[key] = value;
  }
  for (const key of ['isFreeReward', 'is_program']) {
    if (item?.[key] === undefined || item?.[key] === null) continue;
    if (accept(typeof item[key] === 'boolean', key)) result[key] = item[key];
  }
  for (const key of ['catalog_unit_price', 'reward_discount_amount']) {
    if (item?.[key] === undefined || item?.[key] === null) continue;
    if (accept(Number.isFinite(item[key]) && item[key] >= 0, key)) result[key] = item[key];
  }
  for (const key of ['bottles_per_unit', 'program_days', 'program_addon_days']) {
    if (item?.[key] === undefined || item?.[key] === null) continue;
    if (accept(Number.isSafeInteger(item[key]) && item[key] > 0 && item[key] <= 100, key)) result[key] = item[key];
  }
  if (item?.bundle_composition !== undefined && item?.bundle_composition !== null) {
    const parts = item.bundle_composition;
    if (accept(Array.isArray(parts) && parts.length <= 100 && parts.every(part => part
      && typeof part.product_id === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(part.product_id)
      && typeof part.product_name === 'string' && part.product_name.trim() === part.product_name
      && part.product_name.length > 0 && part.product_name.length <= 160
      && Number.isSafeInteger(part.quantity) && part.quantity > 0 && part.quantity <= 100), 'bundle_composition')) {
      result.bundle_composition = parts.map(part => ({ product_id: part.product_id,
        product_name: part.product_name, quantity: part.quantity }));
    }
  }
  if (strict) {
    accept(typeof result.product_id === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(result.product_id), 'product_id');
    accept(typeof item?.title === 'string' && item.title.trim() === item.title
      && item.title.length > 0 && item.title.length <= 160, 'title');
    accept(Number.isSafeInteger(item?.quantity) && item.quantity > 0 && item.quantity <= 100, 'quantity');
    accept(Number.isFinite(item?.price) && item.price >= 0, 'price');
    accept(typeof result.category === 'string' && typeof result.size === 'string', 'bottle_metadata');
  }
  return result;
}
