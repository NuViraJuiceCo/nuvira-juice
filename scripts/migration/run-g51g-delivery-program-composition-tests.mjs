#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const deliveryQueueSource = fs.readFileSync(path.join(repoRoot, 'src/pages/admin/DeliveryQueue.jsx'), 'utf8');
const preOptimizeOrderCardSource = fs.readFileSync(path.join(repoRoot, 'src/components/driver/PreOptimizeOrderCard.jsx'), 'utf8');

function loadExports(relativePath, exportNames) {
  const functionPath = path.join(repoRoot, relativePath);
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
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
    Response,
    Promise,
    createClientFromRequest: req => req.__base44,
    fetch: async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    Deno: {
      env: { get: () => '' },
      serve: handler => {
        context.globalThis.__handler = handler;
      },
    },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return context.globalThis.__exports;
}

const hydrationLineItems = [
  { id: 'li_hydration', product_id: 'prod_hydration', title: 'Hydration Program (3-Day)', quantity: 1, price: 144 },
];
const radianceLineItems = [
  { id: 'li_radiance', product_id: 'prod_radiance', title: 'Radiance Program (3-Day)', quantity: 2, price: 144 },
];
const resetLineItems = [
  { id: 'li_reset', product_id: 'prod_reset', title: 'Reset Program (3-Day)', quantity: 1, price: 144 },
];

function baseDeliveryOrder(lineItems = hydrationLineItems) {
  return {
    id: 'shopify_program_order',
    base44_order_id: 'customer_order_program',
    shopify_order_number: 'NV-PROGRAM',
    order_number: 'NV-PROGRAM',
    customer_name: 'Program Customer',
    customer_email: 'program@example.test',
    fulfillment_method: 'delivery',
    payment_status: 'paid',
    production_status: 'awaiting_production',
    assigned_delivery_date: '2026-07-22',
    selected_delivery_date: '2026-07-22',
    requested_delivery_date: '2026-07-22',
    production_date: '2026-07-21',
    delivery_window_label: '5 PM - 8 PM',
    address_line1: '1 Test Way',
    address_city: 'Wentzville',
    address_state: 'MO',
    address_postal_code: '63385',
    delivery_address: '1 Test Way, Wentzville, MO 63385',
    line_items: lineItems,
    total_price: 151.99,
  };
}

const results = [];

{
  const { operationalSummaryFromText, sanitizeStop, lineItemsSummary, operationalLineItemCount } = loadExports(
    'base44/functions/getAdminDeliveryRouteSummary/entry.ts',
    ['operationalSummaryFromText', 'sanitizeStop', 'lineItemsSummary', 'operationalLineItemCount'],
  );

  assert.equal(operationalSummaryFromText('1x Hydration Program (3-Day)'), '9x OASIS, 3x AURA');
  assert.equal(operationalSummaryFromText('Hydration Program (3-Day) ×2'), '18x OASIS, 6x AURA');
  assert.equal(operationalSummaryFromText('1x Radiance Program (3-Day)'), '9x AURA, 3x OASIS');
  assert.equal(operationalSummaryFromText('Reset Program (3-Day) ×1'), '9x RE-NU, 3x OASIS');
  assert.equal(lineItemsSummary(hydrationLineItems), '9x OASIS, 3x AURA');
  assert.equal(operationalLineItemCount({ order: { line_items: hydrationLineItems } }), 2);
  assert.equal(operationalLineItemCount({ task: { items_summary: '1x Hydration Program (3-Day)' } }), 2);
  assert.equal(sanitizeStop({ order_number: 'NV-PROGRAM', items_summary: 'Hydration Program (3-Day) ×1' }).items_summary, '9x OASIS, 3x AURA');
  results.push('route_summary_expands_program_text_prefix_and_suffix');
  results.push('route_summary_sanitizer_canonicalizes_stale_program_summary');
  results.push('route_summary_counts_program_components');
}

{
  assert.match(deliveryQueueSource, /function itemsSummaryToDriverItems/);
  assert.match(deliveryQueueSource, /items: itemsSummaryToDriverItems\(stop\.items_summary\)/);
  assert.equal(deliveryQueueSource.includes("items: stop.items_summary ? [{ title: stop.items_summary, quantity: 1 }] : []"), false);
  assert.match(preOptimizeOrderCardSource, /function driverItemLine/);
  assert.match(preOptimizeOrderCardSource, /if \(quantity === null \|\| quantity === undefined \|\| quantity === ''\) return title;/);
  results.push('delivery_queue_driver_adapter_parses_operational_summary_items');
  results.push('pre_optimize_driver_card_omits_fake_quantity_for_summary_rows');
}

