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

function sanitizeToken(value: unknown): string {
  const text = normalizeSingleLine(value);
  return text.length > 4096 ? '' : text;
}

function sanitizeApnsToken(value: unknown): string {
  const text = normalizeSingleLine(value).replace(/[^a-fA-F0-9]/g, '');
  return text.length >= 32 && text.length <= 512 ? text.toLowerCase() : '';
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
    const fcmToken = sanitizeToken(body.fcm_token);
    const apnsToken = sanitizeApnsToken(body.apns_token);
    const tokenType = apnsToken ? 'apns' : fcmToken ? 'fcm' : 'web_push';
    const endpoint = normalizeSingleLine(subscription.endpoint);
    const p256dh = normalizeSingleLine(subscription.keys?.p256dh);
    const auth = normalizeSingleLine(subscription.keys?.auth);

    if (tokenType === 'web_push' && (!endpoint || !p256dh || !auth)) {
      return Response.json({ error: 'Invalid push subscription payload' }, { status: 400 });
    }

    const apnsEnvironment = body.apns_environment === 'sandbox' || body.apns_environment === 'production'
      ? body.apns_environment
      : 'unknown';
    const now = new Date().toISOString();
    const payload = {
      customer_email: normalizeEmail(user.email),
      token_type: tokenType,
      endpoint: endpoint || null,
      p256dh: p256dh || null,
      auth: auth || null,
      fcm_token: fcmToken || null,
      apns_token: apnsToken || null,
      apns_environment: apnsToken ? apnsEnvironment : null,
      app_bundle_id: normalizeSingleLine(body.app_bundle_id).slice(0, 160) || null,
      enabled: true,
      permission: body.permission === 'denied' ? 'denied' : body.permission === 'default' ? 'default' : 'granted',
      device_platform: normalizeSingleLine(body.device_platform).slice(0, 40),
      platform: normalizeSingleLine(body.platform).slice(0, 120),
      app_shell: normalizeSingleLine(body.app_shell).slice(0, 80),
      user_agent: sanitizeUserAgent(body.user_agent),
      last_seen_at: now,
      revoked_at: null,
    };

    const existing = tokenType === 'apns'
      ? await base44.asServiceRole.entities.PushSubscription.filter({ apns_token: apnsToken }, undefined, 1)
      : tokenType === 'fcm'
        ? await base44.asServiceRole.entities.PushSubscription.filter({ fcm_token: fcmToken }, undefined, 1)
        : await base44.asServiceRole.entities.PushSubscription.filter({ endpoint }, undefined, 1);
    const record = existing[0]
      ? await base44.asServiceRole.entities.PushSubscription.update(existing[0].id, payload)
      : await base44.asServiceRole.entities.PushSubscription.create(payload);

    return Response.json({
      success: true,
      subscription_id: record.id,
      push_enabled: true,
      token_type: tokenType,
      device_platform: payload.device_platform || undefined,
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
