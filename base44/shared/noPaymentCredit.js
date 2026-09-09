// Pure proof for credit-covered merchandise. Only callers that independently
// retrieve Stripe may treat metadata as authority. No provider/storage writes.
export const NO_PAYMENT_CREDIT_REVISION = '2026-09-09.no-payment-credit-v1';
const check = value => { if (!value) throw new Error('no_payment_credit_context_unconfirmed'); };
const cents = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
  && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001
  ? Math.round(value * 100) : NaN;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function verifiedNoPaymentCreditMetadata(meta) {
  check(meta?.checkout_version === '4.0_reward_no_payment' && meta.checkout_mode === 'account'
    && /^credit:[a-f0-9]{64}$/.test(meta.credit_reservation_id || '')
    && /^[a-f0-9]{64}$/.test(meta.checkout_context_hash || '')
    && /^[1-9][0-9]*$/.test(meta.credit_reservation_cents || '')
    && Number.isSafeInteger(Number(meta.credit_reservation_cents))
    && /^(reward|points|credit):[a-f0-9]{64}$/.test(meta.reward_reservation_id || '')
    && (!meta.reward_reservation_id.startsWith('credit:') || meta.reward_reservation_id === meta.credit_reservation_id)
    && typeof meta.customer_email === 'string' && meta.customer_email.includes('@')
    && typeof meta.order_number === 'string' && meta.order_number
    && !meta.birthday_reservation_id && meta.is_test_order !== 'true' && meta.internal_sandbox_checkout !== 'true');
  return Number(meta.credit_reservation_cents);
}
export function verifiedNoPaymentCreditSnapshot(data, meta) {
  const credit = verifiedNoPaymentCreditMetadata(meta);
  check(data?.no_payment_credit_revision === NO_PAYMENT_CREDIT_REVISION
    && data.credit_reservation_revision === '2026-09-08.credit-reservation-v1'
    && data.customer_email === meta.customer_email && data.order_number === meta.order_number
    && data.checkout_context_hash === meta.checkout_context_hash
    && data.reward_reservation_id === meta.reward_reservation_id && data.credit_reservation_id === meta.credit_reservation_id
    && cents(data.credits_discount) === credit && data.total === 0 && data.delivery_fee === 0
    && data.guest_checkout === false && data.internal_sandbox_checkout === false
    && !data.birthday_checkout && !data.birthday_reservation_id && cents(data.birthday_discount ?? 0) === 0
    && cents(data.tax ?? 0) === 0 && cents(data.tax_amount ?? 0) === 0
    && cents(data.promotion_discount_amount ?? 0) === 0 && cents(data.referral_discount ?? 0) === 0
    && Number.isSafeInteger(data.points_used) && data.points_used >= 0
    && cents(data.points_discount) === data.points_used
    && Array.isArray(data.items) && data.items.length > 0 && data.items.length <= 50);
  const tier = data.active_reward;
  if (tier) check(meta.reward_reservation_id.startsWith('reward:')
    && data.reward_checkout?.revision === '2026-09-08.reward-checkout-v1'
    && same(tier, data.reward_checkout.active_reward) && same(data.items, data.reward_checkout.items)
    && Number.isSafeInteger(tier.points_required) && tier.points_required > 0
    && data.reward_checkout.points_required === tier.points_required);
  else check(!data.reward_checkout && cents(data.reward_discount ?? 0) === 0
    && meta.reward_reservation_id.startsWith(data.points_used > 0 ? 'points:' : 'credit:')
    && (data.points_used === 0 ? !meta.no_payment_points
      : meta.no_payment_points === String(data.points_used) && data.points_reservation_revision === '2026-09-08.direct-points-v1'));
  const points = (tier ? tier.points_required : 0) + data.points_used;
  check(Number.isSafeInteger(points) && data.reward_reservation_points === points);
  let net = 0; let earned = 0;
  for (const item of data.items) {
    check(typeof item.product_id === 'string' && item.product_id && !item.product_id.startsWith('__')
      && Number.isSafeInteger(item.quantity) && item.quantity > 0 && item.quantity <= 100
      && !item.isBirthdayReward && !item.birthday_product_id && Number.isSafeInteger(cents(item.price)));
    if (item.isFreeReward) {
      check(tier && item.reward_id === tier.id && item.price === 0 && cents(item.catalog_unit_price) > 0
        && cents(item.reward_discount_amount) === cents(item.catalog_unit_price) * item.quantity);
      earned += cents(item.reward_discount_amount);
    } else check(!item.reward_id && cents(item.price) > 0);
    net += cents(item.price) * item.quantity;
  }
  check(Number.isSafeInteger(net) && Number.isSafeInteger(earned) && cents(data.subtotal) === net
    && cents(data.reward_discount ?? 0) + cents(data.subscription_discount ?? 0) + data.points_used + credit === net
    && cents(data.total_discounts) === net);
  if (tier) check(cents(data.reward_checkout.subtotal) === net && cents(data.reward_checkout.catalog_subtotal) === net + earned
    && cents(data.reward_checkout.reward_item_discount) === earned
    && cents(data.reward_checkout.reward_discount) === cents(data.reward_discount)
    && cents(data.reward_checkout.merchandise_total) === net - cents(data.reward_discount));
  return { points, credit_cents: credit };
}
