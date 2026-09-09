import { readRouteReview, claimRouteDecision, finishRouteDecision, cancelRouteOrder, updateRouteReview } from './routeReview.js';
import { settleCheckoutCredit, settleNoPaymentCheckoutCredit } from './checkoutCredit.js';
import { settleVerifiedBirthdayCheckout, settleNoPaymentBirthdayCheckout } from '../functions/createPaymentIntent/birthdayCheckout.js';
import { verifyPaidCheckoutHolds } from '../functions/createPaymentIntent/paidCheckoutRecovery.js';
import { firstOrderEligibilityBlock } from '../functions/createPaymentIntent/firstOrderEligibility.js';
import { finalizeNoPaymentRewardOrder } from '../functions/stripeWebhook/rewardSettlement.js';
import { runVerifiedRewardHandoff } from '../functions/stripeWebhook/rewardHandoffRuntime.js';

const check = (value, code) => { if (!value) throw new Error(code || 'route_review_decision_unconfirmed'); };
const cents = value => Math.round(Number(value) * 100);
const retrieve = (stripe, id) => /^cs_/.test(id) ? stripe.checkout.sessions.retrieve(id)
  : stripe.paymentIntents.retrieve(id, { expand: ['latest_charge'] });

// Preserve the exact schedule agreed at checkout, without changing its fee.
export function routeApprovalSchedule(data, meta) {
  const keys = { assigned_production_day: 'assigned_production_day', assigned_delivery_date: 'selected_delivery_date',
    delivery_window_label: 'delivery_window_label', assigned_delivery_window_start: 'delivery_window_start',
    assigned_delivery_window_end: 'delivery_window_end' };
  if (!Object.entries(keys).every(([key, metadataKey]) => data[key] && data[key] === meta[metadataKey])) return null;
  return { ...Object.fromEntries(Object.keys(keys).map(key => [key, data[key]])),
    production_date: data.assigned_production_day, delivery_date: data.assigned_delivery_date,
    delivery_window_start: data.assigned_delivery_window_start, delivery_window_end: data.assigned_delivery_window_end,
    delivery_window_timezone: 'America/Chicago', schedule_timezone: 'America/Chicago', timezone: 'America/Chicago',
    final_schedule_source: data.final_schedule_source, scheduling_reason: 'customer_selected_at_checkout' };
}

