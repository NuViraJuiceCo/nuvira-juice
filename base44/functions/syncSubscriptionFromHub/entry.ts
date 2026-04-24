import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin function: Fetch a subscription from the hub and create local orders
 * Payload: { customer_email: string }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { customer_email } = await req.json();
    if (!customer_email) {
      return Response.json({ error: 'customer_email required' }, { status: 400 });
    }

    const hubUrl = Deno.env.get('HUB_API_URL');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    if (!hubUrl || !hubSecret) {
      return Response.json({ error: 'Hub not configured' }, { status: 400 });
    }

    // Fetch subscription data from hub
    const response = await fetch(`${hubUrl}/subscriptions?email=${encodeURIComponent(customer_email)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${hubSecret}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Hub fetch failed: ${response.status} ${errText}`);
      return Response.json({
        error: 'Failed to fetch from hub',
        status: response.status,
      }, { status: response.status });
    }

    const hubData = await response.json();
    const hubSub = hubData.subscription || hubData[0];

    if (!hubSub) {
      console.log(`No subscription found on hub for ${customer_email}`);
      return Response.json({ error: 'Subscription not found on hub', customer_email }, { status: 404 });
    }

    // Create/update local subscription record
    const existing = await base44.asServiceRole.entities.Subscription.filter({ customer_email });
    let subscription;

    if (existing.length > 0) {
      // Update existing
      subscription = existing[0];
    } else {
      // Create new subscription record from hub data
      subscription = await base44.asServiceRole.entities.Subscription.create({
        customer_email: hubSub.customer_email || customer_email,
        plan_id: hubSub.plan_id || '',
        bundle_id: hubSub.bundle_id || '',
        delivery_zone_id: hubSub.delivery_zone_id || '',
        delivery_address: hubSub.delivery_address || '',
        status: hubSub.status || 'active',
        started_date: hubSub.started_date,
        next_delivery_date: hubSub.next_delivery_date,
      });
      console.log(`Created subscription record from hub: ${subscription.id}`);
    }

    // Generate orders if needed
    const existingOrders = await base44.asServiceRole.entities.Order.filter({ customer_email });
    if (existingOrders.length === 0) {
      // Invoke order generation
      await base44.asServiceRole.functions.invoke('generateSubscriptionOrders', {
        subscription_id: subscription.id,
      });
      console.log(`Generated orders for subscription ${subscription.id}`);
    }

    return Response.json({
      success: true,
      message: 'Subscription synced from hub',
      customer_email,
      subscription_id: subscription.id,
    });
  } catch (error) {
    console.error('Sync subscription from hub error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});