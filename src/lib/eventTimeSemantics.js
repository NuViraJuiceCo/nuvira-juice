export const EVENT_DISPLAY_TIME_TBD = 'Time TBD';
export const EVENT_DISPLAY_ALL_DAY = 'All day';
export const DEFAULT_EVENT_TIME_ZONE = 'America/Chicago';

const BROAD_OPERATIONAL_WINDOW_START_MINUTES = 7 * 60;
const BROAD_OPERATIONAL_WINDOW_END_MINUTES = 19 * 60;

function text(value) {
  return (value ?? '').toString().trim().replace(/\s+/g, ' ');
}

function lower(value) {
  return text(value).toLowerCase();
}

function firstText(...values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return '';
}

function isExplicitAllDayValue(value) {
  const normalized = lower(value);
  return normalized === 'all day' || normalized === 'all-day' || normalized === 'date only' || normalized === 'date-only';
}

function isTimeTbdValue(value) {
  const normalized = lower(value);
  return !normalized || ['tbd', 'time tbd', 'to be determined', 'pending', 'unknown'].includes(normalized);
}

export function isAllDayEvent(event = {}) {
  return event.all_day === true
    || event.is_all_day === true
    || event.date_only === true
    || lower(event.time_type) === 'all_day'
    || lower(event.time_type) === 'date_only'
    || isExplicitAllDayValue(event.time)
    || isExplicitAllDayValue(event.time_label)
    || isExplicitAllDayValue(event.display_time);
}

export function parseTimeToken(value) {
  const normalized = lower(value)
    .replace(/\./g, '')
    .replace(/\s+/g, '')
    .replace(/^0+(\d)/, '$1');

  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[3] || '';

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  if (meridiem === 'am') {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
  } else if (meridiem === 'pm') {
    if (hour < 1 || hour > 12) return null;
    if (hour !== 12) hour += 12;
  } else if (hour < 0 || hour > 23) {
    return null;
  }

  return hour * 60 + minute;
}

export function parseTimeRange(value) {
  const normalized = text(value)
    .replace(/\bto\b/gi, '-')
    .replace(/[–—]/g, '-');

  const parts = normalized.split('-').map(part => part.trim()).filter(Boolean);
  if (parts.length !== 2) return null;

  const start = parseTimeToken(parts[0]);
  const end = parseTimeToken(parts[1]);
  if (start === null || end === null) return null;

  return { start, end };
}

export function isBroadOperationalWindow(value) {
  const normalized = lower(value);
  if (!normalized) return false;
  if (normalized.includes('business hours') || normalized.includes('operational window')) return true;

  const range = parseTimeRange(normalized);
  if (!range) return false;

  return range.start === BROAD_OPERATIONAL_WINDOW_START_MINUTES
    && range.end === BROAD_OPERATIONAL_WINDOW_END_MINUTES;
}

