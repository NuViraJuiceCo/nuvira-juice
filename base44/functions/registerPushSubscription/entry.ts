import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeSingleLine(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function sanitizeUserAgent(value: unknown): string {
  const text = normalizeSingleLine(value);
  return text.length > 300 ? `${text.slice(0, 299).trim()}...` : text;
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
    const subscription = body.subscription || {};
    const endpoint = normalizeSingleLine(subscription.endpoint);
    const p256dh = normalizeSingleLine(subscription.keys?.p256dh);
    const auth = normalizeSingleLine(subscription.keys?.auth);

    if (!endpoint || !p256dh || !auth) {
      return Response.json({ error: 'Invalid push subscription payload' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const payload = {
      customer_email: normalizeEmail(user.email),
      endpoint,
      p256dh,
      auth,
      enabled: true,
      permission: body.permission === 'denied' ? 'denied' : body.permission === 'default' ? 'default' : 'granted',
      platform: normalizeSingleLine(body.platform).slice(0, 120),
      user_agent: sanitizeUserAgent(body.user_agent),
      last_seen_at: now,
      revoked_at: null,
    };

    const existing = await base44.asServiceRole.entities.PushSubscription.filter({ endpoint }, undefined, 1);
    const record = existing[0]
      ? await base44.asServiceRole.entities.PushSubscription.update(existing[0].id, payload)
      : await base44.asServiceRole.entities.PushSubscription.create(payload);

    return Response.json({
      success: true,
      subscription_id: record.id,
      push_enabled: true,
    });
  } catch (error) {
    if (isMissingSchemaError(error)) {
      console.warn('[registerPushSubscription] PushSubscription schema unavailable');
      return Response.json({
        success: false,
        push_enabled: false,
        reason: 'push_subscription_storage_unavailable',
      });
    }
    console.error('[registerPushSubscription] Error');
    return Response.json({ error: 'Unable to register push subscription' }, { status: 500 });
  }
});
