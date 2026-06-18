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
  const number = normalizeOrderNumber(overrides.order_number || 'NV-WINDOWCLEAN');
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
    created_date: overrides.created_date || '2026-06-10T10:00:00.000Z',
    updated_date: overrides.updated_date || '2026-06-10T11:00:00.000Z',
    assigned_delivery_date: overrides.assigned_delivery_date || '2026-06-20',
    estimated_delivery_date: overrides.estimated_delivery_date || '2026-06-20',
    total: overrides.total ?? 43.99,
    items: overrides.items || [{ title: 'Hydration Shot', quantity: 3 }],
    ...overrides,
  };
}

function native(overrides = {}) {
  const number = normalizeOrderNumber(overrides.order_number || overrides.shopify_order_number || 'NV-WINDOWCLEAN');
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
    created_date: overrides.created_date || '2026-06-10T10:05:00.000Z',
    requested_delivery_date: overrides.requested_delivery_date || '2026-06-20',
    assigned_delivery_date: overrides.assigned_delivery_date,
    ...overrides,
  };
}

function task(overrides = {}) {
  const number = normalizeOrderNumber(overrides.order_number || overrides.shopify_order_number || 'NV-WINDOWCLEAN');
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
    created_date: overrides.created_date || '2026-06-10T10:10:00.000Z',
    ...overrides,
  };
}

function rowsForSort(data, sort) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return data[sort] || data.default || [];
  return [];
}

function valueInRange(value, range) {
  const text = normalizeText(value);
  if (!text) return false;
  if (range?.$gte && text < range.$gte) return false;
  if (range?.$lt && text >= range.$lt) return false;
  return true;
}

function applyFilter(rows, filter) {
  const entries = Object.entries(filter || {});
  if (!entries.length) return rows;
  return rows.filter(row => entries.every(([key, expected]) => {
    if (expected && typeof expected === 'object' && ('$gte' in expected || '$lt' in expected)) {
      return valueInRange(row?.[key], expected);
    }
    return row?.[key] === expected;
  }));
}

function sortRows(rows, sort) {
  const out = [...rows];
  if (sort?.startsWith('-')) {
    const key = sort.slice(1);
    out.sort((a, b) => String(b?.[key] || '').localeCompare(String(a?.[key] || '')));
  }
  return out;
}

