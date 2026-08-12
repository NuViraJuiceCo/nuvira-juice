#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const planningPath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminProductionPlanningSummary/entry.ts';
const executePath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/executeNativeProductionBatchLifecycle/entry.ts';
const previewPath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/previewNativeProductionBatchLifecycle/entry.ts';
const uiPath = 'src/pages/admin/ProductionPlanning.jsx';
const gatewayPath = 'base44/functions/getAdminOperationsDashboardSummary/entry.ts';

function loadFunctions(relativePath, exportNames) {
  const filePath = path.join(repoRoot, relativePath);
  let source = fs.readFileSync(filePath, 'utf8')
    .replace(/^import .*$/gm, '')
    .replaceAll('req: Request', 'req')
    .replace('export default async function handler(req)', 'async function handler(req)');
  source += `\nglobalThis.__exports = { ${exportNames.join(', ')} };\n`;
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
    Promise,
    URL,
    URLSearchParams,
    fetch: async () => { throw new Error('Unexpected network request'); },
    createClientFromRequest: req => req.__base44,
    buildProductionComplianceLifecycleReadModel: () => ({}),
    PRODUCTION_COMPLIANCE_READ_MODEL_VERSION: 'test',
    Deno: {
      env: { get: () => '' },
      serve: handler => { context.globalThis.__handler = handler; },
    },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return context.globalThis.__exports;
}

const planning = loadFunctions(planningPath, [
  'materializationDrafts',
  'materializationDraftReady',
  'executeBatchMaterialization',
  'loadMaterializationProductionBatches',
  'productionBatchId',
  'supplementalProductionBatchId',
]);

const orderSource = {
  order_id: 'native_order_1',
  order_number: 'NV-G92-1',
  customer_email: 'synthetic@example.test',
  customer_name: 'Synthetic Customer',
  quantity: 2,
  source_type: 'direct',
  source_item: 'Aura',
};
const nativePlanning = {
  dates: [{
    production_date: '2026-08-10',
    product_groups: [{
      product_name: 'Aura',
      planned_units: 2,
      order_sources: [orderSource],
      related_orders: ['native_order_1'],
    }],
  }],
};
const nativeBatch = {
  id: 'production_batch_1',
  batch_id: 'BATCH-20260810-AURA',
  product_name: 'Aura',
  product_category: 'juice',
  production_date: '2026-08-10',
  status: 'planned',
  planned_units: 2,
  is_locked: false,
  order_sources: [orderSource],
  related_orders: ['native_order_1'],
  source_system: 'customer_app_native',
  native_owner_status: 'native_owned_order_demand',
};

assert.equal(planning.productionBatchId('2026-08-10', 'Aura'), 'BATCH-20260810-AURA');
await assert.rejects(() => planning.loadMaterializationProductionBatches({
  asServiceRole: {
    entities: {
      ProductionBatch: { filter: async () => { throw new Error('Synthetic read failure'); } },
    },
  },
}, nativePlanning), /Synthetic read failure/, 'Existing-batch reads fail closed instead of becoming an empty result.');
const createDraft = planning.materializationDrafts(nativePlanning, [])[0];
assert.equal(createDraft.action, 'create_planned_batch');
assert.equal(planning.materializationDraftReady(createDraft), true);
assert.equal(createDraft._write.order_sources[0].customer_app_order_id, undefined, 'Only schema-supported order source fields are persisted.');

const foreignConflict = planning.materializationDrafts(nativePlanning, [{
  ...nativeBatch,
  source_system: 'legacy_hub',
  native_owner_status: 'hub_mirror',
}])[0];
assert.equal(foreignConflict.action, 'blocked');
assert.ok(foreignConflict.blockers.includes('existing_batch_not_native_materialization_owned'));

const exactExisting = planning.materializationDrafts(nativePlanning, [nativeBatch])[0];
assert.equal(exactExisting.action, 'already_materialized');
assert.equal(planning.materializationDraftReady(exactExisting), false);
const exactStarted = planning.materializationDrafts(nativePlanning, [{ ...nativeBatch, status: 'in_production' }])[0];
assert.equal(exactStarted.action, 'already_materialized', 'A started exact batch is not resized and does not block the queue.');

