import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * CONTROLLED RETEST MONITOR
 * 
 * Pulls a full timestamped audit trail for a specific order_number.
 * Used during controlled live checkout retests to capture all pass/fail signals.
 * READ-ONLY — no repairs, no deletions, no manual sync triggers.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { order_number } = await req.json();
    if (!order_number) {
      return Response.json({ error: 'order_number required' }, { status: 400 });
    }

    const capturedAt = new Date().toISOString();

    // 1. Customer App order
    const orders = await base44.asServiceRole.entities.Order.filter({ order_number });
    const order = orders[0] || null;

    // 2. CheckoutSession (created before payment, confirms session was stored)
    const checkoutSessions = await base44.asServiceRole.entities.CheckoutSession.filter({ order_number });
    const checkoutSession = checkoutSessions[0] || null;

    // 3. OrderSyncLog (all sync attempts, successes, failures)
    const syncLogs = await base44.asServiceRole.entities.OrderSyncLog.filter({ order_number });
    syncLogs.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));

    // 4. Check for duplicates — same order_number should appear exactly once
    const duplicateCheck = orders.length;

    // 5. Same-email merge check — list all orders for this email
    let emailOrders = [];
    if (order?.customer_email) {
      emailOrders = await base44.asServiceRole.entities.Order.filter({ customer_email: order.customer_email });
    }

    // 6. Fake Stripe ID guard check
    const sessionId = order?.stripe_checkout_session_id || '';
    const intentId = order?.stripe_payment_intent_id || '';
    const fakePatterns = ['UNIQUE_SESSION_ID', 'UNIQUE_INTENT', 'cs_test_fake', 'pi_test_fake'];
    const hasFakeIds = fakePatterns.some(p => sessionId.includes(p) || intentId.includes(p));

    // 7. Address completeness check
    const addressFields = {
      address_line1: order?.address_line1 || '',
      address_city: order?.address_city || '',
      address_state: order?.address_state || '',
      address_postal_code: order?.address_postal_code || '',
    };
    const addressComplete = Object.values(addressFields).every(v => v.trim() !== '');

    // 8. Payment status check
    const paymentCaptured = order?.payment_captured === true;

    // 9. Reconstruct what the Hub payload looked like from the last successful/attempted sync log
    const lastSyncLog = syncLogs.length > 0 ? syncLogs[syncLogs.length - 1] : null;

    // 10. Evaluate pass/fail for each criterion
    const checks = {
      order_exists_in_customer_app: !!order,
      order_created_time: order?.created_date || null,
      checkout_session_stored: !!checkoutSession,
      checkout_session_id: sessionId || null,
      payment_intent_id: intentId || null,
      stripe_session_stored_at: checkoutSession?.created_date || null,

      // Payment
      payment_captured: paymentCaptured,
      payment_status_check: paymentCaptured ? 'PASS — payment_captured=true' : 'FAIL — payment not captured',

      // Address
      address_fields: addressFields,
      address_complete: addressComplete,
      address_check: addressComplete ? 'PASS — all address fields present' : 'FAIL — missing address fields',

      // Stripe ID integrity
      fake_ids_detected: hasFakeIds,
      stripe_id_check: hasFakeIds ? 'FAIL — fake Stripe IDs detected' : 'PASS — real Stripe IDs',

      // Deduplication
      order_count_for_number: duplicateCheck,
      duplicate_check: duplicateCheck === 1 ? 'PASS — exactly 1 order' : duplicateCheck === 0 ? 'FAIL — order missing' : `FAIL — ${duplicateCheck} duplicates found`,

      // Same-email merge
      total_orders_for_email: emailOrders.length,
      email_orders: emailOrders.map(o => ({ order_number: o.order_number, total: o.total, created_date: o.created_date })),
      email_merge_check: 'Manual review — verify each order_number is unique and independent',

      // Sync
      sync_attempts: syncLogs.length,
      sync_logs: syncLogs.map(l => ({
        created_at: l.created_date,
        status: l.status,
        triggered_by: l.triggered_by,
        description: l.description,
      })),
      last_sync_status: lastSyncLog?.status || 'no_sync_attempted',
      last_sync_description: lastSyncLog?.description || null,
      hub_sync_check: lastSyncLog?.status === 'success' ? 'PASS — Hub accepted order' :
                      lastSyncLog?.status === 'error' ? `FAIL — ${lastSyncLog.description}` :
                      'PENDING — no sync log yet',

      // Order fields
      order_number: order?.order_number || null,
      customer_name: order?.customer_name || null,
      customer_email: order?.customer_email || null,
      items: order?.items || [],
      subtotal: order?.subtotal || null,
      delivery_fee: order?.delivery_fee || null,
      total: order?.total || null,
      fulfillment_type: order?.fulfillment_type || null,
      estimated_delivery_date: order?.estimated_delivery_date || null,
      status: order?.status || null,
      is_preorder: order?.is_preorder || false,
    };

    // Overall pass/fail verdict
    const failures = [];
    if (!checks.order_exists_in_customer_app) failures.push('Order not found in Customer App');
    if (!checks.payment_captured) failures.push('Payment not captured');
    if (!checks.address_complete) failures.push('Address fields incomplete');
    if (checks.fake_ids_detected) failures.push('Fake Stripe IDs detected');
    if (duplicateCheck !== 1) failures.push(`Duplicate/missing order: count=${duplicateCheck}`);
    if (lastSyncLog?.status === 'error') failures.push(`Hub sync failed: ${lastSyncLog.description}`);
    if (!lastSyncLog) failures.push('No Hub sync attempt logged yet');

    const verdict = failures.length === 0
      ? { result: 'PASS', message: 'All checks passed — order is clean and Hub sync succeeded' }
      : { result: 'FAIL', message: `${failures.length} check(s) failed`, failures };

    return Response.json({
      captured_at: capturedAt,
      order_number,
      verdict,
      checks,
    });

  } catch (error) {
    console.error('[MonitorLiveCheckoutTest] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});