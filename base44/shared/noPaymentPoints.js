// Pure proof helpers. Provider metadata is trusted only after the caller's
// independent authenticated Stripe retrieval; a client request is never proof.
import { verifiedNoPaymentCreditMetadata, verifiedNoPaymentCreditSnapshot } from './noPaymentCredit.js';
export const NO_PAYMENT_POINTS_REVISION = '2026-09-09.no-payment-points-v1';
const check = value => { if (!value) throw new Error('no_payment_points_context_unconfirmed'); };
const cents = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
  && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001
  ? Math.round(value * 100) : NaN;

export function verifiedNoPaymentPointsMetadata(metadata) {
  if (metadata?.credit_reservation_id) {
    verifiedNoPaymentCreditMetadata(metadata);
    check(/^points:[a-f0-9]{64}$/.test(metadata.reward_reservation_id || '')
      && /^[1-9][0-9]*$/.test(metadata.no_payment_points || '') && Number.isSafeInteger(Number(metadata.no_payment_points)));
    return Number(metadata.no_payment_points);
  }
  check(metadata?.checkout_version === '4.0_reward_no_payment' && metadata.checkout_mode === 'account'
    && /^points:[a-f0-9]{64}$/.test(metadata.reward_reservation_id || '')
    && /^[a-f0-9]{64}$/.test(metadata.checkout_context_hash || '')
    && /^[1-9][0-9]*$/.test(metadata.no_payment_points || '')
    && !metadata.credit_reservation_id && !metadata.birthday_reservation_id
    && metadata.is_test_order !== 'true' && metadata.internal_sandbox_checkout !== 'true');
  const points = Number(metadata.no_payment_points);
  check(Number.isSafeInteger(points) && points > 0);
  return points;
}

export function verifiedNoPaymentPointsSnapshot(data, metadata) {
  if (metadata?.credit_reservation_id) return verifiedNoPaymentCreditSnapshot(data, metadata).points;
  const points = verifiedNoPaymentPointsMetadata(metadata);
  check(data?.no_payment_points_revision === NO_PAYMENT_POINTS_REVISION
    && data.points_reservation_revision === '2026-09-08.direct-points-v1'
    && data.customer_email === metadata.customer_email && data.order_number === metadata.order_number
    && data.checkout_context_hash === metadata.checkout_context_hash
    && data.reward_reservation_id === metadata.reward_reservation_id
    && data.points_used === points && data.reward_reservation_points === points
    && cents(data.points_discount) === points && data.total === 0 && data.delivery_fee === 0
    && data.guest_checkout === false && data.internal_sandbox_checkout === false
    && !data.active_reward && !data.reward_checkout && !data.birthday_checkout && !data.birthday_reservation_id
    && !data.credit_reservation_id && cents(data.credits_discount ?? 0) === 0
    && cents(data.reward_discount ?? 0) === 0 && cents(data.birthday_discount ?? 0) === 0
    && cents(data.promotion_discount_amount ?? 0) === 0 && cents(data.referral_discount ?? 0) === 0
    && Array.isArray(data.items) && data.items.length > 0 && data.items.length <= 50);
  let subtotal = 0;
  for (const item of data.items) {
    check(typeof item.product_id === 'string' && item.product_id && !item.product_id.startsWith('__')
      && !item.isFreeReward && !item.reward_id && !item.isBirthdayReward && !item.birthday_product_id
      && Number.isSafeInteger(item.quantity) && item.quantity > 0 && item.quantity <= 100 && cents(item.price) > 0);
    subtotal += cents(item.price) * item.quantity;
  }
  check(Number.isSafeInteger(subtotal) && cents(data.subtotal) === subtotal
    && cents(data.subscription_discount ?? 0) + points === subtotal
    && cents(data.total_discounts) === subtotal);
  return points;
}

// A selected tier can cover its earned items while points cover additional
// merchandise. Both costs belong to one consumed reservation, not two debits.
export function verifiedNoPaymentTierPointsSnapshot(data, metadata) {
  if (metadata?.credit_reservation_id) return verifiedNoPaymentCreditSnapshot(data, metadata).points;
  const quote = data?.reward_checkout;
  check(metadata?.checkout_version === '4.0_reward_no_payment' && metadata.checkout_mode === 'account'
    && /^reward:[a-f0-9]{64}$/.test(metadata.reward_reservation_id || '')
    && /^[a-f0-9]{64}$/.test(metadata.checkout_context_hash || '')
    && data.customer_email === metadata.customer_email && data.order_number === metadata.order_number
    && data.checkout_context_hash === metadata.checkout_context_hash && data.reward_reservation_id === metadata.reward_reservation_id
    && !metadata.credit_reservation_id && !metadata.birthday_reservation_id && !metadata.no_payment_points
    && metadata.is_test_order !== 'true' && metadata.internal_sandbox_checkout !== 'true'
    && data.guest_checkout === false && data.internal_sandbox_checkout === false
    && data.total === 0 && data.delivery_fee === 0 && !data.credit_reservation_id && !data.birthday_reservation_id
    && !data.birthday_checkout && cents(data.credits_discount ?? 0) === 0 && cents(data.birthday_discount ?? 0) === 0
    && cents(data.promotion_discount_amount ?? 0) === 0 && cents(data.referral_discount ?? 0) === 0
    && quote?.revision === '2026-09-08.reward-checkout-v1' && quote.active_reward?.id
    && JSON.stringify(quote.active_reward) === JSON.stringify(data.active_reward)
    && Number.isSafeInteger(quote.points_required) && quote.points_required > 0
    && quote.points_required === data.active_reward.points_required
    && Number.isSafeInteger(data.points_used) && data.points_used > 0
    && data.reward_reservation_points === quote.points_required + data.points_used
    && cents(data.points_discount) === data.points_used
    && Array.isArray(data.items) && data.items.length > 0 && data.items.length <= 50
    && JSON.stringify(quote.items) === JSON.stringify(data.items));
  let net = 0; let earned = 0;
  for (const item of data.items) {
    check(typeof item.product_id === 'string' && item.product_id && !item.product_id.startsWith('__')
      && Number.isSafeInteger(item.quantity) && item.quantity > 0 && item.quantity <= 100
      && !item.isBirthdayReward && !item.birthday_product_id && Number.isSafeInteger(cents(item.price)));
    if (item.isFreeReward) {
      check(item.price === 0 && item.reward_id === data.active_reward.id && cents(item.catalog_unit_price) > 0
        && cents(item.reward_discount_amount) === cents(item.catalog_unit_price) * item.quantity);
      earned += cents(item.reward_discount_amount);
    } else check(!item.reward_id && cents(item.price) > 0);
    net += cents(item.price) * item.quantity;
  }
  check(Number.isSafeInteger(net) && Number.isSafeInteger(earned)
    && cents(data.subtotal) === net && cents(quote.subtotal) === net
    && cents(quote.catalog_subtotal) === net + earned && cents(quote.reward_item_discount) === earned
    && cents(quote.reward_discount) === cents(data.reward_discount)
    && cents(quote.merchandise_total) === net - cents(data.reward_discount)
    && cents(data.reward_discount) + cents(data.subscription_discount ?? 0) + data.points_used === net
    && cents(data.total_discounts) === net);
  return data.reward_reservation_points;
}
