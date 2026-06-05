import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin function: push a loyalty member's current data to the hub
 * Payload: { email: string }
 */
Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_LOYALTY_MANUAL_HUB_PUSH') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'loyalty_manual_hub_push_disabled',
        message: 'Manual loyalty Hub push is disabled for May 30 launch freeze.',
      });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { email } = await req.json();
    if (!email) {
      return Response.json({ error: 'email required' }, { status: 400 });
    }

    // Fetch the current loyalty member data
    const members = await base44.asServiceRole.entities.LoyaltyMember.filter({ email });
    if (members.length === 0) {
      return Response.json({ error: 'Member not found', email }, { status: 404 });
    }

    const member = members[0];

    // Push to hub via loyaltySync endpoint. Keep the URL in runtime config so
    // legacy Hub details are not hardcoded in the deployed function.
    const hubLoyaltySyncUrl = Deno.env.get('HUB_LOYALTY_SYNC_URL');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

    if (!hubLoyaltySyncUrl || !hubSecret) {
      return Response.json({ error: 'Hub not configured' }, { status: 400 });
    }

    const response = await fetch(hubLoyaltySyncUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hubSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'update',
        email: member.email,
        total_points: member.total_points,
        lifetime_points: member.lifetime_points,
        redeemed_points: member.redeemed_points,
        points_history: member.points_history,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Hub sync failed: ${response.status} ${errText}`);
      return Response.json({
        error: 'Failed to sync to hub',
        status: response.status,
        details: errText,
      }, { status: response.status });
    }

    console.log(`Pushed loyalty data for ${email} to hub`);

    return Response.json({
      success: true,
      message: 'Loyalty data pushed to hub',
      email,
      total_points: member.total_points,
    });
  } catch (error) {
    console.error('Push loyalty to hub error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
