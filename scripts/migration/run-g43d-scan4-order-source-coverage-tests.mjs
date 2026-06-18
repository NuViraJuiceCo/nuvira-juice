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

const CONTROL = {
  recent: { order_number: 'NV-MQHJR3V2', id: '6a321cbfd8d78863f15de956', created_date: '2026-06-17T04:04:15.034000', updated_date: '2026-06-17T04:06:11.614000' },
  delivered: { order_number: 'NV-MPZNKGNT', id: 'ca_NV-MPZNKGNT', created_date: '2026-06-06T12:00:00.000000', updated_date: '2026-06-06T18:00:00.000000' },
  historical: { order_number: 'NV-MP5SOQLJ', id: 'ca_NV-MP5SOQLJ', created_date: '2026-05-16T12:00:00.000000', updated_date: '2026-06-17T12:00:00.000000' },
};

const normalizeText = value => String(value ?? '').trim();
const normalizeOrderNumber = value => normalizeText(value).replace(/^#/, '').toUpperCase();

function makeOrder(overrides = {}) {
  const orderNumber = normalizeOrderNumber(overrides.order_number || 'NV-SCAN4');
  return {
    id: overrides.id || `ca_${orderNumber}`,
    order_number: orderNumber,
    customer_email: overrides.customer_email || 'owner@example.test',
    phone: overrides.phone || '555-000-0000',
    created_date: overrides.created_date || '2026-06-10T10:00:00.000000',
    updated_date: overrides.updated_date || overrides.created_date || '2026-06-10T11:00:00.000000',
    payment_status: 'paid',
    payment_captured: true,
    status: 'scheduled_for_juicing',
    total: 42,
    items: [{ title: 'Juice', quantity: 1 }],
    ...overrides,
  };
}

function controlOrders() {
  return [
    makeOrder(CONTROL.recent),
    makeOrder(CONTROL.delivered),
    makeOrder(CONTROL.historical),
  ];
}

function fillerOrders(count, prefix = 'NV-FILL') {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const day = String(18 - (i % 18)).padStart(2, '0');
    const hour = String(20 - (i % 20)).padStart(2, '0');
    rows.push(makeOrder({
      id: `ca_${prefix}_${i}`,
      order_number: `${prefix}${String(i).padStart(3, '0')}`,
      created_date: `2026-06-${day}T${hour}:00:00.000000`,
      updated_date: `2026-06-${day}T${hour}:30:00.000000`,
    }));
  }
  return rows;
}

function sortRows(rows, sort) {
  const out = [...rows];
  if (sort?.startsWith('-')) {
    const key = sort.slice(1);
    out.sort((a, b) => String(b?.[key] || '').localeCompare(String(a?.[key] || '')));
  }
  return out;
}

function exactFilter(rows, filter) {
  const entries = Object.entries(filter || {});
  if (!entries.length) return rows;
  return rows.filter(row => entries.every(([key, value]) => row?.[key] === value));
}

function makeBase44({ orders = controlOrders(), errors = {}, calls = [], writes = [], cap = null, paginated = false, unstableSort = false } = {}) {
  const orderEntity = {
    list: async (sort = '-created_date', limit = 100) => {
      calls.push({ entity: 'Order', method: 'list', sort, limit });
      if (errors.Order) throw errors.Order;
      const effectiveLimit = cap ? Math.min(limit || cap, cap) : (limit || 100);
      const sorted = unstableSort ? [...orders] : sortRows(orders, sort);
      const rows = sorted.slice(0, effectiveLimit);
      if (paginated) return { data: rows, next_cursor: rows.length >= effectiveLimit ? 'next_page_1' : null };
      return rows;
    },
    filter: async (filter = {}, sort = '-created_date', limit = 100) => {
      calls.push({ entity: 'Order', method: 'filter', filter, sort, limit });
      if (errors.OrderFilter) throw errors.OrderFilter;
      return sortRows(exactFilter(orders, filter), sort).slice(0, limit || 100);
    },
    create: async row => { writes.push({ entity: 'Order', method: 'create', row }); return row; },
    update: async (id, row) => { writes.push({ entity: 'Order', method: 'update', id, row }); return row; },
    delete: async id => { writes.push({ entity: 'Order', method: 'delete', id }); return id; },
  };
  return {
    auth: { me: async () => ({ role: 'admin', email: 'admin@example.test' }) },
    asServiceRole: { entities: { Order: orderEntity } },
  };
}

