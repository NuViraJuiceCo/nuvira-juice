import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin function: Manually sync subscription orders from hub for a specific customer
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
    console.log(`[Manual Sync] Fetching subscription orders for ${customer_email} from ${hubUrl}`);

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
      console.error(`[Manual Sync] Hub request failed: ${response.status} ${errText}`);
      return Response.json({
        error: 'Failed to fetch from hub',
        details: errText,
        status: response.status,
      }, { status: response.status });
    }

    const hubData = await response.json();
    const orders = hubData.orders || [];

    console.log(`[Manual Sync] Received ${orders.length} subscription orders from hub for ${customer_email}`);

    let synced = 0;
    let skipped = 0;
    const errors = [];

    for (const hubOrder of orders) {
      try {
        const existing = await base44.asServiceRole.entities.Order.filter({ 
          order_number: hubOrder.shopify_order_number || hubOrder.order_number 
        });

        if (existing.length === 0) {
          await base44.asServiceRole.entities.Order.create({
            order_number: hubOrder.shopify_order_number || hubOrder.order_number,
            customer_email: hubOrder.customer_email,
            items: hubOrder.line_items || [],
            subtotal: hubOrder.subtotal || 0,
            delivery_fee: hubOrder.delivery_fee || 0,
            total: hubOrder.total_price || hubOrder.total || 0,
            fulfillment_type: hubOrder.fulfillment_method || 'delivery',
            delivery_address: hubOrder.delivery_address || '',
            contact_phone: hubOrder.customer_phone || '',
            status: 'scheduled_for_juicing',
            status_history: [{
              status: 'scheduled_for_juicing',
              timestamp: new Date().toISOString(),
              message: 'Subscription order synced from hub',
            }],
          });
          synced++;
          console.log(`[Manual Sync] Created order ${hubOrder.shopify_order_number}`);
        } else {
          skipped++;
          console.log(`[Manual Sync] Order ${hubOrder.shopify_order_number} already exists, skipped`);
        }
      } catch (err) {
        const msg = `Failed to sync ${hubOrder.shopify_order_number}: ${err.message}`;
        errors.push(msg);
        console.error(`[Manual Sync] ${msg}`);
      }
    }

    return Response.json({
      success: true,
      customer_email,
      total_from_hub: orders.length,
      synced,
      skipped,
      errors: errors.length > 0 ? errors : null,
      message: `Synced ${synced} orders, ${skipped} already existed${errors.length > 0 ? `, ${errors.length} errors` : ''}`,
    });
  } catch (error) {
    console.error('[Manual Sync] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});