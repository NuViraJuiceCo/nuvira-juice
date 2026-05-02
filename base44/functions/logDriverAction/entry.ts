import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Logs every driver action to DriverActionLog for audit trail.
 * Called after successful Order status update.
 * Non-fatal — failures don't block the driver action.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'driver' && user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      order_id,
      order_number,
      customer_email,
      action_type,
      old_status,
      new_status,
      delivery_photo_url,
      delivery_drop_location,
      unable_to_deliver_reason,
      driver_notes,
    } = await req.json();

    if (!order_id || !action_type) {
      return Response.json({ error: 'order_id and action_type required' }, { status: 400 });
    }

    // Create log entry
    await base44.asServiceRole.entities.DriverActionLog.create({
      order_id,
      order_number: order_number || '',
      customer_email: customer_email || '',
      action_type,
      old_status: old_status || '',
      new_status: new_status || '',
      delivery_photo_url: delivery_photo_url || '',
      delivery_drop_location: delivery_drop_location || '',
      unable_to_deliver_reason: unable_to_deliver_reason || '',
      driver_notes: driver_notes || '',
      performed_by: user.email,
      performed_at: new Date().toISOString(),
      hub_synced: false,
      hub_sync_status: 'pending',
    });

    console.log(`[logDriverAction] Logged ${action_type} for order ${order_number} by ${user.email}`);
    return Response.json({ logged: true });
  } catch (error) {
    console.error('[logDriverAction] Error:', error.message);
    // Non-fatal — don't fail the driver action if logging fails
    return Response.json({ logged: false, error: error.message });
  }
});