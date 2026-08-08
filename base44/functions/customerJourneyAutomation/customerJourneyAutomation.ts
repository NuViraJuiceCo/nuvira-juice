import { handleMarketingLaunchAction, releaseCompletedMarketingHold } from './marketingLaunch.ts';

type JourneyMode = 'disabled' | 'test' | 'production';
type ConsentResult = {
  eligible: boolean;
  status: 'subscribed' | 'unsubscribed' | 'unknown';
  reason: string;
};

const POLICY_VERSION = 'g66-2026-08-04';
const APP_URL = 'https://www.nuvirajuice.com';
const DEFAULT_GOOGLE_REVIEW_URL = 'https://www.google.com/search?q=nuvirajuiceco#lrd=0x6ba31dd76fc40465:0x251d9ffa6e774456,3,,,,';
const MAILING_ADDRESS = normalizeSingleLine(Deno.env.get('NUVIRA_MAILING_ADDRESS'), 300)
  || "NuVira Juice Company, 619 N. Main St., O'Fallon, MO 63366";
const MAX_STATE_SCAN = 250;
const MAX_EVENT_SCAN = 500;
const MAX_PROFILE_SCAN = 500;
const MAX_ORDER_SCAN = 750;
const MAX_LOYALTY_SCAN = 500;
const MAX_SUBSCRIPTION_SCAN = 500;
const MAX_CONSENT_SCAN = 1000;
const DEFAULT_MAX_EVENTS_PER_SWEEP = 25;
const DEFAULT_CART_IDLE_MINUTES = 60;
const DEFAULT_REORDER_DAYS = 21;
const DEFAULT_WINBACK_DAYS = 60;
const DEFAULT_SUNSET_DAYS = 180;
const DEFAULT_SUNSET_GRACE_DAYS = 14;

const EVENT_PROVIDER_NAMES: Record<string, string> = {
  cart_abandoned: 'nuvira.cart.abandoned',
  purchase_completed: 'nuvira.purchase.completed',
  order_delivered: 'nuvira.order.delivered',
  loyalty_joined: 'nuvira.loyalty.joined',
  reorder_due: 'nuvira.reorder.due',
  loyalty_reward_unlocked: 'nuvira.loyalty.reward_unlocked',
  subscription_recommended: 'nuvira.subscription.recommended',
  customer_winback_due: 'nuvira.customer.winback',
  marketing_sunset_due: 'nuvira.customer.marketing_sunset',
};

const PROVIDER_REQUIRED_FIELDS: Record<string, string[]> = {
  cart_abandoned: ['customer_name', 'cart_summary', 'item_count', 'cart_total', 'recovery_url', 'mailing_address'],
  purchase_completed: ['customer_name', 'order_number', 'mailing_address'],
  order_delivered: ['customer_name', 'order_number', 'review_url', 'shop_url', 'mailing_address'],
  loyalty_joined: ['customer_name', 'points', 'discount_code', 'review_url', 'rewards_url', 'mailing_address'],
  reorder_due: ['customer_name', 'favorite_product', 'last_order_date', 'shop_url', 'mailing_address'],
  loyalty_reward_unlocked: ['customer_name', 'points_balance', 'reward_title', 'points_required', 'rewards_url', 'mailing_address'],
  subscription_recommended: ['customer_name', 'favorite_product', 'order_count', 'subscribe_url', 'mailing_address'],
  customer_winback_due: ['customer_name', 'favorite_product', 'last_order_date', 'shop_url', 'mailing_address'],
  marketing_sunset_due: ['customer_name', 'preferences_url', 'shop_url', 'mailing_address'],
};

const PROVIDER_NUMBER_FIELDS: Record<string, string[]> = {
  cart_abandoned: ['item_count', 'cart_total'],
  loyalty_joined: ['points'],
  loyalty_reward_unlocked: ['points_balance', 'points_required'],
  subscription_recommended: ['order_count'],
};

const PROVIDER_TEMPLATES = [
  'NuVira Abandoned Cart Recovery',
  'NuVira Delivery Thank You and Google Review',
  'NuVira Welcome and 10% Reward',
  'NuVira Personalized Reorder Reminder',
  'NuVira Loyalty Reward Unlocked',
  'NuVira Repeat Customer Subscription Invitation',
  'NuVira Customer Win-Back',
  'NuVira Marketing Preferences Check',
];

const PROVIDER_AUTOMATIONS = [
  'NuVira - Abandoned Cart Recovery',
  'NuVira - Delivered Order Thank You and Review',
  'NuVira - Welcome and 10% Reward',
  'NuVira - Personalized Reorder Reminder',
  'NuVira - Loyalty Reward Unlocked',
  'NuVira - Repeat Customer Subscription Invitation',
  'NuVira - Customer Win-Back',
  'NuVira - Marketing Preferences Check',
];

