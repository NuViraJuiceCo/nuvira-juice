#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const clientPath = path.join(repoRoot, 'src/api/base44Client.js');
const previewPath = path.join(
  repoRoot,
  'base44/functions/getAdminOperationsDashboardSummary/handlers/previewNativeProductionBatchLifecycle/entry.ts',
);
const executePath = path.join(
  repoRoot,
  'base44/functions/getAdminOperationsDashboardSummary/handlers/executeNativeProductionBatchLifecycle/entry.ts',
);
const criticalPath = path.join(repoRoot, 'scripts/ci/run-critical-regressions.mjs');

const clientSource = fs.readFileSync(clientPath, 'utf8');
const previewSource = fs.readFileSync(previewPath, 'utf8');
const executeSource = fs.readFileSync(executePath, 'utf8');
const criticalSource = fs.readFileSync(criticalPath, 'utf8');

const directRoutes = [
  [
    'executeNativeProductionBatchLifecycle',
    'getAdminOperationsDashboardSummary/handlers/executeNativeProductionBatchLifecycle',
  ],
  [
    'previewNativeProductionBatchLifecycle',
    'getAdminOperationsDashboardSummary/handlers/previewNativeProductionBatchLifecycle',
  ],
];

for (const [action, functionName] of directRoutes) {
  assert.match(
    clientSource,
    new RegExp(`['"]${action}['"]\\s*,\\s*['"]${functionName}['"]`),
    `${action} must route to its isolated nested production function`,
  );
}

const directLookupIndex = clientSource.indexOf('const directAdminFunction = DIRECT_ADMIN_FUNCTIONS.get(name)');
const gatewayLookupIndex = clientSource.indexOf('if (ADMIN_GATEWAY_ACTIONS.has(name)');
assert.ok(directLookupIndex >= 0, 'isolated production lifecycle route lookup must exist');
assert.ok(gatewayLookupIndex > directLookupIndex, 'isolated production lifecycle routes must run before the root admin gateway');
assert.match(
  clientSource,
  /return invokeFunction\(directAdminFunction, data, options\)/,
  'isolated production lifecycle routes must retain the authenticated SDK invocation transport',
);

for (const [label, source] of [['preview', previewSource], ['execute', executeSource]]) {
  assert.match(source, /createClientFromRequest\(req\)/, `${label} handler must authenticate from the request`);
  assert.match(source, /user\.role\s*!==\s*['"]admin['"]/, `${label} handler must require the admin role`);
  assert.match(source, /status:\s*401/, `${label} handler must retain an unauthorized response`);
  assert.match(source, /status:\s*403/, `${label} handler must retain a forbidden response`);
}

assert.match(
  criticalSource,
  /run-g165-isolated-production-lifecycle-routing-tests\.mjs/,
  'G165 isolated routing regression must remain in the critical runner',
);

assert.doesNotMatch(clientSource, /googleMerchantFeed|syncProductsToGMC/, 'production lifecycle routing must not touch Merchant functions');

console.log(JSON.stringify({
  ok: true,
  suite: 'g165-isolated-production-lifecycle-routing',
  isolated_route_count: directRoutes.length,
  admin_auth_contracts_verified: 2,
  merchant_functions_touched: false,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
