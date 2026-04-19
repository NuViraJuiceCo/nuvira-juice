import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_SYNC_SECRET = Deno.env.get('HUB_SYNC_SECRET');

/**
 * Receives order confirmation requests from the Hub app and sends branded emails to customers.
 * Auth: Authorization: Bearer <HUB_SYNC_SECRET>
 * Payload: { customer_email, order_number, products, total_price, assigned_delivery_date }
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || token !== HUB_SYNC_SECRET) {
    console.error('sendOrderConfirmation: unauthorized request');
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const { customer_email, order_number, products, total_price, assigned_delivery_date } = await req.json();

    if (!customer_email) {
      return Response.json({ error: 'Missing customer_email' }, { status: 400 });
    }

    const deliveryFormatted = assigned_delivery_date
      ? new Date(assigned_delivery_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : 'TBD';

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; color: #333; background: #f9f7f4; margin: 0; padding: 0; }
    .wrapper { max-width: 580px; margin: 40px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .header { background: #2d6a4f; padding: 32px 24px; text-align: center; }
    .header h1 { color: #fff; margin: 0; font-size: 22px; letter-spacing: 0.5px; }
    .header p { color: #b7e4c7; margin: 6px 0 0; font-size: 13px; }
    .body { padding: 28px 32px; }
    .body p { font-size: 15px; line-height: 1.6; margin: 0 0 16px; }
    .order-box { background: #f0faf4; border: 1px solid #b7e4c7; border-radius: 10px; padding: 20px 24px; margin: 20px 0; }
    .order-box .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #d8f3e6; font-size: 14px; }
    .order-box .row:last-child { border-bottom: none; font-weight: bold; font-size: 15px; }
    .order-box .label { color: #555; }
    .order-box .value { color: #1b4332; font-weight: 600; }
    .delivery-banner { background: #1b4332; color: #fff; border-radius: 8px; padding: 14px 20px; text-align: center; margin: 20px 0; font-size: 15px; }
    .delivery-banner strong { font-size: 17px; display: block; margin-top: 4px; }
    .footer { text-align: center; padding: 20px 24px; font-size: 12px; color: #999; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>✦ Order Confirmed!</h1>
      <p>Real. Living. Nutrition.</p>
    </div>
    <div class="body">
      <p>Hi there,</p>
      <p>Your NuVira order has been confirmed and is being prepared fresh for you. Here's a summary:</p>

      <div class="order-box">
        <div class="row">
          <span class="label">Order Number</span>
          <span class="value">${order_number || '—'}</span>
        </div>
        <div class="row">
          <span class="label">Items</span>
          <span class="value">${products || '—'}</span>
        </div>
        <div class="row">
          <span class="label">Total</span>
          <span class="value">$${typeof total_price === 'number' ? total_price.toFixed(2) : total_price || '0.00'}</span>
        </div>
      </div>

      <div class="delivery-banner">
        🚚 Scheduled Delivery
        <strong>${deliveryFormatted}</strong>
      </div>

      <p>We'll notify you when your order is on its way. Questions? Reply to this email or reach us at <a href="mailto:support@nuvirajuice.com" style="color:#2d6a4f;">support@nuvirajuice.com</a>.</p>
      <p style="margin-top:24px;">With love & greens,<br><strong>The NuVira Team 🌿</strong></p>
    </div>
    <div class="footer">
      &copy; 2026 NuVira Juice Company · Wentzville, MO
    </div>
  </div>
</body>
</html>`;

    await base44.integrations.Core.SendEmail({
      to: customer_email,
      subject: `Your NuVira Order ${order_number} is Confirmed! 🌿`,
      body: html,
      from_name: 'NuVira Juice Co.',
    });

    console.log(`sendOrderConfirmation: email sent to ${customer_email} for order ${order_number}`);
    return Response.json({ success: true });
  } catch (error) {
    console.error('sendOrderConfirmation error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});