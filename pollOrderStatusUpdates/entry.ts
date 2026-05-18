import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

/**
 * ⚠️ DEPRECATED: Architecture Option B (Active)
 * This function is NOT used in the current Customer App architecture.
 * 
 * REASON: Hub endpoint for polling status is no longer available (405 Method Not Allowed).
 * CURRENT APPROACH: Customer App reads Hub-expanded data directly via getCustomerOrdersWithHub
 * and getAdminOrdersWithHub. No polling or background sync needed.
 * 
 * DO NOT RE-ENABLE unless switching back to Option A (push/pull sync model).
 * 
 * Previous behavior: Polls hub for order status updates and syncs them to customer app orders
 * Called by: Scheduled automation every 5 minutes (DISABLED)
 * Fetches: Order updates from hub and applies status changes locally (NO LONGER SUPPORTED)
 */
Deno.serve(async (req) => {
  // ⚠️ DISABLED: Architecture Option B does not use polling.
  // Hub endpoint no longer supports this path (returns 405).
  // Contact backend team if Option A (push/pull) needs to be re-enabled.
  console.log('pollOrderStatusUpdates: DISABLED - Not used in Option B architecture. Use getCustomerOrdersWithHub instead.');
  return Response.json({ 
    error: 'DEPRECATED_FUNCTION', 
    message: 'pollOrderStatusUpdates is disabled. Use getCustomerOrdersWithHub for order display.' 
  }, { status: 410 });
  
  // ────────────────────────────────────────────────────────────────────────
  // The following code is preserved for historical reference only.
  // DO NOT EXECUTE.
  // ────────────────────────────────────────────────────────────────────────
  
  try {
    const base44 = createClientFromRequest(req);

    if (!HUB_API_URL) {
      console.log('pollOrderStatusUpdates: HUB_API_URL not set, skipping');
      return Response.json({ success: true, skipped: true });
    }

    // Fetch order updates from hub
    const response = await fetch(HUB_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`pollOrderStatusUpdates: hub returned ${response.status}:`, errorText);
      return Response.json({ error: `Hub returned ${response.status}` }, { status: response.status });
    }

    const { orders: hubOrders = [] } = await response.json();
    console.log(`pollOrderStatusUpdates: fetched ${hubOrders.length} order updates from hub`);

    let synced = 0;

    for (const hubOrder of hubOrders) {
      if (!hubOrder.id) continue;

      // Find local order by ID
      const localOrders = await base44.asServiceRole.entities.Order.filter({ id: hubOrder.id });
      if (localOrders.length === 0) {
        console.log(`pollOrderStatusUpdates: order ${hubOrder.id} not found locally, skipping`);
        continue;
      }

      const localOrder = localOrders[0];

      // Only update if status has changed
      if (hubOrder.status && hubOrder.status !== localOrder.status) {
        const statusHistory = localOrder.status_history || [];
        statusHistory.push({
          status: hubOrder.status,
          timestamp: new Date().toISOString(),
          message: hubOrder.message || `Status updated to ${hubOrder.status}`,
        });

        await base44.asServiceRole.entities.Order.update(localOrder.id, {
          status: hubOrder.status,
          status_history: statusHistory,
        });

        console.log(`pollOrderStatusUpdates: updated order ${hubOrder.id} to ${hubOrder.status}`);
        synced++;
      }
    }

    console.log(`pollOrderStatusUpdates: synced ${synced} order updates`);
    return Response.json({ success: true, fetched: hubOrders.length, synced });
  } catch (error) {
    console.error('pollOrderStatusUpdates error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});