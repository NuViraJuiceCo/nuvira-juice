import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * CENTRAL FULFILLMENT SCHEDULE ENGINE
 * 
 * Single source of truth for NuVira production and delivery dates.
 * All order creation, subscription checkout, webhook processing, and Hub payloads
 * must use this function to ensure consistent scheduling.
 * 
 * Official Rules (America/Chicago timezone):
 *   Window 1: Friday 14:01 through Tuesday 14:00 (inclusive)
 *     → Production: Tuesday evening
 *     → Delivery: Wednesday, 5:00 PM – 8:00 PM
 * 
 *   Window 2: Tuesday 14:01 through Friday 14:00 (inclusive)
 *     → Production: Friday evening
 *     → Delivery: Saturday, 12:00 PM – 3:00 PM
 * 
 * Boundary Rules:
 *   - Exactly Tuesday 14:00:00 qualifies for Tuesday production/Wednesday delivery
 *   - Tuesday 14:00:01 moves to Friday production/Saturday delivery
 *   - Exactly Friday 14:00:00 qualifies for Friday production/Saturday delivery
 *   - Friday 14:00:01 moves to Tuesday production/Wednesday delivery
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // OPTIONAL: Verify caller is admin (non-blocking for test execution)
    let user = null;
    try {
      user = await base44.auth.me();
    } catch (e) {
      // Public call allowed for testing
    }

    const body = await req.json();
    const { created_at, checkout_completed_at, paid_at } = body;

    // Accept any timestamp variant; use first non-null
    const inputTimestamp = created_at || checkout_completed_at || paid_at;
    if (!inputTimestamp) {
      return Response.json({ error: 'Missing timestamp: created_at, checkout_completed_at, or paid_at required' }, { status: 400 });
    }

    console.log(`[CalcSchedule] Input: ${inputTimestamp}`);

    // Parse timestamp into America/Chicago time
    const orderDate = new Date(inputTimestamp);
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

    const parts = chicagoFormatter.formatToParts(orderDate);
    const pm = {};
    parts.forEach(p => { pm[p.type] = p.value; });

    const year = parseInt(pm.year);
    const month = parseInt(pm.month) - 1; // 0-indexed
    const day = parseInt(pm.day);
    const hour = parseInt(pm.hour);
    const minute = parseInt(pm.minute);
    const second = parseInt(pm.second);

    // Get day of week in Chicago time (0=Sunday, 6=Saturday)
    const chicagoDate = new Date(year, month, day, hour, minute, second);
    const dow = chicagoDate.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

    // Cutoff boundary: 14:00:00 (2:00 PM exactly)
    const cutoffHour = 14;
    const cutoffMinute = 0;
    const cutoffSecond = 0;
    const timeInSeconds = hour * 3600 + minute * 60 + second;
    const cutoffInSeconds = cutoffHour * 3600 + cutoffMinute * 60 + cutoffSecond;
    const isAfterCutoff = timeInSeconds > cutoffInSeconds; // AFTER 14:00:00, not at or after

    console.log(`[CalcSchedule] Chicago time: ${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`);
    console.log(`[CalcSchedule] Day of week: ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow]}, isAfterCutoff: ${isAfterCutoff}`);

    let productionDate, deliveryDate, deliveryWindowLabel, deliveryWindowStart, deliveryWindowEnd, cutoffWindowLabel, scheduleReason;

    // ── WINDOW 1: Friday 14:01 through Tuesday 14:00 (inclusive) ────
    // Produces: Tuesday, Delivers: Wednesday
    // This includes:
    //   - Friday after 14:00 (dow=5 && isAfterCutoff)
    //   - Saturday (dow=6)
    //   - Sunday (dow=0)
    //   - Monday (dow=1)
    //   - Tuesday before/at 14:00 (dow=2 && !isAfterCutoff)
    
    // ── WINDOW 2: Tuesday 14:01 through Friday 14:00 (inclusive) ────
    // Produces: Friday, Delivers: Saturday
    // This includes:
    //   - Tuesday after 14:00 (dow=2 && isAfterCutoff)
    //   - Wednesday (dow=3)
    //   - Thursday (dow=4)
    //   - Friday before/at 14:00 (dow=5 && !isAfterCutoff)

    if (dow === 5 && !isAfterCutoff) {
      // Friday BEFORE/AT 14:00 → Window 2 (Fri prod today, Sat del)
      productionDate = new Date(year, month, day);
      deliveryDate = new Date(productionDate);
      deliveryDate.setDate(deliveryDate.getDate() + 1); // Friday + 1 = Saturday
      deliveryWindowLabel = '12:00 PM – 3:00 PM';
      deliveryWindowStart = '12:00';
      deliveryWindowEnd = '15:00';
      cutoffWindowLabel = 'Friday before/at 2:00 PM';
      scheduleReason = 'Friday before cutoff → today production, Saturday delivery (Window 2)';
    } else if (dow === 5 && isAfterCutoff) {
      // Friday AFTER 14:00 → Window 1 (next Tue prod, Wed del)
      productionDate = new Date(year, month, day);
      productionDate.setDate(productionDate.getDate() + 4); // Friday + 4 = Tuesday next week
      deliveryDate = new Date(productionDate);
      deliveryDate.setDate(deliveryDate.getDate() + 1); // Tuesday + 1 = Wednesday
      deliveryWindowLabel = '5:00 PM – 8:00 PM';
      deliveryWindowStart = '17:00';
      deliveryWindowEnd = '20:00';
      cutoffWindowLabel = 'Friday after 2:00 PM';
      scheduleReason = 'Friday after cutoff → next Tuesday production, Wednesday delivery (Window 1)';
    } else if (dow === 6 || dow === 0 || dow === 1) {
      // Saturday, Sunday, Monday → Window 1 (Tue prod, Wed del)
      // Calculate next Tuesday
      const daysToNextTuesday = (2 - dow + 7) % 7;
      productionDate = new Date(year, month, day);
      productionDate.setDate(productionDate.getDate() + (daysToNextTuesday === 0 ? 7 : daysToNextTuesday));
      deliveryDate = new Date(productionDate);
      deliveryDate.setDate(deliveryDate.getDate() + 1);
      deliveryWindowLabel = '5:00 PM – 8:00 PM';
      deliveryWindowStart = '17:00';
      deliveryWindowEnd = '20:00';
      cutoffWindowLabel = `${['Sun', 'Mon'][dow === 1 ? 1 : 0]} (before Friday cutoff)`;
      scheduleReason = `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow]} → next Tuesday production, Wednesday delivery (Window 1)`;
    } else if (dow === 2 && !isAfterCutoff) {
      // Tuesday BEFORE/AT 14:00 → Window 1 (Tue prod, Wed del) — TODAY
      productionDate = new Date(year, month, day);
      deliveryDate = new Date(productionDate);
      deliveryDate.setDate(deliveryDate.getDate() + 1);
      deliveryWindowLabel = '5:00 PM – 8:00 PM';
      deliveryWindowStart = '17:00';
      deliveryWindowEnd = '20:00';
      cutoffWindowLabel = 'Tuesday before/at 2:00 PM';
      scheduleReason = 'Tuesday at/before cutoff → today production, Wednesday delivery (Window 1)';
    } else if (dow === 2 && isAfterCutoff) {
      // Tuesday AFTER 14:00 → Window 2 (Fri prod, Sat del)
      const daysToNextFriday = (5 - dow + 7) % 7;
      productionDate = new Date(year, month, day);
      productionDate.setDate(productionDate.getDate() + (daysToNextFriday === 0 ? 7 : daysToNextFriday));
      deliveryDate = new Date(productionDate);
      deliveryDate.setDate(deliveryDate.getDate() + 1);
      deliveryWindowLabel = '12:00 PM – 3:00 PM';
      deliveryWindowStart = '12:00';
      deliveryWindowEnd = '15:00';
      cutoffWindowLabel = 'Tuesday after 2:00 PM';
      scheduleReason = 'Tuesday after cutoff → next Friday production, Saturday delivery (Window 2)';
    } else if (dow === 3 || dow === 4) {
      // Wednesday, Thursday → Window 2 (Fri prod, Sat del)
      const daysToNextFriday = (5 - dow + 7) % 7;
      productionDate = new Date(year, month, day);
      productionDate.setDate(productionDate.getDate() + (daysToNextFriday === 0 ? 7 : daysToNextFriday));
      deliveryDate = new Date(productionDate);
      deliveryDate.setDate(deliveryDate.getDate() + 1);
      deliveryWindowLabel = '12:00 PM – 3:00 PM';
      deliveryWindowStart = '12:00';
      deliveryWindowEnd = '15:00';
      cutoffWindowLabel = `${['Wed', 'Thu'][dow === 3 ? 0 : 1]} (after Tuesday cutoff)`;
      scheduleReason = `${['', '', '', 'Wednesday', 'Thursday'][dow]} → next Friday production, Saturday delivery (Window 2)`;
    } else {
      return Response.json({ error: 'Unable to determine schedule window' }, { status: 500 });
    }

    // Format dates as YYYY-MM-DD
    const productionDateStr = productionDate.toISOString().split('T')[0];
    const deliveryDateStr = deliveryDate.toISOString().split('T')[0];

    const result = {
      input_timestamp: inputTimestamp,
      chicago_time: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`,
      day_of_week: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow],
      production_date: productionDateStr,
      delivery_date: deliveryDateStr,
      delivery_window_label: deliveryWindowLabel,
      delivery_window_start: deliveryWindowStart,
      delivery_window_end: deliveryWindowEnd,
      cutoff_window_label: cutoffWindowLabel,
      schedule_reason: scheduleReason,
      timezone: 'America/Chicago',
    };

    console.log(`[CalcSchedule] ✅ Result: ${productionDateStr} (prod) → ${deliveryDateStr} (${deliveryWindowLabel})`);
    return Response.json(result);

  } catch (error) {
    console.error('[CalcSchedule] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});