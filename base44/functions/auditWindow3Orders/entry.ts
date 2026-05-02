import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * AUDIT WINDOW 3 ORDERS
 * 
 * Evaluates all orders in the Saturday window (Fri 2PM - Sat 2PM).
 * If Saturday 2:00 PM has passed, applies threshold decision immediately.
 * 
 * Returns detailed status for each order:
 * - Local Chicago timestamp
 * - Window assignment
 * - Threshold status
 * - Production/delivery assignment
 * - Driver Portal visibility
 */

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function convertToChicago(utcDateTime) {
  const utcDate = new Date(utcDateTime);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(utcDate);
  const partMap = {};
  parts.forEach(p => { partMap[p.type] = p.value; });
  
  const y = parseInt(partMap.year);
  const m = parseInt(partMap.month) - 1;
  const d = parseInt(partMap.day);
  const h = parseInt(partMap.hour);
  const min = parseInt(partMap.minute);
  const dow = new Date(y, m, d).getDay();
  
  return {
    local_time: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    day_of_week: DOW_NAMES[dow],
    y, m, d, h, min, dow,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Current Chicago time
    const now = new Date();
    const currentChicago = convertToChicago(now.toISOString());
    const currentTimeChicago = currentChicago.local_time;
    const currentDow = currentChicago.dow;
    const currentHourMin = currentChicago.h * 60 + currentChicago.min;

    // Check if Saturday 2:00 PM has passed
    const saturdayDecisionPassed = currentDow === 6 && currentHourMin >= 14 * 60;

    // Calculate Friday 2 PM and Saturday 2 PM boundaries (in current week)
    // For evaluation, we need to find the most recent Friday 2 PM and next Saturday 2 PM
    let fridayDate, saturdayDate;
    if (currentDow >= 5) {
      // Current day is Friday or Saturday
      fridayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (currentDow === 5 ? 0 : 1), 14, 0, 0);
      saturdayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (currentDow === 5 ? 1 : 0), 14, 0, 0);
    } else {
      // Current day is Sun-Thu, look at previous Friday
      const daysBack = (currentDow + 2) % 7;
      fridayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack, 14, 0, 0);
      saturdayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack + 1, 14, 0, 0);
    }

    console.log(`[auditWindow3Orders] Current Chicago: ${currentTimeChicago}, Sat 2PM passed: ${saturdayDecisionPassed}`);
    console.log(`[auditWindow3Orders] Window: ${fridayDate.toISOString()} to ${saturdayDate.toISOString()}`);

    // Fetch all orders
    const allOrders = await base44.asServiceRole.entities.Order.list('-created_date', 500);

    // Find Window 3 orders (created in Friday 2PM - Saturday 2PM window)
    const window3Orders = allOrders.filter(o => {
      if (!o.created_date) return false;
      const oCreated = new Date(o.created_date);
      return oCreated >= fridayDate && oCreated <= saturdayDate;
    });

    console.log(`[auditWindow3Orders] Found ${window3Orders.length} orders in Window 3`);

    const auditResults = [];

    // Audit each order
    for (const order of window3Orders) {
      const chicagoTime = convertToChicago(order.created_date);
      const orderResult = {
        order_number: order.order_number,
        customer_name: order.customer_name || 'Unknown',
        customer_email: order.customer_email,
        created_at_utc: order.created_date,
        created_at_chicago: chicagoTime.local_time,
        created_day_of_week: chicagoTime.day_of_week,
        window: 3,
        eligible_saturday_window_count: window3Orders.length,
        threshold_required: 11,
        threshold_status: saturdayDecisionPassed 
          ? (window3Orders.length > 10 ? 'threshold_met' : 'threshold_not_met')
          : 'threshold_pending',
      };

      // Apply threshold decision if Saturday 2 PM has passed
      if (saturdayDecisionPassed) {
        if (window3Orders.length > 10) {
          // Threshold met: Saturday production, Sunday delivery
          orderResult.final_decision = 'create_saturday_batch';
          orderResult.assigned_production_day = 'Saturday';
          orderResult.assigned_delivery_day = 'Sunday';
          orderResult.production_status = 'scheduled_for_production';
          orderResult.fulfillment_status = 'pending_production';
          orderResult.delivery_status = 'not_ready';
          orderResult.ready_for_driver = false;
          orderResult.appears_in_driver_portal_today = false;
          orderResult.reason = `Threshold met: ${window3Orders.length} eligible orders > 10`;

          // Update in database
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
              threshold_decision: 'approved',
              threshold_decided_at: new Date().toISOString(),
            });
            orderResult.db_updated = true;
          } catch (err) {
            orderResult.db_update_error = err.message;
          }
        } else {
          // Threshold not met: roll to Tuesday production, Wednesday delivery
          orderResult.final_decision = 'roll_to_tuesday';
          orderResult.assigned_production_day = 'Tuesday';
          orderResult.assigned_delivery_day = 'Wednesday';
          orderResult.production_status = 'scheduled_for_production';
          orderResult.fulfillment_status = 'pending_production';
          orderResult.delivery_status = 'not_ready';
          orderResult.ready_for_driver = false;
          orderResult.appears_in_driver_portal_today = false;
          orderResult.reason = `Threshold not met: ${window3Orders.length} eligible orders <= 10, rolled to Tuesday`;

          // Update in database
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
              scheduling_reason: `fewer_than_11_orders_in_saturday_window_rolled_to_tuesday (actual count: ${window3Orders.length})`,
              threshold_decision: 'rejected',
              threshold_decided_at: new Date().toISOString(),
            });
            orderResult.db_updated = true;
          } catch (err) {
            orderResult.db_update_error = err.message;
          }
        }
      } else {
        // Before Saturday 2 PM: pending decision
        orderResult.final_decision = 'pending_decision';
        orderResult.assigned_production_day = 'Saturday or Tuesday (pending)';
        orderResult.assigned_delivery_day = 'Sunday or Wednesday (pending)';
        orderResult.production_status = 'scheduled_for_production';
        orderResult.fulfillment_status = 'pending_production';
        orderResult.delivery_status = 'not_ready';
        orderResult.ready_for_driver = false;
        orderResult.appears_in_driver_portal_today = false;
        orderResult.reason = `Waiting for Saturday 2:00 PM threshold evaluation (${window3Orders.length} eligible orders, need 11+ for Saturday)`;
      }

      auditResults.push(orderResult);
    }

    return Response.json({
      success: true,
      current_time_chicago: currentTimeChicago,
      timezone: 'America/Chicago',
      saturday_2pm_passed: saturdayDecisionPassed,
      window_3_eligible_count: window3Orders.length,
      threshold_required: 11,
      orders_audited: auditResults.length,
      results: auditResults,
    });
  } catch (error) {
    console.error('[auditWindow3Orders] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});