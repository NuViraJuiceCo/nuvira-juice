import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * getCustomerAccountDashboardData
 * 
 * Single authoritative backend function for all customer-facing Account data.
 * Uses service role to resolve all identity aliases (Apple relay, linked emails)
 * before querying Subscriptions, Orders, Credits, Points, and Notifications.
 * 
 * This is the ONLY function pages should call for Account dashboard data.
 * Never query these entities directly from the frontend using only user.email.
 * 
 * Returns:
 *   resolved_identity_emails, primary_customer_email, display_email,
 *   customer_profile, active_subscriptions, all_subscriptions,
 *   subscription_count, current_ritual, orders, order_count,
 *   credits, loyalty_points, notifications_unread_count
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const authEmail = user.email;
    console.log(`[getCustomerAccountDashboardData] Loading dashboard for auth_email=${authEmail}`);

    // ── STEP 1: Resolve all identity emails via service role ──────────────────
    const identities = new Set([authEmail]);

    // Forward lookup: profile where customer_email = authEmail
    const fwdProfiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: authEmail });
    const fwdProfile = fwdProfiles[0] || null;
    if (fwdProfile?.contact_email) identities.add(fwdProfile.contact_email);
    if (fwdProfile?.customer_email) identities.add(fwdProfile.customer_email);

    // Reverse lookup: profile where contact_email = authEmail (Apple relay case)
    const revProfiles = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: authEmail });
    for (const p of revProfiles) {
      if (p.customer_email) identities.add(p.customer_email);
      if (p.contact_email) identities.add(p.contact_email);
    }

    // Secondary forward lookups for any newly found emails
    for (const email of [...identities]) {
      if (email !== authEmail) {
        const extraProfiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: email });
        if (extraProfiles[0]?.contact_email) identities.add(extraProfiles[0].contact_email);
        const revExtra = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: email });
        for (const p of revExtra) {
          if (p.customer_email) identities.add(p.customer_email);
          if (p.contact_email) identities.add(p.contact_email);
        }
      }
    }

    const identityList = [...identities];
    console.log(`[getCustomerAccountDashboardData] Resolved identities: ${JSON.stringify(identityList)}`);

    // Determine primary canonical email (prefer real email over relay)
    // contact_email on the profile is always the real email
    const primaryEmail = fwdProfile?.contact_email
      || revProfiles[0]?.customer_email
      || authEmail;

    // ── STEP 2: Load customer profile ─────────────────────────────────────────
    // Use the best profile available (prefer profile under real email)
    let customerProfile = fwdProfile;
    if (!customerProfile && revProfiles[0]) {
      customerProfile = revProfiles[0];
    }
    if (!customerProfile) {
      for (const email of identityList) {
        const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: email });
        if (profiles[0]) { customerProfile = profiles[0]; break; }
      }
    }

    // ── STEP 3: Load subscriptions across all identities ─────────────────────
    const allSubs = [];
    const seenSubIds = new Set();
    for (const email of identityList) {
      const subs = await base44.asServiceRole.entities.Subscription.filter(
        { customer_email: email },
        '-created_date',
        50
      );
      for (const sub of subs) {
        const dedupeKey = sub.stripe_subscription_id || sub.id;
        if (!seenSubIds.has(dedupeKey)) {
          seenSubIds.add(dedupeKey);
          allSubs.push(sub);
        }
      }
    }

    // Active = status is active or paused (not cancelled, not refunded, not quarantined/failed)
    const activeSubs = allSubs.filter(s =>
      s.status === 'active' || s.status === 'paused'
    );
    const currentRitual = activeSubs.find(s => s.status === 'active') || activeSubs[0] || null;

    // ── STEP 4: Load orders across all identities ─────────────────────────────
    const allOrders = [];
    const seenOrderPIs = new Set();
    for (const email of identityList) {
      const orders = await base44.asServiceRole.entities.Order.filter(
        { customer_email: email },
        '-created_date',
        100
      );
      for (const order of orders) {
        const dedupeKey = order.stripe_payment_intent_id || order.id;
        if (!seenOrderPIs.has(dedupeKey)) {
          seenOrderPIs.add(dedupeKey);
          allOrders.push(order);
        }
      }
    }

    // Valid paid orders (for count display)
    const validOrders = allOrders.filter(o =>
      o.payment_status === 'paid' &&
      o.payment_captured === true &&
      !['cancelled', 'refunded', 'pending_payment'].includes(o.status) &&
      !o.is_abandoned_checkout &&
      !o.is_test_order
    );

    // ── STEP 5: Load credits across all identities ────────────────────────────
    let creditRecord = null;
    for (const email of identityList) {
      const credits = await base44.asServiceRole.entities.NuViraCredit.filter({ customer_email: email });
      if (credits[0]) { creditRecord = credits[0]; break; }
    }

    // ── STEP 6: Load loyalty points across all identities ─────────────────────
    let pointsRecord = null;
    for (const email of identityList) {
      const pts = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: email });
      if (pts[0]) { pointsRecord = pts[0]; break; }
    }

    // ── STEP 7: Unread notification count ─────────────────────────────────────
    let unreadCount = 0;
    for (const email of identityList) {
      const notifs = await base44.asServiceRole.entities.Notification.filter(
        { customer_email: email, is_read: false },
        '-created_date',
        50
      );
      unreadCount += notifs.length;
    }

    console.log(`[getCustomerAccountDashboardData] Done. identities=${identityList.length} subs=${allSubs.length} active_subs=${activeSubs.length} orders=${validOrders.length} credits=${creditRecord?.balance || 0} pts=${pointsRecord?.total_points || 0}`);

    return Response.json({
      // Identity resolution
      auth_email: authEmail,
      resolved_identity_emails: identityList,
      primary_customer_email: primaryEmail,
      display_email: customerProfile?.contact_email || authEmail,

      // Profile
      customer_profile: customerProfile || null,

      // Subscriptions
      all_subscriptions: allSubs,
      active_subscriptions: activeSubs,
      subscription_count: activeSubs.length,
      current_ritual: currentRitual,

      // Orders
      orders: validOrders,
      all_orders_raw: allOrders,
      order_count: validOrders.length,

      // Credits
      credits: creditRecord?.balance || 0,
      lifetime_credits: creditRecord?.lifetime_issued || 0,
      applied_credits: creditRecord?.lifetime_used || 0,
      credit_record: creditRecord || null,

      // Loyalty
      loyalty_points: pointsRecord?.total_points || 0,
      loyalty_lifetime: pointsRecord?.lifetime_points || 0,
      loyalty_redeemed: pointsRecord?.redeemed_points || 0,
      points_record: pointsRecord || null,

      // Notifications
      notifications_unread_count: unreadCount,

      // Debug
      debug: {
        resolved_identity_emails: identityList,
        active_subscription_ids_found: activeSubs.map(s => s.stripe_subscription_id || s.id),
        orders_found: validOrders.length,
        credits_found: creditRecord?.balance || 0,
        profile_email_displayed: customerProfile?.contact_email || authEmail,
        ritual_card_value: currentRitual ? 'Active' : 'None',
        data_source: 'getCustomerAccountDashboardData',
      },
    });

  } catch (error) {
    console.error('[getCustomerAccountDashboardData] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});