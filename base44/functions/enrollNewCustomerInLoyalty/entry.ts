import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';

type AnyRecord = Record<string, any>;

const VALID_TYPES = new Set(['earned', 'bonus', 'redeemed', 'reversal', 'adjustment', 'migration']);

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

function historyType(transactionType: string, amount = 0): 'earned' | 'redeemed' | 'bonus' {
  if (transactionType === 'bonus') return 'bonus';
  if (transactionType === 'redeemed' || transactionType === 'reversal' || amount < 0) return 'redeemed';
  return 'earned';
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

async function syncCaches(base44: any, customerEmail: string, transaction: AnyRecord, projection: AnyRecord) {
  const historyEntry = {
    amount: transaction.amount,
    type: historyType(transaction.transaction_type, number(transaction.amount)),
    description: transaction.description,
    event_key: transaction.source_id || undefined,
    idempotency_key: transaction.idempotency_key,
    timestamp: transaction.occurred_at,
  };
  const [pointsRows, memberRows] = await Promise.all([
    base44.asServiceRole.entities.UserPoints.filter({ customer_email: customerEmail }, '-updated_date', 5),
    base44.asServiceRole.entities.LoyaltyMember.filter({ email: customerEmail }, '-updated_date', 5),
  ]);
  const points = pointsRows[0] || null;
  const members = memberRows[0] || null;
  const aggregate = {
    total_points: projection.balanceAfter,
    lifetime_points: projection.lifetimeAfter,
    redeemed_points: projection.redeemedAfter,
  };
  if (points) {
    const history = Array.isArray(points.points_history) ? points.points_history : [];
    const hasEntry = history.some((row: AnyRecord) => row?.idempotency_key === transaction.idempotency_key);
    await base44.asServiceRole.entities.UserPoints.update(points.id, {
      ...aggregate,
      points_history: hasEntry ? history : [...history, historyEntry],
    });
  } else {
    await base44.asServiceRole.entities.UserPoints.create({
      customer_email: customerEmail,
      ...aggregate,
      points_history: [historyEntry],
      claimed_rewards: [],
    });
  }
  if (members) {
    const history = Array.isArray(members.points_history) ? members.points_history : [];
    const hasEntry = history.some((row: AnyRecord) => row?.idempotency_key === transaction.idempotency_key);
    await base44.asServiceRole.entities.LoyaltyMember.update(members.id, {
      ...aggregate,
      points_history: hasEntry ? history : [...history, historyEntry],
    });
  } else {
    await base44.asServiceRole.entities.LoyaltyMember.create({
      email: customerEmail,
      ...aggregate,
      points_history: [historyEntry],
    });
  }
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
  if (prior[0]) return Response.json({ success: true, idempotent: true, transaction: prior[0] });

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
  await syncCaches(base44, customerEmail, transaction, projection);
  await base44.asServiceRole.entities.LoyaltyTransaction.update(transaction.id, { status: 'posted' });
  return Response.json({
    success: true,
    idempotent: false,
    transaction_id: transaction.id,
    adjustment: amount,
    available_points: projection.balanceAfter,
    lifetime_points: projection.lifetimeAfter,
    redeemed_points: projection.redeemedAfter,
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
    const amount = Math.trunc(number(body.amount, Number.NaN));
    if (!customerEmail || !customerEmail.includes('@')) return Response.json({ error: 'valid_customer_email_required' }, { status: 400 });
    if (!idempotencyKey) return Response.json({ error: 'idempotency_key_required' }, { status: 400 });
    if (!VALID_TYPES.has(transactionType)) return Response.json({ error: 'invalid_transaction_type' }, { status: 400 });
    if (!Number.isFinite(amount) || amount === 0) return Response.json({ error: 'nonzero_integer_amount_required' }, { status: 400 });
    if ((transactionType === 'earned' || transactionType === 'bonus') && amount < 0) return Response.json({ error: 'earning_amount_must_be_positive' }, { status: 400 });
    if ((transactionType === 'redeemed' || transactionType === 'reversal') && amount > 0) return Response.json({ error: 'debit_amount_must_be_negative' }, { status: 400 });

    const prior = await base44.asServiceRole.entities.LoyaltyTransaction.filter({ idempotency_key: idempotencyKey }, '-created_date', 3);
    if (prior[0]) {
      if (email(prior[0].customer_email) !== customerEmail || number(prior[0].amount) !== amount) {
        return Response.json({ error: 'idempotency_key_conflict' }, { status: 409 });
      }
      if (prior[0].status === 'pending') {
        const replayProjection = {
          balanceBefore: number(prior[0].balance_before),
          balanceAfter: number(prior[0].balance_after),
          lifetimeBefore: number(prior[0].lifetime_before),
          lifetimeAfter: number(prior[0].lifetime_after),
          redeemedBefore: number(prior[0].redeemed_before),
          redeemedAfter: number(prior[0].redeemed_after),
        };
        await syncCaches(base44, customerEmail, prior[0], replayProjection);
        await base44.asServiceRole.entities.LoyaltyTransaction.update(prior[0].id, { status: 'posted' });
      }
      return Response.json({ success: true, idempotent: true, transaction: prior[0] });
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
    await syncCaches(base44, customerEmail, transaction, projection);
    await base44.asServiceRole.entities.LoyaltyTransaction.update(transaction.id, { status: 'posted' });
    return Response.json({
      success: true,
      idempotent: false,
      transaction_id: transaction.id,
      available_points: projection.balanceAfter,
      lifetime_points: projection.lifetimeAfter,
      redeemed_points: projection.redeemedAfter,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'loyalty_mutation_failed');
    console.error('[enrollNewCustomerInLoyalty]', message);
    return Response.json({ error: text(message, 500) || 'loyalty_mutation_failed' }, { status: 500 });
  }
});
