import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Audit complete subscription payload that would be sent to Hub.
 * Verifies all required fields are present for correct Hub display.
 * Admin-only diagnostic.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const {
      subscription_id = '69fe3e960cba907fa6488355',
      customer_email = 'amark@nuvisionarymedia.com',
    } = await req.json();

    console.log(`[auditPayload] Auditing subscription ${subscription_id} for ${customer_email}`);

    // Fetch subscription
    const subs = await base44.asServiceRole.entities.Subscription.filter({
      id: subscription_id,
      customer_email: customer_email,
    });

    if (subs.length === 0) {
      return Response.json({ error: `Subscription ${subscription_id} not found` }, { status: 404 });
    }

    const subscription = subs[0];
    console.log(`[auditPayload] Found subscription, stripe_sub=${subscription.stripe_subscription_id}`);

    // Fetch plan with pricing
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({
      id: subscription.plan_id,
    });
    const plan = plans[0];
    console.log(`[auditPayload] Plan: ${plan?.name}, base_price=$${plan?.base_price}`);

    // Fetch user profile for delivery details
    const profiles = await base44.asServiceRole.entities.UserProfile.filter({
      customer_email: customer_email,
    });
    const profile = profiles[0] || {};
    console.log(`[auditPayload] Profile: ${profile.first_name} ${profile.last_name}`);

    // Calculate fulfillments
    const fulfillments = calculateMonthlyFulfillments(subscription.started_date, plan?.name);
    console.log(`[auditPayload] Calculated ${fulfillments.length} fulfillments`);

    // Build complete payload
    const billingStart = subscription.started_date;
    const billingEnd = subscription.next_delivery_date || 
      new Date(new Date(billingStart).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const fullPayload = {
      event: 'customer.subscription_created',
      source: 'customer_app',
      customer_email: customer_email,
      data: {
        // Identification
        customer_app_subscription_id: subscription.id,
        stripe_subscription_id: subscription.stripe_subscription_id,
        stripe_customer_id: subscription.stripe_customer_id || null,

        // Customer info
        customer_name: profile.first_name && profile.last_name 
          ? `${profile.first_name} ${profile.last_name}` 
          : customer_email,
        customer_email: customer_email,
        phone: profile.phone || null,

        // Delivery address
        delivery_address: subscription.delivery_address || null,
        address_line1: profile.address ? profile.address.split(',')[0] : null,
        address_line2: null,
        address_city: null,
        address_state: null,
        address_postal_code: null,
        address_country: 'US',

        // Plan and pricing
        plan_name: plan?.name || 'Unknown',
        plan_id: plan?.id || null,
        subscription_price: plan?.base_price || 0,
        monthly_price: plan?.frequency === 'monthly' ? plan?.base_price : null,
        amount_paid: plan?.base_price || 0, // Stripe amount in dollars
        discount_percent: plan?.discount_percent || 0,

        // Payment and financial status
        payment_status: 'paid',
        financial_status: 'paid',

        // Cycle info
        cycle_number: 1,
        billing_cadence: plan?.frequency || 'monthly',
        fulfillment_cadence: 'weekly',
        fulfillments_per_cycle: fulfillments.length,
        billing_period_start: billingStart,
        billing_period_end: billingEnd,

        // Fulfillments (the key array)
        fulfillments: fulfillments,
      },
      synced_at: new Date().toISOString(),
    };

    // Check for missing fields
    const requiredFields = [
      'customer_name',
      'customer_email',
      'phone',
      'delivery_address',
      'address_line1',
      'address_city',
      'address_state',
      'address_postal_code',
      'address_country',
      'plan_name',
      'subscription_price',
      'amount_paid',
      'stripe_subscription_id',
      'customer_app_subscription_id',
      'payment_status',
      'financial_status',
      'cycle_number',
      'billing_period_start',
      'billing_period_end',
      'fulfillments',
    ];

    const dataObj = fullPayload.data;
    const missingFields = [];
    const nullFields = [];

    requiredFields.forEach(field => {
      if (!(field in dataObj)) {
        missingFields.push(field);
      } else if (dataObj[field] === null) {
        nullFields.push(field);
      }
    });

    console.log(`[auditPayload] Missing fields: ${missingFields.length > 0 ? missingFields.join(', ') : 'None'}`);
    console.log(`[auditPayload] Null/empty fields: ${nullFields.length > 0 ? nullFields.join(', ') : 'None'}`);

    // Sanitized payload for display
    const sanitizedPayload = JSON.parse(JSON.stringify(fullPayload));
    if (sanitizedPayload.data.phone) sanitizedPayload.data.phone = '[PHONE]';

    console.log('[auditPayload] ====== PAYLOAD STRUCTURE ======');
    console.log(JSON.stringify(sanitizedPayload, null, 2));

    return Response.json({
      subscription_id: subscription.id,
      customer_email: customer_email,
      stripe_subscription_id: subscription.stripe_subscription_id,
      plan_name: plan?.name,

      payload_summary: {
        event: fullPayload.event,
        source: fullPayload.source,
        has_data: !!fullPayload.data,
        data_keys: Object.keys(fullPayload.data),
      },

      field_validation: {
        total_required_fields: requiredFields.length,
        missing_fields: missingFields,
        null_or_empty_fields: nullFields,
        all_present: missingFields.length === 0,
        all_populated: missingFields.length === 0 && nullFields.length === 0,
      },

      fulfillments_check: {
        count: fulfillments.length,
        first_fulfillment: fulfillments[0] ? {
          fulfillment_number: fulfillments[0].fulfillment_number,
          scheduled_date: fulfillments[0].scheduled_date,
          production_date: fulfillments[0].production_date,
          products_count: fulfillments[0].products?.length || 0,
          items_summary: fulfillments[0].items_summary,
        } : null,
        dates_are_weekly: checkWeeklySpacing(fulfillments),
      },

      critical_fields: {
        customer_name: dataObj.customer_name || '[MISSING]',
        customer_email: dataObj.customer_email,
        phone: dataObj.phone ? '[SET]' : '[MISSING]',
        delivery_address: dataObj.delivery_address || '[MISSING]',
        address_line1: dataObj.address_line1 || '[MISSING]',
        address_city: dataObj.address_city || '[MISSING]',
        plan_name: dataObj.plan_name,
        amount_paid: dataObj.amount_paid,
        payment_status: dataObj.payment_status,
        fulfillments_array: `${fulfillments.length} items`,
      },

      sanitized_payload: sanitizedPayload,

      recommendations: generateRecommendations(missingFields, nullFields, dataObj),
    });

  } catch (error) {
    console.error('[auditPayload] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function calculateMonthlyFulfillments(startedDate, planName) {
  const fulfillments = [];
  const start = new Date(startedDate + 'T00:00:00');
  
  let productsPerFulfillment = [];
  if (planName === 'Monthly Ritual') {
    productsPerFulfillment = [
      { product_name: 'Aura', quantity: 1 },
      { product_name: 'Oasis', quantity: 1 },
      { product_name: 'Re-Nu', quantity: 1 },
    ];
  } else if (planName === 'VIP Wellness') {
    productsPerFulfillment = [
      { product_name: 'Aura', quantity: 2 },
      { product_name: 'Oasis', quantity: 2 },
      { product_name: 'Re-Nu', quantity: 2 },
    ];
  } else {
    productsPerFulfillment = [
      { product_name: 'Aura', quantity: 1 },
      { product_name: 'Oasis', quantity: 1 },
      { product_name: 'Re-Nu', quantity: 1 },
    ];
  }
  
  const itemsSummary = productsPerFulfillment
    .map(p => `${p.quantity}x ${p.product_name}`)
    .join(', ');
  
  for (let week = 0; week < 4; week++) {
    const deliveryDate = new Date(start);
    deliveryDate.setDate(deliveryDate.getDate() + (week * 7));
    
    const productionDate = new Date(deliveryDate);
    productionDate.setDate(productionDate.getDate() - 2);
    
    const scheduledDateStr = deliveryDate.toISOString().split('T')[0];
    const productionDateStr = productionDate.toISOString().split('T')[0];
    
    fulfillments.push({
      fulfillment_number: week + 1,
      scheduled_date: scheduledDateStr,
      production_date: productionDateStr,
      delivery_window_label: '5 PM – 8 PM',
      delivery_window_start: '17:00',
      delivery_window_end: '20:00',
      products: productsPerFulfillment,
      items_summary: itemsSummary,
    });
  }
  
  return fulfillments;
}

function checkWeeklySpacing(fulfillments) {
  if (fulfillments.length < 2) return true;
  
  for (let i = 1; i < fulfillments.length; i++) {
    const prev = new Date(fulfillments[i - 1].scheduled_date);
    const curr = new Date(fulfillments[i].scheduled_date);
    const diffDays = (curr - prev) / (1000 * 60 * 60 * 24);
    if (diffDays !== 7) return false;
  }
  
  return true;
}

function generateRecommendations(missingFields, nullFields, dataObj) {
  const recs = [];

  if (missingFields.includes('customer_name')) {
    recs.push('⚠️ customer_name missing — Hub cannot display subscriber name');
  }
  if (missingFields.includes('phone')) {
    recs.push('⚠️ phone missing — delivery driver may lack contact info');
  }
  if (missingFields.includes('delivery_address')) {
    recs.push('❌ CRITICAL: delivery_address missing — Hub cannot schedule fulfillment');
  }
  if (nullFields.includes('address_line1')) {
    recs.push('⚠️ address_line1 null/empty — address incomplete for Hub display');
  }
  if (nullFields.includes('address_city')) {
    recs.push('⚠️ address_city null/empty — cannot verify delivery zone');
  }
  if (missingFields.includes('amount_paid')) {
    recs.push('❌ CRITICAL: amount_paid missing — Hub will show $0.00');
  }
  if (!dataObj.subscription_price) {
    recs.push('⚠️ subscription_price is $0 — check plan pricing');
  }

  if (recs.length === 0) {
    recs.push('✅ All critical fields present');
  }

  return recs;
}