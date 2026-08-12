#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let productionPlanningHandler = async () => { throw new Error('Unexpected production planning handler call'); };

async function loadFunctions(relativePath, exportNames) {
  const filePath = path.join(repoRoot, relativePath);
  let source = fs.readFileSync(filePath, 'utf8')
    .replace(/^import .*$/gm, '')
    .replaceAll('export default async function', 'async function')
    .replaceAll('export async function', 'async function');
  source += `\nglobalThis.__exports = { ${exportNames.join(', ')} };\n`;
  const built = await transform(source, { loader: 'ts', format: 'iife', target: 'es2022' });
  const context = vm.createContext({
    console,
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
    Response,
    Request,
    Headers,
    Promise,
    setTimeout: callback => { callback(); return 0; },
    URL,
    URLSearchParams,
    fetch: async () => { throw new Error('Unexpected network request'); },
    getAdminProductionPlanningSummaryHandler: (...args) => productionPlanningHandler(...args),
    createClientFromRequest: req => req.__base44,
    buildProductionComplianceLifecycleReadModel: () => ({}),
    PRODUCTION_COMPLIANCE_READ_MODEL_VERSION: 'test',
    Deno: {
      env: { get: name => name === 'CUSTOMER_APP_SYNC_SECRET' ? 'synthetic-internal-secret' : '' },
      serve: handler => { context.globalThis.__handler = handler; },
    },
    globalThis: {},
  });
  vm.runInContext(built.code, context, { filename: filePath });
  return context.globalThis.__exports;
}

const sync = await loadFunctions('base44/functions/syncOrderToHub/entry.ts', [
  'productionMaterializationSkipReason',
  'materializePaidOrderProduction',
]);
const planning = await loadFunctions(
  'base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminProductionPlanningSummary/entry.ts',
  ['isInternalProductionMaterializationRequest'],
);

const internalBody = {
  preset: 'custom',
  date_from: '2026-08-14',
  date_to: '2026-08-14',
  operation: 'execute_batch_materialization',
  confirmation: 'materialize_native_production_batches',
  request_id: 'auto_native_production:g115',
  automation_source: 'syncOrderToHub',
  automation_order_number: 'NV-G115',
};
assert.equal(planning.isInternalProductionMaterializationRequest(
  new Request('https://example.test', { headers: { 'x-internal-secret': 'synthetic-internal-secret' } }),
  internalBody,
  internalBody.operation,
), true);
assert.equal(planning.isInternalProductionMaterializationRequest(
  new Request('https://example.test', { headers: { 'x-internal-secret': 'wrong-secret' } }),
  internalBody,
  internalBody.operation,
), false);
assert.equal(planning.isInternalProductionMaterializationRequest(
  new Request('https://example.test', { headers: { 'x-internal-secret': 'synthetic-internal-secret' } }),
  { ...internalBody, date_to: '2026-08-15' },
  internalBody.operation,
), false, 'Internal automation is constrained to one production date.');

