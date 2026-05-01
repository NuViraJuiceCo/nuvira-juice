import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

// Pre-orders: Apr 23 – Apr 30. Production (capture) day: May 1. First delivery: May 2.
const PREORDER_START    = new Date('2026-04-23T00:00:00');
const PREORDER_END      = new Date('2026-04-30T23:59:59');
const FULFILLMENT_DATE  = '2026-05-01'; // Production / payment capture day: May 1, 2026
const DELIVERY_DATE     = '2026-05-02'; // First delivery date: May 2, 2026

/**
 * Calculate next delivery date using NuVira's exact rules
 * Timezone: America/Chicago
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
  parts.forEach(part => {
    partMap[part.type] = part.value;
  });

  const chicagoYear = parseInt(partMap.year);
  const chicagoMonth = parseInt(partMap.month) - 1;
  const chicagoDay = parseInt(partMap.day);
  const chicagoHour = parseInt(partMap.hour);

  const chicagoDate = new Date(chicagoYear, chicagoMonth, chicagoDay, chicagoHour, 0);
  const dayOfWeek = chicagoDate.getDay();
  const cutoffHour = 14; // 2 PM

  let daysToAdd = 0;
  if (dayOfWeek === 0) daysToAdd = 3;       // Sun → Wed
  else if (dayOfWeek === 1) daysToAdd = 2;  // Mon → Wed
  else if (dayOfWeek === 2) daysToAdd = chicagoHour < cutoffHour ? 1 : 4; // Tue
  else if (dayOfWeek === 3) daysToAdd = 3;  // Wed → Sat
  else if (dayOfWeek === 4) daysToAdd = 2;  // Thu → Sat
  else if (dayOfWeek === 5) daysToAdd = chicagoHour < cutoffHour ? 1 : 2; // Fri
  else if (dayOfWeek === 6) daysToAdd = 1;  // Sat → Sun

  const deliveryDate = new Date(chicagoDate);
  deliveryDate.setDate(deliveryDate.getDate() + daysToAdd);
  return deliveryDate.toISOString().split('T')[0];
}

function isPreorderWindow() {
  const now = new Date();
  return now >= PREORDER_START && now <= PREORDER_END;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const {
      items, subtotal, delivery_fee, total,
      fulfillment_type, delivery_address, contact_phone, estimated_delivery_date,
      customer_email, customer_name,
      address_line1, address_line2, address_city, address_state, address_postal_code,
      points_discount, points_used,
      active_reward, reward_discount, credits_discount,
      referral_discount, referral_code,
      force_preorder,
    } = await req.json();

    const preorder = force_preorder || isPreorderWindow();



    // --- Subscription perks: look up active subscription for this customer ---
    let subFreeDelivery = false;
    let subDiscountPct = 0;
    let activeSub = null;
    if (customer_email) {
      const subs = await base44.asServiceRole.entities.Subscription.filter({ customer_email, status: 'active' });
      if (subs.length > 0) {
        activeSub = subs[0];
        const allPlans = await base44.asServiceRole.entities.SubscriptionPlan.list();
        const plan = allPlans.find(p => p.id === activeSub.plan_id);
        if (plan) {
          // Monthly Ritual (8%) and VIP Wellness (15%) get free delivery + discount
          if (plan.discount_percent > 0) {
            subDiscountPct = plan.discount_percent;
            subFreeDelivery = true; // any plan with a discount also gets free delivery
          }
          console.log(`Subscription perks for ${customer_email}: plan=${plan.name}, freeDelivery=${subFreeDelivery}, discount=${subDiscountPct}%`);
        }
      }
    }

    // Apply subscription perks on top of what frontend sent
    const effectiveDeliveryFee = subFreeDelivery ? 0 : (delivery_fee || 0);
    const subDiscountAmt = subDiscountPct > 0 ? Math.round(subtotal * subDiscountPct) / 100 : 0;
    const effectiveTotal = Math.max(0, total - (delivery_fee - effectiveDeliveryFee) - subDiscountAmt);

    const orderNumber = `NV-${Date.now().toString(36).toUpperCase()}`;

    // Build Stripe line items (before storing checkout data)
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

    // Build discounts (points + credits + tier reward + subscription discount + referral)
    let discounts = [];
    const totalDiscountCents =
      Math.round((points_discount || 0) * 100) +
      Math.round((reward_discount || 0) * 100) +
      Math.round((credits_discount || 0) * 100) +
      Math.round((referral_discount || 0) * 100) +
      Math.round(subDiscountAmt * 100);

    if (totalDiscountCents > 0) {
      const discountParts = [];
      if (points_used) discountParts.push(`${points_used} Loyalty Points`);
      if (active_reward?.title) discountParts.push(active_reward.title);
      if (credits_discount > 0) discountParts.push('NuVira Credits');
      if (referral_discount > 0) discountParts.push(`Referral Code ${referral_code || 'NuVira26'}`);
      if (subDiscountAmt > 0) discountParts.push(`Subscriber ${subDiscountPct}% Discount`);

      const coupon = await stripe.coupons.create({
        amount_off: totalDiscountCents,
        currency: 'usd',
        duration: 'once',
        name: discountParts.join(' + ') || 'Discount',
      });
      discounts = [{ coupon: coupon.id }];
    }

    // Calculate delivery date using NuVira's exact rules (backend source of truth)
    const calculatedDeliveryDate = preorder ? DELIVERY_DATE : calculateDeliveryDate();

    // Store checkout session data for webhook to retrieve after payment
    const checkoutData = {
     order_number: orderNumber,
     customer_email: customer_email || '',
     customer_name: customer_name || '',
     // Structured address fields for Hub sync
     address_line1: address_line1 || '',
     address_line2: address_line2 || '',
     address_city: address_city || '',
     address_state: address_state || '',
     address_postal_code: address_postal_code || '',
     address_country: 'US',
     items: items.map(i => ({
       product_id: i.product_id,
       title: i.title,
       price: i.price,
       quantity: i.quantity,
       image_url: i.image_url,
     })),
     subtotal,
     delivery_fee: effectiveDeliveryFee,
     total: effectiveTotal,
     fulfillment_type: fulfillment_type || 'delivery',
     delivery_address: delivery_address || '',
     contact_phone: contact_phone || '',
     estimated_delivery_date: calculatedDeliveryDate,
     preorder_fulfillment_date: preorder ? FULFILLMENT_DATE : null,
     referral_code: (referral_discount > 0 && referral_code) ? referral_code.toUpperCase() : null,
     points_used: points_used || 0,
     points_discount: points_discount || 0,
     active_reward: active_reward || null,
     reward_discount: reward_discount || 0,
     credits_discount: credits_discount || 0,
     is_preorder: preorder,
    };

    // Pass customer profile, delivery, and order metadata to Stripe for recovery
    // Stripe metadata has 500 char limit per value, so keep values concise
    // This is the tertiary recovery layer if CheckoutSession lookup fails
    const sessionMetadata = {
      // App and Checkout Context
      base44_app_id: Deno.env.get('BASE44_APP_ID'),
      source_app: 'customer_app',
      checkout_version: '1.0',
      // Order Identification
      order_number: orderNumber,
      order_type: 'one_time',
      fulfillment_mode: 'single_delivery',
      is_preorder: preorder ? 'true' : 'false',
      // Customer Profile Recovery
      customer_email: customer_email || '',
      customer_name: customer_name || '',
      customer_phone: contact_phone || '',
      // Delivery Address Recovery (use selected checkout address)
      delivery_method: fulfillment_type || 'delivery',
      delivery_address_line1: address_line1 || '',
      delivery_address_line2: address_line2 || '',
      delivery_city: address_city || '',
      delivery_state: address_state || '',
      delivery_postal_code: address_postal_code || '',
      // Delivery Dates
      requested_delivery_date: calculatedDeliveryDate,
      production_date: preorder ? FULFILLMENT_DATE : '',
    };

    let session;

    if (preorder) {
       // PRE-ORDER: Checkout session with manual capture
       session = await stripe.checkout.sessions.create({
         payment_method_types: ['card'],
         line_items: lineItems,
         mode: 'payment',
         client_reference_id: orderNumber, // Reconciliation key
         payment_intent_data: {
           capture_method: 'manual', // authorize only — captured on May 1
           metadata: sessionMetadata,
         },
         success_url: `${origin}/order-confirmation?order_number=${orderNumber}&preorder=true`,
         cancel_url: `${origin}/checkout`,
         customer_email: customer_email || undefined,
         ...(discounts.length > 0 ? { discounts } : {}),
         metadata: sessionMetadata,
       });

       console.log(`✅ Pre-order session ${session.id} created with complete metadata for order ${orderNumber}, customer: ${customer_email}`);
       console.log(`Metadata keys: ${Object.keys(sessionMetadata).join(', ')}`);
    } else {
      // REGULAR ORDER: Immediate payment — attach complete metadata to both session and payment intent
      session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        client_reference_id: orderNumber, // Reconciliation key
        payment_intent_data: {
          metadata: sessionMetadata, // Attach metadata to PaymentIntent as well
        },
        success_url: `${origin}/order-confirmation?order_number=${orderNumber}`,
        cancel_url: `${origin}/checkout`,
        customer_email: customer_email || undefined,
        ...(discounts.length > 0 ? { discounts } : {}),
        metadata: sessionMetadata,
      });

      console.log(`✅ Regular checkout session ${session.id} created with complete metadata for order ${orderNumber}, customer: ${customer_email}`);
      console.log(`Metadata keys: ${Object.keys(sessionMetadata).join(', ')}`);
    }

    // Store checkout data for webhook retrieval (expires in 24 hours)
    // CRITICAL: This is the recovery layer for webhook — must always succeed
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    try {
      await base44.asServiceRole.entities.CheckoutSession.create({
        stripe_session_id: session.id,
        order_number: orderNumber,
        customer_email: customer_email || '',
        checkout_data: checkoutData,
        expires_at: expiresAt,
      });
      console.log(`CheckoutSession stored: ${session.id} → order ${orderNumber}`);
    } catch (checkoutErr) {
      // If CheckoutSession creation fails, webhook will still have order_number in client_reference_id and metadata
      // This is a safety fallback, not a blocker
      console.error(`Failed to store CheckoutSession ${session.id}: ${checkoutErr.message} — webhook will use metadata fallback`);
    }

    return Response.json({
      url: session.url,
      order_number: orderNumber,
      is_preorder: preorder,
      sub_free_delivery: subFreeDelivery,
      sub_discount_pct: subDiscountPct,
      sub_discount_amt: subDiscountAmt,
      effective_delivery_fee: effectiveDeliveryFee,
      effective_total: effectiveTotal,
    });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});