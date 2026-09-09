// A zero-cash order is not a captured card payment. This receipt is created only
// after Stripe completion and the existing central points ledger both confirm it.
import { verifiedNoPaymentPointsSnapshot, verifiedNoPaymentTierPointsSnapshot } from '../../shared/noPaymentPoints.js';
import { verifiedNoPaymentCreditSnapshot } from '../../shared/noPaymentCredit.js';
import { settleNoPaymentCheckoutCredit } from '../../shared/checkoutCredit.js';
import { verifiedNoPaymentBirthdaySnapshot } from '../../shared/noPaymentBirthday.js';
import { settleNoPaymentBirthdayCheckout } from '../createPaymentIntent/birthdayCheckout.js';
import { noPaymentRouteOutcome } from '../../shared/routeReview.js';
export const REWARD_SETTLEMENT_REVISION = '2026-09-08.reward-settlement-v1';

export function isVerifiedNoPaymentOrder(order) {
  const receipt = order?.reward_settlement;
  return Boolean(order?.id && order?.customer_email && order?.order_number
    && order.total === 0 && order.payment_captured === false
    && order.payment_status === 'paid' && order.financial_status === 'paid'
    && order.is_test_order !== true && order.is_abandoned_checkout !== true && order.do_not_recover !== true
    && !['pending_payment', 'cancelled', 'canceled', 'failed', 'refunded'].includes(order.status)
    && !order.stripe_payment_intent_id && !(Number(order.amount_refunded || 0) > 0)
    && (receipt?.revision === '2026-09-08.reward-settlement-v1'
    || (receipt?.revision === '2026-09-09.credit-settlement-v2'
      && /^credit:[a-f0-9]{64}$/.test(receipt.credit_reservation_id || '')
      && Number.isSafeInteger(receipt.credit_redeemed_cents) && receipt.credit_redeemed_cents > 0
      && (receipt.points_redeemed === 0 ? receipt.reservation_id === receipt.credit_reservation_id
        : /^(points|reward):[a-f0-9]{64}$/.test(receipt.reservation_id || ''))))
    && /^cs_[A-Za-z0-9_]+$/.test(order.stripe_checkout_session_id || '')
    && receipt.checkout_session_id === order.stripe_checkout_session_id
    && /^[a-f0-9]{64}$/.test(receipt.context_hash || '')
    && typeof receipt.reservation_id === 'string' && receipt.reservation_id.length > 0
    && (() => {
      const gifts = (Array.isArray(order.items) ? order.items : []).filter(item => item.isBirthdayReward || item.birthday_product_id);
      if (!gifts.length) return !receipt.birthday_reservation_id && !receipt.birthday_product_id && !receipt.birthday_retail_cents;
      const gift = gifts[0];
      return gifts.length === 1 && /^birthday:[a-f0-9]{64}$/.test(receipt.birthday_reservation_id || '')
        && gift.isBirthdayReward === true && gift.quantity === 1 && gift.price === 0
        && gift.product_id === receipt.birthday_product_id && gift.birthday_product_id === receipt.birthday_product_id
        && Number.isSafeInteger(receipt.birthday_retail_cents) && receipt.birthday_retail_cents > 0
        && Math.round(gift.catalog_unit_price * 100) === receipt.birthday_retail_cents
        && Math.round(gift.birthday_discount_amount * 100) === receipt.birthday_retail_cents;
    })()
    && Number.isSafeInteger(receipt.points_redeemed)
    && receipt.points_redeemed >= (receipt.revision === '2026-09-09.credit-settlement-v2' ? 0 : 1)
    && /^evt_[A-Za-z0-9_]+$/.test(receipt.provider_event_id || '')
    && typeof receipt.settled_at === 'string' && Number.isFinite(Date.parse(receipt.settled_at)));
}

