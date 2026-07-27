import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
// @deno-types="npm:@types/web-push@3.6.4"
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC_KEY = Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY') || '';
const VAPID_PRIVATE_KEY = Deno.env.get('WEB_PUSH_VAPID_PRIVATE_KEY');
const VAPID_CONTACT = Deno.env.get('WEB_PUSH_CONTACT') || 'mailto:info@nuvirajuice.com';
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

async function readJsonBody(req: Request): Promise<Record<string, any> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
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
    throw new Error('Customer email is unavailable');
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
    console.warn(`[sendCustomerPushNotification] Firebase service account parse failed: ${errorMessage(error)}`);
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

function isFallbackSubscriptionLog(record: Record<string, any>): boolean {
  return record.channel === 'push'
    && (
      record.message_type === 'may30_event_push_subscription'
      || record.metadata?.purpose === 'may30_event_push_subscription'
    );
}

function fallbackLogToSubscription(row: Record<string, any>): PushSubscriptionRecord | null {
  if (!isFallbackSubscriptionLog(row)) return null;
  const metadata = row.metadata || {};
  return {
    ...metadata,
    id: row.id,
    customer_email: row.customer_email,
    _storage: 'CustomerMessageDeliveryLog',
    _metadata: metadata,
  };
}

async function findFallbackPushSubscriptions(base44: Base44Client, identityEmails: string[]): Promise<PushSubscriptionRecord[]> {
  const subscriptions: PushSubscriptionRecord[] = [];
  const seenRows = new Set<string>();

  for (const email of identityEmails) {
    const rows = await base44.asServiceRole.entities.CustomerMessageDeliveryLog.filter({ customer_email: email });
    for (const row of rows) {
      if (!row.id || seenRows.has(row.id)) continue;
      const subscription = fallbackLogToSubscription(row);
      if (!subscription) continue;

      seenRows.add(row.id);
      subscriptions.push(subscription);
    }
  }

  return subscriptions;
}

async function findPushSubscriptionRows(base44: Base44Client, email: string): Promise<PushSubscriptionRecord[]> {
  const rows: PushSubscriptionRecord[] = [];

  try {
    rows.push(...await base44.asServiceRole.entities.PushSubscription.filter({ customer_email: email }));
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    console.warn('[sendCustomerPushNotification] PushSubscription schema unavailable; checking fallback storage');
  }

  try {
    rows.push(...await findFallbackPushSubscriptions(base44, [email]));
  } catch (error) {
    if (rows.length === 0) throw error;
    console.warn(`[sendCustomerPushNotification] Fallback subscription lookup skipped: ${errorMessage(error)}`);
  }

  return rows;
}

async function resolveIdentityEmails(base44: Base44Client, customerEmail: string): Promise<string[]> {
  const identities = new Set([customerEmail]);

  try {
    const fwdProfiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: customerEmail });
    if (fwdProfiles[0]?.customer_email) identities.add(normalizeEmail(fwdProfiles[0].customer_email));
    if (fwdProfiles[0]?.contact_email) identities.add(normalizeEmail(fwdProfiles[0].contact_email));

    const revProfiles = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: customerEmail });
    for (const profile of revProfiles) {
      if (profile.customer_email) identities.add(normalizeEmail(profile.customer_email));
      if (profile.contact_email) identities.add(normalizeEmail(profile.contact_email));
    }
  } catch (error) {
    console.warn(`[sendCustomerPushNotification] Identity resolution partial failure: ${errorMessage(error)}`);
  }

  return [...identities];
}

