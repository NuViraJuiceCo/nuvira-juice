// A recovery hint is not proof of cancellation, payment or released points.
export function readRewardCheckoutRecovery(payload) {
  const recovery = payload?.reward_checkout_recovery;
  if (payload?.ok !== false || !['REWARD_CHECKOUT_PREPARING', 'REWARD_CHECKOUT_NOT_READY'].includes(payload.error_code)
    || recovery?.kind !== 'reward_no_payment'
    || !/^cs_[A-Za-z0-9_]{1,180}$/.test(recovery.checkout_session_id || '')
    || !/^[A-Za-z0-9_-]{1,80}$/.test(recovery.order_number || '')) return null;
  return { kind: 'reward_no_payment', checkout_session_id: recovery.checkout_session_id,
    order_number: recovery.order_number };
}

export async function cancelRewardCheckoutRecovery(invoke, recovery) {
  const checked = readRewardCheckoutRecovery({ ok: false, error_code: 'REWARD_CHECKOUT_NOT_READY',
    reward_checkout_recovery: recovery });
  if (!checked || typeof invoke !== 'function') throw new Error('reward_recovery_invalid');
  const response = await invoke('createPaymentIntent', {
    mode: 'cancel_reward_checkout', checkout_session_id: checked.checkout_session_id,
  });
  const result = response?.data;
  if (result?.ok !== true || (result.checkout_session_expired !== true && result.route_review_cancelled !== true)
    || result.reward_reservation_released !== true) throw new Error('reward_recovery_unconfirmed');
  return true;
}
