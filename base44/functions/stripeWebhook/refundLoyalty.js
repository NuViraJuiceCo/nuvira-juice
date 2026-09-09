// Reverse the recorded purchase award, never a catalog estimate or redeemed
// entitlement. The CAS ledger owns monetary-point decisions; the existing
// admin review queue is only a recoverable projection of its durable holds.
export const REFUND_LOYALTY_REVISION = '2026-09-08.recorded-refund-manual-review-v2';
const fail = code => { throw new Error(code); };
const check = (value, code) => { if (!value) fail(code); };
const id = value => typeof value === 'string' ? value : value?.id;
const email = value => String(value || '').trim().toLowerCase();
const integer = value => Number.isSafeInteger(value) && value > 0;

async function projectRefundReview({ entities, order, paymentId, hold }) {
  check(hold.review_key === `stripe_payment:${paymentId}:full_refund_reversal`
    && hold.payment_intent_id === paymentId && hold.order_id === order.id
    && hold.earned_transaction_id && integer(hold.points_to_review)
    && hold.reason === 'spent_or_unavailable' && Number.isFinite(Date.parse(hold.created_at)),
  'refund_review_hold_invalid');
  const queue = entities.OrderReviewQueue;
  check(typeof queue?.filter === 'function' && typeof queue?.create === 'function', 'refund_review_queue_unavailable');
  const key = `refund_loyalty_review:${paymentId}`;
  const read = async () => {
    const rows = await queue.filter({ idempotency_key: key }, undefined, 20);
    check(Array.isArray(rows) && rows.length < 20, 'refund_review_queue_read_unconfirmed');
    check(rows.every(row => row.id && row.existing_order_id === order.id
      && row.incident_type === 'refund_loyalty_points_spent'
      && row.incoming_payload?.points_to_review === hold.points_to_review
      && ['pending', 'reviewing', 'resolved', 'rejected', 'archived'].includes(row.status)),
    'refund_review_queue_identity_conflict');
    return rows;
  };
  let rows = await read();
  if (!rows.length) {
    // No uniqueness or cross-record transaction is assumed. A lost create
    // acknowledgement is recovered by this key on retry; the points hold stays.
    await queue.create({ idempotency_key: key, incident_type: 'refund_loyalty_points_spent',
      existing_order_id: order.id, existing_order_number: order.order_number, existing_order_type: 'Order',
      customer_email: email(order.customer_email),
      incoming_source: 'stripe_refund_loyalty', status: 'pending', occurrence_count: 1,
      first_seen_at: hold.created_at, last_seen_at: hold.created_at,
      incoming_payload: { revision: REFUND_LOYALTY_REVISION, points_to_review: hold.points_to_review },
      issue_description: `The payment is fully refunded. ${hold.points_to_review} loyalty points need manual review because points were spent or are reserved/unavailable. Redeemed rewards and other checkout holds are unchanged.`,
      recommended_action: 'Review the original award and subsequent redemptions before an audited loyalty adjustment. Do not refund the money again. Closing this review does not authorize an automatic points deduction.',
    });
    rows = await read();
  }
  check(rows.length > 0, 'refund_review_queue_write_unconfirmed');
  // Concurrent callbacks can leave duplicate projection rows, never duplicate
  // deductions. Preserve any operator-handled row; archive only untouched copies.
  const handled = rows.filter(row => (row.status !== 'pending' || row.admin_notes || row.resolved_by)
    && row.resolved_action !== 'duplicate_refund_loyalty_review');
  check(handled.length <= 1, 'refund_review_queue_decision_conflict');
  const canonical = handled[0] || [...rows].filter(row => row.status === 'pending').sort((a, b) => a.id.localeCompare(b.id))[0]
    || [...rows].sort((a, b) => a.id.localeCompare(b.id))[0];
  for (const duplicate of rows.filter(row => row.id !== canonical.id && row.status === 'pending'
    && !row.admin_notes && !row.resolved_by)) {
    check(typeof queue.updateMany === 'function', 'refund_review_queue_conditional_update_required');
    const result = await queue.updateMany({ id: duplicate.id, status: 'pending',
      updated_date: duplicate.updated_date ?? { $exists: false },
    }, { $set: {
      status: 'archived', resolved_action: 'duplicate_refund_loyalty_review',
      archived_reason: 'Duplicate projection of the same durable refund loyalty hold.',
    } });
    check(result?.success === true && result.has_more === false && [0, 1].includes(result.updated),
      'refund_review_queue_deduplication_unconfirmed');
  }
  const confirmed = await read();
  check(confirmed.some(row => row.id === canonical.id) && confirmed.filter(row => row.status === 'pending').length <= 1,
    'refund_review_queue_write_unconfirmed');
  return { success: true, outcome: 'manual_review', review_required: true,
    points_pending_review: hold.points_to_review, revision: REFUND_LOYALTY_REVISION };
}

