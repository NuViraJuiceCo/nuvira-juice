/**
 * Calculate 4 fulfillments for a monthly subscription cycle.
 * Returns scheduled_date, production_date, products for each fulfillment_number 1-4.
 */

export function calculateMonthlyFulfillments(startedDate, planName) {
  const fulfillments = [];
  const start = new Date(startedDate + 'T00:00:00');
  
  // NuVira delivery logic: typically weekly deliveries on the same day
  // Production is 2 days before delivery
  // Example: if started May 9 (Friday), deliveries are every 7 days starting May 9
  
  const baseDeliveryDayOfWeek = start.getDay(); // 0=Sun, 5=Fri
  
  // Determine product composition per fulfillment
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
    // Default: single item per fulfillment
    productsPerFulfillment = [
      { product_name: 'Aura', quantity: 1 },
      { product_name: 'Oasis', quantity: 1 },
      { product_name: 'Re-Nu', quantity: 1 },
    ];
  }
  
  const itemsSummary = productsPerFulfillment
    .map(p => `${p.quantity}x ${p.product_name}`)
    .join(', ');
  
  // Generate 4 fulfillments: week 1, 2, 3, 4
  for (let week = 0; week < 4; week++) {
    const deliveryDate = new Date(start);
    deliveryDate.setDate(deliveryDate.getDate() + (week * 7));
    
    // Production date: 2 days before delivery (assuming Tue/Wed/Thu production)
    const productionDate = new Date(deliveryDate);
    productionDate.setDate(productionDate.getDate() - 2);
    
    // Format as YYYY-MM-DD
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

export function formatFulfillmentsPayload(subscription, plan) {
  const fulfillments = calculateMonthlyFulfillments(subscription.started_date, plan?.name);
  
  // Calculate billing period: started_date to next_delivery_date (approx 30 days for monthly)
  const billingStart = subscription.started_date;
  const billingEnd = subscription.next_delivery_date || 
    new Date(new Date(billingStart).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  return {
    customer_app_subscription_id: subscription.id,
    stripe_subscription_id: subscription.stripe_subscription_id,
    stripe_customer_id: subscription.stripe_customer_id || null,
    payment_status: 'paid',
    financial_status: 'paid',
    plan_name: plan?.name || 'Unknown',
    cycle_number: 1, // First cycle
    billing_period_start: billingStart,
    billing_period_end: billingEnd,
    fulfillments,
  };
}