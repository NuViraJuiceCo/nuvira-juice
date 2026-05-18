import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * SATURDAY THRESHOLD EVALUATOR
 * 
 * At Saturday 2:00 PM (America/Chicago):
 * - Count eligible active orders from Friday 2:00 PM through Saturday 2:00 PM
 * - Excludes refunded, deleted, and marked do_not_recover orders
 * - If count > 10: create Saturday batch, deliver Sunday
 * - If count <= 10: roll to Tuesday batch, deliver Wednesday
 */

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get current time in Chicago
    const now = new Date();
    const chicagoFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const parts = chicagoFormatter.formatToParts(now);
    const partMap = {};
    parts.forEach(p => { partMap[p.type] = p.value; });

    const y = parseInt(partMap.year);
    const m = parseInt(partMap.month) - 1;
    const d = parseInt(partMap.day);
    const h = parseInt(partMap.hour);
    const min = parseInt(partMap.minute);

    const chicagoNow = new Date(y, m, d, h, min);
    const dow = chicagoNow.getDay();
    const hourMinutes = h * 60 + min;
    const currentTimeChicago = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;

    // Auto-evaluate at/after Saturday 2:00 PM
    if (!(dow === 6 && hourMinutes >= 14 * 60)) {
      return Response.json({
        success: false,
        reason: 'not_saturday_2pm',
        current_time_chicago: currentTimeChicago,
        message: 'Threshold evaluation only runs on Saturday at 2:00 PM or later Chicago time',
      });
    }

    // Calculate Friday 2:00 PM window start and Saturday 2:00 PM window end
    const fridayDate = new Date(y, m, d - 1, 14, 0, 0); // Previous day (Friday) at 2 PM
    const saturdayDate = new Date(y, m, d, 14, 0, 0); // Today (Saturday) at 2 PM

    console.log(`[evaluateSaturdayThreshold] Evaluating window: ${fridayDate.toISOString()} to ${saturdayDate.toISOString()}`);

    // Fetch all orders created in this window, excluding refunded/deleted/test orders
    let eligibleOrders = [];
    try {
      const allOrders = await base44.asServiceRole.entities.Order.list('-created_date', 500);
      
      // Guardrail: exclude refunded, deleted, test orders
      const isOrderExcluded = (o) => {
        return o.financial_status === 'refunded' ||
               o.payment_status === 'refunded' ||
               o.canceled_at ||
               o.deleted_at ||
               o.do_not_recover === true ||
               o.is_test_order === true;
      };
      
      eligibleOrders = allOrders.filter(o => {
        if (!o.created_date) return false;
        if (isOrderExcluded(o)) return false;
        const oCreated = new Date(o.created_date);
        return oCreated >= fridayDate && oCreated <= saturdayDate;
      });
    } catch (err) {
      console.warn('[evaluateSaturdayThreshold] Failed to fetch orders:', err.message);
    }

    const eligibleCount = eligibleOrders.length;
    const thresholdMet = eligibleCount > 10;

    console.log(`[evaluateSaturdayThreshold] Eligible orders in window: ${eligibleCount}, Threshold met: ${thresholdMet}`);

    // Update orders based on threshold
    const updates = [];

    if (thresholdMet) {
      // Saturday batch is approved — set production for Saturday, delivery for Sunday
      for (const order of eligibleOrders) {
        // Double-check order is not refunded before updating
        if (order.financial_status === 'refunded' || order.payment_status === 'refunded' || order.do_not_recover) {
          console.warn(`[evaluateSaturdayThreshold] Skipping refunded order ${order.order_number}`);
          continue;
        }
        try {
          await base44.asServiceRole.entities.Order.update(order.id, {
            assigned_production_day: 'Saturday',
            assigned_delivery_day: 'Sunday',
            assigned_delivery_window_start: null,
            assigned_delivery_window_end: null,
            delivery_window_label: 'Manual scheduling',
            delivery_window_timezone: 'America/Chicago',
            batch_trigger: 'saturday_threshold_met',
            production_status: 'scheduled_for_production',
            fulfillment_status: 'pending_production',
            delivery_status: 'not_ready',
            ready_for_driver: false,
            saturday_threshold_decision: 'approved',
            saturday_threshold_decided_at: new Date().toISOString(),
          });
          updates.push({
            order_number: order.order_number,
            decision: 'approved_saturday_production',
            assigned_delivery_date: 'Sunday',
          });
        } catch (err) {
          console.error(`[evaluateSaturdayThreshold] Failed to update ${order.order_number}: ${err.message}`);
        }
      }
    } else {
      // Threshold not met — roll to Tuesday batch
      for (const order of eligibleOrders) {
        // Double-check order is not refunded before updating
        if (order.financial_status === 'refunded' || order.payment_status === 'refunded' || order.do_not_recover) {
          console.warn(`[evaluateSaturdayThreshold] Skipping refunded order ${order.order_number}`);
          continue;
        }
        try {
          await base44.asServiceRole.entities.Order.update(order.id, {
            assigned_production_day: 'Tuesday',
            assigned_delivery_day: 'Wednesday',
            assigned_delivery_window_start: '17:00',
            assigned_delivery_window_end: '20:00',
            delivery_window_label: '5:00 PM - 8:00 PM',
            delivery_window_timezone: 'America/Chicago',
            batch_trigger: 'saturday_threshold_not_met',
            production_status: 'scheduled_for_production',
            fulfillment_status: 'pending_production',
            delivery_status: 'not_ready',
            ready_for_driver: false,
            scheduling_reason: `fewer_than_11_orders_in_saturday_window_rolled_to_tuesday (actual count: ${eligibleCount})`,
            saturday_threshold_decision: 'rejected_rolled_to_tuesday',
            saturday_threshold_decided_at: new Date().toISOString(),
          });
          updates.push({
            order_number: order.order_number,
            decision: 'rolled_to_tuesday',
            assigned_delivery_date: 'Wednesday',
          });
        } catch (err) {
          console.error(`[evaluateSaturdayThreshold] Failed to update ${order.order_number}: ${err.message}`);
        }
      }
    }

    return Response.json({
      success: true,
      mode: 'live',
      now_utc: now.toISOString(),
      now_chicago: currentTimeChicago,
      chicago_day_of_week: DOW_NAMES[dow],
      using_mock_time: false,
      timezone: 'America/Chicago',
      evaluation_time: new Date().toISOString(),
      window_start: fridayDate.toISOString(),
      window_end: saturdayDate.toISOString(),
      window_3_active_eligible_count: eligibleCount,
      threshold_required: 11,
      threshold_met: thresholdMet,
      threshold_status: thresholdMet ? 'threshold_met' : 'threshold_not_met',
      final_decision: thresholdMet ? 'create_saturday_batch' : 'roll_to_tuesday',
      orders_updated: updates.length,
      updates,
    });
  } catch (error) {
    console.error('[evaluateSaturdayThreshold] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});