for (const [label, relativePath] of [
  ['preview_materialization', 'base44/functions/previewNativeFulfillmentTaskMaterialization/entry.ts'],
  ['execute_materialization', 'base44/functions/executeNativeFulfillmentTaskMaterialization/entry.ts'],
]) {
  const { lineItemsSummary, taskItemsFromOrder, buildTaskDraft } = loadExports(relativePath, [
    'lineItemsSummary',
    'taskItemsFromOrder',
    'buildTaskDraft',
  ]);
  const order = baseDeliveryOrder();
  const items = taskItemsFromOrder(order);
  assert.equal(lineItemsSummary(order.line_items), '9x OASIS, 3x AURA');
  assert.deepEqual(items.map(item => [item.title, item.quantity]), [['OASIS', 9], ['AURA', 3]]);
  const draft = buildTaskDraft(order, { delivery_date: '2026-07-22', production_date: '2026-07-21' }, 'g51g_request', 'admin@example.test');
  assert.equal(draft.items_summary, '9x OASIS, 3x AURA');
  assert.equal(draft.line_item_count, 2);
  results.push(`${label}_expands_hydration_program_into_delivery_task_items`);
}

for (const [label, relativePath] of [
  ['preview_metadata_repair', 'base44/functions/previewNativeFulfillmentTaskMetadataRepair/entry.ts'],
  ['execute_metadata_repair', 'base44/functions/executeNativeFulfillmentTaskMetadataRepair/entry.ts'],
]) {
  const { sourceMetadata, buildMetadataRepairPlan } = loadExports(relativePath, ['sourceMetadata', 'buildMetadataRepairPlan']);
  const hydration = sourceMetadata({ task: {}, nativeOrder: baseDeliveryOrder(), customerOrder: {} });
  assert.equal(hydration.items_summary, '9x OASIS, 3x AURA');
  assert.equal(hydration.line_item_count, 2);

  const radiance = sourceMetadata({ task: {}, nativeOrder: baseDeliveryOrder(radianceLineItems), customerOrder: {} });
  assert.equal(radiance.items_summary, '18x AURA, 6x OASIS');
  assert.equal(radiance.line_item_count, 2);

  const reset = sourceMetadata({ task: {}, nativeOrder: baseDeliveryOrder(resetLineItems), customerOrder: {} });
  assert.equal(reset.items_summary, '9x RE-NU, 3x OASIS');
  assert.equal(reset.line_item_count, 2);

  const stalePlan = buildMetadataRepairPlan({
    task: {
      id: 'task_program',
      order_id: 'shopify_program_order',
      base44_order_id: 'customer_order_program',
      shopify_order_number: 'NV-PROGRAM',
      order_number: 'NV-PROGRAM',
      native_shopify_order_id: 'shopify_program_order',
      shopify_order_id: 'shopify_program_order',
      source_channel: 'customer_app',
      source_type: 'customer_app_one_time',
      schedule_source: 'native_customer_app_paid_order_mirror',
      task_source: 'native_fulfillment_task_metadata_repair',
      created_from_native_ops: true,
      scheduled_date: '2026-07-22',
      assigned_delivery_date: '2026-07-22',
      production_date: '2026-07-21',
      fulfillment_type: 'delivery',
      payment_status: 'paid',
      production_status: 'awaiting_production',
      sync_status: 'native_task_metadata_repaired',
      address: '1 Test Way, Wentzville, MO 63385',
      address_line1: '1 Test Way',
      address_city: 'Wentzville',
      address_state: 'MO',
      address_postal_code: '63385',
      address_complete: true,
      time_window: '5 PM - 8 PM',
      delivery_window_label: '5 PM - 8 PM',
      total_price: 151.99,
      items_summary: '1x Hydration Program (3-Day)',
      line_item_count: 1,
    },
    nativeOrder: baseDeliveryOrder(),
    customerOrder: { id: 'customer_order_program', order_number: 'NV-PROGRAM' },
  });
  assert.equal(stalePlan.patch.items_summary, '9x OASIS, 3x AURA');
  assert.equal(stalePlan.patch.line_item_count, 2);
  assert.deepEqual(Array.from(stalePlan.stale_existing_fields_repaired), ['items_summary', 'line_item_count']);
  results.push(`${label}_repairs_program_task_summary_to_bottle_counts`);
  results.push(`${label}_refreshes_stale_program_task_summary`);
}

{
  const { g33cTask1ItemsSummary, g33cTask1BuildPacket } = loadExports(
    'base44/functions/previewNativeOrderCutoverReadiness/entry.ts',
    ['g33cTask1ItemsSummary', 'g33cTask1BuildPacket'],
  );
  assert.equal(g33cTask1ItemsSummary(hydrationLineItems), '9x OASIS, 3x AURA');
  const { packet } = g33cTask1BuildPacket({
    customerOrder: {
      ...baseDeliveryOrder(),
      id: 'customer_order_program',
      order_number: 'NV-PROGRAM',
      payment_captured: true,
      fulfillment_type: 'delivery',
    },
    nativeOrder: { id: 'shopify_program_order', shopify_order_number: '#NV-PROGRAM' },
    orderNumber: 'NV-PROGRAM',
    projection: {
      taskStatus: 'pending',
      taskDeliveryStatus: 'pending',
      taskProductionStatus: 'new',
    },
  });
  assert.equal(packet.items_summary, '9x OASIS, 3x AURA');
  assert.deepEqual(packet.items.map(item => [item.title, item.quantity]), [['OASIS', 9], ['AURA', 3]]);
  results.push('g33c_one_time_task_packet_uses_operational_bottle_counts');
}

console.log(JSON.stringify({
  suite: 'G51G delivery program composition regression',
  passed: results.length,
  failed: 0,
  results,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
