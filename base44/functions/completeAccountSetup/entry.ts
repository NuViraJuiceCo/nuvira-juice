import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { email, contact_email, first_name, last_name, phone, birthday, address } = await req.json();

    if (!email || !first_name || !last_name || !phone) {
      return Response.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const authenticatedEmail = normalizeEmail(user.email);
    const requestedEmail = normalizeEmail(email);
    if (!authenticatedEmail || requestedEmail !== authenticatedEmail) {
      return Response.json({ error: 'Cannot update another customer profile' }, { status: 403 });
    }

    const normalizedContactEmail = normalizeEmail(contact_email) || authenticatedEmail;
    const loyaltyEmail = authenticatedEmail.endsWith('@privaterelay.appleid.com')
      ? normalizedContactEmail
      : authenticatedEmail;

    // Sync name to User entity
    console.log(`Syncing name to User entity for: ${authenticatedEmail}`);
    try {
      await base44.auth.updateMe({
        first_name,
        last_name,
        phone,
        ...(address ? { address } : {}),
        ...(birthday ? { birthday } : {}),
      });
    } catch (err) {
      console.warn('Failed to update User entity:', err.message);
    }

    // Update or create user profile (check for existing first)
    console.log(`Setting up user profile for: ${authenticatedEmail}`);
    const existingProfiles = await base44.asServiceRole.entities.UserProfile.filter(
      { customer_email: authenticatedEmail }
    );

    if (existingProfiles.length > 0) {
      // Update existing profile
      await base44.asServiceRole.entities.UserProfile.update(existingProfiles[0].id, {
        first_name,
        last_name,
        contact_email: normalizedContactEmail,
        phone,
        ...(address ? { address } : {}),
        ...(birthday ? { birthday } : {}),
        onboarding_complete: true,
      });
    } else {
      // Create new profile only if one doesn't exist
      await base44.asServiceRole.entities.UserProfile.create({
        customer_email: authenticatedEmail,
        first_name,
        last_name,
        contact_email: normalizedContactEmail,
        phone,
        ...(address ? { address } : {}),
        ...(birthday ? { birthday } : {}),
        onboarding_complete: true,
      });
    }

    // Enroll in loyalty program via single source of truth
    console.log(`Enrolling in loyalty program: ${authenticatedEmail}`);
    const existingMembers = await base44.asServiceRole.entities.LoyaltyMember.filter({ email: authenticatedEmail });

    if (existingMembers.length === 0) {
      // Call centralized enrollment function
      const enrollRes = await base44.functions.invoke('createLoyaltyMember', {
        email: loyaltyEmail,
        auth_email: authenticatedEmail,
        first_name,
        last_name,
        phone,
        address,
        birthday,
      });

      if (!enrollRes.data.success) {
        console.warn(`Enrollment warning: ${enrollRes.data.error}`);
      }
    } else {
      console.log(`Already enrolled: ${authenticatedEmail}`);
    }

    console.log(`Account setup completed for: ${authenticatedEmail}`);

    return Response.json({
      success: true,
      email: authenticatedEmail,
      message: 'Account setup complete and loyalty member activated',
    });
  } catch (error) {
    console.error('Account setup error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
