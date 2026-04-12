Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { data: order } = body;

    if (!order || !order.id) {
      return Response.json({ error: 'No order data' }, { status: 400 });
    }

    console.log(`Syncing order ${order.id} to operational hub`);

    // Sync order data to hub
    const response = await fetch('https://api.base44.com/functions/69da9e8036b037ad40a9a73f/receiveOrder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    });

    if (!response.ok) {
      console.error(`Hub response: ${response.status}`, await response.text());
      return Response.json({ error: 'Failed to sync order' }, { status: 500 });
    }

    // Create notification in hub
    const itemsPreview = order.items?.slice(0, 2).map(i => i.title).join(', ') || 'Order items';
    const itemsCount = order.items?.length || 0;
    const notificationMessage = itemsCount > 2 
      ? `${itemsPreview} + ${itemsCount - 2} more` 
      : itemsPreview;

    await fetch('https://api.base44.com/functions/69da9e8036b037ad40a9a73f/createNotification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `New Order #${order.order_number}`,
        message: `${notificationMessage} • $${order.total?.toFixed(2)}`,
        customer: order.customer_email,
        orderId: order.id,
      }),
    });

    console.log(`Order ${order.id} synced successfully with notification`);
    return Response.json({ success: true, orderId: order.id });
  } catch (error) {
    console.error('Sync error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});