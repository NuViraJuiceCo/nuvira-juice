export const BIRTHDAY_CHECKOUT_REVISION = '2026-09-08.birthday-entitlement-v1';
const unavailable = 'We could not confirm your birthday reward. Please try again or contact NuVira support.';

export async function readBirthdayEligibility(invoke, { timeoutMs = 10000 } = {}) {
  let timer;
  try {
    const response = await Promise.race([
      Promise.resolve().then(() => invoke('createPaymentIntent', { mode: 'birthday_checkout_eligibility' })),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(unavailable)), timeoutMs); }),
    ]);
    const data = response?.data || response;
    if (data?.ok !== true || data.revision !== BIRTHDAY_CHECKOUT_REVISION
      || data.writes_performed !== false || data.provider_calls_performed !== false
      || typeof data.eligibility?.eligible !== 'boolean' || typeof data.eligibility.status !== 'string'
      || (data.eligibility.eligible && data.eligibility.status !== 'available')) throw new Error(unavailable);
    return { eligible: data.eligibility.eligible, status: data.eligibility.status };
  } catch { throw new Error(unavailable); }
  finally { clearTimeout(timer); }
}

export function birthdayEligibilityMessage({ status }) {
  if (status === 'available') return 'Choose one free 12oz juice. It counts toward your order minimum.';
  if (status === 'checking') return 'Checking your birthday reward…';
  if (status === 'already_redeemed') return 'You have already enjoyed this year’s birthday juice.';
  if (status === 'checkout_in_progress') return 'Your birthday juice is reserved in an unfinished checkout. Resume or cancel that checkout first.';
  if (status === 'birthday_missing') return 'Add your birthday in Settings for a future birthday reward.';
  if (status === 'outside_birthday_window' || status === 'signup_not_before_birthday') return 'One free 12oz juice during your eligible birthday window, through 30 days afterward.';
  return unavailable;
}
