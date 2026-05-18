/**
 * Delivery Availability Session State
 * Stores the customer's ZIP check result for the current session.
 * Uses sessionStorage so it resets on browser close, not on navigation.
 */

const SESSION_KEY = 'nuvira_delivery_availability';

export function getDeliveryAvailability() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setDeliveryAvailability(data) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      ...data,
      last_checked_at: new Date().toISOString(),
    }));
  } catch {}
}

export function clearDeliveryAvailability() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {}
}

/**
 * Returns true if the given ZIP was already checked in this session.
 */
export function wasZipChecked(zip) {
  const saved = getDeliveryAvailability();
  return saved?.checked_zip_code === zip;
}

/**
 * Returns the ZIP code that was checked in this session, or null.
 */
export function getCheckedZip() {
  return getDeliveryAvailability()?.checked_zip_code || null;
}

/**
 * Returns the current eligibility status: 'unknown' | 'eligible' | 'ineligible'
 */
export function getEligibilityStatus() {
  return getDeliveryAvailability()?.delivery_eligibility_status || 'unknown';
}