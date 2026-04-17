import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

// Pre-order window: Apr 22 – Apr 29. Launch (capture) date: Apr 30.
const PREORDER_START = new Date('2026-04-22T00:00:00');
const PREORDER_END   = new Date('2026-04-29T23:59:59');
const FULFILLMENT_DATE = '2026-04-30';

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
      // Per-product pre-order flag (future use)
      force_preorder,
    } = await req.json();

    const preorder = force_preorder || isPreorderWindow();

    // Create order in DB first
    const orderNumber = `NV-${Date.now().toString(36).toUpperCase()}`;
    const order = await base44.asServiceRole.entities.Order.create({
      order_number: orderNumber,
      customer_email: customer_email || 'guest@nuvira.com',
      items: items.map(i => ({
        product_id: i.product_id,
        title: i.title,
        price: i.price,
        quantity: i.quantity,
        image_url: i.image_url,
      })),
      subtotal,
      delivery_fee,
      total,
      fulfillment_type: fulfillment_type || 'delivery',
      delivery_address: delivery_address || '',
      contact_phone: contact_phone || '',
      estimated_delivery_date: preorder ? FULFILLMENT_DATE : (estimated_delivery_date || null),
      status: 'order_received',
      status_history: [{
        status: 'order_received',
        timestamp: new Date().toISOString(),
        message: preorder
          ? "Pre-order received! Payment will be captured on April 30th when production begins."
          : "We've received your order!",
      }],
      is_preorder: preorder,
      preorder_fulfillment_date: preorder ? FULFILLMENT_DATE : null,
      payment_captured: !preorder, // regular orders are immediately captured
    });

    const origin = req.headers.get('origin') || 'https://app.base44.com';

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

    if (delivery_fee > 0) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: 'Delivery Fee' },
          unit_amount: Math.round(delivery_fee * 100),
        },
        quantity: 1,
      });
    }

    // Build discounts (points + credits + tier reward)
    let discounts = [];
    const totalDiscountCents =
      Math.round((points_discount || 0) * 100) +
      Math.round((reward_discount || 0) * 100) +
      Math.round((credits_discount || 0) * 100);

    if (totalDiscountCents > 0) {
      const discountParts = [];
      if (points_used) discountParts.push(`${points_used} Loyalty Points`);
      if (active_reward?.title) discountParts.push(active_reward.title);
      if (credits_discount > 0) discountParts.push('NuVira Credits');

      const coupon = await stripe.coupons.create({
        amount_off: totalDiscountCents,
        currency: 'usd',
        duration: 'once',
        name: discountParts.join(' + ') || 'Discount',
      });
      discounts = [{ coupon: coupon.id }];

      // Deduct points from user account
      if (customer_email && (points_used || active_reward?.points_required)) {
        const existing = await base44.asServiceRole.entities.UserPoints.filter({ customer_email });
        if (existing[0]) {
          const deductPoints = (points_used || 0) + (active_reward?.points_required || 0);
          const historyEntries = [];
          if (points_used) {
            historyEntries.push({ amount: -points_used, type: 'redeemed', description: 'Redeemed at checkout', timestamp: new Date().toISOString() });
          }
          if (active_reward?.points_required) {
            historyEntries.push({ amount: -active_reward.points_required, type: 'redeemed', description: `Redeemed: ${active_reward.title}`, timestamp: new Date().toISOString() });
          }
          await base44.asServiceRole.entities.UserPoints.update(existing[0].id, {
            total_points: Math.max(0, (existing[0].total_points || 0) - deductPoints),
            redeemed_points: (existing[0].redeemed_points || 0) + deductPoints,
            points_history: [...(existing[0].points_history || []), ...historyEntries],
          });
        }
      }

      // Deduct NuVira Credits if used
      if (customer_email && credits_discount > 0) {
        const creditRecs = await base44.asServiceRole.entities.NuViraCredit.filter({ customer_email });
        if (creditRecs[0]) {
          const rec = creditRecs[0];
          const entry = {
            amount: credits_discount,
            type: 'used',
            description: `Applied to order ${orderNumber}`,
            order_id: order.id,
            timestamp: new Date().toISOString(),
          };
          await base44.asServiceRole.entities.NuViraCredit.update(rec.id, {
            balance: Math.max(0, (rec.balance || 0) - credits_discount),
            lifetime_used: (rec.lifetime_used || 0) + credits_discount,
            history: [...(rec.history || []), entry],
          });
        }
      }
    }

    let session;

    if (preorder) {
      // PRE-ORDER: Use PaymentIntent with manual capture
      // Create a PaymentIntent that authorizes but does NOT charge immediately
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(total * 100),
        currency: 'usd',
        capture_method: 'manual', // authorize only — captured on Apr 30
        receipt_email: customer_email || undefined,
        description: `NuVira Pre-Order ${orderNumber} — Capture April 30, 2026`,
        metadata: {
          base44_app_id: Deno.env.get('BASE44_APP_ID'),
          order_id: order.id,
          order_number: orderNumber,
          is_preorder: 'true',
          fulfillment_date: FULFILLMENT_DATE,
        },
      });

      // Store the PaymentIntent ID on the order
      await base44.asServiceRole.entities.Order.update(order.id, {
        stripe_payment_intent_id: paymentIntent.id,
      });

      // Create a Checkout Session that uses the existing PaymentIntent
      session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        payment_intent_data: {
          capture_method: 'manual',
          metadata: {
            base44_app_id: Deno.env.get('BASE44_APP_ID'),
            order_id: order.id,
            order_number: orderNumber,
            is_preorder: 'true',
          },
        },
        success_url: `${origin}/order-confirmation/${order.id}?session_id={CHECKOUT_SESSION_ID}&preorder=true`,
        cancel_url: `${origin}/checkout`,
        customer_email: customer_email || undefined,
        ...(discounts.length > 0 ? { discounts } : {}),
        metadata: {
          base44_app_id: Deno.env.get('BASE44_APP_ID'),
          order_id: order.id,
          order_number: orderNumber,
          is_preorder: 'true',
        },
      });

      console.log(`Pre-order session created: ${session.id} for order ${orderNumber}`);
    } else {
      // REGULAR ORDER: Immediate payment
      session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        success_url: `${origin}/order-confirmation/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/checkout`,
        customer_email: customer_email || undefined,
        ...(discounts.length > 0 ? { discounts } : {}),
        metadata: {
          base44_app_id: Deno.env.get('BASE44_APP_ID'),
          order_id: order.id,
          order_number: orderNumber,
        },
      });

      console.log(`Regular checkout session created: ${session.id} for order ${orderNumber}`);
    }

    // Save checkout session ID on order
    await base44.asServiceRole.entities.Order.update(order.id, {
      stripe_checkout_session_id: session.id,
    });

    return Response.json({ url: session.url, order_id: order.id, is_preorder: preorder });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});