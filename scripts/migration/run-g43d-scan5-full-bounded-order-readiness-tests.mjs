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
  const number = normalizeOrderNumber(overrides.order_number || 'NV-SCAN5-CLEAN');
  return {
    id: overrides.id || `ca_${number}`,
    order_number: number,
    customer_email: overrides.customer_email || 'owner@example.test',
    phone: overrides.phone || '555-000-0000',
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
  const number = normalizeOrderNumber(overrides.order_number || overrides.shopify_order_number || 'NV-SCAN5-CLEAN');
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
  const number = normalizeOrderNumber(overrides.order_number || overrides.shopify_order_number || 'NV-SCAN5-CLEAN');
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
    created_date: overrides.created_date || '2026-06-01T10:10:00.000Z',
    ...overrides,
  };
}

function sortRows(rows, sort = '-created_date') {
  const out = [...(rows || [])];
  if (sort?.startsWith('-')) {
    const key = sort.slice(1);
    out.sort((a, b) => String(b?.[key] || '').localeCompare(String(a?.[key] || '')));
  }
  return out;
}

function exactFilter(rows, filter) {
  const entries = Object.entries(filter || {}).filter(([, value]) => normalizeText(value));
  if (!entries.length) return [];
  return (rows || []).filter(row => entries.every(([key, value]) => row?.[key] === value));
}

function cleanData(number = 'NV-SCAN5-CLEAN', id = `ca_${number}`) {
  return {
    Order: [order({ id, order_number: number })],
    ShopifyOrder: [native({ id: `native_${number}`, base44_order_id: id, shopify_order_number: number })],
    FulfillmentTask: [task({ id: `task_${number}`, base44_order_id: id, order_number: number, native_shopify_order_id: `native_${number}` })],
    OrderReviewQueue: [],
    OrderSyncLog: [],
    SafeSyncParityLog: [],
  };
}

function full52Data() {
  const data = { Order: [], ShopifyOrder: [], FulfillmentTask: [], OrderReviewQueue: [], OrderSyncLog: [], SafeSyncParityLog: [] };
  for (let i = 0; i < 52; i += 1) {
    const number = i === 0 ? 'NV-MQHJR3V2' : i === 1 ? 'NV-MPZNKGNT' : i === 2 ? 'NV-MP5SOQLJ' : `NV-SCAN5-${String(i).padStart(3, '0')}`;
    const id = i === 0 ? '6a321cbfd8d78863f15de956' : `ca_${number}`;
    const created = i === 2 ? '2026-05-14T18:01:24.576Z' : `2026-06-${String(18 - (i % 20)).padStart(2, '0')}T10:00:00.000Z`;
    data.Order.push(order({ id, order_number: number, created_date: created, updated_date: created }));
    data.ShopifyOrder.push(native({ id: `native_${number}`, base44_order_id: id, shopify_order_number: number, created_date: i === 2 ? '2026-06-17T12:00:00.000Z' : created }));
    if (i !== 10) data.FulfillmentTask.push(task({ id: `task_${number}`, base44_order_id: id, order_number: number, native_shopify_order_id: `native_${number}`, created_date: created }));
  }
  return data;
}

