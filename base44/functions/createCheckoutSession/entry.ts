import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

/**
 * Calculate next delivery date using NuVira's exact rules.
 * Timezone: America/Chicago
 * Cutoff: 2 PM. Orders after cutoff shift forward one extra day.
 *
 * Sun → Wed (+3)
 * Mon → Wed (+2)
 * Tue before 2pm → Wed (+1), after 2pm → Sat (+4)
 * Wed → Sat (+3)
 * Thu → Sat (+2)
 * Fri before 2pm → Sat (+1), after 2pm → Sun (+2)
 * Sat → Sun (+1)
 */
function calculateDeliveryDate(orderTime = new Date()) {
  const chicagoFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = chicagoFormatter.formatToParts(orderTime);
  const partMap = {};
  parts.forEach(part => { partMap[part.type] = part.value; });

  const chicagoYear  = parseInt(partMap.year);
  const chicagoMonth = parseInt(partMap.month) - 1;
  const chicagoDay   = parseInt(partMap.day);
  const chicagoHour  = parseInt(partMap.hour);

  const chicagoDate = new Date(chicagoYear, chicagoMonth, chicagoDay, chicagoHour, 0);
  const dayOfWeek   = chicagoDate.getDay();
  const cutoffHour  = 14; // 2 PM

  let daysToAdd = 0;
  if      (dayOfWeek === 0) daysToAdd = 3;
  else if (dayOfWeek === 1) daysToAdd = 2;
  else if (dayOfWeek === 2) daysToAdd = chicagoHour < cutoffHour ? 1 : 4;
  else if (dayOfWeek === 3) daysToAdd = 3;
  else if (dayOfWeek === 4) daysToAdd = 2;
  else if (dayOfWeek === 5) daysToAdd = chicagoHour < cutoffHour ? 1 : 2;
  else if (dayOfWeek === 6) daysToAdd = 1;

  const deliveryDate = new Date(chicagoDate);
  deliveryDate.setDate(deliveryDate.getDate() + daysToAdd);
  return deliveryDate.toISOString().split('T')[0];
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const {
      items, subtotal, delivery_fee, total,
      fulfillment_type, delivery_address, contact_phone, estimated_delivery_date,
      customer_email, customer_name: checkoutCustomerName,
      address_line1, address_line2, address_city, address_state, address_postal_code,
      points_discount, points_used,
      active_reward, reward_discount, credits_discount,
      referral_discount, referral_code,
    } = await req.json();

    // Resolve customer_name from best available source: UserProfile > checkout > fallback
    let customer_name = checkoutCustomerName?.trim() || '';
    
    if (!customer_name && customer_email) {
      // Try to fetch UserProfile and extract proper name
      try {
        const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email });
        if (profiles[0]) {
          const { first_name, last_name } = profiles[0];
          if (first_name && last_name) {
            customer_name = `${first_name} ${last_name}`;
            console.log(`[Checkout] Resolved name from UserProfile: ${customer_name}`);
          } else if (first_name) {
            customer_name = first_name;
            console.log(`[Checkout] Resolved name from UserProfile (first only): ${customer_name}`);
          }
        }
      } catch (err) {
        console.warn(`[Checkout] Failed to fetch UserProfile for ${customer_email}: ${err.message}`);
      }
    }

    // CRITICAL: Block checkout if customer_name is still missing
    if (!customer_name || !customer_name.trim()) {
      console.error(`❌ CHECKOUT BLOCKED: customer_name is missing. Email: ${customer_email}`);
      return Response.json(
        { error: 'Customer name is required. Please complete your profile before placing an order.' },
        { status: 400 }
      );
    }

    console.log(`[Checkout] Starting for customer: ${customer_email}, name: ${customer_name}, order_type: one_time`);

    // --- Subscription perks: look up active subscription for this customer ---
    let subFreeDelivery = false;
    let subDiscountPct  = 0;
    if (customer_email) {
      const subs = await base44.asServiceRole.entities.Subscription.filter({ customer_email, status: 'active' });
      if (subs.length > 0) {
        const allPlans = await base44.asServiceRole.entities.SubscriptionPlan.list();
        const plan = allPlans.find(p => p.id === subs[0].plan_id);
        if (plan && plan.discount_percent > 0) {
          subDiscountPct  = plan.discount_percent;
          subFreeDelivery = true;
          console.log(`Subscription perks for ${customer_email}: plan=${plan.name}, freeDelivery=true, discount=${subDiscountPct}%`);
        }
      }
    }

    // Apply subscription perks
    const effectiveDeliveryFee = subFreeDelivery ? 0 : (delivery_fee || 0);
    const subDiscountAmt       = subDiscountPct > 0 ? Math.round(subtotal * subDiscountPct) / 100 : 0;
    const effectiveTotal       = Math.max(0, total - (delivery_fee - effectiveDeliveryFee) - subDiscountAmt);

    const orderNumber = `NV-${Date.now().toString(36).toUpperCase()}`;

    // Build Stripe line items
    const lineItems = items
      .filter(item => item.product_id !== '__birthday_reward__' && item.price > 0)
      .map(item => ({
        price_data: {
          currency: 'usd',
          product_data: {
            name: item.title,
            ...(item.image_url ? { images: [item.image_url] } : {}),
          },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity,
      }));

    if (effectiveDeliveryFee > 0) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: 'Delivery Fee' },
          unit_amount: Math.round(effectiveDeliveryFee * 100),
        },
        quantity: 1,
      });
    }

    const origin = req.headers.get('origin') || 'https://app.base44.com';

    // Build discounts coupon
    let discounts = [];
    const totalDiscountCents =
      Math.round((points_discount  || 0) * 100) +
      Math.round((reward_discount  || 0) * 100) +
      Math.round((credits_discount || 0) * 100) +
      Math.round((referral_discount|| 0) * 100) +
      Math.round(subDiscountAmt         * 100);

    if (totalDiscountCents > 0) {
      const discountParts = [];
      if (points_used)           discountParts.push(`${points_used} Loyalty Points`);
      if (active_reward?.title)  discountParts.push(active_reward.title);
      if (credits_discount > 0)  discountParts.push('NuVira Credits');
      if (referral_discount > 0) discountParts.push(`Referral Code ${referral_code || 'NuVira26'}`);
      if (subDiscountAmt > 0)    discountParts.push(`Subscriber ${subDiscountPct}% Discount`);

      const coupon = await stripe.coupons.create({
        amount_off: totalDiscountCents,
        currency:   'usd',
        duration:   'once',
        name:       discountParts.join(' + ') || 'Discount',
      });
      discounts = [{ coupon: coupon.id }];
    }

    // Delivery date: always use the backend calculation as source of truth
    const deliveryDate = calculateDeliveryDate();

    // Stripe metadata — clean, no preorder fields
    const sessionMetadata = {
      base44_app_id:          Deno.env.get('BASE44_APP_ID'),
      source_app:             'customer_app',
      checkout_version:       '2.0',
      order_number:           orderNumber,
      order_type:             'one_time',
      fulfillment_mode:       'single_delivery',
      is_preorder:            'false',
      customer_email:         customer_email || '',
      customer_name:          customer_name  || '',
      customer_phone:         contact_phone  || '',
      delivery_method:        fulfillment_type || 'delivery',
      delivery_address_line1: address_line1  || '',
      delivery_address_line2: address_line2  || '',
      delivery_city:          address_city   || '',
      delivery_state:         address_state  || '',
      delivery_postal_code:   address_postal_code || '',
      requested_delivery_date: deliveryDate,
    };

    // Store checkout data for webhook recovery (expires 24h)
    const checkoutData = {
      order_number:           orderNumber,
      customer_email:         customer_email || '',
      customer_name:          customer_name  || '',
      address_line1:          address_line1  || '',
      address_line2:          address_line2  || '',
      address_city:           address_city   || '',
      address_state:          address_state  || '',
      address_postal_code:    address_postal_code || '',
      address_country:        'US',
      items: items.map(i => ({
        product_id: i.product_id,
        title:      i.title,
        price:      i.price,
        quantity:   i.quantity,
        image_url:  i.image_url,
      })),
      subtotal,
      delivery_fee:              effectiveDeliveryFee,
      total:                     effectiveTotal,
      fulfillment_type:          fulfillment_type || 'delivery',
      delivery_address:          delivery_address || '',
      contact_phone:             contact_phone    || '',
      estimated_delivery_date:   deliveryDate,
      is_preorder:               false,
      referral_code:  (referral_discount > 0 && referral_code) ? referral_code.toUpperCase() : null,
      points_used:    points_used    || 0,
      points_discount:points_discount|| 0,
      active_reward:  active_reward  || null,
      reward_discount:reward_discount|| 0,
      credits_discount:credits_discount || 0,
    };

    console.log(`[Metadata] customer_name="${customer_name}", delivery_date="${deliveryDate}"`);

    // All new orders: immediate payment capture
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items:           lineItems,
      mode:                 'payment',
      client_reference_id:  orderNumber,
      payment_intent_data:  { metadata: sessionMetadata },
      success_url: `${origin}/order-confirmation?session_id={CHECKOUT_SESSION_ID}&order_number=${orderNumber}`,
      cancel_url:  `${origin}/order-incomplete?reason=checkout_cancelled`,
      customer_email: customer_email || undefined,
      ...(discounts.length > 0 ? { discounts } : {}),
      metadata: sessionMetadata,
    });

    console.log(`✅ Checkout session ${session.id} created for order ${orderNumber}, customer: ${customer_email}, delivery: ${deliveryDate}`);

    // Store CheckoutSession for webhook recovery
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    try {
      await base44.asServiceRole.entities.CheckoutSession.create({
        stripe_session_id: session.id,
        order_number:      orderNumber,
        customer_email:    customer_email || '',
        checkout_data:     checkoutData,
        expires_at:        expiresAt,
      });
      console.log(`CheckoutSession stored: ${session.id} → order ${orderNumber}`);
    } catch (checkoutErr) {
      console.error(`Failed to store CheckoutSession ${session.id}: ${checkoutErr.message} — webhook will use metadata fallback`);
    }

    return Response.json({
      url:                  session.url,
      order_number:         orderNumber,
      is_preorder:          false,
      sub_free_delivery:    subFreeDelivery,
      sub_discount_pct:     subDiscountPct,
      sub_discount_amt:     subDiscountAmt,
      effective_delivery_fee: effectiveDeliveryFee,
      effective_total:      effectiveTotal,
    });

  } catch (error) {
    console.error('Stripe checkout error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});