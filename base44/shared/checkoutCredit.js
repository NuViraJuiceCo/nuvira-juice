// One credit-account CAS, shared by checkout and the signed-payment handler.
// This is not a cross-record transaction. Provider/storage ambiguity keeps the
// hold intact and the payment secret withheld. No timer releases spendable value.
export const CHECKOUT_CREDIT_REVISION = '2026-09-08.credit-reservation-v1';
export class CheckoutCreditError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new CheckoutCreditError(code); };
export function creditCents(value = 0) {
  const number = Number(value);
  const cents = Math.round(number * 100);
  if (value === null || value === '' || typeof value === 'boolean'
    || !Number.isFinite(number) || !Number.isSafeInteger(cents) || cents < 0
    || Math.abs(number * 100 - cents) > 0.00001) fail('invalid_checkout_credit_amount');
  return cents;
}
export function creditAccountState(row) {
  const balance = creditCents(row.balance === undefined ? 0 : row.balance);
  const reserved = creditCents(row.reserved_balance === undefined ? 0 : row.reserved_balance);
  const lifetime = creditCents(row.lifetime_used === undefined ? 0 : row.lifetime_used);
  const revision = row.credit_ledger_revision === undefined ? 0 : row.credit_ledger_revision;
  const holds = row.checkout_reservations === undefined ? [] : row.checkout_reservations;
  const history = row.history === undefined ? [] : row.history;
  if (!Number.isSafeInteger(revision) || revision < 0 || !Array.isArray(holds)
    || !Array.isArray(history)) fail('invalid_credit_account');
  const ids = new Set();
  const paymentIds = new Set();
  let held = 0;
  for (const hold of holds) {
    if (!/^credit:[a-f0-9]{64}$/.test(hold?.reservation_id || '') || ids.has(hold.reservation_id)
      || paymentIds.has(hold.payment_intent_id)
      || !/^[a-f0-9]{64}$/.test(hold.context_hash || '') || !/^pi_[a-zA-Z0-9_]+$/.test(hold.payment_intent_id || '')
      || !['held', 'consumed', 'released'].includes(hold.status)
      || !Number.isSafeInteger(hold.amount_cents) || hold.amount_cents <= 0) fail('invalid_credit_reservations');
    ids.add(hold.reservation_id);
    paymentIds.add(hold.payment_intent_id);
    if (hold.status === 'held') held += hold.amount_cents;
  }
  if (!Number.isSafeInteger(held) || held !== reserved || reserved > balance) fail('invalid_credit_reservations');
  return { balance, reserved, lifetime, revision, holds, history, available: balance - reserved };
}
async function account(entities, email) {
  let rows;
  try { rows = await entities.NuViraCredit.filter({ customer_email: email }, undefined, 2); }
  catch { fail('checkout_credit_account_unavailable'); }
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.id
    || rows[0].customer_email !== email) fail('checkout_credit_account_unavailable');
  creditAccountState(rows[0]);
  return rows[0];
}
export async function availableCheckoutCredit(entities, email, retryReservationId = null) {
  const state = creditAccountState(await account(entities, email));
  const own = state.holds.find(hold => hold.reservation_id === retryReservationId);
  const restored = own && ['held', 'consumed'].includes(own.status) ? own.amount_cents : 0;
  return (state.available + restored) / 100;
}
async function mutate(entities, email, derive) {
  if (typeof entities.NuViraCredit.updateMany !== 'function') fail('conditional_credit_updates_unavailable');
  for (let attempt = 0; attempt < 12; attempt++) {
    const row = await account(entities, email);
    const state = creditAccountState(row);
    const result = derive(state);
    if (!result.patch) return { ...result, idempotent: true };
    const revision = state.revision + 1;
    if (!Number.isSafeInteger(revision)) fail('credit_revision_exhausted');
    const patch = { ...result.patch, credit_ledger_revision: revision };
    creditAccountState({ ...row, ...patch });
    const revisionQuery = row.credit_ledger_revision === undefined
      ? { $or: [{ credit_ledger_revision: { $exists: false } }, { credit_ledger_revision: 0 }] }
      : { credit_ledger_revision: state.revision };
    const updated = await entities.NuViraCredit.updateMany({ id: row.id, customer_email: email, ...revisionQuery }, { $set: patch });
    if (updated?.success !== true || updated.has_more !== false || ![0, 1].includes(updated.updated)) fail('conditional_credit_update_unconfirmed');
    if (updated.updated === 1) {
      const confirmed = derive(creditAccountState(await account(entities, email)));
      if (confirmed.patch) fail('conditional_credit_readback_unconfirmed');
      return { ...confirmed, idempotent: false };
    }
  }
  fail('credit_account_busy_retry');
}
function paymentIdentity(payment, email) {
  const meta = payment?.metadata || {};
  if (!/^pi_[a-zA-Z0-9_]+$/.test(payment?.id || '') || payment.livemode !== true || payment.currency !== 'usd'
    || meta.checkout_version !== '3.0_embedded' || meta.checkout_mode !== 'account'
    || meta.customer_email !== email || meta.internal_sandbox_checkout === 'true' || meta.is_test_order === 'true'
    || !/^credit:[a-f0-9]{64}$/.test(meta.credit_reservation_id || '')
    || !/^[a-f0-9]{64}$/.test(meta.checkout_context_hash || '')
    || !/^[1-9][0-9]*$/.test(meta.credit_reservation_cents || '')
    || !Number.isSafeInteger(Number(meta.credit_reservation_cents))
    || !Number.isSafeInteger(payment.amount) || payment.amount < 50) fail('checkout_credit_payment_mismatch');
  return { reservation_id: meta.credit_reservation_id, context_hash: meta.checkout_context_hash,
    payment_intent_id: payment.id, amount_cents: Number(meta.credit_reservation_cents) };
}
function bound(hold, identity) {
  if (hold.context_hash !== identity.context_hash || hold.payment_intent_id !== identity.payment_intent_id
    || hold.amount_cents !== identity.amount_cents) fail('checkout_credit_context_conflict');
}
async function context(entities, payment, email) {
  const sessions = await entities.CheckoutSession.filter({ stripe_session_id: payment.id }, undefined, 2);
  const orders = await entities.Order.filter({ stripe_payment_intent_id: payment.id }, undefined, 2);
  if (!Array.isArray(sessions) || sessions.length !== 1 || !sessions[0]?.id
    || !Array.isArray(orders) || orders.length !== 1 || !orders[0]?.id) fail('checkout_credit_context_unavailable');
  const session = sessions[0]; const order = orders[0]; const data = session.checkout_data;
  for (const row of [session, order, data]) {
    if (!row || row.customer_email !== email || row.order_number !== payment.metadata.order_number) fail('checkout_credit_context_mismatch');
  }
  if (data.guest_checkout === true || data.internal_sandbox_checkout === true || order.is_test_order === true
    || data.checkout_context_hash !== payment.metadata.checkout_context_hash
    || data.credit_reservation_id !== payment.metadata.credit_reservation_id
    || data.credit_reservation_revision !== CHECKOUT_CREDIT_REVISION
    || creditCents(data.total) !== payment.amount || creditCents(order.total) !== payment.amount
    || ['canceled', 'cancelled', 'refunded'].includes(order.status)
    || ['refunded', 'partially_refunded'].includes(order.payment_status)) fail('checkout_credit_context_mismatch');
  const amount = creditCents(data.credits_discount);
  if (!amount || amount !== Number(payment.metadata.credit_reservation_cents)) fail('checkout_credit_context_mismatch');
  return { amount, order };
}
export async function reserveCheckoutCredit({ entities, stripe, email, paymentId }) {
  // Independently re-read the provider; the caller cannot supply payment status.
  const payment = await stripe.paymentIntents.retrieve(paymentId);
  if (payment?.id !== paymentId) fail('checkout_credit_payment_mismatch');
  const identity = paymentIdentity(payment, email);
  const { amount } = await context(entities, payment, email);
  return mutate(entities, email, state => {
    const existing = state.holds.find(hold => hold.reservation_id === identity.reservation_id);
    if (existing) {
      bound(existing, identity);
      if (existing.amount_cents !== amount || existing.status === 'released'
        || (existing.status === 'consumed' && payment.status !== 'succeeded')
        || !['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'succeeded'].includes(payment.status)) fail('checkout_credit_reservation_conflict');
      return { reservation_status: existing.status };
    }
    if (!['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(payment.status)) fail('checkout_credit_payment_not_reservable');
    if (state.available < amount) fail('insufficient_checkout_credit');
    const hold = { ...identity, amount_cents: amount, status: 'held', created_at: new Date().toISOString() };
    return { reservation_status: 'held', patch: { reserved_balance: (state.reserved + amount) / 100,
      checkout_reservations: [...state.holds, hold] } };
  });
}
export async function settleCheckoutCredit({ entities, payment, email }) {
  const identity = paymentIdentity(payment, email);
  // Caller supplies the signed succeeded event or a fresh provider retrieval.
  // A timeout, decline, processing state, or an expired local session is NOT a release.
  if (!['succeeded', 'canceled'].includes(payment.status)) fail('checkout_credit_terminal_payment_required');
  const consumed = payment.status === 'succeeded';
  if (consumed && payment.amount_received !== payment.amount) fail('checkout_credit_payment_not_fully_received');
  const details = consumed ? await context(entities, payment, email) : null;
  return mutate(entities, email, state => {
    const hold = state.holds.find(row => row.reservation_id === identity.reservation_id);
    if (!hold) {
      // Persist cancellation even when it beats reservation to the account CAS.
      // This tombstone prevents a request with an older provider read from
      // reserving after the cancellation webhook has already finished.
      if (!consumed) return { reservation_status: 'released', patch: {
        checkout_reservations: [...state.holds, { ...identity, status: 'released', settled_at: new Date().toISOString() }],
      } };
      fail('checkout_credit_reservation_missing');
    }
    bound(hold, identity);
    const target = consumed ? 'consumed' : 'released';
    if (details && details.amount !== hold.amount_cents) fail('checkout_credit_context_conflict');
    const key = `stripe_payment:${payment.id}:credit`;
    const receipts = state.history.filter(entry => entry.idempotency_key === key
      || (details && entry.type === 'used' && entry.order_id === details.order.id));
    if (hold.status === target) {
      if (consumed && (receipts.length !== 1 || receipts[0].idempotency_key !== key
        || receipts[0].payment_intent_id !== payment.id || receipts[0].order_id !== details.order.id
        || creditCents(receipts[0].amount) !== hold.amount_cents)) fail('checkout_credit_receipt_mismatch');
      return { reservation_status: target };
    }
    if (hold.status !== 'held' || receipts.length) fail('checkout_credit_settlement_conflict');
    const next = { ...hold, status: target, settled_at: new Date().toISOString() };
    const patch = { reserved_balance: (state.reserved - hold.amount_cents) / 100,
      checkout_reservations: state.holds.map(row => row.reservation_id === hold.reservation_id ? next : row),
      ...(consumed ? { balance: (state.balance - hold.amount_cents) / 100,
        lifetime_used: (state.lifetime + hold.amount_cents) / 100,
        history: [...state.history, { amount: hold.amount_cents / 100, type: 'used',
          description: `Applied to order ${details.order.order_number}`, order_id: details.order.id,
          payment_intent_id: payment.id, idempotency_key: key, timestamp: next.settled_at }] } : {}) };
    return { reservation_status: target, patch };
  });
}