const eventStockBatch = {
  ...nativeBatch,
  id: 'event_stock_batch_1',
  batch_id: 'EVENT-20260810-COMMUNITY-AURA',
  planned_units: 5,
  order_sources: [{
    order_id: 'event_1',
    order_number: 'EVENT-COMMUNITY-20260811',
    customer_name: 'Community Event',
    quantity: 5,
    source_type: 'event_stock',
    source_item: 'Aura',
  }],
  related_orders: [],
  source_system: 'customer_app_native_event_stock',
  native_owner_status: 'native_owned_event_stock',
};
const mixedDemandDraft = planning.materializationDrafts(nativePlanning, [eventStockBatch])[0];
assert.equal(mixedDemandDraft.action, 'update_existing_planned_batch');
assert.equal(mixedDemandDraft.batch_id, eventStockBatch.batch_id, 'Same-day event stock and paid-order demand share one physical batch.');
assert.equal(mixedDemandDraft.planned_units, 7);
assert.equal(mixedDemandDraft._write.order_sources.length, 2);
assert.equal(mixedDemandDraft._write.source_system, 'customer_app_native_mixed_demand');
assert.equal(mixedDemandDraft._write.native_owner_status, 'native_owned_mixed_demand');

const mixedDemandBatch = {
  ...eventStockBatch,
  planned_units: 7,
  order_sources: mixedDemandDraft._write.order_sources,
  related_orders: mixedDemandDraft._write.related_orders,
  source_system: mixedDemandDraft._write.source_system,
  native_owner_status: mixedDemandDraft._write.native_owner_status,
};
const mixedReplay = planning.materializationDrafts(nativePlanning, [mixedDemandBatch])[0];
assert.equal(mixedReplay.action, 'already_materialized');
assert.equal(mixedReplay.planned_units, 7);
const mixedWithArchivedDuplicate = planning.materializationDrafts(nativePlanning, [
  mixedDemandBatch,
  { ...nativeBatch, id: 'archived_duplicate', status: 'archived', order_sources: [], related_orders: [] },
])[0];
assert.equal(mixedWithArchivedDuplicate.action, 'already_materialized', 'Archived consolidation remnants never split later demand into another batch.');

const increasedPlanning = structuredClone(nativePlanning);
increasedPlanning.dates[0].product_groups[0].planned_units = 3;
increasedPlanning.dates[0].product_groups[0].order_sources[0].quantity = 3;
const changedStarted = planning.materializationDrafts(increasedPlanning, [{ ...nativeBatch, status: 'in_production' }])[0];
assert.equal(changedStarted.action, 'create_planned_batch');
assert.match(changedStarted.batch_id, /^BATCH-20260810-AURA-ADD-[A-F0-9]{8}$/);
assert.equal(changedStarted.planned_units, 1, 'Only late incremental demand is placed into the supplemental batch.');
assert.equal(changedStarted._write.order_sources[0].quantity, 1);

const decreasedPlanning = structuredClone(nativePlanning);
decreasedPlanning.dates[0].product_groups[0].planned_units = 1;
decreasedPlanning.dates[0].product_groups[0].order_sources[0].quantity = 1;
const decreasedPlanned = planning.materializationDrafts(decreasedPlanning, [nativeBatch])[0];
assert.equal(decreasedPlanned.action, 'update_existing_planned_batch', 'A not-started native draft may be reduced to current paid demand.');
assert.equal(decreasedPlanned.planned_units, 1);
const decreasedStarted = planning.materializationDrafts(decreasedPlanning, [{ ...nativeBatch, status: 'in_production' }])[0];
assert.equal(decreasedStarted.action, 'blocked');
assert.ok(decreasedStarted.blockers.includes('materialized_demand_exceeds_current_paid_order_demand'));

