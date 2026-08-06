import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CREDIT_PER_SMALL_BAG = 1;
const CREDIT_PER_TOTE_BAG = 2;
const ALLOWED_BAG_STATUSES = new Set(['accepted', 'not_eligible', 'not_found']);

function normalizeText(value: unknown): string {
  return (value ?? '').toString().trim();
}

function normalizeLower(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function sanitizeText(value: unknown, maxLength = 500): string {
  const normalized = normalizeText(value).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ');
  return normalized.slice(0, maxLength);
}

function safeRequestedCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : 0;
}

function acceptedCount(value: unknown, requested: number, status: string): number {
  if (status !== 'accepted') return 0;
  if (value === null || value === undefined || value === '') return requested;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > requested) {
    throw new Error('accepted_count_out_of_range');
  }
  return parsed;
}

function verificationStatus({
  smallRequested,
  toteRequested,
  smallAccepted,
  toteAccepted,
  smallStatus,
  toteStatus,
}: {
  smallRequested: number;
  toteRequested: number;
  smallAccepted: number;
  toteAccepted: number;
  smallStatus: string;
  toteStatus: string;
}): string {
  const requested = smallRequested + toteRequested;
  const accepted = smallAccepted + toteAccepted;
  if (requested > 0 && accepted === requested) return 'verified';
  if (accepted > 0) return 'partially_verified';
  if ([smallStatus, toteStatus].includes('not_eligible')) return 'not_eligible';
  return 'not_found';
}

function bagReturnCredit(smallAccepted: number, toteAccepted: number): number {
  return Math.round((smallAccepted * CREDIT_PER_SMALL_BAG + toteAccepted * CREDIT_PER_TOTE_BAG) * 100) / 100;
}

function creditHistoryKey(bagReturnId: string): string {
  return `bag_return:${bagReturnId}`;
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

async function writeCommandLog({
  base44,
  bagReturn,
  user,
  requestId,
  result,
  idempotentSkipped = false,
}: any) {
  const idempotencyKey = `bag_return_verification:${bagReturn.id}`;
  const existing = await base44.asServiceRole.entities.CommandLog.filter(
    { idempotency_key: idempotencyKey },
    '-created_date',
    1,
  ).catch(() => []);
  if (existing[0]?.id) return existing[0];

  const now = new Date().toISOString();
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: 'bag_return_verification',
    command_source: 'customer_app_admin',
    status: idempotentSkipped ? 'skipped' : 'success',
    target_entity: 'BagReturn',
    target_id: bagReturn.id,
    target_display_id: bagReturn.id,
    actor_email: sanitizeText(user?.email, 180),
    actor_role: sanitizeText(user?.role, 80),
    actor_type: 'admin',
    payload: { exact_bag_return_id: true },
    result,
    idempotency_key: idempotencyKey,
    idempotent_skipped: idempotentSkipped,
    request_id: sanitizeText(requestId, 180) || null,
    submitted_at: now,
    completed_at: now,
    function_name: 'verifyAdminBagReturn',
    notes: 'Verifies one exact bag return and issues its NuVira Credit idempotently. No email, push, provider, order, inventory, or loyalty-point writes.',
  }).catch(() => null);
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) return Response.json({ success: false, error_code: 'unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ success: false, error_code: 'forbidden' }, { status: 403 });

    const body = await readJsonBody(req);
    if (body === null) return Response.json({ success: false, error_code: 'malformed_json' }, { status: 400 });
    const bagReturnId = sanitizeText(body.bag_return_id, 180);
    if (!bagReturnId) return Response.json({ success: false, error_code: 'bag_return_id_required' }, { status: 400 });

    const bagReturn = await base44.asServiceRole.entities.BagReturn.get(bagReturnId).catch(() => null);
    if (!bagReturn?.id) return Response.json({ success: false, error_code: 'bag_return_not_found' }, { status: 404 });

    const customerEmail = normalizeLower(bagReturn.customer_email);
    if (!customerEmail) return Response.json({ success: false, error_code: 'bag_return_customer_missing' }, { status: 409 });

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

    const smallRequested = safeRequestedCount(bagReturn.small_bags_requested);
    const toteRequested = safeRequestedCount(bagReturn.tote_bags_requested);
    if (smallRequested + toteRequested === 0) {
      return Response.json({ success: false, error_code: 'bag_return_has_no_requested_bags' }, { status: 409 });
    }

    const smallStatus = smallRequested > 0 ? normalizeLower(body.small_bag_status || 'accepted') : 'not_found';
    const toteStatus = toteRequested > 0 ? normalizeLower(body.tote_bag_status || 'accepted') : 'not_found';
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

    const finalStatus = verificationStatus({
      smallRequested,
      toteRequested,
      smallAccepted,
      toteAccepted,
      smallStatus,
      toteStatus,
    });
    const credit = bagReturnCredit(smallAccepted, toteAccepted);
    const historyKey = creditHistoryKey(bagReturn.id);
    let creditAlreadyPresent = false;

    if (credit > 0) {
      const creditAccounts = await base44.asServiceRole.entities.NuViraCredit.filter(
        { customer_email: bagReturn.customer_email },
        '-created_date',
        5,
      );
      if (creditAccounts.length > 1) {
        return Response.json({ success: false, error_code: 'credit_account_ambiguous' }, { status: 409 });
      }

      const existingAccount = creditAccounts[0] || null;
      const history = Array.isArray(existingAccount?.history) ? existingAccount.history : [];
      creditAlreadyPresent = history.some((entry: any) => normalizeText(entry?.order_id) === historyKey);

      if (!creditAlreadyPresent) {
        const entry = {
          amount: credit,
          type: 'issued',
          description: 'Return + Reward bag credit',
          order_id: historyKey,
          timestamp: new Date().toISOString(),
        };
        if (existingAccount?.id) {
          await base44.asServiceRole.entities.NuViraCredit.update(existingAccount.id, {
            balance: Math.round((Number(existingAccount.balance || 0) + credit) * 100) / 100,
            lifetime_issued: Math.round((Number(existingAccount.lifetime_issued || 0) + credit) * 100) / 100,
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

    const rejectionReason = [smallStatus, toteStatus].includes('not_eligible')
      ? sanitizeText(body.rejection_reason || 'other', 120)
      : '';
    const verifiedAt = new Date().toISOString();
    const updated = await base44.asServiceRole.entities.BagReturn.update(bagReturn.id, {
      small_bag_status: smallRequested > 0 ? smallStatus : 'pending',
      tote_bag_status: toteRequested > 0 ? toteStatus : 'pending',
      small_bags_accepted: smallAccepted,
      tote_bags_accepted: toteAccepted,
      rejection_reason: rejectionReason,
      driver_notes: sanitizeText(body.notes || body.driver_notes, 1000),
      verification_status: finalStatus,
      credit_issued: credit,
      credit_applied: credit > 0,
      verified_by: sanitizeText(user.email, 180),
      verified_at: verifiedAt,
    });

    const result = {
      bag_return_id: updated.id,
      verification_status: finalStatus,
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
  } catch (error) {
    console.error('[verifyAdminBagReturn] Error');
    return Response.json({
      success: false,
      error_code: 'bag_return_verification_failed',
      error: 'Unable to verify this bag return right now.',
    }, { status: 500 });
  }
});

