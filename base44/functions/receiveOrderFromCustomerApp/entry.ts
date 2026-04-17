import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL') || 'https://nuvira-flow-core.base44.app/api/apps/69da9e8036b037ad40a9a73f/functions';
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { shopify_order_id, shopify_order_number, customer_email, customer_phone, line_items, fulfillment_method, delivery_address, requested_delivery_date, subtotal, total_price, payment_status, customer_notes } = await req.json();

    if (!shopify_order_id || !customer_email) {
      console.error('Missing required fields: shopify_order_id or customer_email');
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    console.log(`[ORDER SYNC] Syncing order ${shopify_order_id} to hub`);

    // Forward to hub
    const hubResponse = await fetch(`${HUB_API_URL}/receiveOrderFromCustomerApp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify({
        shopify_order_id,
        shopify_order_number,
        customer_email,
        customer_phone,
        line_items,
        fulfillment_method,
        delivery_address,
        requested_delivery_date,
        subtotal,
        total_price,
        payment_status,
        customer_notes,
      }),
    });

    if (!hubResponse.ok) {
      const errorText = await hubResponse.text();
      console.error(`[ORDER SYNC] Hub returned ${hubResponse.status}: ${errorText}`);
      
      // Log sync failure
      await base44.asServiceRole.entities.ShopifySyncLog.create({
        sync_type: 'webhook',
        status: 'error',
        records_synced: 0,
        records_failed: 1,
        error_details: `Hub sync failed: ${errorText}`,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        triggered_by: 'webhook',
      });

      return Response.json({ error: `Hub sync failed (${hubResponse.status})`, details: errorText }, { status: hubResponse.status });
    }

    const result = await hubResponse.json();
    console.log(`[ORDER SYNC] Order synced successfully:`, result);

    // Log successful sync
    await base44.asServiceRole.entities.ShopifySyncLog.create({
      sync_type: 'webhook',
      status: 'success',
      records_synced: 1,
      records_failed: 0,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      triggered_by: 'webhook',
    });

    return Response.json({ success: true, hub_response: result });
  } catch (error) {
    console.error('[ORDER SYNC] Error:', error.message);
    
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
        triggered_by: 'webhook',
      });
    } catch {}

    return Response.json({ error: error.message }, { status: 500 });
  }
});