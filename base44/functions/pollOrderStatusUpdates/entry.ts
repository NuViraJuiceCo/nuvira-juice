import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL') || 'https://nuvira-flow-core.base44.app/api/apps/69da9e8036b037ad40a9a73f/functions';
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const SYNC_TIMESTAMP_KEY = 'last_hub_sync_timestamp';

/**
 * Polls hub for order status updates using incremental sync.
 * Designed to run every 60-120 seconds via automation.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    console.log('[ORDER STATUS POLL] Starting polling cycle');

    // Get last sync timestamp from app settings
    let lastSyncTimestamp = null;
    try {
      const syncLog = await base44.asServiceRole.entities.ShopifySyncLog.filter(
        { sync_type: 'webhook', status: 'success' },
        '-created_date',
        1
      );
      if (syncLog.length > 0 && syncLog[0].completed_at) {
        lastSyncTimestamp = syncLog[0].completed_at;
      }
    } catch (e) {
      console.warn('[ORDER STATUS POLL] Could not retrieve last sync timestamp, fetching all active orders');
    }

    // If no last timestamp, use 2 hours ago
    const sinceTimestamp = lastSyncTimestamp || new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    console.log(`[ORDER STATUS POLL] Querying updates since: ${sinceTimestamp}`);

    // Fetch active orders from database
    const activeOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({
      fulfillment_status: { $nin: ['fulfilled', 'canceled', 'refunded'] },
    }, '-created_date', 100);

    const orderIds = activeOrders.map(o => o.shopify_order_id).filter(Boolean);

    if (orderIds.length === 0) {
      console.log('[ORDER STATUS POLL] No active orders to poll');
      return Response.json({ success: true, updated: 0 });
    }

    console.log(`[ORDER STATUS POLL] Polling ${orderIds.length} active orders`);

    // Call hub to get status updates
    const pollResponse = await fetch(`${HUB_API_URL}/pullOrderStatusUpdates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify({
        since_timestamp: sinceTimestamp,
        order_ids: orderIds,
      }),
    });

    if (!pollResponse.ok) {
      const errorText = await pollResponse.text();
      console.error(`[ORDER STATUS POLL] Hub poll failed (${pollResponse.status}): ${errorText}`);

      await base44.asServiceRole.entities.ShopifySyncLog.create({
        sync_type: 'webhook',
        status: 'error',
        records_synced: 0,
        records_failed: orderIds.length,
        error_details: `Hub poll failed: ${errorText}`,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        triggered_by: 'cron',
      });

      return Response.json({ error: `Poll failed: ${pollResponse.status}`, details: errorText }, { status: pollResponse.status });
    }

    const updates = await pollResponse.json();
    console.log(`[ORDER STATUS POLL] Received ${Array.isArray(updates) ? updates.length : 0} status updates`);

    // Apply updates to local orders
    let updatedCount = 0;
    let failureCount = 0;

    for (const update of (Array.isArray(updates) ? updates : [])) {
      try {
        const localOrder = activeOrders.find(o => o.shopify_order_id === update.order_id);
        if (!localOrder) continue;

        const updateData = {};
        if (update.production_status) updateData.production_status = update.production_status;
        if (update.fulfillment_status) updateData.fulfillment_status = update.fulfillment_status;
        if (update.delivery_status) {
          // Map delivery_status to internal status
          const statusMap = {
            'out_for_delivery': 'out_for_delivery',
            'arriving_soon': 'arriving_soon',
            'delivered': 'delivered',
          };
          if (statusMap[update.delivery_status]) {
            updateData.fulfillment_status = statusMap[update.delivery_status];
          }
        }

        if (Object.keys(updateData).length > 0) {
          await base44.asServiceRole.entities.ShopifyOrder.update(localOrder.id, {
            ...updateData,
            shopify_synced_at: new Date().toISOString(),
          });
          updatedCount++;

          // Create corresponding Order status update
          const internalOrder = await base44.asServiceRole.entities.Order.filter(
            { id: localOrder.base44_order_id },
            null,
            1
          );
          if (internalOrder.length > 0) {
            const statusMap = {
              'in_production': 'in_production',
              'packed': 'bottled_packed',
              'in_transit': 'out_for_delivery',
              'out_for_delivery': 'out_for_delivery',
              'delivered': 'delivered',
            };
            const newStatus = statusMap[updateData.fulfillment_status] || updateData.fulfillment_status;
            
            if (newStatus && newStatus !== internalOrder[0].status) {
              const statusHistory = internalOrder[0].status_history || [];
              statusHistory.push({
                status: newStatus,
                timestamp: new Date().toISOString(),
                message: `Updated from hub: ${update.delivery_status || updateData.fulfillment_status}`,
              });

              await base44.asServiceRole.entities.Order.update(internalOrder[0].id, {
                status: newStatus,
                status_history: statusHistory,
              });
            }
          }
        }
      } catch (error) {
        console.error(`[ORDER STATUS POLL] Failed to update order ${update.order_id}: ${error.message}`);
        failureCount++;
      }
    }

    console.log(`[ORDER STATUS POLL] Completed: ${updatedCount} updated, ${failureCount} failures`);

    // Log sync result
    await base44.asServiceRole.entities.ShopifySyncLog.create({
      sync_type: 'webhook',
      status: failureCount > 0 ? 'partial' : 'success',
      records_synced: updatedCount,
      records_failed: failureCount,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      triggered_by: 'cron',
    });

    return Response.json({ success: true, updated: updatedCount, failed: failureCount });
  } catch (error) {
    console.error('[ORDER STATUS POLL] Fatal error:', error.message);

    try {
      const base44 = createClientFromRequest(req);
      await base44.asServiceRole.entities.ShopifySyncLog.create({
        sync_type: 'webhook',
        status: 'error',
        records_synced: 0,
        records_failed: 1,
        error_details: error.message,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        triggered_by: 'cron',
      });
    } catch {}

    return Response.json({ error: error.message }, { status: 500 });
  }
});