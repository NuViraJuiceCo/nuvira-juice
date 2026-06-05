import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * NuVira Stabilization Sprint — Order/Subscription Data Flow Diagnostic
 * 
 * Maps all sync paths, identifies duplicates/gaps, and tests idempotency.
 * 
 * Payload: {
 *   mode: 'map' | 'audit_order' | 'audit_subscription' | 'test_idempotency' | 'find_unknown_orders'
 *   order_number?: string        — for audit_order
 *   customer_email?: string      — for audit_subscription
 *   subscription_id?: string     — for audit_subscription
 * }
 * 
 * DATA FLOW MAP (as-built):
 * ─────────────────────────
 * ONE-TIME ORDER:
 *   [Stripe checkout.session.completed]
 *     → stripeWebhook: creates Order (idempotent by stripe_checkout_session_id)
 *     → syncOrderToHub: POST /api/functions/receiveCustomerAppEvent {event: order.created}
 *     → pushOrderToShopify: creates Shopify order
 *     → sendOrderReceivedNotification: email
 *     → sendOrderSms: SMS
 *     → UserPoints: awarded 10 pts/$
 *
 *   [Stripe payment_intent.succeeded] — embedded checkout only
 *     → stripeWebhook: finalizes pre-created Order (idempotent by payment_captured)
 *     → Same downstream chain as above
 *
 * SUBSCRIPTION ORDER:
 *   [Stripe checkout.session.completed, mode=subscription]
 *     → stripeWebhook: creates Subscription (idempotent by stripe_subscription_id)
 *     → syncCustomerToHub: POST /api/functions/receiveCustomerAppEvent {event: customer.subscription_created}
 *     → UserPoints: awarded 10 pts/$ (idempotent by stripe_subscription_id in description)
 *
 * REFUND:
 *   [Stripe charge.refunded]
 *     → stripeWebhook: updates Order status=refunded
 *     → syncRefundToHub → syncOrderToHub: POST /api/functions/receiveCustomerAppEvent {event: order.refunded}
 *     → UserPoints: restored
 *
 * KNOWN #UNKNOWN ORDER CAUSES:
 *   1. Missing customer_name in payload → Hub creates record with name="#unknown"
 *   2. Missing address fields → Hub cannot map to delivery zone
 *   3. Missing stripe_subscription_id → Hub cannot match to subscription
 *   4. Event field mismatch → Hub receives unrecognized event, quarantines as unknown
 *   5. Old endpoint /functions/ → 403 platform rejection before handler runs
 */

