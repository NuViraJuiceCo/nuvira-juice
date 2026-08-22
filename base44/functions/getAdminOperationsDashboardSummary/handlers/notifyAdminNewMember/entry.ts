import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

type Base44Client = any;
type AdminRecipient = { email: string };

const ADMIN_PUSH_RECIPIENT_EMAILS = Deno.env.get('ADMIN_PUSH_RECIPIENT_EMAILS') || '';
const NOTIFICATION_SUBTYPE = 'admin_new_member';
const DEEP_LINK = '/admin/loyalty-members';

function envFlag(name: string): boolean {
  return Deno.env.get(name) === 'true';
}

function line(value: unknown, maxLength = 160): string {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function email(value: unknown): string {
  const normalized = line(value, 160).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
}

function parseEmailList(value: string): string[] {
  return [...new Set(value.split(',').map(email).filter(Boolean))];
}

function responseData(value: any) {
  return value?.data || value || {};
}

function errorMessage(error: unknown): string {
  return line(error instanceof Error ? error.message : error, 120) || 'unknown_error';
}

function sourceLabel(profile: Record<string, any>): string {
  const source = line(profile?.signup_source || profile?.source || profile?.auth_provider, 60).toLowerCase();
  if (source.includes('apple')) return 'Apple sign-in';
  if (source.includes('google')) return 'Google sign-in';
  if (source.includes('checkout')) return 'checkout';
  if (source.includes('event') || source.includes('pos')) return 'an event';
  return 'the NuVira app';
}

async function adminRecipients(base44: Base44Client): Promise<AdminRecipient[]> {
  const configured = parseEmailList(ADMIN_PUSH_RECIPIENT_EMAILS);
  if (configured.length) return configured.map((recipientEmail) => ({ email: recipientEmail }));

  const [admins, owners] = await Promise.all([
    base44.asServiceRole.entities.User.filter({ role: 'admin' }).catch(() => []),
    base44.asServiceRole.entities.User.filter({ role: 'owner' }).catch(() => []),
  ]);
  const recipients = new Set<string>();
  for (const user of [...admins, ...owners]) {
    const recipientEmail = email(user?.email || user?.customer_email || user?.user_email);
    if (recipientEmail) recipients.add(recipientEmail);
  }
  return [...recipients].map((recipientEmail) => ({ email: recipientEmail }));
}

async function authoritativeProfile(base44: Base44Client, profileId: string) {
  if (!profileId) return null;
  const rows = await base44.asServiceRole.entities.UserProfile.filter({ id: profileId }, '-created_date', 1);
  return rows[0] || null;
}

async function priorProfileForEmail(
  base44: Base44Client,
  profile: Record<string, any>,
  profileEmail: string,
) {
  const rows = await base44.asServiceRole.entities.UserProfile.filter(
    { customer_email: profileEmail },
    'created_date',
    10,
  ).catch(() => []);
  const createdAt = Date.parse(String(profile?.created_date || ''));
  return rows.find((row: any) => {
    if (!row?.id || String(row.id) === String(profile?.id)) return false;
    const rowCreatedAt = Date.parse(String(row?.created_date || ''));
    return !Number.isFinite(createdAt) || !Number.isFinite(rowCreatedAt) || rowCreatedAt <= createdAt;
  }) || null;
}

async function isAdminIdentity(base44: Base44Client, profileEmail: string) {
  if (!profileEmail) return false;
  const rows = await base44.asServiceRole.entities.User.filter({ email: profileEmail }, '-created_date', 2).catch(() => []);
  return rows.some((user: any) => ['admin', 'owner'].includes(line(user?.role, 20).toLowerCase()));
}

async function existingNotification(base44: Base44Client, idempotencyKey: string) {
  const rows = await base44.asServiceRole.entities.Notification.filter({ idempotency_key: idempotencyKey }, '-created_date', 1);
  return rows[0] || null;
}

export default async (req: Request) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller || !['admin', 'owner'].includes(line(caller?.role, 20).toLowerCase())) {
      return Response.json({ error: 'admin_access_required' }, { status: caller ? 403 : 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'malformed_json' }, { status: 400 });
    }
    const eventType = line(body?.event?.type || body?.event?.event_type, 30).toLowerCase();
    const entityName = line(body?.event?.entity_name, 60);
    if (eventType !== 'create' || entityName !== 'UserProfile') {
      return Response.json({ success: true, skipped: true, reason: 'not_user_profile_create' });
    }

    const profileId = line(body?.event?.entity_id || body?.data?.id, 160);
    const profile = await authoritativeProfile(base44, profileId);
    if (!profile) return Response.json({ error: 'profile_not_found' }, { status: 404 });
    if (profile?.is_sample === true) {
      return Response.json({ success: true, skipped: true, reason: 'sample_profile_excluded' });
    }

    const profileEmail = email(profile?.customer_email);
    if (!profileEmail) return Response.json({ success: true, skipped: true, reason: 'profile_email_invalid' });
    if (await priorProfileForEmail(base44, profile, profileEmail)) {
      return Response.json({ success: true, skipped: true, reason: 'existing_member_profile' });
    }
    if (await isAdminIdentity(base44, profileEmail)) {
      return Response.json({ success: true, skipped: true, reason: 'admin_profile_excluded' });
    }
    if (!envFlag('ENABLE_ADMIN_PUSH_NOTIFICATIONS') || !envFlag('ENABLE_ADMIN_NEW_MEMBER_PUSH')) {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'admin_new_member_push_disabled',
        profile_id: profileId,
        notification_created_count: 0,
        push_attempted: false,
        push_sent: false,
      });
    }

    const recipients = await adminRecipients(base44);
    if (!recipients.length) {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'admin_push_recipients_unavailable',
        profile_id: profileId,
        notification_created_count: 0,
        push_attempted: false,
        push_sent: false,
      });
    }

    const fullName = line(`${profile?.first_name || ''} ${profile?.last_name || ''}`, 120);
    const memberName = fullName || 'A new member';
    const title = 'New NuVira Member';
    const message = `${memberName} created a profile through ${sourceLabel(profile)}.`;
    let notificationCreatedCount = 0;
    let duplicateCount = 0;
    let pushAttempted = false;
    let pushSent = false;
    let pushSentCount = 0;
    let pushTokenCount = 0;
    const skippedReasons = new Set<string>();

    for (const recipient of recipients) {
      const idempotencyKey = `admin_new_member_${profileId}_${recipient.email}`;
      const prior = await existingNotification(base44, idempotencyKey);
      if (prior) {
        duplicateCount += 1;
        skippedReasons.add('duplicate_idempotency_key');
        continue;
      }

      const notification = await base44.asServiceRole.entities.Notification.create({
        customer_email: recipient.email,
        title,
        message,
        description: `New customer profile: ${profileEmail}`,
        type: 'general',
        notification_subtype: NOTIFICATION_SUBTYPE,
        order_id: null,
        deep_link: DEEP_LINK,
        is_read: false,
        icon: null,
        idempotency_key: idempotencyKey,
      });
      notificationCreatedCount += 1;

      const push = responseData(await base44.asServiceRole.functions.invoke('sendCustomerPushNotification', {
        customer_email: recipient.email,
        notification_id: notification.id,
        title,
        message,
        type: 'general',
        notification_subtype: NOTIFICATION_SUBTYPE,
        deep_link: DEEP_LINK,
        idempotency_key: idempotencyKey,
      }).catch((error: unknown) => ({
        push_attempted: false,
        push_sent: false,
        push_skipped_reason: `push_function_error:${errorMessage(error)}`,
        token_count: 0,
      })));
      pushAttempted = pushAttempted || push.push_attempted === true;
      pushSent = pushSent || push.push_sent === true;
      pushSentCount += Number(push.sent_count || (push.push_sent ? 1 : 0));
      pushTokenCount += Number(push.token_count || 0);
      if (push.push_skipped_reason) skippedReasons.add(line(push.push_skipped_reason, 120));
    }

    return Response.json({
      success: true,
      skipped: notificationCreatedCount === 0 && duplicateCount > 0,
      reason: notificationCreatedCount === 0 && duplicateCount > 0 ? 'duplicate_idempotency_key' : null,
      profile_id: profileId,
      recipient_count: recipients.length,
      notification_created_count: notificationCreatedCount,
      duplicate_count: duplicateCount,
      push_attempted: pushAttempted,
      push_sent: pushSent,
      push_sent_count: pushSentCount,
      push_token_count: pushTokenCount,
      push_skipped_reason: pushSent ? null : [...skippedReasons].join('+') || null,
    });
  } catch (error) {
    console.error(`[notifyAdminNewMember] ${errorMessage(error)}`);
    return Response.json({
      error: 'admin_new_member_notification_failed',
      push_attempted: false,
      push_sent: false,
      push_skipped_reason: 'admin_new_member_notification_error',
    }, { status: 500 });
  }
};
