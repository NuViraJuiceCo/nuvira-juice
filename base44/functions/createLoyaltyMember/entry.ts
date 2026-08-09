import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

async function requireOwnerOrAdmin(base44: any, email: unknown, authEmail: unknown = null) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) return { response: Response.json({ error: 'unauthorized' }, { status: 401 }) };
  const targetEmail = normalizeEmail(email);
  const requesterEmail = normalizeEmail(user.email);
  const authenticatedAlias = normalizeEmail(authEmail);
  const verifiedAppleContact = requesterEmail.endsWith('@privaterelay.appleid.com')
    && authenticatedAlias === requesterEmail
    && targetEmail
    && !targetEmail.endsWith('@privaterelay.appleid.com');
  if (user.role !== 'admin' && requesterEmail !== targetEmail && !verifiedAppleContact) {
    return { response: Response.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { user };
}

/**
 * Single entry point for loyalty enrollment.
 * 1. Posts an idempotent local loyalty-ledger transaction
 * 2. Maintains Customer App profile projections
 * Called by: completeAccountSetup, enrollNewCustomerInLoyalty
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { email, auth_email, first_name, last_name, phone, address, birthday, signup_date } = await req.json();

    if (!email) {
      return Response.json({ error: 'Email is required' }, { status: 400 });
    }

    const auth = await requireOwnerOrAdmin(base44, email, auth_email);
    if (auth.response) return auth.response;

    const customerEmail = normalizeEmail(email);
    const preorderBonus = 250;
    const normalizedFirstName = String(first_name || '').trim();
    const normalizedLastName = String(last_name || '').trim();
    const fullName = `${normalizedFirstName} ${normalizedLastName}`.trim() || 'NuVira Member';
    const bonusTimestamp = signup_date ? `${signup_date}T12:00:00.000Z` : new Date().toISOString();
    const bonusEntry = {
      amount: preorderBonus,
      type: 'bonus',
      description: 'NuVira Rewards signup bonus',
      timestamp: bonusTimestamp,
    };

    // Step 1: Create the idempotent local ledger transaction. UserPoints and
    // LoyaltyMember are projections maintained by the consolidated ledger action.
    const loyaltyResponse = await base44.asServiceRole.functions.invoke('enrollNewCustomerInLoyalty', {
      action: 'post',
      customer_email: customerEmail,
      amount: preorderBonus,
      transaction_type: 'bonus',
      idempotency_key: `loyalty_signup:${customerEmail}`,
      description: bonusEntry.description,
      source_type: 'loyalty_signup',
      source_id: customerEmail,
      occurred_at: bonusTimestamp,
      metadata: { signup_date: signup_date || bonusTimestamp.slice(0, 10) },
      internal_secret: Deno.env.get('LOYALTY_LEDGER_SECRET') || Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || '',
    });
    const loyaltyResult = loyaltyResponse?.data || loyaltyResponse;
    if (loyaltyResult?.success !== true) {
      return Response.json({ error: loyaltyResult?.error || 'loyalty_enrollment_failed' }, { status: 500 });
    }

    // Step 2: Update/create the canonical Customer App profile projection.
    const authenticatedEmail = normalizeEmail(auth_email) || customerEmail;
    const [customerProfiles, contactProfiles, authenticatedProfiles] = await Promise.all([
      base44.asServiceRole.entities.UserProfile.filter({ customer_email: customerEmail }),
      base44.asServiceRole.entities.UserProfile.filter({ contact_email: customerEmail }),
      authenticatedEmail === customerEmail
        ? Promise.resolve([])
        : base44.asServiceRole.entities.UserProfile.filter({ customer_email: authenticatedEmail }),
    ]);
    const profileExisting = [...customerProfiles, ...contactProfiles, ...authenticatedProfiles]
      .filter((row, index, all) => all.findIndex(candidate => candidate.id === row.id) === index);
    const existingProfile = profileExisting[0] || null;
    const profileData = {
      customer_email: existingProfile?.customer_email || authenticatedEmail,
      contact_email: customerEmail,
      ...(normalizedFirstName ? { first_name: normalizedFirstName } : {}),
      ...(normalizedLastName ? { last_name: normalizedLastName } : {}),
      phone: phone || null,
      address: address || null,
      birthday: birthday || null,
      onboarding_complete: existingProfile?.onboarding_complete || false,
    };

    if (!existingProfile) {
      await base44.asServiceRole.entities.UserProfile.create(profileData);
    } else {
      await base44.asServiceRole.entities.UserProfile.update(existingProfile.id, profileData);
    }

    const members = await base44.asServiceRole.entities.LoyaltyMember.filter({ email: customerEmail }, '-updated_date', 1);
    const member = members[0];

    // Step 5: Keep the in-app welcome notification local. The single canonical
    // welcome email is emitted by customerJourneyAutomation after enrollment.
    // Do not add a second direct-provider path here; it can duplicate messages
    // and drift from the published Resend template.
    if (!loyaltyResult.idempotent) {
      base44.asServiceRole.entities.Notification.create({
        customer_email: customerEmail,
        title: '🎉 Welcome to NuVira Rewards!',
        message: `You've earned 250 bonus points — start shopping and earn more.`,
        type: 'general',
        is_read: false,
        icon: '🏆',
      }).catch(err => console.warn('Notification failed:', err.message));
    }

    console.log(`Enrollment complete: ${customerEmail} (${fullName}), member ID: ${member?.id || 'pending'}`);

    return Response.json({
      success: true,
      member_id: member?.id || null,
      email: customerEmail,
      points_awarded: loyaltyResult.idempotent ? 0 : preorderBonus,
      idempotent: loyaltyResult.idempotent === true,
    });
  } catch (error) {
    console.error('Enrollment error:', error);
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
