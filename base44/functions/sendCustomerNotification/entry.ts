import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * sendCustomerNotification — creates an in-app Notification record for a customer.
 * 
 * Handles identity resolution (Apple relay → real email) and respects NotificationPreference.
 * Idempotent: uses idempotency_key to prevent duplicate notifications.
 * 
 * Payload:
 * {
 *   customer_email: string,         // canonical or relay email — will be resolved
 *   type: string,                   // order_update | promotion | new_drop | general
 *   notification_subtype: string,   // order_confirmation | scheduled_for_juicing | in_production | ready_for_pickup | out_for_delivery | arriving_soon | delivered | schedule_changed | order_delayed | order_cancelled | order_refunded | order_payment_failed | subscription_renewal | promo | loyalty_credit
 *   title: string,
 *   message: string,
 *   order_id?: string,              // optional order reference
 *   deep_link?: string,             // optional route e.g. /account/orders
 *   idempotency_key?: string,       // prevents duplicates on retries
 *   source?: string,                // optional source; notification_campaign enables approved campaign sends
 * }
 */

// Map notification subtype → preference field
const PREF_MAP: Record<string, string> = {
  order_confirmation:           'order_updates',
  scheduled_for_juicing:        'production_reminders',
  in_production:                'production_reminders',
  production_reminder:          'production_reminders',
  delivery_reminder:            'delivery_updates',
  ready_for_pickup:             'delivery_updates',
  out_for_delivery:             'delivery_updates',
  arriving_soon:                'delivery_updates',
  delivered:                    'delivery_updates',
  schedule_changed:             'order_updates',
  order_delayed:                'order_updates',
  order_cancelled:              'order_updates',
  order_refunded:               'order_updates',
  order_payment_failed:         'order_updates',
  subscription_renewal:         'subscription_updates',
  subscription_payment_success: 'subscription_updates',
  subscription_payment_failed:  'subscription_updates',
  promo:                        'promotions',
  loyalty_credit:               'rewards_credits',
  general:                      'order_updates',
};

// Operational subtypes that cannot be suppressed by prefs
const ALWAYS_SEND = new Set([
  'order_confirmation',
  'subscription_payment_failed',
  'ready_for_pickup',
  'out_for_delivery',
  'arriving_soon',
  'delivered',
  'schedule_changed',
  'order_delayed',
  'order_cancelled',
  'order_refunded',
  'order_payment_failed',
]);

const ELEVATED_TRANSACTIONAL_SUBTYPES = new Set([
  'order_confirmation',
  'scheduled_for_juicing',
  'in_production',
  'ready_for_pickup',
  'out_for_delivery',
  'arriving_soon',
  'delivered',
  'schedule_changed',
  'order_delayed',
  'order_cancelled',
  'order_refunded',
  'order_payment_failed',
]);

const MAY30_DEFAULT_ALLOWED_SUBTYPES = new Set([
  'order_confirmation',
]);

const MAY30_DELIVERY_STATUS_SUBTYPES = new Set([
  'out_for_delivery',
  'delivered',
]);

const TRANSACTIONAL_TEST_RECIPIENT = 'info@nuvirajuice.com';

function nonConfirmationNotificationsEnabled() {
  return Deno.env.get('ENABLE_NON_CONFIRMATION_CUSTOMER_NOTIFICATIONS') === 'true';
}

function deliveryStatusNotificationsEnabled() {
  return Deno.env.get('ENABLE_CUSTOMER_DELIVERY_STATUS_NOTIFICATIONS') === 'true';
}

function customerPushNotificationsEnabled() {
  return Deno.env.get('ENABLE_CUSTOMER_PUSH_NOTIFICATIONS') === 'true';
}

function transactionalMode(): 'disabled' | 'test' | 'production' {
  const mode = String(Deno.env.get('TRANSACTIONAL_COMMUNICATIONS_MODE') || '').trim().toLowerCase();
  return mode === 'test' || mode === 'production' ? mode : 'disabled';
}

function elevatedTransactionalEnabled() {
  return Deno.env.get('ENABLE_ELEVATED_TRANSACTIONAL_COMMUNICATIONS') === 'true'
    && Deno.env.get('TRANSACTIONAL_COMMUNICATIONS_KILL_SWITCH') === 'false'
    && transactionalMode() !== 'disabled';
}

