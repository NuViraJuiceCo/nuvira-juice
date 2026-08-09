import { addDays, format, getDay } from 'date-fns';

// Default schedule if no DB schedule exists
const DEFAULT_RULES = [
  { order_days: [0, 1, 2], delivery_day: 3, cutoff_hour: 23 },  // Sun/Mon/Tue → Wed
  { order_days: [3, 4, 5], delivery_day: 6, cutoff_hour: 23 },  // Wed/Thu/Fri → Sat
  { order_days: [6],       delivery_day: 0, cutoff_hour: 23 },   // Sat → Sun
];

export function getNextDeliveryDate(scheduleRules, now = new Date()) {
  const rules = (scheduleRules && scheduleRules.length > 0) ? scheduleRules : DEFAULT_RULES;
  const currentDay  = getDay(now);
  const currentHour = now.getHours();

  const rule = rules.find(r => r.order_days.includes(currentDay));
  if (!rule) return null;

  const cutoff = rule.cutoff_hour || 23;
  let deliveryDay = rule.delivery_day;

  if (currentHour >= cutoff) {
    const nextDayOfWeek = (currentDay + 1) % 7;
    const nextRule = rules.find(r => r.order_days.includes(nextDayOfWeek));
    if (nextRule) deliveryDay = nextRule.delivery_day;
  }

  let date = new Date(now);
  let daysUntil = (deliveryDay - currentDay + 7) % 7;
  if (daysUntil === 0) daysUntil = 7;
  date = addDays(date, daysUntil);

  return date;
}

export function getDeliveryDisplayText(scheduleRules, fulfillmentType = 'delivery') {
  const date = getNextDeliveryDate(scheduleRules);
  if (!date) return 'Next available batch';

  const dayName = format(date, 'EEEE', { timeZone: 'America/Chicago' });
  const dateStr  = format(date, 'MMM d',  { timeZone: 'America/Chicago' });

  if (fulfillmentType === 'pickup') {
    return `Ready ${dayName}, ${dateStr}`;
  }
  return `Delivered ${dayName}, ${dateStr}`;
}

export function getDeliveryShortText(scheduleRules) {
  const date = getNextDeliveryDate(scheduleRules);
  if (!date) return 'Next batch';
  return format(date, 'EEEE, MMM d', { timeZone: 'America/Chicago' });
}

/**
 * Returns up to 3 eligible delivery options for customer selection.
 * Each option includes delivery_date, production_date, and delivery_window_label.
 * Based on NuVira schedule: Wed (prod Tue), Sat (prod Fri), Sun (prod Sat, optional).
 *
 * @param {Date} now - reference time (default: now in Chicago)
 * @param {boolean} sundayEnabled - whether Sunday delivery batch is active
 * @returns {Array<{delivery_date: string, production_date: string, delivery_day_name: string, delivery_window_label: string, is_earliest: boolean}>}
 */
export function getEligibleDeliveryOptions(now = new Date(), sundayEnabled = false) {
  const chicagoFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  const parts = chicagoFormatter.formatToParts(now);
  const pm = {};
  parts.forEach(p => { pm[p.type] = p.value; });

  // Chicago-local "now" as a plain local Date (no timezone offset confusion)
  const chicagoNow = new Date(
    parseInt(pm.year), parseInt(pm.month) - 1, parseInt(pm.day),
    parseInt(pm.hour), parseInt(pm.minute)
  );
  const todayDow = chicagoNow.getDay(); // 0=Sun ... 6=Sat
  const todayHour = chicagoNow.getHours();
  const CUTOFF = 14; // 2 PM Chicago

  // NuVira batches: [productionDow, deliveryDow]
  const batches = [
    [2, 3], // Tuesday prod → Wednesday delivery
    [5, 6], // Friday prod → Saturday delivery
    ...(sundayEnabled ? [[6, 0]] : []),
  ];

  const toISODate = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dy}`;
  };

  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  const options = [];

  // Walk forward up to 14 days to find the next eligible delivery slots
  for (let daysAhead = 1; daysAhead <= 14 && options.length < batches.length; daysAhead++) {
    const deliveryCandidate = new Date(chicagoNow);
    deliveryCandidate.setDate(deliveryCandidate.getDate() + daysAhead);
    const deliveryDow = deliveryCandidate.getDay();

    for (const [prodDow, delDow] of batches) {
      if (options.some(o => o._delDow === delDow)) continue; // slot already found
      if (deliveryDow !== delDow) continue;                   // not this batch's delivery day

      // Production day is always 1 day before delivery
      const prodCandidate = new Date(deliveryCandidate);
      prodCandidate.setDate(prodCandidate.getDate() - 1);
      if (prodCandidate.getDay() !== prodDow) continue; // sanity check

      // If production day is TODAY, only include if before 2 PM cutoff
      if (daysAhead === 1 && todayHour >= CUTOFF) continue;

      // If production day is already in the past (daysAhead >= 2 means prod is tomorrow or later — always ok)
      // daysAhead=1 → prod is today (handled above)
      // daysAhead=2 → prod is tomorrow → always eligible

      options.push({
        delivery_date: toISODate(deliveryCandidate),
        production_date: toISODate(prodCandidate),
        delivery_day_name: DAY_NAMES[delDow],
        delivery_window_label: '5 PM – 8 PM',
        delivery_window_start: '17:00',
        delivery_window_end: '20:00',
        is_earliest: false,
        _delDow: delDow,
      });
    }
  }

  if (options.length > 0) options[0].is_earliest = true;
  return options;
}

// Returns production urgency info ONLY if today is an actual NuVira production day
// AND the order would still make the cutoff (before 2 PM Chicago time).
// NuVira production days: Tuesday (→ Wednesday delivery), Friday (→ Saturday delivery)
export function getProductionInfo(scheduleRules, now = new Date()) {
  const chicagoFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = chicagoFormatter.formatToParts(now);
  const pm = {};
  parts.forEach(p => { pm[p.type] = p.value; });
  const chicagoNow = new Date(
    parseInt(pm.year), parseInt(pm.month) - 1, parseInt(pm.day),
    parseInt(pm.hour), parseInt(pm.minute)
  );

  const dow = chicagoNow.getDay();   // 0=Sun ... 6=Sat
  const hour = chicagoNow.getHours();
  const CUTOFF = 14; // 2 PM

  // NuVira production days only: Tuesday=2 → Wednesday=3, Friday=5 → Saturday=6
  const PRODUCTION_BATCHES = { 2: 3, 5: 6 }; // prodDow → delDow

  if (!(dow in PRODUCTION_BATCHES)) return null; // not a production day
  if (hour >= CUTOFF) return null; // past cutoff — order missed this batch

  const delDow = PRODUCTION_BATCHES[dow];
  const deliveryDate = addDays(chicagoNow, 1);
  const delDayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][delDow];
  const dateLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }).format(deliveryDate);

  return {
    isProductionDay: true,
    deliveryDate,
    label: `Order by 2 PM for ${delDayName} delivery · ${dateLabel}`,
  };
}
