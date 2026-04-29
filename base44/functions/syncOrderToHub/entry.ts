import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

/**
 * Syncs an app-originated order (from Base44 checkout) to the operations hub.
 * Called by: createCheckoutSession (non-blocking), stripeWebhook on completion.
 * Payload: { data: <Order object> }  OR  { order_id: "<id>" }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    let order = body.data;

    // If only an order_id was passed, fetch the full order
    if (!order && body.order_id) {
      const results = await base44.asServiceRole.entities.Order.filter({ id: body.order_id });
      order = results[0] || null;
    }

    if (!order || !order.id) {
      console.error('syncOrderToHub: no order data provided');
      return Response.json({ error: 'No order data' }, { status: 400 });
    }

    if (!HUB_API_URL) {
      console.log('syncOrderToHub: HUB_API_URL not set, skipping');
      return Response.json({ success: true, skipped: true });
    }

    const payload = {
      event: 'order.created',
      source: 'customer_app',
      order: {
        id: order.id,
        order_number: order.order_number,
        customer_email: order.customer_email,
        items: order.items,
        subtotal: order.subtotal,
        delivery_fee: order.delivery_fee,
        total: order.total,
        fulfillment_type: order.fulfillment_type,
        delivery_address: order.delivery_address,
        contact_phone: order.contact_phone,
        estimated_delivery_date: order.estimated_delivery_date,
        status: order.status,
        is_preorder: order.is_preorder,
        preorder_fulfillment_date: order.preorder_fulfillment_date,
        notes: order.notes,
        created_date: order.created_date,
      },
    };

    console.log(`syncOrderToHub: syncing order ${order.order_number} to hub`);

    const response = await fetch(HUB_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 410) {
      // Hub deprecated the push endpoint — it now pulls orders on its own schedule via pullOrdersFromCustomerApp.
      // This is expected behavior as of 2026-04-26. Orders are safe in Base44 DB and will be picked up by the hub pull.
      console.log(`syncOrderToHub: hub push endpoint is deprecated (410). Order ${order.order_number} is in Base44 DB and will be pulled by hub on next sync cycle.`);
      return Response.json({ success: true, note: 'Hub pull model — order will sync on next hub pull cycle' });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`syncOrderToHub: hub returned ${response.status}:`, errorText);
      return Response.json({ error: `Hub returned ${response.status}`, details: errorText }, { status: response.status });
    }

    const result = await response.json();
    console.log(`syncOrderToHub: order ${order.order_number} synced successfully`, result);
    return Response.json({ success: true, hub_response: result });
  } catch (error) {
    console.error('syncOrderToHub error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});