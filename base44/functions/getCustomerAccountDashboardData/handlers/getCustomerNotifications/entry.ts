// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Identity-aware notification retrieval and customer-owned read/dismiss actions.
 * Dismissal archives the row instead of deleting it so notification idempotency
 * history remains intact.
 */

const VALID_ACTIONS = new Set(['list', 'mark_read', 'mark_all_read', 'dismiss', 'dismiss_read']);

async function readJsonBody(req) {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false, body: null };
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function ownsNotification(notification, identityEmails) {
  const identities = new Set(identityEmails.map(normalizeEmail).filter(Boolean));
  return identities.has(normalizeEmail(notification?.customer_email));
}

function notificationIdFromBody(body) {
  const value = body?.notification_id || body?.mark_read_id || '';
  return typeof value === 'string' ? value.trim() : '';
}

async function loadNotifications(base44, identityEmails) {
  const seen = new Set();
  const all = [];

  for (const email of identityEmails) {
    const batch = await base44.asServiceRole.entities.Notification.filter(
      { customer_email: email },
      '-created_date',
      50
    );
    for (const notification of batch) {
      if (!seen.has(notification.id)) {
        seen.add(notification.id);
        all.push(notification);
      }
    }
  }

  return all.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
}

async function updateManyNotifications(base44, notifications, patch) {
  let updatedCount = 0;
  for (const notification of notifications) {
    await base44.asServiceRole.entities.Notification.update(notification.id, patch);
    updatedCount += 1;
  }
  return updatedCount;
}

export default async function handler(req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body = {};
    if (req.method === 'POST') {
      const parsedBody = await readJsonBody(req);
      if (!parsedBody.ok) {
        return Response.json({ success: false, error: 'malformed_json', error_code: 'malformed_json' }, { status: 400 });
      }
      if (!parsedBody.body || typeof parsedBody.body !== 'object' || Array.isArray(parsedBody.body)) {
        return Response.json({ success: false, error: 'invalid_request', error_code: 'invalid_request' }, { status: 400 });
      }
      body = parsedBody.body;
    }

    const action = body.mark_read_id ? 'mark_read' : String(body.action || 'list');
    if (!VALID_ACTIONS.has(action)) {
      return Response.json({ success: false, error: 'invalid_action', error_code: 'invalid_action' }, { status: 400 });
    }

    const identityEmails = await resolveIdentities(base44, user.email);

    if (action === 'mark_read' || action === 'dismiss') {
      const notificationId = notificationIdFromBody(body);
      if (!notificationId || notificationId.length > 128) {
        return Response.json({ success: false, error: 'invalid_notification_id', error_code: 'invalid_notification_id' }, { status: 400 });
      }

      const matches = await base44.asServiceRole.entities.Notification.filter({ id: notificationId });
      const notification = matches[0];
      if (!notification) {
        return Response.json({ error: 'Notification not found' }, { status: 404 });
      }
      if (!ownsNotification(notification, identityEmails)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }

      const patch = action === 'dismiss'
        ? { is_read: true, dismissed_at: new Date().toISOString() }
        : { is_read: true };
      await base44.asServiceRole.entities.Notification.update(notificationId, patch);
      return Response.json({
        success: true,
        action,
        notification_id: notificationId,
        ...(action === 'mark_read' ? { marked_read: notificationId } : {}),
      });
    }

    const all = await loadNotifications(base44, identityEmails);

    if (action === 'mark_all_read') {
      const targets = all.filter((notification) => !notification.dismissed_at && notification.is_read !== true);
      const updatedCount = await updateManyNotifications(base44, targets, { is_read: true });
      return Response.json({ success: true, action, updated_count: updatedCount });
    }

    if (action === 'dismiss_read') {
      const targets = all.filter((notification) => !notification.dismissed_at && notification.is_read === true);
      const updatedCount = await updateManyNotifications(base44, targets, { dismissed_at: new Date().toISOString() });
      return Response.json({ success: true, action, updated_count: updatedCount });
    }

    const notifications = all.filter((notification) => !notification.dismissed_at).slice(0, 50);
    console.log(`[getCustomerNotifications] Returning ${notifications.length} notifications for authenticated account`);
    return Response.json({ notifications, identities_resolved: identityEmails });
  } catch (error) {
    console.error('[getCustomerNotifications] Error:', error.message);
    return Response.json({ error: 'Unable to update notifications' }, { status: 500 });
  }
}

async function resolveIdentities(base44, authEmail) {
  const identities = new Set([authEmail]);

  try {
    const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: authEmail });
    if (profiles[0]?.contact_email) identities.add(profiles[0].contact_email);

    const reverseProfiles = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: authEmail });
    for (const profile of reverseProfiles) {
      if (profile.customer_email) identities.add(profile.customer_email);
      if (profile.contact_email) identities.add(profile.contact_email);
    }
  } catch (error) {
    console.warn(`[getCustomerNotifications] Identity resolution partial failure: ${error.message}`);
  }

  return [...identities];
}
