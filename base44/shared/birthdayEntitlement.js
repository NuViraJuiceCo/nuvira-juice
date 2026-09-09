// Server-side birthday entitlement policy. Pure/injected-clock code; this module
// neither trusts a browser eligibility flag nor invokes a payment provider.
export const BIRTHDAY_ENTITLEMENT_REVISION = '2026-09-08.birthday-entitlement-v1';
export const BIRTHDAY_TIME_ZONE = 'America/Chicago';
export class BirthdayEntitlementError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new BirthdayEntitlementError(code); };
const DAY = 86400000;
const id = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(value);
// Base44 created_date uses microseconds; preserve strict date/time/zone checks
// while accepting its six-digit fractional seconds as well as JS milliseconds.
const timestamp = value => typeof value === 'string'
  && /^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
  && day(value.slice(0, 10)) !== null && Number.isFinite(Date.parse(value));
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms / DAY : null;
}
const dayText = value => new Date(value * DAY).toISOString().slice(0, 10);
function localDay(value) {
  if ((typeof value !== 'number' && !timestamp(value)) || value === null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: BIRTHDAY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return day(`${parts.year}-${parts.month}-${parts.day}`);
}
function anniversary(year, monthDay) {
  // Preserve the existing Date/setYear behavior: February 29 becomes March 1
  // in a non-leap year. Never let the device timezone move the anniversary.
  return day(`${year}-${monthDay}`) ?? (monthDay === '02-29' ? day(`${year}-03-01`) : null);
}
export function birthdayWindow({ birthday, signupDate, now = Date.now() }) {
  if (!birthday) return { eligible: false, status: 'birthday_missing' };
  const birthDay = day(birthday);
  const today = localDay(now);
  const signup = timestamp(signupDate) ? localDay(signupDate) : null;
  if (birthDay === null || today === null || signup === null || birthDay > today || signup > today) {
    return { eligible: false, status: 'birthday_verification_required' };
  }
  const monthDay = birthday.slice(5);
  const year = Number(dayText(today).slice(0, 4));
  for (const cycleYear of [year, year - 1]) {
    const start = anniversary(cycleYear, monthDay);
    if (start !== null && start > signup && today >= start && today <= start + 30) {
      return { eligible: true, status: 'available', cycle_year: cycleYear, month_day: monthDay,
        window_start: dayText(start), window_end: dayText(start + 30) };
    }
  }
  return { eligible: false, status: 'outside_birthday_window' };
}

export function assertBirthdayWindow(request) {
  const start = Number.isInteger(request?.cycle_year) && request.cycle_year >= 1900 && request.cycle_year <= 9998
    && typeof request.month_day === 'string' && day(`2000-${request.month_day}`) !== null
    ? anniversary(request.cycle_year, request.month_day) : null;
  if (start === null || request.window_start !== dayText(start) || request.window_end !== dayText(start + 30)) {
    fail('invalid_birthday_window');
  }
}
export function birthdayReservationBinding(request) {
  assertBirthdayWindow(request);
  const noPayment = Boolean(request?.checkout_session_id);
  if (!/^birthday:[a-f0-9]{64}$/.test(request?.reservation_id || '')
    || !/^[a-f0-9]{64}$/.test(request?.context_hash || '')
    || !id(request?.customer_app_user_id) || !id(request?.product_id) || request.product_id.startsWith('__')
    || !Number.isSafeInteger(request?.retail_value_cents) || request.retail_value_cents <= 0
    || (noPayment ? !/^cs_[A-Za-z0-9_]+$/.test(request.checkout_session_id) || Boolean(request.payment_intent_id)
      : !/^pi_[A-Za-z0-9_]+$/.test(request?.payment_intent_id || ''))) {
    fail('invalid_birthday_reservation');
  }
  return Object.fromEntries(['reservation_id', 'context_hash', 'customer_app_user_id', 'product_id',
    'retail_value_cents', noPayment ? 'checkout_session_id' : 'payment_intent_id', 'cycle_year', 'month_day', 'window_start', 'window_end']
    .map(key => [key, request[key]]));
}

export function birthdayReservationState(account) {
  const holds = account.birthday_reservations === undefined ? [] : account.birthday_reservations;
  if (!Array.isArray(holds)) fail('invalid_birthday_reservations');
  const ids = new Set(); const payments = new Set(); const activeCycles = new Set();
  let owner; let monthDay;
  for (const hold of holds) {
    birthdayReservationBinding(hold);
    if (!['held', 'consumed', 'released'].includes(hold.status) || !timestamp(hold.created_at)
      || (hold.status === 'held' ? hold.settled_at != null : !timestamp(hold.settled_at))
      || (hold.settled_at && Date.parse(hold.settled_at) < Date.parse(hold.created_at))
      || (hold.status !== 'released' && (localDay(hold.created_at) < day(hold.window_start)
        || localDay(hold.created_at) > day(hold.window_end)))
      || ids.has(hold.reservation_id) || payments.has(hold.checkout_session_id || hold.payment_intent_id)
      || (owner && owner !== hold.customer_app_user_id) || (monthDay && monthDay !== hold.month_day)
      || (hold.status !== 'released' && activeCycles.has(hold.cycle_year))) fail('invalid_birthday_reservations');
    ids.add(hold.reservation_id); payments.add(hold.checkout_session_id || hold.payment_intent_id);
    if (hold.status !== 'released') activeCycles.add(hold.cycle_year);
    owner = hold.customer_app_user_id; monthDay = hold.month_day;
  }
  return { holds, owner, monthDay };
}

export function birthdayAvailability(account, identity, now = Date.now()) {
  const state = birthdayReservationState(account);
  if (!id(identity?.userId)) return { eligible: false, status: 'birthday_verification_required' };
  const window = birthdayWindow({ ...identity, now });
  if (state.owner && (state.owner !== identity.userId || state.monthDay !== identity.birthday?.slice(5))) {
    return { eligible: false, status: 'birthday_profile_review_required' };
  }
  if (!window.eligible) return window;
  const current = state.holds.find(hold => hold.cycle_year === window.cycle_year && hold.status !== 'released');
  return current ? { ...window, eligible: false, status: current.status === 'consumed' ? 'already_redeemed' : 'checkout_in_progress' } : window;
}

function sameBinding(hold, request) {
  if (Object.entries(birthdayReservationBinding(request)).some(([key, value]) => hold[key] !== value)) fail('birthday_reservation_context_conflict');
}
export function reserveBirthdayOperation(account, request, identity, now = Date.now()) {
  const requested = birthdayReservationBinding(request);
  const state = birthdayReservationState(account);
  if (identity?.userId !== requested.customer_app_user_id) fail('birthday_owner_mismatch');
  const existing = state.holds.find(hold => hold.reservation_id === requested.reservation_id);
  if (existing) {
    sameBinding(existing, requested);
    if (existing.status === 'released') fail('birthday_reservation_already_released');
    if (!(requested.checkout_session_id ? ['open', 'complete'] : ['requires_payment_method', 'requires_confirmation', 'requires_action', 'succeeded']).includes(request.provider_status)) {
      fail('birthday_payment_not_reservable');
    }
    // Same-provider retries use the saved entitlement even after its window
    // closes. They cannot grant a second gift or change the selected bottle.
    return { reservation: existing };
  }
  if (!(requested.checkout_session_id ? ['open'] : ['requires_payment_method', 'requires_confirmation', 'requires_action']).includes(request.provider_status)) {
    fail('birthday_payment_not_reservable');
  }
  const available = birthdayAvailability(account, identity, now);
  if (!available.eligible) fail(available.status);
  for (const field of ['cycle_year', 'month_day', 'window_start', 'window_end']) {
    if (requested[field] !== available[field]) fail('birthday_entitlement_changed');
  }
  const reservation = { ...requested, status: 'held', created_at: new Date(now).toISOString() };
  return { reservation, patch: { birthday_reservations: [...state.holds, reservation] } };
}

// Only a caller with fresh provider + private checkout proof may settle. A
// decline, timeout, expiry of the birthday window or refund is NOT cancellation.
export function settleBirthdayOperation(account, request, now = Date.now()) {
  const requested = birthdayReservationBinding(request);
  if (!(requested.checkout_session_id ? ['complete', 'expired'] : ['succeeded', 'canceled']).includes(request.provider_status)) fail('confirmed_birthday_payment_outcome_required');
  const state = birthdayReservationState(account);
  const existing = state.holds.find(hold => hold.reservation_id === requested.reservation_id);
  const status = ['succeeded', 'complete'].includes(request.provider_status)
    && !(requested.checkout_session_id && request.route_review_outcome === 'released') ? 'consumed' : 'released';
  const settledAt = new Date(now).toISOString();
  if (!existing) {
    if (status !== 'released') fail('birthday_reservation_missing');
    // A cancellation may win before preparation reserves. This terminal
    // tombstone prevents an older reservable-provider read from re-holding.
    const reservation = { ...requested, status, created_at: settledAt, settled_at: settledAt };
    return { reservation, patch: { birthday_reservations: [...state.holds, reservation] } };
  }
  sameBinding(existing, requested);
  if (existing.status === status) return { reservation: existing };
  if (existing.status !== 'held') fail('birthday_reservation_outcome_conflict');
  const reservation = { ...existing, status, settled_at: settledAt };
  return { reservation, patch: { birthday_reservations: state.holds.map(hold => hold === existing ? reservation : hold) } };
}
