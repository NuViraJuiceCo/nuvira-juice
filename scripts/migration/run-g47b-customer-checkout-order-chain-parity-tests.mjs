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
    fetch: async () => { throw new Error('unexpected provider fetch'); },
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
  const number = normalizeOrderNumber(overrides.order_number || 'NV-G47B-CLEAN');
  return {
    id: overrides.id || `ca_${number}`,
    order_number: number,
    customer_email: overrides.customer_email || 'owner@example.test',
    customer_name: overrides.customer_name || 'Owner Example',
    contact_phone: overrides.contact_phone || '555-111-2222',
    delivery_address: overrides.delivery_address || '1 Test Lane, Testville, MO 63366',
    order_type: overrides.order_type || 'one_time',
    source_type: overrides.source_type || 'one_time',
    fulfillment_type: overrides.fulfillment_type || 'delivery',
    status: overrides.status || 'scheduled_for_juicing',
    fulfillment_status: overrides.fulfillment_status || 'pending',
    payment_status: overrides.payment_status || 'paid',
    financial_status: overrides.financial_status || 'paid',
    payment_captured: overrides.payment_captured ?? true,
    stripe_payment_intent_id: overrides.stripe_payment_intent_id ?? 'pi_fixture_provider_id',
    stripe_checkout_session_id: overrides.stripe_checkout_session_id,
    created_date: overrides.created_date || '2026-06-18T10:00:00.000Z',
    updated_date: overrides.updated_date || '2026-06-18T10:05:00.000Z',
    assigned_delivery_date: overrides.assigned_delivery_date || '2026-06-20',
    estimated_delivery_date: overrides.estimated_delivery_date || '2026-06-20',
    total: overrides.total ?? 52.5,
    items: overrides.items || [{ title: 'Green Juice', quantity: 2, price: 10 }],
    ...overrides,
  };
}

function nativeOrder(overrides = {}) {
  const number = normalizeOrderNumber(overrides.order_number || overrides.shopify_order_number || 'NV-G47B-CLEAN');
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
    assigned_delivery_date: overrides.assigned_delivery_date || '2026-06-20',
    created_date: overrides.created_date || '2026-06-18T10:01:00.000Z',
    ...overrides,
  };
}

function task(overrides = {}) {
  const number = normalizeOrderNumber(overrides.order_number || overrides.shopify_order_number || 'NV-G47B-CLEAN');
  return {
    id: overrides.id || `task_${number}`,
    order_id: overrides.order_id,
    base44_order_id: overrides.base44_order_id ?? `ca_${number}`,
    native_shopify_order_id: overrides.native_shopify_order_id || `native_${number}`,
    shopify_order_id: overrides.shopify_order_id,
    order_number: overrides.order_number || number,
    shopify_order_number: overrides.shopify_order_number,
    customer_email: overrides.customer_email || 'owner@example.test',
    payment_status: overrides.payment_status || 'paid',
    status: overrides.status || 'pending',
    delivery_status: overrides.delivery_status || 'pending',
    production_status: overrides.production_status || 'awaiting_production',
    fulfillment_type: overrides.fulfillment_type || 'delivery',
    delivery_date: overrides.delivery_date || '2026-06-20',
    created_date: overrides.created_date || '2026-06-18T10:02:00.000Z',
    ...overrides,
  };
}

function syncLog(overrides = {}) {
  const number = normalizeOrderNumber(overrides.order_number || 'NV-G47B-CLEAN');
  return {
    id: overrides.id || `sync_${number}`,
    order_number: number,
    base44_order_id: overrides.base44_order_id ?? `ca_${number}`,
    status: overrides.status || 'success',
    hub_action: overrides.hub_action || 'created',
    description: overrides.description || 'Hub created order',
    created_date: overrides.created_date || '2026-06-18T10:03:00.000Z',
    ...overrides,
  };
}

