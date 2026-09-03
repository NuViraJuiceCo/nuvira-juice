const STORAGE_KEY = 'nuvira_guest_loyalty_activation';
const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanText(value, maxLength) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function storage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage || null;
  } catch {
    return null;
  }
}

export function purchasePointsForTotal(total) {
  const amount = Number(total);
  return Number.isFinite(amount) && amount > 0 ? Math.floor(amount * 10) : 0;
}

export function saveGuestLoyaltyActivationContext(value = {}) {
  const customerEmail = normalizeEmail(value.customer_email);
  if (!isValidEmail(customerEmail)) return null;

  const explicitPoints = Number(value.purchase_points ?? value.earned_points);
  const context = {
    customer_email: customerEmail,
    customer_name: cleanText(value.customer_name, 180),
    contact_phone: cleanText(value.contact_phone, 40),
    order_number: cleanText(value.order_number, 120).toUpperCase(),
    purchase_points: Number.isFinite(explicitPoints) && explicitPoints >= 0
      ? Math.floor(explicitPoints)
      : purchasePointsForTotal(value.total),
    guest_order_token: cleanText(value.guest_order_token, 180),
    saved_at: Date.now(),
  };

  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(context));
  } catch {
    return null;
  }
  return context;
}

export function readGuestLoyaltyActivationContext() {
  const target = storage();
  if (!target) return null;
  try {
    const context = JSON.parse(target.getItem(STORAGE_KEY) || 'null');
    const savedAt = Number(context?.saved_at);
    if (!context || !isValidEmail(context.customer_email) || !Number.isFinite(savedAt) || Date.now() - savedAt > ACTIVATION_TTL_MS) {
      target.removeItem(STORAGE_KEY);
      return null;
    }
    return context;
  } catch {
    try { target.removeItem(STORAGE_KEY); } catch {}
    return null;
  }
}

export function clearGuestLoyaltyActivationContext() {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Activation context is a convenience only; account and points remain authoritative server-side.
  }
}

export function guestActivationMatchesUser(context, userEmail) {
  const authenticatedEmail = normalizeEmail(userEmail);
  if (!context || !authenticatedEmail) return false;
  return normalizeEmail(context.customer_email) === authenticatedEmail
    || authenticatedEmail.endsWith('@privaterelay.appleid.com');
}

export function splitGuestCustomerName(value) {
  const parts = cleanText(value, 180).split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] || '',
    last_name: parts.slice(1).join(' '),
  };
}

export const GUEST_LOYALTY_ACTIVATION_RETURN_ROUTE = '/rewards?activated=1';
