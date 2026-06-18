#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const repoRoot = process.cwd();
const functionPath = path.join(repoRoot, 'base44/functions/previewNativeOrderCutoverReadiness/entry.ts');
const source = fs.readFileSync(functionPath, 'utf8');

function loadHarness(env = {}) {
  let handler;
  const sandbox = {
    console,
    Response,
    setTimeout,
    Deno: {
      env: { get: name => env[name] || '' },
      serve: fn => { handler = fn; },
    },
    createClientFromRequest: req => req.__base44,
  };
  const runnable = source.replace("import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';", '');
  vm.runInNewContext(runnable, sandbox, { filename: functionPath });
  return { handler };
}

const normalizeText = value => String(value ?? '').trim();
const normalizeOrderNumber = value => normalizeText(value).replace(/^#/, '').toUpperCase();

function order(overrides = {}) {
  const number = normalizeOrderNumber(overrides.order_number || 'NV-CLEANSCAN');
  return {
    id: overrides.id || `ca_${number}`,
    order_number: number,
    customer_email: overrides.customer_email || 'owner@example.test',
    order_type: overrides.order_type || 'one_time',
    source_type: overrides.source_type || 'one_time',
    fulfillment_type: overrides.fulfillment_type || 'delivery',
    status: overrides.status || 'scheduled_for_juicing',
    fulfillment_status: overrides.fulfillment_status || 'pending',
    payment_status: overrides.payment_status || 'paid',
    financial_status: overrides.financial_status || 'paid',
    payment_captured: overrides.payment_captured ?? true,
    created_date: overrides.created_date || '2026-06-01T10:00:00.000Z',
    updated_date: overrides.updated_date || '2026-06-01T11:00:00.000Z',
    assigned_delivery_date: overrides.assigned_delivery_date || '2026-06-20',
    estimated_delivery_date: overrides.estimated_delivery_date || '2026-06-20',
    total: overrides.total ?? 43.99,
    items: overrides.items || [{ title: 'Hydration Shot', quantity: 3 }],
    ...overrides,
  };
}

function native(overrides = {}) {
  const number = normalizeOrderNumber(overrides.order_number || overrides.shopify_order_number || 'NV-CLEANSCAN');
  return {
    id: overrides.id || `native_${number}`,
    base44_order_id: overrides.base44_order_id ?? `ca_${number}`,
    customer_app_order_id: overrides.customer_app_order_id,
    order_number: overrides.order_number || number,
    shopify_order_number: overrides.shopify_order_number || number,
    customer_email: overrides.customer_email || 'owner@example.test',
    order_type: overrides.order_type || 'one_time',
    source_type: overrides.source_type || 'one_time',
    payment_status: overrides.payment_status || 'paid',
    financial_status: overrides.financial_status || 'paid',
    fulfillment_status: overrides.fulfillment_status || 'pending',
    production_status: overrides.production_status || 'awaiting_production',
    created_date: overrides.created_date || '2026-06-01T10:05:00.000Z',
    requested_delivery_date: overrides.requested_delivery_date || '2026-06-20',
    assigned_delivery_date: overrides.assigned_delivery_date,
    ...overrides,
  };
}

function task(overrides = {}) {
  const number = normalizeOrderNumber(overrides.order_number || overrides.shopify_order_number || 'NV-CLEANSCAN');
  return {
    id: overrides.id || `task_${number}`,
    order_id: overrides.order_id,
    base44_order_id: overrides.base44_order_id ?? `ca_${number}`,
    native_shopify_order_id: overrides.native_shopify_order_id || `native_${number}`,
    shopify_order_id: overrides.shopify_order_id,
    order_number: overrides.order_number || number,
    shopify_order_number: overrides.shopify_order_number,
    customer_email: overrides.customer_email || 'owner@example.test',
    status: overrides.status || 'pending',
    delivery_status: overrides.delivery_status || 'pending',
    production_status: overrides.production_status || 'awaiting_production',
    fulfillment_type: overrides.fulfillment_type || 'delivery',
    delivery_date: overrides.delivery_date || '2026-06-20',
    scheduled_date: overrides.scheduled_date,
    assigned_delivery_date: overrides.assigned_delivery_date,
    ...overrides,
  };
}

function rowsForSort(data, sort) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return data[sort] || data.default || [];
  return [];
}

