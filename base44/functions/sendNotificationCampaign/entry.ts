import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * sendNotificationCampaign - admin-only function to send notifications to audience segments.
 *
 * Requires admin role. Supports test_only mode before broad send.
 * Broad sends require an explicit phrase and acknowledged recipient ceiling.
 *
 * Payload:
 * {
 *   campaign_id: string,
 *   confirm: boolean,
 *   broad_send_confirmation?: string,
 *   max_recipient_ack?: number
 * }
 */

const MAX_PROFILE_SCAN = 1000;
const MAX_ORDER_SCAN = 1500;
const MAX_PREFERENCE_SCAN = 2000;
const BROAD_SEND_CONFIRMATION_SUFFIX = '_campaign';
type CampaignRecipient = { email: string };

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
  return value === 'order_update' ? 'general' : 'promo';
}

function campaignPreferenceField(type: unknown): string {
  const value = normalizeSingleLine(type);
  return value === 'order_update' ? 'order_updates' : 'promotions';
}

function campaignPreferenceLabel(field: string): string {
  return field === 'order_updates' ? 'order update' : 'promotional';
}

function buildPreferenceIndex(preferences: any[]): Map<string, any> {
  const index = new Map<string, any>();
  for (const preference of preferences) {
    const email = normalizeEmail(preference?.customer_email);
    if (email && !index.has(email)) index.set(email, preference);
  }
  return index;
}

function hasAllowedCampaignPreference(email: string, preferenceIndex: Map<string, any>, field: string): boolean {
  const preference = preferenceIndex.get(normalizeEmail(email));
  if (!preference) return false;
  return preference[field] !== false;
}

