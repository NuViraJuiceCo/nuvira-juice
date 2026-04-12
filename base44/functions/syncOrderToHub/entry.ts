Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { data: order } = body;

    if (!order || !order.id) {
      return Response.json({ error: 'No order data' }, { status: 400 });
    }

    console.log(`Syncing order ${order.id} to operational hub`);

    const response = await fetch('https://api.base44.com/functions/69da9e8036b037ad40a9a73f/receiveOrder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    });

    if (!response.ok) {
      console.error(`Hub response: ${response.status}`, await response.text());
      return Response.json({ error: 'Failed to sync order' }, { status: 500 });
    }

    console.log(`Order ${order.id} synced successfully`);
    return Response.json({ success: true, orderId: order.id });
  } catch (error) {
    console.error('Sync error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});