function findReviewHold(account, paymentId) {
  const holds = account.refund_review_holds ?? [];
  check(Array.isArray(holds), 'refund_review_holds_invalid');
  const matches = holds.filter(hold => hold.review_key === `stripe_payment:${paymentId}:full_refund_reversal`);
  check(matches.length <= 1, 'duplicate_refund_review_holds');
  return matches[0];
}

export async function verifyFullRefundPayment({ entities, stripe, event, order }) {
  const eventCharge = event?.data?.object;
  const paymentId = id(eventCharge?.payment_intent);
  check(event?.type === 'charge.refunded' && event.livemode === true
    && /^ch_[a-zA-Z0-9_]+$/.test(eventCharge?.id || '') && /^pi_[a-zA-Z0-9_]+$/.test(paymentId || '')
    && order?.id && order.stripe_payment_intent_id === paymentId
    && integer(eventCharge.amount) && eventCharge.amount_refunded === eventCharge.amount,
  'full_refund_identity_required');
  const charge = await stripe.charges.retrieve(eventCharge.id);
  const payment = await stripe.paymentIntents.retrieve(paymentId);
  const customerEmail = email(order.customer_email);
  check(charge?.id === eventCharge.id && id(charge.payment_intent) === paymentId
    && charge.livemode === true && charge.currency === 'usd' && charge.refunded === true
    && charge.paid === true && charge.captured === true && integer(charge.amount)
    && charge.amount === eventCharge.amount && charge.amount_refunded === charge.amount
    && payment?.id === paymentId && payment.livemode === true && payment.currency === 'usd'
    && payment.status === 'succeeded' && payment.amount_received === charge.amount && !payment.invoice
    && (!payment.latest_charge || id(payment.latest_charge) === charge.id)
    && customerEmail.includes('@') && order.is_test_order !== true
    && payment.metadata?.internal_sandbox_checkout !== 'true' && payment.metadata?.is_test_order !== 'true'
    && (!payment.metadata?.customer_email || email(payment.metadata.customer_email) === customerEmail)
    && (!payment.metadata?.order_number || payment.metadata.order_number === order.order_number),
  'full_refund_provider_proof_mismatch');
  const orders = await entities.Order.filter({ stripe_payment_intent_id: paymentId }, undefined, 2);
  check(Array.isArray(orders) && orders.length === 1 && orders[0].id === order.id
    && email(orders[0].customer_email) === customerEmail, 'full_refund_order_ambiguous');
  return { charge, paymentId, customerEmail };
}

