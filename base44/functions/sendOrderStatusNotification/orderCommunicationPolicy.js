export const ORDER_COMMUNICATION_POLICY_VERSION = '2026-08-02.v1';

export const ORDER_EVENT_ALIASES = Object.freeze({
  confirmed: 'order_confirmed',
  order_received: 'order_confirmed',
  scheduled: 'scheduled_for_juicing',
  preparing: 'in_production',
  fulfilled: 'delivered',
  canceled: 'cancelled',
  refund: 'refunded',
  payment_failure: 'payment_failed',
});

export const ORDER_COMMUNICATION_POLICY = Object.freeze({
  order_confirmed: Object.freeze({
    label: 'Order confirmed',
    email: 'always',
    push: 'never',
    in_app: true,
    preference: 'order_updates',
    quiet_hours: false,
    priority: 'normal',
    notification_subtype: 'order_confirmation',
  }),
  scheduled_for_juicing: Object.freeze({
    label: 'Scheduled for juicing',
    email: 'never',
    push: 'always',
    in_app: true,
    preference: 'production_reminders',
    quiet_hours: true,
    minimum_delay_minutes: 30,
    priority: 'normal',
    notification_subtype: 'scheduled_for_juicing',
  }),
  in_production: Object.freeze({
    label: 'In production',
    email: 'never',
    push: 'always',
    in_app: true,
    preference: 'production_reminders',
    quiet_hours: true,
    priority: 'normal',
    notification_subtype: 'in_production',
  }),
  ready_for_pickup: Object.freeze({
    label: 'Ready for pickup',
    email: 'fallback',
    push: 'always',
    in_app: true,
    preference: 'delivery_updates',
    quiet_hours: false,
    priority: 'high',
    notification_subtype: 'ready_for_pickup',
  }),
  out_for_delivery: Object.freeze({
    label: 'Out for delivery',
    email: 'fallback',
    push: 'always',
    in_app: true,
    preference: 'delivery_updates',
    quiet_hours: false,
    priority: 'high',
    notification_subtype: 'out_for_delivery',
  }),
  arriving_soon: Object.freeze({
    label: 'Arriving soon',
    email: 'never',
    push: 'always',
    in_app: true,
    preference: 'delivery_updates',
    quiet_hours: false,
    priority: 'high',
    notification_subtype: 'arriving_soon',
  }),
  delivered: Object.freeze({
    label: 'Delivered',
    email: 'always',
    push: 'always',
    in_app: true,
    preference: 'delivery_updates',
    quiet_hours: false,
    priority: 'high',
    notification_subtype: 'delivered',
  }),
  schedule_changed: Object.freeze({
    label: 'Schedule changed',
    email: 'always',
    push: 'always',
    in_app: true,
    preference: 'order_updates',
    quiet_hours: false,
    priority: 'high',
    notification_subtype: 'schedule_changed',
  }),
  delayed: Object.freeze({
    label: 'Order delayed',
    email: 'always',
    push: 'always',
    in_app: true,
    preference: 'order_updates',
    quiet_hours: false,
    priority: 'high',
    notification_subtype: 'order_delayed',
  }),
  cancelled: Object.freeze({
    label: 'Order cancelled',
    email: 'always',
    push: 'always',
    in_app: true,
    preference: 'order_updates',
    quiet_hours: false,
    priority: 'high',
    notification_subtype: 'order_cancelled',
  }),
  refunded: Object.freeze({
    label: 'Refund processed',
    email: 'always',
    push: 'always',
    in_app: true,
    preference: 'order_updates',
    quiet_hours: false,
    priority: 'high',
    notification_subtype: 'order_refunded',
  }),
  payment_failed: Object.freeze({
    label: 'Payment needs attention',
    email: 'always',
    push: 'always',
    in_app: true,
    preference: 'order_updates',
    quiet_hours: false,
    priority: 'high',
    notification_subtype: 'order_payment_failed',
  }),
});

function clean(value, max = 240) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function orderNumber(context = {}) {
  return clean(context.order_number || context.orderNumber || context.order_id || context.orderId, 100) || 'your order';
}

function deliveryDetail(context = {}) {
  const date = clean(context.delivery_date_label || context.deliveryDateLabel, 120);
  const window = clean(context.delivery_window_label || context.deliveryWindowLabel, 120);
  return [date, window].filter(Boolean).join(', ');
}

export function normalizeOrderEvent(value) {
  const normalized = clean(value, 80).toLowerCase().replace(/[\s-]+/g, '_');
  return ORDER_EVENT_ALIASES[normalized] || normalized;
}