const HUB_ENDPOINT = `${(Deno.env.get('HUB_API_URL') || '').replace(/\/$/, '')}/api/functions/receiveCustomerAppEvent`;
const OLD_HUB_ENDPOINT = `${(Deno.env.get('HUB_API_URL') || '').replace(/\/$/, '')}/functions/receiveCustomerAppEvent`;

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (user.role !== 'admin') {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const { mode = 'map', order_number, customer_email, subscription_id } = body;

    // ── MODE: map ────────────────────────────────────────────────────────────
    if (mode === 'map') {
      const hubUrl = Deno.env.get('HUB_API_URL') || 'NOT_SET';
      const secretSet = !!Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

      return Response.json({
        stabilization_sprint: true,
        hub_config: {
          HUB_API_URL: hubUrl,
          correct_endpoint: HUB_ENDPOINT,
          old_broken_endpoint: OLD_HUB_ENDPOINT,
          auth_secret_set: secretSet,
        },
        sync_paths: {
          one_time_order: {
            trigger: 'checkout.session.completed (mode=payment) OR payment_intent.succeeded (embedded)',
            creates: 'Order entity',
            idempotency_key: 'stripe_checkout_session_id OR stripe_payment_intent_id',
            hub_event: 'order.created',
            hub_function: 'syncOrderToHub',
            endpoint: 'CORRECT → /api/functions/receiveCustomerAppEvent',
            downstream: ['pushOrderToShopify', 'sendOrderReceivedNotification', 'sendOrderSms', 'UserPoints +10/dollar'],
          },
          subscription_order: {
            trigger: 'checkout.session.completed (mode=subscription)',
            creates: 'Subscription entity',
            idempotency_key: 'stripe_subscription_id',
            hub_event: 'customer.subscription_created',
            hub_function: 'syncCustomerToHub',
            endpoint: 'FIXED → /api/functions/receiveCustomerAppEvent',
            downstream: ['UserPoints +10/dollar (idempotent by stripe_subscription_id)'],
          },
          refund: {
            trigger: 'charge.refunded',
            updates: 'Order entity status=refunded',
            hub_event: 'order.refunded',
            hub_function: 'syncRefundToHub → syncOrderToHub',
            endpoint: 'CORRECT → /api/functions/receiveCustomerAppEvent',
            downstream: ['UserPoints restored'],
          },
          subscription_status_update: {
            trigger: 'customer.subscription.updated OR .deleted',
            updates: 'Subscription entity status',
            hub_event: 'none (not yet implemented)',
            note: 'Hub not notified on status changes — gap identified',
          },
        },
        known_unknown_order_causes: [
          'customer_name missing or empty → Hub maps to #unknown',
          'address_line1/city/state/postal_code all empty → Hub cannot resolve delivery zone',
          'stripe_subscription_id not included in subscription event',
          'event field name mismatch (Hub expects specific event string)',
          'Old endpoint /functions/ path → 403 before handler runs (FIXED)',
          'PendingSubscriptionCheckout not found → missing production/delivery dates',
          'CheckoutSession not found → falling back to metadata reconstruction (safe path exists)',
        ],
        order_creation_points: [
          'stripeWebhook: checkout.session.completed (mode=payment)',
          'stripeWebhook: payment_intent.succeeded (embedded)',
          'stripeWebhook: payment_intent.succeeded safety-net (no pre-created order found)',
          'manualSyncSubscription: admin-only, local DB only',
          'repairLiveSubscriptionV2: repair function, idempotent',
          'retryRepairedSubscriptionHubSync: Hub sync only, no local creation',
        ],
        idempotency_guards: {
          order: 'filter({stripe_checkout_session_id}) or filter({stripe_payment_intent_id}) before create',
          subscription: 'existingSubs.some(s => s.stripe_subscription_id === stripeSubscriptionId)',
          loyalty_points: 'check points_history description includes stripe_subscription_id',
          hub_sync: 'OrderSyncLog per order_number; Subscription.hub_sync_status field',
        },
        gaps_identified: [
          'subscription status updates (pause/cancel) not synced to Hub',
          'some Subscription records missing stripe_customer_id field',
          'address fields in Subscription not always populated (relying on delivery_address string only)',
        ],
      });
    }

    // ── MODE: audit_order ────────────────────────────────────────────────────
    if (mode === 'audit_order') {
      if (!order_number) return Response.json({ error: 'order_number required' }, { status: 400 });

      const [orders, syncLogs] = await Promise.all([
        base44.asServiceRole.entities.Order.filter({ order_number }),
        base44.asServiceRole.entities.OrderSyncLog.filter({ order_number }),
      ]);

      const order = orders[0] || null;
      const issues = [];

      if (!order) {
        issues.push('ORDER NOT FOUND in Customer App DB');
      } else {
        if (!order.customer_name || order.customer_name === '#unknown') issues.push('customer_name missing');
        if (!order.address_line1) issues.push('address_line1 missing');
        if (!order.address_city) issues.push('address_city missing');
        if (!order.stripe_checkout_session_id && !order.stripe_payment_intent_id) issues.push('no Stripe payment ID');
        if (!order.payment_captured) issues.push('payment_captured=false');
        if (order.payment_status !== 'paid') issues.push(`payment_status=${order.payment_status}`);
      }

      const latestSync = syncLogs.sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0];

      return Response.json({
        order_number,
        order_found: !!order,
        order_status: order?.status,
        payment_status: order?.payment_status,
        payment_captured: order?.payment_captured,
        customer_name: order?.customer_name,
        address_complete: !!(order?.address_line1 && order?.address_city),
        stripe_session: order?.stripe_checkout_session_id,
        stripe_pi: order?.stripe_payment_intent_id,
        issues,
        sync_log_count: syncLogs.length,
        latest_sync: latestSync ? {
          status: latestSync.status,
          hub_action: latestSync.hub_action,
          hub_order_id: latestSync.hub_order_id,
          triggered_by: latestSync.triggered_by,
          created_date: latestSync.created_date,
          description: latestSync.description?.substring(0, 200),
        } : null,
        ready_for_hub: issues.length === 0,
      });
    }

    // ── MODE: audit_subscription ─────────────────────────────────────────────
    if (mode === 'audit_subscription') {
      if (!customer_email && !subscription_id) {
        return Response.json({ error: 'customer_email or subscription_id required' }, { status: 400 });
      }

      const filter = subscription_id ? { id: subscription_id } : { customer_email };
      const subs = await base44.asServiceRole.entities.Subscription.filter(filter);
      const pointsRecords = customer_email
        ? await base44.asServiceRole.entities.UserPoints.filter({ customer_email })
        : [];

      const results = subs.map(sub => {
        const issues = [];
        if (!sub.stripe_subscription_id) issues.push('missing stripe_subscription_id');
        if (!sub.plan_id) issues.push('missing plan_id');
        if (!sub.started_date) issues.push('missing started_date (production_date)');
        if (!sub.next_delivery_date) issues.push('missing next_delivery_date');
        if (!sub.delivery_address) issues.push('missing delivery_address');

        return {
          subscription_id: sub.id,
          customer_email: sub.customer_email,
          status: sub.status,
          plan_id: sub.plan_id,
          stripe_subscription_id: sub.stripe_subscription_id,
          started_date: sub.started_date,
          next_delivery_date: sub.next_delivery_date,
          hub_sync_status: sub.hub_sync_status,
          hub_synced_at: sub.hub_synced_at,
          hub_sync_error: sub.hub_sync_error,
          issues,
          ready_for_hub: issues.length === 0,
        };
      });

      const loyaltyCheck = pointsRecords[0] ? {
        total_points: pointsRecords[0].total_points,
        lifetime_points: pointsRecords[0].lifetime_points,
        history_count: pointsRecords[0].points_history?.length || 0,
        subscription_entries: pointsRecords[0].points_history?.filter(h => h.description?.includes('subscription')) || [],
      } : null;

      return Response.json({
        customer_email: customer_email || null,
        subscription_id: subscription_id || null,
        subscriptions_found: subs.length,
        subscriptions: results,
        loyalty: loyaltyCheck,
        duplicate_check: subs.length > 1 ? '⚠️ MULTIPLE SUBSCRIPTIONS FOUND' : 'OK',
      });
    }

    // ── MODE: find_unknown_orders ─────────────────────────────────────────────
    if (mode === 'find_unknown_orders') {
      // Find orders with missing critical fields that would cause Hub #unknown
      const recentOrders = await base44.asServiceRole.entities.Order.list('-created_date', 100);

      const unknownRisk = recentOrders.filter(o => {
        const hasMissingName = !o.customer_name || o.customer_name === '#unknown' || o.customer_name === '';
        const hasMissingAddress = !o.address_line1 && !o.delivery_address;
        const isUnpaid = o.payment_status !== 'paid' && o.payment_status !== 'refunded';
        return hasMissingName || hasMissingAddress || isUnpaid;
      }).map(o => ({
        order_number: o.order_number,
        customer_email: o.customer_email,
        customer_name: o.customer_name || '⚠️ MISSING',
        address_line1: o.address_line1 || '⚠️ MISSING',
        payment_status: o.payment_status,
        payment_captured: o.payment_captured,
        status: o.status,
        issues: [
          ...(!o.customer_name ? ['no customer_name'] : []),
          ...(!o.address_line1 && !o.delivery_address ? ['no address'] : []),
          ...(o.payment_status !== 'paid' && o.payment_status !== 'refunded' ? [`payment_status=${o.payment_status}`] : []),
        ],
      }));

      return Response.json({
        mode: 'find_unknown_orders',
        total_checked: recentOrders.length,
        at_risk_count: unknownRisk.length,
        at_risk_orders: unknownRisk,
        recommendation: unknownRisk.length > 0
          ? 'Run audit_order for each at-risk order to check Hub sync status'
          : 'All recent orders have required fields',
      });
    }

    // ── MODE: test_idempotency ────────────────────────────────────────────────
    if (mode === 'test_idempotency') {
      if (!order_number && !subscription_id) {
        return Response.json({ error: 'order_number or subscription_id required' }, { status: 400 });
      }

      // Check for duplicates
      if (order_number) {
        const orders = await base44.asServiceRole.entities.Order.filter({ order_number });
        const syncLogs = await base44.asServiceRole.entities.OrderSyncLog.filter({ order_number });
        return Response.json({
          mode: 'test_idempotency',
          order_number,
          order_copies: orders.length,
          idempotency_status: orders.length === 1 ? '✅ PASS — exactly 1 order record' : `⚠️ FAIL — ${orders.length} order records found`,
          sync_log_count: syncLogs.length,
          sync_statuses: syncLogs.map(l => ({ status: l.status, hub_action: l.hub_action, triggered_by: l.triggered_by, date: l.created_date })),
        });
      }

      if (subscription_id) {
        const subs = await base44.asServiceRole.entities.Subscription.filter({ id: subscription_id });
        const sub = subs[0];
        if (!sub) return Response.json({ error: 'Subscription not found' }, { status: 404 });
        const allSubsForEmail = await base44.asServiceRole.entities.Subscription.filter({ customer_email: sub.customer_email });
        const dupesByStripeId = allSubsForEmail.filter(s => s.stripe_subscription_id === sub.stripe_subscription_id);
        return Response.json({
          mode: 'test_idempotency',
          subscription_id,
          stripe_subscription_id: sub.stripe_subscription_id,
          subscription_copies_for_stripe_id: dupesByStripeId.length,
          idempotency_status: dupesByStripeId.length === 1 ? '✅ PASS — exactly 1 subscription for this Stripe ID' : `⚠️ FAIL — ${dupesByStripeId.length} subscriptions for same Stripe ID`,
          hub_sync_status: sub.hub_sync_status,
        });
      }
    }

    return Response.json({ error: `Unknown mode: ${mode}. Use: map | audit_order | audit_subscription | find_unknown_orders | test_idempotency` }, { status: 400 });

  } catch (error) {
    console.error('[StabilizationDiagnostic] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
