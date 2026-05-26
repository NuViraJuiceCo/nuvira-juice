import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ADMIN FUNCTION: Find and log all Customer App orders that are missing from Hub.
 * Used to manually trigger retries or for admin debugging.
 * 
 * Call this to generate a list of stuck orders, then coordinate with Hub team for recovery.
 */
Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_LEGACY_REPAIR_TOOLS') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'legacy_repair_tools_disabled',
        message: 'Legacy repair tools are disabled for May 30 launch freeze.',
      });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    // Fetch all local orders
    const allOrders = await base44.asServiceRole.entities.Order.list('-created_date', 100);
    console.log(`[StuckOrdersCheck] Scanning ${allOrders.length} local orders for Hub gaps...`);

    // For each order, check if it exists in Hub via getOrderUpdatesForSync
    const stuckOrders = [];
    const HUB_API_URL = Deno.env.get('HUB_API_URL');
    const HUB_SYNC_SECRET = Deno.env.get('HUB_SYNC_SECRET');

    if (!HUB_API_URL || !HUB_SYNC_SECRET) {
      return Response.json({ error: 'Hub not configured' }, { status: 400 });
    }

    // Query Hub for orders synced in the last 7 days
    try {
      const hubUrl = HUB_API_URL.replace(/\/$/, '') + '/getOrderUpdatesForSync';
      const hubRes = await fetch(hubUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${HUB_SYNC_SECRET}`,
        },
        body: JSON.stringify({ since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() }),
      });

      if (hubRes.ok) {
        const hubData = await hubRes.json();
        const hubOrderNumbers = new Set(
          (hubData.orders || []).map(o => (o.shopify_order_number || o.order_number || '').replace('#', ''))
        );

        // Find stuck orders (in Customer App but NOT in Hub)
        for (const order of allOrders) {
          if (!hubOrderNumbers.has(order.order_number)) {
            stuckOrders.push({
              order_number: order.order_number,
              customer_email: order.customer_email,
              customer_name: order.customer_name,
              total: order.total,
              status: order.status,
              created_date: order.created_date,
              id: order.id,
            });
          }
        }

        console.log(`[StuckOrdersCheck] Found ${stuckOrders.length} orders stuck in Customer App`);

        // Log to OrderSyncLog for audit trail
        for (const stuck of stuckOrders) {
          try {
            await base44.asServiceRole.entities.OrderSyncLog.create({
              order_number: stuck.order_number,
              status: 'error',
              description: `Stuck order: missing from Hub. Customer App has it but Hub query returned nothing. Manual recovery needed.`,
              started_at: stuck.created_date,
              triggered_by: 'cron_poll',
            });
          } catch (logErr) {
            console.warn(`Failed to log stuck order ${stuck.order_number}:`, logErr.message);
          }
        }

        return Response.json({
          success: true,
          local_count: allOrders.length,
          stuck_count: stuckOrders.length,
          stuck_orders: stuckOrders,
          message: `${stuckOrders.length} orders are stuck in Customer App and missing from Hub. Coordinate with Hub team for recovery.`
        });
      } else {
        const errText = await hubRes.text();
        console.error(`[StuckOrdersCheck] Hub query failed: ${hubRes.status} — ${errText}`);
        return Response.json({ error: `Hub query failed: ${hubRes.status}`, details: errText }, { status: hubRes.status });
      }
    } catch (hubErr) {
      console.error('[StuckOrdersCheck] Hub fetch error:', hubErr.message);
      return Response.json({ error: `Hub fetch error: ${hubErr.message}` }, { status: 500 });
    }
  } catch (error) {
    console.error('[StuckOrdersCheck] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
