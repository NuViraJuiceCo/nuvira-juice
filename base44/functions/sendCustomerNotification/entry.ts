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
 *   notification_subtype: string,   // order_confirmation | delivery_reminder | out_for_delivery | delivered | subscription_renewal | subscription_payment_success | subscription_payment_failed | promo | loyalty_credit | production_reminder
 *   title: string,
 *   message: string,
 *   order_id?: string,              // optional order reference
 *   deep_link?: string,             // optional route e.g. /account/orders
 *   idempotency_key?: string,       // prevents duplicates on retries
 * }
 */

// Map notification subtype → preference field
const PREF_MAP: Record<string, string> = {
  order_confirmation:           'order_updates',
  production_reminder:          'production_reminders',
  delivery_reminder:            'delivery_updates',
  out_for_delivery:             'delivery_updates',
  delivered:                    'delivery_updates',
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
  'delivered',
]);

const MAY30_DEFAULT_ALLOWED_SUBTYPES = new Set([
  'order_confirmation',
]);

const MAY30_DELIVERY_STATUS_SUBTYPES = new Set([
  'out_for_delivery',
  'delivered',
]);

function nonConfirmationNotificationsEnabled() {
  return Deno.env.get('ENABLE_NON_CONFIRMATION_CUSTOMER_NOTIFICATIONS') === 'true';
}

function deliveryStatusNotificationsEnabled() {
  return Deno.env.get('ENABLE_CUSTOMER_DELIVERY_STATUS_NOTIFICATIONS') === 'true';
}

function customerPushNotificationsEnabled() {
  return Deno.env.get('ENABLE_CUSTOMER_PUSH_NOTIFICATIONS') === 'true';
}

function customerNotificationSubtypeAllowed(notificationSubtype: string) {
  if (MAY30_DEFAULT_ALLOWED_SUBTYPES.has(notificationSubtype)) return true;
  if (nonConfirmationNotificationsEnabled()) return true;
  return MAY30_DELIVERY_STATUS_SUBTYPES.has(notificationSubtype) && deliveryStatusNotificationsEnabled();
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
    const base44 = createClientFromRequest(req);
    const body: Record<string, any> = await req.json();

    const {
      customer_email,
      type = 'general',
      notification_subtype = 'general',
      title,
      message,
      order_id = null,
      deep_link = null,
      idempotency_key = null,
    } = body;

    if (!customer_email || !title || !message) {
      return Response.json({ error: 'Missing required fields: customer_email, title, message' }, { status: 400 });
    }

    if (!customerNotificationSubtypeAllowed(notification_subtype)) {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'non_confirmation_customer_notifications_disabled',
        message: 'Non-confirmation customer notifications are disabled for the May 30 launch freeze.',
        notification_subtype,
        delivery_status_notifications_enabled: deliveryStatusNotificationsEnabled(),
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
    console.log(`[sendCustomerNotification] Resolved identities for ${customer_email}: ${JSON.stringify(identityList)}`);

    // ── STEP 2: Idempotency check — prevent duplicate notifications ──────────
    if (idempotency_key) {
      // Query directly by idempotency_key — efficient and race-condition resistant
      const existing = await base44.asServiceRole.entities.Notification.filter({
        idempotency_key,
      }, undefined, 1);
      if (existing[0]) {
        console.log(`[sendCustomerNotification] Duplicate detected (key=${idempotency_key}). Skipping.`);
        return Response.json({ success: true, skipped: true, reason: 'duplicate_idempotency_key', existing_id: existing[0].id });
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
        console.log(`[sendCustomerNotification] Preference opt-out for ${notification_subtype} (${prefField}=false) for ${customer_email}. Skipping.`);
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
    console.log(`[sendCustomerNotification] ✅ Notification created: ${created.id} for ${canonicalEmail} (type=${notification_subtype})`);

    const push = customerPushNotificationsEnabled()
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
      })
      : {
        push_attempted: false,
        push_sent: false,
        push_skipped_reason: 'customer_push_disabled',
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
    return Response.json({ error: message }, { status: 500 });
  }
});
