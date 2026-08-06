import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ALLOWED_BAG_STATUSES = new Set(['accepted', 'not_eligible', 'not_found']);

function bearerToken(req) {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function hasInternalSyncAuth(req) {
  const token = bearerToken(req);
  const allowed = [
    Deno.env.get('CUSTOMER_APP_SYNC_SECRET'),
    Deno.env.get('HUB_SYNC_SECRET'),
  ].filter(Boolean);
  return Boolean(token && allowed.includes(token));
}

function text(value, maxLength = 500) {
  return (value ?? '').toString().trim().replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').slice(0, maxLength);
}

function lower(value) {
  return text(value).toLowerCase();
}

function requestedCount(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : 0;
}

function acceptedCount(value, requested, status) {
  if (status !== 'accepted') return 0;
  if (value === null || value === undefined || value === '') return requested;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > requested) throw new Error('accepted_count_out_of_range');
  return parsed;
}

function finalVerificationStatus({ smallRequested, toteRequested, smallAccepted, toteAccepted, smallStatus, toteStatus }) {
  const requested = smallRequested + toteRequested;
  const accepted = smallAccepted + toteAccepted;
  if (requested > 0 && accepted === requested) return 'verified';
  if (accepted > 0) return 'partially_verified';
  if ([smallStatus, toteStatus].includes('not_eligible')) return 'not_eligible';
  return 'not_found';
}

function returnCredit(smallAccepted, toteAccepted) {
  return Math.round((smallAccepted + toteAccepted * 2) * 100) / 100;
}

async function writeCommandLog({ base44, bagReturn, user, requestId, result, idempotentSkipped = false }) {
  const idempotencyKey = `bag_return_verification:${bagReturn.id}`;
  const existing = await base44.asServiceRole.entities.CommandLog.filter({ idempotency_key: idempotencyKey }, '-created_date', 1).catch(() => []);
  if (existing[0]?.id) return existing[0];
  const now = new Date().toISOString();
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: 'bag_return_verification',
    command_source: 'customer_app_admin',
    status: idempotentSkipped ? 'skipped' : 'success',
    target_entity: 'BagReturn',
    target_id: bagReturn.id,
    target_display_id: bagReturn.id,
    actor_email: text(user?.email, 180),
    actor_role: text(user?.role, 80),
    actor_type: 'admin',
    payload: { exact_bag_return_id: true },
    result,
    idempotency_key: idempotencyKey,
    idempotent_skipped: idempotentSkipped,
    request_id: text(requestId, 180) || null,
    submitted_at: now,
    completed_at: now,
    function_name: 'getBagReturnsForSync',
    notes: 'Verifies one exact bag return and issues its NuVira Credit idempotently. No email, push, provider, order, inventory, or loyalty-point writes.',
  }).catch(() => null);
}

