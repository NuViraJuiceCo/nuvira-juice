import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
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

    const { endpoint = null } = await req.json().catch(() => ({}));
    const customerEmail = normalizeEmail(user.email);
    const candidates = endpoint
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
  } catch {
    console.error('[unregisterPushSubscription] Error');
    return Response.json({ error: 'Unable to unregister push subscription' }, { status: 500 });
  }
});