const supplementalBatch = {
  ...nativeBatch,
  id: 'production_batch_supplemental',
  batch_id: changedStarted.batch_id,
  status: 'planned',
  planned_units: changedStarted.planned_units,
  order_sources: changedStarted._write.order_sources,
  related_orders: changedStarted._write.related_orders,
};
const supplementalReplay = planning.materializationDrafts(increasedPlanning, [
  { ...nativeBatch, status: 'in_production' },
  supplementalBatch,
])[0];
assert.equal(supplementalReplay.action, 'already_materialized');
assert.equal(planning.materializationDraftReady(supplementalReplay), false);

const duplicateDraft = planning.materializationDrafts(nativePlanning, [nativeBatch, { ...nativeBatch, id: 'production_batch_2' }])[0];
assert.equal(duplicateDraft.action, 'blocked');
assert.ok(duplicateDraft.blockers.includes('duplicate_batch_id_requires_review'));

const oversizedPlanning = structuredClone(nativePlanning);
oversizedPlanning.dates[0].product_groups[0].planned_units = 501;
oversizedPlanning.dates[0].product_groups[0].order_sources = Array.from({ length: 501 }, (_, index) => ({
  ...orderSource,
  order_id: `native_order_${index}`,
  order_number: `NV-G92-${index}`,
  quantity: 1,
}));
const oversizedDraft = planning.materializationDrafts(oversizedPlanning, [])[0];
assert.equal(oversizedDraft.action, 'blocked');
assert.ok(oversizedDraft.blockers.includes('order_source_limit_requires_review'), 'Exact order linkage is never silently truncated.');

const callOrder = [];
let createdBatch = null;
const createBase44 = {
  asServiceRole: {
    entities: {
      ProductionBatch: {
        filter: async () => {
          callOrder.push('batch_filter');
          return createdBatch ? [createdBatch] : [];
        },
        create: async payload => {
          callOrder.push('batch_create');
          createdBatch = { id: 'production_batch_created', ...payload };
          return createdBatch;
        },
        update: async () => { throw new Error('Unexpected batch update'); },
      },
      CommandLog: {
        create: async payload => {
          callOrder.push('command_create');
          return { id: 'command_1', ...payload };
        },
        update: async (id, payload) => {
          callOrder.push('command_update');
          return { id, ...payload };
        },
      },
    },
  },
};
const createResults = await planning.executeBatchMaterialization({
  base44: createBase44,
  user: { email: 'admin@example.test', role: 'admin' },
  requestId: 'g92-create',
  drafts: [createDraft],
});
assert.equal(createResults[0].action, 'created');
assert.equal(createResults[0].writes_performed, true);
assert.equal(createdBatch.source_system, 'customer_app_native');
assert.equal(createdBatch.native_owner_status, 'native_owned_order_demand');
assert.deepEqual(callOrder, ['batch_filter', 'command_create', 'batch_create', 'batch_filter', 'command_update']);

let updatedMixedBatch = null;
const mixedUpdateResults = await planning.executeBatchMaterialization({
  base44: {
    asServiceRole: {
      entities: {
        ProductionBatch: {
          filter: async () => updatedMixedBatch ? [updatedMixedBatch] : [eventStockBatch],
          create: async () => { throw new Error('Unexpected mixed batch create'); },
          update: async (id, payload) => {
            updatedMixedBatch = { ...eventStockBatch, id, ...payload };
            return updatedMixedBatch;
          },
        },
        CommandLog: {
          create: async payload => ({ id: 'mixed_command', ...payload }),
          update: async (id, payload) => ({ id, ...payload }),
        },
      },
    },
  },
  user: { email: 'system@example.test', role: 'service', actor_type: 'system' },
  requestId: 'g92-mixed-update',
  drafts: [mixedDemandDraft],
});
assert.equal(mixedUpdateResults[0].action, 'updated');
assert.equal(updatedMixedBatch.planned_units, 7);
assert.equal(updatedMixedBatch.source_system, 'customer_app_native_mixed_demand');
assert.equal(updatedMixedBatch.native_owner_status, 'native_owned_mixed_demand');

