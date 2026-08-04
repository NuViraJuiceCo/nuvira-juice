import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { handleCustomerJourneyRequest } from '../sendNotificationCampaign/customerJourneyAutomation.ts';

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
    const response = await handleCustomerJourneyRequest(base44, null, {
      action: 'evaluate_scheduled',
    });

    return response || Response.json({ error: 'scheduler_unavailable' }, { status: 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown');
    console.error(`[customerJourneyAutomation] ${message}`);
    return Response.json({ error: 'customer_journey_scheduler_error', message }, { status: 500 });
  }
});