async function findPushSubscriptions(base44: Base44Client, identityEmails: string[]) {
  const subscriptions: PushSubscriptionRecord[] = [];
  const seenSubscriptions = new Set<string>();

  for (const email of identityEmails) {
    const rows = await findPushSubscriptionRows(base44, email);
    for (const row of rows) {
      if (row.enabled === false || row.revoked_at) continue;

      const tokenType = normalizeSingleLine(row.token_type || (row.fcm_token ? 'fcm' : 'web_push'));
      if (tokenType === 'fcm') {
        const fcmToken = normalizeSingleLine(row.fcm_token);
        if (!fcmToken) continue;

        const dedupeKey = `fcm:${fcmToken}`;
        if (seenSubscriptions.has(dedupeKey)) continue;

        seenSubscriptions.add(dedupeKey);
        subscriptions.push({ ...row, token_type: 'fcm' });
        continue;
      }

      if (tokenType === 'apns') {
        const apnsToken = normalizeSingleLine(row.apns_token).replace(/[^a-fA-F0-9]/g, '').toLowerCase();
        if (!apnsToken) continue;

        const dedupeKey = `apns:${apnsToken}`;
        if (seenSubscriptions.has(dedupeKey)) continue;

        seenSubscriptions.add(dedupeKey);
        subscriptions.push({ ...row, apns_token: apnsToken, token_type: 'apns' });
        continue;
      }

      if (!row.endpoint || !row.p256dh || !row.auth) continue;
      const dedupeKey = `web:${row.endpoint}`;
      if (seenSubscriptions.has(dedupeKey)) continue;

      seenSubscriptions.add(dedupeKey);
      subscriptions.push({ ...row, token_type: 'web_push' });
    }
  }

  return subscriptions;
}

async function updatePushSubscriptionRecord(
  base44: Base44Client,
  record: PushSubscriptionRecord,
  updates: Record<string, any>,
) {
  if (record._storage === 'request_direct') return;

  if (record._storage !== 'CustomerMessageDeliveryLog') {
    await base44.asServiceRole.entities.PushSubscription.update(record.id, updates);
    return;
  }

  await base44.asServiceRole.entities.CustomerMessageDeliveryLog.update(record.id, {
    status: updates.enabled === false ? 'skipped' : 'sent',
    sent_at: new Date().toISOString(),
    metadata: {
      ...(record._metadata || {}),
      ...updates,
    },
  });
}

function notificationCampaignSendsEnabled(): boolean {
  return Deno.env.get('DISABLE_NOTIFICATION_CAMPAIGN_SENDS') !== 'true';
}

function pushSubtypeEnabled(notificationSubtype: string, type: string, source = ''): { enabled: boolean; reason: string | null } {
  if (notificationSubtype === 'admin_push_test') {
    return envFlag('ENABLE_ADMIN_PUSH_NOTIFICATIONS')
      ? { enabled: true, reason: null }
      : { enabled: false, reason: 'admin_push_disabled' };
  }

  if (notificationSubtype === 'admin_order_processed') {
    if (!envFlag('ENABLE_ADMIN_PUSH_NOTIFICATIONS')) {
      return { enabled: false, reason: 'admin_push_disabled' };
    }
    return envFlag('ENABLE_ADMIN_ORDER_PROCESSED_PUSH')
      ? { enabled: true, reason: null }
      : { enabled: false, reason: 'admin_order_processed_push_disabled' };
  }

  if (!envFlag('ENABLE_CUSTOMER_PUSH_NOTIFICATIONS')) {
    return { enabled: false, reason: 'customer_push_disabled' };
  }

  if (notificationSubtype === 'order_confirmation') {
    return envFlag('ENABLE_CUSTOMER_ORDER_CONFIRMATION_PUSH')
      ? { enabled: true, reason: null }
      : { enabled: false, reason: 'order_confirmation_push_disabled' };
  }

  if (notificationSubtype === 'loyalty_credit') {
    return envFlag('ENABLE_EVENT_BONUS_PUSH') || envFlag('ENABLE_CUSTOMER_REWARDS_PUSH')
      ? { enabled: true, reason: null }
      : { enabled: false, reason: 'rewards_push_disabled' };
  }

  if (notificationSubtype === 'subscription_payment_failed') {
    return envFlag('ENABLE_CUSTOMER_SUBSCRIPTION_PAYMENT_FAILED_PUSH')
      ? { enabled: true, reason: null }
      : { enabled: false, reason: 'subscription_payment_failed_push_disabled' };
  }

  if (['delivery_reminder', 'out_for_delivery', 'delivered', 'production_reminder'].includes(notificationSubtype)) {
    return envFlag('ENABLE_CUSTOMER_DELIVERY_PUSH')
      ? { enabled: true, reason: null }
      : { enabled: false, reason: 'delivery_push_disabled' };
  }

  if (source === 'notification_campaign' && ['promo', 'general'].includes(notificationSubtype)) {
    return envFlag('ENABLE_CUSTOMER_PUSH_NOTIFICATIONS') && notificationCampaignSendsEnabled()
      ? { enabled: true, reason: null }
      : { enabled: false, reason: 'notification_campaign_push_disabled' };
  }

  if (notificationSubtype === 'promo' || type === 'promotion' || type === 'new_drop') {
    return envFlag('ENABLE_BROAD_CUSTOMER_PUSH') && envFlag('ENABLE_CUSTOMER_MARKETING_PUSH')
      ? { enabled: true, reason: null }
      : { enabled: false, reason: 'broad_customer_push_disabled' };
  }

  return { enabled: false, reason: 'push_subtype_not_enabled' };
}