function normalizeSingleLine(value: unknown, maxLength = 300): string {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeEmail(value: unknown): string {
  return normalizeSingleLine(value, 320).toLowerCase();
}

function providerPayload(eventName: string, payload: Record<string, unknown>): Record<string, string | number | boolean> {
  const normalized: Record<string, string | number | boolean> = {};
  const numericFields = new Set(PROVIDER_NUMBER_FIELDS[eventName] || []);
  for (const [rawKey, rawValue] of Object.entries(payload || {})) {
    const key = normalizeSingleLine(rawKey, 120).toLowerCase();
    if (!key) continue;
    if (numericFields.has(key)) {
      const numericValue = finiteNumber(rawValue, Number.NaN);
      if (Number.isFinite(numericValue)) normalized[key] = numericValue;
      continue;
    }
    if (typeof rawValue === 'number') {
      if (Number.isFinite(rawValue)) normalized[key] = rawValue;
      continue;
    }
    if (typeof rawValue === 'boolean') {
      normalized[key] = rawValue;
      continue;
    }
    const value = normalizeSingleLine(rawValue, 2000);
    if (!value || ['undefined', 'null', 'nan'].includes(value.toLowerCase())) continue;
    normalized[key] = value;
  }

  normalized.customer_name ||= 'there';
  normalized.mailing_address ||= MAILING_ADDRESS;
  normalized.favorite_product ||= 'your favorite NuVira juices';
  normalized.reward_title ||= 'your NuVira reward';

  const missing = (PROVIDER_REQUIRED_FIELDS[eventName] || []).filter((field) => {
    const value = normalized[field];
    return value === undefined || value === null || value === '';
  });
  if (missing.length) {
    throw new Error(`provider_payload_missing:${eventName}:${missing.join(',')}`);
  }
  const invalidNumbers = (PROVIDER_NUMBER_FIELDS[eventName] || []).filter((field) => {
    const value = normalized[field];
    return typeof value !== 'number' || !Number.isFinite(value);
  });
  if (invalidNumbers.length) {
    throw new Error(`provider_payload_type:${eventName}:${invalidNumbers.join(',')}`);
  }
  return normalized;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedInteger(name: string, fallback: number, min: number, max: number): number {
  const value = Number(Deno.env.get(name));
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function envEnabled(name: string): boolean {
  return String(Deno.env.get(name) || '').trim().toLowerCase() === 'true';
}

function protectedCustomerUrl(path: string): string {
  return `${APP_URL}/native-login?return_to=${encodeURIComponent(path)}`;
}

function subscriptionRecommendationEnabled(): boolean {
  // Subscription plans are intentionally unavailable in the customer app.
  // Keep this journey closed by default so an external provider automation
  // cannot promote a destination that is not ready for customers.
  return envEnabled('ENABLE_SUBSCRIPTION_RECOMMENDATION_EMAILS');
}

function journeyMode(): JourneyMode {
  const value = String(Deno.env.get('CUSTOMER_JOURNEY_MODE') || '').trim().toLowerCase();
  if (value === 'test' || value === 'production') return value;
  return 'disabled';
}

function launchCutoff(): Date | null {
  const raw = normalizeSingleLine(Deno.env.get('CUSTOMER_JOURNEY_LAUNCH_CUTOFF'), 100);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

function policy() {
  const mode = journeyMode();
  const cutoff = launchCutoff();
  const masterEnabled = envEnabled('ENABLE_CUSTOMER_JOURNEY_AUTOMATIONS');
  const providerEnabled = envEnabled('ENABLE_RESEND_CUSTOMER_JOURNEY_EVENTS');
  const killSwitchOpen = String(Deno.env.get('CUSTOMER_JOURNEY_KILL_SWITCH') || 'true').trim().toLowerCase() === 'false';
  const providerKeyPresent = Boolean(normalizeSingleLine(Deno.env.get('RESEND_AUTOMATION_API_KEY'), 1000));
  const testRecipient = normalizeEmail(Deno.env.get('CUSTOMER_JOURNEY_TEST_RECIPIENT'));
  const blockers: string[] = [];
  if (mode === 'disabled') blockers.push('journey_mode_disabled');
  if (!masterEnabled) blockers.push('journey_master_disabled');
  if (!killSwitchOpen) blockers.push('journey_kill_switch_closed');
  if (!providerEnabled) blockers.push('resend_event_forwarding_disabled');
  if (!providerKeyPresent) blockers.push('resend_automation_api_key_missing');
  if (!cutoff) blockers.push('launch_cutoff_missing_or_invalid');
  if (mode === 'test' && !testRecipient) blockers.push('test_recipient_missing');
  return {
    policy_version: POLICY_VERSION,
    mode,
    master_enabled: masterEnabled,
    kill_switch_open: killSwitchOpen,
    provider_enabled: providerEnabled,
    provider_key_present: providerKeyPresent,
    test_recipient: testRecipient || null,
    launch_cutoff: cutoff?.toISOString() || null,
    customer_sends_enabled: blockers.length === 0,
    blockers,
  };
}

function errorMessage(error: unknown): string {
  return normalizeSingleLine(error instanceof Error ? error.message : String(error || 'unknown'), 500);
}

function journeyStageError(stage: string, error: any): Error {
  const status = Number(error?.response?.status || error?.status || 0) || null;
  const code = normalizeSingleLine(
    error?.response?.data?.error || error?.response?.data?.code || error?.code,
    120,
  );
  const detail = [stage, status ? `status_${status}` : '', code, errorMessage(error)]
    .filter(Boolean)
    .join(':');
  return new Error(detail);
}

function dateOrNull(value: unknown): Date | null {
  const date = new Date(String(value || ''));
  return Number.isFinite(date.getTime()) ? date : null;
}

function isoNow(): string {
  return new Date().toISOString();
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function eventAfterLaunch(eventAt: unknown): boolean {
  const cutoff = launchCutoff();
  const date = dateOrNull(eventAt);
  return Boolean(cutoff && date && date.getTime() >= cutoff.getTime());
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sourceName(value: unknown): 'web' | 'ios' | 'android' | 'backend' | 'pos' | 'unknown' {
  const source = normalizeSingleLine(value, 30).toLowerCase();
  if (source === 'web' || source === 'ios' || source === 'android' || source === 'backend' || source === 'pos') return source;
  return 'unknown';
}

function safeItems(items: unknown): Array<{ product_id: string; title: string; quantity: number; price: number }> {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 25).map((item: any) => ({
    product_id: normalizeSingleLine(item?.product_id || item?.id, 120),
    title: normalizeSingleLine(item?.title || item?.product_name || 'Juice', 120),
    quantity: Math.max(1, Math.min(99, Math.round(finiteNumber(item?.quantity, 1)))),
    price: Math.max(0, Math.min(10000, Math.round(finiteNumber(item?.price, 0) * 100) / 100)),
  })).filter((item) => item.product_id || item.title);
}

function itemCount(items: Array<{ quantity: number }>): number {
  return items.reduce((total, item) => total + item.quantity, 0);
}

function cartTotal(items: Array<{ quantity: number; price: number }>): number {
  return Math.round(items.reduce((total, item) => total + item.quantity * item.price, 0) * 100) / 100;
}

function cartSummary(items: Array<{ title: string; quantity: number }>): string {
  if (!items.length) return 'Your NuVira cart';
  return items.slice(0, 4).map((item) => `${item.quantity}x ${item.title}`).join(', ');
}

function customerName(profile: any, order?: any): string {
  const full = normalizeSingleLine(`${profile?.first_name || ''} ${profile?.last_name || ''}`, 120);
  return full || normalizeSingleLine(order?.customer_name || order?.full_name, 120) || 'there';
}

function paidOrder(order: any): boolean {
  return order?.is_test_order !== true && (
    order?.payment_captured === true
    || normalizeSingleLine(order?.payment_status, 30).toLowerCase() === 'paid'
    || normalizeSingleLine(order?.financial_status, 30).toLowerCase() === 'paid'
  );
}

function orderDate(order: any): Date | null {
  return dateOrNull(order?.delivered_at || order?.created_date || order?.created_at);
}

function orderIsDelivered(order: any): boolean {
  return normalizeSingleLine(order?.status, 40).toLowerCase() === 'delivered'
    || normalizeSingleLine(order?.fulfillment_status, 40).toLowerCase() === 'delivered'
    || normalizeSingleLine(order?.delivery_status, 40).toLowerCase() === 'delivered';
}

async function resolveConsent(base44: any, email: string, eventName: string): Promise<ConsentResult> {
  const normalized = normalizeEmail(email);
  if (!normalized) return { eligible: false, status: 'unknown', reason: 'email_missing' };

  const [consents, preferences] = await Promise.all([
    base44.asServiceRole.entities.MarketingConsent.filter({ customer_email: normalized }, '-created_date', 5),
    base44.asServiceRole.entities.NotificationPreference.filter({ customer_email: normalized }, '-created_date', 5),
  ]);
  const consent = consents[0];
  const status = normalizeSingleLine(consent?.email_status, 30).toLowerCase();
  const normalizedStatus = status === 'subscribed' || status === 'unsubscribed' ? status : 'unknown';
  if (normalizedStatus !== 'subscribed' || consent?.promotional_email_eligible !== true) {
    return { eligible: false, status: normalizedStatus, reason: 'promotional_email_consent_missing' };
  }

  const preference = preferences[0];
  const preferenceField = eventName === 'loyalty_joined' || eventName === 'loyalty_reward_unlocked'
    ? 'rewards_credits'
    : 'promotions';
  if (preference && preference[preferenceField] === false) {
    return { eligible: false, status: normalizedStatus, reason: `${preferenceField}_disabled` };
  }
  return { eligible: true, status: normalizedStatus, reason: 'eligible' };
}

async function profileFor(base44: any, email: string): Promise<any | null> {
  const normalized = normalizeEmail(email);
  const [profiles, contactProfiles, claims, orders] = await Promise.all([
    base44.asServiceRole.entities.UserProfile.filter({ customer_email: normalized }, '-created_date', 5),
    base44.asServiceRole.entities.UserProfile.filter({ contact_email: normalized }, '-created_date', 5),
    base44.asServiceRole.entities.POSCustomerClaim.filter({ customer_email: normalized }, '-created_date', 5),
    base44.asServiceRole.entities.ShopifyOrder.filter({ customer_email: normalized }, '-created_date', 5),
  ]);
  const profile = profiles[0] || contactProfiles[0] || {};
  const claim = claims[0] || {};
  const order = orders[0] || {};
  const orderName = normalizeSingleLine(order?.customer_name, 200).split(/\s+/).filter(Boolean);
  const firstName = normalizeSingleLine(profile?.first_name || claim?.first_name || orderName[0], 100);
  const lastName = normalizeSingleLine(profile?.last_name || claim?.last_name || orderName.slice(1).join(' '), 100);
  if (!profile?.id && !claim?.id && !order?.id) return null;
  return {
    ...profile,
    first_name: firstName,
    last_name: lastName,
    phone: normalizeSingleLine(profile?.phone || claim?.phone || order?.customer_phone, 80),
  };
}

async function existingJourneyEvent(base44: any, eventId: string): Promise<any | null> {
  const rows = await base44.asServiceRole.entities.CustomerJourneyEvent.filter({ event_id: eventId }, '-created_date', 3);
  return rows[0] || null;
}

async function recordLocalJourneyOutcome(base44: any, input: Record<string, any>) {
  const eventId = normalizeSingleLine(input.event_id, 300);
  const eventName = normalizeSingleLine(input.event_name, 80);
  const customerEmail = normalizeEmail(input.customer_email);
  if (!eventId || !customerEmail || !['marketing_sunset_suppressed', 'marketing_sunset_retained'].includes(eventName)) {
    throw new Error('invalid_local_journey_outcome');
  }
  const prior = await existingJourneyEvent(base44, eventId);
  if (prior) return { event: prior, duplicate: true };
  const event = await base44.asServiceRole.entities.CustomerJourneyEvent.create({
    event_id: eventId,
    event_name: eventName,
    event_at: dateOrNull(input.event_at)?.toISOString() || isoNow(),
    customer_email: customerEmail,
    source: 'backend',
    marketing_eligible: false,
    consent_status: normalizeSingleLine(input.consent_status, 30) || 'unknown',
    payload: input.payload || {},
    resend_status: 'not_applicable',
    error_message: null,
  });
  return { event, duplicate: false };
}

async function applyMarketingSunset(base44: any, {
  email,
  noticeEvent,
  noticeAt,
  suppressionAt,
  graceDays,
}: Record<string, any>) {
  const normalized = normalizeEmail(email);
  const [preferences, consents, activities] = await Promise.all([
    base44.asServiceRole.entities.NotificationPreference.filter({ customer_email: normalized }, '-updated_date', 5),
    base44.asServiceRole.entities.MarketingConsent.filter({ customer_email: normalized }, '-updated_date', 5),
    base44.asServiceRole.entities.CustomerJourneyEvent.filter({ customer_email: normalized }, '-event_at', 100),
  ]);
  const preference = preferences[0] || null;
  const consent = consents[0] || null;
  const consentStatus = normalizeSingleLine(consent?.email_status, 30).toLowerCase();
  const responseEventNames = new Set([
    'page_viewed',
    'product_viewed',
    'cart_updated',
    'cart_viewed',
    'checkout_started',
    'purchase_completed',
    'loyalty_joined',
    'marketing_consent_updated',
  ]);
  const responseAtCandidates = [
    dateOrNull(preference?.updated_date || preference?.created_date),
    dateOrNull(consent?.updated_date || consent?.created_date),
    ...activities
      .filter((row: any) => responseEventNames.has(normalizeSingleLine(row?.event_name, 80)))
      .map((row: any) => dateOrNull(row?.event_at)),
  ].filter((value): value is Date => Boolean(value));
  const respondedAfterNotice = responseAtCandidates.some((value) => value.getTime() > noticeAt.getTime());
  const outcomeBase = `marketing_sunset_outcome:${noticeEvent.id || noticeEvent.event_id}:${graceDays}`;

  if (consentStatus === 'unsubscribed' || preference?.promotions === false) {
    return await recordLocalJourneyOutcome(base44, {
      event_id: `${outcomeBase}:suppressed`,
      event_name: 'marketing_sunset_suppressed',
      event_at: suppressionAt,
      customer_email: normalized,
      consent_status: consentStatus || 'unknown',
      payload: {
        reason: consentStatus === 'unsubscribed' ? 'marketing_consent_unsubscribed' : 'customer_preference_disabled',
        grace_days: graceDays,
        preference_updated: false,
      },
    });
  }

  if (respondedAfterNotice) {
    return await recordLocalJourneyOutcome(base44, {
      event_id: `${outcomeBase}:retained`,
      event_name: 'marketing_sunset_retained',
      event_at: suppressionAt,
      customer_email: normalized,
      consent_status: consentStatus || 'unknown',
      payload: { reason: 'customer_activity_after_notice', grace_days: graceDays },
    });
  }

  if (preference?.id) {
    await base44.asServiceRole.entities.NotificationPreference.update(preference.id, { promotions: false });
  } else {
    await base44.asServiceRole.entities.NotificationPreference.create({
      customer_email: normalized,
      order_updates: true,
      delivery_updates: true,
      subscription_updates: true,
      production_reminders: true,
      promotions: false,
      rewards_credits: true,
    });
  }
  return await recordLocalJourneyOutcome(base44, {
    event_id: `${outcomeBase}:suppressed`,
    event_name: 'marketing_sunset_suppressed',
    event_at: suppressionAt,
    customer_email: normalized,
    consent_status: consentStatus || 'unknown',
    payload: { reason: 'inactivity_grace_period_elapsed', grace_days: graceDays, preference_updated: true },
  });
}

async function sendResendEvent(eventName: string, providerEventName: string, email: string, payload: Record<string, unknown>, eventId: string) {
  const apiKey = Deno.env.get('RESEND_AUTOMATION_API_KEY') || '';
  const normalizedPayload = providerPayload(eventName, payload);
  const response = await fetch('https://api.resend.com/events/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'NuViraCustomerJourney/1.0',
      'Idempotency-Key': eventId.slice(0, 256),
    },
    body: JSON.stringify({ event: providerEventName, email, payload: normalizedPayload }),
  });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 500) }; }
  if (!response.ok) throw new Error(`Resend event rejected (${response.status}): ${data?.message || data?.error || 'unknown error'}`);
  return data;
}

