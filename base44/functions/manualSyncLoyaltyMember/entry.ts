import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin function: manually look up and sync a customer to the LoyaltyMember entity.
 * Useful for recovering missing loyalty member records.
 * Payload: { email: string }
 */
Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_MANUAL_LOYALTY_MEMBER_SYNC') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'manual_loyalty_member_sync_disabled',
        message: 'Manual loyalty member sync is disabled for May 30 launch freeze.',
      });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.warn('⚠️ AUDIT: Admin invoked manualSyncLoyaltyMember — This creates/syncs loyalty member records');

    const { email } = await req.json();
    if (!email) {
      return Response.json({ error: 'email required' }, { status: 400 });
    }

    console.log(`Looking up loyalty member for ${email}`);

    // Check if member exists in local database
    const existing = await base44.asServiceRole.entities.LoyaltyMember.filter({ email });

    if (existing.length > 0) {
      return Response.json({
        success: true,
        message: 'Member already exists in database',
        loyaltyMemberId: existing[0].id,
        member: {
          email: existing[0].email,
          total_points: existing[0].total_points,
          lifetime_points: existing[0].lifetime_points,
        },
      });
    }

    // Member not in database, create directly
    const newMember = await base44.asServiceRole.entities.LoyaltyMember.create({
      email,
      total_points: 0,
      lifetime_points: 0,
      redeemed_points: 0,
      points_history: [{
        amount: 0,
        type: 'earned',
        description: 'Account created',
        timestamp: new Date().toISOString(),
      }],
    });

    console.log(`Created LoyaltyMember for ${email}: ${newMember.id}`);

    return Response.json({
      success: true,
      message: 'Member created and synced',
      loyaltyMemberId: newMember.id,
    });
  } catch (error) {
    console.error('Manual sync loyalty member error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
