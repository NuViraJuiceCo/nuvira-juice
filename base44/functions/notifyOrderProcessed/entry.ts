import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

/**
 * Sends order processed notification to operations@nuvirajuice.com
 * Triggered by: stripeWebhook after order is confirmed
 * Payload: { order_id, order_number, customer_email, items, total, delivery_address }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { order_id, order_number, customer_email, items, total, delivery_address } = await req.json();

    if (!RESEND_API_KEY) {
      console.error('notifyOrderProcessed: RESEND_API_KEY not set');
      return Response.json({ error: 'Email service not configured' }, { status: 500 });
    }

    // Format items list
    const itemsHtml = items?.map(item => 
      `<tr><td style="padding: 8px;">${item.title}</td><td style="padding: 8px;">x${item.quantity}</td><td style="padding: 8px;">$${(item.price * item.quantity).toFixed(2)}</td></tr>`
    ).join('') || '';

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; color: #333; line-height: 1.6; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; padding: 20px 0; border-bottom: 2px solid #2d6a4f; }
    .header h1 { margin: 0; color: #2d6a4f; }
    .content { padding: 20px 0; }
    .order-details { background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0; }
    .order-details h2 { margin-top: 0; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    table th { text-align: left; padding: 10px; background: #f0f0f0; font-weight: bold; }
    .total { font-size: 18px; font-weight: bold; margin-top: 15px; padding-top: 15px; border-top: 1px solid #ddd; }
    .footer { text-align: center; padding: 20px 0; color: #666; font-size: 12px; border-top: 1px solid #ddd; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Order #${order_number || order_id} Processed</h1>
    </div>
    
    <div class="content">
      <p><strong>Customer:</strong> ${customer_email}</p>
      <p><strong>Delivery Address:</strong> ${delivery_address || 'N/A'}</p>
      
      <div class="order-details">
        <h2>Order Summary</h2>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>
        <div class="total">
          Total: $${total?.toFixed(2) || '0.00'}
        </div>
      </div>

      <p><strong>Status:</strong> Payment received — scheduled for juicing</p>
      <p><a href="https://app.base44.com/admin/orders">View order in admin</a></p>
    </div>

    <div class="footer">
      <p>&copy; 2026 NuVira Juice Company. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
    `;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'NuVira Juice Co <info@nuvirajuice.com>',
        to: 'info@nuvirajuice.com',
        subject: `Order #${order_number || order_id} Processed`,
        html,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`notifyOrderProcessed: Resend API error - ${response.status}:`, error);
      return Response.json({ error: 'Failed to send email' }, { status: response.status });
    }

    const result = await response.json();
    console.log(`Order processed notification sent to operations:`, result.id);
    return Response.json({ success: true, email_id: result.id });
  } catch (error) {
    console.error('notifyOrderProcessed error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});