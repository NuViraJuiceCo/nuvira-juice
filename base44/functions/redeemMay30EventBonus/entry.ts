import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
// @deno-types="npm:@types/web-push@3.6.4"
import webpush from 'npm:web-push@3.6.7';

const DEFAULT_EVENT_KEY = 'may30_event_visit';
const DEFAULT_BONUS_POINTS = 250;
const NOTIFICATION_TITLE = 'Welcome To NuVira';
const NOTIFICATION_BODY = 'Your 250 point event visit bonus has been added.';
const VAPID_PUBLIC_KEY = Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY')
  || 'BHmr7cCgm_eL3ckBL91ZKnvCqXvLax8pahXxpFCY8qwFXi0alWve4tDDJaaSDTuLwA-4VSEWBHMMlE_BixdHWaM';
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
type Base44User = {
  id?: string;
  user_id?: string;
  uid?: string;
  email?: string;
  role?: string;
};
type PointsRecord = Record<string, any> | null;
type CommandLogRecord = Record<string, any> | null;
type EventClaimRecord = Record<string, any> | null;
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

function isMissingSchemaError(error: unknown): boolean {
  const message = errorMessage(error);
  return message.includes('Entity schema') && message.includes('not found');
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
    console.warn('[redeemMay30EventBonus] PushSubscription schema unavailable; checking fallback storage');
  }

  try {
    rows.push(...await findFallbackPushSubscriptions(base44, [email]));
  } catch (error) {
    if (rows.length === 0) throw error;
    console.warn(`[redeemMay30EventBonus] Fallback subscription lookup skipped: ${errorMessage(error)}`);
  }

  return rows;
}

function directNativeSubscriptionFromBody(body: Record<string, any>, customerEmail: string): PushSubscriptionRecord | null {
  const target = body?.event_push_target && typeof body.event_push_target === 'object'
    ? body.event_push_target
    : body;
  const apnsToken = normalizeSingleLine(target?.apns_token).replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  const rawFcmToken = normalizeSingleLine(target?.fcm_token);
  const fcmToken = rawFcmToken.length <= 4096 ? rawFcmToken : '';

  if ((apnsToken.length < 32 || apnsToken.length > 512) && !fcmToken) return null;

  const tokenType = apnsToken.length >= 32 && apnsToken.length <= 512 ? 'apns' : 'fcm';
  const apnsEnvironment = target?.apns_environment === 'sandbox' || target?.apns_environment === 'production'
    ? target.apns_environment
    : 'unknown';

  return {
    id: `request_direct:${tokenType}`,
    customer_email: customerEmail,
    token_type: tokenType,
    fcm_token: tokenType === 'fcm' ? fcmToken : null,
    apns_token: tokenType === 'apns' ? apnsToken : null,
    apns_environment: tokenType === 'apns' ? apnsEnvironment : null,
    app_bundle_id: normalizeSingleLine(target?.app_bundle_id).slice(0, 160) || APNS_BUNDLE_ID,
    enabled: true,
    permission: target?.permission === 'denied' ? 'denied' : target?.permission === 'default' ? 'default' : 'granted',
    device_platform: normalizeSingleLine(target?.device_platform).slice(0, 40),
    platform: normalizeSingleLine(target?.platform).slice(0, 120),
    app_shell: normalizeSingleLine(target?.app_shell).slice(0, 80),
    _storage: 'request_direct',
  };
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

function envFlag(name: string): boolean {
  return Deno.env.get(name) === 'true';
}

function envText(name: string, fallback = ''): string {
  return (Deno.env.get(name) || fallback).toString().trim();
}

function envNumber(name: string, fallback: number): number {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
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

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = normalizeSingleLine(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function normalizeSafeId(value: unknown, fieldName: string): string {
  const text = normalizeSingleLine(value);
  if (!text || text.length > 180 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    throw new Error(`${fieldName} is unavailable`);
  }
  return text;
}

function safeError(message: string, code = 'event_bonus_error') {
  return {
    success: false,
    skipped: true,
    already_claimed: false,
    points_awarded: 0,
    event_key: envText('MAY30_EVENT_KEY', DEFAULT_EVENT_KEY) || DEFAULT_EVENT_KEY,
    notification_created: false,
    push_attempted: false,
    push_sent: false,
    push_skipped_reason: 'not_attempted',
    error_code: code,
    message,
  };
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
    console.warn(`[redeemMay30EventBonus] Firebase service account parse failed: ${errorMessage(error)}`);
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

async function resolveIdentityEmails(base44: Base44Client, authEmail: string): Promise<string[]> {
  const identities = new Set([authEmail]);

  try {
    const fwdProfiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: authEmail });
    if (fwdProfiles[0]?.customer_email) identities.add(normalizeEmail(fwdProfiles[0].customer_email));
    if (fwdProfiles[0]?.contact_email) identities.add(normalizeEmail(fwdProfiles[0].contact_email));

    const revProfiles = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: authEmail });
    for (const profile of revProfiles) {
      if (profile.customer_email) identities.add(normalizeEmail(profile.customer_email));
      if (profile.contact_email) identities.add(normalizeEmail(profile.contact_email));
    }
  } catch (error) {
    console.warn(`[redeemMay30EventBonus] Identity resolution partial failure: ${errorMessage(error)}`);
  }

  return [...identities];
}

