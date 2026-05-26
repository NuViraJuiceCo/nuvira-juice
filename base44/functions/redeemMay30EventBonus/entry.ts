import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import webpush from 'npm:web-push@3.6.7';

const DEFAULT_EVENT_KEY = 'may30_event_visit';
const DEFAULT_BONUS_POINTS = 250;
const NOTIFICATION_TITLE = 'Welcome To NuVira';
const NOTIFICATION_BODY = 'Your 250 point event visit bonus has been added.';
const VAPID_PUBLIC_KEY = Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY')
  || 'BHmr7cCgm_eL3ckBL91ZKnvCqXvLax8pahXxpFCY8qwFXi0alWve4tDDJaaSDTuLwA-4VSEWBHMMlE_BixdHWaM';
const VAPID_PRIVATE_KEY = Deno.env.get('WEB_PUSH_VAPID_PRIVATE_KEY');
const VAPID_CONTACT = Deno.env.get('WEB_PUSH_CONTACT') || 'mailto:info@nuvirajuice.com';

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown');
}

function isMissingSchemaError(error: unknown): boolean {
  const message = errorMessage(error);
  return message.includes('Entity schema') && message.includes('not found');
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

async function findPointsRecord(base44: Base44Client, identityEmails: string[]): Promise<PointsRecord> {
  for (const email of identityEmails) {
    const records = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: email }, '-created_date', 5);
    if (records[0]) return records[0];
  }
  return null;
}

function hasAwardHistory(pointsRecord: PointsRecord, idempotencyKey: string, eventKey: string): boolean {
  return (pointsRecord?.points_history || []).some((entry: Record<string, any>) =>
    entry?.idempotency_key === idempotencyKey ||
    (entry?.event_key === eventKey && entry?.type === 'bonus') ||
    normalizeSingleLine(entry?.description).includes(idempotencyKey)
  );
}

async function findExistingCommandLog(base44: Base44Client, idempotencyKey: string): Promise<CommandLogRecord> {
  try {
    const logs = await base44.asServiceRole.entities.CommandLog.filter({ idempotency_key: idempotencyKey }, '-created_date', 5);
    return logs.find((log: Record<string, any>) => ['success', 'skipped', 'pending', 'running'].includes(log.status)) || null;
  } catch (error) {
    if (isMissingSchemaError(error)) {
      console.warn('[redeemMay30EventBonus] CommandLog schema unavailable; using UserPoints history idempotency');
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

async function createNotificationOnce(base44: Base44Client, customerEmail: string, idempotencyKey: string) {
  const existing = await base44.asServiceRole.entities.Notification.filter({ idempotency_key: idempotencyKey }, '-created_date', 1);
  if (existing[0]) {
    return { created: false, skipped_reason: 'duplicate_idempotency_key' };
  }

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
  const subscriptions = [];
  const seenEndpoints = new Set();

  for (const email of identityEmails) {
    const rows = await base44.asServiceRole.entities.PushSubscription.filter({ customer_email: email });
    for (const row of rows) {
      if (row.enabled === false || row.revoked_at || !row.endpoint || !row.p256dh || !row.auth) continue;
      if (seenEndpoints.has(row.endpoint)) continue;

      seenEndpoints.add(row.endpoint);
      subscriptions.push(row);
    }
  }

  return subscriptions;
}

async function sendEventPush(base44: Base44Client, identityEmails: string[], idempotencyKey: string) {
  if (!envFlag('ENABLE_MAY30_EVENT_PUSH')) {
    return {
      push_attempted: false,
      push_sent: false,
      push_skipped_reason: 'event_push_disabled',
    };
  }

  let subscriptions = [];
  try {
    subscriptions = await findPushSubscriptions(base44, identityEmails);
  } catch (error) {
    console.warn(`[redeemMay30EventBonus] Push subscription lookup failed: ${errorMessage(error)}`);
    return {
      push_attempted: false,
      push_sent: false,
      push_skipped_reason: 'push_subscription_lookup_failed',
    };
  }

  if (subscriptions.length === 0) {
    return {
      push_attempted: false,
      push_sent: false,
      push_skipped_reason: 'no_active_push_subscription',
    };
  }

  if (!VAPID_PRIVATE_KEY) {
    return {
      push_attempted: false,
      push_sent: false,
      push_skipped_reason: 'vapid_private_key_missing',
    };
  }

  webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const payload = JSON.stringify({
    title: NOTIFICATION_TITLE,
    body: NOTIFICATION_BODY,
    url: '/rewards',
    tag: idempotencyKey,
    type: 'general',
    notification_subtype: 'loyalty_credit',
  });

  let sent = 0;
  let failed = 0;
  let revoked = 0;

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
      await base44.asServiceRole.entities.PushSubscription.update(record.id, {
        last_seen_at: new Date().toISOString(),
      });
    } catch (error) {
      failed += 1;
      const pushError = error as { statusCode?: number; status?: number };
      const statusCode = pushError?.statusCode || pushError?.status;
      if (statusCode === 404 || statusCode === 410) {
        revoked += 1;
        await base44.asServiceRole.entities.PushSubscription.update(record.id, {
          enabled: false,
          revoked_at: new Date().toISOString(),
        });
      }
      console.warn(`[redeemMay30EventBonus] Event push failed for a subscription: ${statusCode || 'unknown'}`);
    }
  }

  return {
    push_attempted: true,
    push_sent: sent > 0,
    push_skipped_reason: sent > 0 ? null : 'push_delivery_failed',
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

    const idempotencyKey = `event_visit_bonus_may30_${userId}`;
    const existingCommandLog = await findExistingCommandLog(base44, idempotencyKey);
    if (existingCommandLog) {
      const push = {
        push_attempted: false,
        push_sent: false,
        push_skipped_reason: 'duplicate_redemption',
      };
      return Response.json({
        success: true,
        skipped: true,
        already_claimed: true,
        reason: 'duplicate_idempotency_key',
        points_awarded: 0,
        event_key: eventKey,
        notification_created: false,
        ...push,
      });
    }

    const identityEmails = await resolveIdentityEmails(base44, userEmail);
    const customerEmail = primaryCustomerEmail(userEmail, identityEmails);
    const existingPoints = await findPointsRecord(base44, identityEmails);

    if (hasAwardHistory(existingPoints, idempotencyKey, eventKey)) {
      commandLog = await createCommandLog(base44, idempotencyKey, user, eventKey);
      await updateCommandLog(base44, commandLog, {
        status: 'skipped',
        idempotent_skipped: true,
        result: {
          already_claimed: true,
          event_key: eventKey,
          points_awarded: 0,
        },
      });

      const push = {
        push_attempted: false,
        push_sent: false,
        push_skipped_reason: 'duplicate_redemption',
      };
      return Response.json({
        success: true,
        skipped: true,
        already_claimed: true,
        reason: 'points_history_duplicate',
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

    let pointsRecord = existingPoints;
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

    const notification = await createNotificationOnce(base44, customerEmail, idempotencyKey);
    const push = await sendEventPush(base44, identityEmails, idempotencyKey);

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