export function getOrderCommunicationPolicy(value) {
  return ORDER_COMMUNICATION_POLICY[normalizeOrderEvent(value)] || null;
}

export function isQuietHours(now = new Date(), timeZone = 'America/Chicago') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  return hour >= 20 || hour < 9;
}

export function nextQuietHoursRelease(now = new Date(), timeZone = 'America/Chicago') {
  const cursor = new Date(now);
  cursor.setSeconds(0, 0);
  for (let minute = 1; minute <= 14 * 60; minute += 1) {
    cursor.setMinutes(cursor.getMinutes() + 1);
    if (!isQuietHours(cursor, timeZone)) return cursor.toISOString();
  }
  return new Date(now.getTime() + 13 * 60 * 60 * 1000).toISOString();
}

export function buildOrderCommunicationCopy(value, context = {}) {
  const event = normalizeOrderEvent(value);
  const number = orderNumber(context);
  const timing = deliveryDetail(context);
  const amount = Number(context.refund_amount ?? context.refundAmount ?? 0);
  const formattedRefund = Number.isFinite(amount) && amount > 0 ? `$${amount.toFixed(2)}` : '';
  const copy = {
    order_confirmed: {
      subject: `Your NuVira order #${number} is confirmed`,
      title: 'Order confirmed',
      message: `Order #${number} is confirmed. We’ll keep you updated as your juices are freshly prepared.`,
      heading: 'Thank you for your order',
      detail: `We received order #${number}${timing ? ` and scheduled it for ${timing}` : ''}.`,
      cta: 'View your order',
    },
    scheduled_for_juicing: {
      subject: '',
      title: 'Your juices are scheduled 🌿',
      message: `Order #${number} is scheduled for fresh juicing${timing ? ` for ${timing}` : ''}.`,
      heading: '', detail: '', cta: 'View your order',
    },
    in_production: {
      subject: '',
      title: 'Freshly pressing your order 🍊',
      message: `We’re preparing order #${number} now. Fresh juice is in progress.`,
      heading: '', detail: '', cta: 'Follow your order',
    },
    ready_for_pickup: {
      subject: `Order #${number} is ready for pickup`,
      title: 'Your order is ready for pickup',
      message: `Order #${number} is ready. Open NuVira for pickup details.`,
      heading: 'Ready when you are',
      detail: `Your fresh NuVira order #${number} is ready for pickup.`,
      cta: 'View pickup details',
    },
    out_for_delivery: {
      subject: `Order #${number} is out for delivery`,
      title: 'Your juices are on the way 🚚',
      message: `Order #${number} is out for delivery${timing ? ` and expected ${timing}` : ''}.`,
      heading: 'Your order is on the way',
      detail: `Order #${number} is out for delivery${timing ? ` and expected ${timing}` : ''}.`,
      cta: 'Track your order',
    },
    arriving_soon: {
      subject: '',
      title: 'Your delivery is almost there',
      message: `Order #${number} is arriving soon.`,
      heading: '', detail: '', cta: 'Track your order',
    },
    delivered: {
      subject: `Order #${number} has been delivered`,
      title: 'Delivered — enjoy your juices ✨',
      message: `Order #${number} has been delivered. Your fresh juices are ready to enjoy.`,
      heading: 'Your order has been delivered',
      detail: `Order #${number} has been delivered. If anything needs attention, please let us know right away.`,
      cta: 'View delivery details',
    },
    schedule_changed: {
      subject: `An update to order #${number}`,
      title: 'Your delivery schedule was updated',
      message: `Order #${number} now has an updated delivery schedule${timing ? `: ${timing}` : ''}.`,
      heading: 'Your delivery schedule changed',
      detail: `The schedule for order #${number} was updated${timing ? ` to ${timing}` : ''}.`,
      cta: 'Review the update',
    },
    delayed: {
      subject: `A timing update for order #${number}`,
      title: 'A timing update for your order',
      message: `Order #${number} is taking a little longer than planned. Open NuVira for the latest timing.`,
      heading: 'We’re sorry for the delay',
      detail: `Order #${number} is taking longer than planned. We’ll keep the latest timing available in your order tracker.`,
      cta: 'See the latest timing',
    },
    cancelled: {
      subject: `Order #${number} was cancelled`,
      title: 'Your order was cancelled',
      message: `Order #${number} has been cancelled. Open NuVira for details or support.`,
      heading: 'Order cancelled',
      detail: `Order #${number} has been cancelled. If you did not expect this, please contact us.`,
      cta: 'View order details',
    },
    refunded: {
      subject: `Refund processed for order #${number}`,
      title: 'Your refund was processed',
      message: `${formattedRefund ? `${formattedRefund} for ` : ''}Order #${number} has been refunded. Your bank may need several business days to post it.`,
      heading: 'Your refund is on the way',
      detail: `${formattedRefund ? `A ${formattedRefund} refund` : 'A refund'} for order #${number} has been processed. Your bank’s posting time may vary.`,
      cta: 'View order details',
    },
    payment_failed: {
      subject: `Payment needs attention for order #${number}`,
      title: 'Payment needs attention',
      message: `We couldn’t complete payment for order #${number}. Open NuVira to review your order.`,
      heading: 'We couldn’t complete your payment',
      detail: `Payment for order #${number} was not completed. No duplicate charge will be created by opening your order.`,
      cta: 'Review your order',
    },
  };
  return copy[event] || null;
}