function primaryCustomerEmail(userEmail: string, identities: string[]): string {
  const nonRelay = identities.find((email: string) => !email.includes('privaterelay.appleid.com'));
  return nonRelay || userEmail;
}

async function findPointsRecords(base44: Base44Client, identityEmails: string[]): Promise<Record<string, any>[]> {
  const results: Record<string, any>[] = [];
  const seenIds = new Set<string>();

  for (const email of identityEmails) {
    const records = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: email }, '-created_date', 20);
    for (const record of records) {
      const key = normalizeSingleLine(record?.id || `${record?.customer_email}:${record?.created_date || results.length}`);
      if (seenIds.has(key)) continue;
      seenIds.add(key);
      results.push(record);
    }
  }

  return results;
}

function hasAwardHistory(pointsRecords: Record<string, any>[], idempotencyKeys: string[], eventKey: string): boolean {
  const keySet = new Set(idempotencyKeys);
  return pointsRecords.some((pointsRecord) =>
    (pointsRecord?.points_history || []).some((entry: Record<string, any>) => {
      const entryIdempotencyKey = normalizeSingleLine(entry?.idempotency_key);
      const entryEventKey = normalizeSingleLine(entry?.event_key);
      const description = normalizeSingleLine(entry?.description).toLowerCase();
      return (entryIdempotencyKey && keySet.has(entryIdempotencyKey)) ||
        entryEventKey === eventKey ||
        description.includes(eventKey.toLowerCase()) ||
        idempotencyKeys.some((key) => description.includes(key.toLowerCase()));
    })
  );
}

function selectPointsRecord(
  pointsRecords: Record<string, any>[],
  customerEmail: string,
  identityEmails: string[],
): PointsRecord {
  if (pointsRecords.length === 0) return null;
  return pointsRecords.find((record) => normalizeSingleLine(record?.customer_email).toLowerCase() === customerEmail) ||
    identityEmails.map((email) => pointsRecords.find((record) => normalizeSingleLine(record?.customer_email).toLowerCase() === email)).find(Boolean) ||
    pointsRecords[0];
}

async function findExistingCommandLog(base44: Base44Client, idempotencyKeys: string[]): Promise<CommandLogRecord> {
  try {
    for (const idempotencyKey of idempotencyKeys) {
      const logs = await base44.asServiceRole.entities.CommandLog.filter({ idempotency_key: idempotencyKey }, '-created_date', 5);
      const existing = logs.find((log: Record<string, any>) =>
        log.command_type === 'may30_event_bonus' &&
        ['success', 'skipped', 'pending', 'running'].includes(log.status)
      );
      if (existing) return existing;
    }
    return null;
  } catch (error) {
    if (isMissingSchemaError(error)) {
      console.warn('[redeemMay30EventBonus] CommandLog schema unavailable; using UserPoints history idempotency');
      return null;
    }
    throw error;
  }
}

