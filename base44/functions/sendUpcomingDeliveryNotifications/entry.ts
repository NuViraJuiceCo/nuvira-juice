import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // This is a scheduled/admin function — no user auth needed
    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + 3);
    const targetDateStr = targetDate.toISOString().split('T')[0];

    console.log(`Checking for deliveries on ${targetDateStr}`);

    // Fetch all active subscriptions with next_delivery_date = 3 days from now
    const subscriptions = await base44.asServiceRole.entities.Subscription.filter({
      status: 'active',
      next_delivery_date: targetDateStr,
    });

    console.log(`Found ${subscriptions.length} subscription(s) with delivery on ${targetDateStr}`);

    let notified = 0;

    for (const sub of subscriptions) {
      // Check if we already sent a notification for this delivery date
      const existing = await base44.asServiceRole.entities.Notification.filter({
        customer_email: sub.customer_email,
        type: 'order_update',
        title: `Your delivery is coming up on ${targetDateStr}`,
      });

      if (existing.length > 0) {
        console.log(`Already notified ${sub.customer_email} for ${targetDateStr}`);
        continue;
      }

      await base44.asServiceRole.entities.Notification.create({
        customer_email: sub.customer_email,
        title: `Your delivery is coming up on ${targetDateStr}`,
        message: `Your next NuVira delivery is scheduled for ${new Date(targetDateStr).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}. Want to switch things up? Customize your juice mix before it ships!`,
        type: 'order_update',
        is_read: false,
        icon: '🥤',
      });

      notified++;
      console.log(`Notified ${sub.customer_email}`);
    }

    return Response.json({ success: true, notified, checked: subscriptions.length });
  } catch (error) {
    console.error('Upcoming delivery notification error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});