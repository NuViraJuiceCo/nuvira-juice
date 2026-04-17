import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    // Verify the shared secret
    const providedSecret = req.headers.get('x-sync-secret');
    if (providedSecret !== CUSTOMER_APP_SYNC_SECRET) {
      console.error('Unauthorized: Invalid sync secret');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const order = await req.json();

    if (!order || !order.id) {
      console.error('No order data in payload');
      return Response.json({ error: 'No order data' }, { status: 400 });
    }

    console.log(`Received order ${order.id} from customer app`);

    // Create ShopifyOrder record in hub
    const shopifyOrder = await base44.asServiceRole.entities.ShopifyOrder.create({
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
    });

    console.log(`ShopifyOrder created in hub: ${shopifyOrder.id}`);

    return Response.json({
      success: true,
      id: shopifyOrder.id,
      order_id: order.id,
    });
  } catch (error) {
    console.error('receiveOrderFromCustomerApp error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});