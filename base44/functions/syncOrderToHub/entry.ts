import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

// Map a customer-app Order to the hub's ShopifyOrder schema
function mapOrderToHub(order) {
  return {
    shopify_order_id: `base44_${order.id}`,
    shopify_order_number: order.order_number || `#${order.id.slice(-6).toUpperCase()}`,
    base44_order_id: order.id,
    source_channel: 'online',
    customer_email: order.customer_email || '',
    customer_phone: order.contact_phone || '',
    line_items: (order.items || []).map(item => ({
      title: item.title || '',
      quantity: item.quantity || 1,
      price: item.price || 0,
    })),
    fulfillment_method: order.fulfillment_type || 'delivery',
    delivery_address: order.delivery_address || '',
    requested_delivery_date: order.estimated_delivery_date || '',
    payment_status: order.payment_captured ? 'paid' : 'authorized',
    fulfillment_status: order.status || 'order_received',
    subtotal: order.subtotal || 0,
    total_price: order.total || 0,
    customer_notes: order.notes || '',
    production_status: 'new',
    assigned_delivery_date: order.estimated_delivery_date || '',
    tags: order.is_preorder ? ['preorder'] : [],
    internal_notes: order.is_preorder
      ? `Pre-order — fulfillment: ${order.preorder_fulfillment_date || 'TBD'}`
      : '',
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    console.log('syncOrderToHub triggered. Event:', body?.event?.type);

    const order = body.data;

    if (!order || !order.id) {
      console.error('No order data in payload');
      return Response.json({ error: 'No order data' }, { status: 400 });
    }

    console.log(`Syncing order ${order.id} (${order.order_number}) to hub`);

    // --- 1. Push to hub ShopifyOrder ---
    const hubPayload = mapOrderToHub(order);
    let hubRecordId = null;

    try {
      console.log('Pushing order to hub via HTTP...');
      const hubResponse = await fetch(`${HUB_API_URL}/functions/receiveOrderFromCustomerApp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sync-secret': CUSTOMER_APP_SYNC_SECRET,
        },
        body: JSON.stringify(order),
      });

      if (!hubResponse.ok) {
        const errorText = await hubResponse.text();
        console.error(`Hub push failed (${hubResponse.status}):`, errorText);
      } else {
        const hubData = await hubResponse.json();
        hubRecordId = hubData.id;
        console.log(`Successfully synced to hub, record ID: ${hubRecordId}`);
      }
    } catch (hubErr) {
      console.error('Hub push error:', hubErr.message);
      // Non-fatal — still create the in-app notification
    }

    // --- 2. Create in-app notification for customer ---
    if (order.customer_email) {
      const itemsPreview = (order.items || []).slice(0, 2).map(i => i.title).filter(Boolean).join(', ') || 'Your order';
      const itemsCount = (order.items || []).length;
      const preview = itemsCount > 2 ? `${itemsPreview} + ${itemsCount - 2} more` : itemsPreview;
      const totalStr = typeof order.total === 'number' ? `$${order.total.toFixed(2)}` : '';

      await base44.asServiceRole.entities.Notification.create({
        customer_email: order.customer_email,
        title: `Order ${order.order_number || order.id} Confirmed`,
        message: [preview, totalStr].filter(Boolean).join(' • '),
        type: 'order_update',
        order_id: order.id,
        is_read: false,
      });
      console.log(`Notification created for ${order.customer_email}`);
    }

    return Response.json({
      success: true,
      orderId: order.id,
      hubRecordId: hubRecordId,
    });
  } catch (error) {
    console.error('syncOrderToHub error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});