export async function decideRouteReview({ base44, stripe, darId, kind, actor, reason, approvedDeliveryFee = null,
  env, fetchImpl = fetch, now = Date.now(), notify = null, handoff = runVerifiedRewardHandoff }) {
  check(env?.get('NUVIRA_STAGING_SAFE_MODE') !== 'true', 'route_review_staging_blocked');
  check(actor && ['approve', 'deny', 'expire', 'cancel'].includes(kind));
  const entities = base44.asServiceRole.entities;
  const rows = await entities.DeliveryApprovalRequest.filter({ id: darId }, undefined, 2);
  check(Array.isArray(rows) && rows.length === 1 && rows[0]?.checkout_provider_id);
  let provider = await retrieve(stripe, rows[0].checkout_provider_id);
  let proof = await readRouteReview(entities, provider);
  check(proof.dar.id === darId);
  if (proof.dar.review_decision) check(proof.dar.review_decision.kind === kind, 'route_review_competing_decision');
  const secret = env.get('LOYALTY_LEDGER_SECRET') || env.get('CUSTOMER_APP_SYNC_SECRET') || env.get('HUB_SYNC_SECRET');
  if (proof.data.reward_reservation_points > 0) check(secret, 'route_review_ledger_unavailable');
  const settlePoints = async payload => {
    const result = await base44.asServiceRole.functions.invoke('enrollNewCustomerInLoyalty', {
      ...payload, action: 'settle_reward_checkout', internal_secret: secret });
    return result?.data || result;
  };
  if (kind === 'approve') {
    check(approvedDeliveryFee == null || cents(approvedDeliveryFee) === cents(proof.data.delivery_fee),
      'route_review_fee_change_requires_customer_confirmation');
    if (!proof.dar.review_decision) {
      check(proof.dar.status === 'pending_review' && proof.dar.provider_confirmation?.provider_id === provider.id);
      const schedule = routeApprovalSchedule(proof.data, proof.meta);
      check(schedule, 'route_review_schedule_unconfirmed');
      const response = await base44.asServiceRole.functions.invoke('calculateNuViraFulfillmentSchedule', {
        mode: 'options', created_at: new Date(now).toISOString(), option_count: 2 });
      const options = (response?.data || response)?.options;
      check(Array.isArray(options) && options.some(option =>
        (option.assigned_production_day || option.production_date) === schedule.assigned_production_day
        && (option.assigned_delivery_date || option.delivery_date) === schedule.assigned_delivery_date
        && option.delivery_window_label === schedule.delivery_window_label
        && (option.assigned_delivery_window_start || option.delivery_window_start) === schedule.assigned_delivery_window_start
        && (option.assigned_delivery_window_end || option.delivery_window_end) === schedule.assigned_delivery_window_end),
      'route_review_schedule_expired_requote_required');
      const block = await firstOrderEligibilityBlock(base44, { code: proof.data.promotion_code,
        first_order_only: proof.data.route_review.first_order_only === true }, proof.data.customer_email);
      check(!block, 'route_review_first_order_offer_recheck_failed');
      if (!proof.noPayment) {
        check(provider.status === 'requires_capture' && provider.amount_capturable === provider.amount
          && provider.latest_charge?.payment_method_details?.card?.capture_before * 1000 > now,
        'route_review_authorization_expired_or_unconfirmed');
        await verifyPaidCheckoutHolds({ entities, payment: provider, data: proof.data, email: proof.data.customer_email,
          guest: false, stripe });
      } else check(provider.status === 'complete' && provider.payment_status === 'no_payment_required');
    }
    proof = await claimRouteDecision(entities, provider, { kind, actor, reason, now });
    if (proof.noPayment) {
      // Retrieve the actual provider event, never fabricate one for settlement.
      const event = await stripe.events.retrieve(proof.dar.provider_confirmation.event_id);
      check(event.id === proof.dar.provider_confirmation.event_id
        && event.created === proof.dar.provider_confirmation.created
        && event.data?.object?.id === provider.id, 'route_review_confirmation_event_mismatch');
      const result = await finalizeNoPaymentRewardOrder({ entities, stripe, event, settleReservation: settlePoints,
        verifySchedule: routeApprovalSchedule });
      const handed = await handoff({ base44, result, env, fetchImpl });
      check(handed?.complete === true, 'route_review_fulfillment_handoff_pending');
    } else {
      if (provider.status === 'requires_capture') {
        check(provider.amount_capturable === provider.amount, 'route_review_authorization_amount_changed');
        await stripe.paymentIntents.capture(provider.id, { amount_to_capture: provider.amount },
          { idempotencyKey: `route_review:${proof.dar.id}:capture:v2` });
      }
      provider = await retrieve(stripe, provider.id);
      check(provider.status === 'succeeded' && provider.amount_received === provider.amount,
        'route_review_capture_unconfirmed');
      // Ordinary signed webhook finalizes the existing order, benefits and communications.
    }
    proof = await finishRouteDecision(entities, provider, 'captured', now);
    return { success: true, dar_id: proof.dar.id, order_id: proof.order.id, order_number: proof.order.order_number,
      payment_captured: !proof.noPayment, no_payment_required: proof.noPayment,
      fulfillment_handoff: proof.noPayment ? 'complete' : 'standard_signed_webhook',
      amount_captured: proof.noPayment ? 0 : provider.amount_received / 100 };
  }
  check(!['succeeded', 'processing'].includes(provider.status), 'route_review_payment_not_cancelable');
  proof = await claimRouteDecision(entities, provider, { kind, actor, reason, now });
  if (proof.noPayment) {
    if (provider.status === 'open') await stripe.checkout.sessions.expire(provider.id);
    provider = await retrieve(stripe, provider.id);
    check(['expired', 'complete'].includes(provider.status), 'route_review_cancellation_unconfirmed');
    if (proof.meta.birthday_reservation_id) {
      const result = await settleNoPaymentBirthdayCheckout({ entities, stripe, customerEmail: proof.data.customer_email, sessionId: provider.id, now });
      check(result.reservation_status === 'released');
    }
    if (proof.meta.credit_reservation_id) {
      const result = await settleNoPaymentCheckoutCredit({ entities, stripe, email: proof.data.customer_email, sessionId: provider.id });
      check(result.reservation_status === 'released');
    }
  } else {
    if (['requires_payment_method', 'requires_confirmation', 'requires_action', 'requires_capture'].includes(provider.status)) {
      await stripe.paymentIntents.cancel(provider.id, {}, { idempotencyKey: `route_review:${proof.dar.id}:cancel:v2` });
    }
    provider = await retrieve(stripe, provider.id);
    check(provider.status === 'canceled', 'route_review_cancellation_unconfirmed');
    if (proof.meta.birthday_reservation_id) {
      const result = await settleVerifiedBirthdayCheckout({ entities, stripe, customerEmail: proof.data.customer_email,
        paymentIntentId: provider.id, now }); check(result.reservation_status === 'released');
    }
    if (proof.meta.credit_reservation_id) {
      const result = await settleCheckoutCredit({ entities, payment: provider, email: proof.data.customer_email });
      check(result.reservation_status === 'released');
    }
  }
  if (proof.data.reward_reservation_points > 0) {
    const result = await settlePoints({ customer_email: proof.data.customer_email,
      [proof.noPayment ? 'stripe_checkout_session_id' : 'stripe_payment_intent_id']: provider.id });
    check(result.reservation_status === 'released');
  }
  proof = await readRouteReview(entities, provider);
  await cancelRouteOrder(entities, proof);
  proof = await finishRouteDecision(entities, provider, kind === 'expire' ? 'expired' : 'denied', now);
  check(typeof notify === 'function', 'route_review_customer_notification_unavailable');
  await notify(proof, kind === 'expire' ? 'expired' : 'denied');
  if (proof.dar.communications_pending) {
    await updateRouteReview(entities, proof.dar, { communications_pending: false });
    proof = await readRouteReview(entities, provider);
    check(proof.dar.communications_pending === false, 'route_review_notification_readback_unconfirmed');
  }
  return { success: true, dar_id: darId, status: proof.dar.status, payment_captured: false,
    benefit_reservations_released: true, order_cancelled: true };
}
