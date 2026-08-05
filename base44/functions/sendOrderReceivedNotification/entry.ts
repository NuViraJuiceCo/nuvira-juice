import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const APP_ORIGIN = 'https://www.nuvirajuice.com';

function cleanText(value, max = 500) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function escapeHtml(value) {
  return cleanText(value, 4000)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

function customerFirstName(value) {
  return cleanText(value, 160).split(/\s+/).filter(Boolean)[0] || 'there';
}

function orderTrackerUrl(orderNumber) {
  const returnTo = `/order-tracker/${encodeURIComponent(cleanText(orderNumber, 120))}`;
  return `${APP_ORIGIN}/native-login?return_to=${encodeURIComponent(returnTo)}`;
}

function buildOrderConfirmationEmailKey(orderId, orderNumber) {
  if (orderId) return `order_confirmation_email_${orderId}`;
  if (orderNumber) return `order_confirmation_email_${orderNumber}`;
  return null;
}

async function createDeliveryLog(base44, payload) {
  try {
    await base44.asServiceRole.entities.CustomerMessageDeliveryLog.create(payload);
  } catch (error) {
    console.warn(`sendOrderReceivedNotification: delivery log write failed: ${error.message}`);
  }
}

async function findSentDeliveryLog(base44, idempotencyKey) {
  try {
    const existingSentLogs = await base44.asServiceRole.entities.CustomerMessageDeliveryLog.filter({
      idempotency_key: idempotencyKey,
    }, '-created_date', 5);
    return existingSentLogs.find((row) => ['sent', 'delivered'].includes(row?.status)) || null;
  } catch (error) {
    console.warn(`sendOrderReceivedNotification: delivery log lookup failed: ${error.message}`);
    return null;
  }
}

/**
 * Sends order confirmation email to customer via Resend
 * Triggered by: stripeWebhook after checkout.session.completed
 * Payload: { order_id, customer_email, order_number, items, total, delivery_address, estimated_delivery_date }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (caller.role !== 'admin' && caller.role !== 'owner') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { order_id, customer_email, customer_name, order_number, items, total, delivery_address, estimated_delivery_date, assigned_delivery_date, delivery_window_label, refund_notification } = await req.json();
    const idempotencyKey = buildOrderConfirmationEmailKey(order_id, order_number);
    const safeOrderNumber = cleanText(order_number || order_id, 120) || 'your order';

    // Transactional policy: this function is only approved for order
    // confirmations. Refund/cancel notifications need a separately audited
    // template and idempotency key so a refund can never send confirmation copy.
    if (refund_notification === true) {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'refund_customer_email_disabled',
        message: 'Refund customer emails are disabled until the refund notification template is separately approved.',
      }, { status: 409 });
    }

    if (!customer_email) {
      return Response.json({ error: 'Missing customer_email' }, { status: 400 });
    }

    if (!RESEND_API_KEY) {
      console.error('sendOrderReceivedNotification: RESEND_API_KEY not set');
      return Response.json({ error: 'Email service not configured' }, { status: 500 });
    }

    if (idempotencyKey) {
      const existingSentLog = await findSentDeliveryLog(base44, idempotencyKey);

      if (existingSentLog) {
        console.log(`sendOrderReceivedNotification: duplicate email delivery skipped for key ${idempotencyKey}`);
        return Response.json({
          success: true,
          skipped: true,
          reason: 'duplicate_idempotency_key',
          existing_id: existingSentLog.id,
        });
      }
    }

    // Format items list
    const itemsHtml = (Array.isArray(items) ? items : []).slice(0, 40).map(item => {
      const quantity = Math.max(1, Number(item?.quantity || 1));
      const price = Number(item?.price || 0);
      return `<tr><td style="padding: 8px;">${escapeHtml(item?.title || item?.name || 'NuVira item')}</td><td style="padding: 8px;">x${quantity}</td><td style="padding: 8px;">$${money(price * quantity)}</td></tr>`;
    }).join('');

    // Format delivery date safely — prefer assigned_delivery_date, fall back to estimated_delivery_date
    const deliveryDateStr = assigned_delivery_date || estimated_delivery_date || null;
    const windowLabel = cleanText(delivery_window_label, 120).replace(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+/i, '') || '5 PM – 8 PM';
    let deliveryDateHtml = '';
    if (deliveryDateStr) {
      try {
        const rawDeliveryDate = cleanText(deliveryDateStr, 120);
        const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDeliveryDate)
          ? new Date(`${rawDeliveryDate}T12:00:00`)
          : new Date(rawDeliveryDate);
        if (!isNaN(date.getTime())) {
          const formatted = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Chicago',
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          }).format(date);
          deliveryDateHtml = `<p><strong>Estimated Delivery:</strong> ${formatted}, ${windowLabel} Central Time</p>`;
        } else {
          deliveryDateHtml = `<p><strong>Estimated Delivery:</strong> Delivery date pending confirmation.</p>`;
        }
      } catch {
        deliveryDateHtml = `<p><strong>Estimated Delivery:</strong> Delivery date pending confirmation.</p>`;
      }
    } else {
      deliveryDateHtml = `<p><strong>Estimated Delivery:</strong> Delivery date pending confirmation.</p>`;
    }

    const trackingUrl = orderTrackerUrl(safeOrderNumber);
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
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
    .button { display: inline-block; padding: 12px 24px; background: #2d6a4f; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
  </style>
</head>
<body>
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your NuVira order is confirmed.</div>
  <div class="container">
    <div class="header">
      <h1>Order Confirmed!</h1>
    </div>
    
    <div class="content">
      <p>Hi ${escapeHtml(customerFirstName(customer_name))},</p>
      <p>Thanks for your order! We're excited to prepare your fresh juices.</p>
      
      <div class="order-details">
        <h2>Order #${escapeHtml(safeOrderNumber)}</h2>
        <p><strong>Status:</strong> Order confirmed</p>
        ${deliveryDateHtml}
        ${delivery_address ? `<p><strong>Delivery Address:</strong> ${escapeHtml(delivery_address)}</p>` : ''}
      </div>

      <h3>Order Summary</h3>
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
        Total: $${money(total)}
      </div>

      <p>Track your order anytime in your account dashboard.</p>
      <p style="text-align:center;"><a class="button" href="${escapeHtml(trackingUrl)}">View My Order</a></p>
      
      <p>Questions? Reply to this email or contact <a href="mailto:support@nuvirajuice.com">support@nuvirajuice.com</a>.</p>
      <p>Real. Living. Nutrition.<br>NuVira Juice Co.</p>
    </div>

    <div class="footer">
      <p>&copy; 2026 NuVira Juice Company. All rights reserved.<br>619 N. Main St., O'Fallon, MO 63366</p>
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
        to: customer_email,
        subject: `Your Order #${safeOrderNumber} is Confirmed!`,
        html,
      }),
    });

    if (!response.ok) {
      const errorMessage = `Resend API error ${response.status}`;
      console.error(`sendOrderReceivedNotification: ${errorMessage}`);
      if (idempotencyKey) {
        await createDeliveryLog(base44, {
          idempotency_key: idempotencyKey,
          channel: 'email',
          message_type: 'order_confirmation',
          order_id: order_id || null,
          order_number: order_number || null,
          customer_email,
          provider: 'resend',
          status: 'failed',
          error_message: errorMessage,
          metadata: {
            source_function: 'sendOrderReceivedNotification',
          },
        });
      }
      return Response.json({ error: 'Failed to send email' }, { status: response.status });
    }

    const result = await response.json();
    if (idempotencyKey) {
      await createDeliveryLog(base44, {
        idempotency_key: idempotencyKey,
        channel: 'email',
        message_type: 'order_confirmation',
        order_id: order_id || null,
        order_number: order_number || null,
        customer_email,
        provider: 'resend',
        provider_message_id: result?.id || null,
        status: 'sent',
        sent_at: new Date().toISOString(),
        metadata: {
          source_function: 'sendOrderReceivedNotification',
          delivery_date: assigned_delivery_date || estimated_delivery_date || null,
          delivery_window_label: delivery_window_label || null,
        },
      });
    }
    console.log(`Order confirmation email sent to ${customer_email}:`, result.id);
    return Response.json({ success: true, email_id: result.id });
  } catch (error) {
    console.error('sendOrderReceivedNotification error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