function defaultData(overrides = {}) {
  return {
    Order: overrides.Order ?? [order()],
    ShopifyOrder: overrides.ShopifyOrder ?? [nativeOrder()],
    FulfillmentTask: overrides.FulfillmentTask ?? [task()],
    OrderSyncLog: overrides.OrderSyncLog ?? [syncLog()],
    SafeSyncParityLog: overrides.SafeSyncParityLog ?? [],
    OrderReviewQueue: overrides.OrderReviewQueue ?? [],
    Notification: overrides.Notification ?? [],
    CustomerMessageDeliveryLog: overrides.CustomerMessageDeliveryLog ?? [],
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

function exactFilter(rows, filter = {}) {
  const entries = Object.entries(filter || {}).filter(([, value]) => normalizeText(value));
  if (!entries.length) return [];
  return (rows || []).filter(row => entries.every(([key, value]) => row?.[key] === value));
}

function makeBase44({ user = { role: 'admin', email: 'admin@example.test' }, data = defaultData(), calls = [], writes = [], errors = {} } = {}) {
  const entityNames = Object.keys(data);
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
      create: async row => { writes.push({ entity: name, method: 'create', row }); throw new Error(`unexpected create ${name}`); },
      update: async (id, patch) => { writes.push({ entity: name, method: 'update', id, patch }); throw new Error(`unexpected update ${name}`); },
      delete: async id => { writes.push({ entity: name, method: 'delete', id }); throw new Error(`unexpected delete ${name}`); },
      upsert: async row => { writes.push({ entity: name, method: 'upsert', row }); throw new Error(`unexpected upsert ${name}`); },
    };
  }
  return {
    auth: { me: async () => user },
    functions: { invoke: async (name, payload) => { writes.push({ function: name, payload }); throw new Error(`unexpected invoke ${name}`); } },
    asServiceRole: { entities, functions: { invoke: async (name, payload) => { writes.push({ function: name, payload }); throw new Error(`unexpected service invoke ${name}`); } } },
  };
}

function request(base44, body = {}) {
  return {
    method: body.__method || 'POST',
    headers: { get: () => '' },
    text: async () => JSON.stringify({
      preview_mode: 'CUSTOMER_CHECKOUT_ORDER_CHAIN_PARITY',
      mode: 'EXACT_CHECKOUT_ORDER_CHAIN_PARITY',
      order_number: 'NV-G47B-CLEAN',
      customer_app_order_id: 'ca_NV-G47B-CLEAN',
      request_id: 'g47b_fixture',
      ...body,
    }),
    __base44: base44,
  };
}

async function invoke(options = {}) {
  const calls = [];
  const writes = [];
  const { handler } = loadHarness(options.env || {});
  const base44 = makeBase44({ user: options.user, data: defaultData(options.data || {}), calls, writes, errors: options.errors || {} });
  const response = await handler(request(base44, options.body || {}));
  return { status: response.status, json: await response.json(), calls, writes };
}

function exactSummary(json) { return json.safe_order_chain_summary; }
function scanSummary(json, number) { return (json.safe_order_chain_summaries || []).find(row => row.order_number === normalizeOrderNumber(number)); }

