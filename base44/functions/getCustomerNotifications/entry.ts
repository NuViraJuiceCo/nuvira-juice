import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * getCustomerNotifications — identity-aware, RLS-safe notification retrieval.
 *
 * Uses service role to query all notifications across all known identity emails
 * for the authenticated user. Merges, deduplicates, and returns sorted results.
 *
 * Also handles markRead: pass { mark_read_id: "<notification_id>" } to mark one as read.
 */

async function readJsonBody(req) {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false, body: null };
  }
}

Deno.serve(async (req) => {
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
      body = parsedBody.body;
    }
    const { mark_read_id } = body;

    // ── Mark read operation ───────────────────────────────────────────────────
    if (mark_read_id) {
      // Verify the notification belongs to this user before allowing update
      const notifs = await base44.asServiceRole.entities.Notification.filter({ id: mark_read_id });
      const notif = notifs[0];
      if (!notif) {
        return Response.json({ error: 'Notification not found' }, { status: 404 });
      }

      // Resolve all identity emails for security check
      const identityEmails = await resolveIdentities(base44, user.email);
      if (!identityEmails.includes(notif.customer_email)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }

      await base44.asServiceRole.entities.Notification.update(mark_read_id, { is_read: true });
      return Response.json({ success: true, marked_read: mark_read_id });
    }

    // ── Fetch notifications for all identity emails ───────────────────────────
    const identityEmails = await resolveIdentities(base44, user.email);
    console.log(`[getCustomerNotifications] Fetching for ${user.email}, identities: ${JSON.stringify(identityEmails)}`);

    const seen = new Set();
    const all = [];

    for (const email of identityEmails) {
      const batch = await base44.asServiceRole.entities.Notification.filter(
        { customer_email: email },
        '-created_date',
        50
      );
      for (const n of batch) {
        if (!seen.has(n.id)) {
          seen.add(n.id);
          all.push(n);
        }
      }
    }

    // Sort newest first, cap at 50
    const sorted = all
      .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
      .slice(0, 50);

    console.log(`[getCustomerNotifications] Returning ${sorted.length} notifications for ${user.email}`);
    return Response.json({ notifications: sorted, identities_resolved: identityEmails });

  } catch (error) {
    console.error('[getCustomerNotifications] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * Resolve all identity emails for a given auth email using UserProfile cross-references.
 */
async function resolveIdentities(base44, authEmail) {
  const identities = new Set([authEmail]);

  try {
    // Forward lookup: profile where customer_email = authEmail
    const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: authEmail });
    if (profiles[0]?.contact_email) identities.add(profiles[0].contact_email);

    // Reverse lookup: profile where contact_email = authEmail (Apple relay case)
    const reverseProfiles = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: authEmail });
    for (const p of reverseProfiles) {
      if (p.customer_email) identities.add(p.customer_email);
      if (p.contact_email) identities.add(p.contact_email);
    }
  } catch (err) {
    console.warn(`[getCustomerNotifications] Identity resolution partial failure: ${err.message}`);
  }

  return [...identities];
}
