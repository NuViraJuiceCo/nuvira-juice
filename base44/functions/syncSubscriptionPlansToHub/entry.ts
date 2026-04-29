import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = `${Deno.env.get('HUB_API_URL')}/functions/receiveCustomerAppEvent`;
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

/**
 * Syncs SubscriptionPlan entity changes to the hub app.
 * Triggered by entity automation on create/update, or called manually.
 * Payload: { event: { type }, data: <SubscriptionPlan>, event: { entity_id } }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const eventType = body.event?.type; // 'create' | 'update'
    const entityId = body.event?.entity_id;
    let plan = body.data;

    // Fetch if not provided (e.g. payload_too_large)
    if (!plan && entityId) {
      const results = await base44.asServiceRole.entities.SubscriptionPlan.filter({ id: entityId });
      plan = results[0] || null;
    }

    if (!plan || !plan.id) {
      console.error('syncSubscriptionPlansToHub: no plan data');
      return Response.json({ error: 'No plan data' }, { status: 400 });
    }

    if (!HUB_API_URL) {
      console.log('syncSubscriptionPlansToHub: HUB_API_URL not set, skipping');
      return Response.json({ success: true, skipped: true });
    }

    const payload = {
      event: eventType === 'create' ? 'subscription_plan.created' : 'subscription_plan.updated',
      source: 'customer_app',
      plan: {
        id: plan.id,
        name: plan.name,
        frequency: plan.frequency,
        base_price: plan.base_price,
        bottle_count: plan.bottle_count,
        discount_percent: plan.discount_percent,
        perks: plan.perks || [],
        is_featured: plan.is_featured,
        stripe_product_id: plan.stripe_product_id,
        stripe_price_id: plan.stripe_price_id,
      },
    };

    console.log(`syncSubscriptionPlansToHub: pushing ${eventType} for plan ${plan.name}`);

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
      console.error(`syncSubscriptionPlansToHub: hub returned ${response.status}:`, errorText);
      return Response.json({ error: `Hub returned ${response.status}`, details: errorText }, { status: response.status });
    }

    const result = await response.json();
    console.log(`syncSubscriptionPlansToHub: plan ${plan.name} synced successfully`, result);
    return Response.json({ success: true, hub_response: result });
  } catch (error) {
    console.error('syncSubscriptionPlansToHub error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});