const noPaymentVersion = '4.0_reward_no_payment';
const normalizedEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function requireExact(condition, code) { if (!condition) throw new Error(code); }
function terminal(order) {
  return ['cancelled', 'canceled', 'refunded', 'failed'].includes(order?.status)
    || ['refunded', 'failed'].includes(order?.payment_status) || ['refunded', 'failed'].includes(order?.financial_status)
    || order?.is_abandoned_checkout === true || order?.do_not_recover === true || Number(order?.amount_refunded || 0) > 0;
}

// Expects a signature-verified event; still retrieves Stripe independently to
// guard replay/order and refuses to reconstruct missing checkout data from input.
// Handoff is persisted separately. No email, push, Shopify write, cash earning or
// advertising Purchase is performed by this settlement function.
export async function finalizeNoPaymentRewardOrder({ entities, stripe, event, settleReservation, verifySchedule }) {
  requireExact(event?.type === 'checkout.session.completed' && event.livemode === true
    && /^evt_[A-Za-z0-9_]+$/.test(event.id || '') && Number.isSafeInteger(event.created) && event.created > 0,
  'reward_completion_event_invalid');
  const eventSession = event.data?.object;
  requireExact(/^cs_[A-Za-z0-9_]+$/.test(eventSession?.id || '')
    && eventSession?.metadata?.checkout_version === noPaymentVersion, 'reward_completion_session_invalid');
  requireExact(typeof entities.Order?.updateMany === 'function', 'conditional_order_updates_unavailable');
  const session = await stripe.checkout.sessions.retrieve(eventSession.id);
  const metadata = session?.metadata || {};
  requireExact(await noPaymentRouteOutcome(entities, session) === 'consumed', 'route_review_approval_required');
  requireExact(session?.id === eventSession.id && session.livemode === true && session.currency === 'usd'
    && session.mode === 'payment' && session.status === 'complete' && session.payment_status === 'no_payment_required'
    && session.amount_total === 0 && session.payment_intent === null
    && metadata.checkout_version === noPaymentVersion && metadata.checkout_mode === 'account'
    && metadata.internal_sandbox_checkout !== 'true' && metadata.is_test_order !== 'true', 'reward_provider_completion_unconfirmed');
  const email = normalizedEmail(metadata.customer_email);
  requireExact(email && normalizedEmail(session.customer_email) === email
    && (!session.customer_details?.email || normalizedEmail(session.customer_details.email) === email)
    && /^[a-f0-9]{64}$/.test(metadata.checkout_context_hash || '')
    && metadata.reward_reservation_id && metadata.order_number, 'reward_provider_identity_invalid');
  // A signed event from another revision/context cannot settle the latest record.
  for (const key of ['checkout_version', 'checkout_context_hash', 'reward_reservation_id', 'order_number', 'customer_email', 'no_payment_points', 'credit_reservation_id', 'credit_reservation_cents', 'birthday_reservation_id', 'no_payment_birthday']) {
    requireExact(eventSession.metadata[key] === metadata[key], 'reward_event_context_mismatch');
  }
  const orders = await entities.Order.filter({ stripe_checkout_session_id: session.id }, '-created_date', 2);
  const contexts = await entities.CheckoutSession.filter({ stripe_session_id: session.id }, '-created_date', 2);
  requireExact(Array.isArray(orders) && orders.length === 1 && orders[0]?.id, 'reward_order_not_unique');
  requireExact(Array.isArray(contexts) && contexts.length === 1 && contexts[0]?.id, 'reward_checkout_context_not_unique');
  let order = orders[0];
  const context = contexts[0];
  const data = context.checkout_data;
  const directOnly = /^points:[a-f0-9]{64}$/.test(metadata.reward_reservation_id || '');
  const creditCovered = Boolean(metadata.credit_reservation_id);
  const benefits = creditCovered ? verifiedNoPaymentCreditSnapshot(data, metadata) : null;
  const birthday = metadata.birthday_reservation_id ? verifiedNoPaymentBirthdaySnapshot(data, metadata).birthday : null;
  if (creditCovered) { /* Complete private priced proof was checked above. */ }
  else if (directOnly) verifiedNoPaymentPointsSnapshot(data, metadata);
  else if (data?.points_used > 0) verifiedNoPaymentTierPointsSnapshot(data, metadata);
  requireExact(data && normalizedEmail(order.customer_email) === email && normalizedEmail(context.customer_email) === email
    && normalizedEmail(data.customer_email) === email && order.order_number === metadata.order_number
    && context.order_number === order.order_number && data.order_number === order.order_number
    && data.checkout_context_hash === metadata.checkout_context_hash
    && data.reward_reservation_id === metadata.reward_reservation_id
    && (creditCovered || directOnly || (data.reward_checkout?.revision === '2026-09-08.reward-checkout-v1'
      && data.reward_checkout.active_reward?.id === data.active_reward?.id))
    && Number.isSafeInteger(data.reward_reservation_points) && data.reward_reservation_points >= (creditCovered ? 0 : 1)
    && data.reward_reservation_points === Number(data.active_reward?.points_required || 0) + Number(data.points_used || 0)
    && data.total === 0 && order.total === 0 && order.payment_captured === false && !order.stripe_payment_intent_id
    && (data.bag_return_request_id || null) === (order.bag_return_request_id || null)
    && (data.bag_return_request_id || null) === (metadata.bag_return_request_id || null)
    && data.guest_checkout !== true && data.internal_sandbox_checkout !== true && order.is_test_order !== true
    && Array.isArray(data.items) && data.items.length > 0 && same(data.items, order.items), 'reward_checkout_snapshot_mismatch');
  // Credit coverage must carry its protected Session-bound reservation proof.
  // Never silently allow an unreserved credit to cover this no-cash order.
  requireExact(creditCovered || Number(data.credits_discount || 0) === 0, 'reward_credit_reservation_required');
  requireExact(!terminal(order), 'reward_order_terminal');
  const schedule = verifySchedule(data, metadata);
  requireExact(schedule && schedule.assigned_delivery_date === order.assigned_delivery_date
    && schedule.assigned_production_day === order.assigned_production_day
    && schedule.assigned_delivery_window_start === order.assigned_delivery_window_start
    && schedule.assigned_delivery_window_end === order.assigned_delivery_window_end
    && schedule.delivery_window_label === order.delivery_window_label, 'reward_schedule_snapshot_mismatch');
  if (order.reward_settlement) {
    requireExact(isVerifiedNoPaymentOrder(order)
      && order.reward_settlement.context_hash === metadata.checkout_context_hash
      && order.reward_settlement.reservation_id === metadata.reward_reservation_id
      && order.reward_settlement.points_redeemed === data.reward_reservation_points
      && (!birthday || (order.reward_settlement.birthday_reservation_id === birthday.reservation_id
        && order.reward_settlement.birthday_product_id === birthday.product_id
        && order.reward_settlement.birthday_retail_cents === birthday.retail_value_cents))
      && (!creditCovered || (order.reward_settlement.credit_redeemed_cents === benefits.credit_cents
        && order.reward_settlement.credit_reservation_id === metadata.credit_reservation_id)), 'reward_settlement_receipt_conflict');
  } else {
    requireExact(order.status === 'pending_payment' && order.payment_status === 'pending'
      && order.financial_status === 'pending', 'reward_order_not_pending');
  }
  const settled = data.reward_reservation_points > 0
    ? await settleReservation({ customer_email: email, stripe_checkout_session_id: session.id })
    : { success: true, reservation_status: 'consumed' };
  requireExact(settled?.success === true && settled.reservation_status === 'consumed', 'reward_reservation_not_consumed');
  if (creditCovered) {
    const credit = await settleNoPaymentCheckoutCredit({ entities, stripe, email, sessionId: session.id });
    requireExact(credit.reservation_status === 'consumed', 'checkout_credit_not_consumed');
  }
  if (birthday) {
    const result = await settleNoPaymentBirthdayCheckout({ entities, stripe, customerEmail: email, sessionId: session.id });
    requireExact(result.reservation_status === 'consumed', 'checkout_birthday_not_consumed');
  }
  if (order.reward_settlement) return { order, checkoutData: data, idempotent: true };

  const receipt = { revision: creditCovered ? '2026-09-09.credit-settlement-v2' : REWARD_SETTLEMENT_REVISION,
    ...(birthday ? { birthday_reservation_id: birthday.reservation_id, birthday_product_id: birthday.product_id,
      birthday_retail_cents: birthday.retail_value_cents } : {}),
    ...(creditCovered ? { credit_redeemed_cents: benefits.credit_cents, credit_reservation_id: metadata.credit_reservation_id } : {}),
    checkout_session_id: session.id,
    context_hash: metadata.checkout_context_hash, reservation_id: metadata.reward_reservation_id,
    points_redeemed: data.reward_reservation_points, provider_event_id: event.id,
    settled_at: new Date(event.created * 1000).toISOString() };
  const patch = { status: 'scheduled_for_juicing', payment_status: 'paid', financial_status: 'paid',
    payment_captured: false, reward_settlement: receipt,
    reward_handoff_status: 'pending',
    status_history: [...(Array.isArray(order.status_history) ? order.status_history : []), {
      status: 'scheduled_for_juicing', timestamp: receipt.settled_at,
      message: 'Reward redeemed — no payment required. Your order is scheduled for juicing.',
      request_id: `reward_settlement:${session.id}`,
    }] };
  const query = { id: order.id, customer_email: order.customer_email,
    stripe_checkout_session_id: session.id, payment_captured: false,
    status: 'pending_payment', payment_status: 'pending', financial_status: 'pending',
    is_abandoned_checkout: { $ne: true }, do_not_recover: { $ne: true },
    ...(order.updated_date ? { updated_date: order.updated_date } : {}) };
  const result = await entities.Order.updateMany(query, { $set: patch });
  requireExact(result?.success === true && result.has_more === false && [0, 1].includes(result.updated),
    'reward_order_settlement_write_unconfirmed');
  const readback = await entities.Order.filter({ id: order.id }, undefined, 2);
  order = readback?.length === 1 ? readback[0] : null;
  requireExact(isVerifiedNoPaymentOrder(order) && same(order.reward_settlement, receipt), 'reward_order_settlement_readback_unconfirmed');
  return { order, checkoutData: data, idempotent: result.updated === 0 };
}

