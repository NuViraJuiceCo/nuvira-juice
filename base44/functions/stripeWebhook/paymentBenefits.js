// Retry-safe bookkeeping for an already confirmed embedded payment. All inputs
// are server-held CheckoutSession / Order records and the signed Stripe event.
export const PAYMENT_BENEFITS_REVISION = '2026-09-08.payment-benefits-replay-v1';
const finiteInteger = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0;

export async function applyCheckoutCredit(entities, { email, orderId, orderNumber, paymentId, amount }) {
  const cents = Math.round(Number(amount) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0 || Math.abs(Number(amount) * 100 - cents) > 0.00001) {
    throw new Error('invalid_checkout_credit_amount');
  }
  if (!cents) return { skipped: true };
  if (typeof entities.NuViraCredit?.updateMany !== 'function') throw new Error('conditional_credit_updates_unavailable');
  for (let attempt = 0; attempt < 12; attempt++) {
    const rows = await entities.NuViraCredit.filter({ customer_email: email }, undefined, 2);
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.id) throw new Error('checkout_credit_account_unavailable');
    const row = rows[0];
    const history = row.history === undefined ? [] : row.history;
    if (!Array.isArray(history)) throw new Error('invalid_credit_history');
    const key = `stripe_payment:${paymentId}:credit`;
    const matches = history.filter(entry => entry.idempotency_key === key
      || (entry.type === 'used' && entry.order_id === orderId));
    if (matches.length > 1) throw new Error('duplicate_checkout_credit_receipts');
    if (matches[0]) {
      if (Math.round(Number(matches[0].amount) * 100) !== cents
        || (matches[0].payment_intent_id && matches[0].payment_intent_id !== paymentId)) throw new Error('checkout_credit_replay_conflict');
      return { idempotent: true };
    }
    const balance = Math.round(Number(row.balance ?? 0) * 100);
    const lifetime = Math.round(Number(row.lifetime_used ?? 0) * 100);
    const revision = Number(row.credit_ledger_revision ?? 0);
    if (![balance, lifetime, revision].every(finiteInteger)) throw new Error('invalid_credit_balance');
    if (balance < cents) throw new Error('insufficient_checkout_credit');
    const revisionQuery = row.credit_ledger_revision === undefined
      ? { $or: [{ credit_ledger_revision: { $exists: false } }, { credit_ledger_revision: 0 }] }
      : { credit_ledger_revision: revision };
    const result = await entities.NuViraCredit.updateMany({ id: row.id, customer_email: email, ...revisionQuery }, { $set: {
      balance: (balance - cents) / 100, lifetime_used: (lifetime + cents) / 100,
      credit_ledger_revision: revision + 1,
      history: [...history, { amount: cents / 100, type: 'used', description: `Applied to order ${orderNumber}`,
        order_id: orderId, payment_intent_id: paymentId, idempotency_key: key, timestamp: new Date().toISOString() }],
    } });
    if (!result || result.success !== true || result.has_more !== false || ![0, 1].includes(result.updated)) {
      throw new Error('conditional_credit_update_unconfirmed');
    }
    if (result.updated === 1) return { idempotent: false };
  }
  throw new Error('credit_account_busy_retry');
}

export async function settleEmbeddedPaymentBenefits({ entities, postLoyalty, paymentIntent, event,
  order, checkoutData = {}, skipLoyalty = false, settleReservation }) {
  const email = String(order.customer_email || '').trim().toLowerCase();
  const paymentId = paymentIntent.id;
  if (!paymentId || order.stripe_payment_intent_id !== paymentId
    || (paymentIntent.metadata?.customer_email && paymentIntent.metadata.customer_email.trim().toLowerCase() !== email)
    || (checkoutData.customer_email && checkoutData.customer_email.trim().toLowerCase() !== email)) throw new Error('payment_benefit_identity_mismatch');
  if (!Number.isSafeInteger(paymentIntent.amount_received) || paymentIntent.amount_received < 0
    || paymentIntent.status !== 'succeeded' || paymentIntent.currency !== 'usd') throw new Error('confirmed_payment_required');
  if (!email || skipLoyalty) return { skipped: true };
  const pointsUsed = Number(checkoutData.points_used || 0);
  const rewardPoints = Number(checkoutData.active_reward?.points_required || 0);
  if (![pointsUsed, rewardPoints].every(finiteInteger)) throw new Error('invalid_checkout_points');
  const base = { customer_email: email, source_id: paymentId, provider_event_id: event.id,
    order_id: order.id, order_number: order.order_number,
    occurred_at: new Date(event.created * 1000).toISOString() };
  const reservationId = paymentIntent.metadata?.reward_reservation_id;
  if (reservationId) {
    if (typeof settleReservation !== 'function') throw new Error('reward_payment_settlement_unavailable');
    const settled = await settleReservation({ customer_email: email, stripe_payment_intent_id: paymentId });
    if (settled?.success !== true || settled?.reservation_status !== 'consumed') throw new Error('reward_payment_settlement_unconfirmed');
  } else if (pointsUsed + rewardPoints > 0) {
    await postLoyalty({ ...base, amount: -(pointsUsed + rewardPoints), transaction_type: 'redeemed',
      idempotency_key: `stripe_payment:${paymentId}:redeemed`, source_type: 'stripe_redemption',
      description: checkoutData.active_reward?.title ? `Redeemed at checkout: ${checkoutData.active_reward.title}`
        : `Redeemed at checkout for order ${order.order_number}` });
  }
  await applyCheckoutCredit(entities, { email, orderId: order.id, orderNumber: order.order_number,
    paymentId, amount: checkoutData.credits_discount || 0 });
  // A new double-points reward needs the canonical quote AND its consumed
  // reservation. An unvalidated legacy active_reward object cannot grant it.
  const quote = checkoutData.reward_checkout;
  const multiplier = reservationId && quote?.revision === '2026-09-08.reward-checkout-v1'
    && quote.active_reward?.id === checkoutData.active_reward?.id
    && quote.active_reward?.reward_type === 'double_points' && quote.points_multiplier === 2 ? 2 : 1;
  const pointsToAward = Math.floor(paymentIntent.amount_received / 10) * multiplier;
  if (pointsToAward > 0) await postLoyalty({ ...base, amount: pointsToAward, transaction_type: 'earned',
    idempotency_key: `stripe_payment:${paymentId}:earned`, source_type: 'stripe_payment',
    description: `Order payment of $${(paymentIntent.amount_received / 100).toFixed(2)} (${order.order_number})`,
    metadata: { points_multiplier: multiplier } });
  return { success: true, points_earned: pointsToAward, revision: PAYMENT_BENEFITS_REVISION };
}
