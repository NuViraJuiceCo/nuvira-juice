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

    // Parse structured address fields from the stored delivery_address string or structured object
    const addr = order.delivery_address || '';
    let address_line1 = '', address_city = '', address_state = '', address_postal_code = '', address_country = 'US';
    if (order.address_line1) {
      // Structured fields stored on order (future-proof)
      address_line1 = order.address_line1 || '';
      address_city = order.address_city || '';
      address_state = order.address_state || '';
      address_postal_code = order.address_postal_code || '';
      address_country = order.address_country || 'US';
    } else if (typeof addr === 'string' && addr.includes(',')) {
      // Parse from "street, city, state zip" string format
      const parts = addr.split(',').map(s => s.trim());
      address_line1 = parts[0] || '';
      address_city = parts[1] || '';
      const stateZip = (parts[2] || '').trim().split(' ');
      address_state = stateZip[0] || '';
      address_postal_code = stateZip[1] || '';
    }

    // Infer order_type from order characteristics
    let order_type = 'one_time'; // default
    if (order.stripe_payment_intent_id && !order.stripe_checkout_session_id) {
      // Subscription orders from createSubscriptionSession don't have checkout_session_id
      order_type = 'subscription';
    } else if (order.notes && order.notes.includes('Subscription')) {
      // Hub subscription orders have "Subscription" in notes
      order_type = 'subscription';
    }

    // Derive fulfillment_mode from order_type
    const fulfillment_mode = order_type === 'subscription' ? 'multi_delivery' : 'single_delivery';

    const payload = {
      event: 'order.created',
      source: 'customer_app',
      order: {
        id: order.id,
        order_number: order.order_number,
        customer_email: order.customer_email,
        customer_name: order.customer_name || '',
        customer_phone: order.contact_phone || '',
        // Structured address fields (required by Hub)
        address_line1,
        address_line2: order.address_line2 || '',
        address_city,
        address_state,
        address_postal_code,
        address_country,
        delivery_address: addr, // keep full string for backward-compat
        // Line items
        line_items: (order.items || []).map(i => ({
          title: i.title,
          quantity: i.quantity,
          price: i.price,
          product_id: i.product_id,
          image_url: i.image_url || null,
        })),
        items: order.items,
        subtotal: order.subtotal,
        delivery_fee: order.delivery_fee,
        total_price: order.total,
        total: order.total,
        fulfillment_method: order.fulfillment_type || 'delivery',
        fulfillment_type: order.fulfillment_type,
        requested_delivery_date: order.estimated_delivery_date || null,
        estimated_delivery_date: order.estimated_delivery_date,
        status: order.status,
        production_status: order.status === 'order_received' ? 'new' : order.status,
        is_preorder: order.is_preorder,
        preorder_fulfillment_date: order.preorder_fulfillment_date,
        customer_notes: order.notes || '',
        notes: order.notes,
        // Stripe cross-reference IDs
        stripe_checkout_session_id: order.stripe_checkout_session_id || null,
        stripe_payment_intent_id: order.stripe_payment_intent_id || null,
        created_date: order.created_date,
        // New Hub order architecture fields (effective 2026-05-01)
        order_type,
        fulfillment_mode,
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