async function findExistingNotification(base44: Base44Client, identityEmails: string[], idempotencyKeys: string[]) {
  for (const idempotencyKey of idempotencyKeys) {
    const existing = await base44.asServiceRole.entities.Notification.filter({ idempotency_key: idempotencyKey }, '-created_date', 1);
    if (existing[0]) return existing[0];
  }

  for (const email of identityEmails) {
    const rows = await base44.asServiceRole.entities.Notification.filter({ customer_email: email }, '-created_date', 20);
    const existing = rows.find((row: Record<string, any>) =>
      row.title === NOTIFICATION_TITLE &&
      row.message === NOTIFICATION_BODY &&
      row.notification_subtype === 'loyalty_credit'
    );
    if (existing) return existing;
  }

  return null;
}

async function findExistingEventClaim(
  base44: Base44Client,
  eventKey: string,
  identityEmails: string[],
  userId: string,
  idempotencyKeys: string[],
): Promise<EventClaimRecord> {
  try {
    for (const idempotencyKey of idempotencyKeys) {
      const byKey = await base44.asServiceRole.entities.EventBonusRedemption.filter({ idempotency_key: idempotencyKey }, '-created_date', 1);
      if (byKey[0]) return byKey[0];
    }

    const byUser = await base44.asServiceRole.entities.EventBonusRedemption.filter({ event_key: eventKey, user_id: userId }, '-created_date', 1);
    if (byUser[0]) return byUser[0];

    for (const email of identityEmails) {
      const byEmail = await base44.asServiceRole.entities.EventBonusRedemption.filter({ event_key: eventKey, customer_email: email }, '-created_date', 1);
      if (byEmail[0]) return byEmail[0];
    }

    return null;
  } catch (error) {
    if (isMissingSchemaError(error)) {
      console.warn('[redeemMay30EventBonus] EventBonusRedemption schema unavailable; using CommandLog/UserPoints idempotency');
      return null;
    }
    throw error;
  }
}

async function createCommandLog(base44: Base44Client, idempotencyKey: string, user: Base44User, eventKey: string) {
  try {
    return await base44.asServiceRole.entities.CommandLog.create({
      command_id: idempotencyKey,
      command_type: 'may30_event_bonus',
      command_source: 'customer_app_event_page',
      status: 'running',
      target_entity: 'User',
      target_id: normalizeSafeId(user.id || user.user_id || user.uid, 'user_id'),
      target_display_id: eventKey,
      actor_email: normalizeEmail(user.email),
      actor_role: normalizeSingleLine(user.role || 'user'),
      actor_type: 'customer',
      payload: {
        event_key: eventKey,
        points_requested: envNumber('MAY30_EVENT_BONUS_POINTS', DEFAULT_BONUS_POINTS),
      },
      idempotency_key: idempotencyKey,
      request_id: idempotencyKey,
      submitted_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      function_name: 'redeemMay30EventBonus',
    });
  } catch (error) {
    if (isMissingSchemaError(error)) {
      console.warn('[redeemMay30EventBonus] CommandLog schema unavailable; continuing without command audit log');
      return null;
    }
    throw error;
  }
}

async function createEventClaim(
  base44: Base44Client,
  {
    eventKey,
    idempotencyKey,
    userId,
    userEmail,
    customerEmail,
    bonusPoints,
  }: {
    eventKey: string;
    idempotencyKey: string;
    userId: string;
    userEmail: string;
    customerEmail: string;
    bonusPoints: number;
  },
): Promise<EventClaimRecord> {
  try {
    return await base44.asServiceRole.entities.EventBonusRedemption.create({
      event_key: eventKey,
      user_id: userId,
      auth_email: userEmail,
      customer_email: customerEmail,
      idempotency_key: idempotencyKey,
      points_awarded: bonusPoints,
      status: 'awarded',
      claimed_at: new Date().toISOString(),
    });
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return null;
    }
    throw error;
  }
}

