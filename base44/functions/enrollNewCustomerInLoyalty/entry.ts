import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { event, data } = await req.json();

    const customerEmail = data?.customer_email;
    if (!customerEmail) {
      console.log('No customer email found, skipping loyalty enrollment');
      return Response.json({ success: true });
    }

    // Check if already in loyalty program
    const existing = await base44.asServiceRole.entities.LoyaltyMember.filter({ email: customerEmail });
    if (existing.length > 0) {
      console.log(`Customer ${customerEmail} already in loyalty program`);
      return Response.json({ success: true });
    }

    // Create loyalty member record
    const memberData = {
      email: customerEmail,
      full_name: data?.full_name || '',
      phone: data?.phone || null,
      signup_date: new Date().toISOString().split('T')[0],
      is_active: true,
    };

    const member = await base44.asServiceRole.entities.LoyaltyMember.create(memberData);

    // Initialize UserPoints with pre-order bonus
    const pointsRecords = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: customerEmail });
    if (pointsRecords.length === 0) {
      const preorderBonus = 250;
      await base44.asServiceRole.entities.UserPoints.create({
        customer_email: customerEmail,
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

    // Send welcome email via Resend
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (resendApiKey) {
      const fullName = data?.full_name || 'there';
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'nuvira@nuvirajuice.com',
          to: customerEmail,
          subject: '🎉 Welcome to NuVira Rewards!',
          html: `
<h2>Hi ${fullName},</h2>
<p>Welcome to NuVira Juice Co.! 🌿</p>
<p>You've been automatically enrolled in our <strong>NuVira Rewards program</strong> — start earning points on every order!</p>
<h3>🏆 Here's What You Get</h3>
<ul>
  <li><strong>10 points per \$1</strong> spent on orders</li>
  <li><strong>50 points</strong> for referring a friend</li>
  <li><strong>250 points bonus</strong> just for joining (you already have this!)</li>
</ul>
<h3>🎁 Redeem Amazing Rewards</h3>
<ul>
  <li>500 pts → Free wellness shot</li>
  <li>1,000 pts → Free delivery</li>
  <li>2,500 pts → Free 32oz juice</li>
  <li>5,000 pts → 6-pack bundle at 50% off</li>
</ul>
<p><a href="https://www.nuvirajuice.com/rewards" style="background-color: #2d7c5e; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">View Your Rewards</a></p>
<p style="margin-top: 20px; font-size: 14px; color: #666;">Questions? Reach out to info@nuvirajuice.com</p>
<p>Cheers,<br/><strong>The NuVira Team</strong> 🍊</p>
          `.trim(),
        }),
      }).catch(err => console.error('Failed to send welcome email:', err.message));
    }

    console.log(`New customer ${customerEmail} enrolled in loyalty program (Member ID: ${member.id})`);

    return Response.json({ success: true, member_id: member.id });
  } catch (error) {
    console.error('Enroll loyalty error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});