async function createAndForwardEvent(base44: any, input: Record<string, any>) {
  const eventId = normalizeSingleLine(input.event_id, 300);
  const eventName = normalizeSingleLine(input.event_name, 80);
  const email = normalizeEmail(input.customer_email);
  if (!eventId || !EVENT_PROVIDER_NAMES[eventName]) throw new Error('unsupported_or_missing_journey_event');

  const prior = await existingJourneyEvent(base44, eventId);
  if (prior) return { event: prior, duplicate: true, forwarded: prior.resend_status === 'accepted' };

  const eventAt = dateOrNull(input.event_at)?.toISOString() || isoNow();
  const consent = await resolveConsent(base44, email, eventName);
  const currentPolicy = policy();
  let resendStatus = 'prepared';
  let skipReason = '';
  if (!consent.eligible) {
    resendStatus = 'not_eligible';
    skipReason = consent.reason;
  } else if (!currentPolicy.customer_sends_enabled) {
    resendStatus = 'disabled';
    skipReason = currentPolicy.blockers.join(',');
  } else if (!eventAfterLaunch(eventAt)) {
    resendStatus = 'disabled';
    skipReason = 'before_launch_cutoff';
  } else if (currentPolicy.mode === 'test' && email !== currentPolicy.test_recipient) {
    resendStatus = 'disabled';
    skipReason = 'outside_test_recipient';
  }

  const providerName = EVENT_PROVIDER_NAMES[eventName];
  const eventRow = await base44.asServiceRole.entities.CustomerJourneyEvent.create({
    event_id: eventId,
    event_name: eventName,
    event_at: eventAt,
    customer_email: email || null,
    session_id: normalizeSingleLine(input.session_id, 160) || null,
    state_key: normalizeSingleLine(input.state_key, 128) || null,
    source: sourceName(input.source || 'backend'),
    path: normalizeSingleLine(input.path, 400) || null,
    product_id: normalizeSingleLine(input.product_id, 120) || null,
    product_title: normalizeSingleLine(input.product_title, 120) || null,
    cart_fingerprint: normalizeSingleLine(input.cart_fingerprint, 128) || null,
    item_count: Math.max(0, finiteNumber(input.item_count, 0)),
    cart_total: Math.max(0, finiteNumber(input.cart_total, 0)),
    order_id: normalizeSingleLine(input.order_id, 160) || null,
    order_number: normalizeSingleLine(input.order_number, 160) || null,
    marketing_eligible: consent.eligible,
    consent_status: consent.status,
    payload: input.payload || {},
    resend_event_name: providerName,
    resend_status: resendStatus,
    error_message: skipReason || null,
  });

  if (resendStatus !== 'prepared') return { event: eventRow, duplicate: false, forwarded: false, reason: skipReason };

  try {
    const provider = await sendResendEvent(eventName, providerName, email, input.payload || {}, eventId);
    await base44.asServiceRole.entities.CustomerJourneyEvent.update(eventRow.id, {
      resend_status: 'accepted',
      resend_forwarded_at: isoNow(),
      provider_reference: normalizeSingleLine(provider?.id || provider?.data?.id, 300) || null,
      error_message: null,
    });
    return { event: { ...eventRow, resend_status: 'accepted' }, duplicate: false, forwarded: true, provider };
  } catch (error) {
    const message = errorMessage(error);
    await base44.asServiceRole.entities.CustomerJourneyEvent.update(eventRow.id, {
      resend_status: 'failed',
      error_message: message,
    });
    return { event: { ...eventRow, resend_status: 'failed' }, duplicate: false, forwarded: false, error: message };
  }
}

