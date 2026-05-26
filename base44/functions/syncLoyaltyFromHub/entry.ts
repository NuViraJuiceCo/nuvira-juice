import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_LOYALTY_FROM_HUB_SYNC') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'loyalty_from_hub_sync_disabled',
        message: 'Loyalty pull from Hub is disabled for May 30 launch freeze.',
      });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { email } = await req.json();
    const targetEmail = email || user.email;

    if (!targetEmail) {
      return Response.json({ error: 'Email required' }, { status: 400 });
    }

    // Fetch loyalty data from hub
    const hubApiUrl = Deno.env.get('HUB_API_URL');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

    if (!hubApiUrl || !hubSecret) {
      return Response.json({ error: 'Hub not configured' }, { status: 500 });
    }

    const hubRes = await fetch(
      `${hubApiUrl}/api/loyalty-members?email=${encodeURIComponent(targetEmail)}`,
      { headers: { 'Authorization': `Bearer ${hubSecret}` } }
    );

    if (!hubRes.ok) {
      console.warn(`Hub returned ${hubRes.status} for ${targetEmail}`);
      return Response.json({ error: 'Member not found in hub' }, { status: 404 });
    }

    const hubMember = await hubRes.json();

    // Get or create local UserPoints and sync
    const existing = await base44.asServiceRole.entities.UserPoints.filter(
      { customer_email: targetEmail }
    );

    let userPointsRecord = existing[0];

    if (!userPointsRecord) {
      userPointsRecord = await base44.asServiceRole.entities.UserPoints.create({
        customer_email: targetEmail,
        total_points: hubMember.total_points || 0,
        lifetime_points: hubMember.lifetime_points || 0,
        redeemed_points: hubMember.redeemed_points || 0,
        points_history: hubMember.points_history || [],
        claimed_rewards: hubMember.claimed_rewards || [],
      });
      console.log(`Created local UserPoints cache for ${targetEmail}`);
    } else {
      // Update with hub data
      await base44.asServiceRole.entities.UserPoints.update(userPointsRecord.id, {
        total_points: hubMember.total_points || 0,
        lifetime_points: hubMember.lifetime_points || 0,
        redeemed_points: hubMember.redeemed_points || 0,
        points_history: hubMember.points_history || [],
        claimed_rewards: hubMember.claimed_rewards || [],
      });
      console.log(`Synced UserPoints cache from hub for ${targetEmail}`);
    }

    return Response.json({
      success: true,
      synced: {
        total_points: hubMember.total_points,
        lifetime_points: hubMember.lifetime_points,
        redeemed_points: hubMember.redeemed_points,
      },
    });
  } catch (error) {
    console.error('Sync loyalty from hub error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
