#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function loadFunctions(relativePath, exportNames, env = {}) {
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
    createClientFromRequest: req => req.__base44,
    Deno: {
      env: { get: key => env[key] || '' },
      serve: handler => { context.globalThis.__handler = handler; },
    },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return context.globalThis.__exports;
}

const executePath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/executeNativeProductionBatchLifecycle/entry.ts';
const previewPath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/previewNativeProductionBatchLifecycle/entry.ts';
const queuePath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminProductionQueueSummary/entry.ts';
const gatewayPath = path.join(repoRoot, 'base44/functions/getAdminOperationsDashboardSummary/entry.ts');
const uiPath = path.join(repoRoot, 'src/pages/admin/ProductionQueueSummary.jsx');
const migrationPath = path.join(repoRoot, 'scripts/migration/run-g89-materialize-retroactive-production-batches.js');

const operationalBatch = {
  id: 'native_batch_1',
  batch_id: 'BATCH-20260807-RE-NU',
  product_name: 'Re-Nu',
  product_category: 'juice',
  status: 'completed_pending_verification',
  production_date: '2026-08-07',
  actual_end_time: '2026-08-07T23:00:00.000Z',
  completed_by: 'info@nuvirajuice.com',
  actual_units: 1,
  staff_on_duty: ['Amar Kahlon'],
  equipment_used: ['Cold-press juicer'],
  formula_or_recipe_used: 'Re-Nu production recipe',
  bottle_size: '12 oz',
  ingredients_used: [{ ingredient_name: 'Produce', quantity: 1, unit: 'lb', lot_number: 'LOT-G89' }],
  native_owner_status: 'native_owned_retroactive_delivered_no_customer_projection',
};

const execute = loadFunctions(executePath, [
  'envGateFailure',
  'planLifecycle',
  'customerProjectionSuppressed',
  'projectLinkedCustomerOrdersInProduction',
]);

assert.equal(execute.envGateFailure({
  action: 'start',
  batchKeys: [operationalBatch.id, operationalBatch.batch_id],
  actorEmail: 'info@nuvirajuice.com',
  batch: operationalBatch,
}), null, 'Real admin-operated batches no longer depend on temporary launch enable/email/action gates.');

const closedTestExecute = loadFunctions(executePath, ['envGateFailure'], {});
assert.equal(closedTestExecute.envGateFailure({
  action: 'start',
  batchKeys: ['BATCH-G89-TEST'],
  actorEmail: 'info@nuvirajuice.com',
  batch: { batch_id: 'BATCH-G89-TEST', is_test_batch: true },
}), 'native_production_batch_test_lifecycle_writes_disabled', 'Internal test batches retain their dedicated launch gates.');

const killSwitchExecute = loadFunctions(executePath, ['envGateFailure'], {
  NATIVE_PRODUCTION_BATCH_LIFECYCLE_KILL_SWITCH: 'true',
});
assert.equal(killSwitchExecute.envGateFailure({
  action: 'start',
  batchKeys: [operationalBatch.batch_id],
  actorEmail: 'info@nuvirajuice.com',
  batch: operationalBatch,
}), 'kill_switch_active', 'The operational kill switch remains authoritative.');

const routineVerification = execute.planLifecycle({
  action: 'verify',
  batch: operationalBatch,
  actorEmail: 'info@nuvirajuice.com',
  requestId: 'g89-routine-verification',
  now: '2026-08-08T18:00:00.000Z',
  body: {
    pH_result: 3.8,
    pH_passed_failed: 'passed',
    calibration_checked: true,
    sanitation_verification_complete: true,
    labels_applied: true,
    passed_failed: 'passed',
  },
  reason: 'Routine verification without a corrective action.',
});
assert.equal(routineVerification.blockers.length, 0, 'Routine verification does not require CCP monitoring.');
assert.equal(Object.hasOwn(routineVerification.proposed_patch, 'ccp_check_complete'), false);

const correctiveVerification = execute.planLifecycle({
  action: 'verify',
  batch: operationalBatch,
  actorEmail: 'info@nuvirajuice.com',
  requestId: 'g89-corrective-verification',
  now: '2026-08-08T18:00:00.000Z',
  body: {
    pH_result: 3.8,
    pH_passed_failed: 'passed',
    calibration_checked: true,
    sanitation_verification_complete: true,
    labels_applied: true,
    passed_failed: 'passed',
    corrective_action_required: true,
  },
  reason: 'Corrective action requires CCP confirmation.',
});
assert.ok(correctiveVerification.blockers.includes('ccp_check_required_for_corrective_action'));