async function recordActivity(base44: any, caller: any, body: Record<string, any>) {
  const email = normalizeEmail(caller?.email);
  if (!email) return Response.json({ error: 'authenticated_email_missing' }, { status: 400 });
  const eventName = normalizeSingleLine(body.event_name, 80);
  if (!['cart_updated', 'cart_cleared', 'checkout_started'].includes(eventName)) {
    return Response.json({ error: 'unsupported_activity_event' }, { status: 400 });
  }
  const sessionId = normalizeSingleLine(body.session_id, 160);
  if (!sessionId) return Response.json({ error: 'session_id_required' }, { status: 400 });

  const items = safeItems(body.items);
  const count = itemCount(items);
  const total = cartTotal(items);
  const stateKey = await sha256(`${email}|${sessionId}`);
  const fingerprint = await sha256(JSON.stringify(items.map((item) => [item.product_id, item.quantity, item.price])));
  const now = isoNow();
  const consent = await resolveConsent(base44, email, eventName);
  const existing = await base44.asServiceRole.entities.CustomerJourneyState.filter({ state_key: stateKey }, '-created_date', 3);
  const prior = existing[0];
  const isCleared = eventName === 'cart_cleared' || count === 0;
  const status = isCleared ? 'cleared' : eventName === 'checkout_started' ? 'checkout_started' : 'active';
  const stateData: Record<string, any> = {
    state_key: stateKey,
    customer_email: email,
    session_id: sessionId,
    source: sourceName(body.source),
    status,
    cart_fingerprint: fingerprint,
    cart_items: items,
    item_count: count,
    cart_total: total,
    first_activity_at: prior?.first_activity_at || now,
    last_activity_at: now,
    checkout_started_at: eventName === 'checkout_started' ? now : prior?.checkout_started_at || null,
    cleared_at: isCleared ? now : null,
    latest_path: normalizeSingleLine(body.path, 400) || null,
    marketing_eligible: consent.eligible,
    consent_status: consent.status,
    abandoned_event_key: isCleared ? prior?.abandoned_event_key || null : null,
    abandoned_event_status: isCleared ? prior?.abandoned_event_status || 'not_due' : 'not_due',
    abandoned_event_at: isCleared ? prior?.abandoned_event_at || null : null,
    last_error: null,
  };
  const state = prior
    ? await base44.asServiceRole.entities.CustomerJourneyState.update(prior.id, stateData)
    : await base44.asServiceRole.entities.CustomerJourneyState.create(stateData);
  const eventId = normalizeSingleLine(body.event_id, 300) || `activity:${stateKey}:${eventName}:${Date.now()}`;
  if (!(await existingJourneyEvent(base44, eventId))) {
    await base44.asServiceRole.entities.CustomerJourneyEvent.create({
      event_id: eventId,
      event_name: isCleared ? 'cart_cleared' : eventName,
      event_at: now,
      customer_email: email,
      session_id: sessionId,
      state_key: stateKey,
      source: sourceName(body.source),
      path: normalizeSingleLine(body.path, 400) || null,
      cart_fingerprint: fingerprint,
      item_count: count,
      cart_total: total,
      marketing_eligible: consent.eligible,
      consent_status: consent.status,
      payload: { item_count: count, cart_total: total },
      resend_status: 'not_applicable',
    });
  }
  return Response.json({ success: true, state_id: state.id, state_key: stateKey, status, tracked: true });
}

async function markStatesConverted(base44: any, email: string, order: any) {
  const states = await base44.asServiceRole.entities.CustomerJourneyState.filter({ customer_email: email }, '-last_activity_at', 50);
  let converted = 0;
  for (const state of states) {
    if (!['active', 'checkout_started', 'abandoned'].includes(state?.status)) continue;
    await base44.asServiceRole.entities.CustomerJourneyState.update(state.id, {
      status: 'converted',
      converted_at: isoNow(),
      converted_order_id: order?.id || null,
      converted_order_number: order?.order_number || null,
      last_error: null,
    });
    converted++;
  }
  return converted;
}