function makeBase44({ data = {}, errors = {}, calls = [], writes = [] } = {}) {
  const entityNames = ['Order', 'ShopifyOrder', 'FulfillmentTask', 'OrderReviewQueue', 'OrderSyncLog', 'SafeSyncParityLog'];
  const entities = {};
  for (const name of entityNames) {
    entities[name] = {
      list: async (sort = '-created_date', limit = 100) => {
        calls.push({ entity: name, method: 'list', sort, limit });
        if (errors[name]) throw errors[name];
        const rows = [...rowsForSort(data[name], sort)];
        if (sort?.startsWith('-')) {
          const key = sort.slice(1);
          rows.sort((a, b) => String(b?.[key] || '').localeCompare(String(a?.[key] || '')));
        }
        return rows.slice(0, limit || rows.length);
      },
      filter: async () => {
        calls.push({ entity: name, method: 'filter' });
        throw new Error(`N+1 filter disallowed for ${name}`);
      },
      create: async row => { writes.push({ entity: name, method: 'create', row }); return row; },
      update: async (id, row) => { writes.push({ entity: name, method: 'update', id, row }); return row; },
      delete: async id => { writes.push({ entity: name, method: 'delete', id }); },
    };
  }
  return {
    auth: { me: async () => ({ role: 'admin', email: 'admin@example.test' }) },
    asServiceRole: { entities },
  };
}

function request(base44, body = {}) {
  return {
    method: 'POST',
    headers: { get: () => '' },
    text: async () => JSON.stringify({
      preview_mode: 'CUSTOMER_ORDER_SURFACE_GENERALIZED_READINESS',
      mode: 'RECENT_ORDER_SURFACE_SCAN',
      recent_created_limit: 25,
      recent_updated_limit: 25,
      related_entity_limit: 100,
      request_id: 'g43d_scan1_fixture',
      ...body,
    }),
    __base44: base44,
  };
}

async function invoke({ data, errors, env, body } = {}) {
  const calls = [];
  const writes = [];
  const { handler } = loadHarness(env || {});
  const base44 = makeBase44({ data: data || cleanData(), errors: errors || {}, calls, writes });
  const response = await handler(request(base44, body));
  return { status: response.status, json: await response.json(), calls, writes };
}

function cleanData(number = 'NV-CLEANSCAN', id = `ca_${number}`) {
  return {
    Order: { '-created_date': [order({ id, order_number: number })], '-updated_date': [] },
    ShopifyOrder: [native({ base44_order_id: id, shopify_order_number: number, id: `native_${number}` })],
    FulfillmentTask: [task({ base44_order_id: id, order_number: number, native_shopify_order_id: `native_${number}` })],
    OrderReviewQueue: [],
    OrderSyncLog: [],
    SafeSyncParityLog: [],
  };
}

function summary(json, orderNumber) {
  return json.safe_candidate_summaries.find(row => row.order_number === normalizeOrderNumber(orderNumber));
}

