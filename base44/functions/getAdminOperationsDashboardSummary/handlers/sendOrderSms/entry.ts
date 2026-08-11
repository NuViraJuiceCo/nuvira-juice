import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SENDBLUE_API_KEY = Deno.env.get('SENDBLUE_API_KEY');
const SENDBLUE_API_SECRET = Deno.env.get('SENDBLUE_API_SECRET');
const SENDBLUE_PHONE_NUMBER = Deno.env.get('SENDBLUE_PHONE_NUMBER');

function normalizeE164(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return '';
}

function hasInternalAuth(req) {
  const presented = (req.headers.get('x-internal-secret') || '').trim();
  const allowed = [
    Deno.env.get('CUSTOMER_APP_SYNC_SECRET'),
    Deno.env.get('HUB_SYNC_SECRET'),
  ].map(value => (value || '').trim()).filter(Boolean);
  return Boolean(presented && allowed.includes(presented));
}

function safeProviderError(raw, status) {
  const compact = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 600);
  try {
    const parsed = JSON.parse(compact || '{}');
    return {
      code: String(parsed?.error_code || parsed?.code || `http_${status}`).slice(0, 100),
      message: String(parsed?.error_message || parsed?.message || parsed?.error || `SendBlue HTTP ${status}`).replace(/\s+/g, ' ').slice(0, 500),
    };
  } catch {
    return { code: `http_${status}`, message: compact || `SendBlue HTTP ${status}` };
  }
}

function buildOrderConfirmationSmsKey(orderId, orderNumber) {
  if (orderId) return `order_confirmation_sms_${orderId}`;
  if (orderNumber) return `order_confirmation_sms_${orderNumber}`;
  return null;
}

async function createDeliveryLog(base44, payload) {
  try {
    const rows = await base44.asServiceRole.entities.CustomerMessageDeliveryLog.filter({ idempotency_key: payload.idempotency_key }, '-created_date', 1);
    if (rows[0]) await base44.asServiceRole.entities.CustomerMessageDeliveryLog.update(rows[0].id, payload);
    else await base44.asServiceRole.entities.CustomerMessageDeliveryLog.create(payload);
  } catch (error) {
    console.warn(`sendOrderSms: delivery log write failed: ${error.message}`);
  }
}

async function findSentDeliveryLog(base44, idempotencyKey) {
  try {
    const existingLogs = await base44.asServiceRole.entities.CustomerMessageDeliveryLog.filter({
      idempotency_key: idempotencyKey,
    }, '-created_date', 3);
    return existingLogs.find(row => ['sent', 'delivered'].includes(row?.status)) || null;
  } catch (error) {
    console.warn(`sendOrderSms: delivery log lookup failed: ${error.message}`);
    return null;
  }
}

/**
 * Sends an order confirmation SMS via SendBlue (iMessage/SMS)
 * Payload: { order_id, phone_number, order_number, items, total, estimated_delivery_date }
 */
export default async (req: Request) => {
  try {
    const base44 = createClientFromRequest(req);
    const internal = hasInternalAuth(req);
    const caller = internal ? null : await base44.auth.me().catch(() => null);
    if (!internal && !caller) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!internal && caller.role !== 'admin' && caller.role !== 'owner') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { order_id, phone_number, order_number, items, total, estimated_delivery_date, assigned_delivery_date, delivery_window_label } = await req.json();
    const idempotencyKey = buildOrderConfirmationSmsKey(order_id, order_number);

    const recipientNumber = normalizeE164(phone_number);
    const senderNumber = normalizeE164(SENDBLUE_PHONE_NUMBER);
    if (!recipientNumber) return Response.json({ error: 'valid_e164_phone_number_required' }, { status: 400 });

    if (!SENDBLUE_API_KEY || !SENDBLUE_API_SECRET || !senderNumber) {
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

    const message = `🌿 NuVira Order Confirmed!\n\nOrder #${order_number}\n\n${itemList}${totalLine}${deliveryLine}\n\nWe'll keep you updated as your juice is freshly pressed. Questions? Reply here or email support@nuvirajuice.com 💚`;

    const response = await fetch('https://api.sendblue.com/api/send-message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'sb-api-key-id': SENDBLUE_API_KEY,
        'sb-api-secret-key': SENDBLUE_API_SECRET,
      },
      body: JSON.stringify({
        number: recipientNumber,
        from_number: senderNumber,
        content: message,
        send_style: 'default',
      }),
    });

    if (!response.ok) {
      const providerError = safeProviderError(await response.text(), response.status);
      const errorMessage = `${providerError.code}: ${providerError.message}`;
      console.error(`sendOrderSms: provider rejected message (${response.status}) code=${providerError.code}`);
      if (idempotencyKey) {
        await createDeliveryLog(base44, {
          idempotency_key: idempotencyKey,
          channel: 'sms',
          message_type: 'order_confirmation',
          order_id: order_id || null,
          order_number: order_number || null,
          customer_phone: recipientNumber,
          provider: 'sendblue',
          status: 'failed',
          error_message: errorMessage,
          metadata: {
            source_function: 'sendOrderSms',
            provider_http_status: response.status,
            provider_error_code: providerError.code,
          },
        });
      }
      return Response.json({ error: 'Failed to send SMS' }, { status: response.status });
    }

    const result = await response.json();
    if (Number(result?.error_code || 0) !== 0) {
      const providerError = safeProviderError(JSON.stringify(result), response.status);
      if (idempotencyKey) {
        await createDeliveryLog(base44, {
          idempotency_key: idempotencyKey,
          channel: 'sms',
          message_type: 'order_confirmation',
          order_id: order_id || null,
          order_number: order_number || null,
          customer_phone: recipientNumber,
          provider: 'sendblue',
          status: 'failed',
          error_message: `${providerError.code}: ${providerError.message}`,
          metadata: { source_function: 'sendOrderSms', provider_error_code: providerError.code },
        });
      }
      return Response.json({ error: 'Failed to send SMS', provider_error_code: providerError.code }, { status: 502 });
    }
    if (idempotencyKey) {
      await createDeliveryLog(base44, {
        idempotency_key: idempotencyKey,
        channel: 'sms',
        message_type: 'order_confirmation',
        order_id: order_id || null,
        order_number: order_number || null,
          customer_phone: recipientNumber,
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
    console.log(`Order SMS sent successfully:`, result.message_handle || result.message_id || result.status);
    return Response.json({ success: true, message_id: result.message_handle || result.message_id });
  } catch (error) {
    console.error('sendOrderSms error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
};
