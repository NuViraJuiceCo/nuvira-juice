import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { email, first_name, last_name, phone, birthday, address } = await req.json();

    if (!email || !first_name || !last_name || !phone || !birthday || !address) {
      return Response.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Update or create user profile (check for existing first)
    console.log(`Setting up user profile for: ${email}`);
    const existingProfiles = await base44.asServiceRole.entities.UserProfile.filter(
      { customer_email: email }
    );

    if (existingProfiles.length > 0) {
      // Update existing profile
      await base44.asServiceRole.entities.UserProfile.update(existingProfiles[0].id, {
        contact_email: email,
        phone,
        address,
        birthday,
        onboarding_complete: true,
      });
    } else {
      // Create new profile only if one doesn't exist
      await base44.asServiceRole.entities.UserProfile.create({
        customer_email: email,
        contact_email: email,
        phone,
        address,
        birthday,
        onboarding_complete: true,
      });
    }

    // Check if loyalty member already exists
    console.log(`Checking for existing loyalty member: ${email}`);
    const existingMembers = await base44.asServiceRole.entities.LoyaltyMember.filter(
      { email }
    );

    if (existingMembers.length === 0) {
      // Create new loyalty member
      console.log(`Creating new loyalty member: ${email}`);
      await base44.asServiceRole.entities.LoyaltyMember.create({
        email,
        full_name: `${first_name} ${last_name}`,
        phone,
        signup_date: new Date().toISOString().split('T')[0],
        is_active: true,
      });

      // Initialize UserPoints with pre-order bonus
      const existingPoints = await base44.asServiceRole.entities.UserPoints.filter(
        { customer_email: email }
      );

      if (existingPoints.length === 0) {
        const preorderBonus = 250;
        await base44.asServiceRole.entities.UserPoints.create({
          customer_email: email,
          total_points: preorderBonus,
          lifetime_points: preorderBonus,
          redeemed_points: 0,
          points_history: [
            {
              amount: preorderBonus,
              type: 'earned',
              description: 'Pre-Order Launch Bonus — welcome to NuVira Rewards!',
              timestamp: new Date().toISOString(),
            },
          ],
        });
      }

      // Send welcome email
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
            html: `
<h2>Hi ${first_name},</h2>
<p>Welcome to NuVira Juice Co.! 🌿</p>
<p>Your account is all set and you're officially enrolled in our <strong>NuVira Rewards program</strong>. Start earning points on every order!</p>
<h3>🏆 Your Account is Ready</h3>
<p><strong>Name:</strong> ${first_name} ${last_name}</p>
<p><strong>Email:</strong> ${email}</p>
<p><strong>Phone:</strong> ${phone}</p>
<p><strong>Address:</strong> ${address}</p>
<h3>🎁 Instant Rewards</h3>
<ul>
  <li><strong>250 bonus points</strong> just for joining (you already have this!)</li>
  <li><strong>10 points per $1</strong> spent on orders</li>
  <li><strong>50 points</strong> for referring a friend</li>
</ul>
<h3>✨ Unlock Amazing Rewards</h3>
<ul>
  <li>500 pts → Free wellness shot</li>
  <li>1,000 pts → Free delivery</li>
  <li>2,500 pts → Free 32oz juice</li>
  <li>5,000 pts → 6-pack bundle at 50% off</li>
</ul>
<p><a href="https://www.nuvirajuice.com/rewards" style="background-color: #2d7c5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">View Your Rewards</a></p>
<p style="margin-top: 20px; font-size: 14px; color: #666;">Questions? Reach out to info@nuvirajuice.com</p>
<p>Cheers,<br/><strong>The NuVira Team</strong> 🍊</p>
            `.trim(),
          }),
        }).catch(err => console.warn('Failed to send welcome email:', err.message));
      }

      // Create in-app notification
      base44.asServiceRole.entities.Notification.create({
        customer_email: email,
        title: '🎉 Welcome to NuVira Rewards!',
        message: `Your account is ready! You've earned 250 bonus points — start shopping and earn more.`,
        type: 'general',
        is_read: false,
        icon: '🏆',
      }).catch(err => console.warn('Failed to create notification:', err.message));
    } else {
      // Member already exists, just update profile
      console.log(`Loyalty member already exists: ${email}`);
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