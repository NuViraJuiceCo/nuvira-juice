import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Fetch customer orders from both local Customer App and Hub.
 * Merges results, deduplicates by order_number, returns all tied to customer email.
 * Payload: { customer_email: string }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { customer_email } = await req.json();

    if (!customer_email) {
      return Response.json({ error: 'customer_email required' }, { status: 400 });
    }

    // 1. Fetch local Customer App orders
    const localOrders = await base44.asServiceRole.entities.Order.filter(
      { customer_email },
      '-created_date',
      50
    );

    // 2. Fetch Hub orders via existing sync endpoint
    const hubApiUrl = Deno.env.get('HUB_API_URL');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

    let hubOrders = [];
    if (hubApiUrl && hubSecret) {
      try {
        const hubUrl = `${hubApiUrl.replace(/\/$/, '')}/functions/getCustomerOrders`;
        const hubResponse = await fetch(hubUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hubSecret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ customer_email }),
        });

        if (hubResponse.ok) {
          const hubData = await hubResponse.json();
          hubOrders = hubData.orders || [];
          console.log(`[Fetch Orders] Hub returned ${hubOrders.length} orders for ${customer_email}`);
        } else {
          console.warn(`[Fetch Orders] Hub call failed: ${hubResponse.status}`);
        }
      } catch (hubErr) {
        console.warn(`[Fetch Orders] Hub fetch error: ${hubErr.message}`);
      }
    }

    // 3. Merge: deduplicate by order_number, prefer local if both exist
    const mergedMap = new Map();
    
    // Add Hub orders first (so local overwrites if dups)
    for (const order of hubOrders) {
      if (order.order_number) {
        mergedMap.set(order.order_number, order);
      }
    }

    // Overwrite with local orders (they are source of truth for this app)
    for (const order of localOrders) {
      if (order.order_number) {
        mergedMap.set(order.order_number, order);
      }
    }

    const mergedOrders = Array.from(mergedMap.values()).sort((a, b) => {
      const aDate = new Date(a.created_date || a.createdAt || 0);
      const bDate = new Date(b.created_date || b.createdAt || 0);
      return bDate - aDate; // Newest first
    });

    console.log(`[Fetch Orders] Merged ${mergedOrders.length} unique orders for ${customer_email}`);

    return Response.json({
      success: true,
      customer_email,
      local_count: localOrders.length,
      hub_count: hubOrders.length,
      merged_count: mergedOrders.length,
      orders: mergedOrders,
    });
  } catch (error) {
    console.error('[Fetch Orders] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});