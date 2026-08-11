/**
 * @typedef {Object} MarketingCadenceRules
 * @property {number} recipient_cooldown_hours
 * @property {number} recipient_weekly_cap
 * @property {number} transactional_quiet_hours
 * @property {number} review_request_cooldown_days
 * @property {number} abandoned_cart_cooldown_days
 * @property {number} delivery_followup_delay_hours
 * @property {number} delivery_followup_lookback_days
 */

/** @type {Readonly<MarketingCadenceRules>} */
export const DEFAULT_MARKETING_CADENCE_RULES = Object.freeze({
  recipient_cooldown_hours: 72,
  recipient_weekly_cap: 2,
  transactional_quiet_hours: 24,
  review_request_cooldown_days: 60,
  abandoned_cart_cooldown_days: 7,
  delivery_followup_delay_hours: 48,
  delivery_followup_lookback_days: 14,
});

function text(value, max = 320) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

export function normalizeMarketingEmail(value) {
  return text(value).toLowerCase();
}

export function internalOrPrivateEmail(value) {
  const email = normalizeMarketingEmail(value);
  return email.endsWith('@nuvirajuice.com')
    || email.endsWith('@privaterelay.appleid.com')
    || email.endsWith('@example.com')
    || /(^|[._+-])(test|demo|sandbox|internal)([._+-]|@)/i.test(email);
}

export function testOrder(order = {}) {
  if (order?.is_test_order === true) return true;
  const orderNumber = text(order?.order_number || order?.orderNumber || order?.id, 180);
  const source = text(order?.source || order?.source_type, 80);
  return /(^|[-_\s])(test|proof|sandbox|demo)([-_\s]|$)/i.test(orderNumber)
    || /(^|[-_\s])(test|proof|sandbox|demo)([-_\s]|$)/i.test(source);
}

function timestamp(value) {
  const parsed = new Date(String(value || '')).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function acceptedAt(event) {
  return timestamp(event?.resend_forwarded_at || event?.event_at || event?.created_date);
}

function within(nowMs, event, durationMs) {
  const at = acceptedAt(event);
  return at !== null && at <= nowMs && nowMs - at < durationMs;
}

/**
 * @param {{
 *   email?: unknown,
 *   eventName?: string,
 *   order?: Record<string, any>,
 *   recentEvents?: any[],
 *   recentTransactionalMessages?: any[],
 *   nowMs?: number,
 *   allowInternalProof?: boolean,
 *   rules?: MarketingCadenceRules,
 * }} input
 */
export function marketingCadenceDecision({
  email,
  eventName,
  order = {},
  recentEvents = [],
  recentTransactionalMessages = [],
  nowMs = Date.now(),
  allowInternalProof = false,
  rules = DEFAULT_MARKETING_CADENCE_RULES,
} = {}) {
  if (allowInternalProof) return { allowed: true, reason: 'internal_proof_authorized' };
  if (internalOrPrivateEmail(email)) return { allowed: false, reason: 'internal_or_private_identity_excluded' };
  if (testOrder(order)) return { allowed: false, reason: 'test_order_excluded' };

  // The transactional order confirmation is the authoritative purchase email.
  // Keep purchase completion as analytics without forwarding another email event.
  if (eventName === 'purchase_completed') {
    return { allowed: false, reason: 'transactional_order_confirmation_authoritative' };
  }

  const accepted = recentEvents.filter((event) => event?.resend_status === 'accepted');
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  const transactionalQuietMs = Number(rules.transactional_quiet_hours) * hourMs;
  const recentTransactional = recentTransactionalMessages.some((message) => {
    if (!['sent', 'delivered'].includes(message?.status)) return false;
    return within(nowMs, {
      resend_forwarded_at: message?.sent_at || message?.delivered_at,
      event_at: message?.created_date,
    }, transactionalQuietMs);
  });
  if (recentTransactional) {
    return { allowed: false, reason: 'recent_transactional_email_quiet_period' };
  }

  const cooldownMs = Number(rules.recipient_cooldown_hours) * hourMs;
  if (accepted.some((event) => within(nowMs, event, cooldownMs))) {
    return { allowed: false, reason: 'recipient_marketing_cooldown' };
  }

  const weeklyCount = accepted.filter((event) => within(nowMs, event, 7 * dayMs)).length;
  if (weeklyCount >= Number(rules.recipient_weekly_cap)) {
    return { allowed: false, reason: 'recipient_weekly_marketing_cap' };
  }

  if (eventName === 'order_delivered') {
    const reviewCooldownMs = Number(rules.review_request_cooldown_days) * dayMs;
    if (accepted.some((event) => event?.event_name === 'order_delivered' && within(nowMs, event, reviewCooldownMs))) {
      return { allowed: false, reason: 'review_request_cooldown' };
    }
  }

  if (eventName === 'cart_abandoned') {
    const abandonedCooldownMs = Number(rules.abandoned_cart_cooldown_days) * dayMs;
    if (accepted.some((event) => event?.event_name === 'cart_abandoned' && within(nowMs, event, abandonedCooldownMs))) {
      return { allowed: false, reason: 'abandoned_cart_cooldown' };
    }
  }

  return { allowed: true, reason: 'eligible_within_cadence' };
}
