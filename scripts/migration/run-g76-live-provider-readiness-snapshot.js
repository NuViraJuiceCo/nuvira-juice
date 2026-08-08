function normalize(value) {
  if (typeof value !== 'string') return value || {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function invokeAdmin(action, payload = {}) {
  const response = await base44.functions.invoke('getAdminOperationsDashboardSummary', {
    gateway_action: action,
    payload,
  });
  return normalize(response?.data ?? response);
}

const [push, shopify, sync] = await Promise.all([
  invokeAdmin('getAdminPushDiagnostics'),
  invokeAdmin('getAdminShopifyOpsSummary'),
  invokeAdmin('getAdminSyncHealthSummary'),
]);

console.log(JSON.stringify({
  ok: push.success === true && shopify.success === true && sync.success === true,
  suite: 'g76-live-provider-readiness-snapshot',
  push: {
    diagnostics_loaded: push.success === true,
    ready: push.ready === true,
    active_subscription_count: Number(push.active_subscription_count || 0),
    active_token_types: Array.isArray(push.active_token_types) ? push.active_token_types : [],
    providers: {
      web_push_configured: push.providers?.web_push_configured === true,
      fcm_configured: push.providers?.fcm_configured === true,
      apns_configured: push.providers?.apns_configured === true,
    },
    flags: push.flags || {},
    blocked_reasons: Array.isArray(push.blocked_reasons) ? push.blocked_reasons : [],
  },
  shopify: {
    summary_loaded: shopify.success === true,
    product_source: shopify.product_source || null,
    provider_call_count: Array.isArray(shopify.provider_calls) ? shopify.provider_calls.length : Number(shopify.provider_calls || 0),
    customer_notification_sent: shopify.customer_notification_sent === true,
    inventory_mutation: shopify.inventory_mutation === true,
    purchase_order_mutation: shopify.purchase_order_mutation === true,
  },
  sync: {
    summary_loaded: sync.success === true,
    hub_available: sync.hub_available === true,
  },
  writes_requested: false,
  customer_notifications_requested: false,
  payment_actions_requested: false,
}, null, 2));
