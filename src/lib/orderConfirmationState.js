// UI confirmation is a readback decision, never evidence that a provider was paid.
// Receipt predicate is kept in parity with the server settlement contract.
export function isVerifiedNoPaymentOrder(order) {
  const receipt = order?.reward_settlement;
  return Boolean(order?.id && order?.customer_email && order?.order_number
    && order.total === 0 && order.payment_captured === false
    && order.payment_status === 'paid' && order.financial_status === 'paid'
    && order.is_test_order !== true && order.is_abandoned_checkout !== true && order.do_not_recover !== true
    && !['pending_payment', 'cancelled', 'canceled', 'failed', 'refunded'].includes(order.status)
    && !order.stripe_payment_intent_id && !(Number(order.amount_refunded || 0) > 0)
    && receipt?.revision === '2026-09-08.reward-settlement-v1'
    && /^cs_[A-Za-z0-9_]+$/.test(order.stripe_checkout_session_id || '')
    && receipt.checkout_session_id === order.stripe_checkout_session_id
    && /^[a-f0-9]{64}$/.test(receipt.context_hash || '')
    && typeof receipt.reservation_id === 'string' && receipt.reservation_id.length > 0
    && Number.isSafeInteger(receipt.points_redeemed) && receipt.points_redeemed > 0
    && /^evt_[A-Za-z0-9_]+$/.test(receipt.provider_event_id || '')
    && typeof receipt.settled_at === 'string' && Number.isFinite(Date.parse(receipt.settled_at)));
}

export function classifyOrderConfirmation(order) {
  if (!order || (!order.id && !order.order_number)) return 'pending';
  if (['cancelled', 'canceled', 'refunded', 'failed'].includes(order.status)
    || ['refunded', 'failed'].includes(order.payment_status)
    || ['refunded', 'failed'].includes(order.financial_status)
    || order.is_abandoned_checkout === true || order.do_not_recover === true) return 'not_completed';
  if (order.status === 'pending_payment') return 'pending';
  if (order.reward_settlement) return isVerifiedNoPaymentOrder(order) ? 'confirmed' : 'pending';
  const paid = order.payment_captured === true || order.payment_status === 'paid' || order.financial_status === 'paid';
  // A bare zero-total/paid record is not proof of a covered reward redemption.
  if (order.total === 0 && order.payment_captured !== true) return 'pending';
  return paid ? 'confirmed' : 'pending';
}
