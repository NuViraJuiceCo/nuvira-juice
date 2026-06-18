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

const CONTROL_NUMBER = 'NV-MQHJR3V2';
const CONTROL_ID = '6a321cbfd8d78863f15de956';
const RECENT7_FROM = '2026-06-12T05:00:00.000Z';
const RECENT7_TO = '2026-06-19T05:00:00.000Z';
const CONTROL_CREATED = '2026-06-17T04:04:15.034000';
const CONTROL_UPDATED = '2026-06-17T04:06:11.614000';

const normalizeText = value => String(value ?? '').trim();
const normalizeOrderNumber = value => normalizeText(value).replace(/^#/, '').toUpperCase();
const parseAsUtc = value => Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalizeText(value)) ? normalizeText(value) : `${normalizeText(value)}Z`);

function order(overrides = {}) {
  const number = normalizeOrderNumber(overrides.order_number || CONTROL_NUMBER);
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
    created_date: overrides.created_date || CONTROL_CREATED,
    updated_date: overrides.updated_date || CONTROL_UPDATED,
    assigned_delivery_date: overrides.assigned_delivery_date || '2026-06-20',
    estimated_delivery_date: overrides.estimated_delivery_date || '2026-06-20',
    total: overrides.total ?? 43.99,
    items: overrides.items || [{ title: 'Hydration Shot', quantity: 3 }],
    ...overrides,
  };
}

function native(overrides = {}) {
  const number = normalizeOrderNumber(overrides.order_number || overrides.shopify_order_number || CONTROL_NUMBER);
  return {
    id: overrides.id || `native_${number}`,
    base44_order_id: overrides.base44_order_id ?? (number === CONTROL_NUMBER ? CONTROL_ID : `ca_${number}`),
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
    created_date: overrides.created_date || '2026-06-17T04:05:00.000000',
    requested_delivery_date: overrides.requested_delivery_date || '2026-06-20',
    assigned_delivery_date: overrides.assigned_delivery_date,
    ...overrides,
  };
}

function task(overrides = {}) {
  const number = normalizeOrderNumber(overrides.order_number || overrides.shopify_order_number || CONTROL_NUMBER);
  return {
    id: overrides.id || `task_${number}`,
    order_id: overrides.order_id,
    base44_order_id: overrides.base44_order_id ?? (number === CONTROL_NUMBER ? CONTROL_ID : `ca_${number}`),
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
    created_date: overrides.created_date || '2026-06-17T04:06:00.000000',
    ...overrides,
  };
}

function rowsForSort(data, sort) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return data[sort] || data.default || [];
  return [];
}

function filterContainsRange(filter) {
  return Object.values(filter || {}).some(value => value && typeof value === 'object' && ('$gte' in value || '$lt' in value));
}

function allEntityRows(data, name, sort) {
  const value = data[name];
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const seen = new Map();
    for (const rows of Object.values(value)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) seen.set(row.id || `${name}_${seen.size}`, row);
    }
    return [...seen.values()];
  }
  return rowsForSort(value, sort);
}

