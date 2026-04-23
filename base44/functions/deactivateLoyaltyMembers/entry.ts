import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Deactivate loyalty members in the hub (admin-only).
 * Syncs deactivation status back to hub and updates local cache.
 * Payload: { emails: string[] } or { email: string }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const emails = Array.isArray(body.emails) ? body.emails : [body.email].filter(Boolean);

    if (emails.length === 0) {
      return Response.json({ error: 'No emails provided' }, { status: 400 });
    }

    const hubApiUrl = Deno.env.get('HUB_API_URL');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

    if (!hubApiUrl || !hubSecret) {
      return Response.json({ error: 'Hub not configured' }, { status: 500 });
    }

    const results = { deactivated: [], failed: [] };

    // Push each deactivation to hub
    for (const email of emails) {
      try {
        await fetch(`${hubApiUrl}/api/customer-app-sync/deactivate-member`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hubSecret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email,
            status: 'inactive',
            deactivated_at: new Date().toISOString(),
          }),
        });

        // Update local cache to match
        const localMembers = await base44.asServiceRole.entities.LoyaltyMember.filter({ email });
        if (localMembers.length > 0) {
          await base44.asServiceRole.entities.LoyaltyMember.update(localMembers[0].id, {
            is_active: false,
          });
        }

        results.deactivated.push(email);
        console.log(`Deactivated member in hub and local cache: ${email}`);
      } catch (err) {
        results.failed.push({ email, error: err.message });
        console.error(`Failed to deactivate ${email}:`, err.message);
      }
    }

    return Response.json({
      success: results.failed.length === 0,
      deactivated: results.deactivated,
      failed: results.failed,
    });
  } catch (error) {
    console.error('Deactivation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});