function internalTokenMatches(value: unknown) {
  const expected = String(Deno.env.get('TRANSACTIONAL_COMMUNICATIONS_INTERNAL_TOKEN') || '');
  const supplied = String(value || '');
  if (!expected || expected.length !== supplied.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return mismatch === 0;
}

function customerNotificationSubtypeAllowed(
  notificationSubtype: string,
  source: unknown = null,
  _customerEmail: unknown = null,
  _idempotencyKey: unknown = null,
) {
  if (String(source || '') === 'notification_campaign') return Deno.env.get('DISABLE_NOTIFICATION_CAMPAIGN_SENDS') !== 'true';
  if (String(source || '') === 'elevated_transactional') {
    return elevatedTransactionalEnabled() && ELEVATED_TRANSACTIONAL_SUBTYPES.has(notificationSubtype);
  }
  if (MAY30_DEFAULT_ALLOWED_SUBTYPES.has(notificationSubtype)) return true;
  if (nonConfirmationNotificationsEnabled()) return true;
  return MAY30_DELIVERY_STATUS_SUBTYPES.has(notificationSubtype) && deliveryStatusNotificationsEnabled();
}

function maskEmail(email: string | null | undefined) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return null;
  const [local, domain] = email.split('@');
  const safeLocal = local.length <= 2 ? `${local[0] || '*'}***` : `${local.slice(0, 2)}***`;
  return `${safeLocal}@${domain}`;
}

