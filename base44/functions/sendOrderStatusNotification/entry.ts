import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { handleElevatedTransactionalAction } from './elevatedTransactionalCommunications.ts';
import { buildOrderCommunicationCopy } from './orderCommunicationPolicy.js';
import { buildOrderEmailHtml } from './orderEmailTemplate.js';

/**
 * sendOrderStatusNotification — triggered by order status changes to send in-app notifications.
 * 
 * Called by entity automation on Order update, or manually.
 * 
 * Payload: { order_id, new_status, customer_email, order_number }
 */

const STATUS_NOTIF_MAP: Record<string, any> = {
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
  delayed: {
    subtype: 'order_delayed',
    title: 'A Timing Update for Your Order',
    message: 'Your NuVira order is taking a little longer than planned. Open the app for the latest timing.',
    deep_link: null,
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
    title: 'Your Order Is Ready 📦',
    message: 'Your NuVira order is ready!',
    deep_link: '/account/orders',
  },
  cancelled: {
    subtype: 'order_cancelled',
    title: 'Your Order Was Cancelled',
    message: 'Your NuVira order has been cancelled. Open the app for details or support.',
    deep_link: '/account/orders',
  },
  canceled: {
    subtype: 'order_cancelled',
    title: 'Your Order Was Cancelled',
    message: 'Your NuVira order has been cancelled. Open the app for details or support.',
    deep_link: '/account/orders',
  },
  refunded: {
    subtype: 'order_refunded',
    title: 'Your Refund Was Processed',
    message: 'Your NuVira refund has been processed. Your bank’s posting time may vary.',
    deep_link: '/account/orders',
  },
  partially_refunded: {
    subtype: 'order_refunded',
    title: 'Your Refund Was Processed',
    message: 'Your NuVira refund has been processed. Your bank’s posting time may vary.',
    deep_link: '/account/orders',
  },
  payment_failed: {
    subtype: 'order_payment_failed',
    title: 'Payment Needs Attention',
    message: 'We could not complete your payment. Open NuVira to review your order.',
    deep_link: '/account/orders',
  },
};

const ELEVATED_EVENT_MAP: Record<string, string> = {
  scheduled_for_juicing: 'scheduled_for_juicing',
  in_production: 'in_production',
  ready_for_pickup: 'ready_for_pickup',
  out_for_delivery: 'out_for_delivery',
  arriving_soon: 'arriving_soon',
  delivered: 'delivered',
  delayed: 'delayed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  refunded: 'refunded',
  partially_refunded: 'refunded',
  payment_failed: 'payment_failed',
};

const DELIVERY_STATUS_SUBTYPES = new Set([
  'out_for_delivery',
  'delivered',
]);

function envEnabled(name: string) {
  return Deno.env.get(name) === 'true';
}

function transactionalMode() {
  const mode = String(Deno.env.get('TRANSACTIONAL_COMMUNICATIONS_MODE') || '').trim().toLowerCase();
  return mode === 'test' || mode === 'production' ? mode : 'disabled';
}

