import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL') || 'https://nuvira-flow-core.base44.app/api/apps/69da9e8036b037ad40a9a73f/functions';
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    console.log('[LOYALTY SYNC] Starting loyalty rewards sync to hub');

    // Fetch all reward tiers
    const rewards = await base44.asServiceRole.entities.RewardTier.filter({}, 'sort_order', 50);
    
    if (rewards.length === 0) {
      console.log('[LOYALTY SYNC] No rewards to sync');
      return Response.json({ success: true, synced: 0 });
    }

    // Fetch customer loyalty data (sample of recent)
    const userPoints = await base44.asServiceRole.entities.UserPoints.filter({}, '-created_date', 100);

    const payload = {
      tiers: rewards.map(r => ({
        id: r.id,
        title: r.title,
        description: r.description,
        points_required: r.points_required,
        reward_type: r.reward_type,
        icon: r.icon,
        is_active: r.is_active,
      })),
      customer_points: userPoints.map(up => ({
        customer_email: up.customer_email,
        total_points: up.total_points,
        lifetime_points: up.lifetime_points,
        redeemed_points: up.redeemed_points,
      })),
    };

    const hubResponse = await fetch(`${HUB_API_URL}/syncLoyaltyRewards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify(payload),
    });

    if (!hubResponse.ok) {
      const errorText = await hubResponse.text();
      console.error(`[LOYALTY SYNC] Hub returned ${hubResponse.status}: ${errorText}`);

      await base44.asServiceRole.entities.ShopifySyncLog.create({
        sync_type: 'manual',
        status: 'error',
        records_synced: 0,
        records_failed: rewards.length + userPoints.length,
        error_details: `Loyalty sync failed: ${errorText}`,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        triggered_by: 'admin',
      });

      return Response.json({ error: `Hub sync failed (${hubResponse.status})` }, { status: hubResponse.status });
    }

    const result = await hubResponse.json();
    console.log(`[LOYALTY SYNC] Successfully synced ${rewards.length} tiers and ${userPoints.length} customer records`);

    await base44.asServiceRole.entities.ShopifySyncLog.create({
      sync_type: 'manual',
      status: 'success',
      records_synced: rewards.length + userPoints.length,
      records_failed: 0,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      triggered_by: 'admin',
    });

    return Response.json({ success: true, tiers_synced: rewards.length, customers_synced: userPoints.length, hub_response: result });
  } catch (error) {
    console.error('[LOYALTY SYNC] Error:', error.message);
    
    try {
      const base44 = createClientFromRequest(req);
      await base44.asServiceRole.entities.ShopifySyncLog.create({
        sync_type: 'manual',
        status: 'error',
        records_synced: 0,
        records_failed: 1,
        error_details: error.message,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        triggered_by: 'admin',
      });
    } catch {}

    return Response.json({ error: error.message }, { status: 500 });
  }
});