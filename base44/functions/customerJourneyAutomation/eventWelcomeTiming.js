export const EVENT_WELCOME_DELAY_HOURS = 2;
export const EVENT_WELCOME_RECONCILIATION_HOURS = 48;
export const EVENT_TIME_ZONE = 'America/Chicago';

function text(value, maxLength = 240) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function eventKey(value) {
  const normalized = text(value, 120).toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{4,119}$/.test(normalized) ? normalized : '';
}

function calendarDate(value) {
  const normalized = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return '';
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === normalized ? normalized : '';
}

function clockTime(value) {
  const normalized = text(value, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) return '';
  return normalized;
}

function addLocalDays(dateValue, days) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function offsetMinutesForZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return Math.round((representedAsUtc - date.getTime()) / 60000);
}

export function chicagoLocalDateTime(dateValue, timeValue) {
  const date = calendarDate(dateValue);
  const time = clockTime(timeValue);
  if (!date || !time) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let instant = new Date(localAsUtc);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = offsetMinutesForZone(instant, EVENT_TIME_ZONE);
    const adjusted = new Date(localAsUtc - offset * 60000);
    if (adjusted.getTime() === instant.getTime()) break;
    instant = adjusted;
  }
  return Number.isFinite(instant.getTime()) ? instant : null;
}

export function scheduledEventWelcomeConfig(event) {
  if (event?.event_welcome_enabled !== true || event?.is_active === false) {
    return { valid: false, reason: 'event_welcome_not_enabled' };
  }

  const date = calendarDate(event?.date);
  const startTime = clockTime(event?.start_time || event?.time);
  const endTime = clockTime(event?.end_time);
  const key = eventKey(event?.event_welcome_key || event?.hub_event_id || event?.id);
  const name = text(event?.title, 180);
  const location = text(event?.location, 240);
  const shopifyLocationId = text(event?.shopify_pos_location_id, 160);
  if (!date || !startTime || !endTime || !key || !name || !location || !shopifyLocationId) {
    return { valid: false, reason: 'event_welcome_configuration_incomplete' };
  }

  const start = chicagoLocalDateTime(date, startTime);
  let endDate = date;
  let end = chicagoLocalDateTime(endDate, endTime);
  if (start && end && end.getTime() <= start.getTime()) {
    endDate = addLocalDays(date, 1);
    end = chicagoLocalDateTime(endDate, endTime);
  }
  if (!start || !end || end.getTime() <= start.getTime()) {
    return { valid: false, reason: 'event_welcome_window_invalid' };
  }
  if (end.getTime() - start.getTime() > 18 * 60 * 60 * 1000) {
    return { valid: false, reason: 'event_welcome_window_too_wide' };
  }

  const sendAfter = new Date(end.getTime() + EVENT_WELCOME_DELAY_HOURS * 60 * 60 * 1000);
  const eventDateLabel = start.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: EVENT_TIME_ZONE,
  });
  return {
    valid: true,
    reason: 'configured',
    config: {
      event_key: key,
      event_name: name,
      event_date: eventDateLabel,
      event_location: location,
      shopify_pos_location_id: shopifyLocationId,
      window_start: start,
      window_end: end,
      send_after_at: sendAfter,
    },
  };
}

export function scheduledEventWelcomeDecision(event, nowValue = new Date()) {
  const configured = scheduledEventWelcomeConfig(event);
  if (!configured.valid) return { ...configured, due: false, recheck: false };
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  if (!Number.isFinite(now.getTime())) {
    return { valid: false, reason: 'evaluation_time_invalid', due: false, recheck: false };
  }
  const { config } = configured;
  if (now.getTime() < config.send_after_at.getTime()) {
    return { ...configured, due: false, recheck: true, reason: 'event_welcome_not_due' };
  }
  const reconciliationEndsAt = new Date(
    config.send_after_at.getTime() + EVENT_WELCOME_RECONCILIATION_HOURS * 60 * 60 * 1000,
  );
  if (now.getTime() > reconciliationEndsAt.getTime()) {
    return {
      ...configured,
      due: false,
      recheck: false,
      reason: 'event_welcome_reconciliation_window_closed',
      reconciliation_ends_at: reconciliationEndsAt,
    };
  }
  return {
    ...configured,
    due: true,
    recheck: true,
    reason: 'event_welcome_due',
    reconciliation_ends_at: reconciliationEndsAt,
  };
}
