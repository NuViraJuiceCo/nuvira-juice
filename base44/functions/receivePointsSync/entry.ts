import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

/**
 * Receives loyalty points sync from hub and upserts into UserPoints entity
 * Called by: Hub app pushing points updates to customer app
 * Payload: { customers: [{ customer_email, total_points, lifetime_points, redeemed_points, points_history }] }
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token || token !== CUSTOMER_APP_SYNC_SECRET) {
      console.error('receivePointsSync: unauthorized request');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const { customers } = await req.json();

    if (!customers || !Array.isArray(customers)) {
      return Response.json({ error: 'Missing or invalid customers array' }, { status: 400 });
    }

    let created = 0;
    let updated = 0;

    for (const customer of customers) {
      const { customer_email, total_points = 0, lifetime_points = 0, redeemed_points = 0, points_history = [] } = customer;

      if (!customer_email) continue;

      // Check if record exists
      const existing = await base44.asServiceRole.entities.UserPoints.filter({ customer_email });

      if (existing.length > 0) {
        // Update existing record
        await base44.asServiceRole.entities.UserPoints.update(existing[0].id, {
          total_points,
          lifetime_points,
          redeemed_points,
          points_history,
        });
        updated++;
      } else {
        // Create new record
        await base44.asServiceRole.entities.UserPoints.create({
          customer_email,
          total_points,
          lifetime_points,
          redeemed_points,
          points_history,
        });
        created++;
      }
    }

    console.log(`receivePointsSync: synced ${customers.length} customers (created: ${created}, updated: ${updated})`);
    return Response.json({ success: true, created, updated, total: customers.length });
  } catch (error) {
    console.error('receivePointsSync error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});