let writesAfterAuditFailure = 0;
await assert.rejects(() => planning.executeBatchMaterialization({
  base44: {
    asServiceRole: {
      entities: {
        ProductionBatch: {
          filter: async () => [],
          create: async () => { writesAfterAuditFailure += 1; },
        },
        CommandLog: { create: async () => { throw new Error('Synthetic audit failure'); } },
      },
    },
  },
  user: { email: 'admin@example.test', role: 'admin' },
  requestId: 'g92-audit-failure',
  drafts: [createDraft],
}), /Synthetic audit failure/);
assert.equal(writesAfterAuditFailure, 0, 'A ProductionBatch is never written when the durable audit claim fails.');

let replayBatchWrites = 0;
const replayResults = await planning.executeBatchMaterialization({
  base44: {
    asServiceRole: {
      entities: {
        ProductionBatch: {
          filter: async () => [nativeBatch],
          create: async () => { replayBatchWrites += 1; },
          update: async () => { replayBatchWrites += 1; },
        },
        CommandLog: {
          create: async payload => ({ id: 'command_replay', ...payload }),
          update: async () => ({}),
        },
      },
    },
  },
  user: { email: 'admin@example.test', role: 'admin' },
  requestId: 'g92-replay',
  drafts: [exactExisting],
});
assert.equal(replayResults[0].action, 'deduped_existing_batch');
assert.equal(replayBatchWrites, 0);

const execute = loadFunctions(executePath, ['findBatch', 'customerProjectionSuppressed']);
await assert.rejects(() => execute.findBatch({
  asServiceRole: {
    entities: {
      ProductionBatch: {
        get: async () => nativeBatch,
        filter: async () => [nativeBatch, { ...nativeBatch, id: 'duplicate' }],
      },
    },
  },
}, nativeBatch.id), /multiple_production_batch_matches/);
await assert.rejects(() => execute.findBatch({
  asServiceRole: {
    entities: {
      ProductionBatch: {
        get: async () => nativeBatch,
        filter: async () => { throw new Error('Synthetic duplicate-check read failure'); },
      },
    },
  },
}, nativeBatch.id), /Synthetic duplicate-check read failure/);
assert.equal(execute.customerProjectionSuppressed({
  native_owner_status: 'native_owned_retroactive_delivered_no_customer_projection',
}), true, 'Burton-style retroactive delivered batches remain customer-notification suppressed.');

const planningSource = fs.readFileSync(path.join(repoRoot, planningPath), 'utf8');
const previewSource = fs.readFileSync(path.join(repoRoot, previewPath), 'utf8');
const uiSource = fs.readFileSync(path.join(repoRoot, uiPath), 'utf8');
const gatewaySource = fs.readFileSync(path.join(repoRoot, gatewayPath), 'utf8');
assert.match(planningSource, /if \(user\.role !== 'admin'\)/, 'Interactive materialization remains server-side admin only.');
assert.match(planningSource, /isInternalProductionMaterializationRequest/);
assert.match(planningSource, /automatic_order_demand_not_found/);
assert.match(planningSource, /customer_app_native_mixed_demand/);
assert.match(planningSource, /confirmation !== MATERIALIZATION_CONFIRMATION/);
assert.match(planningSource, /inventory_mutation: false/);
assert.match(planningSource, /notifications_sent: false/);
assert.match(planningSource, /provider_calls_performed: false/);
assert.match(planningSource, /hub_calls_performed: false/);
assert.match(planningSource, /native_demand_source_unavailable/);
assert.match(planningSource, /cross_isolate_unique_create_guarantee: false/);
assert.match(previewSource, /currentBatch = suppliedKey[\s\S]*ProductionBatch\.get/, 'Lifecycle preview reloads the database record instead of trusting a UI-supplied batch.');
assert.match(uiSource, /preview_batch_materialization/);
assert.match(uiSource, /execute_batch_materialization/);
assert.match(uiSource, /materialize_native_production_batches/);
assert.doesNotMatch(uiSource, /startProductionBatchForCustomerApp/);
assert.match(gatewaySource, /Bundle revision: g95-customer-app-operational-authority-20260808/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g92-native-production-batch-materialization',
  cases: 33,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