async function orderPayload(base44: any, order: any) {
  const email = normalizeEmail(order?.customer_email);
  const profile = await profileFor(base44, email);
  return {
    CUSTOMER_NAME: customerName(profile, order),
    ORDER_NUMBER: normalizeSingleLine(order?.order_number || order?.id, 160),
    REVIEW_URL: normalizeSingleLine(Deno.env.get('NUVIRA_GOOGLE_REVIEW_URL'), 1000)
      || DEFAULT_GOOGLE_REVIEW_URL,
    SHOP_URL: `${APP_URL}/shop`,
    MAILING_ADDRESS,
  };
}

async function processOrderChange(base44: any, body: Record<string, any>) {
  const suppliedOrder = body?.data || body?.order || {};
  const eventType = normalizeSingleLine(body?.event?.type, 30).toLowerCase();
  const orderId = normalizeSingleLine(body?.event?.entity_id || suppliedOrder?.id, 160);
  if (!['create', 'update'].includes(eventType)) {
    return Response.json({ success: true, skipped: true, reason: 'unsupported_order_event' });
  }
  if (!orderId) return Response.json({ success: true, skipped: true, reason: 'order_identity_missing' });

  // Base44 entity automations do not carry an end-user session. Treat their payload
  // only as a record pointer, then reload the authoritative Order before any write or
  // provider decision. Stable event IDs make repeated or externally-triggered checks
  // idempotent and prevent caller-supplied customer/order fields from being trusted.
  const order = await base44.asServiceRole.entities.Order.get(orderId).catch(() => null);
  if (!order) return Response.json({ success: true, skipped: true, reason: 'authoritative_order_not_found' });
  const email = normalizeEmail(order?.customer_email);
  if (!email) return Response.json({ success: true, skipped: true, reason: 'order_identity_missing' });

  const marketingHoldRelease = await releaseCompletedMarketingHold(base44, order).catch((error) => ({
    released: false,
    reason: 'release_failed',
    error: errorMessage(error),
  }));

  const nowPaid = paidOrder(order);
  const nowDelivered = orderIsDelivered(order);
  const shouldProcessPurchase = nowPaid;
  const shouldProcessDelivery = nowDelivered;
  if (!shouldProcessPurchase && !shouldProcessDelivery) {
    return Response.json({
      success: true,
      skipped: true,
      reason: 'no_authoritative_journey_transition',
      marketing_hold_release: marketingHoldRelease,
    });
  }

  const convertedStates = shouldProcessPurchase ? await markStatesConverted(base44, email, order) : 0;
  const results: any[] = [];
  const profile = await profileFor(base44, email);
  const basePayload = {
    CUSTOMER_NAME: customerName(profile, order),
    ORDER_NUMBER: normalizeSingleLine(order?.order_number || orderId, 160),
    MAILING_ADDRESS,
  };
  if (shouldProcessPurchase) {
    results.push(await createAndForwardEvent(base44, {
      event_id: `purchase:${orderId}`,
      event_name: 'purchase_completed',
      event_at: order?.created_date || isoNow(),
      customer_email: email,
      source: sourceName(order?.source === 'pos' ? 'pos' : 'backend'),
      order_id: orderId,
      order_number: order?.order_number,
      item_count: itemCount(safeItems(order?.items)),
      cart_total: finiteNumber(order?.total, 0),
      payload: basePayload,
    }));
  }
  if (shouldProcessDelivery) {
    results.push(await createAndForwardEvent(base44, {
      event_id: `delivered:${orderId}`,
      event_name: 'order_delivered',
      event_at: order?.delivered_at || isoNow(),
      customer_email: email,
      source: 'backend',
      order_id: orderId,
      order_number: order?.order_number,
      payload: await orderPayload(base44, order),
    }));
  }
  return Response.json({ success: true, converted_states: convertedStates, marketing_hold_release: marketingHoldRelease, events: results.map((result) => ({
    event_id: result?.event?.event_id,
    resend_status: result?.event?.resend_status,
    duplicate: result?.duplicate === true,
    forwarded: result?.forwarded === true,
    error: result?.error || null,
  })) });
}

