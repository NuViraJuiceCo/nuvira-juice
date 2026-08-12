#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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
    URL,
    URLSearchParams,
    fetch: async () => { throw new Error('Unexpected network request'); },
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
    functions: {
      invoke: async (...args) => {
        invokeCall = args;
        return { data: { success: true, created_count: 2, updated_count: 2, deduped_count: 0, blocked_count: 0, writes_performed: true } };
      },
    },
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
const result = await sync.materializePaidOrderProduction({
  base44,
  order: paidOrder,
  eventType: 'order.created',
  source: 'customer_app_one_time',
  requestId: 'g115',
});
assert.equal(result.success, true);
assert.equal(result.created_count, 2);
assert.equal(result.updated_count, 2);
assert.equal(failureLogs, 0);
assert.equal(invokeCall[0], 'getAdminOperationsDashboardSummary');
assert.equal(invokeCall[1].gateway_action, 'getAdminProductionPlanningSummary');
assert.equal(JSON.stringify(invokeCall[1].payload), JSON.stringify(internalBody));
assert.equal(invokeCall[2].headers['x-internal-secret'], 'synthetic-internal-secret');

invokeCall = null;
const refundResult = await sync.materializePaidOrderProduction({
  base44,
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

const planningSource = fs.readFileSync(path.join(repoRoot, 'base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminProductionPlanningSummary/entry.ts'), 'utf8');
const gatewaySource = fs.readFileSync(path.join(repoRoot, 'base44/functions/getAdminOperationsDashboardSummary/entry.ts'), 'utf8');
const syncSource = fs.readFileSync(path.join(repoRoot, 'base44/functions/syncOrderToHub/entry.ts'), 'utf8');
assert.match(planningSource, /automatic_order_demand_not_found/);
assert.match(planningSource, /startsWith\('auto_native_production:'\)/);
assert.match(gatewaySource, /g115-automatic-paid-order-production-batches/);
assert.match(syncSource, /production_batch_materialization: productionBatchMaterialization/);
assert.match(syncSource, /production_materialization_failed/);
assert.match(syncSource, /productionBatchMaterialization\?\.success === false \? 503/);
assert.match(syncSource, /retry_eligible: true/);
assert.match(syncSource, /x-internal-secret/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g115-automatic-paid-order-production',
  cases: 22,
  live_writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