async function verifyNotificationRecord(
  base44: Base44Client,
  notificationId: string,
  customerEmail: string,
  title: string,
  message: string,
) {
  const rows = await base44.asServiceRole.entities.Notification.filter({ id: notificationId }, null, 1);
  const notification = rows[0];
  if (!notification) return false;
  return normalizeEmail(notification.customer_email) === customerEmail
    && normalizeSingleLine(notification.title) === title
    && normalizeSingleLine(notification.message) === message;
}

async function sendWebPushSubscriptions(
  base44: Base44Client,
  subscriptions: PushSubscriptionRecord[],
  payload: string,
) {
  let sent = 0;
  let failed = 0;
  let revoked = 0;

  webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY as string);

  for (const record of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: record.endpoint,
        keys: {
          p256dh: record.p256dh,
          auth: record.auth,
        },
      }, payload);

      sent += 1;
      await updatePushSubscriptionRecord(base44, record, {
        last_seen_at: new Date().toISOString(),
      });
    } catch (error) {
      failed += 1;
      const pushError = error as { statusCode?: number; status?: number };
      const statusCode = pushError?.statusCode || pushError?.status;
      if (statusCode === 404 || statusCode === 410) {
        revoked += 1;
        await updatePushSubscriptionRecord(base44, record, {
          enabled: false,
          revoked_at: new Date().toISOString(),
        });
      }
      console.warn(`[sendCustomerPushNotification] Web push failed for a subscription: ${statusCode || 'unknown'}`);
    }
  }

  return { sent, failed, revoked };
}

async function sendFcmSubscriptions(
  base44: Base44Client,
  subscriptions: PushSubscriptionRecord[],
  payload: Record<string, string>,
) {
  const serviceAccount = readFirebaseServiceAccount();
  const projectId = FIREBASE_PROJECT_ID || serviceAccount?.project_id || '';
  if (!serviceAccount || !projectId) {
    return { sent: 0, failed: 0, revoked: 0, skipped_reason: 'firebase_service_account_missing' };
  }

  let accessToken = '';
  try {
    accessToken = await getFirebaseAccessToken(serviceAccount);
  } catch (error) {
    console.warn(`[sendCustomerPushNotification] Firebase access token unavailable: ${errorMessage(error)}`);
    return { sent: 0, failed: 0, revoked: 0, skipped_reason: 'firebase_access_token_unavailable' };
  }

  let sent = 0;
  let failed = 0;
  let revoked = 0;
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;

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
            title: payload.title,
            body: payload.body,
          },
          data: payload,
        },
      }),
    });

    if (response.ok) {
      sent += 1;
      await updatePushSubscriptionRecord(base44, record, {
        last_seen_at: new Date().toISOString(),
      });
      continue;
    }

    failed += 1;
    const errorBody = await response.json().catch(() => ({}));
    const errorCode = fcmErrorCode(errorBody);
    if (shouldRevokeFcmToken(response.status, errorCode)) {
      revoked += 1;
      await updatePushSubscriptionRecord(base44, record, {
        enabled: false,
        revoked_at: new Date().toISOString(),
      });
    }
    console.warn(`[sendCustomerPushNotification] FCM push failed for a subscription: ${response.status} ${errorCode || 'unknown'}`);
  }

  return { sent, failed, revoked, skipped_reason: null };
}

