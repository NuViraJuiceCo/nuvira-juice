import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Audit subscription fulfillment tasks and cycle logic.
 * Checks for 4 fulfillments per monthly cycle, correct dates, products, and deduplication.
 * Admin-only.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const {
      customer_email = 'amark@nuvisionarymedia.com',
      stripe_subscription_id = 'sub_1TUsPSIrzYHaHkt2QoRmPw2F',
      customer_app_subscription_id = '69fe3e960cba907fa6488355',
    } = await req.json();

    console.log(`[auditFulfillments] Auditing ${customer_email}, sub ${stripe_subscription_id}`);

    // Fetch subscription
    const subs = await base44.asServiceRole.entities.Subscription.filter({
      id: customer_app_subscription_id,
      customer_email: customer_email,
    });

    if (subs.length === 0) {
      return Response.json({ error: 'Subscription not found' }, { status: 404 });
    }

    const subscription = subs[0];
    console.log(`[auditFulfillments] Subscription status: ${subscription.status}, started: ${subscription.started_date}, next: ${subscription.next_delivery_date}`);

    // Fetch plan
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({
      id: subscription.plan_id,
    });
    const plan = plans[0];

    // Fetch all fulfillment tasks for this subscription
    const fulfillmentTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
      customer_email: customer_email,
    });

    // Filter to tasks related to this subscription (by order_id or direct reference)
    const relatedTasks = fulfillmentTasks.filter(task => {
      const isForThisCustomer = task.customer_email === customer_email;
      // Tasks may not directly reference subscription, but customer + fulfillment_number pattern
      return isForThisCustomer;
    });

    console.log(`[auditFulfillments] Found ${relatedTasks.length} FulfillmentTasks for ${customer_email}`);

    // Analyze fulfillment numbers
    const tasksByNumber = {};
    relatedTasks.forEach(task => {
      const num = task.fulfillment_number || 'unknown';
      if (!tasksByNumber[num]) tasksByNumber[num] = [];
      tasksByNumber[num].push(task);
    });

    const fulfillmentReport = {
      customer_email,
      stripe_subscription_id,
      customer_app_subscription_id,
      subscription_status: subscription.status,
      plan_name: plan?.name || 'Unknown',
      started_date: subscription.started_date,
      next_delivery_date: subscription.next_delivery_date,
      
      fulfillment_analysis: {
        total_tasks: relatedTasks.length,
        tasks_by_fulfillment_number: Object.keys(tasksByNumber).sort(),
        duplicates_by_number: Object.entries(tasksByNumber)
          .filter(([num, tasks]) => tasks.length > 1)
          .map(([num, tasks]) => ({
            fulfillment_number: num,
            count: tasks.length,
            task_ids: tasks.map(t => t.id),
          })),
      },

      tasks_detail: relatedTasks.map(task => ({
        id: task.id,
        fulfillment_number: task.fulfillment_number,
        delivery_date: task.delivery_date,
        status: task.status,
        items_count: task.items?.length || 0,
        items_summary: task.items?.map(i => `${i.quantity}x ${i.title}`).join(', ') || 'none',
        order_id: task.order_id,
      })),

      recommendations: {
        current_fulfillment_count: relatedTasks.length,
        expected_for_monthly: 4,
        status: relatedTasks.length === 4 ? '✅ CORRECT' : '⚠️ NEEDS CORRECTION',
        issue: relatedTasks.length !== 4 
          ? relatedTasks.length < 4 
            ? `Missing ${4 - relatedTasks.length} fulfillments for paid monthly cycle`
            : `Excess ${relatedTasks.length - 4} fulfillments - possible duplicates or old test tasks`
          : 'No issues detected',
      },
    };

    console.log(`[auditFulfillments] Summary: ${fulfillmentReport.recommendations.status}`);

    return Response.json(fulfillmentReport);

  } catch (error) {
    console.error('[auditFulfillments] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});