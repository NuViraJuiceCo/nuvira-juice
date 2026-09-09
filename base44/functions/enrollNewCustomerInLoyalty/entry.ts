import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import Stripe from 'npm:stripe@14.21.0';
import { noPaymentRouteOutcome } from '../../shared/routeReview.js';
import { applyPointsTransaction, syncPointsMemberProjection, readPointsAccount, reserveRewardPoints,
  settleRewardPoints, recordCanceledPointsReservation, verifyDirectPointsCheckoutContext,
  PointsAccountError, POINTS_ACCOUNT_REVISION, verifiedNoPaymentPointsMetadata,
  verifiedNoPaymentTierPointsSnapshot } from './pointsAccount.js';

type AnyRecord = Record<string, any>;

const VALID_TYPES = new Set(['earned', 'bonus', 'redeemed', 'reversal', 'adjustment', 'migration']);
const LOYALTY_LEDGER_RUNTIME_REVISION = '2026-09-09.no-payment-direct-points-v3';

async function rewardPaymentAction(base44: any, body: AnyRecord, action: string, actor: AnyRecord) {
  const customerEmail = email(body.customer_email);
  const paymentIntentId = text(body.stripe_payment_intent_id, 180);
  const checkoutSessionId = text(body.stripe_checkout_session_id, 180);
  const noPayment = Boolean(checkoutSessionId);
  const providerId = noPayment ? checkoutSessionId : paymentIntentId;
  const providerField = noPayment ? 'checkout_session_id' : 'payment_intent_id';
  if (!customerEmail.includes('@') || (noPayment && paymentIntentId)
    || !(noPayment ? /^cs_[a-zA-Z0-9_]+$/ : /^pi_[a-zA-Z0-9_]+$/).test(providerId)) {
    return Response.json({ error: 'reward_payment_identity_required' }, { status: 400 });
  }
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return Response.json({ error: 'reward_payment_verification_unavailable' }, { status: 503 });
  // Do not trust a caller-provided payment status or release-on-timeout request.
  // Retrieval is read-only; no confirm, capture, refund or cancel occurs here.
  const provider = new Stripe(key);
  const payment: AnyRecord = noPayment ? await provider.checkout.sessions.retrieve(providerId)
    : await provider.paymentIntents.retrieve(providerId);
  const metadata = payment.metadata || {};
  if (payment.id !== providerId || payment.livemode !== true || payment.currency !== 'usd'
    || metadata.checkout_mode !== 'account'
    || metadata.checkout_version !== (noPayment ? '4.0_reward_no_payment' : '3.0_embedded')
    || email(metadata.customer_email) !== customerEmail || metadata.internal_sandbox_checkout === 'true'
    || metadata.is_test_order === 'true' || !metadata.reward_reservation_id || !metadata.checkout_context_hash) {
    return Response.json({ error: 'reward_payment_identity_mismatch' }, { status: 409 });
  }
  // A completed zero-price Session has no PaymentIntent. Never reinterpret a
  // paid/unpaid nonzero session as a free order, or trust a supplied status.
  if (noPayment && (payment.mode !== 'payment' || payment.amount_total !== 0
    || payment.payment_intent !== null || !['open', 'complete', 'expired'].includes(payment.status)
    || !['unpaid', 'no_payment_required'].includes(payment.payment_status)
    || (payment.status === 'complete' && payment.payment_status !== 'no_payment_required'))) {
    return Response.json({ error: 'no_payment_session_not_verified' }, { status: 409 });
  }
  const entities = base44.asServiceRole.entities;
  const providerComplete = payment.status === (noPayment ? 'complete' : 'succeeded');
  const routeOutcome = noPayment ? await noPaymentRouteOutcome(entities, payment) : null;
  const complete = providerComplete && (!noPayment || routeOutcome === 'consumed');
  const expired = payment.status === (noPayment ? 'expired' : 'canceled') || routeOutcome === 'released';
  const directOnly = /^points:[a-f0-9]{64}$/.test(metadata.reward_reservation_id);
  // During preparation the ledger CAS owns creation of the protected records.
  // The exact cost may come from freshly retrieved server-issued metadata for
  // that hold only. Consumption additionally requires the persisted snapshot.
  const verifiedDirectPoints = directOnly ? (noPayment
    ? verifiedNoPaymentPointsMetadata(metadata)
    : await verifyDirectPointsCheckoutContext(entities, payment, customerEmail)) : null;
  if (directOnly && noPayment && complete) await verifyDirectPointsCheckoutContext(entities, payment, customerEmail);
  if (action === 'reserve_reward_checkout') {
    const directPoints = body.direct_points ?? 0;
    const rewards = directOnly ? [] : await entities.RewardTier.filter({ id: body.reward_id, is_active: true }, undefined, 2);
    if (directOnly ? (body.reward_id || directPoints !== verifiedDirectPoints || body.points !== verifiedDirectPoints)
      : (!body.reward_id || !Array.isArray(rewards) || rewards.length !== 1
      || !Number.isSafeInteger(rewards[0].points_required) || rewards[0].points_required <= 0
      || !Number.isSafeInteger(directPoints) || directPoints < 0
      || !Number.isSafeInteger(body.points)
      || rewards[0].points_required + directPoints !== body.points)) return Response.json({ error: 'reward_cost_changed' }, { status: 409 });
    if (!(noPayment ? ['open'] : ['requires_payment_method', 'requires_confirmation', 'requires_action']).includes(payment.status)) {
      // A response retry after success may reuse only the already-bound hold.
      // It must never create a fresh reservation for a captured/canceled PI.
      if (providerComplete) {
        const existingAccount = await readPointsAccount(entities, customerEmail);
        const existing = existingAccount.reward_reservations?.find((row: AnyRecord) => row.reservation_id === metadata.reward_reservation_id);
        if (existing && existing[providerField] === payment.id && existing.context_hash === metadata.checkout_context_hash
          && existing.points === body.points && ['held', 'consumed'].includes(existing.status)) {
          return Response.json({ success: true, idempotent: true, reservation_status: existing.status,
            ...(noPayment ? { preparation_attempt_id: existing.preparation_attempt_id || null } : {}),
            revision: POINTS_ACCOUNT_REVISION, writes_performed: false });
        }
      }
      return Response.json({ error: 'reward_payment_not_reservable' }, { status: 409 });
    }
    const result = await reserveRewardPoints(entities, customerEmail, {
      reservation_id: metadata.reward_reservation_id, context_hash: metadata.checkout_context_hash,
      [providerField]: payment.id, points: body.points,
      ...(noPayment && body.preparation_attempt_id ? { preparation_attempt_id: body.preparation_attempt_id } : {}),
    });
    await syncPointsMemberProjection(entities, customerEmail);
    return Response.json({ success: true, idempotent: result.idempotent,
      revision: POINTS_ACCOUNT_REVISION, reservation_status: result.reservation.status,
      ...(noPayment ? { preparation_attempt_id: result.reservation.preparation_attempt_id || null } : {}),
      available_points: result.account.total_points - result.account.reserved_points });
  }
  const account = await readPointsAccount(entities, customerEmail);
  let hold = account.reward_reservations?.find((row: AnyRecord) => row.reservation_id === metadata.reward_reservation_id);
  if (!hold && directOnly && expired && !providerComplete) {
    const canceled = await recordCanceledPointsReservation(entities, customerEmail, {
      reservation_id: metadata.reward_reservation_id, context_hash: metadata.checkout_context_hash,
      [providerField]: payment.id, points: verifiedDirectPoints, provider_status: payment.status,
      ...(noPayment ? { no_payment_required: true } : {}),
    });
    hold = canceled.reservation;
  }
  if (!hold || hold.context_hash !== metadata.checkout_context_hash || hold[providerField] !== payment.id) {
    return Response.json({ error: 'reward_reservation_payment_mismatch' }, { status: 409 });
  }
  if (directOnly && hold.points !== verifiedDirectPoints) return Response.json({ error: 'points_checkout_context_mismatch' }, { status: 409 });
  if (!complete && !expired) {
    return Response.json({ success: true, deferred: true, reservation_status: hold.status,
      reason: 'payment_still_retryable', writes_performed: false });
  }
  if ((complete && hold.status === 'released') || (expired && hold.status === 'consumed')) {
    return Response.json({ error: 'reservation_outcome_conflict' }, { status: 409 });
  }
  let transaction = null;
  let matchingTransactions: AnyRecord[] = [];
  if (complete) {
    if (noPayment) {
      // The exact priced checkout must exist before a completed Session can
      // consume a hold. Metadata alone is not a recoverable order snapshot.
      const contexts = await entities.CheckoutSession.filter({ stripe_session_id: payment.id }, undefined, 2);
      const context = contexts?.[0]?.checkout_data;
      if (!Array.isArray(contexts) || contexts.length !== 1 || !contexts[0]?.id
        || email(contexts[0].customer_email) !== customerEmail || email(context?.customer_email) !== customerEmail
        || contexts[0].order_number !== metadata.order_number || context?.order_number !== metadata.order_number
        || context?.total !== 0 || context?.checkout_context_hash !== metadata.checkout_context_hash
        || context?.reward_reservation_id !== metadata.reward_reservation_id
        || context?.reward_reservation_points !== hold.points
        || (!directOnly && context?.reward_checkout?.revision !== '2026-09-08.reward-checkout-v1')
        || !Array.isArray(context?.items) || !context.items.length) {
        return Response.json({ error: 'no_payment_checkout_context_missing' }, { status: 409 });
      }
      if (!directOnly && context.points_used > 0) verifiedNoPaymentTierPointsSnapshot(context, metadata);
    }
    const idempotencyKey = `${noPayment ? 'stripe_checkout' : 'stripe_payment'}:${payment.id}:redeemed`;
    const existing = await entities.LoyaltyTransaction.filter({ idempotency_key: idempotencyKey }, '-created_date', 20);
    if (!Array.isArray(existing) || existing.length >= 20) return Response.json({ error: 'loyalty_transaction_read_incomplete' }, { status: 409 });
    const active = existing.filter((row: AnyRecord) => row.status !== 'voided');
    if (active.some((row: AnyRecord) => email(row.customer_email) !== customerEmail || row.amount !== -hold.points
      || row.transaction_type !== 'redeemed') || active.filter((row: AnyRecord) => row.status === 'posted').length > 1) {
      return Response.json({ error: 'idempotency_key_conflict' }, { status: 409 });
    }
    matchingTransactions = active;
    const recorded = account.points_history?.find((row: AnyRecord) => row.idempotency_key === idempotencyKey)?.transaction_id;
    transaction = active.find((row: AnyRecord) => row.id === recorded)
      || active.find((row: AnyRecord) => row.status === 'posted')
      || active.sort((a: AnyRecord, b: AnyRecord) => String(a.id).localeCompare(String(b.id)))[0]
      || await entities.LoyaltyTransaction.create({
      idempotency_key: idempotencyKey, customer_email: customerEmail,
      amount: -hold.points, transaction_type: 'redeemed', status: 'pending',
      source_type: 'stripe_redemption', source_id: payment.id,
      order_number: metadata.order_number || null, description: 'Earned reward redeemed at checkout',
      occurred_at: new Date().toISOString(), actor_type: actor.actor_type, actor_email: actor.actor_email,
      metadata: { reservation_id: hold.reservation_id, checkout_context_hash: hold.context_hash },
    });
    if (email(transaction.customer_email) !== customerEmail || transaction.amount !== -hold.points
      || transaction.transaction_type !== 'redeemed') return Response.json({ error: 'idempotency_key_conflict' }, { status: 409 });
  }
  const result = await settleRewardPoints(entities, customerEmail, {
    reservation_id: hold.reservation_id, context_hash: hold.context_hash,
    [providerField]: payment.id, provider_status: payment.status,
    ...(noPayment ? { no_payment_required: true, route_review_outcome: routeOutcome } : {}),
  }, transaction);
  if (transaction) {
    const receipt = result.receipt;
    if (!receipt?.transaction_id) throw new PointsAccountError('reward_redemption_receipt_missing');
    if (receipt.transaction_id !== transaction.id) await entities.LoyaltyTransaction.update(transaction.id, { status: 'voided' });
    for (const duplicate of matchingTransactions) {
      if (duplicate.id !== receipt.transaction_id) await entities.LoyaltyTransaction.update(duplicate.id, { status: 'voided' });
    }
    await entities.LoyaltyTransaction.update(receipt.transaction_id, {
      status: 'posted', posted_at: new Date().toISOString(),
      balance_before: receipt.balanceBefore, balance_after: receipt.balanceAfter,
      lifetime_before: receipt.lifetimeBefore, lifetime_after: receipt.lifetimeAfter,
      redeemed_before: receipt.redeemedBefore, redeemed_after: receipt.redeemedAfter,
    });
  }
  await syncPointsMemberProjection(entities, customerEmail);
  return Response.json({ success: true, idempotent: result.idempotent, revision: POINTS_ACCOUNT_REVISION,
    reservation_status: result.reservation.status, available_points: result.account.total_points - result.account.reserved_points });
}

