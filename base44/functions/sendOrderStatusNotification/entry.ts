import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * sendOrderStatusNotification — triggered by order status changes to send in-app notifications.
 * 
 * Called by entity automation on Order update, or manually.
 * 
 * Payload: { order_id, new_status, customer_email, order_number }
 */

const STATUS_NOTIF_MAP = {
  scheduled_for_juicing: {
    subtype: 'production_reminder',
    title: 'Juicing Time 🌿',
    message: 'Your NuVira juices are being freshly prepared for your upcoming delivery.',
    deep_link: '/account/orders',
  },
  in_production: {
    subtype: 'production_reminder',
    title: "We're Juicing! 🍊",
    message: 'Your NuVira order is currently in production.',
    deep_link: '/account/orders',
  },
  out_for_delivery: {
    subtype: 'out_for_delivery',
    title: 'Out for Delivery 🚚',
    message: 'Your NuVira order is on its way. Keep an eye out for your driver.',
    deep_link: null, // will be set to order tracker
  },
  arriving_soon: {
    subtype: 'delivery_reminder',
    title: 'Almost There! 📍',
    message: 'Your NuVira delivery is arriving very soon.',
    deep_link: null,
  },
  delivered: {
    subtype: 'delivered',
    title: 'Delivered! 🎉',
    message: 'Your NuVira order has been delivered. Enjoy your fresh juices!',
    deep_link: '/account/orders',
  },
  ready_for_pickup: {
    subtype: 'delivery_reminder',
    title: 'Ready for Pickup 📦',
    message: 'Your NuVira order is ready for pickup!',
    deep_link: '/account/orders',
  },
};

const DELIVERY_STATUS_SUBTYPES = new Set([
  'out_for_delivery',
  'delivered',
]);

function envEnabled(name: string) {
  return Deno.env.get(name) === 'true';
}

function deliveryStatusNotificationsEnabled() {
  return envEnabled('ENABLE_CUSTOMER_DELIVERY_STATUS_NOTIFICATIONS');
}

function deliveredCustomerEmailEnabled() {
  return envEnabled('ENABLE_DELIVERED_CUSTOMER_EMAIL');
}

function deliveredProofDetailsEmailEnabled() {
  return envEnabled('ENABLE_DELIVERED_PROOF_DETAILS_IN_EMAIL');
}

function customerPushNotificationsEnabled() {
  return envEnabled('ENABLE_CUSTOMER_PUSH_NOTIFICATIONS');
}

