import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TEST_TITLE = 'NuVira Push Test';
const TEST_BODY = 'Push notifications are active on this device.';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIREBASE_MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FIREBASE_SERVICE_ACCOUNT_JSON = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON') || '';
const FIREBASE_SERVICE_ACCOUNT_B64 = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_B64') || '';
const FIREBASE_PROJECT_ID = (Deno.env.get('FIREBASE_PROJECT_ID') || Deno.env.get('FCM_PROJECT_ID') || '').trim();
const APNS_AUTH_KEY = Deno.env.get('APNS_AUTH_KEY') || '';
const APNS_AUTH_KEY_B64 = Deno.env.get('APNS_AUTH_KEY_B64') || '';
const APNS_KEY_ID = (Deno.env.get('APNS_KEY_ID') || '').trim();
const APNS_TEAM_ID = (Deno.env.get('APNS_TEAM_ID') || '').trim();
const APNS_BUNDLE_ID = (Deno.env.get('APNS_BUNDLE_ID') || 'com.base69d48d0c39891f7945481152.app').trim();
const APNS_PRIMARY_ENVIRONMENT = (Deno.env.get('APNS_PRIMARY_ENVIRONMENT') || 'production').trim() === 'sandbox'
  ? 'sandbox'
  : 'production';
const APNS_ALLOW_ENV_FALLBACK = Deno.env.get('APNS_ALLOW_ENV_FALLBACK') !== 'false';

type Base44Client = any;
type PushSubscriptionRecord = Record<string, any>;
type FirebaseServiceAccount = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
  token_uri?: string;
};

let firebaseAccessTokenCache: { accessToken: string; expiresAt: number } | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown');
}

function envFlag(name: string): boolean {
  return Deno.env.get(name) === 'true';
}

function normalizeSingleLine(value: unknown): string {
  return (value ?? '').toString().trim().replace(/\s+/g, ' ');
}

function normalizeEmail(value: unknown): string {
  const email = normalizeSingleLine(value).toLowerCase();
  if (!email || email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Authenticated customer email is unavailable');
  }
  return email;
}

function isMissingSchemaError(error: unknown): boolean {
  const message = errorMessage(error);
  return message.includes('Entity schema') && message.includes('not found');
}

function base64UrlEncode(input: string | ArrayBuffer | Uint8Array): string {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : input instanceof Uint8Array
    ? input
    : new Uint8Array(input);

  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64(input: string): Uint8Array {
  const binary = atob(input.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function readApnsPrivateKey(): string {
  if (APNS_AUTH_KEY.trim()) return APNS_AUTH_KEY.trim().replace(/\\n/g, '\n');
  if (!APNS_AUTH_KEY_B64.trim()) return '';
  return new TextDecoder().decode(decodeBase64(APNS_AUTH_KEY_B64)).trim().replace(/\\n/g, '\n');
}

function pemToPkcs8(privateKey: string): ArrayBuffer {
  const normalized = privateKey.replace(/\\n/g, '\n');
  const base64 = normalized
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const bytes = decodeBase64(base64);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function createApnsJwt(): Promise<string> {
  const privateKey = readApnsPrivateKey();
  if (!privateKey || !APNS_KEY_ID || !APNS_TEAM_ID) {
    throw new Error('APNs credentials are incomplete');
  }

  const header = base64UrlEncode(JSON.stringify({ alg: 'ES256', kid: APNS_KEY_ID }));
  const payload = base64UrlEncode(JSON.stringify({
    iss: APNS_TEAM_ID,
    iat: Math.floor(Date.now() / 1000),
  }));
  const unsignedJwt = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsignedJwt),
  );
  return `${unsignedJwt}.${base64UrlEncode(signature)}`;
}

function readFirebaseServiceAccount(): FirebaseServiceAccount | null {
  const raw = FIREBASE_SERVICE_ACCOUNT_JSON.trim()
    || (FIREBASE_SERVICE_ACCOUNT_B64.trim()
      ? new TextDecoder().decode(decodeBase64(FIREBASE_SERVICE_ACCOUNT_B64))
      : '');

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as FirebaseServiceAccount;
    if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    if (!parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch (error) {
    console.warn(`[sendMay30PushTest] Firebase service account parse failed: ${errorMessage(error)}`);
    return null;
  }
}

async function createFirebaseJwt(serviceAccount: FirebaseServiceAccount): Promise<string> {
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('Firebase service account is incomplete');
  }

  const tokenUrl = serviceAccount.token_uri || GOOGLE_OAUTH_TOKEN_URL;
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: FIREBASE_MESSAGING_SCOPE,
    aud: tokenUrl,
    iat: now,
    exp: now + 3600,
  }));
  const unsignedJwt = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(unsignedJwt),
  );

  return `${unsignedJwt}.${base64UrlEncode(signature)}`;
}