function apnsEnvironments(record: PushSubscriptionRecord): string[] {
  const preferred = record.apns_environment === 'sandbox' || record.apns_environment === 'production'
    ? record.apns_environment
    : APNS_PRIMARY_ENVIRONMENT;
  const fallback = preferred === 'production' ? 'sandbox' : 'production';
  const environments = [preferred];
  if (APNS_ALLOW_ENV_FALLBACK) environments.push(fallback);
  return [...new Set(environments)];
}

async function sendApnsSubscriptions(
  base44: Base44Client,
  subscriptions: PushSubscriptionRecord[],
  payload: Record<string, string>,
) {
  let jwt = '';
  try {
    jwt = await createApnsJwt();
  } catch (error) {
    console.warn(`[sendCustomerPushNotification] APNs JWT unavailable: ${errorMessage(error)}`);
    return { sent: 0, failed: 0, revoked: 0, skipped_reason: 'apns_credentials_missing' };
  }

  let sent = 0;
  let failed = 0;
  let revoked = 0;

  for (const record of subscriptions) {
    const token = normalizeSingleLine(record.apns_token).replace(/[^a-fA-F0-9]/g, '').toLowerCase();
    if (!token) continue;

    let delivered = false;
    let lastStatus = 0;
    let lastReason = '';

    for (const environment of apnsEnvironments(record)) {
      const host = environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
      let response: Response;
      try {
        response = await fetch(`https://${host}/3/device/${token}`, {
          method: 'POST',
          headers: {
            authorization: `bearer ${jwt}`,
            'apns-topic': normalizeSingleLine(record.app_bundle_id) || APNS_BUNDLE_ID,
            'apns-push-type': 'alert',
            'apns-priority': '10',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            aps: {
              alert: {
                title: payload.title,
                body: payload.body,
              },
              sound: 'default',
            },
            url: payload.url,
            tag: payload.tag,
            notification_id: payload.notification_id,
            notification_subtype: payload.notification_subtype,
            type: payload.type,
          }),
        });
      } catch (error) {
        lastReason = errorMessage(error);
        console.warn(`[sendCustomerPushNotification] APNs request failed: ${lastReason}`);
        continue;
      }

      if (response.ok) {
        delivered = true;
        await updatePushSubscriptionRecord(base44, record, {
          last_seen_at: new Date().toISOString(),
          apns_environment: environment,
        });
        break;
      }

      lastStatus = response.status;
      const errorBody = await response.json().catch(() => ({}));
      lastReason = normalizeSingleLine(errorBody.reason || response.statusText);

      if (lastStatus === 400 && ['BadDeviceToken', 'DeviceTokenNotForTopic'].includes(lastReason)) {
        continue;
      }
      break;
    }

    if (delivered) {
      sent += 1;
      continue;
    }

    failed += 1;
    if (lastStatus === 410 || lastReason === 'Unregistered') {
      revoked += 1;
      await updatePushSubscriptionRecord(base44, record, {
        enabled: false,
        revoked_at: new Date().toISOString(),
      });
    }
    console.warn(`[sendCustomerPushNotification] APNs push failed for a subscription: ${lastStatus || 'unknown'} ${lastReason || 'unknown'}`);
  }

  return { sent, failed, revoked, skipped_reason: null };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const body = await readJsonBody(req);
    if (!body) {
      return Response.json({ error: 'malformed_json' }, { status: 400 });
    }
    let customerEmail = '';
    try {
      customerEmail = normalizeEmail(body.customer_email);
    } catch {
      return Response.json({ error: 'Missing required field: customer_email' }, { status: 400 });
    }
    const title = normalizeSingleLine(body.title);
    const message = normalizeSingleLine(body.message);
    const notificationSubtype = normalizeSingleLine(body.notification_subtype || 'general');
    const type = normalizeSingleLine(body.type || 'general');
    const source = normalizeSingleLine(body.source);
    const notificationId = normalizeSingleLine(body.notification_id);
    const idempotencyKey = normalizeSingleLine(body.idempotency_key || notificationId || `${notificationSubtype}:${Date.now()}`);
    const deepLink = normalizeSingleLine(body.deep_link || '/notifications') || '/notifications';

    if (!notificationId || !title || !message) {
      return Response.json({ error: 'Missing required fields: notification_id, title, message' }, { status: 400 });
    }

    const allowed = pushSubtypeEnabled(notificationSubtype, type, source);
    if (!allowed.enabled) {
      return Response.json({
        success: true,
        push_attempted: false,
        push_sent: false,
        push_skipped_reason: allowed.reason,
        token_count: 0,
      });
    }

    const verifiedNotification = await verifyNotificationRecord(base44, notificationId, customerEmail, title, message);
    if (!verifiedNotification) {
      return Response.json({
        success: true,
        push_attempted: false,
        push_sent: false,
        push_skipped_reason: 'notification_record_unverified',
        token_count: 0,
      });
    }

    const identityEmails = await resolveIdentityEmails(base44, customerEmail);
    const subscriptions = await findPushSubscriptions(base44, identityEmails);
    if (subscriptions.length === 0) {
      return Response.json({
        success: true,
        push_attempted: false,
        push_sent: false,
        push_skipped_reason: 'no_active_push_subscription',
        token_count: 0,
      });
    }

    const payload = {
      title,
      body: message,
      url: deepLink,
      tag: idempotencyKey,
      type,
      notification_subtype: notificationSubtype,
      notification_id: notificationId,
    };
    const webPayload = JSON.stringify(payload);
    const apnsSubscriptions = subscriptions.filter((record) => record.token_type === 'apns');
    const fcmSubscriptions = subscriptions.filter((record) => record.token_type === 'fcm');
    const browserSubscriptions = subscriptions.filter((record) => record.token_type !== 'apns' && record.token_type !== 'fcm');
    const skippedReasons = [];
    let sent = 0;
    let failed = 0;
    let revoked = 0;
    let attempted = false;

    if (browserSubscriptions.length > 0) {
      if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
        attempted = true;
        const result = await sendWebPushSubscriptions(base44, browserSubscriptions, webPayload);
        sent += result.sent;
        failed += result.failed;
        revoked += result.revoked;
      } else {
        skippedReasons.push(VAPID_PRIVATE_KEY ? 'vapid_public_key_missing' : 'vapid_private_key_missing');
      }
    }

    if (apnsSubscriptions.length > 0) {
      const result = await sendApnsSubscriptions(base44, apnsSubscriptions, payload);
      if (result.skipped_reason) {
        skippedReasons.push(result.skipped_reason);
      } else {
        attempted = true;
      }
      sent += result.sent;
      failed += result.failed;
      revoked += result.revoked;
    }

    if (fcmSubscriptions.length > 0) {
      const result = await sendFcmSubscriptions(base44, fcmSubscriptions, payload);
      if (result.skipped_reason) {
        skippedReasons.push(result.skipped_reason);
      } else {
        attempted = true;
      }
      sent += result.sent;
      failed += result.failed;
      revoked += result.revoked;
    }

    return Response.json({
      success: true,
      push_attempted: attempted,
      push_sent: sent > 0,
      push_skipped_reason: sent > 0 ? null : attempted ? 'push_delivery_failed' : skippedReasons.join('+') || 'push_provider_credentials_missing',
      token_count: subscriptions.length,
      sent_count: sent,
      failed_count: failed,
      revoked_count: revoked,
    });
  } catch (error) {
    console.error(`[sendCustomerPushNotification] Error: ${errorMessage(error)}`);
    return Response.json({
      error: 'Unable to send customer push notification',
      push_attempted: false,
      push_sent: false,
      push_skipped_reason: 'customer_push_error',
    }, { status: 500 });
  }
});
