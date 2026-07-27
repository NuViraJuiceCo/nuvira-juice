import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * DRIVER STATUS SYNC — receiveDriverStatusUpdate
 * 
 * Architecture: Option B - Customer App is recovery source for driver actions
 * 
 * PURPOSE: Push driver delivery actions (delivered, unable_to_deliver, etc.) to Hub.
 * BEHAVIOR: Awaits Hub response, updates DriverActionLog sync status, retries on failure.
 * 
 * PAYLOAD STRUCTURE:
 * - order_number, customer_email (lookup keys)
 * - local_order_id (Customer App Order.id)
 * - hub_order_id (if available from Order.is_hub_order context)
 * - action_type: delivered | unable_to_deliver | out_for_delivery | bag_return_verified
 * - delivery_status, fulfillment_status (operational states)
 * - delivered_at, attempted_delivery_at, performed_at (timestamps)
 * - delivery_drop_location, delivery_notes, delivery_photo_url
 * - performed_by (driver email)
 * - source: customer_app_driver
 * - idempotency_key (for deduplication)
 * 
 * SYNC TRACKING:
 * - Updates DriverActionLog.hub_sync_status = success | failed | pending
 * - Logs sync errors to enable retry
 * - Does NOT overwrite local delivered status during sync
 */
Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_LEGACY_DRIVER_STATUS_HUB_PUSH') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'legacy_driver_status_hub_push_disabled',
        message: 'Legacy driver status Hub push is disabled by the current controlled-delivery gate. Use the controlled Delivery Queue task wrappers.',
      });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const {
      order_number,
      customer_email,
      local_order_id,
      hub_order_id,
      action_type,
      delivery_status,
      delivered_at,
      delivery_drop_location,
      delivery_notes,
      delivery_photo_url,
      performed_by,
      performed_at,
      driver_action_log_id,
    } = await req.json();

    if (!order_number || !action_type) {
      return Response.json({ error: 'order_number and action_type required' }, { status: 400 });
    }

    const hubApiUrl = Deno.env.get('HUB_API_URL');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

    if (!hubApiUrl || !hubSecret) {
      return Response.json({ error: 'Hub not configured' }, { status: 500 });
    }

    const hubBase = hubApiUrl.replace(/\/$/, '').replace(/\/functions\/.*$/, '');
    const idempotencyKey = `${order_number}:${action_type}:${performed_at}`;

    // Build Hub payload matching receiveDriverStatusUpdate contract
    // Hub may expect: action (not action_type), status (not delivery_status)
    const payload = {
      order_number,
      customer_email,
      local_order_id: local_order_id || null,
      hub_order_id: hub_order_id || null,
      action: action_type, // Hub may use 'action' instead of 'action_type'
      action_type, // Include both for compatibility
      status: delivery_status || (action_type === 'delivered' ? 'delivered' : null),
      delivery_status,
      delivered_at: action_type === 'delivered' ? delivered_at : null,
      delivery_drop_location: action_type === 'delivered' ? delivery_drop_location : null,
      delivery_notes: delivery_notes || '',
      delivery_photo_url: delivery_photo_url || null,
      performed_by,
      performed_at,
      source: 'customer_app_driver',
      idempotency_key: idempotencyKey,
    };

    console.log(`[pushOrderStatusToHub] Syncing ${action_type} for ${order_number} to Hub via receiveDriverStatusUpdate`);

    const response = await fetch(`${hubBase}/functions/receiveDriverStatusUpdate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${hubSecret}`,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let hubResult = null;
    try {
      hubResult = JSON.parse(responseText);
    } catch {
      hubResult = { raw: responseText };
    }

    if (!response.ok) {
      console.error(`[pushOrderStatusToHub] ❌ Hub returned ${response.status}: ${responseText}`);
      console.error(`[pushOrderStatusToHub] CRITICAL: ${action_type} sync for ${order_number} failed`);

      // Update DriverActionLog sync status to failed
      if (driver_action_log_id) {
        try {
          await base44.asServiceRole.entities.DriverActionLog.update(driver_action_log_id, {
            hub_synced: false,
            hub_sync_status: 'failed',
            hub_sync_error: `${response.status}: ${responseText}`,
          });
        } catch (logErr) {
          console.warn('[pushOrderStatusToHub] Failed to update DriverActionLog:', logErr.message);
        }
      }

      // Log for recovery
      try {
        await base44.asServiceRole.entities.OrderSyncLog.create({
          order_number,
          status: 'error',
          description: `Driver action ${action_type} failed to sync to Hub: ${response.status} — ${responseText}. Local record persisted. Will retry.`,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          triggered_by: 'admin_push',
        });
      } catch (logErr) {
        console.error('[pushOrderStatusToHub] Failed to create recovery log:', logErr.message);
      }

      return Response.json({
        success: false,
        hub_synced: false,
        hub_error: `${response.status}: ${responseText}`,
        local_persisted: true,
        message: `Action saved locally — Hub sync failed. Marked for retry.`,
      }, { status: 500 });
    }

    console.log(`[pushOrderStatusToHub] ✅ ${action_type} for ${order_number} synced to Hub`);

    // Update DriverActionLog sync status to success
    if (driver_action_log_id) {
      try {
        await base44.asServiceRole.entities.DriverActionLog.update(driver_action_log_id, {
          hub_synced: true,
          hub_sync_status: 'success',
          hub_sync_error: null,
        });
      } catch (logErr) {
        console.warn('[pushOrderStatusToHub] Failed to update DriverActionLog on success:', logErr.message);
      }
    }

    // Log success
    try {
      await base44.asServiceRole.entities.OrderSyncLog.create({
        order_number,
        status: 'success',
        description: `Driver action ${action_type} successfully synced to Hub`,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        triggered_by: 'admin_push',
      });
    } catch (logErr) {
      console.warn('[pushOrderStatusToHub] Failed to log success:', logErr.message);
    }

    return Response.json({
      success: true,
      hub_synced: true,
      hub_response: hubResult,
      endpoint: `${hubBase}/functions/receiveDriverStatusUpdate`,
      payload_sent: payload,
    });
  } catch (error) {
    console.error('[pushOrderStatusToHub] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