let invokeCall = null;
let failureLogs = 0;
const base44 = {
  asServiceRole: {
    entities: {
      OrderSyncLog: { create: async () => { failureLogs += 1; } },
    },
  },
};
const paidOrder = {
  id: 'order_g115',
  order_number: 'NV-G115',
  payment_status: 'paid',
  payment_captured: true,
  production_date: '2026-08-14',
};
const materializationRequest = new Request('https://example.test/syncOrderToHub', {
  method: 'POST',
  headers: { 'x-base44-test-context': 'preserved' },
  body: '{}',
});
productionPlanningHandler = async request => {
  invokeCall = request;
  return new Response(JSON.stringify({
    success: true,
    created_count: 2,
    updated_count: 2,
    deduped_count: 0,
    blocked_count: 0,
    writes_performed: true,
    results: [{ source_order_numbers: ['NV-G115'] }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const result = await sync.materializePaidOrderProduction({
  base44,
  req: materializationRequest,
  order: paidOrder,
  eventType: 'order.created',
  source: 'customer_app_one_time',
  requestId: 'g115',
});
assert.equal(result.success, true);
assert.equal(result.created_count, 2);
assert.equal(result.updated_count, 2);
assert.equal(failureLogs, 0);
assert.equal(invokeCall.method, 'POST');
assert.equal(invokeCall.headers.get('x-internal-secret'), 'synthetic-internal-secret');
assert.equal(invokeCall.headers.get('x-base44-test-context'), 'preserved');
const invokedBody = await invokeCall.json();
assert.equal(invokedBody.gateway_action, 'getAdminProductionPlanningSummary');
assert.equal(JSON.stringify(invokedBody.payload), JSON.stringify(internalBody));

invokeCall = null;
const refundResult = await sync.materializePaidOrderProduction({
  base44,
  req: materializationRequest,
  order: paidOrder,
  eventType: 'order.refunded',
  source: 'customer_app_one_time',
  requestId: 'g115-refund',
});
assert.equal(refundResult.skipped, true);
assert.equal(refundResult.reason, 'refund_event');
assert.equal(invokeCall, null);

const posResult = await sync.materializePaidOrderProduction({
  base44,
  req: materializationRequest,
  order: paidOrder,
  eventType: 'order.created',
  source: 'shopify_pos',
  requestId: 'g115-pos',
});
assert.equal(posResult.skipped, true);
assert.equal(posResult.reason, 'pos_order');

const missingDate = await sync.materializePaidOrderProduction({
  base44,
  order: { ...paidOrder, production_date: null },
  eventType: 'order.created',
  source: 'customer_app_one_time',
  requestId: 'g115-missing-date',
});
assert.equal(missingDate.success, false);
assert.equal(missingDate.error_code, 'automatic_production_date_missing');
assert.equal(failureLogs, 1);

const missingCoverageBase44 = {
  asServiceRole: {
    entities: {
      OrderSyncLog: { create: async () => { failureLogs += 1; } },
    },
  },
};
productionPlanningHandler = async () => new Response(JSON.stringify({
  success: true,
  created_count: 0,
  updated_count: 0,
  deduped_count: 1,
  blocked_count: 0,
  writes_performed: false,
  results: [{ source_order_numbers: ['NV-SOMEONE-ELSE'] }],
}), { status: 200, headers: { 'content-type': 'application/json' } });
const missingCoverage = await sync.materializePaidOrderProduction({
  base44: missingCoverageBase44,
  req: materializationRequest,
  order: paidOrder,
  eventType: 'order.created',
  source: 'customer_app_one_time',
  requestId: 'g115-missing-coverage',
});
assert.equal(missingCoverage.success, false);
assert.equal(missingCoverage.error_code, 'automatic_order_demand_not_found');
assert.equal(missingCoverage.writes_performed, false);
assert.equal(failureLogs, 2);

let retryInvokeCount = 0;
const transientPreflightBase44 = {
  asServiceRole: {
    entities: {
      OrderSyncLog: { create: async () => { failureLogs += 1; } },
    },
  },
};
productionPlanningHandler = async () => {
  retryInvokeCount += 1;
  if (retryInvokeCount === 1) {
    return new Response(JSON.stringify({
      error: 'materialization_preflight_blocked',
      results: [{ blockers: ['materialized_demand_exceeds_current_paid_order_demand'] }],
    }), { status: 409, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({
    success: true,
    created_count: 0,
    updated_count: 0,
    deduped_count: 4,
    blocked_count: 0,
    writes_performed: false,
    results: [{ source_order_numbers: ['NV-G115'] }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const retried = await sync.materializePaidOrderProduction({
  base44: transientPreflightBase44,
  req: materializationRequest,
  order: paidOrder,
  eventType: 'order.created',
  source: 'customer_app_one_time',
  requestId: 'g115-transient-preflight',
});
assert.equal(retried.success, true);
assert.equal(retried.deduped_count, 4);
assert.equal(retried.consistency_retry_count, 1);
assert.equal(retryInvokeCount, 2);
assert.equal(failureLogs, 2, 'A recovered consistency conflict must not write a failure log.');

let persistentInvokeCount = 0;
const persistentPreflightBase44 = {
  asServiceRole: {
    entities: {
      OrderSyncLog: { create: async () => { failureLogs += 1; } },
    },
  },
};
productionPlanningHandler = async () => {
  persistentInvokeCount += 1;
  return new Response(JSON.stringify({
    error: 'materialization_preflight_blocked',
    results: [{ blockers: ['multiple_mutable_native_batches_require_review'] }],
  }), { status: 409, headers: { 'content-type': 'application/json' } });
};
const persistentlyBlocked = await sync.materializePaidOrderProduction({
  base44: persistentPreflightBase44,
  req: materializationRequest,
  order: paidOrder,
  eventType: 'order.created',
  source: 'customer_app_one_time',
  requestId: 'g115-persistent-preflight',
});
assert.equal(persistentlyBlocked.success, false);
assert.equal(persistentlyBlocked.error_code, 'automatic_production_materialization_invoke_failed:materialization_preflight_blocked');
assert.equal(persistentlyBlocked.consistency_retry_count, 2);
assert.equal(JSON.stringify(persistentlyBlocked.blockers), JSON.stringify(['multiple_mutable_native_batches_require_review']));
assert.equal(persistentInvokeCount, 3);
assert.equal(failureLogs, 3, 'A persistent conflict remains retry eligible and auditable.');

const planningSource = fs.readFileSync(path.join(repoRoot, 'base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminProductionPlanningSummary/entry.ts'), 'utf8');
const gatewaySource = fs.readFileSync(path.join(repoRoot, 'base44/functions/getAdminOperationsDashboardSummary/entry.ts'), 'utf8');
const syncSource = fs.readFileSync(path.join(repoRoot, 'base44/functions/syncOrderToHub/entry.ts'), 'utf8');
const materializationSource = syncSource.slice(0, syncSource.indexOf('function isNativeOrderOpsEnabled'));
const nativeOnlySource = syncSource.slice(syncSource.indexOf('if (body?.native_only === true)'), syncSource.indexOf('const hubApiUrl'));
const primaryOperationalSource = syncSource.slice(syncSource.indexOf('try {\n    // Keep the deployed function name'), syncSource.indexOf('if (!isLegacyHubOrderBridgeEnabled())', syncSource.indexOf('try {\n    // Keep the deployed function name')));
assert.doesNotMatch(planningSource, /automatic_order_demand_not_found/);
assert.match(planningSource, /startsWith\('auto_native_production:'\)/);
assert.match(gatewaySource, /g115-automatic-paid-order-production-batches/);
assert.match(syncSource, /production_batch_materialization: productionBatchMaterialization/);
assert.match(syncSource, /automatic_order_demand_not_found/);
assert.match(syncSource, /response\?\.error \|\| response\?\.error_code/);
assert.match(syncSource, /production_materialization_failed/);
assert.match(syncSource, /productionBatchMaterialization\?\.success === false \? 503/);
assert.match(syncSource, /retry_eligible: true/);
assert.match(syncSource, /x-internal-secret/);
assert.match(syncSource, /g115c-automatic-production-consistency-retry/);
assert.match(syncSource, /g115d-automatic-production-authenticated-fetch/);
assert.match(syncSource, /g115e-automatic-production-before-native-projection/);
assert.match(syncSource, /g115f-direct-production-materializer-composition/);
assert.match(syncSource, /isRetriableMaterializationPreflight/);
assert.match(materializationSource, /getAdminProductionPlanningSummaryHandler\(new Request/);
assert.doesNotMatch(materializationSource, /asServiceRole\.functions\.(fetch|invoke)\(/);
assert.ok(nativeOnlySource.indexOf('materializePaidOrderProduction') < nativeOnlySource.indexOf('maybeRunNativeOrderOps'));
assert.ok(primaryOperationalSource.indexOf('materializePaidOrderProduction') < primaryOperationalSource.indexOf('maybeRunNativeOrderOps'));

console.log(JSON.stringify({
  ok: true,
  suite: 'g115-automatic-paid-order-production',
  cases: 57,
  live_writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
