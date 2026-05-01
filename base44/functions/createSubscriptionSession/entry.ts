import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

/**
 * Create Stripe Subscription Checkout Session
 * 
 * Includes comprehensive metadata for customer profile and order recovery:
 * - customer_name, email, phone for Customer App profile recovery
 * - delivery address (selected checkout address if provided, else profile address)
 * - subscription plan details (monthly_ritual, vip_wellness)
 * - fulfillment mode and weekly delivery counts
 * 
 * Called by: pages/Subscribe (subscription checkout flow)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const {
      plan_id, // SubscriptionPlan ID
      bundle_id, // SubscriptionBundle ID
      customer_email,
      customer_name,
      contact_phone,
      address_line1, // Selected checkout address (if different from profile)
      address_line2,
      address_city,
      address_state,
      address_postal_code,
      profile_address_line1, // Fallback: profile address if no checkout selection
      profile_address_city,
      profile_address_state,
      profile_address_postal_code,
      delivery_zone_id,
    } = await req.json();

    if (!plan_id || !customer_email) {
      return Response.json({ error: 'Missing plan_id or customer_email' }, { status: 400 });
    }

    // Fetch plan details for metadata
    const plan = await base44.asServiceRole.entities.SubscriptionPlan.filter({ id: plan_id });
    if (plan.length === 0) {
      return Response.json({ error: 'Subscription plan not found' }, { status: 404 });
    }
    const subscriptionPlan = plan[0];

    // Determine delivery address: use selected checkout address if provided, else profile address
    const deliveryAddressLine1 = address_line1 || profile_address_line1 || '';
    const deliveryCity = address_city || profile_address_city || '';
    const deliveryState = address_state || profile_address_state || '';
    const deliveryPostalCode = address_postal_code || profile_address_postal_code || '';

    // Build subscription metadata for recovery
    const subscriptionMetadata = {
      customer_email: customer_email || '',
      customer_name: customer_name || '',
      customer_phone: contact_phone || '',
      // Subscription details
      subscription_plan: subscriptionPlan.name.toLowerCase().replace(/\s+/g, '_'),
      order_type: 'subscription',
      fulfillment_mode: 'multi_delivery',
      frequency: subscriptionPlan.frequency || 'monthly',
      // Delivery counts
      weekly_delivery_count: subscriptionPlan.frequency === 'weekly' ? '1' : '4',
      // Items summary (keep under 500 char limit)
      items_summary: subscriptionPlan.name,
      // Delivery address (selected or profile default)
      default_delivery_address_line1: deliveryAddressLine1,
      default_delivery_address_line2: address_line2 || '',
      default_delivery_city: deliveryCity,
      default_delivery_state: deliveryState,
      default_delivery_postal_code: deliveryPostalCode,
      // Source
      source_app: 'customer_app',
    };

    const origin = req.headers.get('origin') || 'https://app.base44.com';

    // Get or create Stripe Customer for subscription linking
    let stripeCustomer = null;
    if (customer_email) {
      const customers = await stripe.customers.list({ email: customer_email, limit: 1 });
      if (customers.data.length > 0) {
        stripeCustomer = customers.data[0];
      } else {
        // Create new Stripe Customer with profile metadata
        stripeCustomer = await stripe.customers.create({
          email: customer_email,
          name: customer_name || undefined,
          phone: contact_phone || undefined,
          metadata: {
            customer_name: customer_name || '',
            default_delivery_city: deliveryCity,
            default_delivery_state: deliveryState,
            default_delivery_postal_code: deliveryPostalCode,
            source_app: 'customer_app',
          },
        });
        console.log(`Created Stripe Customer: ${stripeCustomer.id} for ${customer_email}`);
      }
    }

    // Create checkout session for subscription
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      client_reference_id: `sub_${Date.now()}`, // Reconciliation key
      customer: stripeCustomer?.id || undefined,
      customer_email: !stripeCustomer ? customer_email : undefined,
      line_items: [
        {
          price: subscriptionPlan.stripe_price_id || undefined,
          quantity: 1,
        },
      ],
      subscription_data: {
        metadata: subscriptionMetadata,
      },
      metadata: subscriptionMetadata,
      success_url: `${origin}/account/subscriptions?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/subscribe`,
    });

    console.log(
      `Subscription session created: ${session.id} for ${customer_email}, plan: ${subscriptionPlan.name}`
    );

    return Response.json({
      url: session.url,
      session_id: session.id,
      customer_id: stripeCustomer?.id,
      plan_name: subscriptionPlan.name,
    });
  } catch (error) {
    console.error('Stripe subscription session error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});