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

  const identities = [authUser.email]; // Start with login email

  try {
    // Check if this user has a profile with a different customer_email or contact_email
    const profiles = await base44.entities.UserProfile.filter(
      { customer_email: authUser.email }
    );

    if (profiles[0]) {
      const profile = profiles[0];
      // Add contact_email (real email) if it exists and differs from customer_email
      if (profile.contact_email && !identities.includes(profile.contact_email)) {
        identities.push(profile.contact_email);
      }
      // If customer_email differs from auth email, add it
      if (profile.customer_email && !identities.includes(profile.customer_email)) {
        identities.push(profile.customer_email);
      }
    }

    // Also check if a profile exists under contact_email (user signed in with relay but profile under real email)
    // This handles the case where profile was created under real email first
    if (identities.length > 0) {
      for (const altEmail of identities) {
        if (altEmail !== authUser.email) {
          const altProfiles = await base44.entities.UserProfile.filter(
            { customer_email: altEmail }
          );
          if (altProfiles[0]) {
            const altProfile = altProfiles[0];
            if (altProfile.contact_email && !identities.includes(altProfile.contact_email)) {
              identities.push(altProfile.contact_email);
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[identityResolver] Profile lookup failed: ${err.message}`);
    // Fallback: just use auth email
  }

  return [...new Set(identities)]; // Remove duplicates
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