function favoriteProduct(orders: any[]): string {
  const counts = new Map<string, number>();
  for (const order of orders) {
    for (const item of safeItems(order?.items)) {
      counts.set(item.title, (counts.get(item.title) || 0) + item.quantity);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'your favorite NuVira juices';
}

async function emitMilestone(base44: any, eventName: string, eventId: string, email: string, eventAt: Date, payload: Record<string, any>, extra: Record<string, any> = {}) {
  return await createAndForwardEvent(base44, {
    event_id: eventId,
    event_name: eventName,
    event_at: eventAt.toISOString(),
    customer_email: email,
    source: 'backend',
    payload: { ...payload, MAILING_ADDRESS },
    ...extra,
  });
}

async function evaluateJourneys(base44: any) {
  const currentPolicy = policy();
  const maxEvents = boundedInteger('CUSTOMER_JOURNEY_MAX_EVENTS_PER_SWEEP', DEFAULT_MAX_EVENTS_PER_SWEEP, 1, 100);
  const cartIdleMinutes = boundedInteger('CUSTOMER_JOURNEY_CART_IDLE_MINUTES', DEFAULT_CART_IDLE_MINUTES, 30, 1440);
  const reorderDays = boundedInteger('CUSTOMER_JOURNEY_REORDER_DAYS', DEFAULT_REORDER_DAYS, 7, 90);
  const winbackDays = boundedInteger('CUSTOMER_JOURNEY_WINBACK_DAYS', DEFAULT_WINBACK_DAYS, 30, 365);
  const sunsetDays = boundedInteger('CUSTOMER_JOURNEY_SUNSET_DAYS', DEFAULT_SUNSET_DAYS, 90, 730);
  const sunsetGraceDays = boundedInteger('CUSTOMER_JOURNEY_SUNSET_GRACE_DAYS', DEFAULT_SUNSET_GRACE_DAYS, 7, 60);
  const now = new Date();
  const results: Array<Record<string, any>> = [];
  let candidates = 0;

  const emit = async (factory: () => Promise<any>) => {
    if (results.length >= maxEvents) return false;
    candidates++;
    const result = await factory();
    results.push({
      event_id: result?.event?.event_id,
      event_name: result?.event?.event_name,
      resend_status: result?.event?.resend_status,
      duplicate: result?.duplicate === true,
      forwarded: result?.forwarded === true,
      error: result?.error || null,
    });
    return true;
  };

  let activeStates: any[] = [];
  let checkoutStates: any[] = [];
  try {
    [activeStates, checkoutStates] = await Promise.all([
      base44.asServiceRole.entities.CustomerJourneyState.filter({ status: 'active' }, '-last_activity_at', MAX_STATE_SCAN),
      base44.asServiceRole.entities.CustomerJourneyState.filter({ status: 'checkout_started' }, '-last_activity_at', MAX_STATE_SCAN),
    ]);
  } catch (error) {
    throw journeyStageError('load_cart_states', error);
  }
  for (const state of [...activeStates, ...checkoutStates]) {
    if (results.length >= maxEvents) break;
    const lastActivity = dateOrNull(state?.last_activity_at);
    if (!lastActivity || !eventAfterLaunch(lastActivity) || state?.item_count <= 0) continue;
    if (now.getTime() - lastActivity.getTime() < cartIdleMinutes * 60 * 1000) continue;
    const eventId = `abandoned:${state.state_key}:${state.cart_fingerprint}`;
    const profile = await profileFor(base44, state.customer_email);
    const result = await createAndForwardEvent(base44, {
      event_id: eventId,
      event_name: 'cart_abandoned',
      event_at: new Date(lastActivity.getTime() + cartIdleMinutes * 60 * 1000).toISOString(),
      customer_email: state.customer_email,
      session_id: state.session_id,
      state_key: state.state_key,
      source: state.source,
      path: state.latest_path,
      cart_fingerprint: state.cart_fingerprint,
      item_count: state.item_count,
      cart_total: state.cart_total,
      payload: {
        CUSTOMER_NAME: customerName(profile),
        CART_SUMMARY: cartSummary(safeItems(state.cart_items)),
        ITEM_COUNT: state.item_count,
        CART_TOTAL: Number(finiteNumber(state.cart_total, 0).toFixed(2)),
        RECOVERY_URL: `${APP_URL}/cart`,
        MAILING_ADDRESS,
      },
    });
    candidates++;
    results.push({ event_id: eventId, event_name: 'cart_abandoned', resend_status: result?.event?.resend_status, duplicate: result?.duplicate === true, forwarded: result?.forwarded === true, error: result?.error || null });
    await base44.asServiceRole.entities.CustomerJourneyState.update(state.id, {
      status: 'abandoned',
      abandoned_at: isoNow(),
      abandoned_event_key: eventId,
      abandoned_event_status: result?.forwarded ? 'accepted' : result?.event?.resend_status === 'not_eligible' ? 'not_eligible' : result?.event?.resend_status === 'failed' ? 'failed' : 'disabled',
      abandoned_event_at: isoNow(),
      last_resend_event_at: result?.forwarded ? isoNow() : state?.last_resend_event_at || null,
      last_error: result?.error || result?.event?.error_message || null,
    });
  }

  if (results.length < maxEvents) {
    let members: any[] = [];
    let userPoints: any[] = [];
    let tiers: any[] = [];
    let orders: any[] = [];
    let subscriptions: any[] = [];
    try {
      [members, userPoints, tiers, orders, subscriptions] = await Promise.all([
        base44.asServiceRole.entities.LoyaltyMember.list('-updated_date', MAX_LOYALTY_SCAN),
        base44.asServiceRole.entities.UserPoints.list('-updated_date', MAX_LOYALTY_SCAN),
        base44.asServiceRole.entities.RewardTier.filter({ is_active: true }, 'points_required', 100),
        base44.asServiceRole.entities.Order.list('-created_date', MAX_ORDER_SCAN),
        base44.asServiceRole.entities.Subscription.filter({ status: 'active' }, '-created_date', MAX_SUBSCRIPTION_SCAN),
      ]);
    } catch (error) {
      throw journeyStageError('load_loyalty_order_subscription_sources', error);
    }
    const paidOrders = orders.filter(paidOrder);
    const ordersByEmail = new Map<string, any[]>();
    for (const order of paidOrders) {
      const email = normalizeEmail(order?.customer_email);
      if (!email) continue;
      const rows = ordersByEmail.get(email) || [];
      rows.push(order);
      ordersByEmail.set(email, rows);
    }
    const activeSubscriptionEmails = new Set(subscriptions.map((row: any) => normalizeEmail(row?.customer_email)).filter(Boolean));
    const pointEntries: Array<[string, any]> = userPoints
      .map((row: any): [string, any] => [normalizeEmail(row?.customer_email), row])
      .filter(([email]) => Boolean(email));
    const pointsByEmail = new Map<string, any>(pointEntries);

    for (const member of members) {
      if (results.length >= maxEvents) break;
      const email = normalizeEmail(member?.email);
      const joinedAt = dateOrNull(member?.created_date || member?.signup_date);
      if (!email || !joinedAt || !eventAfterLaunch(joinedAt)) continue;
      const profile = await profileFor(base44, email);
      const pointsRecord = pointsByEmail.get(email) || member;
      await emit(() => emitMilestone(base44, 'loyalty_joined', `loyalty_joined:${member.id}`, email, joinedAt, {
        CUSTOMER_NAME: customerName(profile),
        POINTS: finiteNumber(pointsRecord?.total_points, 0),
        DISCOUNT_CODE: 'NuViraSummer',
        REVIEW_URL: normalizeSingleLine(Deno.env.get('NUVIRA_GOOGLE_REVIEW_URL'), 1000)
          || DEFAULT_GOOGLE_REVIEW_URL,
        REWARDS_URL: protectedCustomerUrl('/rewards'),
      }));
    }

    for (const member of members) {
      if (results.length >= maxEvents) break;
      const email = normalizeEmail(member?.email);
      const pointsRecord = pointsByEmail.get(email) || member;
      const history = Array.isArray(pointsRecord?.points_history) ? pointsRecord.points_history : [];
      const latest = [...history].sort((a, b) => (dateOrNull(b?.timestamp)?.getTime() || 0) - (dateOrNull(a?.timestamp)?.getTime() || 0))[0];
      const changedAt = dateOrNull(latest?.timestamp);
      const amount = finiteNumber(latest?.amount, 0);
      const current = finiteNumber(pointsRecord?.total_points, 0);
      const previous = current - Math.max(0, amount);
      if (!email || !changedAt || amount <= 0 || !eventAfterLaunch(changedAt)) continue;
      const unlocked = [...tiers].filter((tier: any) => finiteNumber(tier?.points_required, Infinity) <= current && finiteNumber(tier?.points_required, Infinity) > previous).sort((a: any, b: any) => finiteNumber(b?.points_required) - finiteNumber(a?.points_required))[0];
      if (!unlocked) continue;
      const profile = await profileFor(base44, email);
      await emit(() => emitMilestone(base44, 'loyalty_reward_unlocked', `reward_unlocked:${member.id}:${unlocked.id}`, email, changedAt, {
        CUSTOMER_NAME: customerName(profile),
        POINTS_BALANCE: current,
        REWARD_TITLE: normalizeSingleLine(unlocked?.title, 160),
        POINTS_REQUIRED: finiteNumber(unlocked?.points_required, 0),
        REWARDS_URL: protectedCustomerUrl('/rewards'),
      }));
    }

    for (const [email, customerOrders] of ordersByEmail) {
      if (results.length >= maxEvents) break;
      customerOrders.sort((a, b) => (orderDate(b)?.getTime() || 0) - (orderDate(a)?.getTime() || 0));
      const lastOrder = customerOrders[0];
      const lastAt = orderDate(lastOrder);
      if (!lastAt) continue;
      const profile = await profileFor(base44, email);
      const common = {
        CUSTOMER_NAME: customerName(profile, lastOrder),
        FAVORITE_PRODUCT: favoriteProduct(customerOrders),
        LAST_ORDER_DATE: lastAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' }),
        SHOP_URL: `${APP_URL}/shop`,
      };

      const secondOrderAt = customerOrders[1] ? orderDate(customerOrders[1]) : null;
      if (subscriptionRecommendationEnabled() && customerOrders.length >= 2 && !activeSubscriptionEmails.has(email) && eventAfterLaunch(lastAt)) {
        await emit(() => emitMilestone(base44, 'subscription_recommended', `subscription_recommended:${email}:${lastOrder.id}`, email, lastAt, {
          ...common,
          ORDER_COUNT: customerOrders.length,
          SUBSCRIBE_URL: `${APP_URL}/subscribe`,
        }, { order_id: lastOrder.id, order_number: lastOrder.order_number }));
      }
      if (results.length >= maxEvents) break;

      const reorderAt = addDays(lastAt, reorderDays);
      if (reorderAt.getTime() <= now.getTime() && eventAfterLaunch(reorderAt)) {
        await emit(() => emitMilestone(base44, 'reorder_due', `reorder_due:${lastOrder.id}:${reorderDays}`, email, reorderAt, common, { order_id: lastOrder.id, order_number: lastOrder.order_number }));
      }
      if (results.length >= maxEvents) break;

      const winbackAt = addDays(lastAt, winbackDays);
      if (!activeSubscriptionEmails.has(email) && winbackAt.getTime() <= now.getTime() && eventAfterLaunch(winbackAt)) {
        await emit(() => emitMilestone(base44, 'customer_winback_due', `winback:${lastOrder.id}:${winbackDays}`, email, winbackAt, common, { order_id: lastOrder.id, order_number: lastOrder.order_number }));
      }
      if (results.length >= maxEvents) break;

      const sunsetAt = addDays(lastAt, sunsetDays);
      if (!activeSubscriptionEmails.has(email) && sunsetAt.getTime() <= now.getTime() && eventAfterLaunch(sunsetAt)) {
        const sunsetResult = await emitMilestone(base44, 'marketing_sunset_due', `marketing_sunset:${lastOrder.id}:${sunsetDays}`, email, sunsetAt, {
          CUSTOMER_NAME: customerName(profile, lastOrder),
          PREFERENCES_URL: protectedCustomerUrl('/account/settings'),
          SHOP_URL: `${APP_URL}/shop`,
        }, { order_id: lastOrder.id, order_number: lastOrder.order_number });
        candidates++;
        results.push({
          event_id: sunsetResult?.event?.event_id,
          event_name: sunsetResult?.event?.event_name,
          resend_status: sunsetResult?.event?.resend_status,
          duplicate: sunsetResult?.duplicate === true,
          forwarded: sunsetResult?.forwarded === true,
          error: sunsetResult?.error || null,
        });

        // The grace period begins when the notice is actually accepted by the
        // email provider, not at the historical inactivity threshold.
        const noticeDeliveredAt = dateOrNull(
          sunsetResult?.event?.resend_forwarded_at || sunsetResult?.event?.created_date,
        ) || now;
        const suppressionAt = addDays(noticeDeliveredAt, sunsetGraceDays);
        if (
          results.length < maxEvents
          && suppressionAt.getTime() <= now.getTime()
          && sunsetResult?.event?.resend_status === 'accepted'
        ) {
          const outcome = await applyMarketingSunset(base44, {
            email,
            noticeEvent: sunsetResult.event,
            noticeAt: noticeDeliveredAt,
            suppressionAt,
            graceDays: sunsetGraceDays,
          });
          candidates++;
          results.push({
            event_id: outcome?.event?.event_id,
            event_name: outcome?.event?.event_name,
            resend_status: outcome?.event?.resend_status,
            duplicate: outcome?.duplicate === true,
            forwarded: false,
            error: null,
          });
        }
      }
      void secondOrderAt;
    }
  }

  return Response.json({
    success: true,
    policy: currentPolicy,
    evaluated_at: isoNow(),
    candidate_count: candidates,
    processed_count: results.length,
    forwarded_count: results.filter((result) => result.forwarded).length,
    suppressed_count: results.filter((result) => !result.forwarded && !result.error).length,
    failed_count: results.filter((result) => Boolean(result.error)).length,
    capped: results.length >= maxEvents,
    results,
  });
}

async function preview(base44: any) {
  const [events, states] = await Promise.all([
    base44.asServiceRole.entities.CustomerJourneyEvent.list('-created_date', MAX_EVENT_SCAN),
    base44.asServiceRole.entities.CustomerJourneyState.list('-last_activity_at', MAX_STATE_SCAN),
  ]);
  return Response.json({
    success: true,
    policy: policy(),
    summary: {
      journey_events: events.length,
      active_or_checkout_carts: states.filter((row: any) => row?.status === 'active' || row?.status === 'checkout_started').length,
      abandoned_carts: states.filter((row: any) => row?.status === 'abandoned').length,
      converted_carts: states.filter((row: any) => row?.status === 'converted').length,
      accepted_events: events.filter((row: any) => row?.resend_status === 'accepted').length,
      failed_events: events.filter((row: any) => row?.resend_status === 'failed').length,
      marketing_sunset_suppressed: events.filter((row: any) => row?.event_name === 'marketing_sunset_suppressed').length,
      marketing_sunset_retained: events.filter((row: any) => row?.event_name === 'marketing_sunset_retained').length,
    },
    features: {
      subscription_recommendation_enabled: subscriptionRecommendationEnabled(),
      subscription_recommendation_url: `${APP_URL}/subscribe`,
      marketing_preferences_url: protectedCustomerUrl('/account/settings'),
      marketing_sunset_grace_days: boundedInteger('CUSTOMER_JOURNEY_SUNSET_GRACE_DAYS', DEFAULT_SUNSET_GRACE_DAYS, 7, 60),
      marketing_sunset_auto_pause: true,
    },
    provider: {
      events: Object.values(EVENT_PROVIDER_NAMES),
      templates: PROVIDER_TEMPLATES,
      automations: PROVIDER_AUTOMATIONS,
    },
  });
}

async function previewRewardsCampaign(base44: any) {
  const [consents, profiles, campaigns] = await Promise.all([
    base44.asServiceRole.entities.MarketingConsent.list('-created_date', MAX_CONSENT_SCAN),
    base44.asServiceRole.entities.UserProfile.list('-created_date', MAX_PROFILE_SCAN),
    base44.asServiceRole.entities.NotificationCampaign.list('-created_date', 25),
  ]);
  const eligible = consents.filter((row: any) => row?.email_status === 'subscribed' && row?.promotional_email_eligible === true);
  const namedEmails = new Set(profiles.filter((row: any) => normalizeSingleLine(row?.first_name) && normalizeSingleLine(row?.last_name)).map((row: any) => normalizeEmail(row?.customer_email)));
  return Response.json({
    success: true,
    production_send_enabled: !envEnabled('DISABLE_NOTIFICATION_CAMPAIGN_SENDS'),
    summary: {
      eligible_count: eligible.length,
      complete_name_count: eligible.filter((row: any) => namedEmails.has(normalizeEmail(row?.customer_email))).length,
    },
    subject: 'Your NuVira Rewards Are Ready',
    latest_campaign: campaigns[0] || null,
    resend_webhook_registered: Boolean(Deno.env.get('RESEND_WEBHOOK_SECRET')),
  });
}

function journeyProofPayloads(profile: any): Record<string, Record<string, any>> {
  return {
    loyalty_joined: { CUSTOMER_NAME: customerName(profile), POINTS: 250, DISCOUNT_CODE: 'NuViraSummer', REVIEW_URL: normalizeSingleLine(Deno.env.get('NUVIRA_GOOGLE_REVIEW_URL'), 1000) || DEFAULT_GOOGLE_REVIEW_URL, REWARDS_URL: protectedCustomerUrl('/rewards'), MAILING_ADDRESS },
    cart_abandoned: { CUSTOMER_NAME: customerName(profile), CART_SUMMARY: '1x NuVira juice', ITEM_COUNT: 1, CART_TOTAL: 12, RECOVERY_URL: `${APP_URL}/cart`, MAILING_ADDRESS },
    order_delivered: { CUSTOMER_NAME: customerName(profile), ORDER_NUMBER: 'NUVIRA-SANDBOX', REVIEW_URL: normalizeSingleLine(Deno.env.get('NUVIRA_GOOGLE_REVIEW_URL'), 1000) || DEFAULT_GOOGLE_REVIEW_URL, SHOP_URL: `${APP_URL}/shop`, MAILING_ADDRESS },
    purchase_completed: { CUSTOMER_NAME: customerName(profile), ORDER_NUMBER: 'NUVIRA-SANDBOX', MAILING_ADDRESS },
    reorder_due: { CUSTOMER_NAME: customerName(profile), FAVORITE_PRODUCT: 'NuVira juice', LAST_ORDER_DATE: 'July 14, 2026', SHOP_URL: `${APP_URL}/shop`, MAILING_ADDRESS },
    loyalty_reward_unlocked: { CUSTOMER_NAME: customerName(profile), POINTS_BALANCE: 500, REWARD_TITLE: 'Free wellness shot', POINTS_REQUIRED: 500, REWARDS_URL: protectedCustomerUrl('/rewards'), MAILING_ADDRESS },
    subscription_recommended: { CUSTOMER_NAME: customerName(profile), FAVORITE_PRODUCT: 'NuVira juice', ORDER_COUNT: 2, SUBSCRIBE_URL: `${APP_URL}/subscribe`, MAILING_ADDRESS },
    customer_winback_due: { CUSTOMER_NAME: customerName(profile), FAVORITE_PRODUCT: 'NuVira juice', LAST_ORDER_DATE: 'June 4, 2026', SHOP_URL: `${APP_URL}/shop`, MAILING_ADDRESS },
    marketing_sunset_due: { CUSTOMER_NAME: customerName(profile), PREFERENCES_URL: protectedCustomerUrl('/account/settings'), SHOP_URL: `${APP_URL}/shop`, MAILING_ADDRESS },
  };
}

async function sandboxEvent(base44: any, caller: any, body: Record<string, any>) {
  if (normalizeSingleLine(body.confirm, 100) !== 'send_test_customer_journey') {
    return Response.json({ error: 'sandbox_confirmation_required', required_confirmation: 'send_test_customer_journey' }, { status: 409 });
  }
  const currentPolicy = policy();
  const email = normalizeEmail(body.email || caller?.email);
  if (currentPolicy.mode !== 'test') return Response.json({ error: 'sandbox_requires_test_mode' }, { status: 409 });
  if (!email || email !== currentPolicy.test_recipient) return Response.json({ error: 'recipient_outside_test_gate' }, { status: 409 });
  const eventName = normalizeSingleLine(body.event_name || 'loyalty_joined', 80);
  if (!EVENT_PROVIDER_NAMES[eventName]) return Response.json({ error: 'unsupported_journey_event' }, { status: 400 });
  const profile = await profileFor(base44, email);
  const payloads = journeyProofPayloads(profile);
  const result = await createAndForwardEvent(base44, {
    event_id: `sandbox:${eventName}:${crypto.randomUUID()}`,
    event_name: eventName,
    event_at: isoNow(),
    customer_email: email,
    source: 'backend',
    payload: { ...payloads[eventName], ...(body.payload || {}) },
  });
  return Response.json({ success: result.forwarded === true, event_id: result?.event?.event_id, resend_status: result?.event?.resend_status, forwarded: result.forwarded === true, error: result.error || result?.event?.error_message || null });
}

async function internalProofEvent(base44: any, body: Record<string, any>) {
  const requiredConfirmation = 'SEND INTERNAL NUVIRA JOURNEY PROOF';
  if (normalizeSingleLine(body.confirm, 100) !== requiredConfirmation) {
    return Response.json({ error: 'internal_proof_confirmation_required', required_confirmation: requiredConfirmation }, { status: 409 });
  }
  const currentPolicy = policy();
  const email = currentPolicy.test_recipient;
  if (!email || email !== 'info@nuvirajuice.com') {
    return Response.json({ error: 'internal_proof_recipient_not_configured' }, { status: 409 });
  }
  const eventName = normalizeSingleLine(body.event_name, 80);
  if (!EVENT_PROVIDER_NAMES[eventName] || eventName === 'subscription_recommended') {
    return Response.json({ error: 'unsupported_internal_proof_event' }, { status: 400 });
  }
  const profile = await profileFor(base44, email);
  const payloads = journeyProofPayloads(profile);
  const result = await createAndForwardEvent(base44, {
    event_id: `internal_proof:${eventName}:${crypto.randomUUID()}`,
    event_name: eventName,
    event_at: isoNow(),
    customer_email: email,
    source: 'backend',
    payload: payloads[eventName],
  });
  return Response.json({
    success: result.forwarded === true,
    internal_proof: true,
    recipient: email,
    event_name: eventName,
    event_id: result?.event?.event_id,
    resend_status: result?.event?.resend_status,
    forwarded: result.forwarded === true,
    error: result.error || result?.event?.error_message || null,
  });
}

export async function handleCustomerJourneyRequest(base44: any, caller: any, raw: Record<string, any>): Promise<Response | null> {
  try {
    const body = raw?.args && typeof raw.args === 'object' ? { ...raw, ...raw.args } : raw;
    const action = normalizeSingleLine(body?.action, 80);
    const supportedAction = ['record_activity', 'preview', 'preview_rewards_email_campaign', 'evaluate_scheduled', 'evaluate_now', 'sandbox_event', 'internal_proof_event', 'marketing_launch_preview', 'marketing_launch_sync_contacts', 'marketing_launch_create_draft', 'marketing_launch_send_test', 'marketing_launch_set_order_hold'].includes(action);
    const entityAutomation = Boolean(body?.event && body?.data);
    if (!supportedAction && !entityAutomation) return null;

    // Scheduled and entity automations run without a user session in Base44. Both
    // paths are constrained to authoritative server-side reads, consent/policy gates,
    // recipient caps and stable event IDs. All user-directed actions remain below the
    // authentication and role checks.
    if (action === 'evaluate_scheduled') return await evaluateJourneys(base44);
    if (entityAutomation) return await processOrderChange(base44, body);

    if (!caller) return Response.json({ error: 'unauthorized' }, { status: 401 });

    if (action === 'record_activity') return await recordActivity(base44, caller, body);

    if (caller.role !== 'admin' && caller.role !== 'owner') {
      return Response.json({ error: 'admin_access_required' }, { status: 403 });
    }
    if (action === 'preview') return await preview(base44);
    if (action === 'preview_rewards_email_campaign') return await previewRewardsCampaign(base44);
    const marketingResponse = await handleMarketingLaunchAction(base44, body);
    if (marketingResponse) return marketingResponse;
    if (action === 'evaluate_now') return await evaluateJourneys(base44);
    if (action === 'sandbox_event') return await sandboxEvent(base44, caller, body);
    if (action === 'internal_proof_event') return await internalProofEvent(base44, body);
    return Response.json({ error: 'unsupported_action' }, { status: 400 });
  } catch (error) {
    const message = errorMessage(error);
    console.error(`[customerJourneyAutomation] ${message}`);
    return Response.json({ error: 'customer_journey_error', message }, { status: 500 });
  }
}