function responseData(result: any): Record<string, any> {
  return result?.data || result || {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown');
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

function broadSendConfirmationPhrase(audience: unknown): string {
  return `send_${normalizeSingleLine(audience)}${BROAD_SEND_CONFIRMATION_SUFFIX}`;
}

async function optionalAuthenticatedUser(base44: any): Promise<any | null> {
  try {
    return await base44.auth.me();
  } catch {
    // Base44 scheduled and entity automations do not include a user session. The
    // downstream handler permits only the server-authoritative automation paths
    // without a caller; every user-directed action still enforces auth and role.
    return null;
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await optionalAuthenticatedUser(base44);
    const rawBody = await req.text();
    let body: Record<string, any> = {};
    if (rawBody.trim()) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return Response.json({ error: 'malformed_json' }, { status: 400 });
      }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'malformed_json' }, { status: 400 });
    }
    if (campaignSendsDisabled()) {
      return Response.json({
        error: 'notification_campaign_sends_disabled',
        message: 'Notification campaign sends are disabled by the campaign kill switch.',
      }, { status: 409 });
    }

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    const {
      campaign_id,
      confirm = false,
      broad_send_confirmation = '',
      max_recipient_ack = null,
    } = body;

    if (!campaign_id) {
      return Response.json({ error: 'Missing campaign_id' }, { status: 400 });
    }

    if (!confirm) {
      return Response.json({ error: 'Must pass confirm=true to execute campaign send. This is a safety gate.' }, { status: 400 });
    }

    let campaigns: any[] = [];
    try {
      campaigns = await base44.asServiceRole.entities.NotificationCampaign.filter({ id: campaign_id });
    } catch (error) {
      return Response.json({
        error: 'campaign_not_found',
        message: `Campaign ${campaign_id} not found`,
        detail: errorMessage(error),
      }, { status: 404 });
    }
    const campaign = campaigns[0];
    if (!campaign) {
      return Response.json({
        error: 'campaign_not_found',
        message: `Campaign ${campaign_id} not found`,
      }, { status: 404 });
    }
    if (campaign.status === 'sent') {
      return Response.json({ error: 'Campaign already sent. Create a new campaign to re-send.' }, { status: 400 });
    }

    console.log(`[sendNotificationCampaign] Admin ${user.email} sending campaign "${campaign.title}" to audience: ${campaign.audience}`);

    let recipients: CampaignRecipient[] = [];
    let preferencesByEmail = new Map<string, any>();
    const requiresCampaignPreference = campaign.audience !== 'test_only';
    const requiredPreferenceField = campaignPreferenceField(campaign.notification_type);

    if (campaign.audience === 'test_only') {
      recipients = [{ email: user.email }];
      console.log(`[sendNotificationCampaign] TEST MODE - sending only to admin ${user.email}`);
    } else {
      const allProfiles = await base44.asServiceRole.entities.UserProfile.list('-created_date', MAX_PROFILE_SCAN);
      const allPreferences = await base44.asServiceRole.entities.NotificationPreference.list('-created_date', MAX_PREFERENCE_SCAN);
      preferencesByEmail = buildPreferenceIndex(allPreferences);

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
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const allOrders = await base44.asServiceRole.entities.Order.filter({ payment_status: 'paid' }, '-created_date', MAX_ORDER_SCAN);
        const recentEmails = new Set(allOrders.filter(o => o.created_date > cutoff).map(o => o.customer_email));
        const allOrderEmails = new Set(allOrders.map(o => o.customer_email).filter(Boolean));
        recipients = [...allOrderEmails].filter(e => !recentEmails.has(e)).map(email => ({ email }));
      }
    }

    const candidateEmails = [...new Set(recipients.map(r => normalizeEmail(r.email)).filter(Boolean))];
    const skippedReasons: Record<string, number> = {};
    let preferenceSkippedCount = 0;
    let uniqueEmails = candidateEmails;

    if (requiresCampaignPreference) {
      const missingReason = `missing_${requiredPreferenceField}_preference`;
      uniqueEmails = candidateEmails.filter((email) => {
        if (hasAllowedCampaignPreference(email, preferencesByEmail, requiredPreferenceField)) return true;
        preferenceSkippedCount++;
        skippedReasons[missingReason] = (skippedReasons[missingReason] || 0) + 1;
        return false;
      });
    }

    console.log(`[sendNotificationCampaign] ${candidateEmails.length} candidate recipients; ${uniqueEmails.length} eligible recipients`);

    if (requiresCampaignPreference) {
      const expectedConfirmation = broadSendConfirmationPhrase(campaign.audience);
      const acknowledgedMax = positiveInteger(max_recipient_ack);
      if (normalizeSingleLine(broad_send_confirmation) !== expectedConfirmation) {
        return Response.json({
          success: false,
          error: 'broad_campaign_confirmation_required',
          message: `Broad campaigns require confirmation phrase: ${expectedConfirmation}`,
          audience: campaign.audience,
          recipients_total: candidateEmails.length,
          eligible_count: uniqueEmails.length,
          required_confirmation: expectedConfirmation,
        }, { status: 409 });
      }
      if (!acknowledgedMax || acknowledgedMax < uniqueEmails.length) {
        return Response.json({
          success: false,
          error: 'broad_campaign_recipient_ack_required',
          message: `Eligible recipients (${uniqueEmails.length}) exceed the acknowledged maximum (${acknowledgedMax || 0}).`,
          audience: campaign.audience,
          recipients_total: candidateEmails.length,
          eligible_count: uniqueEmails.length,
          min_required_max_recipient_ack: uniqueEmails.length,
          required_confirmation: expectedConfirmation,
        }, { status: 409 });
      }
    }

    let sentCount = 0;
    let failedCount = 0;
    let skippedCount = preferenceSkippedCount;
    let pushAttemptedCount = 0;
    let pushSentCount = 0;
    let pushTokenCount = 0;
    const notificationSubtype = campaignNotificationSubtype(campaign.notification_type);

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

    const noEligibleRecipients = candidateEmails.length > 0 && uniqueEmails.length === 0;
    const noDelivery = sentCount === 0 && (failedCount > 0 || skippedCount > 0 || candidateEmails.length === 0);
    const finalStatus = failedCount > 0 && sentCount === 0 && skippedCount === 0 ? 'failed' : noDelivery ? 'failed' : 'sent';

    await base44.asServiceRole.entities.NotificationCampaign.update(campaign_id, {
      status: finalStatus,
      sent_count: sentCount,
      failed_count: failedCount,
      skipped_count: skippedCount,
      recipients_total: candidateEmails.length,
      eligible_count: uniqueEmails.length,
      skipped_reasons: skippedReasons,
      sent_at: new Date().toISOString(),
    });

    console.log(`[sendNotificationCampaign] Campaign "${campaign.title}" result: ${sentCount} sent, ${failedCount} failed, ${skippedCount} skipped`);

    return Response.json({
      success: finalStatus === 'sent',
      campaign_id,
      audience: campaign.audience,
      recipients_total: candidateEmails.length,
      eligible_count: uniqueEmails.length,
      sent_count: sentCount,
      failed_count: failedCount,
      skipped_count: skippedCount,
      skipped_reasons: skippedReasons,
      consent_required: requiresCampaignPreference,
      required_preference: requiresCampaignPreference ? requiredPreferenceField : null,
      message: noEligibleRecipients
        ? `No eligible recipients have ${campaignPreferenceLabel(requiredPreferenceField)} notifications enabled.`
        : undefined,
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
