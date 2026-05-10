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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

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

    // Fetch order if email not provided
    let email = customer_email;
    let orderNum = order_number;
    if (!email || !orderNum) {
      const orders = await base44.asServiceRole.entities.Order.filter({ id: order_id });
      const order = orders[0];
      if (!order) return Response.json({ error: `Order ${order_id} not found` }, { status: 404 });
      email = order.customer_email;
      orderNum = order.order_number;
    }

    // Build deep link for order tracker
    const deepLink = notifConfig.deep_link ?? `/order-tracker/${orderNum}`;

    // Delegate to sendCustomerNotification (handles identity resolution, prefs, idempotency)
    const result = await base44.asServiceRole.functions.invoke('sendCustomerNotification', {
      customer_email: email,
      type: 'order_update',
      notification_subtype: notifConfig.subtype,
      title: notifConfig.title,
      message: notifConfig.message,
      order_id,
      deep_link: deepLink,
      idempotency_key: `order_status_${order_id}_${new_status}`,
    });

    console.log(`[sendOrderStatusNotification] Status "${new_status}" notif for order ${orderNum}: ${JSON.stringify(result.data)}`);
    return Response.json({ success: true, order_number: orderNum, status: new_status });

  } catch (error) {
    console.error('[sendOrderStatusNotification] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});