// Stripe expiration is not a refund or a completed redemption. Release the
// exact hold first, then retire only its still-unpaid local order. Do not expire
// a provider Session here: a signature plus a fresh read must prove it already
// expired. A missing CheckoutSession must not strand a hold after creation failed.
export async function expireNoPaymentRewardOrder({ entities, stripe, event, settleReservation }) {
  requireExact(event?.type === 'checkout.session.expired' && event.livemode === true
    && /^evt_[A-Za-z0-9_]+$/.test(event.id || '') && Number.isSafeInteger(event.created) && event.created > 0,
  'reward_expiration_event_invalid');
  const eventSession = event.data?.object;
  requireExact(/^cs_[A-Za-z0-9_]+$/.test(eventSession?.id || '')
    && eventSession?.metadata?.checkout_version === noPaymentVersion, 'reward_expiration_session_invalid');
  requireExact(typeof entities.Order?.updateMany === 'function', 'conditional_order_updates_unavailable');
  const session = await stripe.checkout.sessions.retrieve(eventSession.id);
  const metadata = session?.metadata || {};
  const email = normalizedEmail(metadata.customer_email);
  requireExact(session?.id === eventSession.id && session.livemode === true && session.currency === 'usd'
    && session.mode === 'payment' && session.status === 'expired' && session.payment_intent === null
    && session.amount_total === 0 && ['unpaid', 'no_payment_required'].includes(session.payment_status)
    && metadata.checkout_version === noPaymentVersion && metadata.checkout_mode === 'account'
    && metadata.internal_sandbox_checkout !== 'true' && metadata.is_test_order !== 'true'
    && email && normalizedEmail(session.customer_email) === email
    && metadata.order_number && metadata.reward_reservation_id
    && /^[a-f0-9]{64}$/.test(metadata.checkout_context_hash || ''), 'reward_provider_expiration_unconfirmed');
  for (const key of ['checkout_version', 'checkout_context_hash', 'reward_reservation_id', 'order_number', 'customer_email', 'no_payment_points', 'credit_reservation_id', 'credit_reservation_cents', 'birthday_reservation_id', 'no_payment_birthday']) {
    requireExact(eventSession.metadata[key] === metadata[key], 'reward_event_context_mismatch');
  }
  const orders = await entities.Order.filter({ stripe_checkout_session_id: session.id }, '-created_date', 2);
  requireExact(Array.isArray(orders) && orders.length <= 1, 'reward_order_not_unique');
  let order = orders[0] || null;
  const alreadyExpired = row => row?.status === 'cancelled' && row.is_abandoned_checkout === true
    && row.do_not_recover === true && row.payment_status === 'pending' && row.financial_status === 'pending'
    && row.payment_captured === false && !row.reward_settlement && !row.stripe_payment_intent_id;
  if (order) {
    requireExact(order.id && normalizedEmail(order.customer_email) === email && order.order_number === metadata.order_number
      && order.total === 0 && order.payment_captured === false && !order.stripe_payment_intent_id
      && !order.reward_settlement && order.is_test_order !== true && !(Number(order.amount_refunded || 0) > 0),
    'reward_expiration_order_mismatch');
    requireExact(alreadyExpired(order) || (order.status === 'pending_payment' && !terminal(order)
      && order.payment_status === 'pending' && order.financial_status === 'pending'), 'reward_expiration_order_not_pending');
  }
  if (metadata.credit_reservation_id) {
    const credit = await settleNoPaymentCheckoutCredit({ entities, stripe, email, sessionId: session.id });
    requireExact(credit.reservation_status === 'released', 'checkout_credit_not_released');
  }
  if (metadata.birthday_reservation_id) {
    const birthday = await settleNoPaymentBirthdayCheckout({ entities, stripe, customerEmail: email, sessionId: session.id });
    requireExact(birthday.reservation_status === 'released', 'checkout_birthday_not_released');
  }
  const released = metadata.reward_reservation_id.startsWith('credit:') ? { success: true, reservation_status: 'released' }
    : await settleReservation({ customer_email: email, stripe_checkout_session_id: session.id });
  requireExact(released?.success === true && released.reservation_status === 'released', 'reward_reservation_not_released');
  if (!order || alreadyExpired(order)) return { order, expired: true, idempotent: true };
  const timestamp = new Date(event.created * 1000).toISOString();
  const result = await entities.Order.updateMany({
    id: order.id, customer_email: order.customer_email, stripe_checkout_session_id: session.id,
    status: 'pending_payment', payment_status: 'pending', financial_status: 'pending', payment_captured: false,
    is_abandoned_checkout: { $ne: true }, do_not_recover: { $ne: true },
    ...(order.updated_date ? { updated_date: order.updated_date } : {}),
  }, { $set: { status: 'cancelled', is_abandoned_checkout: true, do_not_recover: true, canceled_at: timestamp,
    status_history: [...(Array.isArray(order.status_history) ? order.status_history : []), {
      status: 'cancelled', timestamp, request_id: `reward_expiration:${session.id}`,
      message: 'Reward checkout expired without payment. The reserved points were released.',
    }] } });
  requireExact(result?.success === true && result.has_more === false && [0, 1].includes(result.updated),
    'reward_order_expiration_write_unconfirmed');
  const readback = await entities.Order.filter({ id: order.id }, undefined, 2);
  order = readback?.length === 1 ? readback[0] : null;
  requireExact(alreadyExpired(order) && order.stripe_checkout_session_id === session.id
    && normalizedEmail(order.customer_email) === email && order.order_number === metadata.order_number,
  'reward_order_expiration_readback_unconfirmed');
  return { order, expired: true, idempotent: result.updated === 0 };
}
