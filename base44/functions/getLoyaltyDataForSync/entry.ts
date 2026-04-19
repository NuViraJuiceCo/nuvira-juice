import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_SYNC_SECRET = Deno.env.get('HUB_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token || token !== HUB_SYNC_SECRET) {
      console.error('getLoyaltyDataForSync: unauthorized request');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    
    // Assuming hub has a LoyaltyMember or similar entity
    // Adjust entity name if different
    const members = await base44.asServiceRole.entities.LoyaltyMember.list();

    const formatted = {
      customers: members.map(m => ({
        customer_email: m.email,
        total_points: m.total_points || 0,
        lifetime_points: m.lifetime_points || 0,
        redeemed_points: m.redeemed_points || 0,
        points_history: m.points_history || [],
      })),
    };

    console.log(`getLoyaltyDataForSync: returning ${formatted.customers.length} loyalty members`);
    return Response.json(formatted);
  } catch (error) {
    console.error('getLoyaltyDataForSync error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});