async function getFirebaseAccessToken(serviceAccount: FirebaseServiceAccount): Promise<string> {
  if (firebaseAccessTokenCache && firebaseAccessTokenCache.expiresAt > Date.now() + 60_000) {
    return firebaseAccessTokenCache.accessToken;
  }

  const assertion = await createFirebaseJwt(serviceAccount);
  const tokenUrl = serviceAccount.token_uri || GOOGLE_OAUTH_TOKEN_URL;
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(`Firebase access token request failed: ${response.status}`);
  }

  firebaseAccessTokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000,
  };
  return firebaseAccessTokenCache.accessToken;
}

function fcmErrorCode(errorBody: Record<string, any>): string {
  const details = Array.isArray(errorBody?.error?.details) ? errorBody.error.details : [];
  const fcmDetail = details.find((detail: Record<string, any>) =>
    normalizeSingleLine(detail?.['@type']).includes('google.firebase.fcm.v1.FcmError')
  );
  return normalizeSingleLine(fcmDetail?.errorCode || errorBody?.error?.status);
}

function shouldRevokeFcmToken(statusCode: number, errorCode: string): boolean {
  return statusCode === 404 || errorCode === 'UNREGISTERED' || errorCode === 'SENDER_ID_MISMATCH';
}

async function resolveIdentityEmails(base44: Base44Client, email: string): Promise<string[]> {
  const identities = new Set([email]);

  try {
    const fwdProfiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: email });
    if (fwdProfiles[0]?.customer_email) identities.add(normalizeEmail(fwdProfiles[0].customer_email));
    if (fwdProfiles[0]?.contact_email) identities.add(normalizeEmail(fwdProfiles[0].contact_email));

    const revProfiles = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: email });
    for (const profile of revProfiles) {
      if (profile.customer_email) identities.add(normalizeEmail(profile.customer_email));
      if (profile.contact_email) identities.add(normalizeEmail(profile.contact_email));
    }
  } catch (error) {
    console.warn(`[sendMay30PushTest] Identity resolution partial failure: ${errorMessage(error)}`);
  }

  return [...identities];
}

async function findFcmSubscriptions(base44: Base44Client, identityEmails: string[]): Promise<PushSubscriptionRecord[]> {
  const subscriptions: PushSubscriptionRecord[] = [];
  const seenTokens = new Set<string>();

  for (const email of identityEmails) {
    const rows = await base44.asServiceRole.entities.PushSubscription.filter({ customer_email: email });
    for (const row of rows) {
      if (row.enabled === false || row.revoked_at) continue;

      const tokenType = normalizeSingleLine(row.token_type || (row.fcm_token ? 'fcm' : 'web_push'));
      const fcmToken = normalizeSingleLine(row.fcm_token);
      if (tokenType !== 'fcm' || !fcmToken || seenTokens.has(fcmToken)) continue;

      seenTokens.add(fcmToken);
      subscriptions.push({ ...row, token_type: 'fcm' });
    }
  }

  return subscriptions;
}

async function findApnsSubscriptions(base44: Base44Client, identityEmails: string[]): Promise<PushSubscriptionRecord[]> {
  const subscriptions: PushSubscriptionRecord[] = [];
  const seenTokens = new Set<string>();

  for (const email of identityEmails) {
    const rows = await base44.asServiceRole.entities.PushSubscription.filter({ customer_email: email });
    for (const row of rows) {
      if (row.enabled === false || row.revoked_at) continue;

      const tokenType = normalizeSingleLine(row.token_type || (row.apns_token ? 'apns' : 'web_push'));
      const apnsToken = normalizeSingleLine(row.apns_token).replace(/[^a-fA-F0-9]/g, '').toLowerCase();
      if (tokenType !== 'apns' || !apnsToken || seenTokens.has(apnsToken)) continue;

      seenTokens.add(apnsToken);
      subscriptions.push({ ...row, apns_token: apnsToken, token_type: 'apns' });
    }
  }

  return subscriptions;
}

