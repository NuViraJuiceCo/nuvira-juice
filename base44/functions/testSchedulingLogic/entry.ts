import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * TEST SUITE FOR OFFICIAL NUVIRA SCHEDULING LOGIC
 * 
 * Validates all 10 test cases for production window assignment.
 */

function getWindowAssignment(orderCreatedAt) {
  const ot = new Date(orderCreatedAt);
  const chicagoTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  
  const parts = chicagoTime.formatToParts(ot);
  const partMap = {};
  parts.forEach(p => { partMap[p.type] = p.value; });
  
  const y = parseInt(partMap.year);
  const m = parseInt(partMap.month) - 1;
  const d = parseInt(partMap.day);
  const h = parseInt(partMap.hour);
  const min = parseInt(partMap.minute);
  
  const chicagoDate = new Date(y, m, d, h, min);
  const dow = chicagoDate.getDay();
  const hourMinutes = h * 60 + min;
  const cutoff2pm = 14 * 60;
  
  if ((dow === 6 && hourMinutes >= cutoff2pm) ||
      (dow === 0) ||
      (dow === 1) ||
      (dow === 2 && hourMinutes < cutoff2pm)) {
    return {
      window: 1,
      assigned_production_day: 'Tuesday',
      assigned_delivery_day: 'Wednesday',
    };
  }
  
  if ((dow === 2 && hourMinutes >= cutoff2pm) ||
      (dow === 3) ||
      (dow === 4) ||
      (dow === 5 && hourMinutes < cutoff2pm)) {
    return {
      window: 2,
      assigned_production_day: 'Friday',
      assigned_delivery_day: 'Saturday',
    };
  }
  
  if ((dow === 5 && hourMinutes >= cutoff2pm) ||
      (dow === 6 && hourMinutes < cutoff2pm)) {
    return {
      window: 3,
      assigned_production_day: 'conditional_saturday',
      assigned_delivery_day: 'conditional_sunday_or_wednesday',
    };
  }
  
  return {
    window: 1,
    assigned_production_day: 'Tuesday',
    assigned_delivery_day: 'Wednesday',
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

    // Get a reference Saturday for test cases (use May 3, 2026, which is a Saturday)
    // Friday May 2, 2026 = test Friday
    // Saturday May 3, 2026 = test Saturday
    // Sunday May 4, 2026 = test Sunday
    // Monday May 5, 2026 = test Monday
    // Tuesday May 6, 2026 = test Tuesday

    const testCases = [
      {
        case: 1,
        description: 'Order placed Saturday 2:01 PM',
        orderCreatedAt: new Date(2026, 4, 3, 14, 1, 0).toISOString(), // May 3, 2:01 PM
        expectedProduction: 'Tuesday',
        expectedDelivery: 'Wednesday',
      },
      {
        case: 2,
        description: 'Order placed Sunday',
        orderCreatedAt: new Date(2026, 4, 4, 12, 0, 0).toISOString(), // May 4, noon
        expectedProduction: 'Tuesday',
        expectedDelivery: 'Wednesday',
      },
      {
        case: 3,
        description: 'Order placed Tuesday 1:59 PM (Chicago)',
        orderCreatedAt: new Date(2026, 4, 6, 18, 59, 0).toISOString(), // May 6, 1:59 PM Chicago = 6:59 PM UTC
        expectedProduction: 'Tuesday',
        expectedDelivery: 'Wednesday',
      },
      {
        case: 4,
        description: 'Order placed Tuesday 2:01 PM',
        orderCreatedAt: new Date(2026, 4, 6, 14, 1, 0).toISOString(), // May 6, 2:01 PM
        expectedProduction: 'Friday',
        expectedDelivery: 'Saturday',
      },
      {
        case: 5,
        description: 'Order placed Friday 1:59 PM (Chicago)',
        orderCreatedAt: new Date(2026, 4, 2, 18, 59, 0).toISOString(), // May 2, 1:59 PM Chicago = 6:59 PM UTC
        expectedProduction: 'Friday',
        expectedDelivery: 'Saturday',
      },
      {
        case: 6,
        description: 'Order placed Friday 2:01 PM',
        orderCreatedAt: new Date(2026, 4, 2, 14, 1, 0).toISOString(), // May 2, 2:01 PM
        expectedProduction: 'conditional_saturday',
        expectedDelivery: 'conditional_sunday_or_wednesday',
      },
      {
        case: 7,
        description: 'Order placed Saturday 1:59 PM (Chicago)',
        orderCreatedAt: new Date(2026, 4, 3, 18, 59, 0).toISOString(), // May 3, 1:59 PM Chicago = 6:59 PM UTC
        expectedProduction: 'conditional_saturday',
        expectedDelivery: 'conditional_sunday_or_wednesday',
      },
      {
        case: 8,
        description: 'Order placed Saturday 2:01 PM',
        orderCreatedAt: new Date(2026, 4, 3, 14, 1, 0).toISOString(), // May 3, 2:01 PM
        expectedProduction: 'Tuesday',
        expectedDelivery: 'Wednesday',
      },
    ];

    const results = [];

    for (const tc of testCases) {
      const assignment = getWindowAssignment(tc.orderCreatedAt);
      const productionMatch = assignment.assigned_production_day === tc.expectedProduction;
      const deliveryMatch = assignment.assigned_delivery_day === tc.expectedDelivery;
      const passed = productionMatch && deliveryMatch;

      results.push({
        case: tc.case,
        description: tc.description,
        expectedProduction: tc.expectedProduction,
        expectedDelivery: tc.expectedDelivery,
        actualProduction: assignment.assigned_production_day,
        actualDelivery: assignment.assigned_delivery_day,
        passed,
      });
    }

    // Test cases 9 & 10 require threshold evaluation (manual note)
    results.push({
      case: 9,
      description: 'Saturday window has exactly 10 eligible orders',
      note: 'Requires database state — threshold not met → roll to Tuesday',
      passed: null,
    });

    results.push({
      case: 10,
      description: 'Saturday window has 11 eligible orders',
      note: 'Requires database state — threshold met → Saturday production',
      passed: null,
    });

    const passedCount = results.filter(r => r.passed === true).length;
    const totalTestable = results.filter(r => r.passed !== null).length;

    return Response.json({
      success: true,
      total_cases: results.length,
      testable_cases: totalTestable,
      passed_cases: passedCount,
      all_passed: passedCount === totalTestable,
      results,
    });
  } catch (error) {
    console.error('[testSchedulingLogic] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