function text(value: unknown, maxLength = 300): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function email(value: unknown): string {
  return text(value, 320).toLowerCase();
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeMetadata(value: unknown): AnyRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: AnyRecord = {};
  for (const [key, raw] of Object.entries(value as AnyRecord).slice(0, 30)) {
    const safeKey = text(key, 80);
    if (!safeKey || /secret|token|authorization|password|raw_payload/i.test(safeKey)) continue;
    if (typeof raw === 'number' && Number.isFinite(raw)) result[safeKey] = raw;
    else if (typeof raw === 'boolean') result[safeKey] = raw;
    else if (raw !== null && raw !== undefined) result[safeKey] = text(raw, 300);
  }
  return result;
}

function bearer(req: Request): string {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function hasInternalAuth(req: Request, body: AnyRecord): boolean {
  const presented = [
    req.headers.get('x-internal-secret'),
    bearer(req),
    body?.internal_secret,
  ].map((value) => text(value, 1000)).filter(Boolean);
  const allowed = [
    Deno.env.get('LOYALTY_LEDGER_SECRET'),
    Deno.env.get('CUSTOMER_APP_SYNC_SECRET'),
    Deno.env.get('HUB_SYNC_SECRET'),
  ].map((value) => text(value, 1000)).filter(Boolean);
  return presented.some((candidate) => allowed.includes(candidate));
}

function balanceProjection(current: AnyRecord | null, transactionType: string, amount: number) {
  const balanceBefore = number(current?.total_points);
  const lifetimeBefore = number(current?.lifetime_points);
  const redeemedBefore = number(current?.redeemed_points);
  const balanceAfter = Math.max(0, balanceBefore + amount);
  const lifetimeDelta = transactionType === 'earned' || transactionType === 'bonus'
    ? Math.max(0, amount)
    : transactionType === 'reversal'
      ? Math.min(0, amount)
      : 0;
  const redeemedDelta = transactionType === 'redeemed' ? Math.abs(Math.min(0, amount)) : 0;
  return {
    balanceBefore,
    balanceAfter,
    lifetimeBefore,
    lifetimeAfter: Math.max(0, lifetimeBefore + lifetimeDelta),
    redeemedBefore,
    redeemedAfter: Math.max(0, redeemedBefore + redeemedDelta),
  };
}

async function syncCaches(base44: any, customerEmail: string, transaction: AnyRecord,
  snapshot: { balanceAfter: number; lifetimeAfter: number; redeemedAfter: number } | null = null) {
  // entities.UserPoints is the conditional-write authority. entities.LoyaltyMember
  // is a monotonic revisioned mirror, not a second balance calculation.
  const entities = base44.asServiceRole.entities;
  const result = await applyPointsTransaction(entities, customerEmail, transaction, snapshot);
  const canonicalId = result.receipt?.transaction_id || transaction.id;
  if (canonicalId !== transaction.id) {
    // Concurrent requests can create pending rows, but only the CAS winner's
    // receipt can become posted. Retain the losing row as a voided audit record.
    await entities.LoyaltyTransaction.update(transaction.id, { status: 'voided' });
  }
  const projection = result.projection;
  await entities.LoyaltyTransaction.update(canonicalId, {
    ...(projection ? {
      amount: result.receipt.amount,
      balance_before: projection.balanceBefore, balance_after: projection.balanceAfter,
      lifetime_before: projection.lifetimeBefore, lifetime_after: projection.lifetimeAfter,
      redeemed_before: projection.redeemedBefore, redeemed_after: projection.redeemedAfter,
    } : {}),
    status: 'posted', posted_at: new Date().toISOString(),
  });
  await syncPointsMemberProjection(entities, customerEmail);
  return { ...result, transaction_id: canonicalId };
}

async function reconcileSnapshot(base44: any, body: AnyRecord, actor: AnyRecord) {
  const customerEmail = email(body.customer_email);
  const idempotencyKey = text(body.idempotency_key, 300);
  const expectedTotal = Math.max(0, Math.trunc(number(body.expected_total, Number.NaN)));
  const expectedLifetime = Math.max(expectedTotal, Math.trunc(number(body.expected_lifetime, Number.NaN)));
  const expectedRedeemed = Math.max(0, Math.trunc(number(body.expected_redeemed, Number.NaN)));
  if (!customerEmail || !customerEmail.includes('@')) return Response.json({ error: 'valid_customer_email_required' }, { status: 400 });
  if (!idempotencyKey) return Response.json({ error: 'idempotency_key_required' }, { status: 400 });
  if (![expectedTotal, expectedLifetime, expectedRedeemed].every(Number.isFinite)) {
    return Response.json({ error: 'valid_expected_balances_required' }, { status: 400 });
  }
  const prior = await base44.asServiceRole.entities.LoyaltyTransaction.filter({ idempotency_key: idempotencyKey }, '-created_date', 3);
  if (prior.length > 1) return Response.json({ error: 'duplicate_loyalty_transactions' }, { status: 409 });
  if (prior[0]) {
    if (email(prior[0].customer_email) !== customerEmail || prior[0].transaction_type !== 'adjustment'
      || number(prior[0].balance_after) !== expectedTotal || number(prior[0].lifetime_after) !== expectedLifetime
      || number(prior[0].redeemed_after) !== expectedRedeemed) {
      return Response.json({ error: 'idempotency_key_conflict' }, { status: 409 });
    }
    if (prior[0].status === 'pending') {
      await syncCaches(base44, customerEmail, prior[0], {
        balanceAfter: expectedTotal, lifetimeAfter: expectedLifetime, redeemedAfter: expectedRedeemed,
      });
    } else if (prior[0].status === 'posted') await syncPointsMemberProjection(base44.asServiceRole.entities, customerEmail);
    else return Response.json({ error: 'loyalty_transaction_voided' }, { status: 409 });
    return Response.json({ success: true, idempotent: true, transaction: prior[0] });
  }

  const pointsRows = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: customerEmail }, '-updated_date', 5);
  const current = pointsRows[0] || null;
  const projection = {
    balanceBefore: number(current?.total_points),
    balanceAfter: expectedTotal,
    lifetimeBefore: number(current?.lifetime_points),
    lifetimeAfter: expectedLifetime,
    redeemedBefore: number(current?.redeemed_points),
    redeemedAfter: expectedRedeemed,
  };
  const amount = projection.balanceAfter - projection.balanceBefore;
  const occurredAt = text(body.occurred_at, 80) || new Date().toISOString();
  const transaction = await base44.asServiceRole.entities.LoyaltyTransaction.create({
    idempotency_key: idempotencyKey,
    customer_email: customerEmail,
    amount,
    transaction_type: 'adjustment',
    status: 'pending',
    description: text(body.description, 500) || 'Authoritative loyalty reconciliation',
    source_type: text(body.source_type, 80) || 'reconciliation',
    source_id: text(body.source_id, 180) || idempotencyKey,
    occurred_at: occurredAt,
    posted_at: new Date().toISOString(),
    balance_before: projection.balanceBefore,
    balance_after: projection.balanceAfter,
    lifetime_before: projection.lifetimeBefore,
    lifetime_after: projection.lifetimeAfter,
    redeemed_before: projection.redeemedBefore,
    redeemed_after: projection.redeemedAfter,
    actor_type: actor.actor_type,
    actor_email: actor.actor_email,
    metadata: safeMetadata(body.metadata),
  });
  const applied = await syncCaches(base44, customerEmail, transaction, projection);
  return Response.json({
    success: true,
    idempotent: applied.idempotent,
    transaction_id: applied.transaction_id,
    adjustment: applied.receipt.amount,
    available_points: applied.account.total_points - (applied.account.reserved_points || 0),
    lifetime_points: applied.account.lifetime_points,
    redeemed_points: applied.account.redeemed_points,
  });
}

