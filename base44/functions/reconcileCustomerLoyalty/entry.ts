import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Reconciles customer account loyalty and order history.
 * 
 * Recalculates loyalty points from only valid paid, non-refunded, non-cancelled, non-abandoned, non-test orders.
 * Removes or reverses points from invalid orders.
 * 
 * Called manually or via admin function.
 */
Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_LOYALTY_RECONCILIATION') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'loyalty_reconciliation_disabled',
        message: 'Loyalty reconciliation is disabled for May 30 launch freeze.',
      });
    }

    const base44 = createClientFromRequest(req);
    const { customer_email } = await req.json();

    if (!customer_email) {
      return Response.json({ error: 'customer_email is required' }, { status: 400 });
    }

    console.log(`[reconcileCustomerLoyalty] Starting reconciliation for ${customer_email}`);

    // Fetch all orders for this customer
    const allOrders = await base44.asServiceRole.entities.Order.filter(
      { customer_email },
      '-created_date',
      100
    );

    console.log(`[reconcileCustomerLoyalty] Found ${allOrders.length} total orders`);

    // Classify orders as valid or invalid
    const validOrders = [];
    const invalidOrders = [];

    allOrders.forEach(order => {
      const isValid =
        order.payment_status === 'paid' &&
        order.payment_captured === true &&
        order.financial_status === 'paid' &&
        !['cancelled', 'refunded', 'pending_payment'].includes(order.status) &&
        !order.is_abandoned_checkout &&
        !order.do_not_recover &&
        !order.is_test_order;

      if (isValid) {
        validOrders.push(order);
        console.log(`✅ Valid: ${order.order_number} (${order.status}, payment=${order.payment_status})`);
      } else {
        invalidOrders.push(order);
        const reason = order.is_test_order ? 'test_order' : 
                       order.payment_status === 'refunded' ? 'refunded' :
                       order.status === 'cancelled' ? 'cancelled' :
                       order.is_abandoned_checkout ? 'abandoned_checkout' :
                       order.do_not_recover ? 'do_not_recover' :
                       order.payment_captured === false ? 'payment_not_captured' : 'unknown';
        console.log(`❌ Invalid (${reason}): ${order.order_number}`);
      }
    });

    console.log(`[reconcileCustomerLoyalty] Valid orders: ${validOrders.length}, Invalid: ${invalidOrders.length}`);

    // Calculate correct loyalty points from valid orders only
    // Pre-order launch bonus: 250 pts (award once)
    // Per order: 10 pts per $1 spent
    const correctLifetimePoints = 250 + (validOrders.reduce((sum, o) => sum + Math.floor(o.total * 10), 0));
    const correctTotalPoints = correctLifetimePoints; // Assuming no redemptions for now

    console.log(`[reconcileCustomerLoyalty] Correct loyalty: lifetime=${correctLifetimePoints}, total=${correctTotalPoints}`);

    // Fetch current loyalty record
    const existingPoints = await base44.asServiceRole.entities.UserPoints.filter({ customer_email });
    let pointsRecordId = null;
    let currentLifetime = 0;
    let currentTotal = 0;
    let currentHistory = [];

    if (existingPoints.length > 0) {
      const record = existingPoints[0];
      pointsRecordId = record.id;
      currentLifetime = record.lifetime_points || 0;
      currentTotal = record.total_points || 0;
      currentHistory = record.points_history || [];

      console.log(`[reconcileCustomerLoyalty] Current loyalty: lifetime=${currentLifetime}, total=${currentTotal}`);
    }

    // Create reconciliation audit entry
    const reconciliationEntry = {
      amount: 0,
      type: 'adjustment',
      description: `RECONCILIATION: Recalculated loyalty from ${validOrders.length} valid paid orders. Removed points from ${invalidOrders.length} invalid orders (refunded/cancelled/test/abandoned). Correct lifetime: ${correctLifetimePoints}, correct total: ${correctTotalPoints}`,
      timestamp: new Date().toISOString(),
    };

    // Update or create UserPoints record
    if (pointsRecordId) {
      await base44.asServiceRole.entities.UserPoints.update(pointsRecordId, {
        lifetime_points: correctLifetimePoints,
        total_points: correctTotalPoints,
        redeemed_points: 0, // Reset to 0 (no redemptions in this scenario)
        points_history: [...currentHistory, reconciliationEntry],
      });
      console.log(`[reconcileCustomerLoyalty] Updated UserPoints record ${pointsRecordId}`);
    } else {
      const newRecord = await base44.asServiceRole.entities.UserPoints.create({
        customer_email,
        lifetime_points: correctLifetimePoints,
        total_points: correctTotalPoints,
        redeemed_points: 0,
        points_history: [
          { amount: 250, type: 'earned', description: 'Pre-Order Launch Bonus — welcome to NuVira Rewards!', timestamp: new Date().toISOString() },
          ...validOrders.map(o => ({
            amount: Math.floor(o.total * 10),
            type: 'earned',
            description: `Order payment of $${o.total.toFixed(2)}`,
            timestamp: o.created_date,
          })),
          reconciliationEntry,
        ],
      });
      pointsRecordId = newRecord.id;
      console.log(`[reconcileCustomerLoyalty] Created new UserPoints record ${pointsRecordId}`);
    }

    return Response.json({
      success: true,
      customer_email,
      before: {
        lifetime_points: currentLifetime,
        total_points: currentTotal,
        total_orders: allOrders.length,
      },
      after: {
        lifetime_points: correctLifetimePoints,
        total_points: correctTotalPoints,
        total_orders: allOrders.length,
        valid_orders: validOrders.length,
        invalid_orders: invalidOrders.length,
      },
      valid_orders: validOrders.map(o => ({
        order_number: o.order_number,
        total: o.total,
        status: o.status,
        payment_status: o.payment_status,
        points_earned: Math.floor(o.total * 10),
      })),
      invalid_orders: invalidOrders.map(o => ({
        order_number: o.order_number,
        total: o.total,
        status: o.status,
        payment_status: o.payment_status,
        reason: o.is_test_order ? 'test_order' : 
                o.payment_status === 'refunded' ? 'refunded' :
                o.status === 'cancelled' ? 'cancelled' :
                o.is_abandoned_checkout ? 'abandoned_checkout' :
                o.do_not_recover ? 'do_not_recover' :
                o.payment_captured === false ? 'payment_not_captured' : 'unknown',
      })),
    });

  } catch (error) {
    console.error('[reconcileCustomerLoyalty] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
