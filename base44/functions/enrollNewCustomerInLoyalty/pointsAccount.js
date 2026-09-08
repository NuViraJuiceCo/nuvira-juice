// Single-record compare-and-set protocol. Requires the documented updateMany
// query/update operators; never falls back to an unconditional balance write.
// Release requires an isolated Base44 conditional-write contract test in addition
// to local fixtures. This module does not claim multi-record transactions.
export const POINTS_ACCOUNT_REVISION = '2026-09-08.points-cas-no-payment-v3';

export class PointsAccountError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new PointsAccountError(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function integer(value, fallback = 0) {
  const n = value === undefined ? fallback : Number(value);
  if (value === null || value === '' || typeof value === 'boolean' || !Number.isSafeInteger(n) || n < 0) {
    fail('invalid_points_account');
  }
  return n;
}
function list(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail('invalid_points_account');
  return value;
}
function balances(row) {
  const total = integer(row.total_points);
  const reserved = integer(row.reserved_points);
  const holds = list(row.reward_reservations);
  const ids = new Set();
  const held = holds.reduce((sum, hold) => {
    if (!hold?.reservation_id || ids.has(hold.reservation_id)
      || !['held', 'consumed', 'released'].includes(hold.status)) fail('invalid_points_reservations');
    ids.add(hold.reservation_id);
    const points = integer(hold.points);
    if (!points || !hold.context_hash) fail('invalid_points_reservations');
    if ((hold.payment_intent_id != null && !/^pi_[a-zA-Z0-9_]+$/.test(hold.payment_intent_id))
      || (hold.checkout_session_id != null && !/^cs_[a-zA-Z0-9_]+$/.test(hold.checkout_session_id))
      || (hold.payment_intent_id && hold.checkout_session_id)) fail('invalid_points_reservations');
    if (hold.preparation_attempt_id != null && (!hold.checkout_session_id
      || !/^[a-zA-Z0-9_-]{16,80}$/.test(hold.preparation_attempt_id))) fail('invalid_points_reservations');
    return sum + (hold.status === 'held' ? points : 0);
  }, 0);
  if (reserved !== held || reserved > total) fail('invalid_points_reservations');
  return { total, reserved, holds, lifetime: integer(row.lifetime_points),
    redeemed: integer(row.redeemed_points), revision: integer(row.points_ledger_revision),
    history: list(row.points_history) };
}

export async function readPointsAccount(entities, customerEmail, { initialize = false } = {}) {
  let rows = await entities.UserPoints.filter({ customer_email: customerEmail }, undefined, 2);
  if (!Array.isArray(rows)) fail('points_account_unavailable');
  if (!rows.length && initialize) {
    // Existing enrollment compatibility. No reward hold may bootstrap an account.
    // No uniqueness guarantee is assumed: re-read, and fail closed on duplicates.
    await entities.UserPoints.create({ customer_email: customerEmail, total_points: 0,
      lifetime_points: 0, redeemed_points: 0, reserved_points: 0,
      points_ledger_revision: 0, points_history: [], claimed_rewards: [], reward_reservations: [] });
    rows = await entities.UserPoints.filter({ customer_email: customerEmail }, undefined, 2);
  }
  if (rows.length !== 1 || !rows[0]?.id) fail(rows.length > 1 ? 'duplicate_points_accounts' : 'points_account_missing');
  balances(rows[0]);
  return rows[0];
}

function revisionQuery(row) {
  return row.points_ledger_revision === undefined
    ? { $or: [{ points_ledger_revision: { $exists: false } }, { points_ledger_revision: 0 }] }
    : { points_ledger_revision: row.points_ledger_revision };
}

async function mutate(entities, customerEmail, derive, options = {}) {
  if (typeof entities.UserPoints.updateMany !== 'function') fail('conditional_points_updates_unavailable');
  for (let attempt = 0; attempt < 12; attempt++) {
    const row = await readPointsAccount(entities, customerEmail, options);
    const state = balances(row);
    const operation = derive(row, state);
    if (!operation.patch) return { ...operation, account: row, idempotent: true };
    const nextRevision = state.revision + 1;
    if (!Number.isSafeInteger(nextRevision)) fail('points_revision_exhausted');
    const patch = { ...operation.patch, points_ledger_revision: nextRevision };
    balances({ ...row, ...patch });
    const result = await entities.UserPoints.updateMany({
      id: row.id, customer_email: customerEmail, ...revisionQuery(row),
    }, { $set: patch });
    if (!result || result.success !== true || result.has_more !== false
      || ![0, 1].includes(result.updated)) fail('conditional_points_update_unconfirmed');
    if (result.updated === 1) return { ...operation, account: { ...row, ...patch }, idempotent: false };
  }
  fail('points_account_busy_retry');
}

function transactionPatch(state, transaction, snapshot = null) {
  const amount = Number(transaction.amount);
  if (!Number.isSafeInteger(amount) || (!snapshot && amount === 0)) fail('nonzero_integer_amount_required');
  const type = transaction.transaction_type;
  const after = snapshot ? {
    total: integer(snapshot.balanceAfter), lifetime: integer(snapshot.lifetimeAfter), redeemed: integer(snapshot.redeemedAfter),
  } : {
    total: Math.max(0, state.total + amount),
    lifetime: Math.max(0, state.lifetime + (['earned', 'bonus'].includes(type) ? Math.max(0, amount)
      : type === 'reversal' ? Math.min(0, amount) : 0)),
    redeemed: state.redeemed + (type === 'redeemed' ? Math.abs(Math.min(0, amount)) : 0),
  };
  if (snapshot && state.reserved) fail('points_reconciliation_has_active_reservations');
  if (type === 'redeemed' && state.total - state.reserved + amount < 0) fail('insufficient_points');
  if (after.total < state.reserved) fail('points_debit_conflicts_with_reservation');
  const projection = { balanceBefore: state.total, balanceAfter: after.total,
    lifetimeBefore: state.lifetime, lifetimeAfter: after.lifetime,
    redeemedBefore: state.redeemed, redeemedAfter: after.redeemed };
  const history = { amount: snapshot ? after.total - state.total : amount,
    type: type === 'bonus' ? 'bonus' : (type === 'redeemed' || type === 'reversal' || amount < 0) ? 'redeemed' : 'earned',
    transaction_type: type, description: transaction.description,
    idempotency_key: transaction.idempotency_key, transaction_id: transaction.id,
    event_key: transaction.source_id || undefined, timestamp: transaction.occurred_at,
    ...projection };
  return { patch: { total_points: after.total, lifetime_points: after.lifetime,
    redeemed_points: after.redeemed, points_history: [...state.history, history] }, projection, receipt: history };
}

/** @param {any} entities @param {string} customerEmail @param {any} transaction
 * @param {{balanceAfter: number, lifetimeAfter: number, redeemedAfter: number}|null} snapshot */
export async function applyPointsTransaction(entities, customerEmail, transaction, snapshot = null) {
  if (!transaction?.id || !transaction.idempotency_key) fail('idempotency_key_required');
  return mutate(entities, customerEmail, (row, state) => {
    const matches = state.history.filter(item => item.idempotency_key === transaction.idempotency_key);
    if (matches.length > 1) fail('duplicate_points_receipts');
    const receipt = matches[0];
    if (receipt) {
      if ((!snapshot && Number(receipt.amount) !== Number(transaction.amount))
        || (receipt.transaction_type && receipt.transaction_type !== transaction.transaction_type)) fail('idempotency_key_conflict');
      // Legacy receipts prove the delta was applied. Do not restore old balances
      // when another purchase was posted after a partially completed transaction.
      return { receipt, projection: receipt.balanceAfter === undefined ? null : receipt };
    }
    return transactionPatch(state, transaction, snapshot);
  }, { initialize: Boolean(snapshot || transaction.amount > 0) });
}

export async function reserveRewardPoints(entities, customerEmail, request) {
  const points = integer(request.points);
  const sessionId = request.checkout_session_id;
  if (request.preparation_attempt_id != null && (!sessionId
    || !/^[a-zA-Z0-9_-]{16,80}$/.test(request.preparation_attempt_id))) fail('invalid_points_reservation_request');
  if (sessionId && (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId) || request.payment_intent_id)) fail('invalid_points_reservation_request');
  if (!points || !/^[a-zA-Z0-9:_-]{16,180}$/.test(request.reservation_id || '')
    || !/^[a-f0-9]{64}$/.test(request.context_hash || '')) fail('invalid_points_reservation_request');
  return mutate(entities, customerEmail, (row, state) => {
    const existing = state.holds.find(hold => hold.reservation_id === request.reservation_id);
    if (existing) {
      if (existing.points !== points || existing.context_hash !== request.context_hash) fail('reservation_context_conflict');
      if (existing.status === 'released') fail('reservation_already_released');
      if ((existing.payment_intent_id ?? undefined) !== (request.payment_intent_id ?? undefined)
        || (existing.checkout_session_id ?? undefined) !== (request.checkout_session_id ?? undefined)) fail('reservation_payment_conflict');
      return { reservation: existing };
    }
    if (state.total - state.reserved < points) fail('insufficient_points');
    const reservation = { reservation_id: request.reservation_id, context_hash: request.context_hash,
      points, status: 'held', ...(request.payment_intent_id ? { payment_intent_id: request.payment_intent_id } : {}),
      ...(sessionId ? { checkout_session_id: sessionId } : {}),
      ...(request.preparation_attempt_id ? { preparation_attempt_id: request.preparation_attempt_id } : {}),
      created_at: request.created_at || new Date().toISOString() };
    return { reservation, patch: { reserved_points: state.reserved + points,
      reward_reservations: [...state.holds, reservation] } };
  });
}