async function sendFcmTest(base44: Base44Client, subscriptions: PushSubscriptionRecord[]) {
  const serviceAccount = readFirebaseServiceAccount();
  const projectId = FIREBASE_PROJECT_ID || serviceAccount?.project_id || '';
  if (!serviceAccount || !projectId) {
    return { sent: 0, failed: 0, revoked: 0, skipped_reason: 'firebase_service_account_missing' };
  }

  let accessToken = '';
  try {
    accessToken = await getFirebaseAccessToken(serviceAccount);
  } catch (error) {
    console.warn(`[sendMay30PushTest] Firebase access token unavailable: ${errorMessage(error)}`);
    return { sent: 0, failed: 0, revoked: 0, skipped_reason: 'firebase_access_token_unavailable' };
  }

  let sent = 0;
  let failed = 0;
  let revoked = 0;
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
  const tag = `may30_push_test_${Date.now()}`;

  for (const record of subscriptions) {
    const fcmToken = normalizeSingleLine(record.fcm_token);
    if (!fcmToken) continue;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: fcmToken,
          notification: {
            title: TEST_TITLE,
            body: TEST_BODY,
          },
          data: {
            url: '/event/may30',
            tag,
            type: 'push_test',
            notification_subtype: 'may30_push_test',
          },
          apns: {
            headers: {
              'apns-priority': '10',
            },
            payload: {
              aps: {
                sound: 'default',
              },
            },
          },
        },
      }),
    });

    if (response.ok) {
      sent += 1;
      await base44.asServiceRole.entities.PushSubscription.update(record.id, {
        last_seen_at: new Date().toISOString(),
      });
      continue;
    }

    failed += 1;
    const errorBody = await response.json().catch(() => ({}));
    const errorCode = fcmErrorCode(errorBody);
    if (shouldRevokeFcmToken(response.status, errorCode)) {
      revoked += 1;
      await base44.asServiceRole.entities.PushSubscription.update(record.id, {
        enabled: false,
        revoked_at: new Date().toISOString(),
      });
    }
    console.warn(`[sendMay30PushTest] FCM push failed for a subscription: ${response.status} ${errorCode || 'unknown'}`);
  }

  return { sent, failed, revoked, skipped_reason: null };
}

function apnsEnvironments(record: PushSubscriptionRecord): string[] {
  const recordEnvironment = normalizeSingleLine(record.apns_environment);
  const preferred = recordEnvironment === 'sandbox' || recordEnvironment === 'production'
    ? recordEnvironment
    : APNS_PRIMARY_ENVIRONMENT;
  const environments = [preferred];
  const fallback = preferred === 'production' ? 'sandbox' : 'production';
  if (APNS_ALLOW_ENV_FALLBACK) environments.push(fallback);
  return environments;
}

function shouldRevokeApnsToken(statusCode: number, reason: string): boolean {
  return statusCode === 410 || reason === 'Unregistered' || reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic';
}

