import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

/**
 * Receives individual loyalty point transactions from hub and appends to UserPoints
 * Called by: Hub app pushing transaction updates to customer app
 * Payload: { customers: [{ customer_email, amount, type, description, order_id, reward_id, timestamp }] }
 * Behavior: Appends each transaction to ledger, recalculates totals
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

    for (const txn of customers) {
      const { customer_email, amount, type, description, order_id, reward_id, timestamp } = txn;

      if (!customer_email || amount === undefined || !type) continue;

      // Build transaction entry
      const entry = {
        amount,
        type, // earned | redeemed | bonus | adjustment
        description,
        order_id,
        reward_id,
        timestamp: timestamp || new Date().toISOString(),
      };

      // Check if record exists
      const existing = await base44.asServiceRole.entities.UserPoints.filter({ customer_email });

      if (existing.length > 0) {
        const rec = existing[0];
        const history = rec.points_history || [];
        history.push(entry);

        // Recalculate totals: lifetime_points = all earned + bonus, redeemed_points = all redeemed, total = lifetime - redeemed
        let lifetime = 0;
        let redeemed = 0;
        for (const h of history) {
          if (h.type === 'earned' || h.type === 'bonus' || h.type === 'adjustment') {
            lifetime += h.amount;
          } else if (h.type === 'redeemed') {
            redeemed += h.amount;
          }
        }
        const total = Math.max(0, lifetime - redeemed);

        await base44.asServiceRole.entities.UserPoints.update(rec.id, {
          total_points: total,
          lifetime_points: lifetime,
          redeemed_points: redeemed,
          points_history: history,
        });
        updated++;
      } else {
        // Create new record with first transaction
        const lifetime = (entry.type === 'earned' || entry.type === 'bonus' || entry.type === 'adjustment') ? entry.amount : 0;
        const redeemed = entry.type === 'redeemed' ? entry.amount : 0;
        const total = Math.max(0, lifetime - redeemed);

        await base44.asServiceRole.entities.UserPoints.create({
          customer_email,
          total_points: total,
          lifetime_points: lifetime,
          redeemed_points: redeemed,
          points_history: [entry],
        });
        created++;
      }
    }

    console.log(`receivePointsSync: synced ${customers.length} transactions (created: ${created}, updated: ${updated})`);
    return Response.json({ success: true, created, updated, total: customers.length });
  } catch (error) {
    console.error('receivePointsSync error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});