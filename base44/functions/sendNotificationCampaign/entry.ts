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

const MAX_PROFILE_SCAN = 1000;
const MAX_ORDER_SCAN = 1500;

function campaignSendsDisabled(): boolean {
  return Deno.env.get('DISABLE_NOTIFICATION_CAMPAIGN_SENDS') === 'true';
}

function normalizeSingleLine(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeEmail(value: unknown): string {
  return normalizeSingleLine(value).toLowerCase();
}

function campaignNotificationSubtype(type: unknown): string {
  const value = normalizeSingleLine(type);
  return value === 'order_update' || value === 'general' ? 'general' : 'promo';
}

function responseData(result: any): Record<string, any> {
  return result?.data || result || {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown');
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }

    if (campaignSendsDisabled()) {
      return Response.json({
        error: 'notification_campaign_sends_disabled',
        message: 'Notification campaign sends are disabled by the campaign kill switch.',
      }, { status: 409 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'malformed_json' }, { status: 400 });
    }
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
      const allProfiles = await base44.asServiceRole.entities.UserProfile.list('-created_date', MAX_PROFILE_SCAN);

      if (campaign.audience === 'all_customers') {
        recipients = allProfiles.map(p => ({ email: p.customer_email })).filter(r => r.email);
      } else if (campaign.audience === 'active_subscribers') {
        const activeSubs = await base44.asServiceRole.entities.Subscription.filter({ status: 'active' });
        const subEmails = new Set(activeSubs.map(s => s.customer_email).filter(Boolean));
        recipients = [...subEmails].map(email => ({ email }));
      } else if (campaign.audience === 'one_time_customers') {
        const allOrders = await base44.asServiceRole.entities.Order.filter({ payment_status: 'paid' }, '-created_date', MAX_ORDER_SCAN);
        const activeSubs = await base44.asServiceRole.entities.Subscription.filter({ status: 'active' });
        const subEmails = new Set(activeSubs.map(s => s.customer_email));
        const orderEmails = new Set(allOrders.map(o => o.customer_email).filter(Boolean));
        recipients = [...orderEmails].filter(e => !subEmails.has(e)).map(email => ({ email }));
      } else if (campaign.audience === 'lapsed_customers') {
        // Customers with orders but nothing in the last 30 days
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const allOrders = await base44.asServiceRole.entities.Order.filter({ payment_status: 'paid' }, '-created_date', MAX_ORDER_SCAN);
        const recentEmails = new Set(allOrders.filter(o => o.created_date > cutoff).map(o => o.customer_email));
        const allOrderEmails = new Set(allOrders.map(o => o.customer_email).filter(Boolean));
        recipients = [...allOrderEmails].filter(e => !recentEmails.has(e)).map(email => ({ email }));
      }
    }

    // Deduplicate
    const uniqueEmails = [...new Set(recipients.map(r => normalizeEmail(r.email)).filter(Boolean))];
    console.log(`[sendNotificationCampaign] Sending to ${uniqueEmails.length} unique recipients`);

    let sentCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let pushAttemptedCount = 0;
    let pushSentCount = 0;
    let pushTokenCount = 0;
    const skippedReasons: Record<string, number> = {};
    const notificationSubtype = campaignNotificationSubtype(campaign.notification_type);

    // Send in batches to avoid overwhelming the DB
    for (const email of uniqueEmails) {
      try {
        const result = responseData(await base44.asServiceRole.functions.invoke('sendCustomerNotification', {
          source: 'notification_campaign',
          campaign_id,
          customer_email: email,
          title: campaign.title,
          message: campaign.message,
          type: campaign.notification_type || 'promotion',
          deep_link: campaign.deep_link || null,
          notification_subtype: notificationSubtype,
          idempotency_key: `notification_campaign:${campaign_id}:${email}`,
        }));

        if (result.skipped) {
          skippedCount++;
          const reason = normalizeSingleLine(result.reason || 'skipped') || 'skipped';
          skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
          continue;
        }

        if (result.success) {
          sentCount++;
          if (result.push_attempted) pushAttemptedCount++;
          if (result.push_sent) pushSentCount += 1;
          pushTokenCount += Number(result.push_token_count || 0);
          continue;
        }

        failedCount++;
      } catch (err) {
        console.error(`[sendNotificationCampaign] Failed to notify ${email}: ${errorMessage(err)}`);
        failedCount++;
      }
    }

    // Update campaign status
    await base44.asServiceRole.entities.NotificationCampaign.update(campaign_id, {
      status: failedCount > 0 && sentCount === 0 && skippedCount === 0 ? 'failed' : 'sent',
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
      skipped_count: skippedCount,
      skipped_reasons: skippedReasons,
      push_attempted_count: pushAttemptedCount,
      push_sent_count: pushSentCount,
      push_token_count: pushTokenCount,
      sent_at: new Date().toISOString(),
    });

  } catch (error) {
    const message = errorMessage(error);
    console.error('[sendNotificationCampaign] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
});
