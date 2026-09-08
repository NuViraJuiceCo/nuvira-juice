// Pure pricing policy. Callers must load products, rewards and balance from the
// authenticated customer's server records. This quote never reserves/debits points.
export const REWARD_CHECKOUT_REVISION = '2026-09-08.reward-checkout-v1';
const TYPES = new Set(['free_shot', 'free_bottle', 'double_points', 'discount_10pct',
  'bundle_upgrade', 'vip_box', 'discount', 'free_delivery']);

export class RewardCheckoutError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function fail(code, message) { throw new RewardCheckoutError(code, message); }
function integer(value, code, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === '' || typeof value === 'boolean') fail(code, 'Please refresh your reward and try again.');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) fail(code, 'Please refresh your reward and try again.');
  return number;
}
function cents(value) {
  if (value === null || value === '' || typeof value === 'boolean') fail('INVALID_CATALOG_PRICE', 'A product price could not be confirmed.');
  const number = Number(value);
  const rounded = Math.round(number * 100);
  if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(rounded)
    || Math.abs(number * 100 - rounded) > 0.00001) fail('INVALID_CATALOG_PRICE', 'A product price could not be confirmed.');
  return rounded;
}
const dollars = value => value / 100;
const size = product => String(product?.size || '').toLowerCase().replace(/\s+/g, '');
const juice = product => product?.category === 'juice' && /^(12oz|12floz|355ml)$/.test(size(product));
const shot = product => product?.category === 'shot' && /^(2oz|2floz|60ml)$/.test(size(product));
const isEarned = item => item?.isFreeReward === true || Boolean(item?.reward_id)
  || String(item?.product_id || '').startsWith('__free_reward_');

export function canonicalReward(reward, requested, availablePoints) {
  if (!requested?.id || !reward?.id || reward.id !== requested.id || reward.is_active !== true
    || !TYPES.has(reward.reward_type)) fail('REWARD_UNAVAILABLE', 'This reward is unavailable. Please choose another reward.');
  const cost = integer(reward.points_required, 'INVALID_REWARD_COST', 1);
  const balance = integer(availablePoints, 'INVALID_REWARD_BALANCE');
  if (balance < cost) fail('INSUFFICIENT_REWARD_POINTS', 'You no longer have enough available points for this reward.');
  // Catalog type/title/cost are authoritative, never the stored selection.
  return { id: reward.id, title: reward.title, reward_type: reward.reward_type,
    points_required: cost, description: reward.description || '', icon: reward.icon || '🎁' };
}

