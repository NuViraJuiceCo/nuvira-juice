// Refund events can arrive out of order. Amounts come from the current Stripe
// charge and its complete successful refund list, never the editable order total.
export const REFUND_PROOF_REVISION = '2026-09-09.current-refund-proof-v1';
const check = (value, code) => { if (!value) throw new Error(code); };
export const stripeObjectId = value => typeof value === 'string' ? value : value?.id;
const email = value => String(value || '').trim().toLowerCase();
const positive = value => Number.isSafeInteger(value) && value > 0;

export async function readRefundProof({ entities, stripe, event, order }) {
  const object = event?.data?.object;
  const paymentId = stripeObjectId(object?.payment_intent);
  const chargeEvent = event?.type === 'charge.refunded';
  check((chargeEvent || ['refund.created', 'refund.updated', 'charge.refund.updated'].includes(event?.type))
    && event.livemode === true && /^evt_[\w]+$/.test(event.id || '')
    && /^pi_[\w]+$/.test(paymentId || '') && order?.id && order.stripe_payment_intent_id === paymentId,
  'refund_event_identity_invalid');
  let eventRefund = null;
  if (!chargeEvent) {
    check(/^re_[\w]+$/.test(object?.id || ''), 'refund_event_identity_invalid');
    eventRefund = await stripe.refunds.retrieve(object.id);
    check(eventRefund?.id === object.id && stripeObjectId(eventRefund.payment_intent) === paymentId
      && eventRefund.currency === 'usd' && positive(eventRefund.amount), 'refund_event_provider_mismatch');
    // A pending, canceled or failed refund is not completed money movement.
    if (eventRefund.status !== 'succeeded') return { pending: true, paymentId };
  }
  const chargeId = chargeEvent ? object.id : stripeObjectId(eventRefund.charge);
  check(/^ch_[\w]+$/.test(chargeId || ''), 'refund_charge_identity_invalid');
  const charge = await stripe.charges.retrieve(chargeId);
  const payment = await stripe.paymentIntents.retrieve(paymentId);
  const customerEmail = email(order.customer_email);
  check(charge?.id === chargeId && stripeObjectId(charge.payment_intent) === paymentId
    && charge.livemode === true && charge.currency === 'usd' && charge.paid === true && charge.captured === true
    && positive(charge.amount) && positive(charge.amount_refunded) && charge.amount_refunded <= charge.amount
    && payment?.id === paymentId && payment.livemode === true && payment.currency === 'usd'
    && payment.status === 'succeeded' && payment.amount_received === charge.amount && !payment.invoice
    && (!payment.latest_charge || stripeObjectId(payment.latest_charge) === charge.id)
    && customerEmail.includes('@') && order.is_test_order !== true
    && payment.metadata?.internal_sandbox_checkout !== 'true' && payment.metadata?.is_test_order !== 'true'
    && (!payment.metadata?.customer_email || email(payment.metadata.customer_email) === customerEmail)
    && (!payment.metadata?.order_number || payment.metadata.order_number === order.order_number),
  'refund_provider_proof_mismatch');
  const orders = await entities.Order.filter({ stripe_payment_intent_id: paymentId }, undefined, 2);
  check(Array.isArray(orders) && orders.length === 1 && orders[0].id === order.id
    && email(orders[0].customer_email) === customerEmail, 'refund_order_ambiguous');

  const refunds = []; const seen = new Set(); let cursor;
  for (let page = 0; page < 10; page++) {
    const result = await stripe.refunds.list({ charge: charge.id, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
    check(Array.isArray(result?.data) && typeof result.has_more === 'boolean' && result.data.length <= 100,
      'refund_list_unconfirmed');
    for (const refund of result.data) {
      check(/^re_[\w]+$/.test(refund?.id || '') && !seen.has(refund.id)
        && stripeObjectId(refund.charge) === charge.id && stripeObjectId(refund.payment_intent) === paymentId
        && refund.currency === 'usd' && positive(refund.amount), 'refund_list_identity_invalid');
      seen.add(refund.id);
      if (refund.status === 'succeeded') refunds.push(refund);
    }
    if (!result.has_more) break;
    check(result.data.length > 0 && page < 9, 'refund_list_incomplete');
    cursor = result.data.at(-1).id;
  }
  check(refunds.length > 0 && refunds.reduce((sum, refund) => sum + refund.amount, 0) === charge.amount_refunded,
    'refund_successful_total_unconfirmed');
  if (eventRefund) check(refunds.some(refund => refund.id === eventRefund.id && refund.amount === eventRefund.amount),
    'refund_event_missing_from_charge');
  const full = charge.amount_refunded === charge.amount;
  check(charge.refunded === full, 'refund_charge_status_mismatch');
  const latestRefund = [...refunds].sort((a, b) => Number(b.created || 0) - Number(a.created || 0)
    || b.id.localeCompare(a.id))[0];
  return { charge, paymentId, customerEmail, full, amountCents: charge.amount_refunded,
    latestRefund, approvedCustomerAdjustment: refunds.length === 1
      && latestRefund.metadata?.operation === 'customer_order_adjustment_oasis_refund' };
}