function request(base44, body = {}) {
  return {
    method: 'POST',
    headers: { get: () => '' },
    text: async () => JSON.stringify({
      preview_mode: 'CUSTOMER_ORDER_SURFACE_GENERALIZED_READINESS',
      mode: 'ORDER_SOURCE_COVERAGE_AUDIT',
      created_order_limit: 100,
      updated_order_limit: 100,
      related_entity_limit: 100,
      control_order_number: CONTROL.recent.order_number,
      control_customer_app_order_id: CONTROL.recent.id,
      request_id: 'g43d_scan4_fixture',
      ...body,
    }),
    __base44: base44,
  };
}

async function invoke(options = {}) {
  const calls = [];
  const writes = [];
  const { handler } = loadHarness(options.env || {});
  const base44 = makeBase44({ ...options, calls, writes });
  const response = await handler(request(base44, options.body));
  return { status: response.status, json: await response.json(), calls, writes };
}

function assertNoUnsafePayload(json) {
  const serialized = JSON.stringify(json);
  for (const forbidden of ['owner@example.test', 'admin@example.test', 'customer_email', 'phone', 'full_address', 'raw_hub', 'raw_shopify', 'raw_stripe', 'payment_method']) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked`);
  }
  assert.equal(json.pii_returned, false);
  assert.equal(json.raw_payloads_returned, false);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('limit is clamped to documented maximum', async () => {
  const result = await invoke({ body: { created_order_limit: 500, updated_order_limit: 250 } });
  assert.equal(result.json.effective_created_limit, 100);
  assert.equal(result.json.effective_updated_limit, 100);
});

test('returned count below limit marks source non-truncated', async () => {
  const result = await invoke({ orders: controlOrders() });
  assert.equal(result.json.returned_created_count, 3);
  assert.equal(result.json.created_source_truncated, false);
  assert.equal(result.json.coverage_complete, true);
});

test('returned count equal to limit does not imply complete coverage', async () => {
  const result = await invoke({ orders: [...controlOrders(), ...fillerOrders(97)] });
  assert.equal(result.json.returned_created_count, 100);
  assert.equal(result.json.created_limit_reached, true);
  assert.equal(result.json.coverage_complete, false);
  assert.ok(result.json.scan_incomplete_reasons.includes('created_order_source_truncated'));
});

test('silent server cap is detected', async () => {
  const result = await invoke({ orders: [...controlOrders(), ...fillerOrders(60)], cap: 25 });
  assert.equal(result.json.possible_server_cap_detected, true);
  assert.equal(result.json.coverage_complete, false);
  assert.ok(result.json.scan_incomplete_reasons.includes('possible_silent_server_cap_detected'));
});

test('deterministic created ordering is verified', async () => {
  const result = await invoke({ orders: controlOrders() });
  assert.equal(result.json.created_ordering_stable, true);
});

test('deterministic updated ordering is verified', async () => {
  const result = await invoke({ orders: controlOrders() });
  assert.equal(result.json.updated_ordering_stable, true);
});

test('created and updated rows dedupe by Order id', async () => {
  const result = await invoke({ orders: controlOrders() });
  assert.equal(result.json.unique_order_count_before_dedupe, 6);
  assert.equal(result.json.unique_order_count_after_dedupe, 3);
});

test('known recent control is found', async () => {
  const result = await invoke({ orders: controlOrders() });
  const control = result.json.controls.find(row => row.order_number === CONTROL.recent.order_number);
  assert.equal(control.found_in_source_horizon, true);
  assert.equal(control.control_validation_passed, true);
});

test('missing expected control makes coverage incomplete', async () => {
  const exactOnly = makeOrder({ ...CONTROL.recent, created_date: '2026-06-19T00:00:00.000000', updated_date: '2026-06-19T00:00:00.000000' });
  const visible = [makeOrder({ id: 'ca_OTHER', order_number: 'NV-OTHER', created_date: '2026-06-18T00:00:00.000000', updated_date: '2026-06-18T00:00:00.000000' })];
  const result = await invoke({ orders: [...visible, exactOnly], body: { created_order_limit: 1, updated_order_limit: 1 } });
  assert.equal(result.json.coverage_complete, false);
  assert.ok(result.json.scan_incomplete_reasons.includes('known_control_validation_failed'));
});

test('real pagination metadata is honored when supported', async () => {
  const result = await invoke({ orders: [...controlOrders(), ...fillerOrders(120)], paginated: true });
  assert.equal(result.json.pagination_supported, true);
  assert.equal(result.json.continuation_available, true);
  assert.equal(result.json.next_continuation_token, 'next_page_1');
});

test('unsupported pagination is not invented', async () => {
  const result = await invoke({ orders: [...controlOrders(), ...fillerOrders(120)] });
  assert.equal(result.json.pagination_supported, false);
  assert.equal(result.json.continuation_token, null);
  assert.equal(result.json.pagination_strategy, 'unsupported_no_repository_or_entity_metadata_contract');
});

test('one-page-per-request continuation is bounded', async () => {
  const result = await invoke({ orders: [...controlOrders(), ...fillerOrders(120)], paginated: true });
  assert.equal(result.calls.filter(call => call.method === 'list').length, 2);
});

test('repeated page token is rejected or flagged', async () => {
  const result = await invoke({ body: { continuation_token: 'next_page_1' } });
  assert.equal(result.json.scan_complete, false);
  assert.ok(result.json.scan_incomplete_reasons.includes('continuation_token_not_supported_by_current_entity_list_contract'));
});

test('429 returns scan_complete:false', async () => {
  const error = Object.assign(new Error('429 Rate limit exceeded'), { status: 429 });
  const result = await invoke({ errors: { Order: error } });
  assert.equal(result.json.scan_complete, false);
  assert.equal(result.json.rate_limit_detected, true);
});

test('source failure returns scan_complete:false', async () => {
  const result = await invoke({ errors: { Order: new Error('boom') } });
  assert.equal(result.json.scan_complete, false);
  assert.equal(result.json.coverage_complete, false);
});

test('no generalized readiness counts are claimed from incomplete coverage', async () => {
  const result = await invoke({ orders: [...controlOrders(), ...fillerOrders(120)] });
  assert.equal(result.json.coverage_complete, false);
  assert.equal(result.json.readiness_counts_authoritative, false);
  assert.equal(result.json.generalized_readiness_counts_claimed, false);
});

test('no PII returned', async () => {
  const result = await invoke();
  assertNoUnsafePayload(result.json);
});

test('no raw records returned', async () => {
  const result = await invoke();
  assertNoUnsafePayload(result.json);
  assert.equal(JSON.stringify(result.json).includes('items'), false);
  assert.equal(JSON.stringify(result.json).includes('total'), false);
});

test('no writes', async () => {
  const result = await invoke();
  assert.equal(result.writes.length, 0);
  assert.equal(result.json.writes_performed, false);
});

test('no provider calls', async () => {
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

test('G43B/G43C allowlists remain unchanged by the audit', async () => {
  const result = await invoke({ env: {
    CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST: 'NV-MQHJR3V2,NV-MPZNKGNT',
    CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST: 'NV-MQHJR3V2',
  } });
  assert.equal(result.json.safety.customer_app_order_updated, false);
  assert.equal(result.json.next_action.includes('G43'), false);
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
  suite: 'g43d-scan4-order-source-coverage',
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
console.log('G43D-SCAN4 Order source coverage tests passed');
