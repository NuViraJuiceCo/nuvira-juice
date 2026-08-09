import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const MAX_RETRY_ATTEMPTS_PER_ORDER = 3;
const TERMINAL_SKIPPED_ACTIONS = new Set([
  'order_not_retryable',
  'sentinel_not_retryable',
  'subscription_not_active',
  'subscription_quarantined',
  'manual_review_required',
]);

async function invokeInternalFunction(base44, functionName, payload, secret) {
  const usesAdminGateway = functionName === 'syncSubscriptionWithFulfillments';
  const targetFunction = usesAdminGateway ? 'getAdminOperationsDashboardSummary' : functionName;
  const requestPayload = usesAdminGateway
    ? { gateway_action: functionName, payload }
    : payload;
  const response = await base44.asServiceRole.functions.fetch(`/${targetFunction}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-secret': secret || '',
    },
    body: JSON.stringify(requestPayload),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || data?.error_code || `${functionName}_http_${response.status}`);
  return { data };
}

function isRetryAttemptLog(log) {
  if (!log?.order_number) return false;
  if (log.status === 'error') return true;
  return log.status === 'skipped' && !TERMINAL_SKIPPED_ACTIONS.has(log.hub_action);
}

async function writeRetryFailureLog(base44, { orderNumber, startTime, description }) {
  try {
    await base44.asServiceRole.entities.OrderSyncLog.create({
      order_number: orderNumber,
      status: 'error',
      hub_action: 'retry_failed',
      description: description.substring(0, 1000),
      started_at: startTime,
      completed_at: new Date().toISOString(),
      triggered_by: 'recovery_function',
    });
  } catch (logErr) {
    console.error(`[RetryHubSyncs] Failed to write retry failure log for ${orderNumber}: ${logErr.message}`);
  }
}

/**
 * Automated retry: finds all orders whose most recent OrderSyncLog is status=error
 * and retries syncOrderToHub for each one.
 * 
 * Runs on a schedule (every 10 min). Safe to run multiple times — idempotent.
 * Deduplicates by stripe_checkout_session_id / order_number.
 */
Deno.serve(async (req) => {
  if (Deno.env.get('ENABLE_LEGACY_HUB_ORDER_BRIDGE') !== 'true') {
    return Response.json({
      success: true,
      skipped: true,
      retired: true,
      retried: 0,
      reason: 'legacy_hub_order_bridge_retired',
      source: 'customer_app_native_authoritative',
      hub_operational_dependency: false,
      external_calls_performed: false,
    });
  }

  if (Deno.env.get('ENABLE_FAILED_HUB_SYNC_RETRY') !== 'true') {
    return Response.json({
      success: true,
      skipped: true,
      retried: 0,
      gate: 'ENABLE_FAILED_HUB_SYNC_RETRY',
      reason: 'failed_hub_sync_retry_disabled',
      message: 'Failed Hub sync retry sweep is disabled by the current integration safety gate.',
    });
  }

  const base44 = createClientFromRequest(req);

  const startTime = new Date().toISOString();
  console.log(`[RetryHubSyncs] Starting retry sweep at ${startTime}`);

  // Find all retry-eligible sync logs: only 'error' status
  // IMPORTANT: do NOT include 'skipped' — skipped includes terminal do_not_sync/resolved logs
  // IMPORTANT: do NOT include false-success without hub_order_id — subscription syncs legitimately
  //            return success without a hub_order_id (they use hub_action='subscription_synced')
  // ── EARLY EXIT: skip all 4 collection reads if no error logs exist ──────
  const errorLogs = await base44.asServiceRole.entities.OrderSyncLog.filter(
    { status: 'error' },
    '-created_date',
    50
  );
  if (errorLogs.length === 0) {
    console.log('[RetryHubSyncs] No error logs — nothing to retry. Exiting early.');
    return Response.json({ success: true, retried: 0, message: 'No failed syncs to retry' });
  }
  const allLogs = [...errorLogs];

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

  const skippedLogs = await base44.asServiceRole.entities.OrderSyncLog.filter(
    { status: 'skipped' },
    '-created_date',
    300
  );
  const terminalSkippedOrders = new Set(
    skippedLogs
      .filter(l => TERMINAL_SKIPPED_ACTIONS.has(l.hub_action))
      .map(l => l.order_number)
  );

  const retryAttemptCounts = new Map();
  for (const log of [...errorLogs, ...skippedLogs]) {
    if (!isRetryAttemptLog(log)) continue;
    retryAttemptCounts.set(log.order_number, (retryAttemptCounts.get(log.order_number) || 0) + 1);
  }

  // Skip retry only if truly resolved (confirmed hub_order_id, recovery, or dedupe match)
  const pendingRetry = toRetry.filter(on =>
    !succeededOrders.has(on) &&
    !recoveredOrders.has(on) &&
    !dedupedOrders.has(on) &&
    !terminalSkippedOrders.has(on)
  );

  console.log(`[RetryHubSyncs] ${toRetry.length} error logs found, ${pendingRetry.length} need retry`);

  if (pendingRetry.length === 0) {
    return Response.json({ success: true, retried: 0, message: 'No failed syncs to retry' });
  }

  const results = [];

  for (const orderNumber of pendingRetry) {
    try {
      const retryAttemptCount = retryAttemptCounts.get(orderNumber) || 0;
      if (retryAttemptCount >= MAX_RETRY_ATTEMPTS_PER_ORDER) {
        console.warn(`[RetryHubSyncs] ${orderNumber} reached retry cap (${retryAttemptCount}/${MAX_RETRY_ATTEMPTS_PER_ORDER}) — writing manual review terminal log`);
        await base44.asServiceRole.entities.OrderSyncLog.create({
          order_number: orderNumber,
          status: 'skipped',
          hub_action: 'manual_review_required',
          description: `Order ${orderNumber} reached Hub retry cap (${retryAttemptCount}/${MAX_RETRY_ATTEMPTS_PER_ORDER}). Automatic retry stopped; manual review required before any further recovery attempt.`,
          started_at: startTime,
          completed_at: new Date().toISOString(),
          triggered_by: 'recovery_function',
        });
        results.push({ order_number: orderNumber, result: 'skipped', reason: 'manual_review_required', retry_attempts: retryAttemptCount });
        continue;
      }

      // ── Subscription retry path ──────────────────────────────────────────
      // Error logs for subscription Hub failures use order_number = "SUB-{stripeSubscriptionId}"
      // Special sentinel logs (e.g. SUB_DATE_MISSING, SUB_FAILED) are not retryable
      if (orderNumber.startsWith('SUB-') || orderNumber === 'SUB_DATE_MISSING' || orderNumber === 'SUB_FAILED') {
        // Sentinel non-retryable logs — write terminal skipped log and move on
        if (!orderNumber.startsWith('SUB-sub_')) {
          console.log(`[RetryHubSyncs] Sentinel log ${orderNumber} — writing terminal skipped log`);
          await base44.asServiceRole.entities.OrderSyncLog.create({
            order_number: orderNumber,
            status: 'skipped',
            hub_action: 'sentinel_not_retryable',
            description: `Sentinel error log ${orderNumber} is not retryable (no real subscription record). Permanently resolved.`,
            started_at: startTime,
            completed_at: new Date().toISOString(),
            triggered_by: 'recovery_function',
          });
          results.push({ order_number: orderNumber, result: 'skipped', reason: 'sentinel_not_retryable' });
          continue;
        }

        const stripeSubId = orderNumber.replace('SUB-', '');
        const subs = await base44.asServiceRole.entities.Subscription.filter({ stripe_subscription_id: stripeSubId });

        if (!subs.length) {
          // No CA subscription record — cannot retry, write terminal skipped log
          console.warn(`[RetryHubSyncs] No CA Subscription found for ${stripeSubId} — writing terminal skipped log`);
          await base44.asServiceRole.entities.OrderSyncLog.create({
            order_number: orderNumber,
            status: 'skipped',
            hub_action: 'no_ca_record',
            description: `No CA Subscription record found for stripe_sub=${stripeSubId}. Cannot retry. Manual review required.`,
            started_at: startTime,
            completed_at: new Date().toISOString(),
            triggered_by: 'recovery_function',
          });
          results.push({ order_number: orderNumber, result: 'skipped', reason: 'no_ca_record' });
          continue;
        }

        // Use the most recent active subscription record for this stripe_subscription_id
        const activeSub = subs.find(s => s.status === 'active') || subs[0];

        // ── STATUS-AWARE DECISION ────────────────────────────────────────────
        // Only retry customer.subscription_created if sub is active.
        // Cancelled/refunded subscriptions must NOT be re-pushed as active to Hub.
        if (activeSub.status === 'cancelled') {
          console.log(`[RetryHubSyncs] Subscription ${stripeSubId} is cancelled — writing terminal resolved log, skipping Hub sync`);
          await base44.asServiceRole.entities.OrderSyncLog.create({
            order_number: orderNumber,
            status: 'skipped',
            hub_action: 'subscription_not_active',
            description: `Subscription ${stripeSubId} (CA id=${activeSub.id}) is cancelled/refunded. Not retrying as subscription_created. Permanently resolved.`,
            started_at: startTime,
            completed_at: new Date().toISOString(),
            triggered_by: 'recovery_function',
          });
          results.push({ order_number: orderNumber, result: 'skipped', reason: 'subscription_not_active', sub_status: activeSub.status });
          continue;
        }

        if (activeSub.status !== 'active') {
          console.warn(`[RetryHubSyncs] Subscription ${stripeSubId} has unexpected status "${activeSub.status}" — skipping`);
          await base44.asServiceRole.entities.OrderSyncLog.create({
            order_number: orderNumber,
            status: 'skipped',
            hub_action: 'subscription_not_active',
            description: `Subscription ${stripeSubId} status="${activeSub.status}" — not retrying. Manual review if needed.`,
            started_at: startTime,
            completed_at: new Date().toISOString(),
            triggered_by: 'recovery_function',
          });
          results.push({ order_number: orderNumber, result: 'skipped', reason: `status_${activeSub.status}` });
          continue;
        }

        // Active subscription — call syncSubscriptionWithFulfillments with internal secret
        // SECURITY: pass x-internal-secret so the function can verify this is a trusted internal call.
        // This prevents the null-user bypass vulnerability where unauthenticated public requests
        // could appear as service-role calls.
        console.log(`[RetryHubSyncs] Active subscription ${stripeSubId} (${activeSub.customer_email}) — retrying Hub sync`);
        try {
          const syncResult = await invokeInternalFunction(base44, 'syncSubscriptionWithFulfillments', {
            subscription_id: activeSub.id,
            customer_email: activeSub.customer_email,
          }, Deno.env.get('HUB_SYNC_SECRET') || '');
          const hubResp = syncResult?.data || syncResult;

          // ── 409 SUBSCRIPTION_QUARANTINED — write terminal skipped log, stop retry ──
          if (hubResp?.quarantined === true || hubResp?.error_code === 'SUBSCRIPTION_QUARANTINED') {
            console.warn(`[RetryHubSyncs] Hub quarantined sub ${stripeSubId} — writing terminal skipped log, will not retry.`);
            await base44.asServiceRole.entities.OrderSyncLog.create({
              order_number: orderNumber,
              status: 'skipped',
              hub_action: 'subscription_quarantined',
              description: `Hub returned 409 SUBSCRIPTION_QUARANTINED for sub ${stripeSubId} (CA id=${activeSub.id}). Subscription is cancelled/refunded on Hub side. Permanently resolved — admin reactivation required to retry.`,
              started_at: startTime,
              completed_at: new Date().toISOString(),
              triggered_by: 'recovery_function',
            });
            results.push({ order_number: orderNumber, result: 'skipped', reason: 'subscription_quarantined_or_refunded' });
            continue;
          }

          const isSuccess = hubResp?.success === true || hubResp?.hub_response?.status === 'success';

          if (isSuccess) {
            console.log(`[RetryHubSyncs] ✅ Subscription Hub sync succeeded for ${stripeSubId}`);
            await base44.asServiceRole.entities.OrderSyncLog.create({
              order_number: orderNumber,
              status: 'success',
              hub_action: 'subscription_synced',
              description: `Subscription Hub sync succeeded on retry. sub_id=${activeSub.id}, stripe_sub=${stripeSubId}, fulfillments=${hubResp?.fulfillments_sent || 4}, email=${activeSub.customer_email}`,
              started_at: startTime,
              completed_at: new Date().toISOString(),
              triggered_by: 'recovery_function',
            });
            results.push({ order_number: orderNumber, result: 'success', sub_id: activeSub.id });
          } else {
            const errDetail = JSON.stringify(hubResp).substring(0, 300);
            console.error(`[RetryHubSyncs] ❌ Subscription sync returned non-success for ${stripeSubId}: ${errDetail}`);
            await writeRetryFailureLog(base44, {
              orderNumber,
              startTime,
              description: `Subscription Hub sync retry returned non-success for ${stripeSubId}. Response: ${errDetail}`,
            });
            results.push({ order_number: orderNumber, result: 'failed', details: errDetail });
          }
        } catch (subSyncErr) {
          console.error(`[RetryHubSyncs] ❌ Subscription retry threw for ${stripeSubId}: ${subSyncErr.message}`);
          await writeRetryFailureLog(base44, {
            orderNumber,
            startTime,
            description: `Subscription Hub sync retry threw for ${stripeSubId}: ${subSyncErr.message}`,
          });
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

      // ── Order status gate ────────────────────────────────────────────────
      // Do NOT retry unpaid, abandoned, cancelled, or do_not_recover orders.
      // Hub correctly rejects these — retrying endlessly wastes cycles and clutters logs.
      const isUnpaid = !order.payment_captured && order.payment_status !== 'paid' && order.financial_status !== 'paid';
      const isCancelled = order.status === 'cancelled' || order.status === 'refunded';
      const isDoNotRecover = order.do_not_recover === true;
      const isTestOrder = order.is_test_order === true;

      if (isDoNotRecover || isCancelled || isUnpaid || isTestOrder) {
        const reason = isDoNotRecover ? 'do_not_recover' : isCancelled ? `status_${order.status}` : isTestOrder ? 'test_order' : 'unpaid';
        console.log(`[RetryHubSyncs] Order ${orderNumber} is not retryable (${reason}) — writing terminal skipped log`);
        await base44.asServiceRole.entities.OrderSyncLog.create({
          order_number: orderNumber,
          status: 'skipped',
          hub_action: 'order_not_retryable',
          description: `Order ${orderNumber} permanently excluded from Hub retry. Reason: ${reason}. payment_status=${order.payment_status}, payment_captured=${order.payment_captured}, status=${order.status}, do_not_recover=${order.do_not_recover}.`,
          started_at: startTime,
          completed_at: new Date().toISOString(),
          triggered_by: 'recovery_function',
        });
        results.push({ order_number: orderNumber, result: 'skipped', reason });
        continue;
      }

      console.log(`[RetryHubSyncs] Delegating one-time order ${orderNumber} retry to syncOrderToHub`);
      const syncResult = await base44.asServiceRole.functions.invoke('syncOrderToHub', {
        order_id: order.id,
        triggered_by: 'retry_failed_hub_syncs',
      });
      const delegateResponse = syncResult?.data || syncResult;
      const delegateLogStatus = delegateResponse?.log_status || null;
      const delegateSucceeded =
        delegateResponse?.success === true ||
        delegateLogStatus === 'success' ||
        delegateLogStatus === 'deduped';

      if (delegateSucceeded) {
        const resultStatus = delegateLogStatus || (delegateResponse?.skipped ? 'skipped' : 'success');
        console.log(`[RetryHubSyncs] syncOrderToHub delegate completed for ${orderNumber}: ${resultStatus}`);
        results.push({
          order_number: orderNumber,
          result: resultStatus,
          delegated: true,
          hub_action: delegateResponse?.hub_action || null,
          reason: delegateResponse?.reason || null,
        });
      } else {
        const detail = JSON.stringify(delegateResponse || {}).substring(0, 500);
        console.error(`[RetryHubSyncs] ❌ syncOrderToHub delegate did not confirm success/dedupe for ${orderNumber}: ${detail}`);
        await writeRetryFailureLog(base44, {
          orderNumber,
          startTime,
          description: `syncOrderToHub delegate did not confirm success/dedupe for ${orderNumber}. Response: ${detail || 'malformed delegate response'}`,
        });
        results.push({ order_number: orderNumber, result: 'failed', delegated: true, details: detail });
      }
    } catch (err) {
      console.error(`[RetryHubSyncs] Error retrying ${orderNumber}: ${err.message}`);
      await writeRetryFailureLog(base44, {
        orderNumber,
        startTime,
        description: `Order Hub sync retry threw: ${err.message}`,
      });
      results.push({ order_number: orderNumber, result: 'error', message: err.message });
    }
  }

  const succeeded = results.filter(r => r.result === 'success').length;
  const failed = results.filter(r => r.result !== 'success' && r.result !== 'not_found').length;

  console.log(`[RetryHubSyncs] Done. Succeeded: ${succeeded}, Failed: ${failed}`);
  return Response.json({ success: true, retried: pendingRetry.length, succeeded, failed, results });
});
