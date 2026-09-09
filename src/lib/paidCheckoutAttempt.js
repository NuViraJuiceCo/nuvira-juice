const prefix = 'nuvira_paid_checkout_attempt_v1:';
const keyPattern = /^[A-Za-z0-9_-]{20,200}$/;
const ownerPattern = /^(guest|account:[A-Za-z0-9._:-]{1,120})$/;
export const PAID_RECOVERY_REVISION = '2026-09-08.paid-checkout-recovery-v1';
const assert = value => { if (!value) throw new Error('paid_checkout_recovery_unconfirmed'); };
const storageKey = owner => { assert(ownerPattern.test(owner)); return `${prefix}${owner}`; };
export function readPaidCheckoutAttempt(storage, owner) {
  const raw = storage.getItem(storageKey(owner));
  if (raw === null) return null;
  const data = JSON.parse(raw);
  assert(data?.version === 1 && data.owner === owner && keyPattern.test(data.attempt_key || '')
    && /^NV-[A-F0-9]{24}$/.test(data.order_number || '') && Number.isSafeInteger(data.created_at) && data.created_at > 0
    && (owner === 'guest' ? keyPattern.test(data.guest_order_token || '') : data.guest_order_token === null));
  return data;
}
export async function savePaidCheckoutAttempt(storage, { owner, email, attemptKey, guestToken = null }, now = Date.now()) {
  assert(ownerPattern.test(owner) && keyPattern.test(attemptKey || '') && email === email.trim().toLowerCase()
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && Number.isSafeInteger(now) && now > 0);
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(`${email}:${attemptKey}`)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const data = { version: 1, owner, attempt_key: attemptKey, order_number: `NV-${digest.slice(0, 24).toUpperCase()}`,
    guest_order_token: owner === 'guest' ? guestToken : null, created_at: now };
  // Recheck after hashing. Never silently overwrite another attempt or expire
  // one by a local clock. This is not a cross-tab transaction guarantee.
  const prior = readPaidCheckoutAttempt(storage, owner);
  assert(!prior || (prior.attempt_key === attemptKey && prior.order_number === data.order_number
    && prior.guest_order_token === data.guest_order_token));
  assert(owner !== 'guest' || keyPattern.test(guestToken || ''));
  if (prior) data.created_at = prior.created_at;
  const raw = JSON.stringify(data);
  storage.setItem(storageKey(owner), raw);
  assert(storage.getItem(storageKey(owner)) === raw);
  return data;
}
export function clearPaidCheckoutAttempt(storage, attempt) {
  const prior = readPaidCheckoutAttempt(storage, attempt.owner);
  if (!prior) return;
  assert(prior.attempt_key === attempt.attempt_key && prior.order_number === attempt.order_number);
  storage.removeItem(storageKey(attempt.owner));
  assert(storage.getItem(storageKey(attempt.owner)) === null);
}
export function paidRecoveryRequest(attempt, mode) {
  assert(['read_paid_checkout_recovery', 'resume_paid_checkout', 'cancel_paid_checkout'].includes(mode));
  return { mode, checkout_idempotency_key: attempt.attempt_key, order_number: attempt.order_number,
    guest_checkout: attempt.owner === 'guest', guest_order_token: attempt.guest_order_token };
}
export async function requestPaidRecovery(invoke, attempt, mode, timeoutMs = 15000) {
  let timer;
  try {
    const response = await Promise.race([invoke(paidRecoveryRequest(attempt, mode)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('paid_recovery_timeout')), timeoutMs); })]);
    const data = response?.data;
    assert(data?.ok === true && data.revision === PAID_RECOVERY_REVISION && data.order_number === attempt.order_number
      && data.payment_confirmation_attempted === false);
    if (mode === 'cancel_paid_checkout') {
      assert(data.payment_attempt_canceled === true && data.benefit_reservations_released === true && data.order_cancelled === true);
    } else {
      assert(data.writes_performed === false && data.payment_intent_created === false && data.order_created === false
        && data.guest_checkout === (attempt.owner === 'guest') && data.currency === 'usd'
        && Number.isFinite(data.total) && data.total >= 0.5
        && ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture', 'succeeded', 'canceled'].includes(data.state)
        && Array.isArray(data.items) && data.items.length > 0 && data.items.length <= 50
        && data.items.every(item => typeof item?.title === 'string' && item.title.trim()
          && Number.isSafeInteger(item.quantity) && item.quantity > 0 && item.quantity <= 100
          && Number.isFinite(item.price) && item.price >= 0)
        && (data.delivery_date == null || /^\d{4}-\d{2}-\d{2}$/.test(data.delivery_date))
        && (data.delivery_window == null || typeof data.delivery_window === 'string'));
      if (mode === 'resume_paid_checkout') assert(/^pi_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+$/.test(data.clientSecret || '')
        && /^pk_live_[A-Za-z0-9]+$/.test(data.publishableKey || '')
        && ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(data.state));
      else assert(data.clientSecret == null);
    }
    return data;
  } finally { clearTimeout(timer); }
}
