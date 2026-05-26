import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * MANUAL RECONCILIATION for lost delivery data
 * 
 * Marks 6 delivered orders from today (May 2) as delivered:
 * - NV-MON7CNYB (Jesse Kahlon)
 * - NV-MOILSACV (Danyelle Nisbet #1)
 * - NV-MOILVI17 (Danyelle Nisbet #2)
 * - NV-MOF1S04J (Parminder/Gthand)
 * - NV-MODIHVQQ (Zach Rootz)
 * 
 * Issue: Driver actions only persisted in React state, were lost on page refresh.
 * Fix: Manually update Order.status = 'delivered' and create audit logs.
 */
Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_LEGACY_REPAIR_TOOLS') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'legacy_repair_tools_disabled',
        message: 'Legacy repair tools are disabled for May 30 launch freeze.',
      });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const reconciliationData = [
      {
        order_number: 'NV-MON7CNYB',
        customer_email: 'jskahlon1984@live.com',
        customer_name: 'Jesse Kahlon',
        delivered_at: '2026-05-02T14:30:00Z',
        delivery_drop_location: 'Front Door',
      },
      {
        order_number: 'NV-MOILSACV',
        customer_email: 'danyellenisbet@yahoo.com',
        customer_name: 'Danyelle Nisbet',
        delivered_at: '2026-05-02T15:00:00Z',
        delivery_drop_location: 'Front Door',
      },
      {
        order_number: 'NV-MOILVI17',
        customer_email: 'danyellenisbet@yahoo.com',
        customer_name: 'Danyelle Nisbet',
        delivered_at: '2026-05-02T15:05:00Z',
        delivery_drop_location: 'Front Door',
      },
      {
        order_number: 'NV-MOF1S04J',
        customer_email: 'gthand@yahoo.com',
        customer_name: 'Parminder (Gthand)',
        delivered_at: '2026-05-02T15:45:00Z',
        delivery_drop_location: 'Front Door',
      },
      {
        order_number: 'NV-MODIHVQQ',
        customer_email: 'mm6r278756@privaterelay.appleid.com',
        customer_name: 'Zach Rootz',
        delivered_at: '2026-05-02T16:20:00Z',
        delivery_drop_location: 'Front Door',
      },
    ];

    const results = [];

    for (const reconcile of reconciliationData) {
      try {
        // Find the order
        const orders = await base44.asServiceRole.entities.Order.filter({ order_number: reconcile.order_number });
        if (orders.length === 0) {
          results.push({ order_number: reconcile.order_number, status: 'not_found' });
          continue;
        }

        const order = orders[0];
        const newHistory = [
          ...(order.status_history || []),
          {
            status: 'delivered',
            timestamp: reconcile.delivered_at,
            message: `[MANUAL RECONCILIATION] Delivered · ${reconcile.delivery_drop_location}`,
          },
        ];

        // Update order
        await base44.asServiceRole.entities.Order.update(order.id, {
          status: 'delivered',
          status_history: newHistory,
          delivery_drop_location: reconcile.delivery_drop_location,
          delivered_by: user.email,
          delivered_at: reconcile.delivered_at,
          notes: order.notes ? `${order.notes}\n[MANUAL RECONCILIATION on ${new Date().toISOString()}]` : `[MANUAL RECONCILIATION on ${new Date().toISOString()}]`,
        });

        // Create audit log
        await base44.asServiceRole.entities.DriverActionLog.create({
          order_id: order.id,
          order_number: reconcile.order_number,
          customer_email: reconcile.customer_email,
          action_type: 'delivered',
          old_status: order.status,
          new_status: 'delivered',
          delivery_drop_location: reconcile.delivery_drop_location,
          driver_notes: 'Manual reconciliation - driver actions were lost on page refresh',
          performed_by: user.email,
          performed_at: new Date().toISOString(),
          hub_synced: false,
          hub_sync_status: 'pending',
        });

        // Create sync log
        await base44.asServiceRole.entities.OrderSyncLog.create({
          order_number: reconcile.order_number,
          status: 'pending',
          description: `Manual reconciliation: marked as delivered. Awaiting Hub sync.`,
          started_at: new Date().toISOString(),
          triggered_by: 'manual',
        });

        results.push({ order_number: reconcile.order_number, status: 'reconciled', order_id: order.id });
      } catch (err) {
        console.error(`[reconcileDeliveredOrders] Error reconciling ${reconcile.order_number}:`, err.message);
        results.push({ order_number: reconcile.order_number, status: 'error', error: err.message });
      }
    }

    console.log('[reconcileDeliveredOrders] Reconciliation complete:', results);
    return Response.json({ reconciled: results, total: reconciliationData.length, success: results.filter(r => r.status === 'reconciled').length });
  } catch (error) {
    console.error('[reconcileDeliveredOrders] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
