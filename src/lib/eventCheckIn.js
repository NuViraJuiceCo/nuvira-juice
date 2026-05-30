export const EVENT_CHECKIN_KEY = 'may30_event_visit';
export const EVENT_CHECKIN_BONUS_POINTS = 250;

export const EVENT_CHECKIN_SESSIONS = [
  {
    id: 'simply_wurth_grand_opening',
    title: 'Simply Wurth It Grand Opening',
    date_label: 'May 30',
    time_label: '12:00 PM - 2:00 PM',
    place: 'Simply Wurth It',
    address: "856 Waterbury Falls Dr, O'Fallon, MO 63368",
    code: 'swi-grand-opening-nvj-4f8k',
    starts_at: '2026-05-30T12:00:00-05:00',
    ends_at: '2026-05-30T14:00:00-05:00',
    claim_starts_at: '2026-05-30T11:30:00-05:00',
    claim_ends_at: '2026-05-30T14:30:00-05:00',
    latitude: 38.7213287,
    longitude: -90.6976938,
    radius_meters: 230,
  },
  {
    id: 'missouri_spirit_festival',
    title: 'Missouri Spirit Festival',
    date_label: 'May 30',
    time_label: '3:00 PM - 7:00 PM',
    place: 'Missouri Spirit Festival',
    address: '5521 Water St, Augusta, MO 63332',
    code: 'missouri-spirit-nvj-9p2m',
    starts_at: '2026-05-30T15:00:00-05:00',
    ends_at: '2026-05-30T19:00:00-05:00',
    claim_starts_at: '2026-05-30T14:30:00-05:00',
    claim_ends_at: '2026-05-30T19:30:00-05:00',
    latitude: 38.5705055,
    longitude: -90.8803494,
    radius_meters: 230,
  },
  {
    id: 'goddard_school',
    title: 'Goddard School',
    date_label: 'June 1',
    time_label: '5:30 PM - 6:30 PM',
    place: 'The Goddard School',
    address: "9008 Phoenix Pkwy, O'Fallon, MO 63368",
    code: 'goddard-school-nvj-7xq3',
    starts_at: '2026-06-01T17:30:00-05:00',
    ends_at: '2026-06-01T18:30:00-05:00',
    claim_starts_at: '2026-06-01T17:00:00-05:00',
    claim_ends_at: '2026-06-01T19:00:00-05:00',
    latitude: 38.7506149,
    longitude: -90.7390200,
    radius_meters: 230,
  },
];

const EVENT_CHECKIN_DISPLAY_WINDOWS = [
  {
    starts_at: '2026-05-30T11:55:00-05:00',
    ends_at: '2026-05-30T14:00:00-05:00',
  },
  {
    starts_at: '2026-05-30T15:00:00-05:00',
    ends_at: '2026-05-30T19:00:00-05:00',
  },
  {
    starts_at: '2026-06-01T17:25:00-05:00',
    ends_at: '2026-06-01T18:30:00-05:00',
  },
];

function toMs(value) {
  return new Date(value).getTime();
}

export function normalizeEventCheckInCode(value) {
  return String(value || '').trim().toLowerCase();
}

export function getEventCheckInSessionByCode(code) {
  const normalizedCode = normalizeEventCheckInCode(code);
  if (!normalizedCode) return null;
  return EVENT_CHECKIN_SESSIONS.find((session) => session.code === normalizedCode) || null;
}

export function getEventCheckInStatus(now = new Date()) {
  const nowMs = now.getTime();
  const activeSession = EVENT_CHECKIN_SESSIONS.find((session) =>
    nowMs >= toMs(session.claim_starts_at) && nowMs <= toMs(session.claim_ends_at)
  ) || null;
  const nextSession = EVENT_CHECKIN_SESSIONS.find((session) => nowMs < toMs(session.claim_starts_at)) || null;
  const isDisplayVisible = EVENT_CHECKIN_DISPLAY_WINDOWS.some((window) =>
    nowMs >= toMs(window.starts_at) && nowMs <= toMs(window.ends_at)
  );
  const hasEnded = !activeSession && !nextSession;

  return {
    activeSession,
    nextSession,
    hasEnded,
    isDisplayVisible,
  };
}

export function isEventCheckInVisible(now = new Date()) {
  return getEventCheckInStatus(now).isDisplayVisible;
}
