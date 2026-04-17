import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    // Verify the shared secret
    const providedSecret = req.headers.get('x-sync-secret');
    if (providedSecret !== HUB_SYNC_SECRET) {
      console.error('Unauthorized: Invalid hub sync secret');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const update = await req.json();

    if (!update || !update.id) {
      console.error('No update data in payload');
      return Response.json({ error: 'No update data' }, { status: 400 });
    }

    console.log(`Received hub update for order ${update.id}`);

    // Update the ShopifyOrder record in this app
    await base44.asServiceRole.entities.ShopifyOrder.update(update.id, {
      production_status: update.production_status || undefined,
      fulfillment_status: update.fulfillment_status || undefined,
      assigned_delivery_date: update.assigned_delivery_date || undefined,
      assigned_driver: update.assigned_driver || undefined,
      internal_notes: update.internal_notes || undefined,
      workflow_checklist: update.workflow_checklist || undefined,
    });

    console.log(`Order ${update.id} updated successfully`);
    return Response.json({ success: true, id: update.id });
  } catch (error) {
    console.error('receiveHubOrderUpdate error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});