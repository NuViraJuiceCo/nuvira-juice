import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

function legacyLoyaltyEventBridgeEnabled() {
  return Deno.env.get('ENABLE_LEGACY_LOYALTY_EVENT_BRIDGE_SYNC') === 'true';
}

/**
 * Syncs Event entity changes to the hub app.
 * Triggered by entity automation on create/update/delete.
 * Payload: { event: { type }, data: <Event>, event: { entity_id } }
 */
Deno.serve(async (req) => {
  try {
    if (!legacyLoyaltyEventBridgeEnabled()) {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'legacy_loyalty_event_bridge_sync_disabled',
        message: 'Legacy loyalty/event bridge sync is disabled for the May 30 launch freeze.',
      }, { status: 409 });
    }

    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const eventType = body.event?.type; // 'create' | 'update' | 'delete'
    const entityId = body.event?.entity_id;
    let record = body.data;

    // Fetch if not provided (e.g. payload_too_large)
    if (!record && entityId) {
      const results = await base44.asServiceRole.entities.Event.filter({ id: entityId });
      record = results[0] || null;
    }

    if (!record && eventType !== 'delete') {
      console.error('syncEventToHub: no event data');
      return Response.json({ error: 'No event data' }, { status: 400 });
    }

    if (!HUB_API_URL) {
      console.log('syncEventToHub: HUB_API_URL not set, skipping');
      return Response.json({ success: true, skipped: true });
    }

    // For events without hub_event_id, skip syncing (they're locally created only)
    const hub_event_id = record?.hub_event_id;
    if (!hub_event_id && eventType !== 'delete') {
      console.log(`syncEventToHub: event ${entityId} has no hub_event_id, skipping sync`);
      return Response.json({ success: true, skipped: true, reason: 'no_hub_event_id' });
    }

    const action = eventType === 'delete' ? 'delete' : eventType; // create | update | delete

    const payload = {
      action,
      hub_event_id: hub_event_id || entityId,
      event: action !== 'delete' ? record : undefined,
    };

    console.log(`syncEventToHub: pushing ${action} for event ${hub_event_id || entityId}`);

    const response = await fetch(`${HUB_API_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`syncEventToHub: hub returned ${response.status}:`, errorText);
      return Response.json({ error: `Hub returned ${response.status}`, details: errorText }, { status: response.status });
    }

    const result = await response.json();
    console.log(`syncEventToHub: success`, result);
    return Response.json({ success: true, hub_response: result });
  } catch (error) {
    console.error('syncEventToHub error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
