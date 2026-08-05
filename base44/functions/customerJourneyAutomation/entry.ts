import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { handleCustomerJourneyRequest } from './customerJourneyAutomation.ts';

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
    let caller: any = null;
    try {
      caller = await base44.auth.me();
    } catch {
      caller = null;
    }

    const rawBody = await req.text();
    let body: Record<string, any> = {};
    if (rawBody.trim()) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return Response.json({ error: 'malformed_json' }, { status: 400 });
      }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'malformed_json' }, { status: 400 });
    }

    const flattened = body.args && typeof body.args === 'object' ? { ...body, ...body.args } : body;
    const action = String(flattened.action || '').trim();
    const supportedAction = [
      'record_activity',
      'preview',
      'preview_rewards_email_campaign',
      'evaluate_scheduled',
      'evaluate_now',
      'sandbox_event',
      'marketing_launch_preview',
      'marketing_launch_sync_contacts',
      'marketing_launch_create_draft',
      'marketing_launch_send_test',
      'marketing_launch_set_order_hold',
    ].includes(action);
    const entityAutomation = Boolean(flattened.event && flattened.data);

    let journeyBody = body;
    if (!supportedAction && !entityAutomation) {
      if (!caller || !['admin', 'owner'].includes(String(caller.role || '').toLowerCase())) {
        return Response.json({ error: 'unauthorized_scheduler_invocation' }, { status: 401 });
      }
      // Base44 recurring automations attach legacy function-form defaults. On this
      // scheduler-only surface, an authenticated platform envelope with no explicit
      // journey action is always the scheduled evaluator and nothing else.
      journeyBody = { action: 'evaluate_scheduled' };
    }

    const response = await handleCustomerJourneyRequest(base44, caller, journeyBody);
    return response || Response.json({ error: 'unsupported_action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown');
    console.error(`[customerJourneyAutomation] ${message}`);
    return Response.json({ error: 'customer_journey_scheduler_error', message }, { status: 500 });
  }
});
