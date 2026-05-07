import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

/**
 * Creates a Stripe PaymentIntent for embedded in-app checkout.
 * Returns { clientSecret, orderNumber, effectiveTotal, ... } — NO redirect URL.
 *
 * A pending Order record is created immediately so the webhook can finalize it
 * on payment_intent.succeeded without needing a CheckoutSession lookup.
 *
 * Metadata mirrors createCheckoutSession for full backward compatibility.
 */
function calculateDeliveryDate(orderTime = new Date()) {
  const chicagoFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = chicagoFormatter.formatToParts(orderTime);
  const pm = {};
  parts.forEach(p => { pm[p.type] = p.value; });
  const chicagoDate = new Date(parseInt(pm.year), parseInt(pm.month) - 1, parseInt(pm.day), parseInt(pm.hour), 0);
  const dow = chicagoDate.getDay();
  const h   = chicagoDate.getHours();
  let d = 0;
  if      (dow === 0) d = 3;
  else if (dow === 1) d = 2;
  else if (dow === 2) d = h < 14 ? 1 : 4;
  else if (dow === 3) d = 3;
  else if (dow === 4) d = 2;
  else if (dow === 5) d = h < 14 ? 1 : 2;
  else if (dow === 6) d = 1;
  const del = new Date(chicagoDate);
  del.setDate(del.getDate() + d);
  return del.toISOString().split('T')[0];
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const {
      items, subtotal, delivery_fee, total,
      fulfillment_type, delivery_address, contact_phone,
      customer_email, customer_name: checkoutCustomerName,
      address_line1, address_line2, address_city, address_state, address_postal_code,
      points_discount, points_used,
      active_reward, reward_discount, credits_discount,
      referral_discount, referral_code,
      selected_delivery_date, assigned_delivery_date, production_date,
      delivery_window_label, delivery_window_start, delivery_window_end,
      delivery_schedule_source,
    } = await req.json();

    // Resolve customer name
    let customer_name = checkoutCustomerName?.trim() || '';
    if (!customer_name && customer_email) {
      try {
        const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email });
        if (profiles[0]) {
          const { first_name, last_name } = profiles[0];
          customer_name = [first_name, last_name].filter(Boolean).join(' ');
        }
      } catch (err) {
        console.warn(`[PI] Failed to fetch UserProfile for ${customer_email}: ${err.message}`);
      }
    }

    if (!customer_name?.trim()) {
      return Response.json({ error: 'Customer name is required. Please complete your profile.' }, { status: 400 });
    }

    // Subscription perks
    let subFreeDelivery = false;
    let subDiscountPct  = 0;
    if (customer_email) {
      const subs = await base44.asServiceRole.entities.Subscription.filter({ customer_email, status: 'active' });
      if (subs.length > 0) {
        const allPlans = await base44.asServiceRole.entities.SubscriptionPlan.list();
        const plan = allPlans.find(p => p.id === subs[0].plan_id);
        if (plan?.discount_percent > 0) {
          subDiscountPct  = plan.discount_percent;
          subFreeDelivery = true;
        }
      }
    }

    const effectiveDeliveryFee = subFreeDelivery ? 0 : (delivery_fee || 0);
    const subDiscountAmt       = subDiscountPct > 0 ? Math.round(subtotal * subDiscountPct) / 100 : 0;
    const effectiveTotal       = Math.max(0, total - (delivery_fee - effectiveDeliveryFee) - subDiscountAmt);

    const orderNumber = `NV-${Date.now().toString(36).toUpperCase()}`;

    const deliveryDate         = selected_delivery_date || calculateDeliveryDate();
    const resolvedProdDate     = production_date     || null;
    const resolvedWindowLabel  = delivery_window_label  || '5 PM – 8 PM';
    const resolvedWindowStart  = delivery_window_start  || '17:00';
    const resolvedWindowEnd    = delivery_window_end    || '20:00';
    const resolvedScheduleSrc  = delivery_schedule_source || 'system_default';

    // Metadata — identical contract to createCheckoutSession
    const intentMetadata = {
      base44_app_id:            Deno.env.get('BASE44_APP_ID'),
      source_app:               'customer_app',
      checkout_version:         '3.0_embedded',
      order_number:             orderNumber,
      order_type:               'one_time',
      fulfillment_mode:         'single_delivery',
      is_preorder:              'false',
      customer_email:           customer_email || '',
      customer_name:            customer_name  || '',
      customer_phone:           contact_phone  || '',
      delivery_method:          fulfillment_type || 'delivery',
      delivery_address_line1:   address_line1  || '',
      delivery_address_line2:   address_line2  || '',
      delivery_city:            address_city   || '',
      delivery_state:           address_state  || '',
      delivery_postal_code:     address_postal_code || '',
      requested_delivery_date:  deliveryDate,
      selected_delivery_date:   deliveryDate,
      production_date:          resolvedProdDate || '',
      delivery_window_label:    resolvedWindowLabel,
      delivery_window_start:    resolvedWindowStart,
      delivery_window_end:      resolvedWindowEnd,
      delivery_schedule_source: resolvedScheduleSrc,
    };

    // effectiveTotal already includes all discounts from the frontend (points, credits, referral, reward, sub discount).
    // Do NOT subtract again here — that would double-count.
    const amountCents = Math.max(50, Math.round(effectiveTotal * 100));

    // Create PaymentIntent with card only.
    // payment_method_types:['card'] enables Apple Pay and Google Pay via ExpressCheckoutElement
    // without opening the door to Bank, Klarna, ACH, or any redirect-based method.
    // automatic_payment_methods is intentionally omitted to prevent Bank from appearing.
    const paymentIntent = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: 'usd',
      payment_method_types: ['card'],
      metadata: intentMetadata,
      receipt_email: customer_email || undefined,
      description: `NuVira Order ${orderNumber}`,
    });

    console.log(`[PI] Created PI ${paymentIntent.id} for ${orderNumber}: automatic_payment_methods=enabled, allow_redirects=never. amount=${amountCents}¢, customer=${customer_email}`);

    // Pre-create a pending Order so webhook finalize is simple and idempotent
    const resolvedDeliveryAddress = delivery_address || [address_line1, address_city, address_state, address_postal_code].filter(Boolean).join(', ');

    try {
      await base44.asServiceRole.entities.Order.create({
        order_number:             orderNumber,
        customer_email:           customer_email || '',
        customer_name,
        items: items.map(i => ({
          product_id: i.product_id,
          title:      i.title,
          price:      i.price,
          quantity:   i.quantity,
          image_url:  i.image_url || null,
        })),
        subtotal,
        delivery_fee:             effectiveDeliveryFee,
        total:                    effectiveTotal,
        fulfillment_type:         fulfillment_type || 'delivery',
        delivery_address:         resolvedDeliveryAddress,
        address_line1:            address_line1  || '',
        address_line2:            address_line2  || '',
        address_city:             address_city   || '',
        address_state:            address_state  || '',
        address_postal_code:      address_postal_code || '',
        address_country:          'US',
        contact_phone:            contact_phone  || '',
        estimated_delivery_date:  deliveryDate,
        assigned_delivery_date:   deliveryDate,
        delivery_window_label:    resolvedWindowLabel,
        assigned_delivery_window_start: resolvedWindowStart,
        assigned_delivery_window_end:   resolvedWindowEnd,
        // CRITICAL: pending_payment is NOT an operational status.
        // This order must NOT sync to Hub, appear in Driver Portal, route optimization,
        // production, or Order Management active views until payment_intent.succeeded fires.
        status:                   'pending_payment',
        payment_status:           'pending',
        financial_status:         'pending',
        payment_captured:         false,
        stripe_payment_intent_id: paymentIntent.id,
        referral_code:            (referral_discount > 0 && referral_code) ? referral_code.toUpperCase() : null,
        is_preorder:              false,
        status_history: [{
          status:    'pending_payment',
          timestamp: new Date().toISOString(),
          message:   'Order created — awaiting payment confirmation.',
        }],
      });
      console.log(`[PI] Pending Order ${orderNumber} pre-created`);
    } catch (orderErr) {
      // Non-fatal — webhook will create order if this fails
      console.error(`[PI] Failed to pre-create Order ${orderNumber}: ${orderErr.message}`);
    }

    // Also store CheckoutSession for legacy compatibility / admin tools
    try {
      await base44.asServiceRole.entities.CheckoutSession.create({
        stripe_session_id: paymentIntent.id, // re-use field for PI ID
        order_number:      orderNumber,
        customer_email:    customer_email || '',
        checkout_data: {
          order_number, customer_email, customer_name,
          address_line1, address_line2, address_city, address_state, address_postal_code,
          address_country: 'US',
          items, subtotal,
          delivery_fee:              effectiveDeliveryFee,
          total:                     effectiveTotal,
          fulfillment_type:          fulfillment_type || 'delivery',
          delivery_address:          resolvedDeliveryAddress,
          contact_phone:             contact_phone    || '',
          estimated_delivery_date:   deliveryDate,
          assigned_delivery_date:    deliveryDate,
          production_date:           resolvedProdDate || null,
          delivery_window_label:     resolvedWindowLabel,
          delivery_window_start:     resolvedWindowStart,
          delivery_window_end:       resolvedWindowEnd,
          delivery_schedule_source:  resolvedScheduleSrc,
          is_preorder:               false,
          referral_code:             (referral_discount > 0 && referral_code) ? referral_code.toUpperCase() : null,
          points_used:               points_used    || 0,
          points_discount:           points_discount|| 0,
          active_reward:             active_reward  || null,
          reward_discount:           reward_discount|| 0,
          credits_discount:          credits_discount || 0,
        },
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    } catch (csErr) {
      console.warn(`[PI] Failed to store CheckoutSession for ${orderNumber}: ${csErr.message}`);
    }

    return Response.json({
      clientSecret:         paymentIntent.client_secret,
      paymentIntentId:      paymentIntent.id,
      publishableKey:       Deno.env.get('STRIPE_PUBLISHABLE_KEY'),
      orderNumber,
      effectiveTotal,
      effectiveDeliveryFee,
      subFreeDelivery,
      subDiscountPct,
      subDiscountAmt,
    });

  } catch (error) {
    console.error('[PI] createPaymentIntent error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});