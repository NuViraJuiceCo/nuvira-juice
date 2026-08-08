#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, 'src');
const clientPath = path.join(sourceRoot, 'api/base44Client.js');
const adminGatewayEntryPath = path.join(repoRoot, 'base44/functions/getAdminOperationsDashboardSummary/entry.ts');
const customerGatewayEntryPath = path.join(repoRoot, 'base44/functions/getCustomerAccountDashboardData/entry.ts');
const adminHandlerRoot = path.join(repoRoot, 'base44/functions/getAdminOperationsDashboardSummary/handlers');
const customerHandlerRoot = path.join(repoRoot, 'base44/functions/getCustomerAccountDashboardData/handlers');

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(target));
    else if (/\.(?:js|jsx|ts|tsx)$/.test(entry.name)) files.push(target);
  }
  return files;
}

function literalInvocations(source) {
  return [...source.matchAll(/base44\.functions\.invoke\(\s*['"]([A-Za-z][A-Za-z0-9_]*)['"]/g)].map(match => match[1]);
}

function gatewayMapKeys(source) {
  return new Set([...source.matchAll(/^\s*"([A-Za-z][A-Za-z0-9_]*)":\s*handler\d+,?$/gm)].map(match => match[1]));
}

const frontendFiles = walk(sourceRoot);
const invocationLocations = new Map();
let dynamicInvocationCount = 0;
for (const file of frontendFiles) {
  const source = fs.readFileSync(file, 'utf8');
  dynamicInvocationCount += [...source.matchAll(/base44\.functions\.invoke\(\s*(?!['"])/g)].length;
  for (const functionName of literalInvocations(source)) {
    const locations = invocationLocations.get(functionName) || [];
    locations.push(path.relative(repoRoot, file));
    invocationLocations.set(functionName, locations);
  }
}

const productionQueueDynamicContracts = [
  'previewAdminProductionBatchStart',
  'previewAdminProductionBatchComplete',
  'previewAdminProductionBatchVerify',
  'startAdminProductionBatch',
  'completeAdminProductionBatch',
  'verifyAdminProductionBatch',
];
assert.equal(dynamicInvocationCount, 2, 'unexpected dynamic Base44 function invocation added; declare and validate its bounded contract');
for (const functionName of productionQueueDynamicContracts) {
  const locations = invocationLocations.get(functionName) || [];
  locations.push('src/pages/admin/ProductionQueueSummary.jsx (bounded dynamic action map)');
  invocationLocations.set(functionName, locations);
}

const clientSource = fs.readFileSync(clientPath, 'utf8');
const adminGatewaySource = fs.readFileSync(adminGatewayEntryPath, 'utf8');
const customerGatewaySource = fs.readFileSync(customerGatewayEntryPath, 'utf8');
const adminMappedActions = gatewayMapKeys(adminGatewaySource);
const customerMappedActions = gatewayMapKeys(customerGatewaySource);
const mappedActions = new Set([...adminMappedActions, ...customerMappedActions]);

const failures = [];
const routes = [];
for (const [functionName, locations] of [...invocationLocations.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const standalonePath = path.join(repoRoot, 'base44/functions', functionName, 'entry.ts');
  const standalone = fs.existsSync(standalonePath);
  const clientRouted = clientSource.includes(`'${functionName}'`);
  const adminHandler = fs.existsSync(path.join(adminHandlerRoot, functionName, 'entry.ts'));
  const customerHandler = fs.existsSync(path.join(customerHandlerRoot, functionName, 'entry.ts'));
  const handlerPresent = adminHandler || customerHandler;
  const mapped = mappedActions.has(functionName);
  const gatewayReady = clientRouted && handlerPresent && mapped;

  routes.push({
    function_name: functionName,
    mode: gatewayReady ? 'gateway' : standalone ? 'standalone' : 'broken',
    locations: [...new Set(locations)].sort(),
  });

  if (!standalone && !gatewayReady) {
    failures.push({ function_name: functionName, locations: [...new Set(locations)].sort(), client_routed: clientRouted, handler_present: handlerPresent, gateway_mapped: mapped });
  }
  if (clientRouted && (!handlerPresent || !mapped)) {
    failures.push({ function_name: functionName, locations: [...new Set(locations)].sort(), client_routed: true, handler_present: handlerPresent, gateway_mapped: mapped });
  }
}

assert.deepEqual(failures, [], `frontend function routing contains unavailable contracts: ${JSON.stringify(failures)}`);
assert.match(clientSource, /gateway_action:\s*name/, 'frontend client must forward gateway_action');

const retiredSyncHealthActions = [
  'previewAdminHistoricalHubBackfill',
  'previewHistoricalHubFulfilledNativeBackfill',
  'backfillHistoricalHubFulfilledNativeShopifyOrderForCustomerApp',
  'previewHistoricalCustomerOrderFulfillmentBackfillImpact',
  'previewNativeProductionInventoryReadiness',
  'previewNativeProductionDemandMaterialization',
  'previewNativeProductionVerifyCascades',
  'previewNativeCustomerStatusNotificationImpact',
  'previewNativeScheduleExceptionCorrection',
  'previewNativeDeliveryWorkflowReadiness',
  'previewNativeDeliveryCompletionReconciliation',
  'previewNativeProductionMasterDataParity',
];
const frontendSource = frontendFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
const leakedRetiredActions = retiredSyncHealthActions.filter(action => frontendSource.includes(`invoke('${action}'`) || frontendSource.includes(`invoke("${action}"`));
assert.deepEqual(leakedRetiredActions, [], `retired one-off Sync Health actions remain callable: ${leakedRetiredActions.join(', ')}`);

const posOrdersSource = fs.readFileSync(path.join(sourceRoot, 'pages/admin/POSOrders.jsx'), 'utf8');
assert.match(posOrdersSource, /action:\s*'preview_import'/, 'POS customer profile preview must call the read-only import preview contract');
assert.doesNotMatch(posOrdersSource, /\{\s*preset,\s*limit:\s*100\s*\}/, 'POS operational summary must not request a response-size-unsafe 100-row window');

const gatewayRoutes = routes.filter(route => route.mode === 'gateway');
const standaloneRoutes = routes.filter(route => route.mode === 'standalone');
console.log(JSON.stringify({
  ok: true,
  suite: 'g75-live-function-routing-integrity',
  frontend_invocation_count: routes.length,
  dynamic_invocation_site_count: dynamicInvocationCount,
  bounded_dynamic_contract_count: productionQueueDynamicContracts.length,
  gateway_route_count: gatewayRoutes.length,
  standalone_route_count: standaloneRoutes.length,
  retired_sync_health_action_count: retiredSyncHealthActions.length,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
