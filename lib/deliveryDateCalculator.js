/**
 * Unified delivery date calculator for NuVira
 * Used by: checkout, order creation, email templates, Hub sync
 * Timezone: America/Chicago
 */

export function calculateDeliveryDate(orderCreatedAt = null) {
  // Use provided timestamp or current time
  const now = orderCreatedAt ? new Date(orderCreatedAt) : new Date();
  
  // Convert to Chicago time (UTC-5 or UTC-6 depending on DST)
  const chicagoFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = chicagoFormatter.formatToParts(now);
  const partMap = {};
  parts.forEach(part => {
    partMap[part.type] = part.value;
  });

  const chicagoYear = parseInt(partMap.year);
  const chicagoMonth = parseInt(partMap.month) - 1; // 0-indexed
  const chicagoDay = parseInt(partMap.day);
  const chicagoHour = parseInt(partMap.hour);
  const chicagoMinute = parseInt(partMap.minute);

  const chicagoDate = new Date(chicagoYear, chicagoMonth, chicagoDay, chicagoHour, chicagoMinute);
  const dayOfWeek = chicagoDate.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const cutoffHour = 14; // 2:00 PM

  let daysToAdd = 0;

  if (dayOfWeek === 0) {
    // Sunday → Wednesday (3 days)
    daysToAdd = 3;
  } else if (dayOfWeek === 1) {
    // Monday → Wednesday (2 days)
    daysToAdd = 2;
  } else if (dayOfWeek === 2) {
    // Tuesday
    if (chicagoHour < cutoffHour) {
      // Before 2 PM → Wednesday (1 day)
      daysToAdd = 1;
    } else {
      // At or after 2 PM → Saturday (4 days)
      daysToAdd = 4;
    }
  } else if (dayOfWeek === 3) {
    // Wednesday → Saturday (3 days)
    daysToAdd = 3;
  } else if (dayOfWeek === 4) {
    // Thursday → Saturday (2 days)
    daysToAdd = 2;
  } else if (dayOfWeek === 5) {
    // Friday
    if (chicagoHour < cutoffHour) {
      // Before 2 PM → Saturday (1 day)
      daysToAdd = 1;
    } else {
      // At or after 2 PM → Sunday (2 days)
      daysToAdd = 2;
    }
  } else if (dayOfWeek === 6) {
    // Saturday → Sunday (1 day)
    daysToAdd = 1;
  }

  const deliveryDate = new Date(chicagoDate);
  deliveryDate.setDate(deliveryDate.getDate() + daysToAdd);

  // Return as YYYY-MM-DD string
  return deliveryDate.toISOString().split('T')[0];
}

export function formatDeliveryDateForDisplay(dateString) {
  if (!dateString) return null;
  try {
    const date = new Date(dateString + 'T00:00:00Z');
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  } catch {
    return null;
  }
}