assert.equal(execute.customerProjectionSuppressed(operationalBatch), true);
let orderUpdates = 0;
const terminalProjection = await execute.projectLinkedCustomerOrdersInProduction({
  base44: {
    asServiceRole: {
      entities: {
        Order: {
          update: async () => { orderUpdates += 1; },
        },
      },
    },
  },
  batch: operationalBatch,
  requestId: 'g89-terminal-order',
  now: '2026-08-08T18:00:00.000Z',
  preloadedOrders: [{ id: 'order_delivered', status: 'delivered', payment_status: 'paid', payment_captured: true }],
});
assert.equal(orderUpdates, 0, 'Delivered orders cannot be projected back into production.');
assert.equal(terminalProjection.notification_queued_count, 0);
assert.deepEqual(Array.from(terminalProjection.skips), ['terminal_or_refunded_order']);

const preview = loadFunctions(previewPath, ['planLifecycle'], {});
const previewResult = preview.planLifecycle({
  mode: 'dry_run',
  action: 'verify',
  batch: operationalBatch,
  actor_email: 'info@nuvirajuice.com',
  request_id: 'g89-preview',
  verification_input: {
    pH_result: 3.8,
    pH_passed_failed: 'passed',
    calibration_checked: true,
    sanitation_verification_complete: true,
    labels_applied: true,
    passed_failed: 'passed',
  },
});
assert.equal(previewResult.live_command_available, true);
assert.equal(previewResult.blockers.includes('ccp_check_incomplete'), false);
const previewSource = fs.readFileSync(path.join(repoRoot, previewPath), 'utf8');
assert.match(previewSource, /verification_required_fields: \['pH_result', 'pH_passed', 'calibration_checked', 'sanitation_verification_complete', 'labels_applied', 'batch_passed'\]/);
assert.match(previewSource, /verification_optional_fields: \['ccp_check_complete', 'verification_notes', 'staff_on_duty'\]/);

const queue = loadFunctions(queuePath, ['loadNativeProductionBatches', 'mergeHubAndNativeBatches']);
const gateway = fs.readFileSync(gatewayPath, 'utf8');
assert.match(gateway, /Bundle revision: g89-native-production-cutover-20260808/);
let nativeBatchSort = null;
const nativeRead = await queue.loadNativeProductionBatches({
  asServiceRole: {
    entities: {
      ProductionBatch: {
        list: async (sort, limit) => {
          nativeBatchSort = { sort, limit };
          return [{
            ...operationalBatch,
            status: 'planned',
          }];
        },
      },
    },
  },
}, '2026-08-07', '2026-08-07', 20, 'exclude');
assert.deepEqual(nativeBatchSort, { sort: '-production_date', limit: 500 }, 'The queue reads newest native batches first.');
assert.equal(nativeRead.available, true);
assert.equal(nativeRead.rows.length, 1, 'The current native batch remains visible after the bounded read.');
const merged = queue.mergeHubAndNativeBatches(
  [{ id: 'hub_row', batch_id: operationalBatch.batch_id, product_name: 'Re-Nu', production_date: '2026-08-07', status: 'planned' }],
  [{ ...operationalBatch, source: 'customer_app_native' }],
  20,
);
assert.equal(merged.length, 1, 'A mirrored native batch replaces its Hub duplicate in the Customer App queue.');
assert.equal(merged[0].source, 'customer_app_native');

const ui = fs.readFileSync(uiPath, 'utf8');
const nativeVerificationFields = ui.match(/function nativeVerificationFields\(\)[\s\S]*?\n  }/)?.[0] || '';
assert.doesNotMatch(nativeVerificationFields, /ccp_check_complete/);
assert.match(ui, /update_customer_order_status: !suppressCustomerProjection/);
assert.match(ui, /notify_customer: !suppressCustomerProjection/);

const migration = fs.readFileSync(migrationPath, 'utf8');
for (const batchId of ['BATCH-20260807-ORANGEJU', 'BATCH-20260807-PINEAPPL', 'BATCH-20260807-RE-NU']) {
  assert.match(migration, new RegExp(batchId));
}
assert.match(migration, /native_owned_retroactive_delivered_no_customer_projection/);
assert.doesNotMatch(migration, /functions\.invoke|Notification\.create|CustomerMessageDeliveryLog\.create|Order\.update|ShopifyOrder\.update|FulfillmentTask\.update/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g89-customer-app-native-production-cutover',
  checks: 26,
  writes_performed: false,
  customer_notifications_sent: false,
  provider_calls_performed: false,
}, null, 2));
