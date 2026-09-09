import { birthdayAvailability, birthdayReservationState, assertBirthdayWindow, birthdayReservationBinding, BIRTHDAY_ENTITLEMENT_REVISION, BirthdayEntitlementError } from '../../shared/birthdayEntitlement.js';
import { readPointsAccount, reserveBirthdayGift, settleBirthdayGift } from '../enrollNewCustomerInLoyalty/pointsAccount.js';
import { quoteCatalogCheckout } from './rewardCheckout.js';

// Not routed by an entrypoint yet. Callers must use authenticated server identity,
// and integrate reservation, cancellation, webhook, recovery and UI together.
const fail = code => { throw new BirthdayEntitlementError(code); };
const assert = (value, code = 'birthday_checkout_context_unconfirmed') => { if (!value) fail(code); };
const marked = item => item?.isBirthdayReward === true || Boolean(item?.birthday_product_id)
  || item?.product_id === '__birthday_reward__';
const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
  && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001
  ? Math.round(value * 100) : NaN;
const one = rows => { assert(Array.isArray(rows) && rows.length === 1 && rows[0]?.id); return rows[0]; };

async function birthdayHistoryNeedsReview(entities, email, account) {
  // No implicit migration: old free-order markers are not a server-issued annual
  // receipt. Review/migrate historical gifts with exact order/provider proof
  // before enabling this path for affected accounts. A capped read is incomplete.
  const holds = birthdayReservationState(account).holds;
  for (const name of ['Order', 'CheckoutSession']) {
    const rows = await entities[name].filter({ customer_email: email }, '-created_date', 250);
    if (!Array.isArray(rows) || rows.length >= 250) return true;
    const ids = new Set();
    for (const row of rows) {
      if (!row?.id || row.customer_email !== email || ids.has(row.id)) return true;
      ids.add(row.id);
      const data = name === 'Order' ? row : row.checkout_data;
      if (row.is_test_order === true || data?.internal_sandbox_checkout === true) continue;
      if (!Array.isArray(data?.items)) return true;
      const gifts = data.items.filter(item => marked(item) || /birthday|🎂/i.test(String(item?.title || '')));
      if (!gifts.length) continue;
      const providerId = name === 'Order' ? row.stripe_payment_intent_id : row.stripe_session_id;
      const hold = holds.find(item => item.payment_intent_id === providerId);
      if (gifts.length !== 1 || !hold || gifts[0].product_id !== hold.product_id
        || gifts[0].birthday_product_id !== hold.product_id || gifts[0].isBirthdayReward !== true
        || gifts[0].quantity !== 1 || gifts[0].price !== 0) return true;
      if (name === 'CheckoutSession' && (data.birthday_checkout?.revision !== BIRTHDAY_ENTITLEMENT_REVISION
        || data.birthday_reservation_id !== hold.reservation_id || data.checkout_context_hash !== hold.context_hash)) return true;
      if (name === 'Order' && hold.status === 'released'
        && (row.payment_captured === true || [row.payment_status, row.financial_status]
          .some(status => ['paid', 'succeeded', 'refunded', 'partially_refunded'].includes(status)))) return true;
    }
  }
  return false;
}

export async function readBirthdayCheckoutEligibility(entities, authenticatedUser, now = Date.now()) {
  const email = String(authenticatedUser?.email || '').trim().toLowerCase();
  assert(authenticatedUser?.id && email.includes('@'), 'birthday_sign_in_required');
  const profiles = await entities.UserProfile.filter({ customer_email: email }, undefined, 2);
  assert(Array.isArray(profiles) && profiles.length <= 1
    && profiles.every(row => row?.id && row.customer_email === email), 'birthday_profile_read_unconfirmed');
  const identity = { userId: authenticatedUser.id,
    birthday: profiles[0]?.birthday || authenticatedUser.birthday || null,
    signupDate: authenticatedUser.created_date };
  const account = await readPointsAccount(entities, email);
  assert(account.customer_email === email, 'birthday_owner_mismatch');
  const eligibility = birthdayAvailability(account, identity, now);
  if (eligibility.eligible && await birthdayHistoryNeedsReview(entities, email, account)) {
    return { identity, eligibility: { ...eligibility, eligible: false, status: 'birthday_history_review_required' } };
  }
  return { identity, eligibility };
}