function makeBase44({ data = {}, errors = {}, calls = [], writes = [] } = {}) {
  const entityNames = ['Order', 'ShopifyOrder', 'FulfillmentTask', 'OrderReviewQueue', 'OrderSyncLog', 'SafeSyncParityLog'];
  const entities = {};
  for (const name of entityNames) {
    entities[name] = {
      list: async (sort = '-created_date', limit = 100) => {
        calls.push({ entity: name, method: 'list', sort, limit });
        if (errors[name]) throw errors[name];
        return sortRows(rowsForSort(data[name], sort), sort).slice(0, limit || 100);
      },
      filter: async (filter = {}, sort = '-created_date', limit = 100) => {
        calls.push({ entity: name, method: 'filter', filter, sort, limit });
        if (errors[name]) throw errors[name];
        return sortRows(applyFilter(rowsForSort(data[name], sort), filter), sort).slice(0, limit || 100);
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
      mode: 'WINDOWED_ORDER_SURFACE_SCAN',
      order_created_from: '2026-06-01T00:00:00.000Z',
      order_created_to: '2026-07-01T00:00:00.000Z',
      order_updated_from: '2026-06-01T00:00:00.000Z',
      order_updated_to: '2026-07-01T00:00:00.000Z',
      related_context_from: '2026-06-01T00:00:00.000Z',
      related_context_to: '2026-07-01T00:00:00.000Z',
      order_limit: 25,
      related_entity_limit: 100,
      request_id: 'g43d_scan2_fixture',
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

function cleanData(number = 'NV-WINDOWCLEAN', id = `ca_${number}`) {
  return {
    Order: {
      '-created_date': [order({ id, order_number: number })],
      '-updated_date': [order({ id, order_number: number })],
    },
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
  assert.equal(serialized.includes('raw_hub'), false);
  assert.equal(serialized.includes('raw_shopify'), false);
  assert.equal(serialized.includes('raw_stripe'), false);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('nonoverlapping windows include only rows inside the requested window', async () => {
  const data = cleanData('NV-INWINDOW', 'ca_NV-INWINDOW');
  data.Order['-created_date'].push(order({ id: 'ca_NV-OLDWINDOW', order_number: 'NV-OLDWINDOW', created_date: '2026-04-01T00:00:00.000Z', updated_date: '2026-04-01T00:00:00.000Z' }));
  const result = await invoke({ data });
  assert.equal(Boolean(summary(result.json, 'NV-INWINDOW')), true);
  assert.equal(Boolean(summary(result.json, 'NV-OLDWINDOW')), false);
});

test('overlapping created and updated windows dedupe by Customer App Order id', async () => {
  const row = order({ id: 'ca_DEDUPEWINDOW', order_number: 'NV-DEDUPEWINDOW' });
  const data = cleanData('NV-DEDUPEWINDOW', 'ca_DEDUPEWINDOW');
  data.Order = { '-created_date': [row], '-updated_date': [row] };
  const result = await invoke({ data });
  assert.equal(result.json.unique_order_count, 1);
});

test('one bounded read per source per invocation is used', async () => {
  const result = await invoke();
  assert.equal(result.calls.length, 7);
  assert.equal(result.calls.every(call => call.method === 'filter'), true);
  assert.equal(result.json.source_read_count, 7);
  assert.equal(result.json.source_read_strategy.per_order_query_loop, false);
});

test('cursor continuation metadata is explicit when a bounded window truncates', async () => {
  const data = cleanData('NV-TRUNC-A', 'ca_NV-TRUNC-A');
  data.Order['-created_date'].push(order({ id: 'ca_NV-TRUNC-B', order_number: 'NV-TRUNC-B' }));
  const result = await invoke({ data, body: { order_limit: 1 } });
  assert.equal(result.json.source_truncated.window_created_orders, true);
  assert.equal(result.json.continuation_available, true);
  assert.equal(result.json.continuation_token, null);
  assert.equal(result.json.next_window, 'choose_smaller_nonoverlapping_window_or_wait_for_cursor_support');
});

test('date-window filtering is used when cursor pagination is unsupported', async () => {
  const result = await invoke();
  assert.equal(result.json.source_read_strategy.cursor_supported, false);
  assert.equal(result.json.source_read_strategy.filter_used_by_source.window_created_orders, true);
  assert.equal(result.json.candidate_horizon.order_created_from, '2026-06-01T00:00:00.000Z');
});

test('required source truncation is reported', async () => {
  const data = cleanData('NV-TRUNCATED', 'ca_NV-TRUNCATED');
  data.ShopifyOrder.push(native({ id: 'native_OTHER', base44_order_id: 'ca_OTHER', shopify_order_number: 'NV-OTHER' }));
  const result = await invoke({ data, body: { related_entity_limit: 1 } });
  assert.equal(result.json.source_truncated.ShopifyOrder, true);
  assert.ok(result.json.coverage_warning.includes('window_related_context_horizon_truncated'));
});

test('truncated context does not become definitive missing native data', async () => {
  const data = cleanData('NV-BOUNDED', 'ca_NV-BOUNDED');
  data.ShopifyOrder = [native({ id: 'native_OTHER', base44_order_id: 'ca_OTHER', shopify_order_number: 'NV-OTHER' })];
  data.FulfillmentTask = [];
  const result = await invoke({ data, body: { related_entity_limit: 1 } });
  assert.equal(summary(result.json, 'NV-BOUNDED').classification, 'bounded_scan_context_not_found');
});

test('complete clean one-time history candidate is ready', async () => {
  const result = await invoke();
  assert.equal(summary(result.json, 'NV-WINDOWCLEAN').history_native_ready, true);
});

test('complete clean tracker candidate is ready', async () => {
  const result = await invoke();
  assert.equal(summary(result.json, 'NV-WINDOWCLEAN').tracker_native_ready, true);
  assert.equal(summary(result.json, 'NV-WINDOWCLEAN').classification, 'history_and_tracker_native_ready');
});

test('missing task holds tracker only', async () => {
  const data = cleanData('NV-NOTASKWINDOW', 'ca_NV-NOTASKWINDOW');
  data.FulfillmentTask = [];
  const result = await invoke({ data });
  const row = summary(result.json, 'NV-NOTASKWINDOW');
  assert.equal(row.history_native_ready, true);
  assert.equal(row.tracker_native_ready, false);
  assert.equal(row.classification, 'history_native_ready_tracker_task_missing');
});

test('duplicate task blocks tracker readiness', async () => {
  const data = cleanData('NV-DUPTASKWINDOW', 'ca_NV-DUPTASKWINDOW');
  data.FulfillmentTask = [
    task({ id: 'task_a', base44_order_id: 'ca_NV-DUPTASKWINDOW', order_number: 'NV-DUPTASKWINDOW' }),
    task({ id: 'task_b', base44_order_id: 'ca_NV-DUPTASKWINDOW', order_number: 'NV-DUPTASKWINDOW' }),
  ];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-DUPTASKWINDOW').classification, 'history_native_ready_tracker_identity_ambiguous');
});

test('refund and cancel holds remain Hub/payment source-of-truth', async () => {
  const data = cleanData('NV-REFUNDWINDOW', 'ca_NV-REFUNDWINDOW');
  data.Order['-created_date'] = [order({ id: 'ca_NV-REFUNDWINDOW', order_number: 'NV-REFUNDWINDOW', payment_status: 'refunded', refund_status: 'refunded' })];
  const refund = await invoke({ data });
  assert.equal(summary(refund.json, 'NV-REFUNDWINDOW').classification, 'refund_payment_hub_source_of_truth');
  data.Order['-created_date'] = [order({ id: 'ca_NV-CANCELWINDOW', order_number: 'NV-CANCELWINDOW', status: 'cancelled' })];
  data.Order['-updated_date'] = [];
  data.ShopifyOrder = [native({ id: 'native_NV-CANCELWINDOW', base44_order_id: 'ca_NV-CANCELWINDOW', shopify_order_number: 'NV-CANCELWINDOW' })];
  data.FulfillmentTask = [task({ id: 'task_NV-CANCELWINDOW', base44_order_id: 'ca_NV-CANCELWINDOW', order_number: 'NV-CANCELWINDOW', native_shopify_order_id: 'native_NV-CANCELWINDOW' })];
  const cancel = await invoke({ data });
  assert.equal(summary(cancel.json, 'NV-CANCELWINDOW').classification, 'cancelled_payment_risk');
});

test('subscription and multi-delivery hold', async () => {
  const data = cleanData('NV-SUBWINDOW', 'ca_NV-SUBWINDOW');
  data.Order['-created_date'] = [order({ id: 'ca_NV-SUBWINDOW', order_number: 'NV-SUBWINDOW', order_type: 'subscription', is_subscription: true })];
  const sub = await invoke({ data });
  assert.equal(summary(sub.json, 'NV-SUBWINDOW').classification, 'subscription_multi_delivery_hub_source_of_truth');
  data.Order['-created_date'] = [order({ id: 'ca_NV-MULTIWINDOW', order_number: 'NV-MULTIWINDOW', fulfillment_mode: 'multi_delivery' })];
  data.ShopifyOrder = [native({ id: 'native_NV-MULTIWINDOW', base44_order_id: 'ca_NV-MULTIWINDOW', shopify_order_number: 'NV-MULTIWINDOW' })];
  data.FulfillmentTask = [task({ id: 'task_NV-MULTIWINDOW', base44_order_id: 'ca_NV-MULTIWINDOW', order_number: 'NV-MULTIWINDOW', native_shopify_order_id: 'native_NV-MULTIWINDOW' })];
  const multi = await invoke({ data });
  assert.equal(summary(multi.json, 'NV-MULTIWINDOW').classification, 'subscription_multi_delivery_hub_source_of_truth');
});

test('review and repair holds remain blocking', async () => {
  const data = cleanData('NV-REVIEWWINDOW', 'ca_NV-REVIEWWINDOW');
  data.OrderReviewQueue = [{ id: 'review_1', order_id: 'ca_NV-REVIEWWINDOW', order_number: 'NV-REVIEWWINDOW', status: 'open', created_date: '2026-06-10T12:00:00.000Z' }];
  const review = await invoke({ data });
  assert.equal(summary(review.json, 'NV-REVIEWWINDOW').classification, 'review_queue_hold');
  const repairData = cleanData('NV-REPAIRWINDOW', 'ca_NV-REPAIRWINDOW');
  repairData.OrderSyncLog = [{ id: 'sync_1', order_id: 'ca_NV-REPAIRWINDOW', order_number: 'NV-REPAIRWINDOW', action: 'repair_retry', status: 'open', created_date: '2026-06-10T12:00:00.000Z' }];
  const repair = await invoke({ data: repairData });
  assert.equal(summary(repair.json, 'NV-REPAIRWINDOW').classification, 'repair_replay_hold');
});

test('historical mirror chronology hold remains blocking', async () => {
  const data = cleanData('NV-LATEMIRRORWINDOW', 'ca_NV-LATEMIRRORWINDOW');
  data.Order['-created_date'] = [order({ id: 'ca_NV-LATEMIRRORWINDOW', order_number: 'NV-LATEMIRRORWINDOW', created_date: '2026-06-02T00:00:00.000Z' })];
  data.ShopifyOrder = [native({ id: 'native_NV-LATEMIRRORWINDOW', base44_order_id: 'ca_NV-LATEMIRRORWINDOW', shopify_order_number: 'NV-LATEMIRRORWINDOW', created_date: '2026-06-20T00:00:00.000Z' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-LATEMIRRORWINDOW').classification, 'historical_late_mirror_hold');
});

test('existing G43B and G43C allowlists are reported accurately', async () => {
  const result = await invoke({ env: {
    CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST: 'NV-WINDOWCLEAN',
    CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST: 'NV-WINDOWCLEAN',
  } });
  const row = summary(result.json, 'NV-WINDOWCLEAN');
  assert.equal(row.currently_history_allowlisted, true);
  assert.equal(row.currently_tracker_allowlisted, true);
});

test('candidates outside current allowlists are counted separately', async () => {
  const data = cleanData('NV-WINDOWCLEAN', 'ca_NV-WINDOWCLEAN');
  data.Order['-created_date'].push(order({ id: 'ca_NV-WINDOWSECOND', order_number: 'NV-WINDOWSECOND' }));
  data.ShopifyOrder.push(native({ id: 'native_NV-WINDOWSECOND', base44_order_id: 'ca_NV-WINDOWSECOND', shopify_order_number: 'NV-WINDOWSECOND' }));
  data.FulfillmentTask.push(task({ id: 'task_NV-WINDOWSECOND', base44_order_id: 'ca_NV-WINDOWSECOND', order_number: 'NV-WINDOWSECOND', native_shopify_order_id: 'native_NV-WINDOWSECOND' }));
  const result = await invoke({ data, env: {
    CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST: 'NV-WINDOWCLEAN',
    CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST: 'NV-WINDOWCLEAN',
  } });
  assert.equal(result.json.history_ready_excluding_current_allowlist_count, 1);
  assert.equal(result.json.tracker_ready_excluding_current_allowlist_count, 1);
});

test('429 returns scan_complete:false', async () => {
  const err = Object.assign(new Error('429 Rate limit exceeded'), { status: 429 });
  const result = await invoke({ errors: { FulfillmentTask: err } });
  assert.equal(result.json.scan_complete, false);
  assert.equal(result.json.rate_limit_detected, true);
  assert.equal(result.json.next_action, 'retry_after_rate_limit_window');
});

test('no PII or raw payloads are returned', async () => {
  const result = await invoke();
  assertNoCustomerUnsafePayload(result.json);
  assert.equal(result.json.pii_returned, false);
  assert.equal(result.json.raw_payloads_returned, false);
});

test('no writes, provider calls, notifications, or Hub mutation', async () => {
  const result = await invoke();
  assert.equal(result.writes.length, 0);
  assert.equal(result.json.writes_performed, false);
  assert.equal(result.json.provider_call_impact, false);
  assert.equal(result.json.notifications_sent, false);
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
  suite: 'g43d-scan2-windowed-customer-order-readiness',
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
console.log('G43D-SCAN2 windowed customer order readiness tests passed');
