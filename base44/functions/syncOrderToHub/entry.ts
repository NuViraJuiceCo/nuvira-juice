import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  // This function is called by entity automation (internal platform trigger)
  // No user auth required since it's invoked server-to-server
  const body = await req.json();

  console.log('syncOrderToHub payload keys:', Object.keys(body));

  // Entity automation payload: { event, data }
  const order = body.data || body.order || body;

  if (!order || !order.id) {
    console.error('No order found in payload:', JSON.stringify(body).substring(0, 500));
    return Response.json({ error: 'No order data', payload_keys: Object.keys(body) }, { status: 400 });
  }

  console.log(`Syncing order ${order.id} (status: ${order.status}) to hub`);

  // Build notification message
  const itemsPreview = (order.items || []).slice(0, 2).map(i => i.title).filter(Boolean).join(', ') || 'Your order';
  const itemsCount = (order.items || []).length;
  const notificationMessage = itemsCount > 2
    ? `${itemsPreview} + ${itemsCount - 2} more`
    : itemsPreview;

  const totalStr = typeof order.total === 'number' ? `$${order.total.toFixed(2)}` : '';

  // Create notification for the customer
  if (order.customer_email) {
    await base44.asServiceRole.entities.Notification.create({
      customer_email: order.customer_email,
      title: `Order #${order.order_number || order.id} Confirmed`,
      message: [notificationMessage, totalStr].filter(Boolean).join(' • '),
      type: 'order_update',
      order_id: order.id,
      is_read: false,
    });
    console.log(`Notification created for ${order.customer_email}`);
  } else {
    console.warn('No customer_email on order — skipping notification');
  }

  console.log(`Order ${order.id} synced successfully`);
  return Response.json({ success: true, orderId: order.id });
});