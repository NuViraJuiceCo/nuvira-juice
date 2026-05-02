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

    // Get orders for NV-MONL4I2M, NV-MOOPFCUS, NV-MON367R7
    const targetOrders = ['NV-MONL4I2M', 'NV-MOOPFCUS', 'NV-MON367R7'];
    const allOrders = await base44.asServiceRole.entities.Order.list();
    const window3Orders = allOrders.filter(o => targetOrders.includes(o.order_number));

    const results = [];
    for (const order of window3Orders) {
      const createdChicago = convertToChicago(order.created_date);
      results.push({
        order_number: order.order_number,
        customer_name: order.customer_name,
        created_at_utc: order.created_date,
        created_at_chicago: createdChicago.time,
        created_day_of_week: createdChicago.dow_name,
        assigned_production_day: order.assigned_production_day || 'Not yet assigned',
        assigned_delivery_day: order.assigned_delivery_day || 'Not yet assigned',
        batch_trigger: order.batch_trigger,
        production_status: order.production_status,
        fulfillment_status: order.fulfillment_status,
        delivery_status: order.delivery_status,
        ready_for_driver: order.ready_for_driver,
      });
    }

    return Response.json({
      success: true,
      current_time_chicago: nowChicago.time,
      timezone: 'America/Chicago',
      saturday_2pm_passed: saturdayPassed,
      window_3_eligible_count: window3Orders.length,
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