export function quoteBirthdayCatalogCheckout({ items, products, eligibility, resolveProgram, decorateItem }) {
  assert(eligibility?.eligible === true && eligibility.status === 'available', 'birthday_not_available');
  assertBirthdayWindow(eligibility);
  assert(Array.isArray(items) && items.length <= 50, 'birthday_selection_invalid');
  const selected = items.filter(marked);
  assert(selected.length === 1 && selected[0].quantity === 1 && selected[0].price === 0
    && typeof selected[0].birthday_product_id === 'string'
    && !selected[0].birthday_product_id.startsWith('__')
    && ['__birthday_reward__', selected[0].birthday_product_id].includes(selected[0].product_id)
    && !selected[0].isFreeReward && !selected[0].reward_id, 'birthday_selection_invalid');
  const gift = selected[0];
  const matches = Array.isArray(products) ? products.filter(product => product.id === gift.birthday_product_id) : [];
  assert(matches.length === 1, 'birthday_product_unavailable');
  const product = matches[0];
  assert(product.is_available === true && product.category === 'juice'
    && /^(12oz|12floz|355ml)$/.test(String(product.size || '').toLowerCase().replace(/\s+/g, ''))
    && money(product.price) > 0, 'birthday_product_ineligible');
  const giftIndex = items.indexOf(gift);
  // The ordinary catalog validator still verifies every paid/program item and
  // physical minimum. Only this one server-eligible line becomes complimentary.
  const catalog = quoteCatalogCheckout({ products, resolveProgram, decorateItem,
    items: items.map((item, index) => index === giftIndex
      ? { product_id: product.id, quantity: 1, price: product.price } : item) });
  const retailCents = money(product.price);
  const birthday = { revision: BIRTHDAY_ENTITLEMENT_REVISION, product_id: product.id,
    retail_value_cents: retailCents, cycle_year: eligibility.cycle_year, month_day: eligibility.month_day,
    window_start: eligibility.window_start, window_end: eligibility.window_end };
  return { ...catalog, subtotal: (money(catalog.subtotal) - retailCents) / 100,
    birthday_discount: retailCents / 100, birthday_checkout: birthday,
    items: catalog.items.map((item, index) => index === giftIndex ? { ...item, price: 0,
      isBirthdayReward: true, birthday_product_id: product.id, catalog_unit_price: product.price,
      birthday_discount_amount: product.price, cart_line_key: `birthday:${product.id}` } : item) };
}