async function sendApnsTest(base44: Base44Client, subscriptions: PushSubscriptionRecord[]) {
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_BUNDLE_ID || !readApnsPrivateKey()) {
    return { sent: 0, failed: 0, revoked: 0, skipped_reason: 'apns_credentials_missing' };
  }

  let jwt = '';
  try {
    jwt = await createApnsJwt();
  } catch (error) {
    console.warn(`[sendMay30PushTest] APNs JWT unavailable: ${errorMessage(error)}`);
    return { sent: 0, failed: 0, revoked: 0, skipped_reason: 'apns_jwt_unavailable' };
  }

  let sent = 0;
  let failed = 0;
  let revoked = 0;
  const tag = `may30_push_test_${Date.now()}`;

  for (const record of subscriptions) {
    const apnsToken = normalizeSingleLine(record.apns_token).replace(/[^a-fA-F0-9]/g, '').toLowerCase();
    if (!apnsToken) continue;

    let delivered = false;
    let lastStatus = 0;
    let lastReason = '';

    for (const environment of apnsEnvironments(record)) {
      const host = environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
      let response: Response;
      try {
        response = await fetch(`https://${host}/3/device/${apnsToken}`, {
          method: 'POST',
          headers: {
            authorization: `bearer ${jwt}`,
            'apns-topic': normalizeSingleLine(record.app_bundle_id || APNS_BUNDLE_ID),
            'apns-push-type': 'alert',
            'apns-priority': '10',
            'apns-collapse-id': tag.slice(0, 64),
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            aps: {
              alert: {
                title: TEST_TITLE,
                body: TEST_BODY,
              },
              sound: 'default',
            },
            url: '/event/may30',
            tag,
            type: 'push_test',
            notification_subtype: 'may30_push_test',
          }),
        });
      } catch (error) {
        lastReason = 'apns_request_failed';
        console.warn(`[sendMay30PushTest] APNs request failed: ${errorMessage(error)}`);
        continue;
      }

      if (response.ok) {
        sent += 1;
        delivered = true;
        await base44.asServiceRole.entities.PushSubscription.update(record.id, {
          last_seen_at: new Date().toISOString(),
          apns_environment: environment,
        });
        break;
      }

      lastStatus = response.status;
      const errorBody = await response.json().catch(() => ({}));
      lastReason = normalizeSingleLine(errorBody?.reason || response.statusText);
      console.warn(`[sendMay30PushTest] APNs push failed for a subscription: ${response.status} ${lastReason || 'unknown'}`);
    }

    if (delivered) continue;

    failed += 1;
    if (shouldRevokeApnsToken(lastStatus, lastReason)) {
      revoked += 1;
      await base44.asServiceRole.entities.PushSubscription.update(record.id, {
        enabled: false,
        revoked_at: new Date().toISOString(),
      });
    }
  }

  return { sent, failed, revoked, skipped_reason: null };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    if (!envFlag('ENABLE_MAY30_EVENT_PUSH')) {
      return Response.json({
        success: true,
        push_attempted: false,
        push_sent: false,
        push_skipped_reason: 'event_push_disabled',
        token_count: 0,
        fcm_sent: 0,
        fcm_failed: 0,
        fcm_revoked: 0,
      });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const userEmail = normalizeEmail(user.email);
    const targetEmail = normalizeEmail(body.customer_email || userEmail);
    const isSelfTest = targetEmail === userEmail;
    const isAdmin = normalizeSingleLine(user.role).toLowerCase() === 'admin';

    if (!isSelfTest && !isAdmin) {
      return Response.json({ error: 'Admin role required for targeted push test' }, { status: 403 });
    }

    const identityEmails = await resolveIdentityEmails(base44, targetEmail);
    let fcmSubscriptions: PushSubscriptionRecord[] = [];
    let apnsSubscriptions: PushSubscriptionRecord[] = [];
    try {
      [fcmSubscriptions, apnsSubscriptions] = await Promise.all([
        findFcmSubscriptions(base44, identityEmails),
        findApnsSubscriptions(base44, identityEmails),
      ]);
    } catch (error) {
      if (isMissingSchemaError(error)) {
        return Response.json({
          success: true,
          push_attempted: false,
          push_sent: false,
          push_skipped_reason: 'push_subscription_storage_unavailable',
          token_count: 0,
          fcm_sent: 0,
          fcm_failed: 0,
          fcm_revoked: 0,
        });
      }
      throw error;
    }

    const tokenCount = fcmSubscriptions.length + apnsSubscriptions.length;
    if (tokenCount === 0) {
      return Response.json({
        success: true,
        push_attempted: false,
        push_sent: false,
        push_skipped_reason: 'no_active_native_subscription',
        token_count: 0,
        fcm_sent: 0,
        fcm_failed: 0,
        fcm_revoked: 0,
        apns_sent: 0,
        apns_failed: 0,
        apns_revoked: 0,
      });
    }

    const fcmResult = fcmSubscriptions.length > 0
      ? await sendFcmTest(base44, fcmSubscriptions)
      : { sent: 0, failed: 0, revoked: 0, skipped_reason: 'no_active_fcm_subscription' };
    const apnsResult = apnsSubscriptions.length > 0
      ? await sendApnsTest(base44, apnsSubscriptions)
      : { sent: 0, failed: 0, revoked: 0, skipped_reason: 'no_active_apns_subscription' };
    const attempted = !fcmResult.skipped_reason || !apnsResult.skipped_reason;
    const sent = fcmResult.sent + apnsResult.sent;
    const skippedReasons = [fcmResult.skipped_reason, apnsResult.skipped_reason]
      .filter((reason) => reason && !reason.startsWith('no_active_'));

    return Response.json({
      success: true,
      push_attempted: attempted,
      push_sent: sent > 0,
      push_skipped_reason: sent > 0 ? null : attempted ? 'push_delivery_failed' : skippedReasons.join('+') || 'push_provider_credentials_missing',
      token_count: tokenCount,
      fcm_sent: fcmResult.sent,
      fcm_failed: fcmResult.failed,
      fcm_revoked: fcmResult.revoked,
      apns_sent: apnsResult.sent,
      apns_failed: apnsResult.failed,
      apns_revoked: apnsResult.revoked,
    });
  } catch (error) {
    console.error(`[sendMay30PushTest] Error: ${errorMessage(error)}`);
    return Response.json({
      error: 'Unable to send May 30 push test',
      success: false,
      push_attempted: false,
      push_sent: false,
      push_skipped_reason: 'push_test_error',
    }, { status: 500 });
  }
});
