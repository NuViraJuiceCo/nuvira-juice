import { birthdayReservationBinding, BIRTHDAY_ENTITLEMENT_REVISION } from './birthdayEntitlement.js';
export const NO_PAYMENT_BIRTHDAY_REVISION = '2026-09-09.no-payment-birthday-v1';
const check = value => { if (!value) throw new Error('no_payment_birthday_proof_unconfirmed'); };
const cents = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
  && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001
  ? Math.round(value * 100) : NaN;
export function noPaymentBirthdayMetadata(data) {
  const b = data.birthday_checkout;
  return JSON.stringify({ revision: NO_PAYMENT_BIRTHDAY_REVISION, user: data.customer_app_user_id,
    product: b.product_id, cents: b.retail_value_cents, year: b.cycle_year,
    day: b.month_day, start: b.window_start, end: b.window_end });
}
export function verifiedNoPaymentBirthdayMetadata(meta, sessionId = 'cs_proof_shape_only') {
  check(meta?.checkout_version === '4.0_reward_no_payment' && meta.checkout_mode === 'account'
    && meta.internal_sandbox_checkout !== 'true' && meta.is_test_order !== 'true'
    && typeof meta.customer_email === 'string' && meta.customer_email.includes('@')
    && typeof meta.order_number === 'string' && meta.order_number
    && /^(points|credit):[a-f0-9]{64}$/.test(meta.reward_reservation_id || '')
    && typeof meta.no_payment_birthday === 'string' && meta.no_payment_birthday.length <= 500);
  let b; try { b = JSON.parse(meta.no_payment_birthday); } catch { check(false); }
  check(b?.revision === NO_PAYMENT_BIRTHDAY_REVISION);
  return birthdayReservationBinding({ reservation_id: meta.birthday_reservation_id,
    context_hash: meta.checkout_context_hash, customer_app_user_id: b.user,
    product_id: b.product, retail_value_cents: b.cents, cycle_year: b.year, month_day: b.day,
    window_start: b.start, window_end: b.end, checkout_session_id: sessionId });
}
export function verifiedNoPaymentBirthdaySnapshot(data, meta) {
  const request = verifiedNoPaymentBirthdayMetadata(meta);
  const points = data?.points_used;
  const credit = cents(data?.credits_discount);
  check(data?.no_payment_birthday_revision === NO_PAYMENT_BIRTHDAY_REVISION
    && data.birthday_checkout?.revision === BIRTHDAY_ENTITLEMENT_REVISION
    && noPaymentBirthdayMetadata(data) === meta.no_payment_birthday
    && data.birthday_reservation_id === meta.birthday_reservation_id
    && data.customer_email === meta.customer_email && data.order_number === meta.order_number
    && data.checkout_context_hash === meta.checkout_context_hash && data.reward_reservation_id === meta.reward_reservation_id
    && data.customer_app_user_id === request.customer_app_user_id
    && data.guest_checkout === false && data.internal_sandbox_checkout === false
    && !data.active_reward && !data.reward_checkout && cents(data.reward_discount ?? 0) === 0
    && cents(data.promotion_discount_amount ?? 0) === 0 && cents(data.referral_discount ?? 0) === 0
    && data.total === 0 && data.delivery_fee === 0 && cents(data.tax ?? 0) === 0 && cents(data.tax_amount ?? 0) === 0
    && Number.isSafeInteger(points) && points >= 0 && data.reward_reservation_points === points
    && cents(data.points_discount) === points && Number.isSafeInteger(credit) && points + credit > 0
    && (points > 0 ? meta.reward_reservation_id.startsWith('points:') && meta.no_payment_points === String(points)
      && data.points_reservation_revision === '2026-09-08.direct-points-v1' : !meta.no_payment_points)
    && (credit > 0 ? data.credit_reservation_revision === '2026-09-08.credit-reservation-v1'
      && /^credit:[a-f0-9]{64}$/.test(data.credit_reservation_id || '')
      && meta.credit_reservation_id === data.credit_reservation_id && meta.credit_reservation_cents === String(credit)
      && (points > 0 || meta.reward_reservation_id === data.credit_reservation_id)
      : !data.credit_reservation_id && !meta.credit_reservation_id)
    && Array.isArray(data.items) && data.items.length > 0 && data.items.length <= 50);
  let net = 0; let gifts = 0;
  for (const item of data.items) {
    check(typeof item.product_id === 'string' && item.product_id && !item.product_id.startsWith('__')
      && !item.isFreeReward && !item.reward_id && Number.isSafeInteger(item.quantity)
      && item.quantity > 0 && item.quantity <= 100);
    if (item.isBirthdayReward || item.birthday_product_id) {
      gifts++;
      check(item.isBirthdayReward === true && item.birthday_product_id === request.product_id
        && item.product_id === request.product_id && item.quantity === 1 && item.price === 0
        && item.category === 'juice' && /^(?:(?:12oz|12floz)(?:\/355ml)?|355ml)$/.test(String(item.size).toLowerCase().replace(/\s+/g, ''))
        && cents(item.catalog_unit_price) === request.retail_value_cents
        && cents(item.birthday_discount_amount) === request.retail_value_cents);
    } else check(cents(item.price) > 0);
    net += cents(item.price) * item.quantity;
  }
  check(gifts === 1 && Number.isSafeInteger(net) && cents(data.subtotal) === net
    && cents(data.birthday_discount) === request.retail_value_cents
    && cents(data.catalog_subtotal) === net + request.retail_value_cents
    && points + credit + cents(data.subscription_discount ?? 0) === net && cents(data.total_discounts) === net);
  return { points, credit_cents: credit, birthday: request };
}
