// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export default async function handler(req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { email, reward_id, reward_title, reward_type, validate_only } = await req.json();

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

    const requiredPoints = Number(reward.points_required);
    if (!Number.isSafeInteger(requiredPoints) || requiredPoints <= 0) {
      return Response.json({ error: 'Reward points configuration is unavailable' }, { status: 409 });
    }

    // Reward selection is recorded here; points are deducted only after a
    // successfully paid checkout so abandoned carts never consume points.
    const existing = await base44.asServiceRole.entities.UserPoints.filter(
      { customer_email: authenticatedEmail }
    );

    const userPointsRecord = existing[0];

    if (!userPointsRecord) {
      return Response.json({ error: 'Loyalty points account not found' }, { status: 404 });
    }

    const reservedPoints = Number(userPointsRecord.reserved_points ?? 0);
    if (existing.length !== 1 || !Number.isSafeInteger(Number(userPointsRecord.total_points))
      || Number(userPointsRecord.total_points) < 0 || !Number.isSafeInteger(reservedPoints)
      || reservedPoints < 0 || reservedPoints > Number(userPointsRecord.total_points)) {
      return Response.json({ error: 'Your points balance needs review before a reward can be selected' }, { status: 409 });
    }
    const availablePoints = Number(userPointsRecord.total_points) - reservedPoints;
    if (availablePoints < requiredPoints) {
      return Response.json({
        error: 'Not enough points for this reward',
        required_points: requiredPoints,
        available_points: availablePoints,
      }, { status: 409 });
    }

    // Cart/checkout refresh is read-only. Never append selection records while
    // checking a stored reward, and never trust a client-supplied points cost.
    if (validate_only === true) {
      return Response.json({
        success: true, validated_only: true, writes_performed: false,
        reward_id: reward.id, reward_title: reward.title, reward_type: reward.reward_type,
        points_required: requiredPoints, description: reward.description || '', icon: reward.icon || '🎁',
        source: 'customer_app_native', hub_operational_dependency: false,
      });
    }
    const claimedRewards = Array.isArray(userPointsRecord.claimed_rewards) ? [...userPointsRecord.claimed_rewards] : [];
    const alreadyClaimed = claimedRewards.some(r => r.reward_id === reward_id && r.status === 'selected_pending_checkout');

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

    return Response.json({
      success: true,
      reward_id,
      reward_title: reward.title,
      reward_type: reward.reward_type,
      points_required: requiredPoints,
      description: reward.description || '',
      icon: reward.icon || '🎁',
      already_selected: alreadyClaimed,
      source: 'customer_app_native',
      hub_operational_dependency: false,
    });
  } catch (error) {
    console.error('Claim reward error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
