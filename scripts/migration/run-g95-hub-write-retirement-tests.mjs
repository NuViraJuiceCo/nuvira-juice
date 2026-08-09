#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const results = [];
const pass = name => results.push(name);

function loadStandaloneNoop(relativePath, env = {}) {
  let source = read(relativePath)
    .replace(/^import .*$/gm, '')
    .replace(/const data: any/g, 'const data');
  let handler = null;
  const context = vm.createContext({
    console,
    Response,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    RegExp,
    JSON,
    Error,
    Promise,
    Intl,
    URL,
    URLSearchParams,
    Headers,
    Deno: {
      env: { get: key => env[key] || '' },
      serve: value => { handler = value; },
    },
  });
  vm.runInContext(source, context, { filename: path.join(root, relativePath) });
  return handler;
}

const syncOrder = read('base44/functions/syncOrderToHub/entry.ts');
const nativeProjectionIndex = syncOrder.indexOf('const nativeOrderOps = await maybeRunNativeOrderOps');
const retiredGateIndex = syncOrder.indexOf('if (!isLegacyHubOrderBridgeEnabled())', nativeProjectionIndex);
const externalFetchIndex = syncOrder.indexOf('const response = await fetch(hubApiUrl', retiredGateIndex);
assert.ok(nativeProjectionIndex >= 0);
assert.ok(retiredGateIndex > nativeProjectionIndex);
assert.ok(externalFetchIndex > retiredGateIndex);
assert.match(syncOrder, /ENABLE_LEGACY_HUB_ORDER_BRIDGE/);
assert.match(syncOrder, /hub_action: 'retired_no_external_sync'/);
assert.match(syncOrder, /hub_operational_dependency: false/);
assert.match(syncOrder, /external_calls_performed: false/);
pass('order_projection_runs_before_default_off_legacy_bridge');

const retryHandler = loadStandaloneNoop('base44/functions/retryFailedHubSyncs/entry.ts');
assert.equal(typeof retryHandler, 'function');
const retryResponse = await retryHandler({ method: 'POST' });
const retryPayload = await retryResponse.json();
assert.equal(retryResponse.status, 200);
assert.equal(retryPayload.retired, true);
assert.equal(retryPayload.retried, 0);
assert.equal(retryPayload.external_calls_performed, false);
pass('scheduled_legacy_order_retry_is_a_zero_read_zero_network_noop_by_default');

const deliveryHandler = loadStandaloneNoop('base44/functions/syncHubDeliveryStatuses/entry.ts');
assert.equal(typeof deliveryHandler, 'function');
const deliveryResponse = await deliveryHandler({ method: 'POST', text: async () => '' });
const deliveryPayload = await deliveryResponse.json();
assert.equal(deliveryResponse.status, 200);
assert.equal(deliveryPayload.retired, true);
assert.equal(deliveryPayload.updated, 0);
assert.equal(deliveryPayload.updated_fulfillment_tasks, 0);
assert.equal(deliveryPayload.external_calls_performed, false);
pass('scheduled_legacy_delivery_pull_is_a_zero_read_zero_network_noop_by_default');

function loadShopifyAutomationRetirementHandler() {
  let source = read('base44/functions/getAdminOperationsDashboardSummary/handlers/syncShopifyOrderToHub/entry.ts')
    .replace(/^import .*$/gm, '')
    .replace(/\(req: Request\)/, '(req)')
    .replace('export default async', 'globalThis.__handler = async');
  let networkCount = 0;
  const context = vm.createContext({
    console,
    Response,
    Headers,
    Deno: { env: { get: () => '' } },
    createClientFromRequest: req => req.__base44,
    fetch: async () => { networkCount += 1; throw new Error('unexpected network'); },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: 'syncShopifyOrderToHub/entry.ts' });
  return { handler: context.globalThis.__handler, networkCount: () => networkCount };
}

const shopifyAutomation = loadShopifyAutomationRetirementHandler();
const shopifyResponse = await shopifyAutomation.handler({
  headers: new Headers(),
  __base44: { auth: { me: async () => ({ role: 'admin', email: 'operator@example.test' }) } },
  json: async () => ({ id: 'synthetic_shopify_order_1' }),
});
const shopifyPayload = await shopifyResponse.json();
assert.equal(shopifyResponse.status, 200);
assert.equal(shopifyPayload.retired, true);
assert.equal(shopifyPayload.hub_operational_dependency, false);
assert.equal(shopifyPayload.external_calls_performed, false);
assert.equal(shopifyAutomation.networkCount(), 0);
pass('shopify_automation_name_is_retained_as_an_authenticated_no_network_boundary');

