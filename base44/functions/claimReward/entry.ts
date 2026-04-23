import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { email, reward_id, reward_title, reward_type } = await req.json();

    if (!email || !reward_id || !reward_title) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get or create UserPoints record
    const existing = await base44.asServiceRole.entities.UserPoints.filter(
      { customer_email: email }
    );

    let userPointsRecord = existing[0];

    if (!userPointsRecord) {
      userPointsRecord = await base44.asServiceRole.entities.UserPoints.create({
        customer_email: email,
        total_points: 0,
        lifetime_points: 0,
        redeemed_points: 0,
        claimed_rewards: [],
      });
    }

    // Add to claimed_rewards
    const claimedRewards = userPointsRecord.claimed_rewards || [];
    const alreadyClaimed = claimedRewards.some(r => r.reward_id === reward_id);

    if (!alreadyClaimed) {
      claimedRewards.push({
        reward_id,
        reward_title,
        reward_type,
        claimed_at: new Date().toISOString(),
      });

      await base44.asServiceRole.entities.UserPoints.update(userPointsRecord.id, {
        claimed_rewards: claimedRewards,
      });
    }

    // Sync to hub
    try {
      const hubApiUrl = Deno.env.get('HUB_API_URL');
      const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

      if (hubApiUrl && hubSecret) {
        await fetch(`${hubApiUrl}/api/customer-app-sync/reward-claims`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hubSecret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            customer_email: email,
            reward_id,
            reward_title,
            reward_type,
            claimed_at: new Date().toISOString(),
          }),
        }).catch(err => console.warn('Hub sync failed:', err.message));
      }
    } catch (syncErr) {
      console.warn('Failed to sync to hub:', syncErr.message);
    }

    return Response.json({ success: true, reward_id });
  } catch (error) {
    console.error('Claim reward error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});