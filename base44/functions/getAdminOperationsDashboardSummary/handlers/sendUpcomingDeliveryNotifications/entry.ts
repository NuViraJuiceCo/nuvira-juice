import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

export default async (req: Request) => {
  try {
    if (Deno.env.get('ENABLE_UPCOMING_DELIVERY_NOTIFICATIONS') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'upcoming_delivery_notifications_disabled',
        message: 'Upcoming delivery notifications are disabled by the current communications safety gate.',
      });
    }

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
    let skipped = 0;
    const errors = [];

    for (const sub of subscriptions) {
      const title = `Your delivery is coming up on ${targetDateStr}`;
      const message = `Your next NuVira delivery is scheduled for ${new Date(targetDateStr).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}. Want to switch things up? Customize your juice mix before it ships!`;
      const idempotencyKey = sub.id
        ? `upcoming_delivery_${sub.id}_${targetDateStr}`
        : `upcoming_delivery_${sub.customer_email}_${targetDateStr}`;

      try {
        const result = await base44.asServiceRole.functions.invoke('sendCustomerNotification', {
          customer_email: sub.customer_email,
          title,
          message,
          type: 'order_update',
          notification_subtype: 'delivery_reminder',
          idempotency_key: idempotencyKey,
          deep_link: '/account/subscriptions',
        });

        const notificationResult = result?.data || result;
        if (notificationResult?.skipped === true) {
          skipped++;
          console.log(`Skipped upcoming delivery notification for ${sub.customer_email}: ${notificationResult.reason || 'skipped'}`);
        } else {
          notified++;
          console.log(`Notified ${sub.customer_email}`);
        }
      } catch (notifyErr) {
        errors.push({
          customer_email: sub.customer_email,
          reason: notifyErr.message,
        });
        console.error(`Failed to notify ${sub.customer_email}: ${notifyErr.message}`);
        continue;
      }
    }

    return Response.json({ success: true, notified, skipped, errors, checked: subscriptions.length });
  } catch (error) {
    console.error('Upcoming delivery notification error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
};
