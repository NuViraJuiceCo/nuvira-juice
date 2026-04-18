import { addDays, nextDay, format, getDay } from 'date-fns';
import { LAUNCH_DATE } from '@/lib/preorderConfig';

// Default schedule if no DB schedule exists
const DEFAULT_RULES = [
  { order_days: [0, 1, 2], delivery_day: 3, cutoff_hour: 23 },   // Sun/Mon/Tue → Wed
  { order_days: [3, 4, 5], delivery_day: 6, cutoff_hour: 23 },   // Wed/Thu/Fri → Sat
  { order_days: [6], delivery_day: 0, cutoff_hour: 23 },          // Sat → Sun
];

export function getNextDeliveryDate(scheduleRules, now = new Date()) {
  const rules = (scheduleRules && scheduleRules.length > 0) ? scheduleRules : DEFAULT_RULES;
  const currentDay = getDay(now);
  const currentHour = now.getHours();

  const rule = rules.find(r => r.order_days.includes(currentDay));
  if (!rule) return null;

  const cutoff = rule.cutoff_hour || 23;
  let deliveryDay = rule.delivery_day;

  // If past cutoff, find next applicable rule
  if (currentHour >= cutoff) {
    const nextDayOfWeek = (currentDay + 1) % 7;
    const nextRule = rules.find(r => r.order_days.includes(nextDayOfWeek));
    if (nextRule) {
      deliveryDay = nextRule.delivery_day;
    }
  }

  // Calculate next occurrence of deliveryDay
  let date = new Date(now);
  let daysUntil = (deliveryDay - currentDay + 7) % 7;
  if (daysUntil === 0) daysUntil = 7;
  date = addDays(date, daysUntil);

  return date;
}

export function getDeliveryDisplayText(scheduleRules, fulfillmentType = 'delivery') {
  if (new Date() < LAUNCH_DATE) return null;

  const date = getNextDeliveryDate(scheduleRules);
  if (!date) return 'Next available batch';

  const dayName = format(date, 'EEEE');
  const dateStr = format(date, 'MMM d');

  if (fulfillmentType === 'pickup') {
    return `Ready for pickup ${dayName}, ${dateStr}`;
  }
  return `Delivered ${dayName}, ${dateStr}`;
}

export function getDeliveryShortText(scheduleRules) {
  if (new Date() < LAUNCH_DATE) return 'Coming May 1st';

  const date = getNextDeliveryDate(scheduleRules);
  if (!date) return 'Next batch';
  return format(date, 'EEEE, MMM d');
}

// Returns production info if today is a production day (day before a delivery day)
export function getProductionInfo(scheduleRules, now = new Date()) {
  // If before launch date, no production info yet
  if (now < LAUNCH_DATE) {
    return null;
  }

  const rules = (scheduleRules && scheduleRules.length > 0) ? scheduleRules : DEFAULT_RULES;
  const today = getDay(now);

  // Check if tomorrow is a delivery day for any rule
  const tomorrow = (today + 1) % 7;
  const deliveryRule = rules.find(r => r.delivery_day === tomorrow);
  if (!deliveryRule) return null;

  // Today is production day — delivery is tomorrow
  const deliveryDate = addDays(now, 1);
  return {
    isProductionDay: true,
    deliveryDate,
    label: `In production today · Delivered ${format(deliveryDate, 'EEEE, MMM d')}`,
  };
}