export async function reconcileFullRefundLoyalty({ entities, stripe, event, order, postLoyalty }) {
  const { charge, paymentId, customerEmail } = await verifyFullRefundPayment({ entities, stripe, event, order });
  const accounts = await entities.UserPoints.filter({ customer_email: customerEmail }, undefined, 2);
  check(Array.isArray(accounts) && accounts.length === 1 && accounts[0]?.id
    && Array.isArray(accounts[0].points_history), 'refund_points_account_review_required');
  const heldReview = findReviewHold(accounts[0], paymentId);
  if (heldReview) return await projectRefundReview({ entities, order, paymentId, hold: heldReview });
  const history = accounts[0].points_history;
  const earningKey = `stripe_payment:${paymentId}:earned`;
  const reversalKey = `stripe_payment:${paymentId}:full_refund_reversal`;
  const awards = history.filter(row => row.idempotency_key === earningKey);
  check(awards.length === 1 && integer(awards[0].amount)
    && (awards[0].transaction_type || awards[0].type) === 'earned'
    && awards[0].transaction_id, 'refund_purchase_award_review_required');
  async function proveReceipt(receipt, type) {
    const rows = await entities.LoyaltyTransaction.filter({ id: receipt.transaction_id }, undefined, 2);
    check(Array.isArray(rows) && rows.length === 1 && rows[0].id === receipt.transaction_id
      && rows[0].idempotency_key === receipt.idempotency_key
      && rows[0].transaction_type === type && rows[0].amount === receipt.amount
      && email(rows[0].customer_email) === customerEmail
      && ['posted', 'pending'].includes(rows[0].status)
      && (type !== 'reversal' || rows[0].order_id === order.id), 'refund_ledger_receipt_mismatch');
  }
  await proveReceipt(awards[0], 'earned');
  const isLegacyKey = key => typeof key === 'string' && key.startsWith('stripe_refund_event:')
    && key.endsWith(`:order:${order.id}`);
  const legacy = history.filter(row => isLegacyKey(row.idempotency_key));
  check(new Set(legacy.map(row => row.idempotency_key)).size === legacy.length,
    'refund_duplicate_legacy_receipts');
  let legacyReversed = 0;
  for (const receipt of legacy) {
    check(receipt.transaction_type === 'reversal' && integer(-receipt.amount), 'refund_legacy_receipt_invalid');
    await proveReceipt(receipt, 'reversal'); legacyReversed -= receipt.amount;
    check(Number.isSafeInteger(legacyReversed), 'refund_legacy_receipt_invalid');
  }
  check(legacyReversed <= awards[0].amount, 'refund_prior_reversal_exceeds_award');
  const prior = await entities.LoyaltyTransaction.filter({ order_id: order.id, transaction_type: 'reversal' }, undefined, 100);
  check(Array.isArray(prior) && prior.length < 100, 'refund_reversal_history_incomplete');
  for (const row of prior.filter(row => row.status !== 'voided')) {
    check(email(row.customer_email) === customerEmail && integer(-row.amount)
      && (row.idempotency_key === reversalKey || legacy.some(receipt => receipt.transaction_id === row.id)),
    'refund_unreconciled_prior_reversal');
  }
  const remaining = awards[0].amount - legacyReversed;
  const existing = history.filter(row => row.idempotency_key === reversalKey);
  check(existing.length <= 1 && (!existing.length || (existing[0].amount === -remaining
    && existing[0].transaction_type === 'reversal')), 'refund_reversal_receipt_conflict');
  if (existing[0]) await proveReceipt(existing[0], 'reversal');
  // Existing old-key reversals are not repeated. Reposting the same receipt
  // through the central ledger repairs its projection, not its balance.
  const requests = remaining ? [{ amount: -remaining, key: reversalKey }]
    : legacy.map(receipt => ({ amount: receipt.amount, key: receipt.idempotency_key }));
  for (const request of requests) {
    let result;
    try { result = await postLoyalty({ customer_email: customerEmail, amount: request.amount,
      transaction_type: 'reversal', idempotency_key: request.key,
      description: `Full refund of order ${order.order_number}`,
      source_type: 'stripe_refund', source_id: charge.id, provider_event_id: event.id,
      order_id: order.id, order_number: order.order_number,
      occurred_at: new Date(event.created * 1000).toISOString(),
      metadata: { payment_intent_id: paymentId, earned_transaction_id: awards[0].transaction_id,
        refund_amount: charge.amount_refunded / 100, revision: REFUND_LOYALTY_REVISION,
        require_available_balance: true } }); }
    catch (error) {
      // SDKs may wrap a 409 or lose the response after the CAS. Only a proven
      // persisted hold, never an error string, can acknowledge manual review.
      const reread = await entities.UserPoints.filter({ customer_email: customerEmail }, undefined, 2);
      check(Array.isArray(reread) && reread.length === 1 && reread[0].id === accounts[0].id,
        'refund_review_readback_unconfirmed');
      const hold = findReviewHold(reread[0], paymentId);
      if (hold) return await projectRefundReview({ entities, order, paymentId, hold });
      throw error;
    }
    check(result?.success === true, 'refund_loyalty_post_unconfirmed');
  }
  const confirmed = await entities.UserPoints.filter({ customer_email: customerEmail }, undefined, 2);
  check(Array.isArray(confirmed) && confirmed.length === 1 && confirmed[0].id === accounts[0].id
    && Array.isArray(confirmed[0].points_history), 'refund_loyalty_readback_unconfirmed');
  const receipts = confirmed[0].points_history.filter(row => row.idempotency_key === reversalKey || isLegacyKey(row.idempotency_key));
  check(receipts.length === legacy.length + (remaining ? 1 : 0)
    && receipts.every(row => row.transaction_type === 'reversal' && integer(-row.amount))
    && receipts.reduce((sum, row) => sum - row.amount, 0) === awards[0].amount,
  'refund_loyalty_readback_unconfirmed');
  return { success: true, outcome: 'reversed', points_reversed: awards[0].amount, revision: REFUND_LOYALTY_REVISION };
}
