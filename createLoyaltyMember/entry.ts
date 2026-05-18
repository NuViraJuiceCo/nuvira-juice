import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Single source of truth for loyalty enrollment.
 * 1. Pushes to hub first
 * 2. Creates local LoyaltyMember + UserPoints cache
 * Called by: completeAccountSetup, enrollNewCustomerInLoyalty
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { email, first_name, last_name, phone, address, birthday, signup_date } = await req.json();

    if (!email || !first_name || !last_name) {
      return Response.json({ error: 'Email, first name, and last name are required' }, { status: 400 });
    }

    // Check if already enrolled
    const existing = await base44.asServiceRole.entities.LoyaltyMember.filter({ email });
    if (existing.length > 0) {
      console.log(`Loyalty member already exists: ${email}`);
      return Response.json({ error: 'Already enrolled', existing: true }, { status: 409 });
    }

    const preorderBonus = 250;
    const fullName = `${first_name} ${last_name}`;

    // Step 1: Enroll in hub (source of truth)
    const hubApiUrl = Deno.env.get('HUB_API_URL');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

    if (hubApiUrl && hubSecret) {
      try {
        await fetch(`${hubApiUrl}/api/customer-app-sync/enroll-loyalty`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hubSecret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email,
            full_name: fullName,
            phone: phone || null,
            signup_date: signup_date || new Date().toISOString().split('T')[0],
            status: 'active',
            total_points: preorderBonus,
            lifetime_points: preorderBonus,
            redeemed_points: 0,
            points_history: [{
              amount: preorderBonus,
              type: 'earned',
              description: 'Pre-Order Launch Bonus — welcome to NuVira Rewards!',
              timestamp: new Date().toISOString(),
            }],
          }),
        });
        console.log(`Enrolled in hub: ${email}`);
      } catch (hubErr) {
        console.error('Hub enrollment failed:', hubErr.message);
        return Response.json({ error: 'Failed to enroll in loyalty program' }, { status: 500 });
      }
    }

    // Step 2: Create local LoyaltyMember cache
    const member = await base44.asServiceRole.entities.LoyaltyMember.create({
      email,
      full_name: fullName,
      phone: phone || null,
      signup_date: signup_date || new Date().toISOString().split('T')[0],
      is_active: true,
    });

    // Step 3: Update/create UserProfile
    const profileExisting = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: email });
    const profileData = {
      customer_email: email,
      contact_email: email,
      phone: phone || null,
      address: address || null,
      birthday: birthday || null,
      onboarding_complete: profileExisting.length > 0 ? profileExisting[0].onboarding_complete : false,
    };

    if (profileExisting.length === 0) {
      await base44.asServiceRole.entities.UserProfile.create(profileData);
    } else {
      await base44.asServiceRole.entities.UserProfile.update(profileExisting[0].id, profileData);
    }

    // Step 4: Initialize UserPoints cache
    const pointsExisting = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: email });
    if (pointsExisting.length === 0) {
      await base44.asServiceRole.entities.UserPoints.create({
        customer_email: email,
        total_points: preorderBonus,
        lifetime_points: preorderBonus,
        redeemed_points: 0,
        points_history: [{
          amount: preorderBonus,
          type: 'earned',
          description: 'Pre-Order Launch Bonus — welcome to NuVira Rewards!',
          timestamp: new Date().toISOString(),
        }],
      });
    }

    // Step 5: Send welcome email + notification (non-blocking)
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (resendApiKey) {
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'nuvira@nuvirajuice.com',
          to: email,
          subject: '🎉 Welcome to NuVira!',
          html: `<h2>Hi ${first_name},</h2><p>Welcome to NuVira Juice Co.! 🌿</p><p>You're enrolled in <strong>NuVira Rewards</strong> and earned <strong>250 bonus points</strong> just for joining!</p><h3>🎁 Rewards</h3><ul><li>500 pts → Free wellness shot</li><li>1,000 pts → Free delivery</li><li>2,500 pts → Free 32oz juice</li><li>5,000 pts → 6-pack bundle</li></ul><p><a href="https://www.nuvirajuice.com/rewards" style="background-color: #2d7c5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">View Rewards</a></p><p>Cheers,<br/><strong>The NuVira Team</strong> 🍊</p>`,
        }),
      }).catch(err => console.warn('Email failed:', err.message));
    }

    base44.asServiceRole.entities.Notification.create({
      customer_email: email,
      title: '🎉 Welcome to NuVira Rewards!',
      message: `You've earned 250 bonus points — start shopping and earn more.`,
      type: 'general',
      is_read: false,
      icon: '🏆',
    }).catch(err => console.warn('Notification failed:', err.message));

    console.log(`Enrollment complete: ${email} (${fullName}), member ID: ${member.id}`);

    return Response.json({
      success: true,
      member_id: member.id,
      email,
      points_awarded: preorderBonus,
    });
  } catch (error) {
    console.error('Enrollment error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});