// Fresh provider retrieval plus protected snapshot proof, not request-body
// payment status or an email-only lookup. No confirm/capture/refund/cancel call.
// Paid-PI support only: cashless/route-review integration remains a release gate.
export async function readVerifiedBirthdayPayment({ entities, stripe, customerEmail, paymentIntentId }) {
  assert(typeof customerEmail === 'string' && customerEmail === customerEmail.trim().toLowerCase()
    && customerEmail.includes('@') && /^pi_[A-Za-z0-9_]+$/.test(paymentIntentId || ''));
  const payment = await stripe.paymentIntents.retrieve(paymentIntentId);
  const meta = payment?.metadata || {};
  assert(payment?.id === paymentIntentId && payment.livemode === true && payment.currency === 'usd'
    && meta.checkout_mode === 'account' && meta.checkout_version === '3.0_embedded'
    && meta.customer_email === customerEmail && meta.internal_sandbox_checkout !== 'true'
    && meta.is_test_order !== 'true' && /^[a-f0-9]{64}$/.test(meta.checkout_context_hash || '')
    && Number.isSafeInteger(payment.amount) && payment.amount >= 50
    && ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture', 'succeeded', 'canceled'].includes(payment.status));
  const session = one(await entities.CheckoutSession.filter({ stripe_session_id: payment.id }, undefined, 2));
  const order = one(await entities.Order.filter({ stripe_payment_intent_id: payment.id }, undefined, 2));
  const data = session.checkout_data;
  for (const row of [session, order, data]) assert(row?.customer_email === customerEmail && row.order_number === meta.order_number);
  assert(typeof meta.order_number === 'string' && /^NV-[A-F0-9]{24}$/.test(meta.order_number)
    && one(await entities.Order.filter({ order_number: meta.order_number }, undefined, 2)).id === order.id
    && one(await entities.CheckoutSession.filter({ order_number: meta.order_number }, undefined, 2)).id === session.id);
  assert(data.guest_checkout === false && data.internal_sandbox_checkout !== true && !data.sandbox_test_id
    && order.is_test_order !== true && order.internal_sandbox_checkout !== true
    && order.status !== 'refunded' && !['refunded', 'partially_refunded'].includes(order.payment_status)
    && data.checkout_context_hash === meta.checkout_context_hash && money(data.total) === payment.amount
    && money(order.total) === payment.amount && typeof data.customer_app_user_id === 'string' && data.customer_app_user_id);
  if (payment.status === 'succeeded') assert(payment.amount_received === payment.amount
    && !['canceled', 'cancelled'].includes(order.status));
  else if (payment.status !== 'canceled') assert(order.status === 'pending_payment'
    && order.payment_status === 'pending' && order.payment_captured === false);
  else assert(order.payment_captured === false && ['pending_payment', 'cancelled', 'canceled'].includes(order.status)
    && ['pending', 'cancelled', 'canceled'].includes(order.payment_status));
  const snapshot = data.birthday_checkout;
  assert(snapshot?.revision === BIRTHDAY_ENTITLEMENT_REVISION
    && /^birthday:[a-f0-9]{64}$/.test(data.birthday_reservation_id || '')
    && Number.isSafeInteger(snapshot.retail_value_cents) && snapshot.retail_value_cents > 0
    && money(data.birthday_discount) === snapshot.retail_value_cents);
  for (const items of [data.items, order.items]) {
    assert(Array.isArray(items) && items.length > 0 && items.length <= 50);
    const gifts = items.filter(marked);
    assert(gifts.length === 1);
    const gift = gifts[0];
    assert(gift.product_id === snapshot.product_id && gift.birthday_product_id === snapshot.product_id
      && gift.isBirthdayReward === true && gift.quantity === 1 && gift.price === 0
      && gift.category === 'juice' && typeof gift.title === 'string' && gift.title.trim()
      && /^(12oz|12floz|355ml)$/.test(String(gift.size || '').toLowerCase().replace(/\s+/g, ''))
      && money(gift.catalog_unit_price) === snapshot.retail_value_cents
      && money(gift.birthday_discount_amount) === snapshot.retail_value_cents
      && !gift.isFreeReward && !gift.reward_id);
  }
  const request = { reservation_id: data.birthday_reservation_id,
    context_hash: meta.checkout_context_hash, customer_app_user_id: data.customer_app_user_id,
    product_id: snapshot.product_id, retail_value_cents: snapshot.retail_value_cents,
    cycle_year: snapshot.cycle_year, month_day: snapshot.month_day,
    window_start: snapshot.window_start, window_end: snapshot.window_end,
    payment_intent_id: payment.id, provider_status: payment.status };
  birthdayReservationBinding(request);
  return { payment, request };
}

// These coordinators are internal helpers, not HTTP actions. Their eventual
// entrypoint callers must retain existing authenticated/internal-secret checks.
export async function reserveVerifiedBirthdayCheckout({ entities, stripe, authenticatedUser, paymentIntentId, now = Date.now() }) {
  const customerEmail = String(authenticatedUser?.email || '').trim().toLowerCase();
  assert(authenticatedUser?.id && customerEmail.includes('@'), 'birthday_sign_in_required');
  const verified = await readVerifiedBirthdayPayment({ entities, stripe, customerEmail, paymentIntentId });
  assert(verified.request.customer_app_user_id === authenticatedUser.id, 'birthday_owner_mismatch');
  const read = await readBirthdayCheckoutEligibility(entities, authenticatedUser, now);
  // Preparation's own protected Order/CheckoutSession may exist before its CAS.
  // Check other historical evidence separately; never let the just-created
  // birthday line hide a previous unreconciled legacy gift.
  if (read.eligibility.status === 'birthday_history_review_required') {
    const account = await readPointsAccount(entities, customerEmail);
    const expected = { ...verified.request, status: 'held', created_at: new Date(now).toISOString() };
    const withExpectedHold = { ...account, birthday_reservations: [...birthdayReservationState(account).holds, expected] };
    if (await birthdayHistoryNeedsReview(entities, customerEmail, withExpectedHold)) fail('birthday_history_review_required');
  }
  const result = await reserveBirthdayGift(entities, customerEmail, verified.request, read.identity, now);
  return { success: true, revision: BIRTHDAY_ENTITLEMENT_REVISION,
    reservation_status: result.reservation.status, idempotent: result.idempotent };
}

export async function settleVerifiedBirthdayCheckout({ entities, stripe, customerEmail, paymentIntentId, now = Date.now() }) {
  const verified = await readVerifiedBirthdayPayment({ entities, stripe, customerEmail, paymentIntentId });
  if (!['succeeded', 'canceled'].includes(verified.payment.status)) {
    return { success: true, deferred: true, revision: BIRTHDAY_ENTITLEMENT_REVISION,
      reason: 'payment_still_retryable', writes_performed: false };
  }
  const result = await settleBirthdayGift(entities, customerEmail, verified.request, now);
  return { success: true, revision: BIRTHDAY_ENTITLEMENT_REVISION,
    reservation_status: result.reservation.status, idempotent: result.idempotent };
}
