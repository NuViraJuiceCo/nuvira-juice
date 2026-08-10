// @ts-nocheck
// Bundle revision: g103-premium-program-journey-20260809.
// Bundle revision: g101-delivery-only-customer-order-copy-20260809 (retained regression provenance).
import handler0 from './handlers/addressSuggest/entry.ts';
import handler2 from './handlers/cancelSubscriptionFutureRenewal/entry.ts';
import handler3 from './handlers/claimReward/entry.ts';
import handler4 from './handlers/completeAccountSetup/entry.ts';
import handler5 from './handlers/createZone3AuthorizationIntent/entry.ts';
import handler6 from './handlers/getCustomerAccountDashboardData/entry.ts';
import handler7 from './handlers/getCustomerNotifications/entry.ts';
import handler8 from './handlers/getCustomerOrderDetail/entry.ts';
import handler9 from './handlers/getDeliveryEta/entry.ts';
import handler10 from './handlers/getOrderBySession/entry.ts';
import handler11 from './handlers/pauseSubscription/entry.ts';
import handler12 from './handlers/registerPushSubscription/entry.ts';
import handler13 from './handlers/requestAccountDeletion/entry.ts';
import handler14 from './handlers/resolveShopifyCartPermalink/entry.ts';
import handler15 from './handlers/stripeCustomerPortal/entry.ts';
import handler16 from './handlers/syncUserToHub/entry.ts';
import handler17 from './handlers/unregisterPushSubscription/entry.ts';
import handler18 from './handlers/validateDeliveryEligibility/entry.ts';
import handler19 from './handlers/createZone3SubscriptionReviewRequest/entry.ts';
import handler20 from './handlers/createSubscriptionPaymentElementIntent/entry.ts';
import handler21 from './handlers/manageProgramJourney/entry.ts';

const HANDLERS = {
  "addressSuggest": handler0,
  "cancelSubscriptionFutureRenewal": handler2,
  "claimReward": handler3,
  "completeAccountSetup": handler4,
  "createZone3AuthorizationIntent": handler5,
  "getCustomerAccountDashboardData": handler6,
  "getCustomerNotifications": handler7,
  "getCustomerOrderDetail": handler8,
  "getDeliveryEta": handler9,
  "getOrderBySession": handler10,
  "pauseSubscription": handler11,
  "registerPushSubscription": handler12,
  "requestAccountDeletion": handler13,
  "resolveShopifyCartPermalink": handler14,
  "stripeCustomerPortal": handler15,
  "syncUserToHub": handler16,
  "unregisterPushSubscription": handler17,
  "validateDeliveryEligibility": handler18,
  "createZone3SubscriptionReviewRequest": handler19,
  "createSubscriptionPaymentElementIntent": handler20,
  "manageProgramJourney": handler21,
};

const DEFAULT_ACTION = 'getCustomerAccountDashboardData';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });

  const rawBody = await req.text();
  let body = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const requestedAction = typeof body.gateway_action === 'string' ? body.gateway_action : DEFAULT_ACTION;
  console.log(
    `[customerGateway] route=${requestedAction} explicit_action=${typeof body.gateway_action === 'string'} has_payload=${Boolean(body.payload && typeof body.payload === 'object')}`,
  );
  const handler = HANDLERS[requestedAction];
  if (!handler) return Response.json({ error: 'unsupported_customer_operation' }, { status: 400 });

  const payload = body.gateway_action ? (body.payload ?? {}) : body;
  const forwarded = new Request(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(payload),
  });
  const response = await handler(forwarded);
  return response instanceof Response
    ? response
    : Response.json({ error: 'customer_operation_returned_no_response' }, { status: 500 });
});