export function quoteRewardCheckout({ items, products, reward, requestedReward, availablePoints, resolveProgram }) {
  const selected = canonicalReward(reward, requestedReward, availablePoints);
  if (!Array.isArray(items) || !items.length || items.length > 50 || !Array.isArray(products)) {
    fail('INVALID_REWARD_CART', 'Please review the items in your cart.');
  }
  const byId = new Map();
  for (const product of products) {
    if (!product?.id || byId.has(product.id)) fail('INVALID_REWARD_CATALOG', 'The product catalog needs review. Please try again later.');
    byId.set(product.id, product);
  }
  let physicalUnits = 0;
  let hasBeverages = false;
  let paidBottles = 0;
  let rewardQuantity = 0;
  let grossCents = 0;
  let rewardItemDiscountCents = 0;
  const earnedProductIds = new Set();
  const normalized = items.map((item) => {
    const quantity = integer(item?.quantity, 'INVALID_REWARD_QUANTITY', 1, 100);
    const earned = isEarned(item);
    if (earned && (item.reward_id !== selected.id || typeof item.product_id !== 'string'
      || !item.product_id || item.product_id.startsWith('__') || earnedProductIds.has(item.product_id))) {
      fail('REWARD_ITEM_MISMATCH', 'Please remove the old reward item and select it again.');
    }
    if (earned) earnedProductIds.add(item.product_id);
    const program = !earned && typeof resolveProgram === 'function' ? resolveProgram(item) : null;
    const product = program || byId.get(item.product_id);
    if (!product || product.is_available === false) fail('REWARD_PRODUCT_UNAVAILABLE', 'A product is unavailable. Please review your cart.');
    const unitCents = cents(product.price);
    let bottles = 0;
    if (product.category === 'juice') bottles = 1;
    else if (product.category === 'shot') bottles = 0.5;
    else if (product.category === 'bundle') {
      bottles = integer(product.bottles_per_unit ?? product.bottle_count, 'BUNDLE_COUNT_UNAVAILABLE', 1, 100);
    }
    physicalUnits += bottles * quantity;
    hasBeverages ||= bottles > 0;
    // Paid bottle bundles count; shots and non-beverage merchandise do not.
    if (!earned && (product.category === 'juice' || product.category === 'bundle')) paidBottles += bottles * quantity;
    const fullLine = unitCents * quantity;
    grossCents += fullLine;
    let discount = 0;
    if (earned) {
      const eligible = selected.reward_type === 'free_shot' ? shot(product)
        : ['free_bottle', 'bundle_upgrade', 'vip_box'].includes(selected.reward_type) && juice(product);
      if (!eligible) fail('REWARD_PRODUCT_INELIGIBLE', 'Choose an eligible 2oz shot or 12oz juice for this reward.');
      rewardQuantity += quantity;
      discount = selected.reward_type === 'bundle_upgrade' ? Math.floor(unitCents / 2) * quantity : fullLine;
      rewardItemDiscountCents += discount;
    }
    const priced = {
      product_id: product.id || product.product_id, title: product.title,
      price: dollars(earned ? (fullLine - discount) / quantity : unitCents), quantity,
      image_url: product.image_url || null, category: product.category, size: product.size || null,
      shopify_product_id: product.shopify_product_id || null,
      shopify_variant_id: product.shopify_variant_id || null,
      meta_catalog_content_id: product.meta_catalog_content_id || null,
      ...(product.category === 'bundle' ? { bottles_per_unit: bottles, bundle_composition: product.bundle_composition || [] } : {}),
      ...(program ? { is_program: true, program_key: program.program_key, program_days: program.program_days,
        program_schedule_version: program.program_schedule_version } : {}),
      ...(earned ? { reward_id: selected.id, reward_type: selected.reward_type,
        isFreeReward: selected.reward_type !== 'bundle_upgrade', catalog_unit_price: dollars(unitCents),
        reward_discount_amount: dollars(discount), cart_line_key: `reward:${selected.id}:${product.id}` } : {}),
    };
    return priced;
  });
  const expectedQuantity = selected.reward_type === 'vip_box' ? 6
    : selected.reward_type === 'bundle_upgrade' ? 3
      : ['free_shot', 'free_bottle'].includes(selected.reward_type) ? 1 : 0;
  if (rewardQuantity !== expectedQuantity) {
    fail('REWARD_QUANTITY_MISMATCH', expectedQuantity
      ? `This reward requires exactly ${expectedQuantity} selected reward item${expectedQuantity === 1 ? '' : 's'}.`
      : 'This reward does not include a free product. Remove the extra reward items.');
  }
  if (selected.reward_type === 'bundle_upgrade' && paidBottles < 3) {
    fail('REWARD_UPGRADE_BASE_REQUIRED', 'The bundle upgrade needs three regular bottles plus three half-price reward bottles.');
  }
  if (hasBeverages && physicalUnits < 3) {
    fail('ORDER_MINIMUM_NOT_MET', 'Orders need 3 juices, 6 shots, or an equivalent mix. Your earned items count.');
  }
  const subtotalCents = grossCents - rewardItemDiscountCents;
  const orderDiscountCents = ['discount', 'discount_10pct'].includes(selected.reward_type)
    ? Math.round(subtotalCents / 10) : 0;
  const merchandiseCents = subtotalCents - orderDiscountCents;
  if (![grossCents, subtotalCents, merchandiseCents].every(Number.isSafeInteger)) {
    fail('INVALID_REWARD_TOTAL', 'Your reward total could not be confirmed.');
  }
  return {
    revision: REWARD_CHECKOUT_REVISION, items: normalized, active_reward: selected,
    points_required: selected.points_required, physical_units: physicalUnits,
    catalog_subtotal: dollars(grossCents), subtotal: dollars(subtotalCents),
    reward_item_discount: dollars(rewardItemDiscountCents), reward_discount: dollars(orderDiscountCents),
    merchandise_total: dollars(merchandiseCents),
    free_delivery: selected.reward_type === 'free_delivery',
    points_multiplier: selected.reward_type === 'double_points' ? 2 : 1,
  };
}

