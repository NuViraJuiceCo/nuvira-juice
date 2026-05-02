import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * GET WINDOW 3 STATUS
 * 
 * Quick audit of Window 3 orders and threshold decision status.
 * Returns current Chicago time and threshold application.
 */

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function convertToChicago(utcStr) {
  const d = new Date(utcStr);
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const p = f.formatToParts(d);
  const m = {};
  p.forEach(x => { m[x.type] = x.value; });
  const y = parseInt(m.year), mo = parseInt(m.month) - 1, da = parseInt(m.day), h = parseInt(m.hour), mi = parseInt(m.minute);
  const dow = new Date(y, mo, da).getDay();
  return {
    time: `${y}-${String(mo + 1).padStart(2, '0')}-${String(da).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`,
    dow_name: DOW_NAMES[dow],
    dow_num: dow,
    y, mo, da, h, mi,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const nowUtc = new Date().toISOString();
    const nowChicago = convertToChicago(nowUtc);
    const saturdayPassed = nowChicago.dow_num === 6 && (nowChicago.h * 60 + nowChicago.mi) >= 14 * 60;

    // Get all orders and filter out refunded/deleted/test orders
    const allOrders = await base44.asServiceRole.entities.Order.list();
    
    // Guardrail: exclude refunded, deleted, or marked do_not_recover
    const isOrderExcluded = (o) => {
      return o.financial_status === 'refunded' ||
             o.payment_status === 'refunded' ||
             o.canceled_at ||
             o.deleted_at ||
             o.do_not_recover === true ||
             o.is_test_order === true;
    };

    const window3Orders = allOrders.filter(o => 
      !isOrderExcluded(o)
    );

    const results = [];
    for (const order of allOrders) {
      const createdChicago = convertToChicago(order.created_date);
      const isExcluded = isOrderExcluded(order);
      
      results.push({
        order_number: order.order_number,
        customer_name: order.customer_name,
        is_refunded: order.financial_status === 'refunded' || order.payment_status === 'refunded',
        is_deleted: !!order.deleted_at,
        is_active: !isExcluded,
        included_in_threshold_count: !isExcluded ? 'yes' : 'no',
        reason: isExcluded ? (order.payment_status === 'refunded' ? 'refunded' : order.deleted_at ? 'deleted' : order.do_not_recover ? 'do_not_recover' : 'excluded') : 'active',
        created_at_chicago: createdChicago.time,
        created_day_of_week: createdChicago.dow_name,
        assigned_production_day: order.assigned_production_day || 'Not yet assigned',
        assigned_delivery_day: order.assigned_delivery_day || 'Not yet assigned',
        production_status: order.production_status,
        fulfillment_status: order.fulfillment_status,
        delivery_status: order.delivery_status,
        ready_for_driver: order.ready_for_driver,
        appears_in_driver_portal: !isExcluded && order.ready_for_driver,
      });
    }

    return Response.json({
      success: true,
      mode: 'live',
      now_utc: nowUtc,
      now_chicago: nowChicago.time,
      chicago_day_of_week: nowChicago.dow_name,
      using_mock_time: false,
      timezone: 'America/Chicago',
      saturday_2pm_passed: saturdayPassed,
      window_3_active_eligible_count: window3Orders.length,
      threshold_required: 11,
      threshold_decision: saturdayPassed 
        ? (window3Orders.length > 10 ? 'APPROVED: Saturday production' : 'REJECTED: Rolled to Tuesday')
        : 'PENDING: Awaiting Saturday 2:00 PM',
      orders: results,
    });
  } catch (error) {
    console.error('[getWindow3Status] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});