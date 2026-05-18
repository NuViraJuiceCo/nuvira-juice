import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * RE-SYNC TEST: Manually push a stuck Customer App order to Hub via ingestCustomerAppOrder.
 * 
 * This tests the recovery path for paid orders stuck in Customer App:
 * 1. Fetch stuck order from Customer App (by order_number)
 * 2. Send full order payload to Hub's ingestCustomerAppOrder endpoint
 * 3. Use CUSTOMER_APP_SYNC_SECRET for auth
 * 4. Log result in OrderSyncLog (success or idempotent)
 * 5. Return response
 * 
 * Called by: Test suite for re-sync verification
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { order_number, customer_email } = await req.json();

    if (!order_number || !customer_email) {
      return Response.json({ error: 'order_number and customer_email required' }, { status: 400 });
    }

    const startTime = new Date().toISOString();
    console.log(`[IngestTest] Starting re-sync for ${order_number} (${customer_email})`);

    // ===== STEP 1: Fetch order from Customer App =====
    const orders = await base44.asServiceRole.entities.Order.filter({ order_number });
    if (!orders.length) {
      console.error(`[IngestTest] Order ${order_number} not found in Customer App`);
      return Response.json({ error: `Order ${order_number} not found` }, { status: 404 });
    }

    const order = orders[0];
    console.log(`[IngestTest] ✓ Step 1: Found ${order_number} in Customer App (id: ${order.id})`);

    // ===== STEP 2: Prepare order payload =====
    const orderPayload = {
      order_number: order.order_number,
      customer_email: order.customer_email,
      customer_name: order.customer_name,
      items: order.items || [],
      subtotal: order.subtotal || 0,
      delivery_fee: order.delivery_fee || 0,
      total: order.total || 0,
      fulfillment_type: order.fulfillment_type || 'delivery',
      delivery_address: order.delivery_address || '',
      address_line1: order.address_line1 || '',
      address_line2: order.address_line2 || '',
      address_city: order.address_city || '',
      address_state: order.address_state || '',
      address_postal_code: order.address_postal_code || '',
      address_country: order.address_country || 'US',
      contact_phone: order.contact_phone || '',
      estimated_delivery_date: order.estimated_delivery_date,
      status: order.status,
      is_preorder: order.is_preorder || false,
      payment_captured: order.payment_captured || false,
      stripe_checkout_session_id: order.stripe_checkout_session_id,
      stripe_payment_intent_id: order.stripe_payment_intent_id,
    };

    console.log(`[IngestTest] ✓ Step 2: Prepared payload with ${orderPayload.items.length} items, total $${orderPayload.total}`);

    // ===== STEP 3: Get Hub URL and auth secret =====
    const hubApiUrl = Deno.env.get('HUB_API_URL');
    const syncSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

    if (!hubApiUrl) {
      console.error('[IngestTest] HUB_API_URL not configured');
      return Response.json({ error: 'HUB_API_URL not configured' }, { status: 500 });
    }
    if (!syncSecret) {
      console.error('[IngestTest] CUSTOMER_APP_SYNC_SECRET not configured');
      return Response.json({ error: 'CUSTOMER_APP_SYNC_SECRET not configured' }, { status: 500 });
    }

    const ingestUrl = hubApiUrl.replace(/\/$/, '') + '/ingestCustomerAppOrder';
    console.log(`[IngestTest] ✓ Step 3: Configured auth (CUSTOMER_APP_SYNC_SECRET=${syncSecret.substring(0,8)}...)`);

    // ===== STEP 4: Call Hub ingestCustomerAppOrder endpoint =====
    console.log(`[IngestTest] Step 4: Calling ${ingestUrl}...`);

    const hubResponse = await fetch(ingestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${syncSecret}`,
      },
      body: JSON.stringify(orderPayload),
    });

    const hubResponseText = await hubResponse.text();
    let hubData = {};
    try {
      hubData = hubResponseText ? JSON.parse(hubResponseText) : {};
    } catch (e) {
      console.warn(`[IngestTest] Failed to parse Hub response: ${e.message}`);
    }

    // ===== STEP 5: Handle response =====
    if (!hubResponse.ok) {
      console.error(`[IngestTest] ✗ Hub ingestion failed: ${hubResponse.status} — ${hubResponseText.substring(0, 200)}`);

      // Log failure
      try {
        await base44.asServiceRole.entities.OrderSyncLog.create({
          order_number,
          status: 'error',
          description: `Manual re-sync to Hub failed: ${hubResponse.status} — ${hubResponseText.substring(0, 200)}`,
          started_at: startTime,
          completed_at: new Date().toISOString(),
          triggered_by: 'manual',
        });
        console.log(`[IngestTest] Logged failure in OrderSyncLog`);
      } catch (logErr) {
        console.warn(`[IngestTest] Failed to log failure: ${logErr.message}`);
      }

      return Response.json({
        success: false,
        error: `Hub ingestion failed: ${hubResponse.status}`,
        details: hubData,
        order_number,
        hub_status_code: hubResponse.status,
      }, { status: hubResponse.status });
    }

    console.log(`[IngestTest] ✓ Step 5: Hub accepted (${hubResponse.status}), response:`, JSON.stringify(hubData).substring(0, 200));

    // ===== STEP 6: Log result in OrderSyncLog =====
    const logStatus = hubData.status === 'duplicate_event' ? 'recovery' : 'success';
    const logDesc = hubData.status === 'duplicate_event'
      ? `Idempotent re-sync: Hub already has ${order_number} (id: ${hubData.hub_order_id}), duplicate skipped.`
      : `Successfully re-synced ${order_number} to Hub (id: ${hubData.hub_order_id || 'new'}).`;

    try {
      await base44.asServiceRole.entities.OrderSyncLog.create({
        order_number,
        status: logStatus,
        description: logDesc,
        started_at: startTime,
        completed_at: new Date().toISOString(),
        triggered_by: 'manual',
      });
      console.log(`[IngestTest] ✓ Step 6: Logged sync result (status: ${logStatus})`);
    } catch (logErr) {
      console.warn(`[IngestTest] Failed to log: ${logErr.message}`);
    }

    // ===== STEP 7: Return success =====
    console.log(`[IngestTest] ✓ COMPLETE: ${order_number} re-synced (${hubData.status || 'success'})`);

    return Response.json({
      success: true,
      order_number,
      customer_email,
      message: hubData.status === 'duplicate_event'
        ? `Order ${order_number} already in Hub (idempotent). Re-sync skipped.`
        : `Order ${order_number} successfully re-synced to Hub.`,
      hub_order_id: hubData.hub_order_id,
      hub_status: hubData.status,
      logged_in_sync_log: true,
      hub_response: hubData,
    });
  } catch (error) {
    console.error('[IngestTest] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});