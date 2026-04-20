import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

/**
 * Public endpoint for hub to fetch orders for driver portal sync.
 * Bypasses RLS using service-role to allow hub authentication via Bearer token.
 * Payload: { date?: "YYYY-MM-DD" }
 */
Deno.serve(async (req) => {
  try {
    // Validate Bearer token
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    
    if (!token || token !== CUSTOMER_APP_SYNC_SECRET) {
      console.error('getOrdersForSync: invalid or missing token');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { date } = body;

    // Fetch orders for the specified date (or all orders if no date)
    const base44 = createClientFromRequest(req);
    let query = {};
    
    if (date) {
      const startOfDay = new Date(date);
      const endOfDay = new Date(date);
      endOfDay.setDate(endOfDay.getDate() + 1);
      
      query = {
        estimated_delivery_date: { $gte: date, $lte: date },
        status: { $nin: ['delivered', 'picked_up'] },
      };
    }

    // Use service-role to bypass RLS
    const orders = await base44.asServiceRole.entities.Order.filter(query, '-created_date');

    console.log(`getOrdersForSync: returning ${orders.length} orders for ${date || 'all dates'}`);

    return Response.json({
      success: true,
      orders,
      count: orders.length,
      synced_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('getOrdersForSync error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});