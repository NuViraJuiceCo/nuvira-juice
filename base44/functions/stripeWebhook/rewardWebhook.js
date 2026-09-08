import { finalizeNoPaymentRewardOrder, expireNoPaymentRewardOrder } from './rewardSettlement.js';

export const REWARD_WEBHOOK_REVISION = '2026-09-08.reward-webhook-v1';

// Never let a reward Session (including an unknown reward revision) fall into
// legacy Checkout fulfillment, which assumes cash capture and awards cash points.
export function isRewardCheckoutEvent(event) {
  if (!String(event?.type || '').startsWith('checkout.session.')) return false;
  const meta = event.data?.object?.metadata || {};
  return Boolean(meta.reward_reservation_id || String(meta.checkout_version || '').includes('reward_no_payment'));
}

export async function handleRewardCheckoutEvent({ entities, stripe, event, settleReservation, verifySchedule,
  runHandoff, stagingSafeMode = false, internalSecretAvailable = false }) {
  if (!isRewardCheckoutEvent(event)) return null;
  const fail = error => ({ status: 503, body: { received: false, error, revision: REWARD_WEBHOOK_REVISION } });
  if (stagingSafeMode) return fail('reward_webhook_staging_write_blocked');
  if (!internalSecretAvailable) return fail('reward_ledger_credential_unavailable');
  if (event?.livemode !== true || event.data?.object?.metadata?.checkout_version !== '4.0_reward_no_payment') {
    return fail('reward_webhook_revision_or_mode_unconfirmed');
  }
  try {
    if (event.type === 'checkout.session.expired') {
      const result = await expireNoPaymentRewardOrder({ entities, stripe, event, settleReservation });
      return { status: 200, body: { received: true, reward_checkout: true, expired: true,
        idempotent: result.idempotent, revision: REWARD_WEBHOOK_REVISION } };
    }
    if (event.type !== 'checkout.session.completed') return fail('reward_checkout_event_not_supported');
    const result = await finalizeNoPaymentRewardOrder({ entities, stripe, event, settleReservation, verifySchedule });
    // Deliberately await durable downstream progress. A saved payment/reward
    // receipt alone is not a completed fulfillment/communication handoff.
    const handoff = typeof runHandoff === 'function' ? await runHandoff(result) : null;
    if (handoff?.complete !== true) return fail('reward_checkout_handoff_pending');
    return { status: 200, body: { received: true, reward_checkout: true, handoff_complete: true,
      idempotent: result.idempotent, revision: REWARD_WEBHOOK_REVISION } };
  } catch {
    // Provider/storage exceptions can contain PII or payloads. Keep the public
    // response generic and return non-2xx so an unconfirmed event stays retryable.
    return fail('reward_checkout_processing_unconfirmed');
  }
}