export function formatMinutes(minutes) {
  if (!Number.isFinite(minutes)) return '';
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const meridiem = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${meridiem}`;
}

function normalizeTimeLabel(value) {
  const normalized = text(value);
  if (!normalized) return '';
  if (isExplicitAllDayValue(normalized)) return EVENT_DISPLAY_ALL_DAY;
  if (isTimeTbdValue(normalized)) return EVENT_DISPLAY_TIME_TBD;
  if (isBroadOperationalWindow(normalized)) return EVENT_DISPLAY_TIME_TBD;

  const range = parseTimeRange(normalized);
  if (range) return `${formatMinutes(range.start)} – ${formatMinutes(range.end)}`;

  const single = parseTimeToken(normalized);
  if (single !== null) return formatMinutes(single);

  return normalized;
}

function timeFromDateTime(value, timeZone = DEFAULT_EVENT_TIME_ZONE) {
  const normalized = text(value);
  if (!normalized) return '';

  const localMatch = normalized.match(/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/);
  if (localMatch) return localMatch[1];

  if (/^\d{4}-\d{2}-\d{2}T/.test(normalized)) {
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        minute: '2-digit',
      }).format(date);
    }
  }

  return '';
}

function resolveStartTime(event, timeZone) {
  return firstText(
    event.start_time,
    event.startTime,
    event.start_at_time,
    event.startAtTime,
    timeFromDateTime(event.start_datetime || event.startDateTime || event.start_at || event.startAt, timeZone),
  );
}

function resolveEndTime(event, timeZone) {
  return firstText(
    event.end_time,
    event.endTime,
    event.end_at_time,
    event.endAtTime,
    timeFromDateTime(event.end_datetime || event.endDateTime || event.end_at || event.endAt, timeZone),
  );
}

function rangeFromRawTime(rawTime) {
  if (!rawTime || isBroadOperationalWindow(rawTime)) return null;
  return parseTimeRange(rawTime);
}

function datePart(value) {
  const normalized = text(value);
  if (!normalized) return '';
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function eventDate(event = {}) {
  return firstText(
    datePart(event.date),
    datePart(event.event_date),
    datePart(event.start_datetime),
    datePart(event.startDateTime),
    datePart(event.start_at),
    datePart(event.startAt),
  );
}

function toLocalDateTime(date, minutes) {
  if (!date || !Number.isFinite(minutes)) return undefined;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

function structuredDateTimeFromExplicit(value) {
  const normalized = text(value);
  if (!normalized) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T/.test(normalized)) return normalized;
  return undefined;
}

export function resolveEventTimeSemantics(event = {}, options = {}) {
  const timeZone = text(options.timeZone || event.timezone || event.time_zone) || DEFAULT_EVENT_TIME_ZONE;

  if (isAllDayEvent(event)) {
    return {
      displayTime: EVENT_DISPLAY_ALL_DAY,
      timeZone,
      allDay: true,
      hasReliableTime: false,
      ambiguousTime: false,
      source: 'all_day',
    };
  }

  const displayLabel = firstText(event.time_label, event.display_time, event.event_time_label);
  if (displayLabel) {
    const normalizedLabel = normalizeTimeLabel(displayLabel);
    return {
      displayTime: normalizedLabel,
      timeZone,
      allDay: normalizedLabel === EVENT_DISPLAY_ALL_DAY,
      hasReliableTime: normalizedLabel !== EVENT_DISPLAY_TIME_TBD && normalizedLabel !== EVENT_DISPLAY_ALL_DAY,
      ambiguousTime: normalizedLabel === EVENT_DISPLAY_TIME_TBD,
      source: normalizedLabel === EVENT_DISPLAY_TIME_TBD ? 'ambiguous_label' : 'explicit_label',
    };
  }

  const startTime = resolveStartTime(event, timeZone);
  const endTime = resolveEndTime(event, timeZone);
  if (startTime && endTime) {
    const normalizedStart = normalizeTimeLabel(startTime);
    const normalizedEnd = normalizeTimeLabel(endTime);
    if (normalizedStart !== EVENT_DISPLAY_TIME_TBD && normalizedEnd !== EVENT_DISPLAY_TIME_TBD) {
      return {
        displayTime: `${normalizedStart} – ${normalizedEnd}`,
        timeZone,
        allDay: false,
        hasReliableTime: true,
        ambiguousTime: false,
        source: 'explicit_start_end',
      };
    }
  }

  if (startTime) {
    const normalizedStart = normalizeTimeLabel(startTime);
    if (normalizedStart !== EVENT_DISPLAY_TIME_TBD) {
      return {
        displayTime: normalizedStart,
        timeZone,
        allDay: false,
        hasReliableTime: true,
        ambiguousTime: false,
        source: 'explicit_start',
      };
    }
  }

  const rawTime = firstText(event.time);
  if (rawTime) {
    const normalizedRaw = normalizeTimeLabel(rawTime);
    return {
      displayTime: normalizedRaw,
      timeZone,
      allDay: normalizedRaw === EVENT_DISPLAY_ALL_DAY,
      hasReliableTime: normalizedRaw !== EVENT_DISPLAY_TIME_TBD && normalizedRaw !== EVENT_DISPLAY_ALL_DAY,
      ambiguousTime: normalizedRaw === EVENT_DISPLAY_TIME_TBD,
      source: normalizedRaw === EVENT_DISPLAY_TIME_TBD ? 'ambiguous_raw_time' : 'raw_time',
    };
  }

  return {
    displayTime: EVENT_DISPLAY_TIME_TBD,
    timeZone,
    allDay: false,
    hasReliableTime: false,
    ambiguousTime: true,
    source: 'missing_time',
  };
}

export function eventStructuredDateTimes(event = {}, options = {}) {
  const date = eventDate(event);
  const timeZone = text(options.timeZone || event.timezone || event.time_zone) || DEFAULT_EVENT_TIME_ZONE;
  const semantics = resolveEventTimeSemantics(event, { timeZone });

  if (!date) return { startDate: undefined, endDate: undefined, timeZone, semantics };

  if (semantics.allDay || !semantics.hasReliableTime) {
    return { startDate: date, endDate: undefined, timeZone, semantics };
  }

  const explicitStart = structuredDateTimeFromExplicit(event.start_datetime || event.startDateTime || event.start_at || event.startAt);
  const explicitEnd = structuredDateTimeFromExplicit(event.end_datetime || event.endDateTime || event.end_at || event.endAt);
  if (explicitStart) {
    return { startDate: explicitStart, endDate: explicitEnd, timeZone, semantics };
  }

  const range = rangeFromRawTime(event.time);
  if (range) {
    return {
      startDate: toLocalDateTime(date, range.start),
      endDate: toLocalDateTime(date, range.end),
      timeZone,
      semantics,
    };
  }

  const startMinutes = parseTimeToken(resolveStartTime(event, timeZone) || event.time);
  const endMinutes = parseTimeToken(resolveEndTime(event, timeZone));

  return {
    startDate: toLocalDateTime(date, startMinutes),
    endDate: endMinutes === null ? undefined : toLocalDateTime(date, endMinutes),
    timeZone,
    semantics,
  };
}
