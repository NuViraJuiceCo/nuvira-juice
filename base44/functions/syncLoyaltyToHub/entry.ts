import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

/**
 * Syncs UserPoints entity changes to the hub app.
 * Triggered by entity automation on create/update.
 * Payload: { event: { type }, data: <UserPoints>, event: { entity_id } }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const eventType = body.event?.type; // 'create' | 'update'
    const entityId = body.event?.entity_id;
    let record = body.data;

    // Fetch if not provided (e.g. payload_too_large)
    if (!record && entityId) {
      const results = await base44.asServiceRole.entities.UserPoints.filter({ id: entityId });
      record = results[0] || null;
    }

    if (!record || !record.customer_email) {
      console.error('syncLoyaltyToHub: no loyalty data');
      return Response.json({ error: 'No loyalty data' }, { status: 400 });
    }

    if (!HUB_API_URL) {
      console.log('syncLoyaltyToHub: HUB_API_URL not set, skipping');
      return Response.json({ success: true, skipped: true });
    }

    const payload = {
      event: eventType === 'create' ? 'loyalty.created' : 'loyalty.updated',
      source: 'customer_app',
      loyalty: {
        customer_email: record.customer_email,
        total_points: record.total_points,
        lifetime_points: record.lifetime_points,
        redeemed_points: record.redeemed_points,
        points_history: record.points_history || [],
        claimed_rewards: record.claimed_rewards || [],
      },
    };

    console.log(`syncLoyaltyToHub: pushing ${eventType} for ${record.customer_email}`);

    const response = await fetch(HUB_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`syncLoyaltyToHub: hub returned ${response.status}:`, errorText);
      return Response.json({ error: `Hub returned ${response.status}`, details: errorText }, { status: response.status });
    }

    const result = await response.json();
    console.log(`syncLoyaltyToHub: success`, result);
    return Response.json({ success: true, hub_response: result });
  } catch (error) {
    console.error('syncLoyaltyToHub error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});