function assertNoUnsafePayload(json) {
  const serialized = JSON.stringify(json);
  for (const forbidden of [
    'owner@example.test', 'other@example.test', 'admin@example.test', 'Owner Example', '555-111-2222',
    '1 Test Lane', 'pi_fixture_provider_id', 'cs_fixture_provider_id', 'pm_', 'raw_hub', 'raw_stripe',
    'raw_shopify', 'payment_method', 'items', 'line_items', 'delivery_address', 'customer_email', 'contact_phone',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked`);
  }
  assert.equal(json.pii_returned, false);
  assert.equal(json.raw_payloads_returned, false);
  assert.equal(json.provider_call_impact, false);
  assert.equal(json.stripe_calls, false);
  assert.equal(json.shopify_calls, false);
  assert.equal(json.hub_calls, false);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('missing admin auth returns 401', async () => {
  const result = await invoke({ user: null });
  assert.equal(result.status, 401);
  assert.equal(result.json.writes_performed, false);
});

test('exact Customer App Order resolves', async () => {
  const result = await invoke();
  assert.equal(result.json.success, true);
  assert.equal(result.json.exact_customer_app_order_match_count, 1);
  assert.equal(result.json.order_number, 'NV-G47B-CLEAN');
});

test('duplicate Customer App Order blocks readiness', async () => {
  const result = await invoke({ data: { Order: [order({ id: 'ca_dup_a' }), order({ id: 'ca_dup_b' })] }, body: { customer_app_order_id: '' } });
  assert.equal(result.json.classification, 'duplicate_customer_order_risk');
  assert.equal(result.json.fallback_required, true);
});

test('pending-payment order classified safely', async () => {
  const result = await invoke({ data: { Order: [order({ status: 'pending_payment', payment_status: 'pending', financial_status: 'pending', payment_captured: false })] } });
  assert.equal(result.json.classification, 'payment_pending_customer_order_present');
});

test('paid/captured order classified safely', async () => {
  const result = await invoke({ data: { ShopifyOrder: [], FulfillmentTask: [], OrderSyncLog: [] } });
  assert.equal(result.json.classification, 'checkout_chain_native_order_missing');
  assert.equal(exactSummary(result.json).paid_captured_ready, true);
});

test('payment/order mismatch reported', async () => {
  const result = await invoke({ data: { Order: [order({ payment_status: 'paid', financial_status: 'paid', payment_captured: false })] } });
  assert.equal(result.json.classification, 'payment_order_state_mismatch');
});

test('exact native ShopifyOrder resolves', async () => {
  const result = await invoke();
  assert.equal(result.json.exact_native_shopify_order_match_count, 1);
});

test('duplicate native ShopifyOrder blocks readiness', async () => {
  const result = await invoke({ data: { ShopifyOrder: [nativeOrder({ id: 'native_a' }), nativeOrder({ id: 'native_b' })] } });
  assert.equal(result.json.classification, 'duplicate_native_order_risk');
});

test('exact FulfillmentTask resolves', async () => {
  const result = await invoke();
  assert.equal(result.json.exact_compatible_fulfillment_task_count, 1);
});

test('duplicate/conflicting task blocks readiness', async () => {
  const result = await invoke({ data: { FulfillmentTask: [task({ id: 'task_a' }), task({ id: 'task_b' })] } });
  assert.equal(result.json.classification, 'duplicate_task_risk');
});

test('customer order only / native order missing classification', async () => {
  const result = await invoke({ data: { ShopifyOrder: [], FulfillmentTask: [], OrderSyncLog: [] } });
  assert.equal(result.json.classification, 'checkout_chain_native_order_missing');
});

test('native order present / task missing classification', async () => {
  const result = await invoke({ data: { FulfillmentTask: [] } });
  assert.equal(result.json.classification, 'checkout_chain_fulfillment_task_missing');
});

test('complete native chain classification', async () => {
  const result = await invoke();
  assert.equal(result.json.classification, 'checkout_chain_complete_native_and_hub_synced');
  assert.equal(result.json.native_chain_complete, true);
});

test('Hub sync success classification', async () => {
  const result = await invoke({ data: { OrderSyncLog: [syncLog({ status: 'success', hub_action: 'created' })] } });
  assert.equal(exactSummary(result.json).hub_sync_status, 'success');
});

test('Hub sync pending classification', async () => {
  const result = await invoke({ data: { OrderSyncLog: [syncLog({ status: 'pending', hub_action: 'queued_for_review', description: 'queued for manual review' })] } });
  assert.equal(result.json.classification, 'checkout_chain_native_complete_hub_sync_pending');
});

test('Hub sync failure does not hide paid order', async () => {
  const result = await invoke({ data: { OrderSyncLog: [syncLog({ status: 'error', hub_action: 'failed', description: 'sync failed' })] } });
  assert.equal(result.json.classification, 'checkout_chain_native_complete_hub_sync_failed');
  assert.equal(exactSummary(result.json).order_confirmation_ready, true);
});

test('repair/replay evidence holds', async () => {
  const result = await invoke({ data: { OrderSyncLog: [syncLog({ status: 'error', description: 'retry replay repair required' })] } });
  assert.equal(result.json.classification, 'repair_replay_hold');
});

test('review queue holds', async () => {
  const result = await invoke({ data: { OrderReviewQueue: [{ id: 'review_1', order_number: 'NV-G47B-CLEAN', status: 'open', created_date: '2026-06-18T10:04:00.000Z' }] } });
  assert.equal(result.json.classification, 'review_queue_hold');
});

test('refund remains Stripe/payment source-of-truth', async () => {
  const result = await invoke({ data: { Order: [order({ payment_status: 'refunded', financial_status: 'refunded', refunded_at: '2026-06-18T12:00:00.000Z' })] } });
  assert.equal(result.json.classification, 'refund_payment_source_of_truth_hold');
  assert.equal(result.json.refund_mutation_ready, false);
});

test('cancelled order held', async () => {
  const result = await invoke({ data: { Order: [order({ status: 'cancelled', payment_status: 'paid', payment_captured: true })] } });
  assert.equal(result.json.classification, 'cancelled_payment_risk');
});

test('order confirmation uses canonical Customer App order', async () => {
  const result = await invoke();
  assert.equal(result.json.customer_app_order_canonical, true);
  assert.equal(exactSummary(result.json).order_confirmation_ready, true);
});

test('history and tracker canonical order number agrees', async () => {
  const result = await invoke();
  assert.equal(exactSummary(result.json).customer_history_ready, true);
  assert.equal(exactSummary(result.json).customer_tracker_ready, true);
  assert.equal(exactSummary(result.json).order_number, 'NV-G47B-CLEAN');
});

test('historical late mirror does not prove native-born checkout', async () => {
  const result = await invoke({ data: { ShopifyOrder: [nativeOrder({ created_date: '2026-07-10T10:00:00.000Z' })] } });
  assert.equal(exactSummary(result.json).native_chain_complete, true);
  assert.equal(result.json.source_of_truth_rules.customer_app_order_canonical, true);
});

test('bounded scan uses one read per source', async () => {
  const result = await invoke({ body: { mode: 'BOUNDED_CHECKOUT_ORDER_CHAIN_SCAN', order_number: undefined, customer_app_order_id: undefined } });
  const listCalls = result.calls.filter(call => call.method === 'list');
  assert.equal(listCalls.length, 6);
  assert.equal(result.calls.filter(call => call.method === 'filter').length, 0);
});

test('truncated log coverage requires exact follow-up', async () => {
  const manyLogs = Array.from({ length: 100 }, (_, i) => syncLog({ id: `sync_${i}`, order_number: `NV-OTHER-${i}`, base44_order_id: `ca_other_${i}` }));
  const result = await invoke({ data: { OrderSyncLog: manyLogs }, body: { mode: 'BOUNDED_CHECKOUT_ORDER_CHAIN_SCAN', order_number: undefined, customer_app_order_id: undefined } });
  assert.equal(result.json.source_truncated.OrderSyncLog, true);
  assert.equal(result.json.exact_followup_required, true);
});

test('no PII returned', async () => {
  const result = await invoke();
  assertNoUnsafePayload(result.json);
});

test('no raw payloads returned', async () => {
  const result = await invoke();
  assert.equal(JSON.stringify(result.json).includes('raw_'), true); // only safety field names are allowed
  assert.equal(JSON.stringify(result.json).includes('raw_hub_payload'), false);
  assert.equal(result.json.raw_payloads_returned, false);
});

test('no PaymentIntent/session creation', async () => {
  const result = await invoke();
  assert.equal(result.writes.length, 0);
  assert.equal(result.json.payment_mutation_performed, false);
});

test('no payment mutation', async () => {
  const result = await invoke();
  assert.equal(result.json.payment_mutation_performed, false);
});

test('no Order creation/update', async () => {
  const result = await invoke();
  assert.equal(result.writes.filter(write => write.entity === 'Order').length, 0);
  assert.equal(result.json.order_mutation_performed, false);
});

test('no ShopifyOrder creation/update', async () => {
  const result = await invoke();
  assert.equal(result.writes.filter(write => write.entity === 'ShopifyOrder').length, 0);
  assert.equal(result.json.native_order_mutation_performed, false);
});

test('no FulfillmentTask creation/update', async () => {
  const result = await invoke();
  assert.equal(result.writes.filter(write => write.entity === 'FulfillmentTask').length, 0);
  assert.equal(result.json.fulfillment_task_mutation_performed, false);
});

test('no Stripe/Shopify/Hub/provider calls', async () => {
  const result = await invoke();
  assert.equal(result.json.stripe_calls, false);
  assert.equal(result.json.shopify_calls, false);
  assert.equal(result.json.hub_calls, false);
  assert.equal(result.json.provider_call_impact, false);
});

test('no notifications', async () => {
  const result = await invoke();
  assert.equal(result.json.notifications_sent, false);
});

test('no loyalty/credit mutation', async () => {
  const result = await invoke();
  assert.equal(result.json.reward_points_mutated, false);
});

test('no logs/queues created', async () => {
  const result = await invoke();
  assert.equal(result.json.command_log_created, false);
  assert.equal(result.writes.length, 0);
});

test('bounded scan aggregates counts', async () => {
  const data = {
    Order: [order({ order_number: 'NV-G47B-CLEAN', id: 'ca_NV-G47B-CLEAN' }), order({ order_number: 'NV-G47B-PENDING', id: 'ca_NV-G47B-PENDING', status: 'pending_payment', payment_status: 'pending', financial_status: 'pending', payment_captured: false })],
    ShopifyOrder: [nativeOrder({ order_number: 'NV-G47B-CLEAN', shopify_order_number: 'NV-G47B-CLEAN', base44_order_id: 'ca_NV-G47B-CLEAN' })],
    FulfillmentTask: [task({ order_number: 'NV-G47B-CLEAN', base44_order_id: 'ca_NV-G47B-CLEAN', native_shopify_order_id: 'native_NV-G47B-CLEAN' })],
    OrderSyncLog: [syncLog({ order_number: 'NV-G47B-CLEAN', base44_order_id: 'ca_NV-G47B-CLEAN' })],
  };
  const result = await invoke({ data, body: { mode: 'BOUNDED_CHECKOUT_ORDER_CHAIN_SCAN', order_number: undefined, customer_app_order_id: undefined } });
  assert.equal(result.json.unique_customer_order_count, 2);
  assert.equal(result.json.pending_payment_order_count, 1);
  assert.equal(scanSummary(result.json, 'NV-G47B-CLEAN').native_chain_complete, true);
});

for (const marker of [
  'CUSTOMER_CHECKOUT_ORDER_CHAIN_PARITY',
  'EXACT_CHECKOUT_ORDER_CHAIN_PARITY',
  'BOUNDED_CHECKOUT_ORDER_CHAIN_SCAN',
  'stripe_payment_source_of_truth: true',
  'hub_write_suppression_ready: false',
  'apple_pay_live_device_test_completed: false',
]) {
  test(`source contains marker ${marker}`, () => {
    assert.equal(source.includes(marker), true);
  });
}

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exit(1);
  }
}

console.log(`\nG47B checkout/order-chain parity tests passed (${passed}/${tests.length}).`);