async function sendCustomerPush(base44: any, payload: Record<string, any>) {
  try {
    const result = await base44.asServiceRole.functions.invoke('sendCustomerPushNotification', payload);
    return result?.data || result || {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown');
    console.warn(`[sendCustomerNotification] Push delivery skipped: ${message}`);
    return {
      success: true,
      push_attempted: false,
      push_sent: false,
      push_skipped_reason: 'push_function_unavailable',
    };
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (caller.role !== 'admin' && caller.role !== 'owner') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    let body: Record<string, any> = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'malformed_json' }, { status: 400 });
    }

    const {
      customer_email,
      type = 'general',
      notification_subtype = 'general',
      title,
      message,
      order_id = null,
      deep_link = null,
      idempotency_key: requested_idempotency_key = null,
      delivery_key = null,
      source: requested_source = '',
      notification_source = '',
      notification_origin = '',
      internal_token: requested_internal_token = '',
      transactional_proof = '',
      push_priority = 'normal',
      suppress_push = false,
    } = body;
    const idempotency_key = requested_idempotency_key || delivery_key || null;
    const internal_token = requested_internal_token || transactional_proof || '';
    const validTransactionalToken = internalTokenMatches(internal_token);
    const source = String(
      requested_source
      || notification_source
      || notification_origin
      || (validTransactionalToken ? 'elevated_transactional' : ''),
    ).trim();

    if (!customer_email || !title || !message) {
      return Response.json({ error: 'Missing required fields: customer_email, title, message' }, { status: 400 });
    }

    if (source === 'elevated_transactional' && !validTransactionalToken) {
      return Response.json({ error: 'invalid_transactional_internal_token' }, { status: 403 });
    }

    if (source === 'elevated_transactional'
      && transactionalMode() === 'test'
      && String(customer_email || '').trim().toLowerCase() !== TRANSACTIONAL_TEST_RECIPIENT) {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'transactional_test_recipient_only',
        test_recipient_only: TRANSACTIONAL_TEST_RECIPIENT,
        push_attempted: false,
        push_sent: false,
      });
    }

    if (!customerNotificationSubtypeAllowed(notification_subtype, source, customer_email, idempotency_key)) {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'non_confirmation_customer_notifications_disabled',
        message: 'Non-confirmation customer notifications are disabled for this source.',
        notification_subtype,
        delivery_status_notifications_enabled: deliveryStatusNotificationsEnabled(),
        transactional_mode: transactionalMode(),
        elevated_transactional_enabled: elevatedTransactionalEnabled(),
        requested_source_present: Boolean(requested_source),
        notification_source_present: Boolean(notification_source),
        internal_token_present: Boolean(internal_token),
        internal_token_valid: validTransactionalToken,
      }, { status: 409 });
    }

    // ── STEP 1: Resolve all identity emails for this customer ────────────────
    const identities = new Set([customer_email]);

    try {
      // Find UserProfile under this email to get contact_email / linked emails
      const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email });
      if (profiles[0]?.contact_email) identities.add(profiles[0].contact_email);

      // Also check if a profile exists where contact_email = customer_email (reverse lookup)
      const reverseProfiles = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: customer_email });
      for (const p of reverseProfiles) {
        if (p.customer_email) identities.add(p.customer_email);
        if (p.contact_email) identities.add(p.contact_email);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || 'unknown');
      console.warn(`[sendCustomerNotification] Identity resolution failed: ${message}`);
    }

    const identityList = [...identities];
    const canonicalEmail = identityList[0]; // First = the email passed in (may be relay)
    console.log(`[sendCustomerNotification] Resolved ${identityList.length} identities for ${maskEmail(customer_email)}`);

    // ── STEP 2: Idempotency check — prevent duplicate notifications ──────────
    if (idempotency_key) {
      // Query directly by idempotency_key — efficient and race-condition resistant
      const existing = await base44.asServiceRole.entities.Notification.filter({
        idempotency_key,
      }, undefined, 1);
      if (existing[0]) {
        console.log(`[sendCustomerNotification] Duplicate detected (key=${idempotency_key}). Skipping.`);
        const retryPush = source === 'elevated_transactional'
          && suppress_push !== true
          && customerPushNotificationsEnabled()
          ? await sendCustomerPush(base44, {
            customer_email: existing[0].customer_email || customer_email,
            notification_id: existing[0].id,
            title: existing[0].title || title,
            message: existing[0].message || message,
            type: existing[0].type || type,
            notification_subtype: existing[0].notification_subtype || notification_subtype,
            order_id: existing[0].order_id || order_id || null,
            deep_link: existing[0].deep_link || deep_link || '/notifications',
            idempotency_key,
            delivery_key: idempotency_key,
            source,
            notification_origin: source,
            internal_token,
            transactional_proof: internal_token,
            push_priority: push_priority === 'high' ? 'high' : 'normal',
          })
          : null;
        return Response.json({
          success: true,
          skipped: true,
          reason: 'duplicate_idempotency_key',
          existing_id: existing[0].id,
          notification_id: existing[0].id,
          push_attempted: Boolean(retryPush?.push_attempted),
          push_sent: Boolean(retryPush?.push_sent),
          push_skipped_reason: retryPush?.push_skipped_reason || null,
          push_token_count: Number(retryPush?.token_count || 0),
        });
      }
    }

    // ── STEP 3: Check notification preferences ───────────────────────────────
    const isOperational = ALWAYS_SEND.has(notification_subtype);
    if (!isOperational) {
      const prefField = PREF_MAP[notification_subtype] || 'order_updates';

      let prefRecord = null;
      for (const email of identityList) {
        const prefs = await base44.asServiceRole.entities.NotificationPreference.filter({ customer_email: email });
        if (prefs[0]) { prefRecord = prefs[0]; break; }
      }

      // If prefs exist and this type is disabled, skip
      if (prefRecord && prefRecord[prefField] === false) {
        console.log(`[sendCustomerNotification] Preference opt-out for ${notification_subtype} (${prefField}=false) for ${maskEmail(customer_email)}. Skipping.`);
        return Response.json({ success: true, skipped: true, reason: 'preference_opt_out' });
      }
    }

    // ── STEP 4: Create Notification record for the canonical email ───────────
    const notifPayload = {
      customer_email: canonicalEmail,
      title,
      message,
      type,
      is_read: false,
      order_id: order_id || null,
      icon: null,
      idempotency_key: idempotency_key || null,
      deep_link: deep_link || null,
      notification_subtype,
    };

    const created = await base44.asServiceRole.entities.Notification.create(notifPayload);
    console.log(`[sendCustomerNotification] ✅ Notification created: ${created.id} for ${maskEmail(canonicalEmail)} (type=${notification_subtype})`);

    const push = customerPushNotificationsEnabled() && suppress_push !== true
      ? await sendCustomerPush(base44, {
        customer_email: canonicalEmail,
        notification_id: created.id,
        title,
        message,
        type,
        notification_subtype,
        order_id: order_id || null,
        deep_link: deep_link || '/notifications',
        idempotency_key: idempotency_key || created.id,
        delivery_key: idempotency_key || created.id,
        source,
        notification_origin: source,
        internal_token: source === 'elevated_transactional' ? internal_token : undefined,
        transactional_proof: source === 'elevated_transactional' ? internal_token : undefined,
        push_priority: push_priority === 'high' ? 'high' : 'normal',
      })
      : {
        push_attempted: false,
        push_sent: false,
        push_skipped_reason: suppress_push === true ? 'push_suppressed_by_channel_plan' : 'customer_push_disabled',
        token_count: 0,
      };

    return Response.json({
      success: true,
      notification_id: created.id,
      customer_email: canonicalEmail,
      identities_resolved: identityList,
      push_attempted: Boolean(push.push_attempted),
      push_sent: Boolean(push.push_sent),
      push_skipped_reason: push.push_skipped_reason || null,
      push_token_count: Number(push.token_count || 0),
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown');
    console.error('[sendCustomerNotification] Error:', message);
    return Response.json({ error: 'customer_notification_failed' }, { status: 500 });
  }
});