async function enrollFromOrderAutomation(base44: any, body: AnyRecord) {
  const data = body?.data || {};
  const customerEmail = email(data.customer_email);
  if (!customerEmail) return Response.json({ success: true, skipped: true, reason: 'customer_email_missing' });
  const existing = await base44.asServiceRole.entities.LoyaltyMember.filter({ email: customerEmail }, '-created_date', 1);
  if (existing[0]) return Response.json({ success: true, skipped: true, reason: 'already_enrolled' });
  const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: customerEmail }, '-created_date', 5);
  const profile = profiles[0] || {};
  const orderName = text(data.customer_name || data.full_name, 180);
  const orderNameParts = orderName.split(/\s+/).filter(Boolean);
  const result = await base44.asServiceRole.functions.invoke('createLoyaltyMember', {
    email: customerEmail,
    first_name: text(profile.first_name || orderNameParts[0], 100),
    last_name: text(profile.last_name || orderNameParts.slice(1).join(' '), 100),
    phone: data.contact_phone || data.customer_phone || profile.phone || null,
  });
  const payload = result?.data || result;
  return Response.json(payload?.success === true ? payload : { error: payload?.error || 'loyalty_enrollment_failed' }, {
    status: payload?.success === true ? 200 : 500,
  });
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const base44 = createClientFromRequest(req);
    const internal = hasInternalAuth(req, body);
    const user = internal ? null : await base44.auth.me().catch(() => null);
    if (!internal && user?.role !== 'admin') {
      return Response.json({ error: user ? 'forbidden' : 'unauthorized' }, { status: user ? 403 : 401 });
    }

    if (!body.action && body?.data) return await enrollFromOrderAutomation(base44, body);
    const action = text(body.action || 'post', 40).toLowerCase();
    if (['reserve_reward_checkout', 'settle_reward_checkout'].includes(action)) {
      return await rewardPaymentAction(base44, body, action, {
        actor_type: internal ? 'service' : 'admin', actor_email: internal ? null : email(user?.email),
      });
    }
    if (action === 'reconcile') {
      return await reconcileSnapshot(base44, body, {
        actor_type: internal ? 'service' : 'admin',
        actor_email: internal ? null : email(user?.email),
      });
    }
    if (action !== 'post') return Response.json({ error: 'unsupported_action' }, { status: 400 });
    const customerEmail = email(body.customer_email);
    const idempotencyKey = text(body.idempotency_key, 300);
    const transactionType = text(body.transaction_type, 40).toLowerCase();
    const amount = number(body.amount, Number.NaN);
    if (!customerEmail || !customerEmail.includes('@')) return Response.json({ error: 'valid_customer_email_required' }, { status: 400 });
    if (!idempotencyKey) return Response.json({ error: 'idempotency_key_required' }, { status: 400 });
    if (!VALID_TYPES.has(transactionType)) return Response.json({ error: 'invalid_transaction_type' }, { status: 400 });
    if (!Number.isSafeInteger(amount) || amount === 0) return Response.json({ error: 'nonzero_integer_amount_required' }, { status: 400 });
    if ((transactionType === 'earned' || transactionType === 'bonus') && amount < 0) return Response.json({ error: 'earning_amount_must_be_positive' }, { status: 400 });
    if ((transactionType === 'redeemed' || transactionType === 'reversal') && amount > 0) return Response.json({ error: 'debit_amount_must_be_negative' }, { status: 400 });

    const prior = await base44.asServiceRole.entities.LoyaltyTransaction.filter({ idempotency_key: idempotencyKey }, '-created_date', 20);
    if (prior.length >= 20) return Response.json({ error: 'loyalty_transaction_lookup_incomplete' }, { status: 409 });
    const activePrior = prior.filter((row: AnyRecord) => row.status !== 'voided');
    if (activePrior[0]) {
      if (activePrior.some((row: AnyRecord) => email(row.customer_email) !== customerEmail || number(row.amount) !== amount
        || row.transaction_type !== transactionType)) {
        return Response.json({ error: 'idempotency_key_conflict' }, { status: 409 });
      }
      const posted = activePrior.filter((row: AnyRecord) => row.status === 'posted');
      if (posted.length > 1) return Response.json({ error: 'duplicate_posted_loyalty_transactions' }, { status: 409 });
      // Identical pending duplicates can be left by a process dying between
      // creation and CAS. The account receipt still decides the single winner.
      const priorTransaction = posted[0] || [...activePrior].sort((a, b) => a.id.localeCompare(b.id))[0];
      let canonicalId = priorTransaction.id;
      if (priorTransaction.status === 'pending') {
        const repaired = await syncCaches(base44, customerEmail, priorTransaction);
        canonicalId = repaired.transaction_id;
      }
      else if (priorTransaction.status === 'posted') await syncPointsMemberProjection(base44.asServiceRole.entities, customerEmail);
      else return Response.json({ error: 'invalid_loyalty_transaction_status' }, { status: 409 });
      for (const duplicate of activePrior) {
        if (duplicate.id !== canonicalId && duplicate.status === 'pending') {
          await base44.asServiceRole.entities.LoyaltyTransaction.update(duplicate.id, { status: 'voided' });
        }
      }
      return Response.json({ success: true, idempotent: true, transaction_id: canonicalId,
        runtime_revision: LOYALTY_LEDGER_RUNTIME_REVISION,
        transaction: { ...(activePrior.find((row: AnyRecord) => row.id === canonicalId) || priorTransaction), status: 'posted' } });
    }

    const pointsRows = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: customerEmail }, '-updated_date', 5);
    const projection = balanceProjection(pointsRows[0] || null, transactionType, amount);
    if (transactionType === 'redeemed' && projection.balanceBefore + amount < 0) {
      return Response.json({
        error: 'insufficient_points',
        available_points: projection.balanceBefore,
        requested_points: Math.abs(amount),
      }, { status: 409 });
    }

    const occurredAt = text(body.occurred_at, 80) || new Date().toISOString();
    const transaction = await base44.asServiceRole.entities.LoyaltyTransaction.create({
      idempotency_key: idempotencyKey,
      customer_email: customerEmail,
      amount,
      transaction_type: transactionType,
      status: 'pending',
      description: text(body.description, 500) || 'NuVira loyalty transaction',
      source_type: text(body.source_type, 80) || 'internal',
      source_id: text(body.source_id, 180) || null,
      provider_event_id: text(body.provider_event_id, 180) || null,
      order_id: text(body.order_id, 180) || null,
      order_number: text(body.order_number, 180) || null,
      occurred_at: occurredAt,
      posted_at: new Date().toISOString(),
      balance_before: projection.balanceBefore,
      balance_after: projection.balanceAfter,
      lifetime_before: projection.lifetimeBefore,
      lifetime_after: projection.lifetimeAfter,
      redeemed_before: projection.redeemedBefore,
      redeemed_after: projection.redeemedAfter,
      actor_type: internal ? 'service' : 'admin',
      actor_email: internal ? null : email(user?.email),
      metadata: safeMetadata(body.metadata),
    });
    const applied = await syncCaches(base44, customerEmail, transaction);
    return Response.json({
      success: true,
      idempotent: applied.idempotent,
      transaction_id: applied.transaction_id,
      runtime_revision: LOYALTY_LEDGER_RUNTIME_REVISION,
      available_points: applied.account.total_points - (applied.account.reserved_points || 0),
      lifetime_points: applied.account.lifetime_points,
      redeemed_points: applied.account.redeemed_points,
    });
  } catch (error) {
    if (error instanceof PointsAccountError) return Response.json({ error: error.code }, { status: 409 });
    const message = error instanceof Error ? error.message : String(error || 'loyalty_mutation_failed');
    console.error('[enrollNewCustomerInLoyalty]', message);
    return Response.json({ error: text(message, 500) || 'loyalty_mutation_failed' }, { status: 500 });
  }
});
