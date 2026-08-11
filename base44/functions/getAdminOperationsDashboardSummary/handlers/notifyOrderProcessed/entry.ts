import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const INTERNAL_FROM = Deno.env.get('INTERNAL_EMAIL_FROM') || 'NuVira Juice Co <system@nuvirajuice.com>';
const INTERNAL_REPLY_TO = Deno.env.get('INTERNAL_EMAIL_REPLY_TO') || 'operations@nuvirajuice.com';
const OPERATIONS_EMAIL = 'operations@nuvirajuice.com';
const ADMIN_PUSH_INTERNAL_SECRET = Deno.env.get('ADMIN_PUSH_INTERNAL_SECRET')
  || Deno.env.get('HUB_SYNC_SECRET')
  || Deno.env.get('CUSTOMER_APP_SYNC_SECRET')
  || '';

type OrderNotificationItem = {
  title?: string;
  quantity?: number;
  price?: number;
};

type OrderNotificationPayload = {
  order_id?: string;
  order_number?: string;
  customer_email?: string;
  items?: OrderNotificationItem[];
  total?: number;
  delivery_address?: string;
};

type AdminPushSummary = {
  attempted: boolean;
  sent: boolean;
  skipped_reason: string | null;
  notification_created_count?: number;
  push_token_count?: number;
};

function adminPushEnabled() {
  return Deno.env.get('ENABLE_ADMIN_PUSH_NOTIFICATIONS') === 'true'
    && Deno.env.get('ENABLE_ADMIN_ORDER_PROCESSED_PUSH') === 'true';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown');
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function money(value: unknown): string {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

function operationsEmailKey(orderId?: string, orderNumber?: string): string {
  return `internal_order_processed_${String(orderId || orderNumber || 'unknown').slice(0, 180)}`;
}

async function existingOperationsEmail(base44: any, idempotencyKey: string) {
  const rows = await base44.asServiceRole.entities.CustomerMessageDeliveryLog.filter(
    { idempotency_key: idempotencyKey },
    '-created_date',
    5,
  ).catch(() => []);
  return rows.find((row: any) => ['sent', 'delivered'].includes(row?.status)) || null;
}

async function recordOperationsEmail(base44: any, payload: Record<string, any>) {
  try {
    await base44.asServiceRole.entities.CustomerMessageDeliveryLog.create(payload);
  } catch (error) {
    console.warn(`[notifyOrderProcessed] Delivery log write failed: ${errorMessage(error)}`);
  }
}

/**
 * Sends order processed notification to operations@nuvirajuice.com
 * Triggered by: stripeWebhook after order is confirmed
 * Payload: { order_id, order_number, customer_email, items, total, delivery_address }
 */
export default async (req: Request) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (caller.role !== 'admin' && caller.role !== 'owner') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { order_id, order_number, customer_email, items, total, delivery_address } = await req.json() as OrderNotificationPayload;
    if (!String(order_id || '').trim() && !String(order_number || '').trim()) {
      return Response.json({ error: 'order_id or order_number is required' }, { status: 400 });
    }
    const idempotencyKey = operationsEmailKey(order_id, order_number);

    const priorEmail = await existingOperationsEmail(base44, idempotencyKey);
    if (priorEmail) {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'duplicate_idempotency_key',
        existing_id: priorEmail.id,
      });
    }

    if (!RESEND_API_KEY) {
      console.error('notifyOrderProcessed: RESEND_API_KEY not set');
      return Response.json({ error: 'Email service not configured' }, { status: 500 });
    }

    // Format items list
    const itemsHtml = items?.map((item: OrderNotificationItem) => {
      const quantity = Number(item.quantity || 0);
      const price = Number(item.price || 0);
      return `<tr><td style="padding: 8px;">${escapeHtml(item.title || 'NuVira item')}</td><td style="padding: 8px;">x${quantity}</td><td style="padding: 8px;">$${money(price * quantity)}</td></tr>`;
    }).join('') || '';

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
      <h1>Order #${escapeHtml(order_number || order_id || 'pending')} Processed</h1>
    </div>
    
    <div class="content">
      <p><strong>Customer:</strong> ${escapeHtml(customer_email || 'Not provided')}</p>
      <p><strong>Delivery Address:</strong> ${escapeHtml(delivery_address || 'N/A')}</p>
      
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
          Total: $${money(total)}
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
        'Idempotency-Key': idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: INTERNAL_FROM,
        to: [OPERATIONS_EMAIL],
        reply_to: INTERNAL_REPLY_TO,
        subject: `Order #${order_number || order_id} Processed`,
        html,
        tags: [
          { name: 'category', value: 'internal_operations' },
          { name: 'event', value: 'order_processed' },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`notifyOrderProcessed: Resend API error - ${response.status}:`, error);
      return Response.json({ error: 'Failed to send email' }, { status: response.status });
    }

    const result = await response.json();
    await recordOperationsEmail(base44, {
      idempotency_key: idempotencyKey,
      channel: 'email',
      message_type: 'transactional_order',
      order_id: order_id || null,
      order_number: order_number || null,
      customer_email: OPERATIONS_EMAIL,
      provider: 'resend',
      provider_message_id: result?.id || null,
      status: 'sent',
      sent_at: new Date().toISOString(),
      metadata: {
        recipient_scope: 'internal_operations',
        source_function: 'notifyOrderProcessed',
      },
    });
    console.log(`Order processed notification sent to operations:`, result.id);

    let admin_push: AdminPushSummary = {
      attempted: false,
      sent: false,
      skipped_reason: 'admin_order_processed_push_disabled',
    };

    if (adminPushEnabled() && !ADMIN_PUSH_INTERNAL_SECRET) {
      admin_push = {
        attempted: false,
        sent: false,
        skipped_reason: 'admin_push_internal_secret_missing',
      };
    } else if (adminPushEnabled() && !order_id) {
      admin_push = {
        attempted: false,
        sent: false,
        skipped_reason: 'order_id_missing',
      };
    } else if (adminPushEnabled() && ADMIN_PUSH_INTERNAL_SECRET && order_id) {
      try {
        const pushResult = await base44.asServiceRole.functions.invoke('sendAdminOrderProcessedNotification', {
          order_id,
          order_number,
          customer_email,
          internal_secret: ADMIN_PUSH_INTERNAL_SECRET,
        });
        const data = pushResult?.data || pushResult || {};
        console.log(`[notifyOrderProcessed] Admin push result: ${JSON.stringify({
          success: Boolean(data.success),
          skipped: Boolean(data.skipped),
          push_attempted: Boolean(data.push_attempted),
          push_sent: Boolean(data.push_sent),
          push_token_count: Number(data.push_token_count || 0),
          push_skipped_reason: data.push_skipped_reason || data.reason || null,
        })}`);
        admin_push = {
          attempted: Boolean(data.push_attempted),
          sent: Boolean(data.push_sent),
          skipped_reason: data.push_skipped_reason || data.reason || null,
          notification_created_count: Number(data.notification_created_count || 0),
          push_token_count: Number(data.push_token_count || 0),
        };
      } catch (pushError) {
        const message = pushError instanceof Error ? pushError.message : String(pushError || 'unknown');
        console.warn(`[notifyOrderProcessed] Admin push skipped: ${message}`);
        admin_push = {
          attempted: true,
          sent: false,
          skipped_reason: 'admin_push_function_error',
        };
      }
    }

    return Response.json({ success: true, email_id: result.id, admin_push });
  } catch (error) {
    console.error('notifyOrderProcessed error:', errorMessage(error));
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
};
