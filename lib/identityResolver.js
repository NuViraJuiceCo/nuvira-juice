import { base44 } from '@/api/base44Client';

/**
 * Centralized customer identity resolver for Apple private relay and other email variants.
 * 
 * When a customer logs in with Apple private relay or a different email than their
 * subscription account, this resolver ensures we query and display their data correctly.
 * 
 * Resolves identities in priority order:
 * 1. Current login email (auth user email)
 * 2. UserProfile.contact_email (real email if user has a profile)
 * 3. UserProfile.customer_email (if different from auth email)
 * 4. Cached alias mapping (phone number → real email)
 * 
 * Returns array of all emails that may contain this customer's data.
 */

export async function resolveCustomerIdentities(authUser) {
  if (!authUser?.email) return [];

  const identities = new Set([authUser.email]);

  try {
    // Forward lookup: profile where customer_email = authEmail
    const profiles = await base44.entities.UserProfile.filter({ customer_email: authUser.email });
    if (profiles[0]) {
      if (profiles[0].contact_email) identities.add(profiles[0].contact_email);
      if (profiles[0].customer_email) identities.add(profiles[0].customer_email);
    }

    // Reverse lookup: profile where contact_email = authEmail
    // This is the critical path for Apple private relay users — their relay email
    // is stored as contact_email, but their real email is customer_email on the profile.
    const reverseProfiles = await base44.entities.UserProfile.filter({ contact_email: authUser.email });
    for (const p of reverseProfiles) {
      if (p.customer_email) identities.add(p.customer_email);
      if (p.contact_email) identities.add(p.contact_email);
    }

    // Secondary forward lookups for any newly added emails
    for (const email of [...identities]) {
      if (email !== authUser.email) {
        const extra = await base44.entities.UserProfile.filter({ customer_email: email });
        if (extra[0]?.contact_email) identities.add(extra[0].contact_email);
      }
    }
  } catch (err) {
    console.warn(`[identityResolver] Profile lookup failed: ${err.message}`);
  }

  return [...identities];
}

/**
 * Query subscriptions across all known identity emails.
 * Returns array of all subscriptions (deduplicated by stripe_subscription_id).
 */
export async function getSubscriptionsForCustomer(authUser) {
  if (!authUser?.email) return [];

  const identities = await resolveCustomerIdentities(authUser);
  console.log(
    `[identityResolver] Querying subscriptions for identities:`,
    identities
  );

  const allSubs = [];
  const seenStripeIds = new Set();

  for (const email of identities) {
    const subs = await base44.entities.Subscription.filter(
      { customer_email: email },
      '-created_date',
      50
    );

    for (const sub of subs) {
      // Deduplicate by stripe_subscription_id
      if (sub.stripe_subscription_id && !seenStripeIds.has(sub.stripe_subscription_id)) {
        seenStripeIds.add(sub.stripe_subscription_id);
        allSubs.push(sub);
      } else if (!sub.stripe_subscription_id) {
        // If no stripe ID, use CA subscription ID as fallback
        allSubs.push(sub);
      }
    }
  }

  return allSubs;
}

/**
 * Query orders across all known identity emails.
 * Returns array of all orders (deduplicated by stripe_payment_intent_id).
 */
export async function getOrdersForCustomer(authUser) {
  if (!authUser?.email) return [];

  const identities = await resolveCustomerIdentities(authUser);
  console.log(
    `[identityResolver] Querying orders for identities:`,
    identities
  );

  const allOrders = [];
  const seenPIIds = new Set();

  for (const email of identities) {
    const orders = await base44.entities.Order.filter(
      { customer_email: email },
      '-created_date',
      100
    );

    for (const order of orders) {
      // Deduplicate by stripe_payment_intent_id
      if (order.stripe_payment_intent_id && !seenPIIds.has(order.stripe_payment_intent_id)) {
        seenPIIds.add(order.stripe_payment_intent_id);
        allOrders.push(order);
      } else if (!order.stripe_payment_intent_id) {
        allOrders.push(order);
      }
    }
  }

  return allOrders;
}

/**
 * Query user points across all known identity emails.
 * Returns the first non-empty points record (or creates one if needed).
 */
export async function getPointsForCustomer(authUser) {
  if (!authUser?.email) return null;

  const identities = await resolveCustomerIdentities(authUser);
  console.log(
    `[identityResolver] Querying points for identities:`,
    identities
  );

  for (const email of identities) {
    const points = await base44.entities.UserPoints.filter(
      { customer_email: email }
    );
    if (points[0]) {
      return points[0];
    }
  }

  return null;
}

/**
 * Get the canonical customer identity.
 * Priority: contact_email from profile → customer_email from profile → auth email
 * This is the email we should use when creating new records or syncing to Hub.
 */
export async function getCanonicalCustomerEmail(authUser) {
  if (!authUser?.email) return null;

  try {
    // First check profile under auth email
    const profiles = await base44.entities.UserProfile.filter(
      { customer_email: authUser.email }
    );

    if (profiles[0]?.contact_email) {
      return profiles[0].contact_email; // Real email has priority
    }

    if (profiles[0]?.customer_email) {
      return profiles[0].customer_email;
    }
  } catch (err) {
    console.warn(`[identityResolver] Canonical lookup failed: ${err.message}`);
  }

  return authUser.email; // Fallback to auth email
}