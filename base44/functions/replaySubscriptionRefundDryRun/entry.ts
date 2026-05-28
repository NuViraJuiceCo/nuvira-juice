import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

async function requireAdmin(base44) {
  const user = await base44.auth.me().catch(() => null);
  if (!user?.email) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403 });
  return null;
}

/**
 * Replay-safe dry-run: simulates the charge.refunded subscription path
 * against Amar Kahlon's already-settled refund WITHOUT writing anything.
 * 
 * Confirms:
 * - Subscription already cancelled (no update needed)
 * - Loyalty already reversed (no update needed)
 * - UserPoints remains 250
 * - No new Subscription or duplicate data
 */

Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_LEGACY_PAYMENT_SUBSCRIPTION_TOOLS') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'legacy_payment_subscription_tools_disabled',
        message: 'Legacy payment/subscription tools are disabled for May 30 launch freeze.',
      }, { status: 409 });
    }

    const base44 = createClientFromRequest(req);
    const unauthorized = await requireAdmin(base44);
    if (unauthorized) return unauthorized;

    const STRIPE_SUBSCRIPTION_ID = 'sub_1TUah0IrzYHaHkt24AVgUtNY';
    const CUSTOMER_EMAIL = 'amark@nuvisionarymedia.com';
    const REFUND_AMOUNT = 144.0;
    const POINTS_TO_REVERSE = Math.floor(REFUND_AMOUNT * 10); // 1440

    console.log(`[DryRun] Simulating charge.refunded subscription path for ${STRIPE_SUBSCRIPTION_ID}`);

    // 1. Check Subscription
    const subResults = await base44.asServiceRole.entities.Subscription.filter({ stripe_subscription_id: STRIPE_SUBSCRIPTION_ID });
    const subscription = subResults[0];

    const subCheck = {
      found: !!subscription,
      id: subscription?.id || null,
      status: subscription?.status || null,
      would_cancel: subscription && subscription.status !== 'cancelled',
    };
    console.log(`[DryRun] Subscription: found=${subCheck.found}, status=${subCheck.status}, would_cancel=${subCheck.would_cancel}`);

    // 2. Check UserPoints
    const pointsRecs = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: CUSTOMER_EMAIL });
    const rec = pointsRecs[0];

    const alreadyReversed = rec?.points_history?.some(h =>
      h.description?.includes('subscription refund') && h.description?.includes(STRIPE_SUBSCRIPTION_ID)
    ) || false;

    const pointsCheck = {
      found: !!rec,
      total_points: rec?.total_points ?? null,
      would_reverse: !!rec && !alreadyReversed,
      already_reversed: alreadyReversed,
      points_to_reverse: POINTS_TO_REVERSE,
      final_points_if_reversed: rec ? Math.max(0, (rec.total_points || 0) - POINTS_TO_REVERSE) : null,
    };
    console.log(`[DryRun] Points: total=${pointsCheck.total_points}, already_reversed=${alreadyReversed}, would_reverse=${pointsCheck.would_reverse}`);

    // 3. Check for duplicate Subscriptions
    const allSubs = await base44.asServiceRole.entities.Subscription.filter({ customer_email: CUSTOMER_EMAIL });
    const duplicateCheck = {
      total_subscriptions: allSubs.length,
      active_count: allSubs.filter(s => s.status === 'active').length,
      cancelled_count: allSubs.filter(s => s.status === 'cancelled').length,
    };
    console.log(`[DryRun] Subscriptions: total=${duplicateCheck.total_subscriptions}, active=${duplicateCheck.active_count}, cancelled=${duplicateCheck.cancelled_count}`);

    // 4. Check audit log
    const auditLogs = await base44.asServiceRole.entities.OrderSyncLog.filter({ order_number: `SUB-${STRIPE_SUBSCRIPTION_ID}` });
    const auditCheck = {
      entries: auditLogs.length,
      latest_status: auditLogs[0]?.status || null,
      latest_description: auditLogs[0]?.description?.substring(0, 150) || null,
    };

    // 5. Pass/Fail
    const pass =
      subCheck.found &&
      subCheck.status === 'cancelled' &&
      !subCheck.would_cancel &&
      pointsCheck.total_points === 250 &&
      alreadyReversed &&
      !pointsCheck.would_reverse &&
      duplicateCheck.active_count === 0;

    const result = {
      dry_run: true,
      verdict: pass ? 'PASS ✅' : 'FAIL ❌',
      subscription: subCheck,
      loyalty: pointsCheck,
      duplicates: duplicateCheck,
      audit_log: auditCheck,
      idempotency_safe: !subCheck.would_cancel && !pointsCheck.would_reverse,
      notes: {
        subscription_status: subCheck.status === 'cancelled' ? '✅ Already cancelled — no write needed' : `❌ Would cancel (status=${subCheck.status})`,
        loyalty_status: alreadyReversed ? '✅ Already reversed — no write needed' : `❌ Would reverse ${POINTS_TO_REVERSE} pts`,
        points_total: pointsCheck.total_points === 250 ? '✅ Correct: 250' : `❌ Expected 250, got ${pointsCheck.total_points}`,
        duplicates: duplicateCheck.active_count === 0 ? '✅ No active subscriptions' : `❌ ${duplicateCheck.active_count} active subscription(s) found`,
        hub: 'Hub would receive customer.subscription_cancelled — no-op expected (already cancelled)',
      },
    };

    console.log(`[DryRun] VERDICT: ${result.verdict}`);
    return Response.json(result);

  } catch (err) {
    console.error(`[DryRun] Error: ${err.message}`);
    return Response.json({ error: err.message }, { status: 500 });
  }
});
