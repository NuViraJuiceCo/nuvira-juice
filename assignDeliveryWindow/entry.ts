import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * DELIVERY WINDOW ASSIGNER
 * 
 * Applies delivery time windows based on assigned_delivery_day.
 * Production schedule determines the delivery DATE.
 * This function determines the delivery TIME RANGE.
 * 
 * Rules:
 * - Wednesday deliveries: 5:00 PM - 8:00 PM America/Chicago
 * - Saturday deliveries: 5:00 PM - 8:00 PM America/Chicago
 * - Sunday deliveries (threshold-dependent): No official window yet (manual/exception)
 * 
 * Does NOT:
 * - Change production batch assignment
 * - Make orders ready_for_driver
 * - Alter payment or product data
 */

const DELIVERY_WINDOWS = {
  'Wednesday': {
    start: '17:00',
    end: '20:00',
    label: '5:00 PM - 8:00 PM',
    timezone: 'America/Chicago',
  },
  'Saturday': {
    start: '17:00',
    end: '20:00',
    label: '5:00 PM - 8:00 PM',
    timezone: 'America/Chicago',
  },
  'Sunday': {
    // No official window for Sunday yet (threshold-dependent exception)
    start: null,
    end: null,
    label: 'Manual scheduling',
    timezone: 'America/Chicago',
  },
};

Deno.serve(async (req) => {
  try {
    const { assigned_delivery_day } = await req.json();

    if (!assigned_delivery_day) {
      return Response.json({ error: 'assigned_delivery_day required' }, { status: 400 });
    }

    const window = DELIVERY_WINDOWS[assigned_delivery_day];
    if (!window) {
      return Response.json({ 
        error: `Unknown delivery day: ${assigned_delivery_day}`,
        valid_days: Object.keys(DELIVERY_WINDOWS),
      }, { status: 400 });
    }

    const payload = {
      success: true,
      assigned_delivery_day,
      assigned_delivery_window_start: window.start,
      assigned_delivery_window_end: window.end,
      delivery_window_label: window.label,
      delivery_window_timezone: window.timezone,
    };

    return Response.json(payload);
  } catch (error) {
    console.error('[assignDeliveryWindow] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});