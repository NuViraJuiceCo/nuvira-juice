import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin function: Fetch a subscription from the hub and create local orders
 * Payload: { customer_email: string }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { customer_email } = await req.json();
    if (!customer_email) {
      return Response.json({ error: 'customer_email required' }, { status: 400 });
    }

    const hubBase = Deno.env.get('HUB_API_URL');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    if (!hubBase || !hubSecret) {
      return Response.json({ error: 'Hub not configured' }, { status: 400 });
    }

    const hubUrl = `${hubBase.replace(/\/$/, '')}/functions/getSubscriptionOrdersForSync`;
    console.log(`Fetching from hub: ${hubUrl}`);

    // Fetch subscription orders from hub
    const response = await fetch(hubUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hubSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ customer_email }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Hub fetch failed: ${response.status} ${errText}`);
      return Response.json({
        error: 'Failed to fetch from hub',
        status: response.status,
      }, { status: response.status });
    }

    const hubData = await response.json();
    const orders = hubData.orders || [];

    if (orders.length === 0) {
      console.log(`No subscription orders found on hub for ${customer_email}`);
      return Response.json({ error: 'No subscription orders found', customer_email }, { status: 404 });
    }

    // Upsert each order from hub
    let synced = 0;
    for (const hubOrder of orders) {
      const existing = await base44.asServiceRole.entities.Order.filter({ order_number: hubOrder.order_number });
      
      if (existing.length === 0) {
        await base44.asServiceRole.entities.Order.create({
          order_number: hubOrder.order_number,
          customer_email: hubOrder.customer_email,
          items: hubOrder.items || [],
          subtotal: hubOrder.subtotal || 0,
          delivery_fee: hubOrder.delivery_fee || 0,
          total: hubOrder.total || 0,
          fulfillment_type: hubOrder.fulfillment_type || 'delivery',
          delivery_address: hubOrder.delivery_address || '',
          contact_phone: hubOrder.contact_phone || '',
          estimated_delivery_date: hubOrder.estimated_delivery_date,
          status: hubOrder.status || 'scheduled_for_juicing',
          status_history: hubOrder.status_history || [],
          notes: hubOrder.notes || '',
        });
        synced++;
      }
    }

    return Response.json({
      success: true,
      message: `Synced ${synced} subscription orders from hub`,
      customer_email,
      orders_synced: synced,
    });
  } catch (error) {
    console.error('Sync subscription from hub error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});