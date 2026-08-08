import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const supportedClientContract = JSON.parse(
  fs.readFileSync(path.resolve('config/release/supported-function-contracts.json'), 'utf8'),
);
const supportedClientFunctions = [...new Set(
  (supportedClientContract.contracts || [])
    .flatMap(contract => contract.direct_function_invocations || []),
)].sort();

const necessityManifest = fs.readFileSync(
  path.resolve('docs/audits/base44-function-necessity-manifest-2026-08-04.md'),
  'utf8',
);
const recognizedFunctionContracts = [...new Set(
  [...necessityManifest.matchAll(/^- `([A-Za-z][A-Za-z0-9_-]+)`$/gm)]
    .map(match => match[1]),
)].sort();
const recognizedFunctionSet = new Set(recognizedFunctionContracts);
const functionCreationLimit = 50;
const gatewayConsolidatedActions = [
  'adminCancelAndRefundSubscription',
  'approveZone3DeliveryRequest',
  'denyZone3DeliveryRequest',
  'executeNativeSafeSyncOrderUpdate',
  'monitorPostPaymentChain',
  'notifyOrderProcessed',
  'previewNativeSafeSyncDarkLaunchComparison',
  'previewNativeSafeSyncOrderUpdate',
  'pushMerchToShopify',
  'pushProductToShopify',
  'sendOrderSms',
  'sendUpcomingDeliveryNotifications',
  'syncShopifyOrderToHub',
  'syncSubscriptionWithFulfillments',
].sort();

const groups = {
  admin_surfaces: [
    'getAdminOperationsDashboardSummary',
    'getAdminPOSOrdersSummary',
  ],
  customer_and_commerce: [
    'calculateNuViraFulfillmentSchedule',
    'createLoyaltyMember',
    'createPaymentIntent',
    'getBagReturnsForSync',
    'getCustomerAccountDashboardData',
    'validateComplianceEntry',
  ],
  lifecycle_jobs: [
    'auditCustomerAppLoyaltyAfterPhase2',
    'autoExpireZone3Authorizations',
    'cancelAbandonedCheckouts',
    'cancelIncompleteSubscriptions',
    'customerJourneyAutomation',
    'enrollNewCustomerInLoyalty',
  ],
  order_bridge: [
    'pushOrderToShopify',
    'retryFailedHubSyncs',
    'shopifyPollFallback',
    'syncCustomerToHub',
    'syncHubDeliveryStatuses',
    'syncOrderToHub',
    'syncRefundToHub',
  ],
  transactional_communications: [
    'sendAdminOrderProcessedNotification',
    'sendCustomerNotification',
    'sendCustomerPushNotification',
    'sendOrderReceivedNotification',
    'sendOrderStatusNotification',
  ],
  catalog_and_discovery: [
    'generateSitemap',
    'googleMerchantFeed',
    'syncProductsToGMC',
  ],
  provider_edges: [
    'resendWebhook',
    'shopifyWebhookReceiver',
    'stripeWebhook',
  ],
  supported_client_contracts: supportedClientFunctions,
};

const keep = [...new Set(Object.values(groups).flat())].sort();
const functionRoot = path.resolve('base44/functions');
const local = fs.readdirSync(functionRoot)
  .filter(name => fs.existsSync(path.join(functionRoot, name, 'entry.ts')))
  .sort();
const localSet = new Set(local);
const missing = keep.filter(name => !localSet.has(name));
const unrecognized = local.filter(name => !recognizedFunctionSet.has(name));
const adminGatewayHandlerRoot = path.join(functionRoot, 'getAdminOperationsDashboardSummary', 'handlers');
const missingGatewayHandlers = gatewayConsolidatedActions.filter(name => (
  !fs.existsSync(path.join(adminGatewayHandlerRoot, name, 'entry.ts'))
));
const unconsolidatedStandaloneActions = gatewayConsolidatedActions.filter(name => localSet.has(name));

const remoteFlagIndex = process.argv.indexOf('--remote');
const remoteAppId = remoteFlagIndex >= 0 ? process.argv[remoteFlagIndex + 1] : '';
let remote = null;
if (remoteAppId) {
  const result = spawnSync('base44', ['--app-id', remoteAppId, 'functions', 'list'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Unable to list remote functions');
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const remoteNames = output
    .split(/\r?\n/)
    .map(line => line.trim().replace(/ \(\d+ automations?\)$/, ''))
    .filter(line => /^[A-Za-z][A-Za-z0-9_-]+$/.test(line))
    .filter(line => !['Fetching', 'functions'].includes(line))
    .sort();
  remote = {
    app_id: remoteAppId,
    function_count: remoteNames.length,
    retained_count: remoteNames.filter(name => keep.includes(name)).length,
    recognized_contract_count: remoteNames.filter(name => recognizedFunctionSet.has(name)).length,
    unrecognized_candidate_count: remoteNames.filter(name => !recognizedFunctionSet.has(name)).length,
    missing_keep_functions: keep.filter(name => !remoteNames.includes(name)),
    unrecognized_candidates: remoteNames.filter(name => !recognizedFunctionSet.has(name)),
    grandfathered_over_limit_by: Math.max(0, remoteNames.length - functionCreationLimit),
  };
}

console.log(JSON.stringify({
  function_creation_limit: functionCreationLimit,
  capacity_remaining: functionCreationLimit - keep.length,
  required_over_limit_by: Math.max(0, keep.length - functionCreationLimit),
  deployment_limit_exceeded: keep.length > functionCreationLimit,
  policy: 'Keep supported shipped-client contracts as physical functions and preserve internal-only capabilities as actions behind the authenticated operations gateway.',
  keep_count: keep.length,
  gateway_consolidated_action_count: gatewayConsolidatedActions.length,
  gateway_consolidated_actions: gatewayConsolidatedActions,
  missing_gateway_handlers: missingGatewayHandlers,
  unconsolidated_standalone_actions: unconsolidatedStandaloneActions,
  recognized_contract_count: recognizedFunctionContracts.length,
  local_function_count: local.length,
  missing_keep_functions: missing,
  unrecognized_candidate_count: unrecognized.length,
  groups,
  keep,
  recognized_function_contracts: recognizedFunctionContracts,
  unrecognized_candidates: unrecognized,
  remote,
}, null, 2));

if (
  missing.length > 0
  || unrecognized.length > 0
  || missingGatewayHandlers.length > 0
  || unconsolidatedStandaloneActions.length > 0
) process.exitCode = 1;
