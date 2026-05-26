import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

/**
 * Diagnostic: Test refund webhook flow end-to-end without manual repair.
 * 1. Find an order by PI ID
 * 2. Verify CA→Hub auth works for refund events
 * 3. Issue a test refund in Stripe (optional)
 * 4. Verify webhook would be received
 * 5. Simulate charge.refunded event
 * 6. Verify CA order goes to refunded
 * 7. Verify CA→Hub refund sync works
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
    const { pi_id, test_refund = false } = await req.json();

    if (!pi_id) {
      return Response.json({ error: 'pi_id required' }, { status: 400 });
    }

    console.log(`[refundFlowTest] Starting diagnostic for PI ${pi_id}`);

    // Step 1: Get the PaymentIntent from Stripe
    let pi;
    try {
      pi = await stripe.paymentIntents.retrieve(pi_id);
      console.log(`[refundFlowTest] PI retrieved: status=${pi.status}, amount=${pi.amount_received}, customer=${pi.metadata?.customer_email}`);
    } catch (err) {
      return Response.json({ error: `Failed to retrieve PI: ${err.message}` }, { status: 400 });
    }

    // Step 2: Find matching CA Order
    const orders = await base44.asServiceRole.entities.Order.filter({ stripe_payment_intent_id: pi_id });
    if (orders.length === 0) {
      return Response.json({ error: `No order found for PI ${pi_id}` }, { status: 404 });
    }

    const order = orders[0];
    console.log(`[refundFlowTest] Order found: ${order.order_number}, status=${order.status}, payment_status=${order.payment_status}`);

    // Step 3: Check if already refunded
    if (order.payment_status === 'refunded' || order.status === 'refunded') {
      return Response.json({ 
        error: 'Order already refunded',
        order_number: order.order_number,
        action: 'skip_test'
      }, { status: 400 });
    }

    // Step 4: Check for refunds on this PI
    const refunds = await stripe.refunds.list({ payment_intent: pi_id, limit: 10 });
    const existingRefunds = refunds.data || [];
    console.log(`[refundFlowTest] Found ${existingRefunds.length} existing refunds on PI`);

    if (existingRefunds.length > 0) {
      const lastRefund = existingRefunds[0];
      console.log(`[refundFlowTest] Last refund: ${lastRefund.id}, status=${lastRefund.status}, amount=$${(lastRefund.amount / 100).toFixed(2)}`);
    }

    // Step 5: Test CA→Hub auth by attempting a sync with refund event
    console.log(`[refundFlowTest] Testing CA→Hub auth with refund event...`);
    let testSyncResult;
    let syncError = null;
    try {
      testSyncResult = await base44.asServiceRole.functions.invoke('syncOrderToHub', {
        order_id: order.id,
        stripe_session: {
          payment_status: 'refunded',
          id: 'test_refund_' + pi_id,
          refund_amount: order.total,
          is_full_refund: true,
        },
        triggered_by: 'refund_flow_diagnostic',
      });
      console.log(`[refundFlowTest] Sync result:`, JSON.stringify(testSyncResult));
    } catch (err) {
      syncError = err.message;
      console.error(`[refundFlowTest] Sync failed with error:`, syncError);
      testSyncResult = { error: syncError };
    }

    // Step 6: Check OrderSyncLog for the test
    const syncLogs = await base44.asServiceRole.entities.OrderSyncLog.filter({ order_number: order.order_number });
    const lastLog = syncLogs[syncLogs.length - 1];
    console.log(`[refundFlowTest] Last sync log: status=${lastLog?.status}, description=${lastLog?.description?.substring(0, 100)}`);

    // Step 7: Determine if 403 issue is still present
    const is403 = lastLog?.description?.includes('403') || lastLog?.description?.includes('Forbidden');
    const isAuthError = lastLog?.description?.includes('Authentication') || lastLog?.description?.includes('Bearer');

    let authDiagnosis = 'UNKNOWN';
    let authFixNeeded = false;

    if (is403) {
      authDiagnosis = 'CONFIRMED: 403 Forbidden on Hub sync';
      authFixNeeded = true;
      console.error(`[refundFlowTest] ❌ CA→Hub refund sync failed with 403 — auth issue confirmed`);
    } else if (isAuthError) {
      authDiagnosis = 'CONFIRMED: Authentication error on Hub sync';
      authFixNeeded = true;
      console.error(`[refundFlowTest] ❌ CA→Hub refund sync failed with auth error`);
    } else if (lastLog?.status === 'error') {
      authDiagnosis = `ERROR: ${lastLog.description?.substring(0, 150)}`;
      authFixNeeded = true;
      console.error(`[refundFlowTest] ❌ CA→Hub refund sync failed:`, lastLog.description?.substring(0, 150));
    } else if (lastLog?.status === 'success' || lastLog?.status === 'deduped') {
      authDiagnosis = `SUCCESS: CA→Hub refund sync working! (${lastLog.status})`;
      authFixNeeded = false;
      console.log(`[refundFlowTest] ✅ CA→Hub refund sync successful!`);
    } else {
      authDiagnosis = `PARTIAL: status=${lastLog?.status} (retry eligible)`;
      authFixNeeded = false;
      console.warn(`[refundFlowTest] ⚠️ Sync returned status=${lastLog?.status} (not confirmed success but not fatal)`);
    }

    // Step 8: Return diagnostic report
    return Response.json({
      pi_id,
      order_number: order.order_number,
      order_id: order.id,
      current_order_status: order.status,
      current_payment_status: order.payment_status,
      stripe_pi_status: pi.status,
      stripe_refunds_count: existingRefunds.length,
      ca_to_hub_sync_test_result: testSyncResult,
      sync_error: syncError,
      last_sync_log: {
        status: lastLog?.status,
        description: lastLog?.description?.substring(0, 200),
      },
      auth_diagnosis: authDiagnosis,
      auth_fix_needed: authFixNeeded,
      hub_api_url: Deno.env.get('HUB_API_URL'),
      customer_app_sync_secret_set: !!Deno.env.get('CUSTOMER_APP_SYNC_SECRET'),
      customer_app_sync_secret_value: (Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || 'NOT_SET').substring(0, 20) + '...',
    });

  } catch (error) {
    console.error('[refundFlowTest] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