function applyExactFilter(rows, filter) {
  const entries = Object.entries(filter || {});
  if (!entries.length) return rows;
  if (filterContainsRange(filter)) return [];
  return rows.filter(row => entries.every(([key, expected]) => row?.[key] === expected));
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
        const sourceRows = Object.keys(filter || {}).length ? allEntityRows(data, name, sort) : rowsForSort(data[name], sort);
        return sortRows(applyExactFilter(sourceRows, filter), sort).slice(0, limit || 100);
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
      order_created_from: RECENT7_FROM,
      order_created_to: RECENT7_TO,
      order_updated_from: RECENT7_FROM,
      order_updated_to: RECENT7_TO,
      related_context_from: '2026-06-01T05:00:00.000Z',
      related_context_to: '2026-07-01T05:00:00.000Z',
      order_limit: 25,
      related_entity_limit: 100,
      control_order_number: CONTROL_NUMBER,
      control_customer_app_order_id: CONTROL_ID,
      request_id: 'g43d_scan3_window_filter_fixture',
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

function cleanData(number = CONTROL_NUMBER, id = CONTROL_ID, createdDate = CONTROL_CREATED) {
  const caOrder = order({ id, order_number: number, created_date: createdDate, updated_date: createdDate === CONTROL_CREATED ? CONTROL_UPDATED : createdDate });
  return {
    Order: {
      '-created_date': [caOrder],
      '-updated_date': [caOrder],
    },
    ShopifyOrder: [native({ id: `native_${number}`, base44_order_id: id, shopify_order_number: number, order_number: number })],
    FulfillmentTask: [task({ id: `task_${number}`, base44_order_id: id, order_number: number, native_shopify_order_id: `native_${number}` })],
    OrderReviewQueue: [],
    OrderSyncLog: [],
    SafeSyncParityLog: [],
  };
}

function summary(json, orderNumber) {
  return (json.safe_candidate_summaries || []).find(row => row.order_number === normalizeOrderNumber(orderNumber));
}

function assertNoUnsafePayload(json) {
  const serialized = JSON.stringify(json);
  for (const forbidden of [
    'owner@example.test',
    'other@example.test',
    'admin@example.test',
    'customer_email',
    'phone',
    'full_address',
    'raw_hub',
    'raw_shopify',
    'raw_stripe',
    'payment_method',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked`);
  }
  assert.equal(json.pii_returned, false);
  assert.equal(json.raw_payloads_returned, false);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('known order exact-id lookup succeeds', async () => {
  const result = await invoke();
  assert.equal(result.json.control_validation.control_order_found_by_id, true);
  assert.equal(result.json.control_validation.control_order_found_exact, true);
});

test('canonical created field is selected correctly', async () => {
  const result = await invoke();
  assert.equal(result.json.control_validation.canonical_created_field, 'created_date');
  assert.equal(result.json.control_validation.canonical_updated_field, 'updated_date');
  assert.equal(result.json.control_validation.canonical_created_value, CONTROL_CREATED);
});

test('validated bounded window range includes the known order', async () => {
  const result = await invoke();
  assert.equal(result.json.control_validation.control_order_expected_in_window, true);
  assert.equal(result.json.control_validation.control_order_found_in_window, true);
  assert.equal(result.json.window_filter_contract_validated, true);
  assert.equal(Boolean(summary(result.json, CONTROL_NUMBER)), true);
});

test('unsupported server-side range syntax is not silently trusted', async () => {
  const result = await invoke();
  const rangeCalls = result.calls.filter(call => call.method === 'filter' && filterContainsRange(call.filter));
  assert.equal(rangeCalls.length, 0);
  assert.equal(result.json.source_read_strategy.date_filter_operator_used, 'bounded_list_in_memory');
  assert.equal(result.json.source_read_strategy.server_range_filter_used_by_source.window_created_orders, false);
});

test('in-memory fallback includes the known order', async () => {
  const result = await invoke();
  assert.equal(result.json.source_rows_before_window_filter.window_created_orders, 1);
  assert.equal(result.json.source_rows_after_window_filter.window_created_orders, 1);
  assert.equal(summary(result.json, CONTROL_NUMBER).history_native_ready, true);
});

test('America Chicago day boundaries convert consistently', async () => {
  assert.equal(new Date('2026-06-12T00:00:00-05:00').toISOString(), RECENT7_FROM);
  assert.equal(new Date('2026-06-19T00:00:00-05:00').toISOString(), RECENT7_TO);
  assert.ok(parseAsUtc(CONTROL_CREATED) >= Date.parse(RECENT7_FROM));
  assert.ok(parseAsUtc(CONTROL_CREATED) < Date.parse(RECENT7_TO));
});

test('inclusive start boundary includes a matching order', async () => {
  const data = cleanData(CONTROL_NUMBER, CONTROL_ID, RECENT7_FROM.replace(/Z$/, ''));
  const result = await invoke({ data });
  assert.equal(result.json.control_validation.control_order_found_in_window, true);
  assert.equal(result.json.window_filter_contract_validated, true);
});

test('exclusive end boundary prevents adjacent-window duplication', async () => {
  const data = cleanData(CONTROL_NUMBER, CONTROL_ID, RECENT7_TO.replace(/Z$/, ''));
  const result = await invoke({ data });
  assert.equal(result.json.control_validation.control_order_expected_in_window, false);
  assert.equal(result.json.control_validation.control_order_found_in_window, false);
  assert.equal(summary(result.json, CONTROL_NUMBER), undefined);
});

test('created and updated window results dedupe by Order id', async () => {
  const result = await invoke();
  assert.equal(result.json.unique_order_count, 1);
});

test('control order expected and found passes validation', async () => {
  const result = await invoke();
  assert.equal(result.json.control_validation.control_order_validation_passed, true);
  assert.equal(result.json.control_validation.filter_discrepancy_detected, false);
});

test('expected control order missing makes scan incomplete', async () => {
  const control = order({ id: CONTROL_ID, order_number: CONTROL_NUMBER });
  const data = cleanData();
  data.Order = { '-created_date': [], '-updated_date': [], exact: [control] };
  const result = await invoke({ data });
  assert.equal(result.json.success, false);
  assert.equal(result.json.scan_complete, false);
  assert.ok(result.json.scan_incomplete_reasons.includes('known_control_order_missing_from_expected_window'));
  assert.equal(result.json.next_action, 'inspect_window_filter_contract');
});

test('control exact lookup failure makes scan incomplete', async () => {
  const data = cleanData();
  data.Order = { '-created_date': [], '-updated_date': [] };
  const result = await invoke({ data });
  assert.equal(result.json.success, false);
  assert.equal(result.json.scan_complete, false);
  assert.ok(result.json.scan_incomplete_reasons.includes('known_control_order_lookup_failed'));
  assert.equal(result.json.next_action, 'inspect_window_filter_contract');
});

test('zero rows are accepted only when control validation shows zero is plausible', async () => {
  const data = cleanData(CONTROL_NUMBER, CONTROL_ID, '2026-05-01T00:00:00.000000');
  const result = await invoke({ data });
  assert.equal(result.json.scan_complete, true);
  assert.equal(result.json.unique_order_count, 0);
  assert.equal(result.json.control_validation.control_order_expected_in_window, false);
  assert.equal(result.json.control_validation.control_order_validation_passed, true);
  assert.equal(result.json.zero_rows_decision_grade, true);
});

test('source truncation remains reported', async () => {
  const data = cleanData();
  data.Order['-created_date'].push(order({ id: 'ca_EXTRA', order_number: 'NV-EXTRA', created_date: '2026-06-18T00:00:00.000000', updated_date: '2026-06-18T00:00:00.000000' }));
  const result = await invoke({ data, body: { order_limit: 1 } });
  assert.equal(result.json.source_truncated.window_created_orders, true);
  assert.equal(result.json.continuation_available, true);
});

test('truncated source prevents full-coverage claims', async () => {
  const data = cleanData();
  data.ShopifyOrder.push(native({ id: 'native_OTHER', base44_order_id: 'ca_OTHER', shopify_order_number: 'NV-OTHER', order_number: 'NV-OTHER' }));
  const result = await invoke({ data, body: { related_entity_limit: 1 } });
  assert.equal(result.json.source_truncated.ShopifyOrder, true);
  assert.ok(result.json.coverage_warning.includes('window_related_context_horizon_truncated'));
});

test('no per-order query loop is introduced', async () => {
  const result = await invoke();
  const sourceCalls = result.calls.filter(call => !(['id', 'order_number'].some(key => Object.prototype.hasOwnProperty.call(call.filter || {}, key))));
  assert.equal(sourceCalls.length, 7);
  assert.equal(result.json.source_read_strategy.per_order_query_loop, false);
  assert.ok(result.calls.length <= 8);
});

test('no PII returned', async () => {
  const result = await invoke();
  assertNoUnsafePayload(result.json);
});

test('no raw payload returned', async () => {
  const result = await invoke();
  assertNoUnsafePayload(result.json);
});

test('no writes are performed', async () => {
  const result = await invoke();
  assert.equal(result.writes.length, 0);
  assert.equal(result.json.writes_performed, false);
});

test('no providers are called', async () => {
  const result = await invoke();
  assert.equal(result.json.provider_call_impact, false);
});

test('no notifications are sent', async () => {
  const result = await invoke();
  assert.equal(result.json.notifications_sent, false);
});

test('no Hub mutation is performed', async () => {
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
  suite: 'g43d-scan3-window-filter-semantics',
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
console.log('G43D-SCAN3 window filter semantics tests passed');
