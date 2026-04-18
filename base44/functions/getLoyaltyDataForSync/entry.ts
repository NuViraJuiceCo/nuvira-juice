import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token || token !== CUSTOMER_APP_SYNC_SECRET) {
      console.error('getLoyaltyDataForSync: unauthorized request');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const loyaltyRecords = await base44.asServiceRole.entities.UserPoints.list();

    const formatted = {
      customers: loyaltyRecords.map(record => ({
        customer_email: record.customer_email,
        total_points: record.total_points,
        lifetime_points: record.lifetime_points,
        redeemed_points: record.redeemed_points,
        points_history: record.points_history || [],
      })),
    };

    console.log(`getLoyaltyDataForSync: returning ${formatted.customers.length} customer records`);
    return Response.json(formatted);
  } catch (error) {
    console.error('getLoyaltyDataForSync error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});