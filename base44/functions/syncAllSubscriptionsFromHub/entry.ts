import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin function: Sync all subscriptions from hub
 * Pulls subscriptions and orders for all customers, creates/updates locally
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.warn('⚠️ AUDIT: Admin invoked syncAllSubscriptionsFromHub — This is a BULK operation that rebuilds all subscription/order data and may overwrite Hub records');

    const hubBase = Deno.env.get('HUB_API_URL');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    
    if (!hubBase || !hubSecret) {
      return Response.json({ error: 'Hub not configured' }, { status: 400 });
    }

    // Call hub to fetch all subscriptions
    const hubUrl = `${hubBase.replace(/\/$/, '')}/functions/getAllSubscriptions`;
    console.log('[Sync All] Fetching all subscriptions from hub');

    const hubResponse = await fetch(hubUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hubSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!hubResponse.ok) {
      const errText = await hubResponse.text();
      console.error(`[Sync All] Hub fetch failed: ${hubResponse.status} ${errText}`);
      return Response.json({
        error: 'Failed to fetch subscriptions from hub',
        status: hubResponse.status,
      }, { status: hubResponse.status });
    }

    const hubData = await hubResponse.json();
    const hubSubscriptions = hubData.subscriptions || [];

    console.log(`[Sync All] Received ${hubSubscriptions.length} subscriptions from hub`);

    let subscriptionsCreated = 0;
    let subscriptionsUpdated = 0;
    let ordersCreated = 0;
    const errors = [];

    // Process each subscription
    for (const hubSub of hubSubscriptions) {
      try {
        const existing = await base44.asServiceRole.entities.Subscription.filter({
          customer_email: hubSub.customer_email,
          plan_id: hubSub.plan_id,
        });

        let subscription;
        if (existing.length === 0) {
          subscription = await base44.asServiceRole.entities.Subscription.create({
            customer_email: hubSub.customer_email,
            plan_id: hubSub.plan_id,
            bundle_id: hubSub.bundle_id || null,
            delivery_address: hubSub.delivery_address,
            delivery_zone_id: hubSub.delivery_zone_id || '',
            status: hubSub.status || 'active',
            started_date: hubSub.started_date || new Date().toISOString().split('T')[0],
            next_delivery_date: hubSub.next_delivery_date || new Date().toISOString().split('T')[0],
            paused_until: hubSub.paused_until || null,
          });
          subscriptionsCreated++;
          console.log(`[Sync All] Created subscription ${subscription.id} for ${hubSub.customer_email}`);
        } else {
          subscription = existing[0];
          await base44.asServiceRole.entities.Subscription.update(subscription.id, {
            status: hubSub.status || 'active',
            next_delivery_date: hubSub.next_delivery_date,
          });
          subscriptionsUpdated++;
          console.log(`[Sync All] Updated subscription ${subscription.id}`);
        }

        // Create orders for this subscription
        if (hubSub.orders && hubSub.orders.length > 0) {
          for (const hubOrder of hubSub.orders) {
            const existingOrder = await base44.asServiceRole.entities.Order.filter({
              order_number: hubOrder.order_number,
            });

            if (existingOrder.length === 0) {
              await base44.asServiceRole.entities.Order.create({
                order_number: hubOrder.order_number,
                customer_email: hubOrder.customer_email,
                items: hubOrder.items || [],
                subtotal: hubOrder.subtotal || 0,
                delivery_fee: hubOrder.delivery_fee || 0,
                total: hubOrder.total || 0,
                fulfillment_type: hubOrder.fulfillment_type || 'delivery',
                delivery_address: hubOrder.delivery_address,
                contact_phone: hubOrder.contact_phone || '',
                estimated_delivery_date: hubOrder.estimated_delivery_date,
                status: hubOrder.status || 'scheduled_for_juicing',
                status_history: [{
                  status: hubOrder.status || 'scheduled_for_juicing',
                  timestamp: new Date().toISOString(),
                  message: 'Subscription order synced from hub',
                }],
              });
              ordersCreated++;
            }
          }
        }
      } catch (err) {
        const msg = `Failed to sync subscription for ${hubSub.customer_email}: ${err.message}`;
        errors.push(msg);
        console.error(`[Sync All] ${msg}`);
      }
    }

    return Response.json({
      success: true,
      subscriptions_from_hub: hubSubscriptions.length,
      subscriptions_created: subscriptionsCreated,
      subscriptions_updated: subscriptionsUpdated,
      orders_created: ordersCreated,
      errors: errors.length > 0 ? errors : null,
    });
  } catch (error) {
    console.error('[Sync All] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});