async function updateCommandLog(base44: Base44Client, commandLog: CommandLogRecord, patch: Record<string, any>) {
  if (!commandLog?.id) return;
  try {
    await base44.asServiceRole.entities.CommandLog.update(commandLog.id, {
      ...patch,
      completed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn(`[redeemMay30EventBonus] CommandLog update failed: ${errorMessage(error)}`);
  }
}

async function createNotificationOnce(base44: Base44Client, customerEmail: string, identityEmails: string[], idempotencyKeys: string[]) {
  const existing = await findExistingNotification(base44, identityEmails, idempotencyKeys);
  if (existing) {
    return { created: false, skipped_reason: 'duplicate_idempotency_key' };
  }

  const idempotencyKey = idempotencyKeys[0];
  await base44.asServiceRole.entities.Notification.create({
    customer_email: customerEmail,
    title: NOTIFICATION_TITLE,
    message: NOTIFICATION_BODY,
    type: 'general',
    notification_subtype: 'loyalty_credit',
    is_read: false,
    icon: null,
    deep_link: '/rewards',
    idempotency_key: idempotencyKey,
  });

  return { created: true, skipped_reason: null };
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
      console.warn(`[redeemMay30EventBonus] Web push failed for a subscription: ${statusCode || 'unknown'}`);
    }
  }

  return { sent, failed, revoked };
}

async function sendFcmSubscriptions(
  base44: Base44Client,
  subscriptions: PushSubscriptionRecord[],
  idempotencyKey: string,
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
    console.warn(`[redeemMay30EventBonus] Firebase access token unavailable: ${errorMessage(error)}`);
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
            title: NOTIFICATION_TITLE,
            body: NOTIFICATION_BODY,
          },
          data: {
            url: '/rewards',
            tag: idempotencyKey,
            type: 'general',
            notification_subtype: 'loyalty_credit',
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
    console.warn(`[redeemMay30EventBonus] FCM push failed for a subscription: ${response.status} ${errorCode || 'unknown'}`);
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

async function sendApnsSubscriptions(
  base44: Base44Client,
  subscriptions: PushSubscriptionRecord[],
  idempotencyKey: string,
) {
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_BUNDLE_ID || !readApnsPrivateKey()) {
    return { sent: 0, failed: 0, revoked: 0, skipped_reason: 'apns_credentials_missing' };
  }

  let jwt = '';
  try {
    jwt = await createApnsJwt();
  } catch (error) {
    console.warn(`[redeemMay30EventBonus] APNs JWT unavailable: ${errorMessage(error)}`);
    return { sent: 0, failed: 0, revoked: 0, skipped_reason: 'apns_jwt_unavailable' };
  }

  let sent = 0;
  let failed = 0;
  let revoked = 0;

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
            'apns-collapse-id': idempotencyKey.slice(0, 64),
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            aps: {
              alert: {
                title: NOTIFICATION_TITLE,
                body: NOTIFICATION_BODY,
              },
              sound: 'default',
            },
            url: '/rewards',
            tag: idempotencyKey,
            type: 'general',
            notification_subtype: 'loyalty_credit',
          }),
        });
      } catch (error) {
        lastReason = 'apns_request_failed';
        console.warn(`[redeemMay30EventBonus] APNs request failed: ${errorMessage(error)}`);
        continue;
      }

      if (response.ok) {
        sent += 1;
        delivered = true;
        await updatePushSubscriptionRecord(base44, record, {
          last_seen_at: new Date().toISOString(),
          apns_environment: environment,
        });
        break;
      }

      lastStatus = response.status;
      const errorBody = await response.json().catch(() => ({}));
      lastReason = normalizeSingleLine(errorBody?.reason || response.statusText);
      console.warn(`[redeemMay30EventBonus] APNs push failed for a subscription: ${response.status} ${lastReason || 'unknown'}`);
    }

    if (delivered) continue;

    failed += 1;
    if (shouldRevokeApnsToken(lastStatus, lastReason)) {
      revoked += 1;
      await updatePushSubscriptionRecord(base44, record, {
        enabled: false,
        revoked_at: new Date().toISOString(),
      });
    }
  }

  return { sent, failed, revoked, skipped_reason: null };
}

