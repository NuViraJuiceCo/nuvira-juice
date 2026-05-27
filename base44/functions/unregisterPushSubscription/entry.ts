import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeSingleLine(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeApnsToken(value: unknown): string {
  return normalizeSingleLine(value).replace(/[^a-fA-F0-9]/g, '').toLowerCase();
}

function isMissingSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('Entity schema') && message.includes('not found');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    if (!user?.email) {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const endpoint = normalizeSingleLine(body.endpoint);
    const fcmToken = normalizeSingleLine(body.fcm_token);
    const apnsToken = normalizeApnsToken(body.apns_token);
    const customerEmail = normalizeEmail(user.email);
    const candidates = apnsToken
      ? await base44.asServiceRole.entities.PushSubscription.filter({ apns_token: apnsToken })
      : fcmToken
        ? await base44.asServiceRole.entities.PushSubscription.filter({ fcm_token: fcmToken })
        : endpoint
          ? await base44.asServiceRole.entities.PushSubscription.filter({ endpoint })
          : await base44.asServiceRole.entities.PushSubscription.filter({ customer_email: customerEmail });

    let revoked = 0;
    const revokedAt = new Date().toISOString();

    for (const record of candidates) {
      if (normalizeEmail(record.customer_email) !== customerEmail) continue;

      await base44.asServiceRole.entities.PushSubscription.update(record.id, {
        enabled: false,
        permission: 'default',
        revoked_at: revokedAt,
      });
      revoked += 1;
    }

    return Response.json({ success: true, revoked });
  } catch (error) {
    if (isMissingSchemaError(error)) {
      console.warn('[unregisterPushSubscription] PushSubscription schema unavailable');
      return Response.json({
        success: true,
        revoked: 0,
        reason: 'push_subscription_storage_unavailable',
      });
    }
    console.error('[unregisterPushSubscription] Error');
    return Response.json({ error: 'Unable to unregister push subscription' }, { status: 500 });
  }
});
