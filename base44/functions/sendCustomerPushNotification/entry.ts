import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
// @deno-types="npm:@types/web-push@3.6.4"
import webpush from 'npm:web-push@3.6.7';
import { buildDeliveryRouteSnapshots } from './deliverySnapshot.ts';

const VAPID_PUBLIC_KEY = Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY') || '';
const VAPID_PRIVATE_KEY = Deno.env.get('WEB_PUSH_VAPID_PRIVATE_KEY');
const VAPID_CONTACT = Deno.env.get('WEB_PUSH_CONTACT') || 'mailto:operations@nuvirajuice.com';
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
const TRANSACTIONAL_TEST_RECIPIENT = 'info@nuvirajuice.com';
const DELIVERY_LIVE_ACTIVITY_OPERATION = 'refresh_delivery_live_activity';
const DELIVERY_LIVE_ACTIVITY_ATTRIBUTES_TYPE = 'NuViraDeliveryAttributes';

const ELEVATED_TRANSACTIONAL_PUSH_SUBTYPES = new Set([
  'scheduled_for_juicing',
  'in_production',
  'ready_for_pickup',
  'out_for_delivery',
  'arriving_soon',
  'delivered',
  'schedule_changed',
  'order_delayed',
  'order_cancelled',
  'order_refunded',
  'order_payment_failed',
]);

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

function transactionalMode(): 'disabled' | 'test' | 'production' {
  const mode = String(Deno.env.get('TRANSACTIONAL_COMMUNICATIONS_MODE') || '').trim().toLowerCase();
  return mode === 'test' || mode === 'production' ? mode : 'disabled';
}

function elevatedTransactionalPushEnabled(): boolean {
  return envFlag('ENABLE_ELEVATED_TRANSACTIONAL_COMMUNICATIONS')
    && Deno.env.get('TRANSACTIONAL_COMMUNICATIONS_KILL_SWITCH') === 'false'
    && transactionalMode() !== 'disabled'
    && envFlag('ENABLE_ELEVATED_TRANSACTIONAL_PUSH')
    && envFlag('ENABLE_CUSTOMER_PUSH_NOTIFICATIONS');
}

