import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const {
      items, subtotal, delivery_fee, total,
      fulfillment_type, delivery_address, contact_phone, estimated_delivery_date,
      customer_email, points_discount, points_used,
      active_reward, reward_discount,
    } = await req.json();

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
      fulfillment_type,
      delivery_address: delivery_address || '',
      contact_phone: contact_phone || '',
      estimated_delivery_date: estimated_delivery_date || null,
      status: 'order_received',
      status_history: [{
        status: 'order_received',
        timestamp: new Date().toISOString(),
        message: "We've received your order!",
      }],
    });

    const origin = req.headers.get('origin') || 'https://app.base44.com';

    // Build Stripe line items (skip free birthday reward — price is $0)
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

    // Add delivery fee as a line item if applicable
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

    // Build discounts (points redemption + tier reward discount)
    let discounts = [];
    const totalDiscountCents =
      Math.round((points_discount || 0) * 100) +
      Math.round((reward_discount || 0) * 100);

    if (totalDiscountCents > 0) {
      const discountParts = [];
      if (points_used) discountParts.push(`${points_used} Loyalty Points`);
      if (active_reward?.title) discountParts.push(active_reward.title);

      const coupon = await stripe.coupons.create({
        amount_off: totalDiscountCents,
        currency: 'usd',
        duration: 'once',
        name: discountParts.join(' + ') || 'Discount',
      });
      discounts = [{ coupon: coupon.id }];

      // Deduct points from user's account
      if (customer_email) {
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
    }

    const session = await stripe.checkout.sessions.create({
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

    return Response.json({ url: session.url, order_id: order.id });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});