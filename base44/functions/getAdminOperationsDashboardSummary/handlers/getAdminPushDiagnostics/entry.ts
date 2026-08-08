// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

type Base44Client = any;
type TokenCounts = {
  web_push: number;
  fcm: number;
  apns: number;
};

function envFlag(name: string): boolean {
  return Deno.env.get(name) === 'true';
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
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('Entity schema') && message.includes('not found');
}

function activeTokenType(row: Record<string, any>): keyof TokenCounts | null {
  if (row.enabled === false || row.revoked_at) return null;

  const tokenType = normalizeSingleLine(row.token_type || (row.fcm_token ? 'fcm' : row.apns_token ? 'apns' : 'web_push'));
  if (tokenType === 'fcm' && normalizeSingleLine(row.fcm_token)) return 'fcm';
  if (tokenType === 'apns' && normalizeSingleLine(row.apns_token)) return 'apns';
  if (normalizeSingleLine(row.endpoint) && normalizeSingleLine(row.p256dh) && normalizeSingleLine(row.auth)) return 'web_push';

  return null;
}

function isFallbackPushSubscription(row: Record<string, any>): boolean {
  return row.channel === 'push'
    && row.metadata?.purpose === 'push_subscription_fallback';
}

function fallbackSubscriptionFromLog(row: Record<string, any>): Record<string, any> | null {
  if (!isFallbackPushSubscription(row)) return null;
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

async function readSubscriptionCounts(base44: Base44Client, adminEmail: string) {
  const counts: TokenCounts = { web_push: 0, fcm: 0, apns: 0 };
  const storage = {
    push_subscription_available: true,
    fallback_checked: false,
  };

  try {
    const rows = await base44.asServiceRole.entities.PushSubscription.filter({ customer_email: adminEmail });
    for (const row of rows) {
      const tokenType = activeTokenType(row);
      if (tokenType) counts[tokenType] += 1;
    }
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    storage.push_subscription_available = false;
  }

  try {
    const rows = await base44.asServiceRole.entities.CustomerMessageDeliveryLog.filter({ customer_email: adminEmail });
    storage.fallback_checked = true;
    for (const row of rows) {
      const fallback = fallbackSubscriptionFromLog(row);
      if (!fallback) continue;
      const tokenType = activeTokenType(fallback);
      if (tokenType) counts[tokenType] += 1;
    }
  } catch {
    storage.fallback_checked = false;
  }

  return { counts, storage };
}

function providerReadiness() {
  const webPushPublicKey = (Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY') || '').trim();
  const webPushConfigured = Boolean(webPushPublicKey && Deno.env.get('WEB_PUSH_VAPID_PRIVATE_KEY'));
  const firebaseConfigured = Boolean(
    (Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON') || Deno.env.get('FIREBASE_SERVICE_ACCOUNT_B64'))
    && (Deno.env.get('FIREBASE_PROJECT_ID') || Deno.env.get('FCM_PROJECT_ID'))
  );
  const apnsConfigured = Boolean(
    (Deno.env.get('APNS_AUTH_KEY') || Deno.env.get('APNS_AUTH_KEY_B64'))
    && Deno.env.get('APNS_KEY_ID')
    && Deno.env.get('APNS_TEAM_ID')
    && Deno.env.get('APNS_BUNDLE_ID')
  );

  return {
    web_push_configured: webPushConfigured,
    web_push_public_key_configured: Boolean(webPushPublicKey),
    web_push_public_key: webPushPublicKey,
    fcm_configured: firebaseConfigured,
    apns_configured: apnsConfigured,
  };
}

export default async function handler(req: Request) {
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

    const { counts, storage } = await readSubscriptionCounts(base44, adminEmail);
    const providers = providerReadiness();
    const activeTokenTypes = Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([type]) => type);
    const blockedReasons = new Set<string>();

    if (!envFlag('ENABLE_ADMIN_PUSH_NOTIFICATIONS')) blockedReasons.add('admin_push_disabled');
    if (counts.web_push > 0 && !providers.web_push_configured) blockedReasons.add('vapid_private_key_missing');
    if (counts.fcm > 0 && !providers.fcm_configured) blockedReasons.add('firebase_credentials_missing');
    if (counts.apns > 0 && !providers.apns_configured) blockedReasons.add('apns_credentials_missing');
    if (activeTokenTypes.length === 0) blockedReasons.add('no_active_push_subscription');

    return Response.json({
      success: true,
      admin_email: adminEmail,
      flags: {
        admin_push_enabled: envFlag('ENABLE_ADMIN_PUSH_NOTIFICATIONS'),
        admin_order_processed_push_enabled: envFlag('ENABLE_ADMIN_ORDER_PROCESSED_PUSH'),
      },
      active_subscription_count: counts.web_push + counts.fcm + counts.apns,
      active_token_types: activeTokenTypes,
      token_counts: counts,
      providers,
      storage,
      ready: blockedReasons.size === 0,
      blocked_reasons: [...blockedReasons],
    });
  } catch (error) {
    console.error(`[getAdminPushDiagnostics] Error: ${error instanceof Error ? error.message : String(error || 'unknown')}`);
    return Response.json({
      error: 'Unable to read admin push diagnostics',
      ready: false,
      blocked_reasons: ['diagnostics_error'],
    }, { status: 500 });
  }
}
