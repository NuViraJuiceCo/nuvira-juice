import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { items, subtotal, delivery_fee, total, fulfillment_type, delivery_address, contact_phone, estimated_delivery_date, customer_email } = await req.json();

    // Create order in DB first with pending_payment status
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

    // Build Stripe line items
    const lineItems = items.map(item => ({
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

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${origin}/order-confirmation/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout`,
      customer_email: customer_email || undefined,
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