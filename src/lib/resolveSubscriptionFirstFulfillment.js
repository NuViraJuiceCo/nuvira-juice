/**
 * Unified subscription first fulfillment date calculator
 * Used by: subscription checkout, webhook repair, Hub payload creation
 * Timezone: America/Chicago
 * 
 * Returns: { production_date, first_delivery_date, delivery_window_label, 
 *           delivery_window_start, delivery_window_end, reason }
 */

export function resolveSubscriptionFirstFulfillment(orderTimestamp, options = {}) {
  const {
    plan_cadence = 'monthly',
    delivery_zone_id = null,
    custom_delivery_window = null,
    debug = false,
  } = options;

  // Step 1: Convert order timestamp to Chicago time
  const orderDate = new Date(orderTimestamp);
  const chicagoFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = chicagoFormatter.formatToParts(orderDate);
  const pm = {};
  parts.forEach(p => { pm[p.type] = p.value; });

  const chicagoYear = parseInt(pm.year);
  const chicagoMonth = parseInt(pm.month) - 1;
  const chicagoDay = parseInt(pm.day);
  const chicagoHour = parseInt(pm.hour);
  const chicagoMinute = parseInt(pm.minute);

  const chicagoDateTime = new Date(chicagoYear, chicagoMonth, chicagoDay, chicagoHour, chicagoMinute);
  const dow = chicagoDateTime.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const cutoffHour = 14; // 2:00 PM

  if (debug) {
    console.log(`[ResolveSubFulfillment] Order timestamp: ${orderTimestamp}`);
    console.log(`[ResolveSubFulfillment] Chicago time: ${chicagoYear}-${pm.month}-${pm.day} ${pm.hour}:${pm.minute}`);
    console.log(`[ResolveSubFulfillment] Day of week: ${dow} (0=Sun, 6=Sat)`);
  }

  // Step 2: Determine next eligible production date
  // NuVira production days: Tuesday (2), Friday (5), Saturday (6)
  // Delivery days: Wednesday (3), Saturday (6), Sunday (0)
  let daysToNextProduction = 0;
  let reason = '';

  if (dow === 0) {
    // Sunday → next production is Tuesday (2 days away)
    daysToNextProduction = 2;
    reason = 'Order on Sunday; next production Tuesday';
  } else if (dow === 1) {
    // Monday → next production is Tuesday (1 day away)
    daysToNextProduction = 1;
    reason = 'Order on Monday; next production Tuesday';
  } else if (dow === 2) {
    // Tuesday
    if (chicagoHour < cutoffHour) {
      // Before 2 PM → same day production (0 days)
      daysToNextProduction = 0;
      reason = `Order on Tuesday before ${cutoffHour}:00; same-day production`;
    } else {
      // At or after 2 PM → Friday production (3 days away)
      daysToNextProduction = 3;
      reason = `Order on Tuesday at/after ${cutoffHour}:00; next production Friday`;
    }
  } else if (dow === 3) {
    // Wednesday → next production is Friday (2 days away)
    daysToNextProduction = 2;
    reason = 'Order on Wednesday; next production Friday';
  } else if (dow === 4) {
    // Thursday → next production is Friday (1 day away)
    daysToNextProduction = 1;
    reason = 'Order on Thursday; next production Friday';
  } else if (dow === 5) {
    // Friday
    if (chicagoHour < cutoffHour) {
      // Before 2 PM → same day production (0 days)
      daysToNextProduction = 0;
      reason = `Order on Friday before ${cutoffHour}:00; same-day production`;
    } else {
      // At or after 2 PM → Saturday production (1 day away)
      daysToNextProduction = 1;
      reason = `Order on Friday at/after ${cutoffHour}:00; next production Saturday`;
    }
  } else if (dow === 6) {
    // Saturday
    if (chicagoHour < cutoffHour) {
      // Before 2 PM → same day production (0 days)
      daysToNextProduction = 0;
      reason = `Order on Saturday before ${cutoffHour}:00; same-day production`;
    } else {
      // At or after 2 PM → Tuesday production (3 days away: Sun, Mon, Tue)
      daysToNextProduction = 3;
      reason = `Order on Saturday at/after ${cutoffHour}:00; next production Tuesday`;
    }
  }

  const productionDate = new Date(chicagoDateTime);
  productionDate.setDate(productionDate.getDate() + daysToNextProduction);
  const productionDateStr = productionDate.toISOString().split('T')[0];

  if (debug) {
    console.log(`[ResolveSubFulfillment] Production date: ${productionDateStr} (${daysToNextProduction} days from order)`);
  }

  // Step 3: Determine delivery date based on production date
  // Production → Delivery mapping (NuVira standard):
  // Tuesday production → Wednesday delivery
  // Friday production → Saturday delivery
  // Saturday production → Sunday delivery
  const prodDow = productionDate.getDay();
  let deliveryDate = new Date(productionDate);
  let deliveryReason = '';

  if (prodDow === 2) {
    // Tuesday production → Wednesday delivery (1 day)
    deliveryDate.setDate(deliveryDate.getDate() + 1);
    deliveryReason = 'Production Tuesday → Delivery Wednesday';
  } else if (prodDow === 5) {
    // Friday production → Saturday delivery (1 day)
    deliveryDate.setDate(deliveryDate.getDate() + 1);
    deliveryReason = 'Production Friday → Delivery Saturday';
  } else if (prodDow === 6) {
    // Saturday production → Sunday delivery (1 day)
    deliveryDate.setDate(deliveryDate.getDate() + 1);
    deliveryReason = 'Production Saturday → Delivery Sunday';
  } else {
    // Fallback: should not happen if production logic is correct
    deliveryDate.setDate(deliveryDate.getDate() + 1);
    deliveryReason = 'Fallback: +1 day delivery';
  }

  const firstDeliveryDateStr = deliveryDate.toISOString().split('T')[0];

  if (debug) {
    console.log(`[ResolveSubFulfillment] First delivery date: ${firstDeliveryDateStr} (${deliveryReason})`);
  }

  // Step 4: Calculate next recurring delivery date (for Subscription record)
  // For weekly subscriptions: 1 week after first delivery
  // For monthly subscriptions: next delivery in ~4 weeks (same day of next month, or closest valid)
  let nextDeliveryDate = new Date(deliveryDate);
  if (plan_cadence === 'weekly') {
    nextDeliveryDate.setDate(nextDeliveryDate.getDate() + 7);
  } else if (plan_cadence === 'monthly') {
    nextDeliveryDate.setMonth(nextDeliveryDate.getMonth() + 1);
  }
  const nextDeliveryDateStr = nextDeliveryDate.toISOString().split('T')[0];

  if (debug) {
    console.log(`[ResolveSubFulfillment] Next delivery date: ${nextDeliveryDateStr} (cadence: ${plan_cadence})`);
  }

  // Step 5: Delivery window (standard NuVira window: 5 PM – 8 PM)
  // Can be customized per zone in future
  const deliveryWindowLabel = custom_delivery_window?.label || '5 PM – 8 PM';
  const deliveryWindowStart = custom_delivery_window?.start || '17:00';
  const deliveryWindowEnd = custom_delivery_window?.end || '20:00';

  return {
    production_date: productionDateStr,
    first_delivery_date: firstDeliveryDateStr,
    next_delivery_date: nextDeliveryDateStr,
    delivery_window_label: deliveryWindowLabel,
    delivery_window_start: deliveryWindowStart,
    delivery_window_end: deliveryWindowEnd,
    reason: `${reason} → ${deliveryReason}`,
    order_date: chicagoDateTime.toISOString().split('T')[0],
    order_time: `${String(chicagoHour).padStart(2, '0')}:${String(chicagoMinute).padStart(2, '0')}`,
  };
}

export default resolveSubscriptionFirstFulfillment;