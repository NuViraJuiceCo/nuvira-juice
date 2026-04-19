import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

/**
 * Manual sync endpoint for fetching order updates from hub on-demand
 * Called from: Admin/testing dashboard for immediate sync
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    if (!HUB_API_URL) {
      return Response.json({ success: true, skipped: true, message: 'HUB_API_URL not set' });
    }

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
      console.error(`manualSyncOrders: hub returned ${response.status}:`, errorText);
      return Response.json({ error: `Hub returned ${response.status}`, details: errorText }, { status: response.status });
    }

    const { orders: hubOrders = [] } = await response.json();
    console.log(`manualSyncOrders: fetched ${hubOrders.length} order updates from hub`);

    let synced = 0;

    for (const hubOrder of hubOrders) {
      if (!hubOrder.id) continue;

      const localOrders = await base44.asServiceRole.entities.Order.filter({ id: hubOrder.id });
      if (localOrders.length === 0) continue;

      const localOrder = localOrders[0];

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

        synced++;
      }
    }

    console.log(`manualSyncOrders: synced ${synced} order updates`);
    return Response.json({ success: true, fetched: hubOrders.length, synced });
  } catch (error) {
    console.error('manualSyncOrders error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});