function assertNoCustomerUnsafePayload(json) {
  const serialized = JSON.stringify(json);
  assert.equal(serialized.includes('owner@example.test'), false);
  assert.equal(serialized.includes('other@example.test'), false);
  assert.equal(serialized.includes('admin@example.test'), false);
  assert.equal(serialized.includes('customer_email'), false);
  assert.equal(serialized.includes('phone'), false);
  assert.equal(serialized.includes('full_address'), false);
  assert.equal(serialized.includes('line_items'), false);
  assert.equal(serialized.includes('items_summary'), false);
  assert.equal(serialized.includes('raw_hub'), false);
  assert.equal(serialized.includes('raw_shopify'), false);
  assert.equal(serialized.includes('raw_stripe'), false);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('bounded reads are used instead of per-order entity queries', async () => {
  const result = await invoke();
  assert.equal(result.json.source_read_count, 7);
  assert.equal(result.calls.filter(call => call.method === 'list').length, 7);
  assert.equal(result.calls.filter(call => call.method === 'filter').length, 0);
});

test('recent-created and recent-updated orders dedupe by id', async () => {
  const row = order({ id: 'ca_DEDUPE', order_number: 'NV-DEDUPE' });
  const result = await invoke({ data: { ...cleanData('NV-DEDUPE', 'ca_DEDUPE'), Order: { '-created_date': [row], '-updated_date': [row] } } });
  assert.equal(result.json.unique_order_count, 1);
});

test('native ShopifyOrder rows join by exact base44_order_id', async () => {
  const result = await invoke();
  assert.equal(summary(result.json, 'NV-CLEANSCAN').native_shopify_order_match_count, 1);
});

test('native rows join by normalized exact order number', async () => {
  const data = cleanData('NV-ORDERNUM', 'ca_NV-ORDERNUM');
  data.ShopifyOrder = [native({ id: 'native_by_number', base44_order_id: '', shopify_order_number: '#NV-ORDERNUM' })];
  data.FulfillmentTask = [task({ id: 'task_by_number', base44_order_id: '', native_shopify_order_id: 'native_by_number', order_number: '#NV-ORDERNUM' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-ORDERNUM').classification, 'history_and_tracker_native_ready');
});

test('FulfillmentTask joins by order_id', async () => {
  const data = cleanData('NV-TASKORDERID', 'ca_NV-TASKORDERID');
  data.FulfillmentTask = [task({ id: 'task_order_id', order_id: 'ca_NV-TASKORDERID', base44_order_id: '', native_shopify_order_id: 'native_NV-TASKORDERID', order_number: 'NV-TASKORDERID' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-TASKORDERID').tracker_native_ready, true);
});

test('FulfillmentTask joins by base44_order_id', async () => {
  const result = await invoke({ data: cleanData('NV-TASKBASE44', 'ca_NV-TASKBASE44') });
  assert.equal(summary(result.json, 'NV-TASKBASE44').tracker_native_ready, true);
});

test('FulfillmentTask joins by native_shopify_order_id', async () => {
  const data = cleanData('NV-TASKNATIVE', 'ca_NV-TASKNATIVE');
  data.FulfillmentTask = [task({ id: 'task_native', base44_order_id: '', order_number: '', native_shopify_order_id: 'native_NV-TASKNATIVE' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-TASKNATIVE').tracker_native_ready, true);
});

test('FulfillmentTask joins by normalized exact order_number', async () => {
  const data = cleanData('NV-TASKNUMBER', 'ca_NV-TASKNUMBER');
  data.FulfillmentTask = [task({ id: 'task_number', base44_order_id: '', native_shopify_order_id: '', order_number: '#NV-TASKNUMBER' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-TASKNUMBER').tracker_native_ready, true);
});

test('duplicate task candidates block tracker readiness', async () => {
  const data = cleanData('NV-DUPTASK', 'ca_NV-DUPTASK');
  data.FulfillmentTask = [task({ id: 'task_a', base44_order_id: 'ca_NV-DUPTASK', order_number: 'NV-DUPTASK' }), task({ id: 'task_b', base44_order_id: 'ca_NV-DUPTASK', order_number: 'NV-DUPTASK' })];
  const result = await invoke({ data });
  const row = summary(result.json, 'NV-DUPTASK');
  assert.equal(row.history_native_ready, true);
  assert.equal(row.tracker_native_ready, false);
  assert.equal(row.classification, 'history_native_ready_tracker_identity_ambiguous');
});

test('clean history/tracker candidate classified correctly', async () => {
  const result = await invoke();
  assert.equal(summary(result.json, 'NV-CLEANSCAN').classification, 'history_and_tracker_native_ready');
});

test('history-ready task-missing order is not tracker-ready', async () => {
  const data = cleanData('NV-NOTASK', 'ca_NV-NOTASK');
  data.FulfillmentTask = [];
  const result = await invoke({ data });
  const row = summary(result.json, 'NV-NOTASK');
  assert.equal(row.history_native_ready, true);
  assert.equal(row.tracker_native_ready, false);
  assert.equal(row.classification, 'history_native_ready_tracker_task_missing');
});

test('duplicate native ShopifyOrder blocks readiness', async () => {
  const data = cleanData('NV-DUPNATIVE', 'ca_NV-DUPNATIVE');
  data.ShopifyOrder = [
    native({ id: 'native_a', base44_order_id: 'ca_NV-DUPNATIVE', shopify_order_number: 'NV-DUPNATIVE' }),
    native({ id: 'native_b', base44_order_id: 'ca_NV-DUPNATIVE', shopify_order_number: 'NV-DUPNATIVE' }),
  ];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-DUPNATIVE').classification, 'native_duplicate_identity_risk');
});

test('missing native order falls back', async () => {
  const data = cleanData('NV-MISSINGNATIVE', 'ca_NV-MISSINGNATIVE');
  data.ShopifyOrder = [];
  data.FulfillmentTask = [];
  const result = await invoke({ data });
  const row = summary(result.json, 'NV-MISSINGNATIVE');
  assert.equal(row.classification, 'native_shopify_order_missing');
  assert.equal(row.fallback_required, true);
});

test('cancelled order holds', async () => {
  const data = cleanData('NV-CANCELLED', 'ca_NV-CANCELLED');
  data.Order['-created_date'] = [order({ id: 'ca_NV-CANCELLED', order_number: 'NV-CANCELLED', status: 'cancelled' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-CANCELLED').classification, 'cancelled_payment_risk');
});

test('multi-delivery holds', async () => {
  const data = cleanData('NV-MULTI', 'ca_NV-MULTI');
  data.Order['-created_date'] = [order({ id: 'ca_NV-MULTI', order_number: 'NV-MULTI', fulfillment_mode: 'multi_delivery' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-MULTI').classification, 'subscription_multi_delivery_hub_source_of_truth');
});

test('payment mismatch holds', async () => {
  const data = cleanData('NV-PAYMISMATCH', 'ca_NV-PAYMISMATCH');
  data.ShopifyOrder = [native({ id: 'native_NV-PAYMISMATCH', base44_order_id: 'ca_NV-PAYMISMATCH', shopify_order_number: 'NV-PAYMISMATCH', payment_status: 'pending' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-PAYMISMATCH').classification, 'payment_mismatch');
});

test('fulfillment mismatch holds', async () => {
  const data = cleanData('NV-FULFILLMISMATCH', 'ca_NV-FULFILLMISMATCH');
  data.Order['-created_date'] = [order({ id: 'ca_NV-FULFILLMISMATCH', order_number: 'NV-FULFILLMISMATCH', fulfillment_status: 'pending' })];
  data.ShopifyOrder = [native({ id: 'native_NV-FULFILLMISMATCH', base44_order_id: 'ca_NV-FULFILLMISMATCH', shopify_order_number: 'NV-FULFILLMISMATCH', fulfillment_status: 'delivered' })];
  data.FulfillmentTask = [task({ id: 'task_NV-FULFILLMISMATCH', base44_order_id: 'ca_NV-FULFILLMISMATCH', order_number: 'NV-FULFILLMISMATCH', native_shopify_order_id: 'native_NV-FULFILLMISMATCH', status: 'delivered' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-FULFILLMISMATCH').classification, 'fulfillment_mismatch');
});

test('delivery-date mismatch holds', async () => {
  const data = cleanData('NV-DATEMISMATCH', 'ca_NV-DATEMISMATCH');
  data.Order['-created_date'] = [order({ id: 'ca_NV-DATEMISMATCH', order_number: 'NV-DATEMISMATCH', assigned_delivery_date: '2026-06-20', estimated_delivery_date: '2026-06-20' })];
  data.ShopifyOrder = [native({ id: 'native_NV-DATEMISMATCH', base44_order_id: 'ca_NV-DATEMISMATCH', shopify_order_number: 'NV-DATEMISMATCH', requested_delivery_date: '2026-06-21' })];
  data.FulfillmentTask = [task({ id: 'task_NV-DATEMISMATCH', base44_order_id: 'ca_NV-DATEMISMATCH', order_number: 'NV-DATEMISMATCH', native_shopify_order_id: 'native_NV-DATEMISMATCH', delivery_date: '2026-06-21' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-DATEMISMATCH').classification, 'delivery_schedule_mismatch');
});

test('refund remains Hub/payment source-of-truth', async () => {
  const data = cleanData('NV-REFUND', 'ca_NV-REFUND');
  data.Order['-created_date'] = [order({ id: 'ca_NV-REFUND', order_number: 'NV-REFUND', payment_status: 'refunded', refund_status: 'refunded' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-REFUND').classification, 'refund_payment_hub_source_of_truth');
});

test('subscription remains Hub source-of-truth', async () => {
  const data = cleanData('NV-SUB', 'ca_NV-SUB');
  data.Order['-created_date'] = [order({ id: 'ca_NV-SUB', order_number: 'NV-SUB', order_type: 'subscription', is_subscription: true })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-SUB').classification, 'subscription_multi_delivery_hub_source_of_truth');
});

test('review queue blocks readiness', async () => {
  const data = cleanData('NV-REVIEW', 'ca_NV-REVIEW');
  data.OrderReviewQueue = [{ id: 'review_1', order_id: 'ca_NV-REVIEW', order_number: 'NV-REVIEW', status: 'open' }];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-REVIEW').classification, 'review_queue_hold');
});

test('repair/replay blocks readiness', async () => {
  const data = cleanData('NV-REPAIR', 'ca_NV-REPAIR');
  data.OrderSyncLog = [{ id: 'sync_1', order_id: 'ca_NV-REPAIR', order_number: 'NV-REPAIR', action: 'repair_retry', status: 'open' }];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-REPAIR').classification, 'repair_replay_hold');
});

test('historical late mirror is held', async () => {
  const data = cleanData('NV-LATEMIRROR', 'ca_NV-LATEMIRROR');
  data.Order['-created_date'] = [order({ id: 'ca_NV-LATEMIRROR', order_number: 'NV-LATEMIRROR', created_date: '2026-05-01T00:00:00.000Z' })];
  data.ShopifyOrder = [native({ id: 'native_NV-LATEMIRROR', base44_order_id: 'ca_NV-LATEMIRROR', shopify_order_number: 'NV-LATEMIRROR', created_date: '2026-06-01T00:00:00.000Z' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-LATEMIRROR').classification, 'historical_late_mirror_hold');
});

test('source truncation prevents definitive missing-record classification', async () => {
  const data = cleanData('NV-TRUNCATED', 'ca_NV-TRUNCATED');
  data.ShopifyOrder = [native({ id: 'native_OTHER', base44_order_id: 'ca_OTHER', shopify_order_number: 'NV-OTHER' })];
  const result = await invoke({ data, body: { related_entity_limit: 1 } });
  const row = summary(result.json, 'NV-TRUNCATED');
  assert.equal(result.json.source_truncated.ShopifyOrder, true);
  assert.equal(row.classification, 'bounded_scan_context_not_found');
});

test('429 on any required source returns scan_complete:false', async () => {
  const err = Object.assign(new Error('429 Rate limit exceeded'), { status: 429 });
  const result = await invoke({ errors: { ShopifyOrder: err } });
  assert.equal(result.json.scan_complete, false);
  assert.equal(result.json.rate_limit_detected, true);
  assert.equal(result.json.next_action, 'retry_after_rate_limit_window');
});

test('partial source failure does not return generalized readiness counts as authoritative', async () => {
  const result = await invoke({ errors: { SafeSyncParityLog: new Error('database unavailable') } });
  assert.equal(result.json.scan_complete, false);
  assert.equal(result.json.history_native_ready_count, null);
  assert.equal(result.json.tracker_native_ready_count, null);
});

test('current G43B allowlist status is reported correctly', async () => {
  const result = await invoke({ env: { CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST: 'NV-CLEANSCAN' } });
  assert.equal(summary(result.json, 'NV-CLEANSCAN').currently_history_allowlisted, true);
});

test('current G43C allowlist status is reported correctly', async () => {
  const result = await invoke({ env: { CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST: 'NV-CLEANSCAN' } });
  assert.equal(summary(result.json, 'NV-CLEANSCAN').currently_tracker_allowlisted, true);
});

test('candidate counts excluding current allowlists are returned', async () => {
  const data = cleanData('NV-CLEANSCAN', 'ca_NV-CLEANSCAN');
  data.Order['-created_date'].push(order({ id: 'ca_NV-SECOND', order_number: 'NV-SECOND' }));
  data.ShopifyOrder.push(native({ id: 'native_NV-SECOND', base44_order_id: 'ca_NV-SECOND', shopify_order_number: 'NV-SECOND' }));
  data.FulfillmentTask.push(task({ id: 'task_NV-SECOND', base44_order_id: 'ca_NV-SECOND', order_number: 'NV-SECOND', native_shopify_order_id: 'native_NV-SECOND' }));
  const result = await invoke({ data, env: { CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST: 'NV-CLEANSCAN', CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST: 'NV-CLEANSCAN' } });
  assert.equal(result.json.history_native_ready_count, 2);
  assert.equal(result.json.tracker_native_ready_count, 2);
  assert.equal(result.json.history_ready_excluding_current_allowlist_count, 1);
  assert.equal(result.json.tracker_ready_excluding_current_allowlist_count, 1);
});

test('no PII returned', async () => {
  const result = await invoke();
  assertNoCustomerUnsafePayload(result.json);
  assert.equal(result.json.pii_returned, false);
});

test('no raw payload returned', async () => {
  const result = await invoke();
  assertNoCustomerUnsafePayload(result.json);
  assert.equal(result.json.raw_payloads_returned, false);
});

test('no writes', async () => {
  const result = await invoke();
  assert.equal(result.writes.length, 0);
  assert.equal(result.json.writes_performed, false);
});

test('no provider calls', async () => {
  const result = await invoke();
  assert.equal(result.json.provider_call_impact, false);
  assert.equal(result.json.safety.provider_calls_performed, false);
});

test('no notifications', async () => {
  const result = await invoke();
  assert.equal(result.json.notifications_sent, false);
  assert.equal(result.json.safety.notifications_sent, false);
});

test('no Hub mutation', async () => {
  const result = await invoke();
  assert.equal(result.json.hub_mutation_performed, false);
  assert.equal(result.json.safety.hub_records_updated, false);
});

let passed = 0;
const failures = [];
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

const result = {
  suite: 'g43d-scan1-customer-order-surface-live-readiness',
  tests: tests.length,
  passed,
  failed: failures.length,
  writes_performed: false,
  provider_call_impact: false,
  notifications_sent: false,
  hub_mutation_performed: false,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exit(1);
console.log('G43D-SCAN1 customer order surface live readiness tests passed');