function makeBase44({ data = cleanData(), errors = {}, calls = [], writes = [] } = {}) {
  const entityNames = ['Order', 'ShopifyOrder', 'FulfillmentTask', 'OrderReviewQueue', 'OrderSyncLog', 'SafeSyncParityLog'];
  const entities = {};
  for (const name of entityNames) {
    entities[name] = {
      list: async (sort = '-created_date', limit = 100) => {
        calls.push({ entity: name, method: 'list', sort, limit });
        if (errors[name]) throw errors[name];
        return sortRows(data[name] || [], sort).slice(0, limit || 100);
      },
      filter: async (filter = {}, sort = '-created_date', limit = 20) => {
        calls.push({ entity: name, method: 'filter', filter, sort, limit });
        if (errors[`${name}Filter`]) throw errors[`${name}Filter`];
        return sortRows(exactFilter(data[name] || [], filter), sort).slice(0, limit || 20);
      },
      create: async row => { writes.push({ entity: name, method: 'create', row }); return row; },
      update: async (id, row) => { writes.push({ entity: name, method: 'update', id, row }); return row; },
      delete: async id => { writes.push({ entity: name, method: 'delete', id }); return id; },
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
      mode: 'FULL_BOUNDED_ORDER_SURFACE_SCAN',
      order_limit: 100,
      related_entity_limit: 100,
      request_id: 'g43d_scan5_fixture',
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

function summary(json, orderNumber) {
  const rows = json.safe_candidate_summaries || [];
  return rows.find(row => row.order_number === normalizeOrderNumber(orderNumber));
}

function assertNoUnsafePayload(json) {
  const serialized = JSON.stringify(json);
  for (const forbidden of ['owner@example.test', 'other@example.test', 'admin@example.test', 'customer_email', 'phone', 'full_address', 'raw_hub', 'raw_shopify', 'raw_stripe', 'payment_method', 'items', 'line_items']) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked`);
  }
  assert.equal(json.pii_returned, false);
  assert.equal(json.raw_payloads_returned, false);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('full 52-order source coverage accepted below limit', async () => {
  const result = await invoke({ data: full52Data() });
  assert.equal(result.json.coverage_complete, true);
  assert.equal(result.json.unique_order_count, 52);
  assert.equal(result.json.source_row_counts.Order, 52);
});

test('one read per broad source', async () => {
  const result = await invoke({ data: full52Data() });
  assert.equal(result.calls.filter(call => call.method === 'list').length, 6);
  assert.deepEqual([...new Set(result.calls.filter(call => call.method === 'list').map(call => call.entity))].sort(), ['FulfillmentTask', 'Order', 'OrderReviewQueue', 'OrderSyncLog', 'SafeSyncParityLog', 'ShopifyOrder'].sort());
});

test('no per-order query loop in full scan', async () => {
  const result = await invoke({ data: full52Data() });
  assert.equal(result.calls.filter(call => call.method === 'filter').length, 0);
});

test('exact native order joins', async () => {
  const data = cleanData('NV-BYNUMBER', 'ca_NV-BYNUMBER');
  data.ShopifyOrder = [native({ id: 'native_by_number', base44_order_id: '', shopify_order_number: '#NV-BYNUMBER' })];
  data.FulfillmentTask = [task({ id: 'task_by_number', base44_order_id: '', native_shopify_order_id: 'native_by_number', order_number: '#NV-BYNUMBER' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-BYNUMBER').native_shopify_order_match_count, 1);
  assert.equal(summary(result.json, 'NV-BYNUMBER').provisional_history_ready, true);
});

test('exact task joins', async () => {
  const data = cleanData('NV-TASKJOIN', 'ca_NV-TASKJOIN');
  data.FulfillmentTask = [task({ id: 'task_join', order_id: 'ca_NV-TASKJOIN', base44_order_id: '', native_shopify_order_id: '', order_number: '' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-TASKJOIN').provisional_tracker_ready, true);
});

test('duplicate native order blocks', async () => {
  const data = cleanData('NV-DUPNATIVE', 'ca_NV-DUPNATIVE');
  data.ShopifyOrder = [
    native({ id: 'native_a', base44_order_id: 'ca_NV-DUPNATIVE', shopify_order_number: 'NV-DUPNATIVE' }),
    native({ id: 'native_b', base44_order_id: 'ca_NV-DUPNATIVE', shopify_order_number: 'NV-DUPNATIVE' }),
  ];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-DUPNATIVE').classification, 'native_duplicate_identity_risk');
});

test('duplicate task blocks tracker', async () => {
  const data = cleanData('NV-DUPTASK', 'ca_NV-DUPTASK');
  data.FulfillmentTask = [task({ id: 'task_a', base44_order_id: 'ca_NV-DUPTASK', order_number: 'NV-DUPTASK' }), task({ id: 'task_b', base44_order_id: 'ca_NV-DUPTASK', order_number: 'NV-DUPTASK' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-DUPTASK').classification, 'history_native_ready_tracker_identity_ambiguous');
});

test('clean history/tracker candidate', async () => {
  const result = await invoke();
  assert.equal(summary(result.json, 'NV-SCAN5-CLEAN').classification, 'history_and_tracker_native_ready');
});

test('history-ready/task-missing candidate', async () => {
  const data = cleanData('NV-NOTASK', 'ca_NV-NOTASK');
  data.FulfillmentTask = [];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-NOTASK').classification, 'history_native_ready_tracker_task_missing');
});

test('refund hold', async () => {
  const data = cleanData('NV-REFUND', 'ca_NV-REFUND');
  data.Order = [order({ id: 'ca_NV-REFUND', order_number: 'NV-REFUND', payment_status: 'refunded', refund_status: 'refunded' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-REFUND').classification, 'refund_payment_hub_source_of_truth');
});

test('cancel hold', async () => {
  const data = cleanData('NV-CANCEL', 'ca_NV-CANCEL');
  data.Order = [order({ id: 'ca_NV-CANCEL', order_number: 'NV-CANCEL', status: 'cancelled' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-CANCEL').classification, 'cancelled_payment_risk');
});

test('subscription/multi-delivery hold', async () => {
  const data = cleanData('NV-SUB', 'ca_NV-SUB');
  data.Order = [order({ id: 'ca_NV-SUB', order_number: 'NV-SUB', is_subscription: true, order_type: 'subscription' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-SUB').classification, 'subscription_multi_delivery_hub_source_of_truth');
});

test('payment mismatch', async () => {
  const data = cleanData('NV-PAY', 'ca_NV-PAY');
  data.ShopifyOrder = [native({ id: 'native_NV-PAY', base44_order_id: 'ca_NV-PAY', shopify_order_number: 'NV-PAY', payment_status: 'pending' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-PAY').classification, 'payment_mismatch');
});

test('fulfillment mismatch', async () => {
  const data = cleanData('NV-FULFILL', 'ca_NV-FULFILL');
  data.ShopifyOrder = [native({ id: 'native_NV-FULFILL', base44_order_id: 'ca_NV-FULFILL', shopify_order_number: 'NV-FULFILL', fulfillment_status: 'delivered' })];
  data.FulfillmentTask = [task({ id: 'task_NV-FULFILL', base44_order_id: 'ca_NV-FULFILL', order_number: 'NV-FULFILL', native_shopify_order_id: 'native_NV-FULFILL', status: 'delivered', delivery_status: 'delivered' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-FULFILL').classification, 'fulfillment_mismatch');
});

test('delivery schedule mismatch', async () => {
  const data = cleanData('NV-DATE', 'ca_NV-DATE');
  data.FulfillmentTask = [task({ id: 'task_NV-DATE', base44_order_id: 'ca_NV-DATE', order_number: 'NV-DATE', native_shopify_order_id: 'native_NV-DATE', delivery_date: '2026-06-21' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-DATE').classification, 'delivery_schedule_mismatch');
});

test('review queue hold', async () => {
  const data = cleanData('NV-REVIEW', 'ca_NV-REVIEW');
  data.OrderReviewQueue = [{ id: 'review', order_number: 'NV-REVIEW', status: 'open', created_date: '2026-06-01T12:00:00.000Z' }];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-REVIEW').classification, 'review_queue_hold');
});

test('repair/replay hold', async () => {
  const data = cleanData('NV-REPAIR', 'ca_NV-REPAIR');
  data.OrderSyncLog = [{ id: 'sync', order_number: 'NV-REPAIR', status: 'repair_pending', created_date: '2026-06-01T12:00:00.000Z' }];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-REPAIR').classification, 'repair_replay_hold');
});

test('truncated log coverage requires exact follow-up', async () => {
  const data = cleanData('NV-PROVISIONAL', 'ca_NV-PROVISIONAL');
  data.OrderSyncLog = Array.from({ length: 100 }, (_, i) => ({ id: `sync_${i}`, order_number: `NV-OTHER-${i}`, status: 'ok', created_date: `2026-06-01T${String(i % 24).padStart(2, '0')}:00:00.000Z` }));
  const result = await invoke({ data });
  const row = summary(result.json, 'NV-PROVISIONAL');
  assert.equal(row.exact_log_followup_required, true);
  assert.equal(row.provisional_history_ready, true);
  assert.equal(result.json.history_native_ready_count, 0);
  assert.equal(row.classification, 'provisional_tracker_ready_exact_log_followup_required');
});

test('exact preview clears safe log follow-up', async () => {
  const data = cleanData('NV-EXACTSAFE', 'ca_NV-EXACTSAFE');
  const result = await invoke({ data, body: { mode: 'EXACT_ORDER_SURFACE_PREVIEW', order_number: 'NV-EXACTSAFE', customer_app_order_id: 'ca_NV-EXACTSAFE' } });
  assert.equal(result.json.history_native_ready, true);
  assert.equal(result.json.tracker_native_ready, true);
  assert.equal(result.json.exact_log_followup_complete, true);
});

test('exact preview blocks repair/replay evidence', async () => {
  const data = cleanData('NV-EXACTREPAIR', 'ca_NV-EXACTREPAIR');
  data.OrderSyncLog = [{ id: 'sync_exact', order_number: 'NV-EXACTREPAIR', status: 'repair_pending', created_date: '2026-06-01T12:00:00.000Z' }];
  const result = await invoke({ data, body: { mode: 'EXACT_ORDER_SURFACE_PREVIEW', order_number: 'NV-EXACTREPAIR', customer_app_order_id: 'ca_NV-EXACTREPAIR' } });
  assert.equal(result.json.history_native_ready, false);
  assert.ok(result.json.blockers.includes('repair_replay_hold'));
});

test('historical chronology hold', async () => {
  const data = cleanData('NV-HISTORY', 'ca_NV-HISTORY');
  data.Order = [order({ id: 'ca_NV-HISTORY', order_number: 'NV-HISTORY', created_date: '2026-05-01T10:00:00.000Z' })];
  data.ShopifyOrder = [native({ id: 'native_NV-HISTORY', base44_order_id: 'ca_NV-HISTORY', shopify_order_number: 'NV-HISTORY', created_date: '2026-06-01T10:00:00.000Z' })];
  const result = await invoke({ data });
  assert.equal(summary(result.json, 'NV-HISTORY').classification, 'historical_late_mirror_hold');
});

test('current allowlists reported accurately', async () => {
  const data = cleanData('NV-MQHJR3V2', 'ca_NV-MQHJR3V2');
  const result = await invoke({ data, env: {
    CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST: 'NV-MQHJR3V2,NV-MPZNKGNT',
    CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST: 'NV-MQHJR3V2',
  } });
  const row = summary(result.json, 'NV-MQHJR3V2');
  assert.equal(row.currently_history_allowlisted, true);
  assert.equal(row.currently_tracker_allowlisted, true);
});

test('outside-allowlist counts correct', async () => {
  const result = await invoke({ data: cleanData('NV-NEWCANDIDATE', 'ca_NV-NEWCANDIDATE'), env: {
    CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST: 'NV-MQHJR3V2,NV-MPZNKGNT',
    CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST: 'NV-MQHJR3V2',
  } });
  assert.equal(result.json.history_ready_excluding_current_allowlist_count, 1);
  assert.equal(result.json.tracker_ready_excluding_current_allowlist_count, 1);
});

test('ownership requirement preserved', async () => {
  const result = await invoke();
  assert.equal(result.json.ownership_verification, 'source_and_harness_verified_not_live_multi_account');
  assert.ok(result.json.warnings.includes('ownership_filtering_required_before_future_customer_eligibility'));
});

test('no PII', async () => {
  const result = await invoke();
  assertNoUnsafePayload(result.json);
});

test('no raw payloads', async () => {
  const result = await invoke();
  assertNoUnsafePayload(result.json);
});

test('no writes', async () => {
  const result = await invoke();
  assert.equal(result.writes.length, 0);
  assert.equal(result.json.writes_performed, false);
});

test('no providers', async () => {
  const result = await invoke();
  assert.equal(result.json.provider_call_impact, false);
});

test('no notifications', async () => {
  const result = await invoke();
  assert.equal(result.json.notifications_sent, false);
});

test('no Hub mutation', async () => {
  const result = await invoke();
  assert.equal(result.json.hub_mutation_performed, false);
});

let failed = 0;
const failures = [];
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, error: error?.stack || String(error) });
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

console.log(JSON.stringify({
  suite: 'g43d-scan5-full-bounded-order-readiness',
  tests: tests.length,
  passed: tests.length - failed,
  failed,
  writes_performed: false,
  provider_call_impact: false,
  notifications_sent: false,
  hub_mutation_performed: false,
}, null, 2));

if (failed) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
