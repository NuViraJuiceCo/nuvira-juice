import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { email, contact_email, first_name, last_name, phone, birthday, address } = await req.json();

    if (!email || !first_name || !last_name || !phone || !birthday || !address) {
      return Response.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Sync name to User entity
    console.log(`Syncing name to User entity for: ${email}`);
    try {
      await base44.auth.updateMe({
        first_name,
        last_name,
        phone_number: phone,
        address,
        birthday,
      });
    } catch (err) {
      console.warn('Failed to update User entity:', err.message);
    }

    // Update or create user profile (check for existing first)
    console.log(`Setting up user profile for: ${email}`);
    const existingProfiles = await base44.asServiceRole.entities.UserProfile.filter(
      { customer_email: email }
    );

    if (existingProfiles.length > 0) {
      // Update existing profile
      await base44.asServiceRole.entities.UserProfile.update(existingProfiles[0].id, {
        first_name,
        last_name,
        contact_email: contact_email || email,
        phone,
        address,
        birthday,
        onboarding_complete: true,
      });
    } else {
      // Create new profile only if one doesn't exist
      await base44.asServiceRole.entities.UserProfile.create({
        customer_email: email,
        first_name,
        last_name,
        contact_email: contact_email || email,
        phone,
        address,
        birthday,
        onboarding_complete: true,
      });
    }

    // Enroll in loyalty program via single source of truth
    console.log(`Enrolling in loyalty program: ${email}`);
    const existingMembers = await base44.asServiceRole.entities.LoyaltyMember.filter({ email });

    if (existingMembers.length === 0) {
      // Call centralized enrollment function
      const enrollRes = await base44.functions.invoke('createLoyaltyMember', {
        email,
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
      console.log(`Already enrolled: ${email}`);
    }

    console.log(`Account setup completed for: ${email}`);

    return Response.json({
      success: true,
      email,
      message: 'Account setup complete and loyalty member activated',
    });
  } catch (error) {
    console.error('Account setup error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});