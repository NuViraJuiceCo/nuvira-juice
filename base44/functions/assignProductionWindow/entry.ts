import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * OFFICIAL NUVIRA PRODUCTION SCHEDULING
 * 
 * Assigns an order to the correct production window based on creation time.
 * All times evaluated in America/Chicago timezone.
 * 
 * Window 1: Sat 2PM - Tue 2PM → Tue evening production → Wed delivery
 * Window 2: Tue 2PM - Fri 2PM → Fri evening production → Sat delivery
 * Window 3: Fri 2PM - Sat 2PM → Conditional Saturday (threshold-dependent)
 * Window 4: Sat 2PM+ → Tue evening production → Wed delivery
 */

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getWindowAssignment(orderCreatedAtUtc) {
  // Convert UTC to Chicago time
  const utcDate = new Date(orderCreatedAtUtc);
  const chicagoFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  
  const parts = chicagoFormatter.formatToParts(utcDate);
  const partMap = {};
  parts.forEach(p => { partMap[p.type] = p.value; });
  
  const y = parseInt(partMap.year);
  const m = parseInt(partMap.month) - 1;
  const d = parseInt(partMap.day);
  const h = parseInt(partMap.hour);
  const min = parseInt(partMap.minute);
  
  // Reconstruct as Chicago time (for day-of-week calculation)
  const chicagoDate = new Date(y, m, d, h, min, 0);
  const dow = chicagoDate.getDay(); // 0=Sun, 6=Sat
  const dowName = DOW_NAMES[dow];
  const hourMinutes = h * 60 + min;
  const cutoff2pm = 14 * 60; // 2:00 PM = 840 minutes
  
  // Return local Chicago time for display
  const chicagoTimeStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  
  // Window 1: Sat 2PM - Tue 2PM → Tue production → Wed delivery
  if ((dow === 6 && hourMinutes >= cutoff2pm) || // Sat 2PM+
      (dow === 0) || // Sun
      (dow === 1) || // Mon
      (dow === 2 && hourMinutes < cutoff2pm)) { // Tue before 2PM
    return {
      window: 1,
      local_time_chicago: chicagoTimeStr,
      local_day_of_week: dowName,
      assigned_production_day: 'Tuesday',
      assigned_production_time: 'evening',
      assigned_delivery_day: 'Wednesday',
      batch_trigger: null,
      scheduling_reason: 'window_1_sat_2pm_to_tue_2pm',
    };
  }
  
  // Window 2: Tue 2PM - Fri 2PM → Fri production → Sat delivery
  if ((dow === 2 && hourMinutes >= cutoff2pm) || // Tue 2PM+
      (dow === 3) || // Wed
      (dow === 4) || // Thu
      (dow === 5 && hourMinutes < cutoff2pm)) { // Fri before 2PM
    return {
      window: 2,
      local_time_chicago: chicagoTimeStr,
      local_day_of_week: dowName,
      assigned_production_day: 'Friday',
      assigned_production_time: 'evening',
      assigned_delivery_day: 'Saturday',
      batch_trigger: null,
      scheduling_reason: 'window_2_tue_2pm_to_fri_2pm',
    };
  }
  
  // Window 3: Fri 2PM - Sat 2PM → Conditional Saturday (threshold-dependent)
  if ((dow === 5 && hourMinutes >= cutoff2pm) || // Fri 2PM+
      (dow === 6 && hourMinutes < cutoff2pm)) { // Sat before 2PM
    return {
      window: 3,
      local_time_chicago: chicagoTimeStr,
      local_day_of_week: dowName,
      assigned_production_day: null, // TBD at Saturday 2PM
      assigned_production_time: 'evening',
      assigned_delivery_day: null, // TBD at Saturday 2PM
      batch_trigger: 'saturday_window_pending',
      scheduling_reason: 'window_3_fri_2pm_to_sat_2pm_pending_threshold',
      threshold_status: 'pending',
      threshold_decision_time: new Date(y, m, 6, 14, 0, 0).toISOString(), // Next Saturday 2PM
    };
  }
  
  // Fallback: treat as Window 1
  return {
    window: 1,
    local_time_chicago: chicagoTimeStr,
    local_day_of_week: dowName,
    assigned_production_day: 'Tuesday',
    assigned_production_time: 'evening',
    assigned_delivery_day: 'Wednesday',
    batch_trigger: null,
    scheduling_reason: 'window_1_default',
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { order_id, order_created_at } = await req.json();
    
    if (!order_created_at) {
      return Response.json({ error: 'order_created_at required' }, { status: 400 });
    }
    
    const assignment = getWindowAssignment(order_created_at);

    // Add delivery window based on assigned delivery day
    const deliveryWindows = {
      'Wednesday': { start: '17:00', end: '20:00', label: '5:00 PM - 8:00 PM' },
      'Saturday': { start: '17:00', end: '20:00', label: '5:00 PM - 8:00 PM' },
      'Sunday': { start: null, end: null, label: 'Manual scheduling' },
    };

    const window = deliveryWindows[assignment.assigned_delivery_day];
    
    return Response.json({
      success: true,
      order_id,
      assignment: {
        ...assignment,
        assigned_delivery_window_start: window.start,
        assigned_delivery_window_end: window.end,
        delivery_window_label: window.label,
        delivery_window_timezone: 'America/Chicago',
      },
    });
  } catch (error) {
    console.error('[assignProductionWindow] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
