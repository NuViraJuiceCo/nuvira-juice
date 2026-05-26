import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_LOYALTY_THANK_YOU_EMAILS') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'loyalty_thank_you_emails_disabled',
        message: 'Bulk loyalty thank-you emails are disabled for May 30 launch freeze.',
      });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Fetch all loyalty members
    const members = await base44.asServiceRole.entities.LoyaltyMember.filter({ is_active: true });
    
    if (!members || members.length === 0) {
      return Response.json({ success: true, sent: 0, message: 'No loyalty members found' });
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      return Response.json({ error: 'Resend API key not configured' }, { status: 500 });
    }

    let sent = 0;
    let failed = 0;

    for (const member of members) {
      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'nuvira@nuvirajuice.com',
            to: member.email,
            subject: '💚 Thank You for Joining NuVira Rewards!',
            html: `
<h2>Hi ${member.full_name},</h2>
<p>We wanted to personally thank you for joining the NuVira Rewards program! Your loyalty means everything to us.</p>
<p>As a token of our appreciation, you're already earning points on every order. Here's a quick recap:</p>
<h3>🏆 Your Rewards Status</h3>
<ul>
  <li>Start earning 10 points per \$1 spent</li>
  <li>Unlock free bottles, delivery, and exclusive bundles</li>
  <li>Track your progress anytime in your account</li>
</ul>
<p><strong>🎁 What's Next?</strong></p>
<p><a href="https://www.nuvirajuice.com/rewards">See your points and available rewards</a></p>
<p>We're constantly working to bring you the freshest, coldest juice and the best rewards program around. Thank you for being part of the NuVira family! 🌿</p>
<p>Questions? Reach out to info@nuvirajuice.com</p>
<p>Cheers,<br/>The NuVira Team 🍊</p>
            `.trim(),
          }),
        });

        if (emailRes.ok) {
          sent++;
        } else {
          console.error(`Failed to send to ${member.email}:`, await emailRes.text());
          failed++;
        }
      } catch (err) {
        console.error(`Failed to send email to ${member.email}:`, err.message);
        failed++;
      }
    }

    console.log(`Thank you emails sent: ${sent} successful, ${failed} failed`);

    return Response.json({
      success: true,
      total_members: members.length,
      sent,
      failed,
    });
  } catch (error) {
    console.error('Send thank you emails error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
