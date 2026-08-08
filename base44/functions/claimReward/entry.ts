import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { email, reward_id, reward_title, reward_type } = await req.json();

    if (!email || !reward_id || !reward_title) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const authenticatedEmail = normalizeEmail(user.email);
    const requestedEmail = normalizeEmail(email);
    if (!authenticatedEmail || requestedEmail !== authenticatedEmail) {
      return Response.json({ error: 'Cannot claim a reward for another customer' }, { status: 403 });
    }

    const rewardRows = await base44.asServiceRole.entities.RewardTier.filter({
      id: reward_id,
      is_active: true,
    }, undefined, 1);
    const reward = rewardRows[0];
    if (!reward) {
      return Response.json({ error: 'Reward is unavailable' }, { status: 404 });
    }
    if (String(reward.title || '') !== String(reward_title || '')
      || String(reward.reward_type || '') !== String(reward_type || '')) {
      return Response.json({ error: 'Reward details do not match the active catalog' }, { status: 409 });
    }

    const requiredPoints = Math.max(0, Number(reward.points_required || 0));

    // Reward selection is recorded here; points are deducted only after a
    // successfully paid checkout so abandoned carts never consume points.
    const existing = await base44.asServiceRole.entities.UserPoints.filter(
      { customer_email: authenticatedEmail }
    );

    let userPointsRecord = existing[0];

    if (!userPointsRecord) {
      return Response.json({ error: 'Loyalty points account not found' }, { status: 404 });
    }

    if (Number(userPointsRecord.total_points || 0) < requiredPoints) {
      return Response.json({
        error: 'Not enough points for this reward',
        required_points: requiredPoints,
        available_points: Number(userPointsRecord.total_points || 0),
      }, { status: 409 });
    }

    // Add to claimed_rewards
    const claimedRewards = userPointsRecord.claimed_rewards || [];
    const alreadyClaimed = claimedRewards.some(r => r.reward_id === reward_id);

    if (!alreadyClaimed) {
      claimedRewards.push({
        reward_id,
        reward_title: reward.title,
        reward_type: reward.reward_type,
        points_required: requiredPoints,
        claimed_at: new Date().toISOString(),
        status: 'selected_pending_checkout',
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
            customer_email: authenticatedEmail,
            reward_id,
            reward_title: reward.title,
            reward_type: reward.reward_type,
            points_required: requiredPoints,
            claimed_at: new Date().toISOString(),
          }),
        }).catch(err => console.warn('Hub sync failed:', err.message));
      }
    } catch (syncErr) {
      console.warn('Failed to sync to hub:', syncErr.message);
    }

    return Response.json({
      success: true,
      reward_id,
      reward_title: reward.title,
      reward_type: reward.reward_type,
      points_required: requiredPoints,
      already_selected: alreadyClaimed,
    });
  } catch (error) {
    console.error('Claim reward error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
