import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ADMIN_APP_URL = Deno.env.get('ADMIN_APP_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

/**
 * One-time sync: Push all existing LoyaltyMembers to the hub.
 * Fetches all loyalty members and sends each to the hub's receiveLoyaltySignup endpoint.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    if (!ADMIN_APP_URL) {
      return Response.json({ error: 'ADMIN_APP_URL not configured' }, { status: 400 });
    }

    // Fetch all loyalty members
    const members = await base44.asServiceRole.entities.LoyaltyMember.list('-created_date', 500);
    console.log(`Pushing ${members.length} loyalty members to hub`);

    const results = { success: [], failed: [] };
    const baseUrl = ADMIN_APP_URL.endsWith('/') ? ADMIN_APP_URL.slice(0, -1) : ADMIN_APP_URL;
    const url = `${baseUrl}/functions/receiveLoyaltySignup`;
    const requestHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
    };

    for (const member of members) {
      try {
        const payload = {
          email: member.email,
          full_name: member.email.split('@')[0], // Use email prefix as name fallback
          phone: null,
          signup_date: member.created_date?.split('T')[0] || new Date().toISOString().split('T')[0],
        };

        const response = await fetch(url, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Failed to push ${member.email}:`, errorText);
          results.failed.push({ email: member.email, error: errorText });
        } else {
          results.success.push(member.email);
          console.log(`Pushed ${member.email} to hub`);
        }
      } catch (error) {
        console.error(`Error pushing ${member.email}:`, error.message);
        results.failed.push({ email: member.email, error: error.message });
      }
    }

    console.log(`Push complete. Success: ${results.success.length}, Failed: ${results.failed.length}`);
    return Response.json(results);
  } catch (error) {
    console.error('pushExistingLoyaltyMembersToHub error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});