function elevatedTransactionalEnabled() {
  return envEnabled('ENABLE_ELEVATED_TRANSACTIONAL_COMMUNICATIONS')
    && Deno.env.get('TRANSACTIONAL_COMMUNICATIONS_KILL_SWITCH') === 'false'
    && transactionalMode() !== 'disabled';
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

function orderContainsProgram(order: Record<string, any> | null | undefined) {
  return (Array.isArray(order?.items) ? order.items : []).some((item: Record<string, any>) => {
    const productId = String(item?.product_id || item?.id || '').trim().toLowerCase();
    const title = String(item?.title || item?.name || '').trim().toLowerCase();
    return /^program[_-](radiance|hydration|reset)(?:[_-](?:2|3)day)?$/.test(productId)
      || /(radiance|hydration|reset) program/.test(title);
  });
}

async function deliveredEmailSent(base44: any, idempotencyKey: string) {
  if (!idempotencyKey) return false;
  try {
    const existing = await base44.asServiceRole.entities.CustomerMessageDeliveryLog.filter({
      idempotency_key: idempotencyKey,
    }, undefined, 5);
    return existing.some((row: any) => ['sent', 'delivered'].includes(row?.status));
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
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (caller.role !== 'admin' && caller.role !== 'owner') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const bodyText = await req.text();
    let body: Record<string, any> = {};
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      return Response.json({ error: 'malformed_json' }, { status: 400 });
    }

    const scheduledArgs = body?.args && typeof body.args === 'object' ? body.args : {};
    const elevatedActionBody = scheduledArgs.action === 'elevated_scheduled_sweep'
      ? {
        ...scheduledArgs,
        internal_token: Deno.env.get('TRANSACTIONAL_COMMUNICATIONS_INTERNAL_TOKEN') || '',
        source: 'base44_scheduled_automation',
      }
      : body;
    const elevatedActionResponse = await handleElevatedTransactionalAction(base44, elevatedActionBody);
    if (elevatedActionResponse) return elevatedActionResponse;

    // Support entity automation payload format: { event, data, old_data, changed_fields }
    // AND direct call format: { order_id, new_status, customer_email, order_number }
    let order_id, new_status, customer_email, order_number, source_event_id;

    const entityUpdate = body.event?.type === 'update' && body.data;
    if (entityUpdate) {
      // Entity automation
      order_id = body.event.entity_id || body.data.id;
      new_status = body.data.status;
      customer_email = body.data.customer_email;
      order_number = body.data.order_number;
      source_event_id = body.event.id || body.data.updated_date || body.data.updated_at;
    } else {
      order_id = body.order_id;
      new_status = body.new_status;
      customer_email = body.customer_email;
      order_number = body.order_number;
      source_event_id = body.event_id || body.status_changed_at || body.updated_at;
    }

    if (!order_id || !new_status) {
      return Response.json({ error: 'Missing order_id or new_status' }, { status: 400 });
    }

    if (entityUpdate) {
      const changedFields = Array.isArray(body.changed_fields) ? body.changed_fields.map(String) : [];
      const priorStatus = String(body.old_data?.status || '').trim();
      if ((changedFields.length > 0 && !changedFields.includes('status')) || (priorStatus && priorStatus === String(new_status))) {
        return Response.json({ success: true, skipped: true, reason: 'order_status_unchanged' });
      }
    }

    const notifConfig = STATUS_NOTIF_MAP[new_status];
    if (!notifConfig) {
      return Response.json({ success: true, skipped: true, reason: `No notification configured for status: ${new_status}` });
    }

    if (elevatedTransactionalEnabled()) {
      const event = ELEVATED_EVENT_MAP[new_status];
      if (!event) {
        return Response.json({ success: true, skipped: true, reason: `No elevated communication configured for status: ${new_status}` });
      }
      const elevatedResponse = await handleElevatedTransactionalAction(base44, {
        action: 'elevated_deliver_event',
        internal_token: Deno.env.get('TRANSACTIONAL_COMMUNICATIONS_INTERNAL_TOKEN') || '',
        order_id,
        event,
        event_id: source_event_id || `order_status:${order_id}:${event}`,
        refund_amount: Number(body.refund_amount || 0),
        delivery_date_label: body.delivery_date_label || body.assigned_delivery_date || null,
        delivery_window_label: body.delivery_window_label || null,
        source: 'sendOrderStatusNotification',
      });
      return elevatedResponse || Response.json({ error: 'elevated_transactional_handler_unavailable' }, { status: 500 });
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

    // Fetch the full order when identity fields or delivered-program routing need it.
    let email = customer_email;
    let orderNum = order_number;
    let fullOrderForRouting = entityUpdate && Array.isArray(body.data?.items) ? body.data : null;
    if (!email || !orderNum || (new_status === 'delivered' && !fullOrderForRouting)) {
      const orders = await base44.asServiceRole.entities.Order.filter({ id: order_id });
      const order = orders[0];
      if (!order) return Response.json({ error: 'order_not_found' }, { status: 404 });
      email = order.customer_email;
      orderNum = order.order_number;
      fullOrderForRouting = order;
    }

    // Build deep link for order tracker
    const deepLink = new_status === 'delivered' && orderContainsProgram(fullOrderForRouting)
      ? '/account/programs'
      : notifConfig.deep_link ?? `/order-tracker/${orderNum}`;
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
        const orderRows = await base44.asServiceRole.entities.Order.filter({ id: order_id }, undefined, 1);
        const fullOrder = orderRows[0];

        if (fullOrder && email) {
          // Use the same escaped, responsive template as the primary elevated
          // transactional path. This fallback intentionally stays status-only;
          // proof photos and drop-location details are never interpolated here.
          const copy = buildOrderCommunicationCopy('delivered', {
            ...fullOrder,
            order_number: orderNum,
          });
          const returnTo = `/order-tracker/${encodeURIComponent(orderNum)}`;
          const actionUrl = `https://www.nuvirajuice.com/native-login?return_to=${encodeURIComponent(returnTo)}`;
          const html = buildOrderEmailHtml({
            copy,
            order: { ...fullOrder, order_number: orderNum },
            actionUrl,
          });

          await base44.asServiceRole.integrations.Core.SendEmail({
            to: email,
            subject: copy.subject,
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
