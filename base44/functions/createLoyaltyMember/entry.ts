import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const { email, full_name, phone, signup_date } = await req.json();

    if (!email || !full_name) {
      return Response.json({ error: 'Email and name are required' }, { status: 400 });
    }

    // Check if loyalty member already exists
    const existing = await base44.asServiceRole.entities.LoyaltyMember.filter({ email });
    if (existing.length > 0) {
      return Response.json({ error: 'Already signed up', existing: true }, { status: 200 });
    }

    // Create loyalty member record
    const member = await base44.asServiceRole.entities.LoyaltyMember.create({
      email,
      full_name,
      phone: phone || null,
      signup_date: signup_date || new Date().toISOString().split('T')[0],
      is_active: true,
    });

    // Initialize UserPoints record with pre-order bonus if applicable
    const pointsRecords = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: email });
    if (pointsRecords.length === 0) {
      // Check if we're in pre-order mode (use launch config)
      const preorderBonus = 250; // 250 pts for pre-order signup
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

    // Send confirmation email
    await base44.asServiceRole.integrations.Core.SendEmail({
      to: email,
      subject: '🎉 Welcome to NuVira Rewards!',
      body: `
Hi ${full_name},

Welcome to the NuVira Rewards program! 🌿

You're officially signed up and earning points with every order. Here's what you get:

🏆 **Earn Points**
• 10 points per $1 spent on orders
• 50 points for referring a friend
• 250 points pre-order bonus (you have this now!)

🎁 **Redeem Rewards**
• 500 pts → Free wellness shot
• 1,000 pts → Free delivery
• 2,500 pts → Free 32oz juice
• 5,000 pts → 6-pack bundle at 50% off

Start earning today at: https://www.nuvirajuice.com/rewards

Questions? Reach out to us at info@nuvirajuice.com

Cheers,
NuVira Juice Co. 🍊
      `.trim(),
    });

    // Create in-app notification
    await base44.asServiceRole.entities.Notification.create({
      customer_email: email,
      title: '🎉 Welcome to NuVira Rewards!',
      message: 'You\'ve been added to the loyalty program. Start earning points on your next order!',
      type: 'general',
      is_read: false,
      icon: '🏆',
    });

    console.log(`New loyalty member created: ${email} (${full_name})`);

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