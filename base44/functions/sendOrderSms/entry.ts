import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SENDBLUE_API_KEY = Deno.env.get('SENDBLUE_API_KEY');
const SENDBLUE_API_SECRET = Deno.env.get('SENDBLUE_API_SECRET');
const SENDBLUE_PHONE_NUMBER = Deno.env.get('SENDBLUE_PHONE_NUMBER');

function buildOrderConfirmationSmsKey(orderId, orderNumber) {
  if (orderId) return `order_confirmation_sms_${orderId}`;
  if (orderNumber) return `order_confirmation_sms_${orderNumber}`;
  return null;
}

async function createDeliveryLog(base44, payload) {
  try {
    await base44.asServiceRole.entities.CustomerMessageDeliveryLog.create(payload);
  } catch (error) {
    console.warn(`sendOrderSms: delivery log write failed: ${error.message}`);
  }
}

async function findSentDeliveryLog(base44, idempotencyKey) {
  try {
    const existingSentLogs = await base44.asServiceRole.entities.CustomerMessageDeliveryLog.filter({
      idempotency_key: idempotencyKey,
      status: 'sent',
    }, '-created_date', 1);
    return existingSentLogs[0] || null;
  } catch (error) {
    console.warn(`sendOrderSms: delivery log lookup failed: ${error.message}`);
    return null;
  }
}

/**
 * Sends an order confirmation SMS via SendBlue (iMessage/SMS)
 * Payload: { order_id, phone_number, order_number, items, total, estimated_delivery_date }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { order_id, phone_number, order_number, items, total, estimated_delivery_date, assigned_delivery_date, delivery_window_label } = await req.json();
    const idempotencyKey = buildOrderConfirmationSmsKey(order_id, order_number);

    if (!phone_number) {
      return Response.json({ error: 'Missing phone_number' }, { status: 400 });
    }

    if (!SENDBLUE_API_KEY || !SENDBLUE_API_SECRET) {
      console.error('sendOrderSms: SendBlue credentials not set');
      return Response.json({ error: 'SMS service not configured' }, { status: 500 });
    }

    if (idempotencyKey) {
      const existingSentLog = await findSentDeliveryLog(base44, idempotencyKey);

      if (existingSentLog) {
        console.log(`sendOrderSms: duplicate SMS delivery skipped for key ${idempotencyKey}`);
        return Response.json({
          success: true,
          skipped: true,
          reason: 'duplicate_idempotency_key',
          existing_id: existingSentLog.id,
        });
      }
    }

    // Format item list
    const itemList = items?.map(i => `• ${i.title} x${i.quantity}`).join('\n') || '';

    // Resolve total safely — never render NaN
    const resolvedTotal = typeof total === 'number' && !isNaN(total) ? total : null;
    const totalLine = resolvedTotal !== null ? `\nTotal: $${resolvedTotal.toFixed(2)}` : '';

    // Resolve delivery date — prefer assigned_delivery_date
    const deliveryDateStr = assigned_delivery_date || estimated_delivery_date || null;
    const windowLabel = delivery_window_label || '5 PM – 8 PM';
    let deliveryLine = '';
    if (deliveryDateStr) {
      try {
        const date = new Date(deliveryDateStr + 'T12:00:00');
        if (!isNaN(date.getTime())) {
          const formatted = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
          deliveryLine = `\n📅 Delivery: ${formatted}, ${windowLabel}`;
        }
      } catch { /* omit if invalid */ }
    }

    const message = `🌿 NuVira Order Confirmed!\n\nOrder #${order_number}\n\n${itemList}${totalLine}${deliveryLine}\n\nWe'll keep you updated as your juice is freshly pressed. Questions? Reply here or email info@nuvirajuice.com 💚`;

    const response = await fetch('https://api.sendblue.com/api/send-message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'sb-api-key-id': SENDBLUE_API_KEY,
        'sb-api-secret-key': SENDBLUE_API_SECRET,
      },
      body: JSON.stringify({
        number: phone_number,
        from_number: SENDBLUE_PHONE_NUMBER,
        content: message,
        send_style: 'default',
      }),
    });

    if (!response.ok) {
      const errorMessage = `SendBlue API error ${response.status}`;
      console.error(`sendOrderSms: ${errorMessage}`);
      if (idempotencyKey) {
        await createDeliveryLog(base44, {
          idempotency_key: idempotencyKey,
          channel: 'sms',
          message_type: 'order_confirmation',
          order_id: order_id || null,
          order_number: order_number || null,
          customer_phone: phone_number,
          provider: 'sendblue',
          status: 'failed',
          error_message: errorMessage,
          metadata: {
            source_function: 'sendOrderSms',
          },
        });
      }
      return Response.json({ error: 'Failed to send SMS' }, { status: response.status });
    }

    const result = await response.json();
    if (idempotencyKey) {
      await createDeliveryLog(base44, {
        idempotency_key: idempotencyKey,
        channel: 'sms',
        message_type: 'order_confirmation',
        order_id: order_id || null,
        order_number: order_number || null,
        customer_phone: phone_number,
        provider: 'sendblue',
        provider_message_id: result?.message_id || null,
        status: 'sent',
        sent_at: new Date().toISOString(),
        metadata: {
          source_function: 'sendOrderSms',
          provider_status: result?.status || null,
          delivery_date: assigned_delivery_date || estimated_delivery_date || null,
          delivery_window_label: delivery_window_label || null,
        },
      });
    }
    console.log(`Order SMS sent to ${phone_number}:`, result.message_id || result.status);
    return Response.json({ success: true, message_id: result.message_id });
  } catch (error) {
    console.error('sendOrderSms error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
