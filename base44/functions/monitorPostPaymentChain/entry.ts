import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * monitorPostPaymentChain
 *
 * Admin-only, read-only monitor. Checks the health of the post-payment automation chain
 * for recent orders and subscriptions (created in the last N minutes).
 * Does NOT modify any data. Safe to run on a schedule or manually.
 *
 * Reports per entity:
 *   - Orders: payment_captured, status, hub sync log, shopify push
 *   - Subscriptions: status, hub_sync_status, loyalty points awarded
 *   - PendingSubscriptionCheckouts: status (pending → completed)
 *
 * Payload: { minutes_ago: number (default 15), verbose: boolean (default false) }
 */

async function readJsonBody(req) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return { ok: true, body: {} };
  }

  const raw = await req.text();
  if (!raw.trim()) {
    return { ok: true, body: {} };
  }

  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, body: null };
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'admin' && user.role !== 'owner') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const parsedBody = await readJsonBody(req);
    if (!parsedBody.ok) {
      return Response.json({ success: false, error: 'malformed_json', error_code: 'malformed_json' }, { status: 400 });
    }
    const body = parsedBody.body && typeof parsedBody.body === 'object' && !Array.isArray(parsedBody.body) ? parsedBody.body : {};
    const minutesAgo = body.minutes_ago ?? 15;
    const verbose = body.verbose ?? false;

    const cutoff = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
    console.log(`[PostPaymentMonitor] Checking chain for items created after ${cutoff} (${minutesAgo}min window)`);

    // ── 1. Recent Orders ─────────────────────────────────────────────────────
    const recentOrders = await base44.asServiceRole.entities.Order.list('-created_date', 20);
    const newOrders = recentOrders.filter(o => o.created_date >= cutoff && !o.is_test_order);

    const orderResults = await Promise.all(newOrders.map(async (order) => {
      // Check hub sync log
      const syncLogs = await base44.asServiceRole.entities.OrderSyncLog.filter({ order_number: order.order_number });
      const latestLog = syncLogs.sort((a, b) => b.created_date > a.created_date ? 1 : -1)[0];

      const result = {
        order_number: order.order_number,
        customer_email: order.customer_email,
        created_at: order.created_date,
        status: order.status,
        payment_captured: order.payment_captured,
        payment_status: order.payment_status,
        hub_sync: latestLog ? `${latestLog.status} (${latestLog.hub_action || 'n/a'})` : 'NO_LOG',
        hub_order_id: latestLog?.hub_order_id || latestLog?.matched_hub_order_id || null,
        chain_ok: (
          order.payment_captured === true &&
          order.payment_status === 'paid' &&
          ['scheduled_for_juicing', 'in_production', 'bottled_packed', 'out_for_delivery', 'delivered'].includes(order.status) &&
          latestLog && ['success', 'deduped'].includes(latestLog.status)
        ),
        issues: [],
      };

      if (!order.payment_captured) result.issues.push('payment_not_captured');
      if (order.payment_status !== 'paid') result.issues.push(`payment_status=${order.payment_status}`);
      if (!latestLog) result.issues.push('no_hub_sync_log');
      else if (!['success', 'deduped'].includes(latestLog.status)) result.issues.push(`hub_sync_${latestLog.status}`);
      if (!order.assigned_delivery_date) result.issues.push('missing_delivery_date');

      return result;
    }));

    // ── 2. Recent Subscriptions ──────────────────────────────────────────────
    const recentSubs = await base44.asServiceRole.entities.Subscription.list('-created_date', 20);
    const newSubs = recentSubs.filter(s => s.created_date >= cutoff);

    const subResults = await Promise.all(newSubs.map(async (sub) => {
      // Check loyalty
      const pointsRecs = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: sub.customer_email });
      const hasLoyalty = pointsRecs[0]?.points_history?.some(h =>
        h.description?.includes(`subscription ${sub.stripe_subscription_id}`)
      ) ?? false;

      // Check PendingSubscriptionCheckout
      const pendingRecs = await base44.asServiceRole.entities.PendingSubscriptionCheckout.filter({
        stripe_subscription_id: sub.stripe_subscription_id,
      });
      const pendingStatus = pendingRecs[0]?.status || 'not_found';

      const result = {
        subscription_id: sub.id,
        customer_email: sub.customer_email,
        created_at: sub.created_date,
        status: sub.status,
        stripe_subscription_id: sub.stripe_subscription_id,
        hub_sync_status: sub.hub_sync_status || 'not_set',
        loyalty_awarded: hasLoyalty,
        pending_checkout_status: pendingStatus,
        chain_ok: (
          sub.status === 'active' &&
          ['synced', 'skipped'].includes(sub.hub_sync_status) &&
          hasLoyalty &&
          pendingStatus === 'completed'
        ),
        issues: [],
      };

      if (sub.status !== 'active') result.issues.push(`sub_status=${sub.status}`);
      if (!['synced', 'skipped'].includes(sub.hub_sync_status)) result.issues.push(`hub_sync=${sub.hub_sync_status}`);
      if (!hasLoyalty) result.issues.push('loyalty_not_awarded');
      if (pendingStatus !== 'completed') result.issues.push(`pending_checkout=${pendingStatus}`);

      return result;
    }));

    // ── 3. Pending Checkouts stuck in 'pending' ──────────────────────────────
    const recentPending = await base44.asServiceRole.entities.PendingSubscriptionCheckout.list('-created_date', 20);
    const stuckPending = recentPending.filter(p =>
      p.created_date >= cutoff && p.status === 'pending'
    );

    // ── 4. Summary ───────────────────────────────────────────────────────────
    const ordersFailed = orderResults.filter(o => !o.chain_ok);
    const subsFailed = subResults.filter(s => !s.chain_ok);
    const allGreen = ordersFailed.length === 0 && subsFailed.length === 0 && stuckPending.length === 0;

    const summary = {
      window_minutes: minutesAgo,
      checked_at: new Date().toISOString(),
      overall: allGreen ? '✅ ALL CLEAR' : '⚠️ ISSUES DETECTED',
      orders: {
        total: orderResults.length,
        ok: orderResults.filter(o => o.chain_ok).length,
        failed: ordersFailed.length,
        ...(verbose || ordersFailed.length > 0 ? { details: orderResults } : {}),
        failed_items: ordersFailed.map(o => ({ order_number: o.order_number, issues: o.issues })),
      },
      subscriptions: {
        total: subResults.length,
        ok: subResults.filter(s => s.chain_ok).length,
        failed: subsFailed.length,
        ...(verbose || subsFailed.length > 0 ? { details: subResults } : {}),
        failed_items: subsFailed.map(s => ({ subscription_id: s.subscription_id, customer_email: s.customer_email, issues: s.issues })),
      },
      stuck_pending_checkouts: stuckPending.map(p => ({
        id: p.id,
        customer_email: p.customer_email,
        created_at: p.created_date,
        plan_name: p.plan_name,
        stripe_subscription_id: p.stripe_subscription_id || 'none',
      })),
    };

    if (!allGreen) {
      console.warn(`[PostPaymentMonitor] ⚠️ Issues found: ${ordersFailed.length} order(s), ${subsFailed.length} sub(s), ${stuckPending.length} stuck pending checkout(s)`);
      ordersFailed.forEach(o => console.warn(`  Order ${o.order_number}: ${o.issues.join(', ')}`));
      subsFailed.forEach(s => console.warn(`  Sub ${s.subscription_id} (${s.customer_email}): ${s.issues.join(', ')}`));
    } else {
      console.log(`[PostPaymentMonitor] ✅ All clear — ${orderResults.length} order(s), ${subResults.length} sub(s) all look good`);
    }

    return Response.json(summary);

  } catch (error) {
    console.error('[PostPaymentMonitor] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
