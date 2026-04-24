import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin function: Sync orders from the hub back to local Order entity
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const hubSecret = Deno.env.get('HUB_SYNC_SECRET');
    const hubApiUrl = Deno.env.get('HUB_API_URL');

    if (!hubSecret || !hubApiUrl) {
      return Response.json({ error: 'Hub not configured' }, { status: 400 });
    }

    // Fetch orders from hub
    const response = await fetch(`${hubApiUrl}/functions/getOrdersForSync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hubSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ limit: 500, offset: 0 }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Hub fetch failed: ${response.status} ${errText}`);
      return Response.json({
        error: 'Failed to fetch from hub',
        status: response.status,
        details: errText,
      }, { status: response.status });
    }

    const hubData = await response.json();
    const hubOrders = hubData.orders || [];

    let synced = 0;
    let errors = 0;

    // Sync each order to local database
    for (const hubOrder of hubOrders) {
      try {
        // Check if order already exists locally
        const existing = await base44.asServiceRole.entities.Order.filter({ order_number: hubOrder.order_number });

        if (existing.length === 0) {
          // Create new order
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
            status: hubOrder.status || 'order_received',
            status_history: hubOrder.status_history || [],
            notes: hubOrder.notes || '',
          });
          synced++;
        } else {
          // Update existing order if status differs
          const local = existing[0];
          if (local.status !== hubOrder.status) {
            await base44.asServiceRole.entities.Order.update(local.id, {
              status: hubOrder.status,
              status_history: hubOrder.status_history || [],
            });
            synced++;
          }
        }
      } catch (err) {
        console.error(`Failed to sync order ${hubOrder.order_number}:`, err.message);
        errors++;
      }
    }

    console.log(`Synced ${synced} orders from hub, ${errors} errors`);

    return Response.json({
      success: true,
      message: 'Orders synced from hub',
      synced,
      errors,
      total_from_hub: hubOrders.length,
    });
  } catch (error) {
    console.error('Sync orders from hub error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});