function transactionalInternalTokenMatches(value: unknown): boolean {
  const expected = String(Deno.env.get('TRANSACTIONAL_COMMUNICATIONS_INTERNAL_TOKEN') || '');
  const supplied = String(value || '');
  if (!expected || expected.length !== supplied.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return mismatch === 0;
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
      record.message_type === 'push_subscription_fallback'
      || record.metadata?.purpose === 'push_subscription_fallback'
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

function pushSubtypeEnabled(
  notificationSubtype: string,
  type: string,
  source: string,
  customerEmail: string,
  _idempotencyKey: string,
): { enabled: boolean; reason: string | null } {
  if (source === 'elevated_transactional') {
    if (!elevatedTransactionalPushEnabled()) {
      return { enabled: false, reason: 'elevated_transactional_push_disabled' };
    }
    if (transactionalMode() === 'test' && customerEmail !== TRANSACTIONAL_TEST_RECIPIENT) {
      return { enabled: false, reason: 'transactional_test_recipient_only' };
    }
    return ELEVATED_TRANSACTIONAL_PUSH_SUBTYPES.has(notificationSubtype)
      ? { enabled: true, reason: null }
      : { enabled: false, reason: 'elevated_transactional_push_subtype_not_allowed' };
  }

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

  if (notificationSubtype === 'admin_new_member') {
    if (!envFlag('ENABLE_ADMIN_PUSH_NOTIFICATIONS')) {
      return { enabled: false, reason: 'admin_push_disabled' };
    }
    return envFlag('ENABLE_ADMIN_NEW_MEMBER_PUSH')
      ? { enabled: true, reason: null }
      : { enabled: false, reason: 'admin_new_member_push_disabled' };
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
  options: { dataOnly?: boolean } = {},
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
        message: options.dataOnly
          ? {
              token: fcmToken,
              data: payload,
              android: { priority: 'high' },
            }
          : {
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

function deliveryLiveActivitiesEnabled(): boolean {
  return envFlag('ENABLE_DELIVERY_LIVE_ACTIVITIES')
    && Deno.env.get('DELIVERY_LIVE_ACTIVITIES_KILL_SWITCH') === 'false';
}

function normalizeHexToken(value: unknown): string {
  const token = normalizeSingleLine(value).replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  return token.length >= 32 && token.length <= 4096 && token.length % 2 === 0 ? token : '';
}

function liveActivityContentState(snapshot: Record<string, any>) {
  return {
    status: normalizeSingleLine(snapshot.status || 'out_for_delivery'),
    statusLabel: normalizeSingleLine(snapshot.status_label || 'Out for Delivery'),
    etaStartEpoch: Number(snapshot.eta_start_epoch || 0),
    etaEndEpoch: Number(snapshot.eta_end_epoch || 0),
    stopsAhead: Number(snapshot.stops_ahead || 0),
    stopsDelivered: Number(snapshot.stops_delivered || 0),
    stopsTotal: Number(snapshot.stops_total || 0),
    progressPercent: Number(snapshot.progress_percent || 0),
    updatedAtEpoch: Number(snapshot.sequence || Math.floor(Date.now() / 1000)),
    isDelayed: snapshot.status === 'delayed',
    message: normalizeSingleLine(snapshot.message || ''),
  };
}

function liveActivityAttributes(snapshot: Record<string, any>) {
  return {
    orderId: normalizeSingleLine(snapshot.order_id),
    orderNumber: normalizeSingleLine(snapshot.order_number),
    deepLink: normalizeSingleLine(snapshot.deep_link || '/account/orders'),
  };
}

function liveActivityDataPayload(snapshot: Record<string, any>, event: string): Record<string, string> {
  return {
    nuvira_delivery_live_activity: '1',
    schema_version: '1',
    event,
    order_id: normalizeSingleLine(snapshot.order_id),
    order_number: normalizeSingleLine(snapshot.order_number),
    deep_link: normalizeSingleLine(snapshot.deep_link || '/account/orders'),
    status: normalizeSingleLine(snapshot.status),
    status_label: normalizeSingleLine(snapshot.status_label),
    eta_start_epoch: String(Number(snapshot.eta_start_epoch || 0)),
    eta_end_epoch: String(Number(snapshot.eta_end_epoch || 0)),
    stops_ahead: String(Number(snapshot.stops_ahead || 0)),
    stops_delivered: String(Number(snapshot.stops_delivered || 0)),
    stops_total: String(Number(snapshot.stops_total || 0)),
    progress_percent: String(Number(snapshot.progress_percent || 0)),
    updated_at_epoch: String(Number(snapshot.sequence || Math.floor(Date.now() / 1000))),
    stale_at_epoch: String(Number(snapshot.stale_at_epoch || 0)),
    message: normalizeSingleLine(snapshot.message),
  };
}

async function snapshotHash(snapshot: Record<string, any>): Promise<string> {
  const stablePayload = {
    order_id: snapshot.order_id,
    activity_state: snapshot.activity_state,
    status: snapshot.status,
    status_label: snapshot.status_label,
    eta_start_epoch: snapshot.eta_start_epoch,
    eta_end_epoch: snapshot.eta_end_epoch,
    stops_ahead: snapshot.stops_ahead,
    stops_delivered: snapshot.stops_delivered,
    stops_total: snapshot.stops_total,
    progress_percent: snapshot.progress_percent,
  };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(stablePayload)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function findDeliveryActivityRows(base44: Base44Client, identityEmails: string[]) {
  const rows: Record<string, any>[] = [];
  const seen = new Set<string>();
  for (const email of identityEmails) {
    const matches = await base44.asServiceRole.entities.DeliveryLiveActivity.filter({ customer_email: email }, '-updated_date', 100);
    for (const row of matches) {
      if (!row.id || seen.has(row.id) || row.enabled === false || row.state === 'revoked') continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

async function updateDeliveryActivityRow(base44: Base44Client, row: Record<string, any>, updates: Record<string, any>) {
  if (!row?.id) return null;
  return base44.asServiceRole.entities.DeliveryLiveActivity.update(row.id, updates);
}

async function upsertPendingActivityStart(
  base44: Base44Client,
  installation: Record<string, any>,
  order: Record<string, any>,
  snapshot: Record<string, any>,
  hash: string,
) {
  const filters = {
    customer_email: normalizeEmail(order.customer_email),
    scope: 'activity',
    platform: 'ios',
    installation_id: installation.installation_id,
    order_id: order.id,
  };
  const rows = await base44.asServiceRole.entities.DeliveryLiveActivity.filter(filters, '-updated_date', 5);
  const current = rows.find((row: Record<string, any>) => row.state !== 'revoked') || rows[0];
  const payload = {
    ...filters,
    order_number: normalizeSingleLine(order.order_number),
    activity_id: current?.activity_id || `push-start:${order.id}`,
    activity_push_token: current?.activity_push_token || null,
    apns_environment: installation.apns_environment || 'unknown',
    app_bundle_id: installation.app_bundle_id || APNS_BUNDLE_ID,
    app_version: installation.app_version || null,
    build_number: installation.build_number || null,
    state: 'active',
    enabled: true,
    last_sequence: Number(snapshot.sequence || 0),
    last_snapshot_hash: hash,
    started_at: current?.started_at || new Date().toISOString(),
    last_updated_at: new Date().toISOString(),
    ended_at: null,
    revoked_at: null,
  };
  return current
    ? base44.asServiceRole.entities.DeliveryLiveActivity.update(current.id, payload)
    : base44.asServiceRole.entities.DeliveryLiveActivity.create(payload);
}

async function sendApnsLiveActivity(
  base44: Base44Client,
  row: Record<string, any>,
  token: string,
  snapshot: Record<string, any>,
  event: 'start' | 'update' | 'end',
) {
  let jwt = '';
  try {
    jwt = await createApnsJwt();
  } catch {
    return { sent: false, revoked: false, reason: 'apns_credentials_missing' };
  }

  const contentState = liveActivityContentState(snapshot);
  const timestamp = Number(snapshot.sequence || Math.floor(Date.now() / 1000));
  const aps: Record<string, any> = {
    timestamp,
    event,
    'content-state': contentState,
  };
  if (snapshot.stale_at_epoch) aps['stale-date'] = Number(snapshot.stale_at_epoch);
  if (event === 'start') {
    aps['attributes-type'] = DELIVERY_LIVE_ACTIVITY_ATTRIBUTES_TYPE;
    aps.attributes = liveActivityAttributes(snapshot);
    aps.alert = {
      title: 'Your NuVira delivery is moving',
      body: normalizeSingleLine(snapshot.status_label || 'Track your delivery live.'),
    };
    aps['input-push-token'] = 1;
  }
  if (event === 'end') aps['dismissal-date'] = timestamp + 60 * 60;

  let lastStatus = 0;
  let lastReason = '';
  for (const environment of apnsEnvironments(row)) {
    const host = environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
    let response: Response;
    try {
      response = await fetch(`https://${host}/3/device/${token}`, {
        method: 'POST',
        headers: {
          authorization: `bearer ${jwt}`,
          'apns-topic': `${normalizeSingleLine(row.app_bundle_id) || APNS_BUNDLE_ID}.push-type.liveactivity`,
          'apns-push-type': 'liveactivity',
          'apns-priority': event === 'start' ? '10' : '5',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ aps }),
      });
    } catch {
      lastReason = 'apns_request_failed';
      continue;
    }
    if (response.ok) return { sent: true, revoked: false, environment, reason: null };
    lastStatus = response.status;
    const errorBody = await response.json().catch(() => ({}));
    lastReason = normalizeSingleLine(errorBody.reason || response.statusText);
    if (lastStatus === 400 && ['BadDeviceToken', 'DeviceTokenNotForTopic'].includes(lastReason)) continue;
    break;
  }

  const revoked = lastStatus === 410 || lastReason === 'Unregistered';
  if (revoked) {
    await updateDeliveryActivityRow(base44, row, {
      state: 'revoked',
      enabled: false,
      revoked_at: new Date().toISOString(),
      last_updated_at: new Date().toISOString(),
    });
  }
  console.warn(`[sendCustomerPushNotification] Live Activity APNs failed status=${lastStatus || 'unknown'} reason=${lastReason || 'unknown'}`);
  return { sent: false, revoked, reason: lastReason || 'apns_delivery_failed' };
}

async function sendDeliveryLiveActivitySnapshot(
  base44: Base44Client,
  order: Record<string, any>,
  snapshot: Record<string, any>,
) {
  const customerEmail = normalizeEmail(order.customer_email);
  const identityEmails = await resolveIdentityEmails(base44, customerEmail);
  const registrations = await findDeliveryActivityRows(base44, identityEmails).catch((error) => {
    if (isMissingSchemaError(error)) return [];
    throw error;
  });
  if (registrations.length === 0) {
    return { attempted: false, sent: 0, failed: 0, reason: 'no_live_activity_registration' };
  }

  const hash = await snapshotHash(snapshot);
  const isEnd = snapshot.activity_state === 'delivered' || snapshot.activity_state === 'inactive';
  const iosOrderActivityRows = registrations.filter((row) => (
    row.platform === 'ios'
    && row.scope === 'activity'
    && row.order_id === order.id
    && normalizeHexToken(row.activity_push_token)
  ));
  const activeIosRows = iosOrderActivityRows.filter((row) => row.state === 'active');
  const iosInstallations = registrations.filter((row) => (
    row.platform === 'ios'
    && row.scope === 'installation'
    && row.state === 'registered'
    && normalizeHexToken(row.push_to_start_token)
  ));
  const androidCapability = registrations.some((row) => (
    row.platform === 'android' && row.scope === 'installation' && row.state === 'registered'
  ));

  let attempted = false;
  let sent = 0;
  let failed = 0;

  if (isEnd) {
    for (const row of iosOrderActivityRows) {
      if (row.last_snapshot_hash === hash && row.state === 'ended') continue;
      attempted = true;
      const result = await sendApnsLiveActivity(base44, row, normalizeHexToken(row.activity_push_token), snapshot, 'end');
      if (result.sent) {
        sent += 1;
        await updateDeliveryActivityRow(base44, row, {
          state: 'ended',
          enabled: false,
          last_sequence: Number(snapshot.sequence || 0),
          last_snapshot_hash: hash,
          last_updated_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
        });
      } else failed += 1;
    }
  } else if (activeIosRows.length > 0) {
    for (const row of activeIosRows) {
      if (row.last_snapshot_hash === hash) continue;
      attempted = true;
      const result = await sendApnsLiveActivity(base44, row, normalizeHexToken(row.activity_push_token), snapshot, 'update');
      if (result.sent) {
        sent += 1;
        await updateDeliveryActivityRow(base44, row, {
          last_sequence: Number(snapshot.sequence || 0),
          last_snapshot_hash: hash,
          last_updated_at: new Date().toISOString(),
          apns_environment: result.environment || row.apns_environment,
        });
      } else failed += 1;
    }
  } else {
    for (const installation of iosInstallations) {
      const existing = registrations.find((row) => (
        row.platform === 'ios'
        && row.scope === 'activity'
        && row.installation_id === installation.installation_id
        && row.order_id === order.id
        && row.state === 'active'
        && row.last_snapshot_hash === hash
      ));
      if (existing) continue;
      attempted = true;
      const result = await sendApnsLiveActivity(base44, installation, normalizeHexToken(installation.push_to_start_token), snapshot, 'start');
      if (result.sent) {
        sent += 1;
        await upsertPendingActivityStart(base44, installation, order, snapshot, hash);
      } else failed += 1;
    }
  }

  if (androidCapability) {
    const subscriptions = await findPushSubscriptions(base44, identityEmails);
    const androidSubscriptions = subscriptions.filter((row) => (
      row.token_type === 'fcm'
      && (
        normalizeSingleLine(row.device_platform).toLowerCase() === 'android'
        || normalizeSingleLine(row.app_bundle_id) === 'com.nuvirajuice.app'
      )
    ));
    if (androidSubscriptions.length > 0) {
      attempted = true;
      const result = await sendFcmSubscriptions(
        base44,
        androidSubscriptions,
        liveActivityDataPayload(snapshot, isEnd ? 'end' : 'update'),
        { dataOnly: true },
      );
      sent += result.sent;
      failed += result.failed;
    }
  }

  return {
    attempted,
    sent,
    failed,
    reason: sent > 0 ? null : attempted ? 'live_activity_delivery_failed' : 'no_compatible_live_activity_target',
  };
}

async function refreshDeliveryLiveActivities(base44: Base44Client, body: Record<string, any>) {
  if (!deliveryLiveActivitiesEnabled()) {
    return Response.json({
      success: true,
      live_activity_attempted: false,
      live_activity_sent: false,
      reason: 'delivery_live_activities_disabled',
    });
  }

  const orderId = normalizeSingleLine(body.order_id);
  if (!orderId || orderId.length > 160 || !/^[A-Za-z0-9._:@/-]+$/.test(orderId)) {
    return Response.json({ error: 'order_id_required' }, { status: 400 });
  }

  const orderRows = await base44.asServiceRole.entities.Order.filter({ id: orderId }, undefined, 1);
  const preflightOrder = orderRows[0] || null;
  if (!preflightOrder) return Response.json({ error: 'order_not_found' }, { status: 404 });
  if (preflightOrder.is_test_order === true) {
    return Response.json({ success: true, live_activity_attempted: false, live_activity_sent: false, reason: 'test_order_suppressed' });
  }

  let hasLiveActivityRegistration = false;
  try {
    const registrations = await base44.asServiceRole.entities.DeliveryLiveActivity.filter({ enabled: true }, '-updated_date', 1);
    hasLiveActivityRegistration = registrations.length > 0;
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
  }
  if (!hasLiveActivityRegistration) {
    return Response.json({
      success: true,
      live_activity_attempted: false,
      live_activity_sent: false,
      reason: 'no_live_activity_registration',
    });
  }

  const route = await buildDeliveryRouteSnapshots({
    base44,
    anchorOrderId: orderId,
    googleMapsApiKey: Deno.env.get('GOOGLE_MAPS_API_KEY') || '',
  });
  if (!route.anchor_order || !route.anchor_snapshot) return Response.json({ error: 'order_not_found' }, { status: 404 });

  const refreshRoute = body.refresh_route === true;
  const snapshots = refreshRoute
    ? route.route_snapshots.filter((snapshot: Record<string, any>) => (
        snapshot.activity_state === 'en_route' || snapshot.order_id === orderId
      ))
    : [route.anchor_snapshot];
  const ordersById = new Map((route.route_orders || []).map((order: Record<string, any>) => [order.id, order]));
  ordersById.set(route.anchor_order.id, route.anchor_order);

  let attempted = false;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const snapshot of snapshots.slice(0, 30)) {
    const order = ordersById.get(snapshot.order_id);
    if (!order?.id || order.is_test_order === true) {
      skipped += 1;
      continue;
    }
    const result = await sendDeliveryLiveActivitySnapshot(base44, order, snapshot);
    attempted ||= result.attempted;
    sent += result.sent;
    failed += result.failed;
    if (!result.attempted) skipped += 1;
  }

  return Response.json({
    success: true,
    live_activity_attempted: attempted,
    live_activity_sent: sent > 0,
    sent_count: sent,
    failed_count: failed,
    skipped_count: skipped,
    route_snapshot_count: snapshots.length,
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (caller.role !== 'admin' && caller.role !== 'owner') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await readJsonBody(req);
    if (!body) {
      return Response.json({ error: 'malformed_json' }, { status: 400 });
    }
    if (normalizeSingleLine(body.operation) === DELIVERY_LIVE_ACTIVITY_OPERATION) {
      return refreshDeliveryLiveActivities(base44, body);
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
    const source = normalizeSingleLine(body.source || body.notification_origin || '');
    const notificationId = normalizeSingleLine(body.notification_id);
    const idempotencyKey = normalizeSingleLine(body.idempotency_key || body.delivery_key || notificationId || `${notificationSubtype}:${Date.now()}`);
    const deepLink = normalizeSingleLine(body.deep_link || '/notifications') || '/notifications';

    if (!notificationId || !title || !message) {
      return Response.json({ error: 'Missing required fields: notification_id, title, message' }, { status: 400 });
    }

    const transactionalProof = body.internal_token || body.transactional_proof;
    if (source === 'elevated_transactional' && !transactionalInternalTokenMatches(transactionalProof)) {
      return Response.json({
        error: 'invalid_transactional_internal_token',
        push_attempted: false,
        push_sent: false,
      }, { status: 403 });
    }

    const allowed = pushSubtypeEnabled(notificationSubtype, type, source, customerEmail, idempotencyKey);
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

        // iOS registrations retain the APNs token as fallback metadata. If FCM
        // credentials are unavailable, preserve delivery through the already
        // configured APNs provider without duplicating sends when FCM succeeds.
        const apnsFallbackSubscriptions = fcmSubscriptions
          .filter((record) => normalizeSingleLine(record.apns_token))
          .map((record) => ({ ...record, token_type: 'apns' }));
        if (apnsFallbackSubscriptions.length > 0) {
          const fallbackResult = await sendApnsSubscriptions(base44, apnsFallbackSubscriptions, payload);
          if (fallbackResult.skipped_reason) {
            skippedReasons.push(fallbackResult.skipped_reason);
          } else {
            attempted = true;
          }
          sent += fallbackResult.sent;
          failed += fallbackResult.failed;
          revoked += fallbackResult.revoked;
        }
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
