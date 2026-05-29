import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TIMEZONE = 'America/Chicago';
const FINAL_SCHEDULE_SOURCE = 'backend_cadence';

async function readJsonBody(req) {
  try {
    const raw = await req.text();
    if (!raw || raw.trim() === '') return { ok: true, body: {} };
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, response: Response.json({ ok: false, error: 'malformed_json' }, { status: 400 }) };
  }
}

/**
 * CENTRAL FULFILLMENT SCHEDULE ENGINE
 *
 * Single source of truth for NuVira production and delivery dates.
 * All order creation, subscription checkout, webhook processing, and Hub payloads
 * must use this function to ensure consistent scheduling.
 *
 * Official Rules (America/Chicago timezone):
 *   Window 1: Friday 14:00:01 through Tuesday 14:00:00
 *     -> Production: Tuesday
 *     -> Delivery: Wednesday, 5 PM - 8 PM
 *
 *   Window 2: Tuesday 14:00:01 through Friday 14:00:00
 *     -> Production: Friday
 *     -> Delivery: Saturday, 12 PM - 3 PM
 */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getChicagoParts(timestamp) {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid timestamp');
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const values = {};
  formatter.formatToParts(parsed).forEach((part) => {
    values[part.type] = part.value;
  });

  const year = parseInt(values.year, 10);
  const month = parseInt(values.month, 10) - 1;
  const day = parseInt(values.day, 10);
  const hour = parseInt(values.hour, 10);
  const minute = parseInt(values.minute, 10);
  const second = parseInt(values.second, 10);
  const chicagoDate = new Date(year, month, day, hour, minute, second);

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dow: chicagoDate.getDay(),
    chicagoTime: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`,
  };
}

function toISODate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function getOffsetMinutesForZone(utcDate, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const values = {};
  formatter.formatToParts(utcDate).forEach((part) => {
    values[part.type] = part.value;
  });

  const asUTC = Date.UTC(
    parseInt(values.year, 10),
    parseInt(values.month, 10) - 1,
    parseInt(values.day, 10),
    parseInt(values.hour, 10),
    parseInt(values.minute, 10),
    parseInt(values.second, 10)
  );

  return (asUTC - utcDate.getTime()) / 60000;
}

function localChicagoDateTimeToISO(dateStr, timeStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offsetMinutes = getOffsetMinutesForZone(utcGuess, TIMEZONE);
  const utcDate = new Date(utcGuess.getTime() - offsetMinutes * 60000);
  return utcDate.toISOString();
}

function getWindowForDelivery(deliveryDow) {
  if (deliveryDow === 3) {
    return {
      label: 'Wednesday 5 PM - 8 PM',
      startTime: '17:00',
      endTime: '20:00',
      bucket: 'tuesday_wednesday',
    };
  }

  if (deliveryDow === 6) {
    return {
      label: 'Saturday 12 PM - 3 PM',
      startTime: '12:00',
      endTime: '15:00',
      bucket: 'friday_saturday',
    };
  }

  throw new Error(`Unsupported delivery day: ${deliveryDow}`);
}

function buildSchedule(productionDate, cutoffWindowLabel, schedulingReason, inputTimestamp, chicagoParts) {
  const deliveryDate = addDays(productionDate, 1);
  const productionDateStr = toISODate(productionDate);
  const deliveryDateStr = toISODate(deliveryDate);
  const deliveryDow = deliveryDate.getDay();
  const window = getWindowForDelivery(deliveryDow);
  const deliveryWindowStart = localChicagoDateTimeToISO(deliveryDateStr, window.startTime);
  const deliveryWindowEnd = localChicagoDateTimeToISO(deliveryDateStr, window.endTime);

  return {
    ok: true,
    input_timestamp: inputTimestamp,
    chicago_time: chicagoParts?.chicagoTime || null,
    day_of_week: chicagoParts ? DAY_NAMES[chicagoParts.dow] : null,
    production_date: productionDateStr,
    assigned_production_day: productionDateStr,
    delivery_date: deliveryDateStr,
    assigned_delivery_date: deliveryDateStr,
    delivery_window_label: window.label,
    delivery_window_start: deliveryWindowStart,
    delivery_window_end: deliveryWindowEnd,
    assigned_delivery_window_start: deliveryWindowStart,
    assigned_delivery_window_end: deliveryWindowEnd,
    delivery_window_timezone: TIMEZONE,
    final_schedule_source: FINAL_SCHEDULE_SOURCE,
    cutoff_window_label: cutoffWindowLabel,
    schedule_reason: schedulingReason,
    scheduling_reason: schedulingReason,
    schedule_timezone: TIMEZONE,
    timezone: TIMEZONE,
    bucket: window.bucket,
  };
}

function calculateSchedule(inputTimestamp) {
  const parts = getChicagoParts(inputTimestamp);
  const { year, month, day, hour, minute, second, dow } = parts;
  const timeInSeconds = hour * 3600 + minute * 60 + second;
  const cutoffInSeconds = 14 * 3600;
  const isAfterCutoff = timeInSeconds > cutoffInSeconds;

  let productionDate;
  let cutoffWindowLabel;
  let schedulingReason;

  if (dow === 5 && !isAfterCutoff) {
    productionDate = new Date(year, month, day);
    cutoffWindowLabel = 'Friday before/at 2:00 PM';
    schedulingReason = 'Friday at/before cutoff -> Friday production, Saturday delivery';
  } else if (dow === 5 && isAfterCutoff) {
    productionDate = addDays(new Date(year, month, day), 4);
    cutoffWindowLabel = 'Friday after 2:00 PM';
    schedulingReason = 'Friday after cutoff -> next Tuesday production, Wednesday delivery';
  } else if (dow === 6 || dow === 0 || dow === 1) {
    const daysToNextTuesday = (2 - dow + 7) % 7 || 7;
    productionDate = addDays(new Date(year, month, day), daysToNextTuesday);
    cutoffWindowLabel = `${DAY_NAMES[dow]} before Tuesday 2:00 PM cutoff`;
    schedulingReason = `${DAY_NAMES[dow]} -> next Tuesday production, Wednesday delivery`;
  } else if (dow === 2 && !isAfterCutoff) {
    productionDate = new Date(year, month, day);
    cutoffWindowLabel = 'Tuesday before/at 2:00 PM';
    schedulingReason = 'Tuesday at/before cutoff -> Tuesday production, Wednesday delivery';
  } else if (dow === 2 && isAfterCutoff) {
    productionDate = addDays(new Date(year, month, day), 3);
    cutoffWindowLabel = 'Tuesday after 2:00 PM';
    schedulingReason = 'Tuesday after cutoff -> Friday production, Saturday delivery';
  } else if (dow === 3 || dow === 4) {
    const daysToNextFriday = (5 - dow + 7) % 7 || 7;
    productionDate = addDays(new Date(year, month, day), daysToNextFriday);
    cutoffWindowLabel = `${DAY_NAMES[dow]} after Tuesday 2:00 PM cutoff`;
    schedulingReason = `${DAY_NAMES[dow]} -> next Friday production, Saturday delivery`;
  } else {
    throw new Error('Unable to determine schedule window');
  }

  return buildSchedule(productionDate, cutoffWindowLabel, schedulingReason, inputTimestamp, parts);
}

function nextProductionDate(productionDateStr) {
  const current = new Date(`${productionDateStr}T12:00:00`);
  const dow = current.getDay();
  if (dow === 2) return addDays(current, 3);
  if (dow === 5) return addDays(current, 4);
  throw new Error(`Invalid production date for cadence: ${productionDateStr}`);
}

function optionFromSchedule(schedule, isDefault = false) {
  return {
    option_id: `${FINAL_SCHEDULE_SOURCE}:${schedule.production_date}:${schedule.delivery_date}`,
    production_date: schedule.production_date,
    delivery_date: schedule.delivery_date,
    delivery_window_label: schedule.delivery_window_label,
    delivery_window_start: schedule.delivery_window_start,
    delivery_window_end: schedule.delivery_window_end,
    cutoff_window_label: schedule.cutoff_window_label,
    final_schedule_source: FINAL_SCHEDULE_SOURCE,
    scheduling_reason: schedule.scheduling_reason,
    is_default: isDefault,
  };
}

function getScheduleOptions(firstSchedule, count = 2) {
  const safeCount = Math.min(Math.max(Number(count) || 2, 1), 4);
  const options = [optionFromSchedule(firstSchedule, true)];
  let cursor = firstSchedule.production_date;

  while (options.length < safeCount) {
    const productionDate = nextProductionDate(cursor);
    const schedule = buildSchedule(
      productionDate,
      'Backend cadence option',
      'Upcoming backend cadence option',
      firstSchedule.input_timestamp,
      null
    );
    options.push(optionFromSchedule(schedule, false));
    cursor = schedule.production_date;
  }

  return options;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    try {
      await base44.auth.me();
    } catch {
      // Public call allowed for checkout scheduling and test execution.
    }

    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body || {};
    const { created_at, checkout_completed_at, paid_at, mode, option_count } = body;
    const inputTimestamp = created_at || checkout_completed_at || paid_at;

    if (!inputTimestamp) {
      return Response.json({ ok: false, error: 'Missing timestamp: created_at, checkout_completed_at, or paid_at required' }, { status: 400 });
    }

    const schedule = calculateSchedule(inputTimestamp);

    if (mode === 'options' || body.options === true || body.return_options === true) {
      return Response.json({
        ok: true,
        timezone: TIMEZONE,
        generated_at: new Date().toISOString(),
        options: getScheduleOptions(schedule, option_count),
      });
    }

    console.log(`[CalcSchedule] Result: ${schedule.production_date} (prod) -> ${schedule.delivery_date} (${schedule.delivery_window_label})`);
    return Response.json(schedule);
  } catch (error) {
    console.error('[CalcSchedule] Error:', error.message);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});
