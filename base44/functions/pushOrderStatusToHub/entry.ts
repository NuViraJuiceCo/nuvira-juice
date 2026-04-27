import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Status-only bridge: push an admin status update for a Hub-managed order to Hub.
 * NEVER overwrites line items, pricing, customer data, or subscription structure.
 * Payload: { hub_order_id, order_number, customer_email, new_status, stage_label }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { hub_order_id, order_number, customer_email, new_status, stage_label } = await req.json();

    if (!order_number || !new_status) {
      return Response.json({ error: 'order_number and new_status required' }, { status: 400 });
    }

    const hubApiUrl = Deno.env.get('HUB_API_URL');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

    if (!hubApiUrl || !hubSecret) {
      return Response.json({ error: 'Hub not configured' }, { status: 500 });
    }

    const hubBase = hubApiUrl.replace(/\/$/, '').replace(/\/functions\/.*$/, '');

    // Send status-only update to Hub
    const payload = {
      event: 'order.status_updated',
      source: 'customer_app_admin',
      order_number,
      hub_order_id: hub_order_id || null,
      customer_email: customer_email || null,
      new_status,
      stage_label: stage_label || new_status,
      updated_by: user.email,
      updated_at: new Date().toISOString(),
    };

    console.log(`[pushOrderStatusToHub] Admin ${user.email} updating order ${order_number} → ${new_status}`);

    const response = await fetch(`${hubBase}/functions/receiveSyncedEvent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${hubSecret}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[pushOrderStatusToHub] Hub returned ${response.status}: ${errText}`);
      // Non-fatal — log but don't fail the admin action
      return Response.json({ success: true, hub_synced: false, hub_error: errText });
    }

    const result = await response.json();
    console.log(`[pushOrderStatusToHub] Order ${order_number} status synced to Hub`);
    return Response.json({ success: true, hub_synced: true, hub_response: result });
  } catch (error) {
    console.error('[pushOrderStatusToHub] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});