async function sendEventPush(
  base44: Base44Client,
  identityEmails: string[],
  idempotencyKey: string,
  directSubscription: PushSubscriptionRecord | null,
) {
  if (!envFlag('ENABLE_MAY30_EVENT_PUSH')) {
    return {
      push_attempted: false,
      push_sent: false,
      push_skipped_reason: 'event_push_disabled',
    };
  }

  let subscriptions = directSubscription ? [directSubscription] : [];
  try {
    const storedSubscriptions = await findPushSubscriptions(base44, identityEmails);
    const seen = new Set(subscriptions.map((record) =>
      `${record.token_type}:${normalizeSingleLine(record.apns_token || record.fcm_token || record.endpoint)}`
    ));
    for (const record of storedSubscriptions) {
      const dedupeKey = `${record.token_type}:${normalizeSingleLine(record.apns_token || record.fcm_token || record.endpoint)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      subscriptions.push(record);
    }
  } catch (error) {
    console.warn(`[redeemMay30EventBonus] Push subscription lookup failed: ${errorMessage(error)}`);
    if (subscriptions.length === 0) {
      return {
        push_attempted: false,
        push_sent: false,
        push_skipped_reason: 'push_subscription_lookup_failed',
      };
    }
  }

  if (subscriptions.length === 0) {
    return {
      push_attempted: false,
      push_sent: false,
      push_skipped_reason: 'no_active_push_subscription',
    };
  }

  const payload = JSON.stringify({
    title: NOTIFICATION_TITLE,
    body: NOTIFICATION_BODY,
    url: '/rewards',
    tag: idempotencyKey,
    type: 'general',
    notification_subtype: 'loyalty_credit',
  });

  const webSubscriptions = subscriptions.filter((record) => record.token_type !== 'fcm');
  const apnsSubscriptions = subscriptions.filter((record) => record.token_type === 'apns');
  const fcmSubscriptions = subscriptions.filter((record) => record.token_type === 'fcm');
  const browserSubscriptions = webSubscriptions.filter((record) => record.token_type !== 'apns');
  const skippedReasons = [];
  let sent = 0;
  let failed = 0;
  let revoked = 0;
  let attempted = false;

  if (browserSubscriptions.length > 0) {
    if (VAPID_PRIVATE_KEY) {
      attempted = true;
      const result = await sendWebPushSubscriptions(base44, browserSubscriptions, payload);
      sent += result.sent;
      failed += result.failed;
      revoked += result.revoked;
    } else {
      skippedReasons.push('vapid_private_key_missing');
    }
  }

  if (apnsSubscriptions.length > 0) {
    const result = await sendApnsSubscriptions(base44, apnsSubscriptions, idempotencyKey);
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
    const result = await sendFcmSubscriptions(base44, fcmSubscriptions, idempotencyKey);
    if (result.skipped_reason) {
      skippedReasons.push(result.skipped_reason);
    } else {
      attempted = true;
    }
    sent += result.sent;
    failed += result.failed;
    revoked += result.revoked;
  }

  return {
    push_attempted: attempted,
    push_sent: sent > 0,
    push_skipped_reason: sent > 0 ? null : attempted ? 'push_delivery_failed' : skippedReasons.join('+') || 'push_provider_credentials_missing',
    push_failed_count: failed,
    push_revoked_count: revoked,
  };
}

Deno.serve(async (req) => {
  let commandLog: CommandLogRecord = null;

  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const eventKey = envText('MAY30_EVENT_KEY', DEFAULT_EVENT_KEY) || DEFAULT_EVENT_KEY;
    const bonusPoints = envNumber('MAY30_EVENT_BONUS_POINTS', DEFAULT_BONUS_POINTS);

    if (!envFlag('ENABLE_MAY30_EVENT_BONUS')) {
      return Response.json({
        success: true,
        skipped: true,
        already_claimed: false,
        reason: 'event_bonus_disabled',
        points_awarded: 0,
        event_key: eventKey,
        notification_created: false,
        push_attempted: false,
        push_sent: false,
        push_skipped_reason: 'event_bonus_disabled',
      });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = normalizeSafeId(user.id || user.user_id || user.uid, 'user_id');
    const userEmail = normalizeEmail(user.email);
    const body = await req.json().catch(() => ({}));
    const requestedEventKey = normalizeSingleLine(body.event_key || eventKey);

    if (requestedEventKey !== eventKey) {
      return Response.json(safeError('Event bonus is not available for this event key', 'invalid_event_key'), { status: 400 });
    }

    const identityEmails = await resolveIdentityEmails(base44, userEmail);
    const customerEmail = primaryCustomerEmail(userEmail, identityEmails);
    const directSubscription = directNativeSubscriptionFromBody(body, customerEmail);
    const idempotencyKey = `event_visit_bonus_may30_${userId}`;
    const idempotencyKeys = uniqueStrings([
      idempotencyKey,
      `event_visit_bonus_may30_${userEmail}`,
      `event_visit_bonus_may30_${customerEmail}`,
      ...identityEmails.map((email) => `event_visit_bonus_may30_${email}`),
    ]);

    const [existingCommandLog, existingEventClaim, existingPointRecords, existingNotification] = await Promise.all([
      findExistingCommandLog(base44, idempotencyKeys),
      findExistingEventClaim(base44, eventKey, identityEmails, userId, idempotencyKeys),
      findPointsRecords(base44, identityEmails),
      findExistingNotification(base44, identityEmails, idempotencyKeys),
    ]);

    if (
      existingCommandLog ||
      existingEventClaim ||
      hasAwardHistory(existingPointRecords, idempotencyKeys, eventKey) ||
      existingNotification
    ) {
      const push = {
        push_attempted: false,
        push_sent: false,
        push_skipped_reason: 'duplicate_redemption',
      };
      return Response.json({
        success: true,
        skipped: true,
        already_claimed: true,
        reason: existingCommandLog
          ? 'duplicate_idempotency_key'
          : existingEventClaim
            ? 'event_claim_duplicate'
            : existingNotification
              ? 'notification_duplicate'
              : 'points_history_duplicate',
        points_awarded: 0,
        event_key: eventKey,
        notification_created: false,
        ...push,
      });
    }

    commandLog = await createCommandLog(base44, idempotencyKey, user, eventKey);

    const historyEntry = {
      amount: bonusPoints,
      type: 'bonus',
      description: `May 30 event visit bonus (${eventKey})`,
      event_key: eventKey,
      idempotency_key: idempotencyKey,
      timestamp: new Date().toISOString(),
    };

    let pointsRecord = selectPointsRecord(existingPointRecords, customerEmail, identityEmails);
    if (pointsRecord) {
      await base44.asServiceRole.entities.UserPoints.update(pointsRecord.id, {
        total_points: (Number(pointsRecord.total_points) || 0) + bonusPoints,
        lifetime_points: (Number(pointsRecord.lifetime_points) || 0) + bonusPoints,
        redeemed_points: Number(pointsRecord.redeemed_points) || 0,
        points_history: [...(pointsRecord.points_history || []), historyEntry],
      });
    } else {
      pointsRecord = await base44.asServiceRole.entities.UserPoints.create({
        customer_email: customerEmail,
        total_points: bonusPoints,
        lifetime_points: bonusPoints,
        redeemed_points: 0,
        points_history: [historyEntry],
        claimed_rewards: [],
      });
    }

    await createEventClaim(base44, {
      eventKey,
      idempotencyKey,
      userId,
      userEmail,
      customerEmail,
      bonusPoints,
    });

    const notification = await createNotificationOnce(base44, customerEmail, identityEmails, idempotencyKeys);
    const push = await sendEventPush(base44, identityEmails, idempotencyKey, directSubscription);

    await updateCommandLog(base44, commandLog, {
      status: 'success',
      idempotent_skipped: false,
      target_entity: 'UserPoints',
      target_id: pointsRecord?.id || userId,
      result: {
        event_key: eventKey,
        points_awarded: bonusPoints,
        notification_created: notification.created,
        push_attempted: push.push_attempted,
        push_sent: push.push_sent,
        push_skipped_reason: push.push_skipped_reason,
      },
    });

    return Response.json({
      success: true,
      skipped: false,
      already_claimed: false,
      points_awarded: bonusPoints,
      event_key: eventKey,
      notification_created: notification.created,
      push_attempted: push.push_attempted,
      push_sent: push.push_sent,
      push_skipped_reason: push.push_skipped_reason,
    });
  } catch (error) {
    console.error('[redeemMay30EventBonus] Error');
    try {
      const base44 = createClientFromRequest(req);
      await updateCommandLog(base44, commandLog, {
        status: 'failed',
        error_code: 'event_bonus_error',
        error_message: 'Unable to redeem May 30 event bonus',
      });
    } catch {
      // Ignore logging failures after a top-level error.
    }
    return Response.json(safeError('Unable to redeem May 30 event bonus'), { status: 500 });
  }
});
