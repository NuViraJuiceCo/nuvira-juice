import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

async function authorizeCheckoutCustomer(base44, customerEmail) {
  const user = await base44.auth.me().catch(() => null);
  const requested = String(customerEmail || '').trim().toLowerCase();
  const requester = String(user?.email || '').trim().toLowerCase();
  if (!user?.email || !requested) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (user.role === 'admin' || requester === requested) return null;
  return Response.json({ error: 'forbidden' }, { status: 403 });
}

/**
 * Creates a Stripe Embedded Checkout Session for subscription purchases.
 * Uses ui_mode='embedded' + mode='subscription' to render inside the app.
 * Returns { clientSecret } for use with <EmbeddedCheckout>.
 * 
 * No external redirect. Full subscription flow stays in the app.
 */
Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_SUBSCRIPTION_CHECKOUTS') !== 'true') {
      return Response.json({
        success: false,
        skipped: true,
        reason: 'subscription_checkouts_disabled',
        message: 'Subscription checkout is currently unavailable. One-time orders are still available.',
      }, { status: 409 });
    }

    const base44 = createClientFromRequest(req);

    const {
      plan_id,
      bundle_id,
      customer_email,
      customer_name: checkoutCustomerName,
      contact_phone,
      address_line1,
      address_line2,
      address_city,
      address_state,
      address_postal_code,
      delivery_address,
    } = await req.json();
    const unauthorized = await authorizeCheckoutCustomer(base44, customer_email);
    if (unauthorized) return unauthorized;

    if (!plan_id || !customer_email) {
      return Response.json({ error: 'Missing plan_id or customer_email' }, { status: 400 });
    }

    // Resolve customer name from profile if not supplied
    let customer_name = checkoutCustomerName?.trim() || '';
    if (!customer_name && customer_email) {
      try {
        const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email });
        if (profiles[0]) {
          const { first_name, last_name } = profiles[0];
          customer_name = [first_name, last_name].filter(Boolean).join(' ');
        }
      } catch (err) {
        console.warn(`[SubPI] Failed to fetch UserProfile for ${customer_email}: ${err.message}`);
      }
    }

    if (!customer_name?.trim()) {
      return Response.json({ error: 'Customer name is required. Please complete your profile before subscribing.' }, { status: 400 });
    }

    // Fetch subscription plan
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({ id: plan_id });
    if (plans.length === 0) {
      return Response.json({ error: 'Subscription plan not found' }, { status: 404 });
    }
    const subscriptionPlan = plans[0];

    if (!subscriptionPlan.stripe_price_id) {
      return Response.json({
        error: 'This subscription plan is not yet available for purchase. Please contact support.'
      }, { status: 400 });
    }

    // Check for existing active subscription (idempotency guard)
    const existingSubs = await base44.asServiceRole.entities.Subscription.filter({ customer_email });
    const hasActiveSub = existingSubs.some(s => s.plan_id === plan_id && s.status === 'active');
    if (hasActiveSub) {
      return Response.json({ error: 'You already have an active subscription with this plan.' }, { status: 400 });
    }

    // Get or create Stripe Customer
    let stripeCustomer = null;
    const customers = await stripe.customers.list({ email: customer_email, limit: 1 });
    if (customers.data.length > 0) {
      stripeCustomer = customers.data[0];
    } else {
      stripeCustomer = await stripe.customers.create({
        email: customer_email,
        name: customer_name || undefined,
        phone: contact_phone || undefined,
        metadata: {
          customer_name: customer_name || '',
          source_app: 'customer_app',
        },
      });
      console.log(`[SubPI] Created Stripe Customer: ${stripeCustomer.id} for ${customer_email}`);
    }

    const resolvedAddress = delivery_address ||
      [address_line1, address_city, address_state, address_postal_code].filter(Boolean).join(', ');

    const subscriptionMetadata = {
      base44_app_id: Deno.env.get('BASE44_APP_ID'),
      source_app: 'customer_app',
      checkout_version: '3.0_embedded',
      order_type: 'subscription',
      customer_email: customer_email || '',
      customer_name: customer_name || '',
      customer_phone: contact_phone || '',
      plan_id: plan_id,
      plan_name: subscriptionPlan.name,
      frequency: subscriptionPlan.frequency || 'monthly',
      delivery_address: resolvedAddress,
      delivery_address_line1: address_line1 || '',
      delivery_address_line2: address_line2 || '',
      delivery_city: address_city || '',
      delivery_state: address_state || '',
      delivery_postal_code: address_postal_code || '',
      bundle_id: bundle_id || '',
    };

    const origin = req.headers.get('origin') || 'https://www.nuvirajuice.com';

    // Create embedded Stripe Checkout Session for subscription
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      mode: 'subscription',
      customer: stripeCustomer.id,
      line_items: [
        { price: subscriptionPlan.stripe_price_id, quantity: 1 },
      ],
      subscription_data: { metadata: subscriptionMetadata },
      metadata: subscriptionMetadata,
      return_url: `${origin}/account/subscriptions?session_id={CHECKOUT_SESSION_ID}`,
    });

    console.log(`[SubPI] Created embedded subscription session ${session.id} for ${customer_email}, plan: ${subscriptionPlan.name}`);

    return Response.json({
      success: true,
      clientSecret: session.client_secret,
      sessionId: session.id,
      publishableKey: Deno.env.get('STRIPE_PUBLISHABLE_KEY'),
      planName: subscriptionPlan.name,
      planFrequency: subscriptionPlan.frequency,
      basePriceAmt: subscriptionPlan.base_price,
    });

  } catch (error) {
    console.error('[SubPI] createSubscriptionPaymentIntent error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
