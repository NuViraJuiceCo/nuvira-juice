import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Dedicated recurring customer-journey evaluator.
 *
 * Base44 recurring automations attach platform-managed request fields that can
 * overlap with the legacy notification-campaign form. This wrapper deliberately
 * ignores that envelope and exposes only the consent-gated, idempotent scheduled
 * evaluator. It cannot execute a manual notification campaign.
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const result = await base44.asServiceRole.functions.invoke('sendNotificationCampaign', {
      action: 'evaluate_scheduled',
    });
    const data = result?.data || result || {};
    return Response.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown');
    console.error(`[customerJourneyAutomation] ${message}`);
    return Response.json({ error: 'customer_journey_scheduler_error', message }, { status: 500 });
  }
});
