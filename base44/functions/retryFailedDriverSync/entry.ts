import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * RETRY FAILED DRIVER ACTION SYNCS
 * 
 * Finds DriverActionLog records with sync_status = failed | pending
 * and re-sends them to Hub via receiveDriverStatusUpdate.
 * 
 * Can be called:
 * - Manually by admin (manual retry)
 * - Via scheduled automation (e.g., every 5 minutes)
 * - On-demand after pushOrderStatusToHub fails
 * 
 * IMPORTANT: Does NOT overwrite local delivered status.
 * Only syncs the DriverActionLog record to Hub.
 */
Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_FAILED_DRIVER_SYNC_RETRY') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        total: 0,
        retried: 0,
        succeeded: 0,
        reason: 'failed_driver_sync_retry_disabled',
        message: 'Failed driver sync retry is disabled for May 30 launch freeze.',
      });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Allow admin or scheduled automation
    if (!user || (user.role !== 'admin' && user.role !== 'driver')) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find failed/pending driver action syncs
    const failedActions = await base44.asServiceRole.entities.DriverActionLog.filter({
      hub_sync_status: { $in: ['failed', 'pending'] },
      action_type: { $in: ['delivered', 'unable_to_deliver', 'out_for_delivery', 'bag_return_verified'] },
    }, '-performed_at', 500);

    console.log(`[retryFailedDriverSync] Found ${failedActions.length} failed/pending syncs to retry`);

    const results = [];

    for (const action of failedActions) {
      try {
        // Fetch the order to get additional context
        const orders = await base44.asServiceRole.entities.Order.filter(
          { id: action.order_id },
          '-created_date',
          1
        );
        const order = orders[0];

        // Re-send to Hub via pushOrderStatusToHub
        const syncRes = await base44.asServiceRole.functions.invoke('pushOrderStatusToHub', {
          order_number: action.order_number,
          customer_email: action.customer_email,
          local_order_id: action.order_id,
          hub_order_id: order?.hub_order_id || null,
          action_type: action.action_type,
          delivery_status: action.new_status === 'delivered' ? 'delivered' : null,
          delivered_at: action.performed_at,
          delivery_drop_location: action.delivery_drop_location,
          delivery_notes: action.driver_notes,
          delivery_photo_url: action.delivery_photo_url,
          performed_by: action.performed_by,
          performed_at: action.performed_at,
          driver_action_log_id: action.id,
        });

        results.push({
          order_number: action.order_number,
          action_type: action.action_type,
          status: syncRes.data?.success ? 'success' : 'failed',
          error: syncRes.data?.hub_error || null,
        });
      } catch (err) {
        console.error(`[retryFailedDriverSync] Error retrying ${action.order_number}:`, err.message);
        results.push({
          order_number: action.order_number,
          action_type: action.action_type,
          status: 'error',
          error: err.message,
        });
      }
    }

    const succeeded = results.filter(r => r.status === 'success').length;
    console.log(`[retryFailedDriverSync] Retry complete: ${succeeded}/${results.length} succeeded`);

    return Response.json({
      total: failedActions.length,
      retried: results.length,
      succeeded,
      results,
    });
  } catch (error) {
    console.error('[retryFailedDriverSync] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
