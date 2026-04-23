import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

// Pre-orders: Apr 23 – Apr 30. Production (capture) day: May 1. First delivery: May 2.
const PREORDER_START    = new Date('2026-04-23T00:00:00');
const PREORDER_END      = new Date('2026-04-30T23:59:59');
const FULFILLMENT_DATE  = '2026-05-01'; // Production / payment capture day: May 1, 2026
const DELIVERY_DATE     = '2026-05-02'; // First delivery date: May 2, 2026

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
      customer_email, points_discount, points_used,
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

    let session;

    if (preorder) {
      // PRE-ORDER: Use PaymentIntent with manual capture
      // Create a PaymentIntent that authorizes but does NOT charge immediately
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(effectiveTotal * 100),
        currency: 'usd',
        capture_method: 'manual', // authorize only — captured on Apr 30
        receipt_email: customer_email || undefined,
        description: `NuVira Pre-Order ${orderNumber} — Captured May 1, 2026 · Delivered May 2, 2026`,
        metadata: {
          base44_app_id: Deno.env.get('BASE44_APP_ID'),
          order_id: order.id,
          order_number: orderNumber,
          is_preorder: 'true',
          fulfillment_date: FULFILLMENT_DATE,
            delivery_date: DELIVERY_DATE,
        },
      });



      // Create a Checkout Session that uses the existing PaymentIntent
      session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        payment_intent_data: {
          capture_method: 'manual',
          metadata: sessionMetadata,
        },
        success_url: `${origin}/order-confirmation?session_id={CHECKOUT_SESSION_ID}&preorder=true`,
        cancel_url: `${origin}/checkout`,
        customer_email: customer_email || undefined,
        ...(discounts.length > 0 ? { discounts } : {}),
        metadata: sessionMetadata,
      });

      console.log(`Pre-order session created: ${session.id} for order ${orderNumber}`);
    } else {
      // REGULAR ORDER: Immediate payment
      session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        success_url: `${origin}/order-confirmation?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/checkout`,
        customer_email: customer_email || undefined,
        ...(discounts.length > 0 ? { discounts } : {}),
        metadata: sessionMetadata,
      });

      console.log(`Regular checkout session created: ${session.id} for order ${orderNumber}`);
    }

    // Store checkout session data for webhook to retrieve after payment
    const checkoutData = {
      order_number: orderNumber,
      customer_email: customer_email || '',
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
      estimated_delivery_date: preorder ? DELIVERY_DATE : (estimated_delivery_date || null),
      preorder_fulfillment_date: preorder ? FULFILLMENT_DATE : null,
      referral_code: (referral_discount > 0 && referral_code) ? referral_code.toUpperCase() : null,
      points_used: points_used || 0,
      points_discount: points_discount || 0,
      active_reward: active_reward || null,
      reward_discount: reward_discount || 0,
      credits_discount: credits_discount || 0,
      is_preorder: preorder,
    };

    // Pass minimal data in metadata for webhook
    const sessionMetadata = {
      base44_app_id: Deno.env.get('BASE44_APP_ID'),
      order_number: orderNumber,
      is_preorder: preorder ? 'true' : 'false',
      customer_email: customer_email || '',
      checkout_data_json: JSON.stringify(checkoutData),
    };

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