const receiver = read('base44/functions/shopifyWebhookReceiver/entry.ts');
const retiredHelperStart = receiver.indexOf('async function syncIngestedOrderToHub');
const retiredHelperEnd = receiver.indexOf('\nDeno.serve', retiredHelperStart);
const retiredHelper = receiver.slice(retiredHelperStart, retiredHelperEnd);
assert.ok(retiredHelperStart >= 0 && retiredHelperEnd > retiredHelperStart);
assert.doesNotMatch(retiredHelper, /functions\.(?:fetch|invoke)|\bfetch\s*\(/);
assert.match(retiredHelper, /hub_operational_dependency: false/);
assert.match(retiredHelper, /external_calls_performed: false/);
pass('shopify_ingestion_preserves_native_processing_without_external_hub_projection');

const stripe = read('base44/functions/stripeWebhook/entry.ts');
assert.equal((stripe.match(/functions\.invoke\('syncOrderToHub'/g) || []).length, 3);
assert.equal((stripe.match(/native_order_projection_failed/g) || []).length, 3);
assert.doesNotMatch(stripe, /failed to sync to Hub immediately after webhook/);
pass('all_three_stripe_projection_callers_reject_nonthrowing_failure_responses');

const zone3 = read('base44/functions/getAdminOperationsDashboardSummary/handlers/approveZone3DeliveryRequest/entry.ts');
assert.match(zone3, /projectionResult\?\.success !== true/);
assert.match(zone3, /native_order_projection_failed/);
pass('zone3_capture_projection_rejects_nonthrowing_failure_responses');

const refund = read('base44/functions/syncRefundToHub/entry.ts');
const manualRefund = read('base44/functions/processManualRefund/entry.ts');
const manualRefundGateway = read('base44/functions/getAdminOperationsDashboardSummary/handlers/processManualRefund/entry.ts');
assert.match(refund, /native_authoritative/);
assert.match(refund, /external_calls_performed/);
for (const source of [manualRefund, manualRefundGateway]) {
  assert.match(source, /CustomerApp\.operational_refund_projection/);
  assert.match(source, /native_operational_projection_attempted: true/);
  assert.match(source, /hub_sync_attempted: false/);
  assert.match(source, /functions\.fetch\('\/syncRefundToHub'/);
  assert.match(source, /'x-internal-secret'/);
  assert.doesNotMatch(source, /functions\.invoke\('syncRefundToHub',[\s\S]*?headers:\s*\{\s*'x-internal-secret'/);
}
assert.match(manualRefund, /internal_secret:\s*Deno\.env\.get\('LOYALTY_LEDGER_SECRET'\)/);
assert.doesNotMatch(manualRefund, /functions\.invoke\('enrollNewCustomerInLoyalty',[\s\S]*?\},\s*\{\s*headers:/);
pass('manual_refund_contract_reports_native_projection_without_claiming_hub_sync');

const subscriptionGateway = read('base44/functions/getAdminOperationsDashboardSummary/handlers/syncSubscriptionWithFulfillments/entry.ts');
const subscriptionRetirementGate = subscriptionGateway.indexOf("ENABLE_LEGACY_HUB_SUBSCRIPTION_BRIDGE");
const subscriptionHubFetch = subscriptionGateway.indexOf('const hubResponse = await fetch(hubUrl');
assert.ok(subscriptionRetirementGate >= 0 && subscriptionHubFetch > subscriptionRetirementGate);
assert.match(subscriptionGateway, /NATIVE_SUBSCRIPTION_FULFILLMENT_NOT_READY/);
assert.match(subscriptionGateway, /hub_operational_dependency: false/);
assert.match(stripe, /function legacyHubSubscriptionBridgeEnabled\(\)/);
assert.equal((stripe.match(/if \(legacyHubSubscriptionBridgeEnabled\(\)\)/g) || []).length, 3);
pass('legacy_subscription_bridge_is_default_off_while_native_subscription_checkout_remains_blocked');

const adjustmentStandalone = read('base44/functions/processManualRefund/customerOrderAdjustment.ts');
const adjustmentGateway = read('base44/functions/getAdminOperationsDashboardSummary/handlers/processManualRefund/customerOrderAdjustment.ts');
assert.equal(adjustmentStandalone, adjustmentGateway);
for (const source of [adjustmentStandalone, adjustmentGateway]) {
  assert.doesNotMatch(source, /receiveCustomerAppEvent|preflightAdjustmentOnHub|syncAdjustmentToHub|customer_adjustment_hub_pending|hub_retry_required/);
  assert.match(source, /preflightAdjustmentInCustomerApp/);
  assert.match(source, /native_operational_state_locked/);
  assert.match(source, /native_projection_status: 'success'/);
}
pass('customer_order_adjustments_preflight_and_complete_against_customer_app_entities_only');

const routePreview = read('base44/functions/getAdminOperationsDashboardSummary/handlers/optimizeDeliveryRoute/entry.ts');
assert.match(routePreview, /source_mode: 'customer_app_native_manifest'/);
assert.match(routePreview, /native_delivery_stops_required/);
assert.match(routePreview, /hub_operational_dependency: false/);
assert.doesNotMatch(routePreview, /HUB_API_URL|CUSTOMER_APP_SYNC_SECRET|getOrderUpdatesForCustomerApp|ENABLE_DELIVERY_ROUTE_LEGACY_FETCH/);
assert.doesNotMatch(routePreview, /entities\.(?:Order|ShopifyOrder|FulfillmentTask|UserProfile)\.(?:list|filter|get|create|update|delete)/);
pass('route_preview_uses_only_the_customer_app_native_manifest_and_never_reads_hub');

const gateway = read('base44/functions/getAdminOperationsDashboardSummary/entry.ts');
assert.match(gateway, /Bundle revision: g95-customer-app-operational-authority-20260808/);
assert.match(gateway, /RETIRED_LEGACY_HUB_ACTIONS/);
assert.match(gateway, /legacy_hub_action_retired/);
for (const retiredAction of [
  'startAdminProductionBatch',
  'completeAdminProductionBatch',
  'verifyAdminProductionBatch',
  'markAdminFulfillmentTaskOutForDelivery',
  'recordAdminFulfillmentTaskDelivered',
  'updateAdminFulfillmentTaskAssignment',
  'getAdminSyncHealthSummary',
  'updateAdminOpsAlertStatus',
]) {
  assert.match(gateway, new RegExp(`'${retiredAction}'`));
}
for (const nativeAction of [
  'executeNativeProductionBatchLifecycle',
  'executeNativeFulfillmentTaskLifecycle',
  'saveAdminComplianceRecord',
  'optimizeDeliveryRoute',
]) {
  assert.doesNotMatch(
    gateway.match(/const RETIRED_LEGACY_HUB_ACTIONS = new Set\(\[[\s\S]*?\]\);/)?.[0] || '',
    new RegExp(`'${nativeAction}'`),
  );
}
pass('gateway_fails_closed_for_hidden_legacy_mutations_but_preserves_native_workflows');

for (const rewardPath of [
  'base44/functions/claimReward/entry.ts',
  'base44/functions/getCustomerAccountDashboardData/handlers/claimReward/entry.ts',
]) {
  const rewardSource = read(rewardPath);
  assert.doesNotMatch(rewardSource, /HUB_API_URL|customer-app-sync\/reward-claims|Hub sync/);
  assert.match(rewardSource, /source: 'customer_app_native'/);
  assert.match(rewardSource, /hub_operational_dependency: false/);
}
const loyaltyEnrollment = read('base44/functions/createLoyaltyMember/entry.ts');
assert.doesNotMatch(loyaltyEnrollment, /HUB_API_URL|customer-app-sync\/enroll-loyalty|Enrolled in hub/);
assert.match(loyaltyEnrollment, /Customer App profile projection/);
assert.match(read('base44/functions/getCustomerAccountDashboardData/entry.ts'), /Bundle revision: g95-customer-app-loyalty-authority-20260808/);
pass('reward_selection_and_new_member_enrollment_are_customer_app_native_only');

const posSummary = read('base44/functions/getAdminPOSOrdersSummary/entry.ts');
const posClaims = read('base44/functions/getAdminPOSOrdersSummary/claimManager.ts');
const historicalGateIndex = posSummary.indexOf('if (includeHubHistoricalContext && HUB_API_URL && CUSTOMER_APP_SYNC_SECRET)');
const posHubFetchIndex = posSummary.indexOf('getPOSOrdersForCustomerApp');
assert.ok(historicalGateIndex >= 0 && posHubFetchIndex > historicalGateIndex);
assert.match(posSummary, /customer_app_native_authoritative: true/);
assert.match(posSummary, /hub_operational_dependency: false/);
assert.match(posSummary, /include_hub_historical_context: includeHubHistoricalContext/);
assert.doesNotMatch(posClaims, /HUB_API_URL|receiveLoyaltySignup|hubRequest\(/);
assert.match(posClaims, /idempotency_key: `loyalty_signup:\$\{userEmail\}`/);
assert.match(posClaims, /idempotency_key: `pos_claim:\$\{claim\.id\}:purchase_history`/);
pass('pos_summary_and_claim_activation_are_customer_app_native_with_hub_history_explicit_only');

console.log(JSON.stringify({
  success: true,
  suite: 'g95-hub-write-retirement',
  cases: results.length,
  results,
  writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
  external_hub_calls_performed: false,
}, null, 2));