export async function loadRewardCheckoutQuote(base44, user, body, resolveProgram, { retryReservationId = null } = {}) {
  const email = String(user?.email || '').trim().toLowerCase();
  if (!email || (body.customer_email && String(body.customer_email).trim().toLowerCase() !== email)) {
    fail('REWARD_AUTH_REQUIRED', 'Sign in to your own account to use an earned reward.');
  }
  const id = body.active_reward?.id;
  if (!id) fail('REWARD_SELECTION_REQUIRED', 'Please select your reward again.');
  const entities = base44.asServiceRole.entities;
  const [rewards, balances, products] = await Promise.all([
    entities.RewardTier.filter({ id, is_active: true }, undefined, 2),
    entities.UserPoints.filter({ customer_email: email }, undefined, 2),
    entities.Product.filter({ is_available: true }, 'sort_order', 250),
  ]);
  if (!Array.isArray(rewards) || rewards.length !== 1 || !Array.isArray(balances) || balances.length !== 1
    || !Array.isArray(products) || products.length >= 250) {
    fail('REWARD_DATA_UNAVAILABLE', 'We could not confirm your reward. Please try again later.');
  }
  const total = integer(balances[0].total_points, 'INVALID_REWARD_BALANCE');
  const reserved = integer(balances[0].reserved_points ?? 0, 'INVALID_REWARD_BALANCE');
  if (reserved > total) fail('INVALID_REWARD_BALANCE', 'Your points balance could not be confirmed.');
  const reservations = balances[0].reward_reservations ?? [];
  if (!Array.isArray(reservations) || reservations.some(hold => !hold || typeof hold !== 'object')) {
    fail('INVALID_REWARD_BALANCE', 'Your reward reservation needs review.');
  }
  // Only the payment handler may supply this ID, derived from the authenticated
  // email and the opaque checkout attempt. Never read it from the request body.
  // Stripe's same-parameter idempotency and the ledger's PI/context binding must
  // still pass before any secret is returned or held points can be reused.
  const matching = retryReservationId ? reservations
    .filter(hold => hold.reservation_id === retryReservationId) : [];
  if (matching.length > 1) fail('INVALID_REWARD_BALANCE', 'Your reward reservation needs review.');
  const own = matching[0];
  const restored = own && ['held', 'consumed'].includes(own.status)
    ? integer(own.points, 'INVALID_REWARD_BALANCE', 1) : 0;
  const availablePoints = total - reserved + restored;
  const quote = quoteRewardCheckout({ items: body.items, products, reward: rewards[0],
    requestedReward: body.active_reward, availablePoints, resolveProgram });
  return { ...quote, available_points_after_reward: availablePoints - quote.points_required };
}

// Canonical reward checkout arithmetic. Customer input selects how many points
// or credits to spend, never the value of the reward or the product prices.
export async function priceRewardPayment(base44, email, quote, body, subscriptionPercent = 0) {
  const subtotal = cents(quote.subtotal);
  const rewardDiscount = cents(quote.reward_discount);
  const percent = Number(subscriptionPercent);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) fail('INVALID_SUBSCRIPTION_DISCOUNT', 'Your account discount could not be confirmed.');
  const subDiscount = Math.min(subtotal - rewardDiscount, Math.round(subtotal * percent / 100));
  const requestedPoints = integer(body.points_used ?? 0, 'INVALID_POINTS_SELECTION');
  if (requestedPoints !== cents(body.points_discount ?? 0)) fail('INVALID_POINTS_SELECTION', 'Please review your selected points discount.');
  if (requestedPoints > quote.available_points_after_reward) fail('INSUFFICIENT_REWARD_POINTS', 'The selected reward and points discount exceed your available points.');
  const afterSubscription = subtotal - rewardDiscount - subDiscount;
  if (requestedPoints > afterSubscription) fail('POINTS_EXCEED_ORDER_VALUE', 'Reduce the points discount to match the remaining merchandise total.');
  const requestedCredits = cents(body.credits_discount ?? 0);
  if (requestedCredits > afterSubscription - requestedPoints) fail('CREDITS_EXCEED_ORDER_VALUE', 'Reduce the credits to match the remaining merchandise total.');
  if (requestedCredits) {
    const rows = await base44.asServiceRole.entities.NuViraCredit.filter({ customer_email: email }, undefined, 2);
    if (!Array.isArray(rows) || rows.length !== 1) fail('CREDIT_BALANCE_UNAVAILABLE', 'Your credit balance could not be confirmed.');
    if (requestedCredits > cents(rows[0].balance)) fail('INSUFFICIENT_CHECKOUT_CREDITS', 'Your available credits changed. Please review checkout.');
  }
  return { merchandise_total: dollars(afterSubscription - requestedPoints - requestedCredits),
    points_used: requestedPoints, points_discount: dollars(requestedPoints),
    credits_discount: dollars(requestedCredits), reward_discount: dollars(rewardDiscount),
    subscription_discount: dollars(subDiscount), reservation_points: quote.points_required + requestedPoints };
}

export async function reservePaymentReward(base44, payment, quote, pricing, email, secret) {
  if (!secret || !payment?.id || !payment.metadata?.reward_reservation_id) {
    fail('REWARD_RESERVATION_UNAVAILABLE', 'We could not secure your reward for this payment.');
  }
  const response = await base44.asServiceRole.functions.invoke('enrollNewCustomerInLoyalty', {
    action: 'reserve_reward_checkout', customer_email: email,
    stripe_payment_intent_id: payment.id, reward_id: quote.active_reward.id,
    points: pricing.reservation_points, direct_points: pricing.points_used, internal_secret: secret,
  });
  const data = response?.data || response;
  if (data?.success !== true || !['held', 'consumed'].includes(data.reservation_status)) {
    fail('REWARD_RESERVATION_UNCONFIRMED', 'Your reward could not be secured. Payment was not started.');
  }
  return data;
}
