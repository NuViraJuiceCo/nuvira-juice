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

function isFallbackSubscriptionLog(record: Record<string, any>): boolean {
  return record.channel === 'push'
    && (
      record.message_type === 'may30_event_push_subscription'
      || record.metadata?.purpose === 'may30_event_push_subscription'
    );
}

function fallbackMatchesSelector(
  metadata: Record<string, any>,
  selectors: { endpoint: string; fcmToken: string; apnsToken: string },
): boolean {
  if (selectors.apnsToken) {
    return normalizeApnsToken(metadata.apns_token) === selectors.apnsToken;
  }
  if (selectors.fcmToken) {
    return normalizeSingleLine(metadata.fcm_token) === selectors.fcmToken;
  }
  if (selectors.endpoint) {
    return normalizeSingleLine(metadata.endpoint) === selectors.endpoint;
  }
  return true;
}

async function revokeFallbackPushSubscriptions(
  base44: any,
  customerEmail: string,
  selectors: { endpoint: string; fcmToken: string; apnsToken: string },
) {
  const rows = await base44.asServiceRole.entities.CustomerMessageDeliveryLog.filter({ customer_email: customerEmail });
  let revoked = 0;
  const revokedAt = new Date().toISOString();

  for (const row of rows) {
    if (!isFallbackSubscriptionLog(row)) continue;
    const metadata = row.metadata || {};
    if (metadata.enabled === false || metadata.revoked_at) continue;
    if (!fallbackMatchesSelector(metadata, selectors)) continue;

    await base44.asServiceRole.entities.CustomerMessageDeliveryLog.update(row.id, {
      status: 'skipped',
      metadata: {
        ...metadata,
        enabled: false,
        permission: 'default',
        revoked_at: revokedAt,
      },
    });
    revoked += 1;
  }

  return revoked;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let requestBase44: any = null;
  let customerEmail = '';
  let endpoint = '';
  let fcmToken = '';
  let apnsToken = '';

  try {
    const base44 = createClientFromRequest(req);
    requestBase44 = base44;
    const user = await base44.auth.me().catch(() => null);

    if (!user?.email) {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    endpoint = normalizeSingleLine(body.endpoint);
    fcmToken = normalizeSingleLine(body.fcm_token);
    apnsToken = normalizeApnsToken(body.apns_token);
    customerEmail = normalizeEmail(user.email);
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
      try {
        const revoked = await revokeFallbackPushSubscriptions(requestBase44, customerEmail, { endpoint, fcmToken, apnsToken });
        return Response.json({
          success: true,
          revoked,
          storage: 'CustomerMessageDeliveryLog',
        });
      } catch (fallbackError) {
        console.warn('[unregisterPushSubscription] Fallback push subscription storage unavailable');
        console.warn(fallbackError instanceof Error ? fallbackError.message : String(fallbackError || 'unknown'));
      }
      return Response.json({
        success: true,
        revoked: 0,
        reason: 'push_subscription_fallback_storage_unavailable',
      });
    }
    console.error('[unregisterPushSubscription] Error');
    return Response.json({ error: 'Unable to unregister push subscription' }, { status: 500 });
  }
});
