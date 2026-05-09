import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_ENDPOINT = `${(Deno.env.get('HUB_API_URL') || '').replace(/\/$/, '')}/functions/receiveCustomerAppEvent`;
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

/**
 * Automated retry: finds all orders whose most recent OrderSyncLog is status=error
 * and retries syncOrderToHub for each one.
 * 
 * Runs on a schedule (every 10 min). Safe to run multiple times — idempotent.
 * Deduplicates by stripe_checkout_session_id / order_number.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const startTime = new Date().toISOString();
  console.log(`[RetryHubSyncs] Starting retry sweep at ${startTime}`);

  // Find all retry-eligible sync logs: error, skipped, or false-success (success with no hub_order_id)
  const errorLogs = await base44.asServiceRole.entities.OrderSyncLog.filter(
    { status: 'error' },
    '-created_date',
    50
  );
  const skippedLogs = await base44.asServiceRole.entities.OrderSyncLog.filter(
    { status: 'skipped' },
    '-created_date',
    50
  );
  // Also catch old "success" logs that were logged without a real hub_order_id (pre-fix false successes)
  const unconfirmedSuccessLogs = await base44.asServiceRole.entities.OrderSyncLog.filter(
    { status: 'success' },
    '-created_date',
    100
  );
  const falseSuccessLogs = unconfirmedSuccessLogs.filter(l => !l.hub_order_id && !l.matched_hub_order_id);
  const allLogs = [...errorLogs, ...skippedLogs, ...falseSuccessLogs];

  // Deduplicate by order_number — only retry the most recent error per order
  const seen = new Set();
  const toRetry = [];
  for (const log of allLogs) {
    if (!log.order_number || seen.has(log.order_number)) continue;
    // Skip if there's already a success log for this order (check below)
    seen.add(log.order_number);
    toRetry.push(log.order_number);
  }

  // Filter out orders that are truly resolved — success requires a real hub_order_id
  const successLogs = await base44.asServiceRole.entities.OrderSyncLog.filter(
    { status: 'success' },
    '-created_date',
    200
  );
  // Only treat success as terminal if Hub confirmed with a real hub_order_id or matched_hub_order_id
  const succeededOrders = new Set(
    successLogs.filter(l => l.hub_order_id || l.matched_hub_order_id).map(l => l.order_number)
  );

  const recoveryLogs = await base44.asServiceRole.entities.OrderSyncLog.filter(
    { status: 'recovery' },
    '-created_date',
    200
  );
  const recoveredOrders = new Set(recoveryLogs.map(l => l.order_number));

  const dedupedLogs = await base44.asServiceRole.entities.OrderSyncLog.filter(
    { status: 'deduped' },
    '-created_date',
    200
  );
  const dedupedOrders = new Set(dedupedLogs.map(l => l.order_number));

  // Skip retry only if truly resolved (confirmed hub_order_id, recovery, or dedupe match)
  const pendingRetry = toRetry.filter(on => !succeededOrders.has(on) && !recoveredOrders.has(on) && !dedupedOrders.has(on));

  console.log(`[RetryHubSyncs] ${toRetry.length} error logs found, ${pendingRetry.length} need retry`);

  if (pendingRetry.length === 0) {
    return Response.json({ success: true, retried: 0, message: 'No failed syncs to retry' });
  }

  const results = [];

  for (const orderNumber of pendingRetry) {
    try {
      // ── Subscription retry path ──────────────────────────────────────────
      // Error logs for subscription Hub failures use order_number = "SUB-{stripeSubscriptionId}"
      if (orderNumber.startsWith('SUB-')) {
        const stripeSubId = orderNumber.replace('SUB-', '');
        const subs = await base44.asServiceRole.entities.Subscription.filter({ stripe_subscription_id: stripeSubId });
        if (!subs.length) {
          console.warn(`[RetryHubSyncs] Subscription ${stripeSubId} not found in CA, skipping`);
          results.push({ order_number: orderNumber, result: 'not_found' });
          continue;
        }
        const sub = subs[0];
        try {
          await base44.asServiceRole.functions.invoke('syncSubscriptionWithFulfillments', {
            subscription_id: sub.id,
            customer_email: sub.customer_email,
          });
          console.log(`[RetryHubSyncs] ✅ Subscription Hub sync retried successfully for ${stripeSubId}`);
          await base44.asServiceRole.entities.OrderSyncLog.create({
            order_number: orderNumber,
            status: 'success',
            hub_action: 'subscription_synced',
            description: `Subscription Hub sync succeeded on retry. sub_id=${sub.id}, stripe_sub=${stripeSubId}`,
            started_at: startTime,
            completed_at: new Date().toISOString(),
            triggered_by: 'recovery_function',
          });
          results.push({ order_number: orderNumber, result: 'success' });
        } catch (subSyncErr) {
          console.error(`[RetryHubSyncs] ❌ Subscription retry failed for ${stripeSubId}: ${subSyncErr.message}`);
          results.push({ order_number: orderNumber, result: 'failed', message: subSyncErr.message });
        }
        continue;
      }

      // ── One-time order retry path ────────────────────────────────────────
      const orders = await base44.asServiceRole.entities.Order.filter({ order_number: orderNumber });
      if (!orders.length) {
        console.warn(`[RetryHubSyncs] Order ${orderNumber} not found in CA, skipping`);
        results.push({ order_number: orderNumber, result: 'not_found' });
        continue;
      }

      const order = orders[0];

      // Build full payload (mirrors syncOrderToHub logic)
      const payment_status = order.payment_captured === true ? 'paid' : (order.payment_status || 'pending');

      const payload = {
        event: 'order.created',
        source: 'customer_app',
        order: {
          id: order.id,
          order_number: order.order_number,
          customer_email: order.customer_email,
          customer_name: order.customer_name || '',
          customer_phone: order.contact_phone || '',
          address_line1: order.address_line1 || '',
          address_line2: order.address_line2 || '',
          address_city: order.address_city || '',
          address_state: order.address_state || '',
          address_postal_code: order.address_postal_code || '',
          address_country: order.address_country || 'US',
          delivery_address: order.delivery_address || '',
          line_items: (order.items || []).map(i => ({
            title: i.title,
            quantity: i.quantity,
            price: i.price,
            product_id: i.product_id,
            image_url: i.image_url || null,
          })),
          items: order.items,
          subtotal: order.subtotal,
          delivery_fee: order.delivery_fee,
          total_price: order.total,
          total: order.total,
          fulfillment_method: order.fulfillment_type || 'delivery',
          fulfillment_type: order.fulfillment_type,
          requested_delivery_date: order.estimated_delivery_date || null,
          estimated_delivery_date: order.estimated_delivery_date,
          assigned_delivery_date: order.assigned_delivery_date || order.estimated_delivery_date || null,
          delivery_window_label: order.delivery_window_label || '5 PM – 8 PM',
          delivery_window_start: order.assigned_delivery_window_start || '17:00',
          delivery_window_end: order.assigned_delivery_window_end || '20:00',
          status: order.status,
          payment_status,
          is_preorder: order.is_preorder || false,
          customer_notes: order.notes || '',
          stripe_checkout_session_id: order.stripe_checkout_session_id || null,
          stripe_payment_intent_id: order.stripe_payment_intent_id || null,
          created_date: order.created_date,
          order_type: 'one_time',
          fulfillment_mode: 'single_delivery',
        },
      };

      const response = await fetch(HUB_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
        },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      let hubResponse = null;
      try { hubResponse = JSON.parse(responseText); } catch { hubResponse = responseText; }

      if (response.ok) {
        // Apply same response contract as syncOrderToHub — only log success if Hub confirms action
        const hubAction = typeof hubResponse === 'object' ? (hubResponse?.action || hubResponse?.status || null) : null;
        const hubOrderId = typeof hubResponse === 'object' ? (hubResponse?.hub_order_id || hubResponse?.order_id || null) : null;
        const matchedHubOrderId = typeof hubResponse === 'object' ? (hubResponse?.matched_hub_order_id || null) : null;

        let logStatus;
        let logLabel;

        if (hubAction === 'created' || hubAction === 'updated') {
          logStatus = 'success';
          logLabel = `✅ Hub ${hubAction}. hub_order_id=${hubOrderId}`;
        } else if (hubAction === 'dedupe_exact_match') {
          logStatus = 'deduped';
          logLabel = `🔁 Hub dedupe_exact_match. matched_hub_order_id=${matchedHubOrderId}`;
        } else if (hubAction === 'queued_for_review') {
          logStatus = 'queued_for_review';
          logLabel = `⏳ Hub queued_for_review.`;
        } else if (hubAction === 'rejected') {
          logStatus = 'rejected';
          logLabel = `🚫 Hub rejected.`;
        } else {
          // Generic acknowledged/no action — still unconfirmed, keep retry eligible
          logStatus = 'skipped';
          logLabel = `⚠️ Hub returned 200 with no confirmed action (hub_action="${hubAction}"). Retry eligible. Response: ${JSON.stringify(hubResponse).substring(0, 200)}`;
        }

        console.log(`[RetryHubSyncs] ${logLabel} for ${orderNumber}`);
        await base44.asServiceRole.entities.OrderSyncLog.create({
          order_number: orderNumber,
          status: logStatus,
          hub_action: hubAction || 'unknown',
          hub_order_id: hubOrderId || undefined,
          matched_hub_order_id: matchedHubOrderId || undefined,
          description: logLabel.substring(0, 1000),
          started_at: startTime,
          completed_at: new Date().toISOString(),
          triggered_by: 'recovery_function',
        });
        results.push({ order_number: orderNumber, result: logStatus });
      } else {
        console.error(`[RetryHubSyncs] ❌ ${orderNumber} retry failed: ${response.status}`);
        results.push({ order_number: orderNumber, result: 'failed', status: response.status, details: responseText.substring(0, 200) });
      }
    } catch (err) {
      console.error(`[RetryHubSyncs] Error retrying ${orderNumber}: ${err.message}`);
      results.push({ order_number: orderNumber, result: 'error', message: err.message });
    }
  }

  const succeeded = results.filter(r => r.result === 'success').length;
  const failed = results.filter(r => r.result !== 'success' && r.result !== 'not_found').length;

  console.log(`[RetryHubSyncs] Done. Succeeded: ${succeeded}, Failed: ${failed}`);
  return Response.json({ success: true, retried: pendingRetry.length, succeeded, failed, results });
});