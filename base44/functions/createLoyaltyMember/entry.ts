import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const { email, first_name, last_name, phone, address, birthday, signup_date } = await req.json();

    if (!email || !first_name || !last_name) {
      return Response.json({ error: 'Email, first name, and last name are required' }, { status: 400 });
    }

    // Check if loyalty member already exists
    const existing = await base44.asServiceRole.entities.LoyaltyMember.filter({ email });
    if (existing.length > 0) {
      return Response.json({ error: 'This email is already signed up for the rewards program', existing: true }, { status: 409 });
    }

    // Invite user to the app (non-blocking, with timeout)
    base44.users.inviteUser(email, 'user')
      .then(() => console.log(`User invited: ${email}`))
      .catch(err => console.log(`User invite note: ${err.message}`));

    // Create loyalty member record
    const member = await base44.asServiceRole.entities.LoyaltyMember.create({
      email,
      full_name: `${first_name} ${last_name}`,
      phone: phone || null,
      signup_date: signup_date || new Date().toISOString().split('T')[0],
      is_active: true,
    });

    // Create UserProfile account
    const profileData = {
      customer_email: email,
      contact_email: email,
      phone: phone || null,
      address: address || null,
      onboarding_complete: false,
      birthday: birthday || null,
    };

    const profileExisting = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: email });
    if (profileExisting.length === 0) {
      await base44.asServiceRole.entities.UserProfile.create(profileData);
    } else {
      // Update existing profile with new info
      await base44.asServiceRole.entities.UserProfile.update(profileExisting[0].id, profileData);
    }

    // Initialize UserPoints with pre-order bonus
    const pointsRecords = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: email });
    if (pointsRecords.length === 0) {
      const preorderBonus = 250;
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

    // Send confirmation email via Resend (non-blocking)
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
<p>Your account has been created and you're automatically enrolled in our <strong>NuVira Rewards program</strong>. Start earning points on every order!</p>
<h3>🏆 Your Account is Ready</h3>
<p>Email: ${email}</p>
${phone ? `<p>Phone: ${phone}</p>` : ''}
${address ? `<p>Address: ${address}</p>` : ''}
<h3>🎁 Rewards Overview</h3>
<ul>
  <li><strong>10 points per \$1</strong> spent on orders</li>
  <li><strong>50 points</strong> for referring a friend</li>
  <li><strong>250 points bonus</strong> just for joining (you already have this!)</li>
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
      }).catch(err => console.warn('Failed to send email:', err.message));
    }

    // Create in-app notification (non-blocking)
    base44.asServiceRole.entities.Notification.create({
      customer_email: email,
      title: '🎉 Welcome to NuVira Rewards!',
      message: `Your account is ready! You've earned 250 bonus points — start shopping and earn more.`,
      type: 'general',
      is_read: false,
      icon: '🏆',
    }).catch(err => console.warn('Failed to create notification:', err.message));

    console.log(`New customer account created: ${email} (${first_name} ${last_name}), member ID: ${member.id}`);

    return Response.json({
      success: true,
      member_id: member.id,
      email: email,
      points_awarded: 250,
    });
  } catch (error) {
    console.error('Create loyalty member error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});