// Only callers with a verified Stripe outcome may use this operation. A declined
// payment stays retryable; payment_failed or a local timeout must NOT release it.
export async function settleRewardPoints(entities, customerEmail, request, transaction = null) {
  const noPayment = Boolean(request.checkout_session_id);
  const providerId = noPayment ? request.checkout_session_id : request.payment_intent_id;
  const accepted = noPayment ? ['complete', 'expired'] : ['succeeded', 'canceled'];
  if (!accepted.includes(request.provider_status)
    || !(noPayment ? /^cs_[a-zA-Z0-9_]+$/ : /^pi_[a-zA-Z0-9_]+$/).test(providerId || '')
    || (noPayment && (request.payment_intent_id || request.no_payment_required !== true))) fail('confirmed_payment_outcome_required');
  const key = `${noPayment ? 'stripe_checkout' : 'stripe_payment'}:${providerId}:redeemed`;
  return mutate(entities, customerEmail, (row, state) => {
    const existing = state.holds.find(hold => hold.reservation_id === request.reservation_id);
    if (!existing || existing.context_hash !== request.context_hash) fail('reservation_context_conflict');
    if (existing.payment_intent_id && existing.payment_intent_id !== request.payment_intent_id) fail('reservation_payment_conflict');
    // No-cost sessions must be bound before their client secret is exposed. Do
    // not attach one to an unbound legacy payment reservation during settlement.
    if ((existing.checkout_session_id ?? undefined) !== (request.checkout_session_id ?? undefined)) fail('reservation_payment_conflict');
    const target = ['succeeded', 'complete'].includes(request.provider_status) ? 'consumed' : 'released';
    if (existing.status === target) {
      return { reservation: existing, receipt: state.history.find(item => item.idempotency_key === key) };
    }
    if (existing.status !== 'held') fail('reservation_outcome_conflict');
    const reservation = { ...existing, status: target,
      ...(noPayment ? { checkout_session_id: providerId } : { payment_intent_id: providerId }),
      settled_at: request.settled_at || new Date().toISOString() };
    const reduced = { ...state, reserved: state.reserved - existing.points };
    let result = { patch: {} };
    if (target === 'consumed') {
      if (!transaction?.id || transaction.amount !== -existing.points || transaction.transaction_type !== 'redeemed'
        || transaction.idempotency_key !== key) fail('reservation_transaction_mismatch');
      if (state.history.some(item => item.idempotency_key === transaction.idempotency_key)) fail('reservation_receipt_conflict');
      result = transactionPatch(reduced, transaction);
    }
    return { ...result, reservation, patch: { ...result.patch, reserved_points: reduced.reserved,
      reward_reservations: state.holds.map(hold => hold.reservation_id === existing.reservation_id ? reservation : hold) } };
  });
}