function allowedDeliveryStatuses() {
  const configured = Deno.env.get('CUSTOMER_DELIVERY_STATUS_NOTIFICATION_STATUSES');
  const rawValues = configured ? configured.split(',') : ['out_for_delivery', 'delivered'];
  return new Set(
    rawValues
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isDeliveryStatus(status: string) {
  const notifConfig = STATUS_NOTIF_MAP[status];
  return Boolean(notifConfig && DELIVERY_STATUS_SUBTYPES.has(notifConfig.subtype));
}

function statusNotificationsEnabledFor(status: string) {
  if (envEnabled('ENABLE_ORDER_STATUS_NOTIFICATIONS')) return true;
  return deliveryStatusNotificationsEnabled() && isDeliveryStatus(status) && allowedDeliveryStatuses().has(status);
}

function maskEmail(email: string | null | undefined) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return null;
  const [local, domain] = email.split('@');
  const safeLocal = local.length <= 2 ? `${local[0] || '*'}***` : `${local.slice(0, 2)}***`;
  return `${safeLocal}@${domain}`;
}

async function deliveredEmailSent(base44: any, idempotencyKey: string) {
  if (!idempotencyKey) return false;
  try {
    const existing = await base44.asServiceRole.entities.CustomerMessageDeliveryLog.filter({
      idempotency_key: idempotencyKey,
    }, undefined, 5);
    return existing.some((row: any) => row?.status === 'sent');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown');
    console.warn(`[sendOrderStatusNotification] Delivered email log lookup failed: ${message}`);
    return false;
  }
}

async function recordDeliveredEmailLog(base44: any, {
  idempotencyKey,
  orderId,
  orderNumber,
  customerEmail,
  status,
  errorMessage = '',
}: Record<string, any>) {
  if (!idempotencyKey) return;
  try {
    await base44.asServiceRole.entities.CustomerMessageDeliveryLog.create({
      idempotency_key: idempotencyKey,
      channel: 'email',
      message_type: 'order_status',
      order_id: orderId || null,
      order_number: orderNumber || null,
      customer_email: customerEmail || null,
      provider: 'resend',
      status,
      error_message: errorMessage || null,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
      metadata: {
        notification_subtype: 'delivered',
        order_status: 'delivered',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown');
    console.warn(`[sendOrderStatusNotification] Delivered email log write failed: ${message}`);
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const bodyText = await req.text();
    let body = {};
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      return Response.json({ error: 'malformed_json' }, { status: 400 });
    }

    // Support entity automation payload format: { event, data, old_data, changed_fields }
    // AND direct call format: { order_id, new_status, customer_email, order_number }
    let order_id, new_status, customer_email, order_number;

    if (body.event?.type === 'update' && body.data) {
      // Entity automation
      order_id = body.event.entity_id || body.data.id;
      new_status = body.data.status;
      customer_email = body.data.customer_email;
      order_number = body.data.order_number;
    } else {
      order_id = body.order_id;
      new_status = body.new_status;
      customer_email = body.customer_email;
      order_number = body.order_number;
    }

    if (!order_id || !new_status) {
      return Response.json({ error: 'Missing order_id or new_status' }, { status: 400 });
    }

    const notifConfig = STATUS_NOTIF_MAP[new_status];
    if (!notifConfig) {
      return Response.json({ success: true, skipped: true, reason: `No notification configured for status: ${new_status}` });
    }

    const dryRun = body.dry_run === true || body.mode === 'dry_run';
    const enabledForStatus = statusNotificationsEnabledFor(new_status);

    if (!enabledForStatus && !dryRun) {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'order_status_notifications_disabled',
        message: 'Order status notifications are disabled by current delivery-notification gates.',
        status: new_status,
        delivery_status_notifications_enabled: deliveryStatusNotificationsEnabled(),
        delivery_status_allowed: isDeliveryStatus(new_status) && allowedDeliveryStatuses().has(new_status),
      });
    }

    // Fetch order if email not provided
    let email = customer_email;
    let orderNum = order_number;
    if (!email || !orderNum) {
      const orders = await base44.asServiceRole.entities.Order.filter({ id: order_id });
      const order = orders[0];
      if (!order) return Response.json({ error: 'order_not_found' }, { status: 404 });
      email = order.customer_email;
      orderNum = order.order_number;
    }

    // Build deep link for order tracker
    const deepLink = notifConfig.deep_link ?? `/order-tracker/${orderNum}`;
    const idempotencyKey = `order_status_${order_id}_${new_status}`;
    const deliveredEmailIdempotencyKey = new_status === 'delivered'
      ? `order_status_email_${order_id}_${new_status}`
      : null;
    const deliveredEmailAlreadySent = deliveredEmailIdempotencyKey
      ? await deliveredEmailSent(base44, deliveredEmailIdempotencyKey)
      : false;

    if (dryRun) {
      return Response.json({
        success: true,
        dry_run: true,
        status: new_status,
        order_number: orderNum || null,
        customer_email: maskEmail(email),
        notification_subtype: notifConfig.subtype,
        enabled_for_status: enabledForStatus,
        delivery_status_notifications_enabled: deliveryStatusNotificationsEnabled(),
        order_status_notifications_enabled: envEnabled('ENABLE_ORDER_STATUS_NOTIFICATIONS'),
        customer_push_notifications_enabled: customerPushNotificationsEnabled(),
        delivered_customer_email_enabled: deliveredCustomerEmailEnabled(),
        delivered_proof_details_email_enabled: deliveredProofDetailsEmailEnabled(),
        would_create_in_app_notification: enabledForStatus,
        would_attempt_push: enabledForStatus && customerPushNotificationsEnabled(),
        delivered_email_already_sent: deliveredEmailAlreadySent,
        delivered_email_idempotency_key: deliveredEmailIdempotencyKey,
        would_send_delivered_email: enabledForStatus &&
          new_status === 'delivered' &&
          deliveredCustomerEmailEnabled() &&
          !deliveredEmailAlreadySent,
        would_include_delivery_proof_details: enabledForStatus &&
          new_status === 'delivered' &&
          deliveredCustomerEmailEnabled() &&
          deliveredProofDetailsEmailEnabled(),
        idempotency_key: idempotencyKey,
        deep_link: deepLink,
      });
    }

    // Delegate to sendCustomerNotification (handles identity resolution, prefs, idempotency)
    const result = await base44.asServiceRole.functions.invoke('sendCustomerNotification', {
      customer_email: email,
      type: 'order_update',
      notification_subtype: notifConfig.subtype,
      title: notifConfig.title,
      message: notifConfig.message,
      order_id,
      deep_link: deepLink,
      idempotency_key: idempotencyKey,
    });

    console.log(`[sendOrderStatusNotification] Status "${new_status}" notif for order ${orderNum}: ${JSON.stringify(result.data)}`);

    const notifData = result?.data || result;
    const deliveredNotificationAlreadyExists =
      new_status === 'delivered' &&
      notifData?.skipped === true &&
      notifData?.reason === 'duplicate_idempotency_key';
    const deliveredNotificationCreated =
      new_status === 'delivered' &&
      notifData?.success === true &&
      notifData?.skipped !== true;

    // ── Delivery confirmation email ───────────────────────────────────────────
    if (new_status === 'delivered' && deliveredEmailAlreadySent) {
      console.log('[sendOrderStatusNotification] Delivered email already logged as sent; skipping duplicate');
    } else if (new_status === 'delivered' && deliveredNotificationAlreadyExists && !deliveredCustomerEmailEnabled()) {
      console.log('[sendOrderStatusNotification] Delivered email already sent; skipping duplicate');
    } else if (new_status === 'delivered' && !deliveredCustomerEmailEnabled()) {
      console.log('[sendOrderStatusNotification] Delivered email disabled; skipping');
    } else if (new_status === 'delivered' && !deliveredNotificationCreated && !deliveredNotificationAlreadyExists) {
      console.log('[sendOrderStatusNotification] Delivered notification was not created; skipping delivered email');
    } else if (new_status === 'delivered') {
      try {
        // Fetch full order for email details
        const orderRows = await base44.asServiceRole.entities.Order.filter({ id: order_id }, null, 1);
        const fullOrder = orderRows[0];

        if (fullOrder && email) {
          const deliveredAt = fullOrder.delivered_at
            ? new Date(fullOrder.delivered_at).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })
            : new Date().toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });

          const itemsHtml = (fullOrder.items || [])
            .map(i => `<div class="row"><span class="label">${i.title} ×${i.quantity}</span><span class="value">$${((i.price || 0) * (i.quantity || 1)).toFixed(2)}</span></div>`)
            .join('');

          // Proof/drop evidence is gated separately from delivered email status.
          // Keep delivered email status-only unless proof visibility is explicitly approved.
          const includeProofDetails = deliveredProofDetailsEmailEnabled();
          const dropLocationLine = includeProofDetails && fullOrder.delivery_drop_location
            ? `<div class="detail-row">📍 Left at: <strong>${fullOrder.delivery_drop_location}</strong></div>`
            : '';

          const photoLine = includeProofDetails && fullOrder.delivery_photo_url
            ? `<div style="margin-top:16px;"><p style="font-size:13px;color:#555;margin-bottom:8px;">Delivery photo:</p><img src="${fullOrder.delivery_photo_url}" alt="Delivery proof" style="width:100%;border-radius:8px;border:1px solid #d8f3e6;max-height:220px;object-fit:cover;" /></div>`
            : '';

          const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;color:#333;background:#f9f7f4;margin:0;padding:0;}
  .wrapper{max-width:580px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);}
  .header{background:#2d6a4f;padding:32px 24px;text-align:center;}
  .header h1{color:#fff;margin:0;font-size:22px;}
  .header p{color:#b7e4c7;margin:6px 0 0;font-size:13px;}
  .body{padding:28px 32px;}
  .body p{font-size:15px;line-height:1.6;margin:0 0 16px;}
  .order-box{background:#f0faf4;border:1px solid #b7e4c7;border-radius:10px;padding:20px 24px;margin:20px 0;}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #d8f3e6;font-size:14px;}
  .row:last-child{border-bottom:none;}
  .label{color:#555;}
  .value{color:#1b4332;font-weight:600;}
  .delivery-banner{background:#1b4332;color:#fff;border-radius:8px;padding:14px 20px;text-align:center;margin:20px 0;font-size:15px;}
  .delivery-banner strong{font-size:17px;display:block;margin-top:4px;}
  .detail-row{font-size:13px;color:#555;margin-top:8px;}
  .footer{text-align:center;padding:20px 24px;font-size:12px;color:#999;border-top:1px solid #eee;}
</style>
</head><body>
<div class="wrapper">
  <div class="header"><h1>🎉 Your Order Has Been Delivered!</h1><p>Real. Living. Nutrition.</p></div>
  <div class="body">
    <p>Hi there,</p>
    <p>Great news — your NuVira order <strong>#${orderNum}</strong> has been delivered. Enjoy your fresh juices!</p>
    <div class="order-box">
      <div class="row"><span class="label">Order</span><span class="value">#${orderNum}</span></div>
      ${itemsHtml}
      <div class="row"><span class="label">Total</span><span class="value">$${(fullOrder.total || 0).toFixed(2)}</span></div>
    </div>
    <div class="delivery-banner">✅ Delivered<strong>${deliveredAt} (CT)</strong></div>
    ${dropLocationLine}
    ${photoLine}
    <p style="margin-top:20px;">Questions or concerns? Reply to this email or reach us at <a href="mailto:support@nuvirajuice.com" style="color:#2d6a4f;">support@nuvirajuice.com</a>.</p>
    <p style="margin-top:24px;">With love & greens,<br><strong>The NuVira Team 🌿</strong></p>
  </div>
  <div class="footer">&copy; 2026 NuVira Juice Company · Wentzville, MO</div>
</div>
</body></html>`;

          await base44.asServiceRole.integrations.Core.SendEmail({
            to: email,
            subject: `Your NuVira order #${orderNum} has been delivered! 🎉`,
            body: html,
            from_name: 'NuVira Juice Co.',
          });
          await recordDeliveredEmailLog(base44, {
            idempotencyKey: deliveredEmailIdempotencyKey,
            orderId: order_id,
            orderNumber: orderNum,
            customerEmail: email,
            status: 'sent',
          });
          console.log(`[sendOrderStatusNotification] ✅ Delivery confirmation email sent to ${maskEmail(email)} for order ${orderNum}`);
        }
      } catch (emailErr) {
        const emailMessage = emailErr instanceof Error ? emailErr.message : String(emailErr || 'unknown');
        await recordDeliveredEmailLog(base44, {
          idempotencyKey: deliveredEmailIdempotencyKey,
          orderId: order_id,
          orderNumber: orderNum,
          customerEmail: email,
          status: 'failed',
          errorMessage: emailMessage,
        });
        console.error(`[sendOrderStatusNotification] ❌ Delivery email failed: ${emailMessage}`);
      }
    }

    return Response.json({ success: true, order_number: orderNum, status: new_status });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown');
    console.error('[sendOrderStatusNotification] Error:', message);
    return Response.json({ error: 'order_status_notification_failed' }, { status: 500 });
  }
});
