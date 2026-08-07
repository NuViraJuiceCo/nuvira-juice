#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function loadFunctions(relativePath, exportNames) {
  const filePath = path.join(repoRoot, relativePath);
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source = source.replace(/^export\s+/gm, '');
  const serveIndex = source.indexOf('Deno.serve');
  if (serveIndex >= 0) source = source.slice(0, serveIndex);
  const sharedHandlerIndex = source.indexOf('async function handleNativeOrderOpsRequest');
  if (sharedHandlerIndex >= 0) source = source.slice(0, sharedHandlerIndex);
  source += `\nglobalThis.__exports = { ${exportNames.join(', ')} };\n`;

  const context = vm.createContext({
    console,
    URL,
    URLSearchParams,
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
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return context.globalThis.__exports;
}

const processFns = loadFunctions('base44/functions/syncOrderToHub/nativeOrderOps.ts', [
  'sanitizeLineItems',
  'buildOneTimeRecord',
  'buildPosRecord',
  'createOrUpdateNativeFulfillmentTask',
]);
const previewFns = loadFunctions('base44/functions/previewNativeFulfillmentTaskMaterialization/entry.ts', ['buildTaskDraft']);
const executeFns = loadFunctions('base44/functions/executeNativeFulfillmentTaskMaterialization/entry.ts', ['buildTaskDraft']);

const paidDeliveryOrder = {
  id: 'g26d_order_001',
  shopify_order_number: 'G26D-1001',
  customer_name: 'Test Owner',
  customer_email: 'owner@example.test',
  customer_phone: '555-0100',
  payment_status: 'paid',
  payment_captured: true,
  fulfillment_method: 'delivery',
  assigned_delivery_date: '2026-06-13',
  assigned_production_day: '2026-06-12',
  delivery_window_label: '9 AM - 12 PM',
  address_line1: '123 Test St',
  address_city: 'Austin',
  address_state: 'TX',
  address_postal_code: '78701',
  address_country: 'US',
  delivery_zone_key: 'central',
  total_price: 36,
  line_items: [
    { id: 'li_1', title: 'Green Juice', quantity: 1, price: 12 },
    { id: 'li_2', title: 'Orange Juice', quantity: 2, price: 12 },
  ],
};

const lineItems = processFns.sanitizeLineItems(paidDeliveryOrder.line_items);
const oneTimeOutputs = processFns.buildOneTimeRecord({
  order: paidDeliveryOrder,
  source: 'customer_app_one_time',
  eventType: 'paid_order',
  lineItems,
  paymentStatus: 'paid',
});
const shopifyOrder = { id: 'native_shopify_order_001', shopify_order_number: 'G26D-1001' };
const taskResult = await processFns.createOrUpdateNativeFulfillmentTask({
  base44: null,
  shopifyOrder,
  outputs: oneTimeOutputs,
  idempotencyKey: 'g26d-test',
  requestId: 'req_g26d_test',
  source: 'customer_app_one_time',
  eventType: 'paid_order',
  mode: 'dry_run',
});

assert.equal(taskResult.action, 'would_create_or_update');
assert.equal(taskResult.draft.order_id, 'native_shopify_order_001');
assert.equal(taskResult.draft.base44_order_id, 'g26d_order_001');
assert.equal(taskResult.draft.shopify_order_id, 'native_shopify_order_001');
assert.equal(taskResult.draft.native_shopify_order_id, 'native_shopify_order_001');
assert.equal(taskResult.draft.shopify_order_number, 'G26D-1001');
assert.equal(taskResult.draft.order_number, 'G26D-1001');
assert.equal(taskResult.draft.customer_name, 'Test Owner');
assert.equal(taskResult.draft.customer_email, 'owner@example.test');
assert.equal(taskResult.draft.source_type, 'customer_app_one_time');
assert.equal(taskResult.draft.task_source, 'syncOrderToHub');
assert.equal(taskResult.draft.created_from_native_ops, true);
assert.equal(taskResult.draft.order_type, 'one_time');
assert.equal(taskResult.draft.schedule_source, 'native_customer_app_paid_order_mirror');
assert.equal(taskResult.draft.delivery_date, '2026-06-13');
assert.equal(taskResult.draft.production_date, '2026-06-12');
assert.equal(taskResult.draft.delivery_window_label, '9 AM - 12 PM');
assert.match(taskResult.draft.items_summary, /Green Juice/);
assert.equal(taskResult.draft.line_item_count, 2);
assert.equal(taskResult.draft.total_price, 36);
assert.equal(taskResult.draft.address_complete, true);
assert.equal(taskResult.draft.delivery_zone_key, 'central');

const posOutputs = processFns.buildPosRecord({
  order: { id: 'pos_1', shopify_order_number: 'POS-1', line_items: paidDeliveryOrder.line_items },
  source: 'shopify_pos',
  eventType: 'paid_order',
  lineItems,
  paymentStatus: 'paid',
});
const posTask = await processFns.createOrUpdateNativeFulfillmentTask({
  base44: null,
  shopifyOrder: { id: 'native_pos_1', shopify_order_number: 'POS-1' },
  outputs: posOutputs,
  idempotencyKey: 'pos-test',
  requestId: 'req-pos',
  source: 'shopify_pos',
  eventType: 'paid_order',
  mode: 'dry_run',
});
assert.equal(posTask.action, 'not_required');

const missingDeliveryOutputs = processFns.buildOneTimeRecord({
  order: { ...paidDeliveryOrder, assigned_delivery_date: '', estimated_delivery_date: '', requested_delivery_date: '' },
  source: 'customer_app_one_time',
  eventType: 'paid_order',
  lineItems,
  paymentStatus: 'paid',
});
const missingDeliveryTask = await processFns.createOrUpdateNativeFulfillmentTask({
  base44: null,
  shopifyOrder,
  outputs: missingDeliveryOutputs,
  idempotencyKey: 'missing-delivery-test',
  requestId: 'req-missing',
  source: 'customer_app_one_time',
  eventType: 'paid_order',
  mode: 'dry_run',
});
assert.equal(missingDeliveryTask.action, 'skipped');
assert.equal(missingDeliveryTask.reason, 'missing_delivery_date');

let updateCalls = 0;
let createCalls = 0;
const existingTaskResult = await processFns.createOrUpdateNativeFulfillmentTask({
  base44: {
    asServiceRole: {
      entities: {
        FulfillmentTask: {
          filter: async () => [{ id: 'existing_task_001', order_id: shopifyOrder.id }],
          update: async () => { updateCalls += 1; throw new Error('update should not be called'); },
          create: async () => { createCalls += 1; throw new Error('create should not be called'); },
        },
      },
    },
  },
  shopifyOrder,
  outputs: oneTimeOutputs,
  idempotencyKey: 'existing-test',
  requestId: 'req-existing',
  source: 'customer_app_one_time',
  eventType: 'paid_order',
  mode: 'live',
});
assert.equal(existingTaskResult.action, 'deduped_existing_task_not_backfilled');
assert.equal(updateCalls, 0);
assert.equal(createCalls, 0);

const previewDraft = previewFns.buildTaskDraft({
  id: 'native_shopify_order_002',
  base44_order_id: 'g26d_order_002',
  shopify_order_number: 'G26D-1002',
  customer_name: 'Preview Owner',
  customer_email: 'preview@example.test',
  source_channel: 'online',
  source_type: 'customer_app_one_time',
  order_type: 'one_time',
  assigned_production_day: '2026-06-14',
  delivery_window_label: '12 PM - 3 PM',
  address_line1: '456 Test St',
  address_city: 'Austin',
  address_state: 'TX',
  address_postal_code: '78702',
  delivery_zone_key: 'north',
  total_price: 44,
  line_items: paidDeliveryOrder.line_items,
}, { delivery_date: '2026-06-15', request_id: 'preview_req' });
assert.equal(previewDraft.base44_order_id, 'g26d_order_002');
assert.equal(previewDraft.native_shopify_order_id, 'native_shopify_order_002');
assert.equal(previewDraft.production_date, '2026-06-14');
assert.equal(previewDraft.line_item_count, 2);
assert.equal(previewDraft.address_complete, true);
assert.equal(previewDraft.task_source, 'previewNativeFulfillmentTaskMaterialization');

const executeDraft = executeFns.buildTaskDraft({
  id: 'native_shopify_order_003',
  base44_order_id: 'g26d_order_003',
  shopify_order_number: 'G26D-1003',
  customer_name: 'Execute Owner',
  customer_email: 'execute@example.test',
  source_channel: 'online',
  source_type: 'customer_app_one_time',
  order_type: 'one_time',
  assigned_production_day: '2026-06-16',
  address_line1: '789 Test St',
  address_city: 'Austin',
  address_state: 'TX',
  address_postal_code: '78703',
  total_price: 55,
  line_items: paidDeliveryOrder.line_items,
}, { delivery_date: '2026-06-17' }, 'execute_req', 'admin@example.test');
assert.equal(executeDraft.base44_order_id, 'g26d_order_003');
assert.equal(executeDraft.production_date, '2026-06-16');
assert.equal(executeDraft.task_source, 'executeNativeFulfillmentTaskMaterialization');

console.log('G26D native task metadata tests passed.');
