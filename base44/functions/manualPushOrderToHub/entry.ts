import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const HUB_SYNC_SECRET = Deno.env.get('HUB_SYNC_SECRET');

/**
 * Manually push a lost/stuck order directly to Hub via the new pull endpoint.
 * Used for recovery when the old push endpoint (405) is deprecated.
 * 
 * This directly invokes the Hub's internal pullOrdersFromCustomerApp logic
 * to fetch and ingest orders that are stuck in Customer App but missing from Hub.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { order_number, customer_email } = await req.json();

    if (!order_number || !customer_email) {
      return Response.json({ error: 'order_number and customer_email required' }, { status: 400 });
    }

    // Fetch the stuck order from Customer App
    const orders = await base44.asServiceRole.entities.Order.filter({ order_number });
    if (!orders.length) {
      return Response.json({ error: `Order ${order_number} not found in Customer App` }, { status: 404 });
    }

    const order = orders[0];
    console.log(`[ManualPush] Found order ${order_number} in Customer App, triggering Hub pull...`);

    // Call Hub's direct pull endpoint to sync this specific customer's orders
    // Format: POST HUB_API_URL/pullOrdersFromCustomerApp
    // Body: { customer_email: "..." }
    const pullUrl = HUB_API_URL.replace(/\/$/, '') + '/pullOrdersFromCustomerApp';

    const hubResponse = await fetch(pullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HUB_SYNC_SECRET}`,
      },
      body: JSON.stringify({ customer_email }),
    });

    if (!hubResponse.ok) {
      const errText = await hubResponse.text();
      console.error(`[ManualPush] Hub pull failed: ${hubResponse.status} — ${errText}`);
      return Response.json({
        error: `Hub pull endpoint failed: ${hubResponse.status}`,
        details: errText,
        note: 'Order exists in Customer App but Hub pull failed. Manual sync or retry needed.'
      }, { status: hubResponse.status });
    }

    const result = await hubResponse.json();
    console.log(`[ManualPush] Hub pull succeeded for ${customer_email}:`, result);

    // Log recovery in OrderSyncLog
    try {
      await base44.asServiceRole.entities.OrderSyncLog.create({
        order_number,
        status: 'success',
        description: `Manual push via Hub's pullOrdersFromCustomerApp endpoint succeeded`,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        triggered_by: 'manual'
      });
    } catch (logErr) {
      console.warn(`Failed to log in OrderSyncLog: ${logErr.message}`);
    }

    return Response.json({
      success: true,
      order_number,
      customer_email,
      message: `Order ${order_number} pushed to Hub successfully via pull endpoint`,
      hub_response: result
    });
  } catch (error) {
    console.error('[ManualPush] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});