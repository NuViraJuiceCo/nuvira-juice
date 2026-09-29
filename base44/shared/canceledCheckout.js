import { creditCents } from './checkoutCredit.js';

const assert = value => { if (!value) throw new Error('paid_checkout_recovery_unconfirmed'); };
const one = rows => { assert(Array.isArray(rows) && rows.length === 1 && rows[0]?.id); return rows[0]; };
const zero = value => value == null || (Number.isFinite(Number(value)) && Number(value) === 0);

// Includes the historical webhook's status-only cancellation, but never a
// paid/refunded/captured row. Recognizing it is not permission to retry payment.
export function canFinalizeCanceledCheckout(order) {
  return ['pending_payment', 'cancelled'].includes(order?.status)
    && ((order.payment_status === 'pending' && order.financial_status === 'pending')
      || (order.status === 'cancelled' && order.payment_status === 'cancelled' && order.financial_status === 'cancelled'))
    && order.payment_captured === false && zero(order.amount_refunded) && zero(order.refund_amount)
    && !order.stripe_refund_id && !order.refunded_at
    && (!order.refund_status || order.refund_status === 'none');
}

const complete = order => canFinalizeCanceledCheckout(order) && order.status === 'cancelled'
  && order.payment_status === 'cancelled' && order.financial_status === 'cancelled'
  && order.do_not_recover === true && order.abandoned_checkout === true;

// The caller must supply a freshly retrieved Stripe PaymentIntent, never the
// event payload or browser status. Both signed webhook and explicit customer
// cancellation use this one transition; customer authorization/benefit release
// remain the responsibility of paidCheckoutRecovery before it grants a retry.
export async function finalizeCanceledCheckout({ entities, payment, now = Date.now() }) {
  const meta = payment?.metadata || {};
  assert(/^pi_[A-Za-z0-9_]+$/.test(payment?.id || '') && payment.status === 'canceled'
    && payment.livemode === true && payment.currency === 'usd' && payment.amount_received === 0
    && Number.isSafeInteger(payment.amount) && payment.amount >= 50
    && meta.checkout_version === '3.0_embedded' && ['guest', 'account'].includes(meta.checkout_mode)
    && /^NV-[A-F0-9]{24}$/.test(meta.order_number || '')
    && typeof meta.customer_email === 'string' && meta.customer_email.length > 0
    && meta.customer_email === meta.customer_email.trim().toLowerCase()
    && /^[a-f0-9]{64}$/.test(meta.checkout_context_hash || '')
    && meta.internal_sandbox_checkout !== 'true' && meta.is_test_order !== 'true');
  const session = one(await entities.CheckoutSession.filter({ stripe_session_id: payment.id }, undefined, 2));
  const data = session.checkout_data;
  assert(session.order_number === meta.order_number && session.customer_email === meta.customer_email
    && data?.order_number === meta.order_number && data.customer_email === meta.customer_email
    && data.checkout_context_hash === meta.checkout_context_hash
    && data.guest_checkout === (meta.checkout_mode === 'guest')
    && data.internal_sandbox_checkout !== true && !data.sandbox_test_id
    && creditCents(data.total) === payment.amount);
  assert(one(await entities.CheckoutSession.filter({ order_number: meta.order_number }, undefined, 2)).id === session.id);
  let order = one(await entities.Order.filter({ stripe_payment_intent_id: payment.id }, undefined, 2));
  const orderId = order.id;
  const identity = current => {
    assert(current.id === orderId && current.order_number === meta.order_number
      && current.customer_email === meta.customer_email && current.stripe_payment_intent_id === payment.id
      && current.is_test_order !== true && current.internal_sandbox_checkout !== true
      && creditCents(current.total) === payment.amount && canFinalizeCanceledCheckout(current));
  };
  assert(one(await entities.Order.filter({ order_number: meta.order_number }, undefined, 2)).id === order.id);
  identity(order);
  assert(typeof entities.Order.updateMany === 'function');
  // A second bounded CAS also reconciles an in-flight old status-only webhook.
  // A zero-row result is not success: re-read and prove the full terminal state.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (complete(order)) return { order, updated: false };
    const filter = { id: order.id, order_number: order.order_number, customer_email: order.customer_email,
      stripe_payment_intent_id: payment.id, total: order.total, status: order.status,
      payment_status: order.payment_status, financial_status: order.financial_status, payment_captured: false };
    if (order.updated_date !== undefined) filter.updated_date = order.updated_date;
    for (const field of ['amount_refunded', 'refund_amount', 'stripe_refund_id', 'refunded_at', 'refund_status']) {
      filter[field] = order[field] === undefined ? { $exists: false } : order[field];
    }
    const result = await entities.Order.updateMany(filter, { $set: {
      status: 'cancelled', payment_status: 'cancelled', financial_status: 'cancelled',
      do_not_recover: true, abandoned_checkout: true,
      ...(order.status !== 'cancelled' ? { status_history: [...(order.status_history || []), {
        status: 'cancelled', timestamp: new Date(now).toISOString(),
        message: 'Payment cancelled before capture; checkout cancellation verified.',
      }] } : {}),
    } });
    assert(result?.success === true && result.has_more === false && [0, 1].includes(result.updated));
    const confirmed = one(await entities.Order.filter({ id: order.id }, undefined, 2));
    identity(confirmed);
    if (complete(confirmed)) return { order: confirmed, updated: result.updated === 1 };
    order = confirmed;
  }
  assert(false);
}
