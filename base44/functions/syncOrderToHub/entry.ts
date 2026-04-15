import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { data: order } = body;

    if (!order || !order.id) {
      return Response.json({ error: 'No order data' }, { status: 400 });
    }

    console.log(`Syncing order ${order.id} to hub`);

    // Build notification message
    const itemsPreview = order.items?.slice(0, 2).map(i => i.title).join(', ') || 'Order items';
    const itemsCount = order.items?.length || 0;
    const notificationMessage = itemsCount > 2
      ? `${itemsPreview} + ${itemsCount - 2} more`
      : itemsPreview;

    // Create notification for the customer
    if (order.customer_email) {
      await base44.asServiceRole.entities.Notification.create({
        customer_email: order.customer_email,
        title: `Order #${order.order_number} Confirmed`,
        message: `${notificationMessage} • $${order.total?.toFixed(2)}`,
        type: 'order_update',
        order_id: order.id,
        is_read: false,
      });
      console.log(`Notification created for ${order.customer_email}`);
    }

    console.log(`Order ${order.id} synced successfully`);
    return Response.json({ success: true, orderId: order.id });
  } catch (error) {
    console.error('Sync error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});