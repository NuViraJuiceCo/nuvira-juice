import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const HUB_SYNC_SECRET = Deno.env.get('HUB_SYNC_SECRET');

/**
 * Manually push a lost/stuck order to Hub via ingestCustomerAppOrder endpoint.
 * 
 * Tests the full recovery path:
 * 1. Fetch stuck order from Customer App
 * 2. Send to Hub's ingestCustomerAppOrder endpoint
 * 3. Verify auth (CUSTOMER_APP_SYNC_SECRET)
 * 4. Log result in OrderSyncLog
 * 5. Return response (success or idempotent skip)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { order_number, customer_email } = await req.json();

    if (!order_number || !customer_email) {
      return Response.json({ error: 'order_number and customer_email required' }, { status: 400 });
    }

    const startTime = new Date().toISOString();

    // Step 1: Fetch the stuck order from Customer App
    const orders = await base44.asServiceRole.entities.Order.filter({ order_number });
    if (!orders.length) {
      return Response.json({ error: `Order ${order_number} not found in Customer App` }, { status: 404 });
    }

    const order = orders[0];
    console.log(`[ManualPush] Step 1 ✓ Found order ${order_number} in Customer App (id: ${order.id})`);

    // Step 2: Prepare order payload for Hub ingestion
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

    // Step 3: Call Hub's ingestCustomerAppOrder endpoint with CUSTOMER_APP_SYNC_SECRET
    const hubUrl = HUB_API_URL.replace(/\/$/, '') + '/ingestCustomerAppOrder';
    const syncSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

    if (!syncSecret) {
      console.error('[ManualPush] CUSTOMER_APP_SYNC_SECRET not configured');
      return Response.json({ error: 'CUSTOMER_APP_SYNC_SECRET not configured' }, { status: 500 });
    }

    console.log(`[ManualPush] Step 2 ✓ Prepared payload, calling Hub at ${hubUrl}...`);

    const hubResponse = await fetch(hubUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${syncSecret}`,
      },
      body: JSON.stringify(orderPayload),
    });

    const hubResponseText = await hubResponse.text();
    const hubData = hubResponseText ? JSON.parse(hubResponseText) : {};

    if (!hubResponse.ok) {
      console.error(`[ManualPush] Hub ingestion failed: ${hubResponse.status} — ${hubResponseText}`);

      // Log failure
      try {
        await base44.asServiceRole.entities.OrderSyncLog.create({
          order_number,
          status: 'error',
          description: `Manual push to ingestCustomerAppOrder failed: ${hubResponse.status} — ${hubResponseText.substring(0, 500)}`,
          started_at: startTime,
          completed_at: new Date().toISOString(),
          triggered_by: 'manual',
        });
      } catch (logErr) {
        console.warn(`[ManualPush] Failed to log error: ${logErr.message}`);
      }

      return Response.json({
        success: false,
        error: `Hub ingestion failed: ${hubResponse.status}`,
        details: hubData,
        order_number,
      }, { status: hubResponse.status });
    }

    console.log(`[ManualPush] Step 3 ✓ Hub responded with ${hubResponse.status}:`, hubData);

    // Step 4: Determine if this was a success or idempotent skip
    const logStatus = hubData.status === 'duplicate_event' ? 'recovery' : 'success';
    const logDescription = hubData.status === 'duplicate_event'
      ? `Idempotent re-sync: Hub already has this order (${hubData.hub_order_id}), skipped duplicate.`
      : `Successfully ingested order ${order_number} to Hub (${hubData.hub_order_id || 'new'}).`;

    // Log result in OrderSyncLog
    try {
      await base44.asServiceRole.entities.OrderSyncLog.create({
        order_number,
        status: logStatus,
        description: logDescription,
        started_at: startTime,
        completed_at: new Date().toISOString(),
        triggered_by: 'manual',
      });
      console.log(`[ManualPush] Step 4 ✓ Logged sync result in OrderSyncLog (status: ${logStatus})`);
    } catch (logErr) {
      console.warn(`[ManualPush] Failed to log sync result: ${logErr.message}`);
    }

    // Step 5: Return success response
    return Response.json({
      success: true,
      order_number,
      customer_email,
      hub_response_status: hubData.status,
      hub_order_id: hubData.hub_order_id,
      message: hubData.status === 'duplicate_event'
        ? `Order ${order_number} already exists in Hub (idempotent). Re-sync skipped.`
        : `Order ${order_number} successfully pushed to Hub for ingestion.`,
      hub_full_response: hubData,
    });
  } catch (error) {
    console.error('[ManualPush] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});