export function buildOrderCommunicationPlan(value, context = {}, options = {}) {
  const event = normalizeOrderEvent(value);
  const policy = getOrderCommunicationPolicy(event);
  const copy = buildOrderCommunicationCopy(event, context);
  if (!policy || !copy) return { valid: false, event, blocker: 'unsupported_order_event' };

  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const pushAvailable = options.pushAvailable !== false;
  const quiet = policy.quiet_hours && isQuietHours(now, options.timeZone || 'America/Chicago');
  const createdAt = new Date(context.order_created_at || context.orderCreatedAt || 0);
  const minimumRelease = policy.minimum_delay_minutes && Number.isFinite(createdAt.getTime())
    ? new Date(createdAt.getTime() + policy.minimum_delay_minutes * 60 * 1000)
    : null;
  const minimumDelayActive = minimumRelease && minimumRelease > now;
  const pushDisposition = policy.push === 'never'
    ? 'not_requested'
    : quiet || minimumDelayActive
      ? 'scheduled'
      : pushAvailable
        ? 'send'
        : 'unavailable';
  const emailDisposition = policy.email === 'always'
    ? 'send'
    : policy.email === 'fallback' && pushDisposition === 'unavailable'
      ? 'send'
      : 'not_requested';

  return {
    valid: true,
    version: ORDER_COMMUNICATION_POLICY_VERSION,
    event,
    policy,
    copy,
    channels: {
      email: emailDisposition,
      push: pushDisposition,
      in_app: policy.in_app,
    },
    push_release_at: pushDisposition === 'scheduled'
      ? [
        quiet ? new Date(nextQuietHoursRelease(now, options.timeZone || 'America/Chicago')) : null,
        minimumDelayActive ? minimumRelease : null,
      ].filter(Boolean).sort((left, right) => right.getTime() - left.getTime())[0]?.toISOString() || null
      : null,
  };
}

export function validateOrderEvent(value, order = {}) {
  const event = normalizeOrderEvent(value);
  if (!getOrderCommunicationPolicy(event)) return ['unsupported_order_event'];
  if (!clean(order.id || order.order_id, 160)) return ['order_id_missing'];
  const customerEmail = clean(order.customer_email, 200).toLowerCase();
  if (!customerEmail) return ['customer_email_missing'];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) return ['customer_email_invalid'];
  if (!clean(order.order_number || order.id, 160)) return ['order_number_missing'];

  if (event === 'order_confirmed') {
    const paid = order.payment_captured === true
      || ['paid', 'succeeded', 'complete'].includes(clean(order.payment_status, 80).toLowerCase());
    if (!paid) return ['order_payment_not_confirmed'];
  }

  const status = clean(order.status || order.fulfillment_status || order.payment_status, 80).toLowerCase().replace(/[\s-]+/g, '_');
  const accepted = {
    order_confirmed: ['order_received', 'scheduled_for_juicing', 'confirmed', 'paid', 'processing', 'in_production', 'fulfilled', 'delivered'],
    scheduled_for_juicing: ['scheduled_for_juicing'],
    in_production: ['in_production'],
    ready_for_pickup: ['ready_for_pickup'],
    out_for_delivery: ['out_for_delivery'],
    arriving_soon: ['arriving_soon', 'out_for_delivery'],
    delivered: ['delivered', 'fulfilled'],
    schedule_changed: [],
    delayed: ['delayed'],
    cancelled: ['cancelled', 'canceled'],
    refunded: ['refunded', 'partially_refunded'],
    payment_failed: ['payment_failed', 'failed'],
  }[event] || [];

  if (accepted.length > 0 && status && !accepted.includes(status)) return [`order_status_mismatch:${status}`];
  return [];
}

export function orderCommunicationPolicySummary() {
  return Object.entries(ORDER_COMMUNICATION_POLICY).map(([event, policy]) => ({ event, ...policy }));
}
