const TERMINAL_STATUSES = new Set(['delivered', 'picked_up', 'cancelled', 'refunded', 'failed']);

const STATUS_ALIASES = Object.freeze({
  confirmed: 'order_received',
  paid: 'order_received',
  payment_received: 'order_received',
  processing: 'order_received',
  awaiting_production: 'scheduled_for_juicing',
  new: 'scheduled_for_juicing',
  pending: 'scheduled_for_juicing',
  production_scheduled: 'scheduled_for_juicing',
  scheduled: 'scheduled_for_juicing',
  scheduled_for_production: 'scheduled_for_juicing',
  producing: 'in_production',
  production_started: 'in_production',
  bottled: 'bottled_packed',
  packed: 'bottled_packed',
  qc_checked: 'bottled_packed',
  ready_for_fulfillment: 'bottled_packed',
  assigned_for_delivery: 'out_for_delivery',
  on_route: 'out_for_delivery',
  fulfilled: 'delivered',
  canceled: 'cancelled',
  voided: 'failed',
});

export const DELIVERY_JOURNEY_STAGES = Object.freeze([
  { key: 'order_received', label: 'Confirmed', description: 'We have your payment and order details.' },
  { key: 'scheduled_for_juicing', label: 'Fresh Batch', description: 'Your juices are reserved for a fresh production batch.' },
  { key: 'in_production', label: 'Freshly Made', description: "We're pressing and preparing your juices." },
  { key: 'bottled_packed', label: 'Packed', description: 'Your juices are bottled, packed, and ready for handoff.' },
  { key: 'out_for_delivery', label: 'Delivery', description: 'Your driver is on the way.' },
  { key: 'delivered', label: 'Delivered', description: 'Your order has been delivered. Enjoy!' },
]);

export const PICKUP_JOURNEY_STAGES = Object.freeze([
  { key: 'order_received', label: 'Confirmed', description: 'We have your payment and order details.' },
  { key: 'scheduled_for_juicing', label: 'Fresh Batch', description: 'Your juices are reserved for a fresh production batch.' },
  { key: 'in_production', label: 'Freshly Made', description: "We're pressing and preparing your juices." },
  { key: 'bottled_packed', label: 'Packed', description: 'Your juices are bottled, packed, and ready for pickup.' },
  { key: 'ready_for_pickup', label: 'Ready', description: 'Your order is ready for pickup.' },
  { key: 'picked_up', label: 'Picked Up', description: 'Your pickup is complete. Enjoy!' },
]);

function cleanStatus(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function normalizeCustomerOrderStatus(value) {
  const status = cleanStatus(value);
  return STATUS_ALIASES[status] || status || 'order_received';
}

export function journeyStageKeyForStatus(value, fulfillmentType = 'delivery') {
  const normalizedStatus = normalizeCustomerOrderStatus(value);
  if (normalizedStatus === 'arriving_soon') return 'out_for_delivery';
  if (fulfillmentType === 'pickup' && normalizedStatus === 'delivered') return 'picked_up';
  return normalizedStatus;
}

function statusPresentation(normalizedStatus, fulfillmentType, fallbackLabel) {
  const pickup = fulfillmentType === 'pickup';
  const presentations = {
    order_received: ['Order Confirmed', 'We have your payment and order details.'],
    scheduled_for_juicing: ['Fresh Batch Scheduled', 'Your juices are reserved for an upcoming fresh production batch.'],
    in_production: ['Being Freshly Made', "We're pressing and preparing your juices."],
    bottled_packed: ['Bottled & Packed', pickup ? 'Your order is packed and getting ready for pickup.' : 'Your order is packed and getting ready for delivery.'],
    out_for_delivery: ['Out for Delivery', 'Your driver is on the way.'],
    arriving_soon: ['Arriving Soon', 'Your order is almost there.'],
    delivered: ['Delivered', 'Your fresh juices have arrived. Enjoy!'],
    ready_for_pickup: ['Ready for Pickup', 'Your order is ready when you are.'],
    picked_up: ['Picked Up', 'Your pickup is complete. Enjoy!'],
    cancelled: ['Order Cancelled', 'This order was cancelled.'],
    refunded: ['Order Refunded', 'A refund has been issued for this order.'],
    failed: ['Payment Failed', 'Payment was not completed.'],
  };
  const [label, description] = presentations[normalizedStatus] || [fallbackLabel || 'Order Processing', 'We are preparing the next update for your order.'];
  return { label, description };
}

export function getCustomerOrderJourney({ status, fulfillmentType = 'delivery', fallbackLabel = '' } = {}) {
  const normalizedStatus = normalizeCustomerOrderStatus(status);
  const stageKey = journeyStageKeyForStatus(normalizedStatus, fulfillmentType);
  const baseStages = fulfillmentType === 'pickup' ? PICKUP_JOURNEY_STAGES : DELIVERY_JOURNEY_STAGES;
  const currentIndex = baseStages.findIndex(stage => stage.key === stageKey);
  const presentation = statusPresentation(normalizedStatus, fulfillmentType, fallbackLabel);
  const progressPercent = currentIndex < 0
    ? 0
    : Math.round((currentIndex / Math.max(baseStages.length - 1, 1)) * 100);

  return {
    normalizedStatus,
    stageKey,
    currentIndex,
    progressPercent,
    isTerminal: TERMINAL_STATUSES.has(normalizedStatus),
    isKnownStage: currentIndex >= 0,
    statusLabel: presentation.label,
    statusDescription: presentation.description,
    stages: baseStages.map((stage, index) => ({
      ...stage,
      state: currentIndex < 0 ? 'upcoming' : index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming',
    })),
  };
}

export function buildCustomerJourneyTimeline(statusTimeline = [], fulfillmentType = 'delivery') {
  const byStage = {};
  for (const entry of Array.isArray(statusTimeline) ? statusTimeline : []) {
    const stageKey = journeyStageKeyForStatus(entry?.status, fulfillmentType);
    if (!stageKey) continue;
    byStage[stageKey] = {
      status: normalizeCustomerOrderStatus(entry?.status),
      timestamp: entry?.timestamp || null,
      message: entry?.message || '',
      label: entry?.label || '',
    };
  }
  return byStage;
}
