import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

type Base44Client = any;

const NOTIFICATION_SUBTYPE = 'admin_push_test';
const DEEP_LINK = '/admin/notifications';

function envFlag(name: string): boolean {
  return Deno.env.get(name) === 'true';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown');
}

function normalizeSingleLine(value: unknown): string {
  return (value ?? '').toString().trim().replace(/\s+/g, ' ');
}

function normalizeEmail(value: unknown): string {
  const email = normalizeSingleLine(value).toLowerCase();
  if (!email || email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

function isMissingSchemaError(error: unknown): boolean {
  const message = errorMessage(error);
  return message.includes('Entity schema') && message.includes('not found');
}

async function readJsonBody(req: Request): Promise<Record<string, any> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function hasActivePushToken(row: Record<string, any>): boolean {
  if (row.enabled === false || row.revoked_at) return false;
  const tokenType = normalizeSingleLine(row.token_type || (row.fcm_token ? 'fcm' : row.apns_token ? 'apns' : 'web_push'));

  if (tokenType === 'fcm') return Boolean(normalizeSingleLine(row.fcm_token));
  if (tokenType === 'apns') return Boolean(normalizeSingleLine(row.apns_token));
  return Boolean(normalizeSingleLine(row.endpoint) && normalizeSingleLine(row.p256dh) && normalizeSingleLine(row.auth));
}

function fallbackSubscriptionFromLog(row: Record<string, any>): Record<string, any> | null {
  if (row.channel !== 'push' || row.metadata?.purpose !== 'may30_event_push_subscription') return null;
  const metadata = row.metadata || {};
  return {
    token_type: metadata.token_type,
    endpoint: metadata.endpoint,
    p256dh: metadata.p256dh,
    auth: metadata.auth,
    fcm_token: metadata.fcm_token,
    apns_token: metadata.apns_token,
    enabled: metadata.enabled,
    revoked_at: metadata.revoked_at,
  };
}

async function countActiveSubscriptions(base44: Base44Client, adminEmail: string): Promise<number> {
  let count = 0;

  try {
    const rows = await base44.asServiceRole.entities.PushSubscription.filter({ customer_email: adminEmail });
    count += rows.filter(hasActivePushToken).length;
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
  }

  try {
    const rows = await base44.asServiceRole.entities.CustomerMessageDeliveryLog.filter({ customer_email: adminEmail });
    for (const row of rows) {
      const fallback = fallbackSubscriptionFromLog(row);
      if (fallback && hasActivePushToken(fallback)) count += 1;
    }
  } catch {
    // Fallback storage is best-effort; the main PushSubscription entity is the canonical path.
  }

  return count;
}

async function createTestNotification(base44: Base44Client, adminEmail: string, idempotencyKey: string) {
  const existing = await base44.asServiceRole.entities.Notification.filter({ idempotency_key: idempotencyKey }, null, 1);
  if (existing[0]) return existing[0];

  return await base44.asServiceRole.entities.Notification.create({
    customer_email: adminEmail,
    title: 'NuVira Admin Push Test',
    message: 'Admin push test delivered.',
    type: 'general',
    notification_subtype: NOTIFICATION_SUBTYPE,
    deep_link: DEEP_LINK,
    is_read: false,
    icon: null,
    idempotency_key: idempotencyKey,
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    const adminEmail = normalizeEmail(user?.email);

    if (!adminEmail) {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    if (!envFlag('ENABLE_ADMIN_PUSH_NOTIFICATIONS')) {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'admin_push_disabled',
        notification_created: false,
        push_attempted: false,
        push_sent: false,
        push_token_count: 0,
        push_skipped_reason: 'admin_push_disabled',
      });
    }

    const activeSubscriptionCount = await countActiveSubscriptions(base44, adminEmail);
    if (activeSubscriptionCount === 0) {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'no_active_push_subscription',
        notification_created: false,
        push_attempted: false,
        push_sent: false,
        push_token_count: 0,
        push_skipped_reason: 'no_active_push_subscription',
      });
    }

    const body = await readJsonBody(req);
    if (!body) {
      return Response.json({ error: 'malformed_json' }, { status: 400 });
    }
    const requestId = normalizeSingleLine(body.client_request_id)
      || crypto.randomUUID();
    const idempotencyKey = `admin_push_test_${adminEmail}_${requestId}`;
    const notification = await createTestNotification(base44, adminEmail, idempotencyKey);
    const result = await base44.asServiceRole.functions.invoke('sendCustomerPushNotification', {
      customer_email: adminEmail,
      notification_id: notification.id,
      title: 'NuVira Admin Push Test',
      message: 'Admin push test delivered.',
      type: 'general',
      notification_subtype: NOTIFICATION_SUBTYPE,
      deep_link: DEEP_LINK,
      idempotency_key: idempotencyKey,
    }).catch((error: unknown) => ({
      push_attempted: false,
      push_sent: false,
      push_skipped_reason: `push_function_error:${errorMessage(error).slice(0, 80)}`,
      token_count: activeSubscriptionCount,
    }));
    const data = result?.data || result || {};

    return Response.json({
      success: true,
      skipped: !data.push_sent,
      reason: data.push_sent ? null : data.push_skipped_reason || null,
      notification_created: true,
      notification_id: notification.id,
      push_attempted: Boolean(data.push_attempted),
      push_sent: Boolean(data.push_sent),
      push_sent_count: Number(data.sent_count || (data.push_sent ? 1 : 0)),
      push_failed_count: Number(data.failed_count || 0),
      push_revoked_count: Number(data.revoked_count || 0),
      push_token_count: Number(data.token_count || activeSubscriptionCount),
      push_skipped_reason: data.push_skipped_reason || null,
    });
  } catch (error) {
    console.error(`[sendAdminPushTestNotification] Error: ${errorMessage(error)}`);
    return Response.json({
      error: 'Unable to send admin push test',
      push_attempted: false,
      push_sent: false,
      push_skipped_reason: 'admin_push_test_error',
    }, { status: 500 });
  }
});
