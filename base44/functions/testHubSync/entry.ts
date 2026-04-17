const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    console.log(`Testing hub sync to: ${HUB_API_URL}`);

    const testPayload = {
      id: 'test-order-' + Date.now(),
      order_number: '#TEST-001',
      customer_email: 'test@nuvira.com',
      items: [{ title: 'Test Juice', price: 12, quantity: 1 }],
      subtotal: 12,
      total: 17,
      fulfillment_type: 'delivery',
      delivery_address: '123 Test St',
      contact_phone: '555-0000',
      estimated_delivery_date: '2026-04-20',
      status: 'order_received',
      payment_captured: true,
    };

    const response = await fetch(HUB_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sync-secret': CUSTOMER_APP_SYNC_SECRET,
      },
      body: JSON.stringify(testPayload),
    });

    const data = await response.json();
    console.log(`Hub response (${response.status}):`, data);

    if (!response.ok) {
      return Response.json({ error: `Hub returned ${response.status}`, details: data }, { status: response.status });
    }

    return Response.json({ success: true, hub_response: data });
  } catch (error) {
    console.error('Test sync error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});