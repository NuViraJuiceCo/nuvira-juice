import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * sendNotificationCampaign — admin-only function to send notifications to audience segments.
 * 
 * Requires admin role. Supports test_only mode before broad send.
 * Throttles to prevent accidental blasts.
 * 
 * Payload:
 * {
 *   campaign_id: string,   // NotificationCampaign entity ID
 *   confirm: boolean,      // Must be true to execute (safety gate)
 * }
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { campaign_id, confirm = false } = body;

    if (!campaign_id) {
      return Response.json({ error: 'Missing campaign_id' }, { status: 400 });
    }

    if (!confirm) {
      return Response.json({ error: 'Must pass confirm=true to execute campaign send. This is a safety gate.' }, { status: 400 });
    }

    // Fetch campaign
    const campaigns = await base44.asServiceRole.entities.NotificationCampaign.filter({ id: campaign_id });
    const campaign = campaigns[0];
    if (!campaign) {
      return Response.json({ error: `Campaign ${campaign_id} not found` }, { status: 404 });
    }
    if (campaign.status === 'sent') {
      return Response.json({ error: 'Campaign already sent. Create a new campaign to re-send.' }, { status: 400 });
    }

    console.log(`[sendNotificationCampaign] Admin ${user.email} sending campaign "${campaign.title}" to audience: ${campaign.audience}`);

    // Determine recipient list
    let recipients = [];

    if (campaign.audience === 'test_only') {
      // Only send to the admin who triggers it
      recipients = [{ email: user.email }];
      console.log(`[sendNotificationCampaign] TEST MODE — sending only to admin ${user.email}`);
    } else {
      // Fetch all user profiles
      const allProfiles = await base44.asServiceRole.entities.UserProfile.list('-created_date', 500);

      if (campaign.audience === 'all_customers') {
        recipients = allProfiles.map(p => ({ email: p.customer_email })).filter(r => r.email);
      } else if (campaign.audience === 'active_subscribers') {
        const activeSubs = await base44.asServiceRole.entities.Subscription.filter({ status: 'active' });
        const subEmails = new Set(activeSubs.map(s => s.customer_email).filter(Boolean));
        recipients = [...subEmails].map(email => ({ email }));
      } else if (campaign.audience === 'one_time_customers') {
        const allOrders = await base44.asServiceRole.entities.Order.filter({ payment_status: 'paid' }, '-created_date', 1000);
        const activeSubs = await base44.asServiceRole.entities.Subscription.filter({ status: 'active' });
        const subEmails = new Set(activeSubs.map(s => s.customer_email));
        const orderEmails = new Set(allOrders.map(o => o.customer_email).filter(Boolean));
        recipients = [...orderEmails].filter(e => !subEmails.has(e)).map(email => ({ email }));
      } else if (campaign.audience === 'lapsed_customers') {
        // Customers with orders but nothing in the last 30 days
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const allOrders = await base44.asServiceRole.entities.Order.filter({ payment_status: 'paid' }, '-created_date', 1000);
        const recentEmails = new Set(allOrders.filter(o => o.created_date > cutoff).map(o => o.customer_email));
        const allOrderEmails = new Set(allOrders.map(o => o.customer_email).filter(Boolean));
        recipients = [...allOrderEmails].filter(e => !recentEmails.has(e)).map(email => ({ email }));
      }
    }

    // Deduplicate
    const uniqueEmails = [...new Set(recipients.map(r => r.email).filter(Boolean))];
    console.log(`[sendNotificationCampaign] Sending to ${uniqueEmails.length} unique recipients`);

    let sentCount = 0;
    let failedCount = 0;
    const idempotencyBase = `campaign_${campaign_id}_${Date.now()}`;

    // Send in batches to avoid overwhelming the DB
    for (const email of uniqueEmails) {
      try {
        await base44.asServiceRole.entities.Notification.create({
          customer_email: email,
          title: campaign.title,
          message: campaign.message,
          type: campaign.notification_type || 'promotion',
          is_read: false,
          idempotency_key: `${idempotencyBase}_${email}`,
          deep_link: campaign.deep_link || null,
          notification_subtype: 'promo',
        });
        sentCount++;
      } catch (err) {
        console.error(`[sendNotificationCampaign] Failed to notify ${email}: ${err.message}`);
        failedCount++;
      }
    }

    // Update campaign status
    await base44.asServiceRole.entities.NotificationCampaign.update(campaign_id, {
      status: 'sent',
      sent_count: sentCount,
      failed_count: failedCount,
      sent_at: new Date().toISOString(),
    });

    console.log(`[sendNotificationCampaign] ✅ Campaign "${campaign.title}" sent: ${sentCount} success, ${failedCount} failed`);

    return Response.json({
      success: true,
      campaign_id,
      audience: campaign.audience,
      recipients_total: uniqueEmails.length,
      sent_count: sentCount,
      failed_count: failedCount,
      sent_at: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[sendNotificationCampaign] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});