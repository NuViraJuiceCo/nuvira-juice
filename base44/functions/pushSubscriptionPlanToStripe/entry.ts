import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

/**
 * Pushes a Base44 SubscriptionPlan to Stripe and stores the price IDs back
 * Payload: { plan_id: string }
 */

Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_LEGACY_PAYMENT_SUBSCRIPTION_TOOLS') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'legacy_payment_subscription_tools_disabled',
        message: 'Legacy payment/subscription tools are disabled for May 30 launch freeze.',
      }, { status: 409 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const { plan_id } = await req.json();

    if (!plan_id) {
      return Response.json({ error: 'plan_id required' }, { status: 400 });
    }

    // Fetch the plan from Base44
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({ id: plan_id });
    if (!plans.length) {
      return Response.json({ error: 'Plan not found' }, { status: 404 });
    }

    const plan = plans[0];

    // Map frequency to Stripe billing interval
    const billingIntervalMap = {
      weekly: 'week',
      biweekly: 'week', // Stripe doesn't have biweekly, use 2 weeks
      monthly: 'month',
    };

    const billingInterval = billingIntervalMap[plan.frequency];
    const intervalCount = plan.frequency === 'biweekly' ? 2 : 1;

    // Create or update Stripe product
    let stripeProductId = plan.stripe_product_id;

    if (!stripeProductId) {
      console.log(`Creating new Stripe product for plan: ${plan.name}`);
      const product = await stripe.products.create({
        name: plan.name,
        description: `Subscription plan - ${plan.bottle_count} bottles, ${plan.discount_percent}% discount`,
        metadata: {
          base44_plan_id: plan_id,
          bottle_count: String(plan.bottle_count),
          discount_percent: String(plan.discount_percent),
        },
      });
      stripeProductId = product.id;
      console.log(`Created Stripe product: ${stripeProductId}`);
    } else {
      console.log(`Updating existing Stripe product: ${stripeProductId}`);
      await stripe.products.update(stripeProductId, {
        name: plan.name,
        description: `Subscription plan - ${plan.bottle_count} bottles, ${plan.discount_percent}% discount`,
        metadata: {
          base44_plan_id: plan_id,
          bottle_count: String(plan.bottle_count),
          discount_percent: String(plan.discount_percent),
        },
      });
    }

    // Create new price (Stripe doesn't allow updating prices, so we create a new one)
    const amountInCents = Math.round(plan.base_price * 100);

    const price = await stripe.prices.create({
      product: stripeProductId,
      unit_amount: amountInCents,
      currency: 'usd',
      recurring: {
        interval: billingInterval,
        interval_count: intervalCount,
      },
      metadata: {
        base44_plan_id: plan_id,
      },
    });

    console.log(`Created Stripe price: ${price.id} for $${plan.base_price}/${plan.frequency}`);

    // Update the Base44 plan with Stripe IDs
    await base44.asServiceRole.entities.SubscriptionPlan.update(plan_id, {
      stripe_product_id: stripeProductId,
      stripe_price_id: price.id,
    });

    console.log(`Plan ${plan_id} synced to Stripe successfully`);

    return Response.json({
      ok: true,
      stripe_product_id: stripeProductId,
      stripe_price_id: price.id,
      plan_name: plan.name,
      amount: plan.base_price,
    });
  } catch (error) {
    console.error('Push to Stripe error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
