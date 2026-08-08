#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const manifestPath = path.join(repoRoot, 'config/release/supported-function-contracts.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const contracts = Array.isArray(manifest.contracts) ? manifest.contracts : [];
const contractById = new Map(contracts.map(contract => [contract.id, contract]));
const requiredFunctions = [...new Set(contracts.flatMap(contract => contract.direct_function_invocations || []))].sort();

assert.ok(requiredFunctions.length > 0, 'supported client function contract must not be empty');

const missingStandaloneFunctions = requiredFunctions.filter(functionName => (
  !fs.existsSync(path.join(repoRoot, 'base44/functions', functionName, 'entry.ts'))
));
assert.deepEqual(
  missingStandaloneFunctions,
  [],
  `supported clients would lose standalone endpoints: ${missingStandaloneFunctions.join(', ')}`,
);

const clientSource = fs.readFileSync(path.join(repoRoot, 'src/api/base44Client.js'), 'utf8');
const gatewayHandlerRoots = [
  path.join(repoRoot, 'base44/functions/getCustomerAccountDashboardData/handlers'),
  path.join(repoRoot, 'base44/functions/getAdminOperationsDashboardSummary/handlers'),
];
const gatewayRoutedFunctions = requiredFunctions.filter(functionName => clientSource.includes(`'${functionName}'`));
const missingGatewayHandlers = gatewayRoutedFunctions.filter(functionName => (
  !gatewayHandlerRoots.some(root => fs.existsSync(path.join(root, functionName, 'entry.ts')))
));
assert.deepEqual(
  missingGatewayHandlers,
  [],
  `gateway-routed compatibility functions are missing handlers: ${missingGatewayHandlers.join(', ')}`,
);

const customerAuthCompatibilityFunctions = [
  'cancelSubscriptionFutureRenewal',
  'claimReward',
  'pauseSubscription',
  'stripeCustomerPortal',
];
for (const functionName of customerAuthCompatibilityFunctions) {
  for (const entryPath of [
    path.join(repoRoot, 'base44/functions', functionName, 'entry.ts'),
    path.join(repoRoot, 'base44/functions/getCustomerAccountDashboardData/handlers', functionName, 'entry.ts'),
  ]) {
    const source = fs.readFileSync(entryPath, 'utf8');
    assert.match(
      source,
      /auth\.me\(\)\.catch\(\(\) => null\)/,
      `${functionName} must normalize an unauthenticated lookup to a customer-safe 401 boundary`,
    );
  }
}

function readArtifact(targetPath) {
  const absolute = path.resolve(targetPath);
  assert.equal(fs.existsSync(absolute), true, `artifact path not found: ${absolute}`);
  if (fs.statSync(absolute).isFile()) return fs.readFileSync(absolute, 'utf8');

  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (/\.(?:js|mjs|html)$/.test(entry.name)) files.push(target);
    }
  }
  walk(absolute);
  assert.ok(files.length > 0, `artifact directory contains no readable web assets: ${absolute}`);
  return files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
}

const artifactChecks = [];
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] !== '--artifact') continue;
  const value = process.argv[index + 1] || '';
  index += 1;
  const separator = value.indexOf('=');
  assert.ok(separator > 0, '--artifact must use contract-id=/absolute/or/relative/path');
  const contractId = value.slice(0, separator);
  const artifactPath = value.slice(separator + 1);
  const contract = contractById.get(contractId);
  assert.ok(contract, `unknown supported client contract: ${contractId}`);
  const artifactSource = readArtifact(artifactPath);
  const missingInvocations = (contract.direct_function_invocations || [])
    .filter(functionName => !artifactSource.includes(functionName));
  assert.deepEqual(
    missingInvocations,
    [],
    `${contractId} artifact no longer matches its declared direct function contract`,
  );
  artifactChecks.push({
    contract_id: contractId,
    artifact_path: path.resolve(artifactPath),
    verified_function_count: contract.direct_function_invocations.length,
  });
}

console.log(JSON.stringify({
  ok: true,
  suite: 'g74-supported-function-contracts',
  supported_contract_count: contracts.length,
  standalone_function_count: requiredFunctions.length,
  gateway_handler_count: gatewayRoutedFunctions.length,
  artifact_checks: artifactChecks,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