export async function syncPointsMemberProjection(entities, customerEmail) {
  if (typeof entities.LoyaltyMember.updateMany !== 'function') fail('conditional_member_updates_unavailable');
  for (let attempt = 0; attempt < 12; attempt++) {
    const account = await readPointsAccount(entities, customerEmail);
    const state = balances(account);
    const projection = { total_points: state.total, lifetime_points: state.lifetime, redeemed_points: state.redeemed,
      reserved_points: state.reserved, points_history: state.history,
      points_account_id: account.id, points_ledger_revision: state.revision };
    const members = await entities.LoyaltyMember.filter({ email: customerEmail }, undefined, 2);
    if (!Array.isArray(members) || members.length > 1) fail('duplicate_loyalty_members');
    if (!members.length) {
      await entities.LoyaltyMember.create({ email: customerEmail, ...projection });
      continue; // Detect a racing bootstrap rather than silently selecting a row.
    }
    const member = members[0];
    if (member.points_account_id && member.points_account_id !== account.id) fail('loyalty_projection_account_conflict');
    const revision = integer(member.points_ledger_revision);
    if (revision > state.revision) continue; // Re-read the source, never roll the mirror back.
    if (revision === state.revision && Object.keys(projection).every(key => same(member[key], projection[key]))) return;
    const response = await entities.LoyaltyMember.updateMany({ id: member.id, email: customerEmail, ...revisionQuery(member) }, { $set: projection });
    if (!response || response.success !== true || response.has_more !== false || ![0, 1].includes(response.updated)) {
      fail('conditional_member_update_unconfirmed');
    }
    if (response.updated === 1) return;
  }
  fail('loyalty_projection_busy_retry');
}