async function verifyReturn(base44, user, body) {
  const bagReturnId = text(body.bag_return_id, 180);
  if (!bagReturnId) return Response.json({ success: false, error_code: 'bag_return_id_required' }, { status: 400 });
  const bagReturn = await base44.asServiceRole.entities.BagReturn.get(bagReturnId).catch(() => null);
  if (!bagReturn?.id) return Response.json({ success: false, error_code: 'bag_return_not_found' }, { status: 404 });
  if (!lower(bagReturn.customer_email)) return Response.json({ success: false, error_code: 'bag_return_customer_missing' }, { status: 409 });

  if (bagReturn.verification_status !== 'requested') {
    const result = {
      bag_return_id: bagReturn.id,
      verification_status: bagReturn.verification_status,
      credit_issued: Number(bagReturn.credit_issued || 0),
      credit_applied: bagReturn.credit_applied === true,
      writes_performed: false,
      idempotent: true,
    };
    await writeCommandLog({ base44, bagReturn, user, requestId: body.request_id, result, idempotentSkipped: true });
    return Response.json({ success: true, ...result });
  }

  const smallRequested = requestedCount(bagReturn.small_bags_requested);
  const toteRequested = requestedCount(bagReturn.tote_bags_requested);
  if (smallRequested + toteRequested === 0) {
    return Response.json({ success: false, error_code: 'bag_return_has_no_requested_bags' }, { status: 409 });
  }
  const smallStatus = smallRequested > 0 ? lower(body.small_bag_status || 'accepted') : 'not_found';
  const toteStatus = toteRequested > 0 ? lower(body.tote_bag_status || 'accepted') : 'not_found';
  if ((smallRequested > 0 && !ALLOWED_BAG_STATUSES.has(smallStatus)) ||
      (toteRequested > 0 && !ALLOWED_BAG_STATUSES.has(toteStatus))) {
    return Response.json({ success: false, error_code: 'invalid_bag_status' }, { status: 400 });
  }

  let smallAccepted;
  let toteAccepted;
  try {
    smallAccepted = acceptedCount(body.small_bags_accepted, smallRequested, smallStatus);
    toteAccepted = acceptedCount(body.tote_bags_accepted, toteRequested, toteStatus);
  } catch {
    return Response.json({ success: false, error_code: 'accepted_count_out_of_range' }, { status: 400 });
  }

  const verificationStatus = finalVerificationStatus({ smallRequested, toteRequested, smallAccepted, toteAccepted, smallStatus, toteStatus });
  const credit = returnCredit(smallAccepted, toteAccepted);
  const historyKey = `bag_return:${bagReturn.id}`;
  let creditAlreadyPresent = false;

  if (credit > 0) {
    const creditAccounts = await base44.asServiceRole.entities.NuViraCredit.filter({ customer_email: bagReturn.customer_email }, '-created_date', 5);
    if (creditAccounts.length > 1) return Response.json({ success: false, error_code: 'credit_account_ambiguous' }, { status: 409 });
    const account = creditAccounts[0] || null;
    const history = Array.isArray(account?.history) ? account.history : [];
    creditAlreadyPresent = history.some(entry => text(entry?.order_id, 200) === historyKey);
    if (!creditAlreadyPresent) {
      const entry = {
        amount: credit,
        type: 'issued',
        description: 'Return + Reward bag credit',
        order_id: historyKey,
        timestamp: new Date().toISOString(),
      };
      if (account?.id) {
        await base44.asServiceRole.entities.NuViraCredit.update(account.id, {
          balance: Math.round((Number(account.balance || 0) + credit) * 100) / 100,
          lifetime_issued: Math.round((Number(account.lifetime_issued || 0) + credit) * 100) / 100,
          history: [...history.slice(-199), entry],
        });
      } else {
        await base44.asServiceRole.entities.NuViraCredit.create({
          customer_email: bagReturn.customer_email,
          balance: credit,
          lifetime_issued: credit,
          lifetime_used: 0,
          history: [entry],
        });
      }
    }
  }

  const updated = await base44.asServiceRole.entities.BagReturn.update(bagReturn.id, {
    small_bag_status: smallRequested > 0 ? smallStatus : 'pending',
    tote_bag_status: toteRequested > 0 ? toteStatus : 'pending',
    small_bags_accepted: smallAccepted,
    tote_bags_accepted: toteAccepted,
    rejection_reason: [smallStatus, toteStatus].includes('not_eligible') ? text(body.rejection_reason || 'other', 120) : '',
    driver_notes: text(body.notes || body.driver_notes, 1000),
    verification_status: verificationStatus,
    credit_issued: credit,
    credit_applied: credit > 0,
    verified_by: text(user.email, 180),
    verified_at: new Date().toISOString(),
  });

  const result = {
    bag_return_id: updated.id,
    verification_status: verificationStatus,
    small_bags_accepted: smallAccepted,
    tote_bags_accepted: toteAccepted,
    credit_issued: credit,
    credit_applied: credit > 0,
    credit_already_present: creditAlreadyPresent,
    writes_performed: true,
    idempotent: creditAlreadyPresent,
    customer_notification_sent: false,
  };
  await writeCommandLog({ base44, bagReturn: updated, user, requestId: body.request_id, result });
  return Response.json({ success: true, ...result });
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const internalSync = hasInternalSyncAuth(req);
    const user = internalSync ? null : await base44.auth.me().catch(() => null);
    if (!internalSync && user?.role !== 'admin') {
      return Response.json({ error: user ? 'forbidden' : 'unauthorized' }, { status: user ? 403 : 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'malformed_json' }, { status: 400 });
    }

    if (body.action === 'verify_return') {
      if (user?.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403 });
      return verifyReturn(base44, user, body);
    }

    const query = body.status ? { verification_status: body.status } : {};
    const bagReturns = await base44.asServiceRole.entities.BagReturn.filter(query, '-created_date');
    const formatted = bagReturns.map(br => ({
      id: br.id,
      order_id: br.order_id,
      customer_email: br.customer_email,
      small_bags_requested: br.small_bags_requested,
      tote_bags_requested: br.tote_bags_requested,
      small_bags_accepted: br.small_bags_accepted,
      tote_bags_accepted: br.tote_bags_accepted,
      small_bag_status: br.small_bag_status,
      tote_bag_status: br.tote_bag_status,
      verification_status: br.verification_status,
      credit_issued: br.credit_issued,
      credit_applied: br.credit_applied,
      verified_by: br.verified_by,
      verified_at: br.verified_at,
      photo_url: br.photo_url,
      created_date: br.created_date,
    }));
    return Response.json({ bag_returns: formatted, count: formatted.length });
  } catch (error) {
    console.error('[getBagReturnsForSync] Error');
    return Response.json({ error: 'Unable to process bag returns' }, { status: 500 });
  }
});
