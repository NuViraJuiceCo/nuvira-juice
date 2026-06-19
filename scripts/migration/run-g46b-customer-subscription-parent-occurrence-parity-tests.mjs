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

function subscription(overrides = {}) {
  return {
    id: overrides.id || 'sub_clean',
    customer_email: overrides.customer_email || 'owner@example.test',
    status: overrides.status || 'active',
    plan_id: overrides.plan_id || 'plan_weekly',
    bundle_id: overrides.bundle_id || 'bundle_clean',
    custom_composition: overrides.custom_composition ?? [{ product_id: 'prod_a', product_name: 'A', quantity: 2 }],
    next_delivery_date: overrides.next_delivery_date ?? '2026-06-25',
    started_date: overrides.started_date ?? '2026-06-01',
    stripe_subscription_id: overrides.stripe_subscription_id ?? 'sub_fixture_clean',
    hub_sync_status: overrides.hub_sync_status ?? 'synced',
    hub_synced_at: overrides.hub_synced_at ?? '2026-06-01T00:00:00.000Z',
    created_date: overrides.created_date || '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function plan(overrides = {}) {
  return {
    id: overrides.id || 'plan_weekly',
    name: overrides.name || 'Weekly',
    frequency: overrides.frequency || 'weekly',
    bottle_count: overrides.bottle_count ?? 6,
    sort_order: overrides.sort_order ?? 1,
    ...overrides,
  };
}

function profile(overrides = {}) {
  return {
    id: overrides.id || 'profile_owner',
    customer_email: overrides.customer_email || 'owner@example.test',
    contact_email: overrides.contact_email || 'owner@example.test',
    ...overrides,
  };
}

function nativeOrder(overrides = {}) {
  return {
    id: overrides.id || 'native_occ_1',
    subscription_parent_id: overrides.subscription_parent_id || 'sub_clean',
    customer_app_subscription_id: overrides.customer_app_subscription_id || 'sub_clean',
    stripe_subscription_id: overrides.stripe_subscription_id ?? 'sub_fixture_clean',
    source_channel: overrides.source_channel || 'subscription',
    source_type: overrides.source_type || 'subscription',
    order_type: overrides.order_type || 'subscription',
    fulfillment_mode: overrides.fulfillment_mode || 'multi_delivery',
    base44_order_id: overrides.base44_order_id || 'order_occ_1',
    assigned_delivery_date: overrides.assigned_delivery_date || '2026-06-25',
    fulfillment_status: overrides.fulfillment_status || 'pending',
    created_date: overrides.created_date || '2026-06-01T01:00:00.000Z',
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    id: overrides.id || 'task_occ_1',
    customer_app_subscription_id: overrides.customer_app_subscription_id || 'sub_clean',
    stripe_subscription_id: overrides.stripe_subscription_id ?? 'sub_fixture_clean',
    native_shopify_order_id: overrides.native_shopify_order_id || 'native_occ_1',
    base44_order_id: overrides.base44_order_id || 'order_occ_1',
    order_id: overrides.order_id || 'order_occ_1',
    source_type: overrides.source_type || 'subscription',
    order_type: overrides.order_type || 'subscription',
    fulfillment_type: overrides.fulfillment_type || 'subscription_delivery',
    fulfillment_number: overrides.fulfillment_number ?? 1,
    delivery_date: overrides.delivery_date || '2026-06-25',
    status: overrides.status || 'pending',
    delivery_status: overrides.delivery_status || 'pending',
    created_date: overrides.created_date || '2026-06-01T01:00:00.000Z',
    ...overrides,
  };
}

function customerOrder(overrides = {}) {
  return {
    id: overrides.id || 'order_occ_1',
    customer_app_subscription_id: overrides.customer_app_subscription_id || 'sub_clean',
    stripe_subscription_id: overrides.stripe_subscription_id ?? 'sub_fixture_clean',
    order_type: overrides.order_type || 'subscription',
    source_type: overrides.source_type || 'subscription',
    delivery_date: overrides.delivery_date || '2026-06-25',
    status: overrides.status || 'pending',
    created_date: overrides.created_date || '2026-06-01T01:00:00.000Z',
    ...overrides,
  };
}

function pendingCheckout(overrides = {}) {
  return {
    id: overrides.id || 'pending_1',
    stripe_subscription_id: overrides.stripe_subscription_id ?? 'sub_fixture_clean',
    customer_app_subscription_id: overrides.customer_app_subscription_id || 'sub_clean',
    plan_id: overrides.plan_id || 'plan_weekly',
    first_delivery_date: overrides.first_delivery_date || '2026-06-25',
    status: overrides.status || 'completed',
    created_date: overrides.created_date || '2026-06-01T00:30:00.000Z',
    ...overrides,
  };
}

function sortRows(rows, sort = '-created_date') {
  const out = [...(rows || [])];
  if (sort === 'sort_order') out.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  if (sort?.startsWith('-')) {
    const key = sort.slice(1);
    out.sort((a, b) => String(b?.[key] || '').localeCompare(String(a?.[key] || '')));
  }
  return out;
}

function exactFilter(rows, filter) {
  const entries = Object.entries(filter || {}).filter(([, value]) => value !== undefined && value !== null && value !== '');
  return (rows || []).filter(row => entries.every(([key, value]) => row?.[key] === value));
}

function defaultData(overrides = {}) {
  return {
    Subscription: overrides.Subscription ?? [subscription()],
    SubscriptionPlan: overrides.SubscriptionPlan ?? [plan()],
    PendingSubscriptionCheckout: overrides.PendingSubscriptionCheckout ?? [pendingCheckout()],
    Order: overrides.Order ?? [customerOrder()],
    ShopifyOrder: overrides.ShopifyOrder ?? [nativeOrder()],
    FulfillmentTask: overrides.FulfillmentTask ?? [task()],
    OrderReviewQueue: overrides.OrderReviewQueue ?? [],
    OrderSyncLog: overrides.OrderSyncLog ?? [],
    SafeSyncParityLog: overrides.SafeSyncParityLog ?? [],
    UserProfile: overrides.UserProfile ?? [profile()],
  };
}

function makeBase44({ user = { role: 'admin', email: 'admin@example.test' }, data = defaultData(), calls = [], writes = [] } = {}) {
  const api = name => ({
    list: async (sort = '-created_date', limit = 50) => {
      calls.push({ entity: name, method: 'list', sort, limit });
      return sortRows(data[name] || [], sort).slice(0, limit || 50);
    },
    filter: async (filter = {}, sort = '-created_date', limit = 20) => {
      calls.push({ entity: name, method: 'filter', filter, sort, limit });
      return sortRows(exactFilter(data[name] || [], filter), sort).slice(0, limit || 20);
    },
    create: async row => { writes.push({ entity: name, method: 'create', row }); throw new Error(`unexpected create ${name}`); },
    update: async (id, patch) => { writes.push({ entity: name, method: 'update', id, patch }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { writes.push({ entity: name, method: 'delete', id }); throw new Error(`unexpected delete ${name}`); },
    upsert: async row => { writes.push({ entity: name, method: 'upsert', row }); throw new Error(`unexpected upsert ${name}`); },
  });
  const entities = Object.fromEntries(Object.keys(data).map(name => [name, api(name)]));
  return {
    auth: { me: async () => user },
    functions: { invoke: async (name, payload) => { writes.push({ function: name, payload }); throw new Error(`unexpected function invoke ${name}`); } },
    asServiceRole: { entities, functions: { invoke: async (name, payload) => { writes.push({ function: name, payload }); throw new Error(`unexpected service function invoke ${name}`); } } },
  };
}

function request(base44, body = {}) {
  return {
    method: body.__method || 'POST',
    headers: { get: () => '' },
    text: async () => JSON.stringify({
      preview_mode: 'CUSTOMER_SUBSCRIPTION_PARENT_OCCURRENCE_PARITY',
      mode: 'EXACT_SUBSCRIPTION_PARENT_OCCURRENCE_PARITY',
      native_subscription_id: 'sub_clean',
      request_id: 'g46b_fixture',
      ...body,
    }),
    __base44: base44,
  };
}

async function invoke(options = {}) {
  const calls = [];
  const writes = [];
  const { handler } = loadHarness(options.env || {});
  const base44 = makeBase44({ user: options.user, data: defaultData(options.data || {}), calls, writes });
  const response = await handler(request(base44, options.body || {}));
  return { status: response.status, json: await response.json(), calls, writes };
}

function assertNoUnsafePayload(json) {
  const serialized = JSON.stringify(json);
  for (const forbidden of ['owner@example.test', 'other@example.test', 'admin@example.test', 'sub_fixture_clean', 'raw_hub_payload', 'raw_stripe_payload', 'raw_shopify_payload', 'payment_method_details', '555-111-2222', 'Bearer ', 'sk_live_']) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked`);
  }
  assert.equal(json.pii_returned, false);
  assert.equal(json.raw_payloads_returned, false);
  assert.equal(json.provider_call_impact, false);
}

function exactParent(json) {
  return (json.safe_parent_summaries || [])[0];
}

function exactOccurrence(json) {
  return (json.safe_occurrence_summaries || [])[0];
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('missing admin auth returns 401', async () => {
  const result = await invoke({ user: null });
  assert.equal(result.status, 401);
  assert.equal(result.json.writes_performed, false);
});

test('exact native parent resolves', async () => {
  const result = await invoke();
  assert.equal(result.status, 200);
  assert.equal(result.json.preview_mode, 'CUSTOMER_SUBSCRIPTION_PARENT_OCCURRENCE_PARITY');
  assert.equal(result.json.exact_parent_match_count, 1);
  assert.equal(result.json.native_parent_present, true);
});

test('duplicate parent identity blocks readiness', async () => {
  const result = await invoke({ data: { Subscription: [subscription(), subscription({ id: 'sub_dup' })] } });
  assert.equal(result.json.duplicate_parent_identity_risk, true);
  assert.ok(exactParent(result.json).blockers.includes('parent_identity_ambiguous'));
});

test('ownership link mismatch blocks readiness', async () => {
  const result = await invoke({ body: { user_profile_id: 'profile_other' }, data: { UserProfile: [profile({ id: 'profile_other', customer_email: 'other@example.test', contact_email: 'other@example.test' })] } });
  assert.ok(exactParent(result.json).blockers.includes('parent_ownership_link_mismatch'));
});

test('parent status safely classified', async () => {
  const result = await invoke();
  assert.equal(result.json.native_parent_status, 'active');
  assert.equal(exactParent(result.json).native_parent_status, 'active');
});

test('Stripe linkage present but Stripe remains authoritative', async () => {
  const result = await invoke();
  assert.equal(result.json.stripe_linkage_present, true);
  assert.equal(result.json.stripe_billing_source_of_truth, true);
  assert.equal(result.json.stripe_calls, false);
});

test('Hub linkage present but Hub remains recurrence authority', async () => {
  const result = await invoke();
  assert.equal(result.json.hub_linkage_present, true);
  assert.equal(result.json.hub_recurrence_source_of_truth, true);
  assert.equal(result.json.hub_calls, false);
});

test('missing Stripe context requires fallback', async () => {
  const result = await invoke({ data: { Subscription: [subscription({ stripe_subscription_id: '' })] } });
  assert.equal(result.json.stripe_linkage_present, false);
  assert.equal(result.json.parent_fallback_required, true);
});

test('missing Hub recurrence context requires fallback', async () => {
  const result = await invoke({ data: { Subscription: [subscription({ hub_sync_status: '', hub_synced_at: '' })] } });
  assert.equal(result.json.hub_linkage_present, false);
  assert.equal(result.json.parent_fallback_required, true);
});

test('cadence match', async () => {
  const result = await invoke();
  assert.equal(result.json.native_cadence_present, true);
  assert.equal(result.json.cadence_match, true);
});

test('cadence mismatch', async () => {
  const result = await invoke({ data: { SubscriptionPlan: [] } });
  assert.equal(result.json.native_cadence_present, false);
  assert.ok(exactParent(result.json).blockers.includes('cadence_context_missing'));
});

test('product/quantity match', async () => {
  const result = await invoke();
  assert.equal(result.json.native_product_selection_present, true);
  assert.equal(result.json.native_quantity_selection_present, true);
});

test('product/quantity mismatch', async () => {
  const result = await invoke({ data: { Subscription: [subscription({ plan_id: '', bundle_id: '', custom_composition: [] })], SubscriptionPlan: [] } });
  assert.equal(result.json.native_product_selection_present, false);
  assert.equal(result.json.native_quantity_selection_present, false);
});

test('next billing date mismatch', async () => {
  const result = await invoke();
  assert.equal(result.json.native_next_billing_date_present, false);
  assert.equal(result.json.next_billing_date_match, false);
});

test('next delivery date mismatch', async () => {
  const result = await invoke({ data: { Subscription: [subscription({ next_delivery_date: '' })] } });
  assert.equal(result.json.native_next_delivery_date_present, false);
  assert.equal(result.json.next_delivery_date_match, false);
});

test('exact occurrence links to parent', async () => {
  const result = await invoke();
  assert.equal(result.json.occurrence_count >= 1, true);
  assert.equal(exactOccurrence(result.json).parent_link_present, true);
});

test('orphan occurrence requires review', async () => {
  const result = await invoke({ body: { mode: 'BOUNDED_SUBSCRIPTION_READINESS_SCAN' }, data: { FulfillmentTask: [task(), task({ id: 'orphan_task', customer_app_subscription_id: 'missing_parent', stripe_subscription_id: 'sub_orphan' })] } });
  assert.equal(result.json.orphan_occurrence_count >= 1, true);
  assert.equal(result.json.review_required_count >= 1, true);
});

test('duplicate occurrence identity blocks readiness', async () => {
  const rows = [task(), task({ id: 'task_dup' })];
  const result = await invoke({ data: { FulfillmentTask: rows } });
  assert.equal(result.json.duplicate_occurrence_identity_count >= 1, true);
  assert.ok(exactOccurrence(result.json).blockers.includes('occurrence_duplicate_identity_risk'));
});

test('occurrence schedule match', async () => {
  const result = await invoke();
  assert.equal(result.json.occurrence_schedule_match, true);
  assert.equal(exactOccurrence(result.json).scheduled_date_present, true);
});

test('occurrence schedule mismatch', async () => {
  const result = await invoke({ data: { FulfillmentTask: [task({ delivery_date: '', scheduled_date: '', assigned_delivery_date: '' })], ShopifyOrder: [nativeOrder({ assigned_delivery_date: '', selected_delivery_date: '' })], Order: [customerOrder({ delivery_date: '' })], PendingSubscriptionCheckout: [] } });
  assert.equal(result.json.occurrence_schedule_match, false);
  assert.ok(exactOccurrence(result.json).blockers.includes('occurrence_schedule_mismatch'));
});

test('occurrence status mismatch', async () => {
  const result = await invoke({ data: { FulfillmentTask: [task({ status: '', delivery_status: '', fulfillment_status: '' })], ShopifyOrder: [nativeOrder({ fulfillment_status: '', delivery_status: '' })], Order: [customerOrder({ status: '' })], PendingSubscriptionCheckout: [] } });
  assert.equal(result.json.occurrence_status_match, false);
});

test('missing Customer App Order link held', async () => {
  const result = await invoke({ data: { Order: [], ShopifyOrder: [nativeOrder({ base44_order_id: '' })], FulfillmentTask: [task({ base44_order_id: '', order_id: '' })] } });
  assert.equal(result.json.occurrence_order_link_match, false);
});

test('missing native ShopifyOrder link held where required', async () => {
  const result = await invoke({ data: { ShopifyOrder: [], FulfillmentTask: [task({ native_shopify_order_id: '', shopify_order_id: '' })] } });
  assert.equal(result.json.occurrence_shopify_order_link_match, false);
  assert.equal(result.json.occurrence_missing_native_order_count >= 1, true);
});

test('missing FulfillmentTask link held where required', async () => {
  const result = await invoke({ data: { FulfillmentTask: [] } });
  assert.equal(result.json.occurrence_fulfillment_task_link_match, false);
  assert.equal(result.json.occurrence_missing_task_count >= 1, true);
});

test('parent is not duplicated as an occurrence', async () => {
  const result = await invoke({ data: { ShopifyOrder: [], FulfillmentTask: [], Order: [], PendingSubscriptionCheckout: [] } });
  assert.equal(result.json.occurrence_count, 0);
  assert.equal(result.json.unique_parent_subscription_count, 1);
});

test('occurrence is not returned as a parent', async () => {
  const result = await invoke({ body: { mode: 'BOUNDED_SUBSCRIPTION_READINESS_SCAN' }, data: { Subscription: [], FulfillmentTask: [task()] } });
  assert.equal(result.json.unique_parent_subscription_count, 0);
  assert.equal(result.json.orphan_occurrence_count >= 1, true);
});

test('subscription/multi-delivery remains Hub source-of-truth', async () => {
  const result = await invoke();
  assert.equal(result.json.hub_recurrence_source_of_truth, true);
  assert.ok(result.json.warnings.includes('hub_recurrence_source_of_truth'));
});

test('repair/replay evidence holds', async () => {
  const result = await invoke({ data: { OrderSyncLog: [{ id: 'sync_1', customer_app_subscription_id: 'sub_clean', status: 'failed_repair_replay_required' }] } });
  assert.equal(exactParent(result.json).blockers.includes('repair_replay_hold'), true);
});

test('clean native parent-read candidate', async () => {
  const result = await invoke();
  assert.equal(result.json.native_parent_read_candidate, true);
  assert.equal(result.json.native_parent_read_candidate_count, 1);
});

test('clean native occurrence-read candidate', async () => {
  const result = await invoke();
  assert.equal(result.json.native_occurrence_read_candidate, true);
  assert.equal(result.json.occurrence_native_read_ready_count >= 1, true);
});

test('bounded scan uses one read per source', async () => {
  const result = await invoke({ body: { mode: 'BOUNDED_SUBSCRIPTION_READINESS_SCAN' } });
  assert.equal(result.status, 200);
  assert.equal(result.json.source_read_strategy.one_read_per_source, true);
  const listCalls = result.calls.filter(call => call.method === 'list');
  const byEntity = listCalls.reduce((acc, call) => ({ ...acc, [call.entity]: (acc[call.entity] || 0) + 1 }), {});
  for (const count of Object.values(byEntity)) assert.equal(count, 1);
});

test('source truncation prevents fleet-wide claims', async () => {
  const many = Array.from({ length: 25 }, (_, i) => subscription({ id: `sub_${i}`, stripe_subscription_id: `sub_provider_${i}`, customer_email: `owner${i}@example.test` }));
  const result = await invoke({ body: { mode: 'BOUNDED_SUBSCRIPTION_READINESS_SCAN' }, data: { Subscription: many } });
  assert.equal(result.json.scan_complete, false);
  assert.equal(result.json.source_truncated.Subscription, true);
  assert.ok(result.json.blockers.includes('bounded_source_truncated_counts_not_full_fleet'));
});

test('no PII returned', async () => {
  const result = await invoke();
  assertNoUnsafePayload(result.json);
});

test('no provider ids returned', async () => {
  const result = await invoke();
  assert.equal(JSON.stringify(result.json).includes('sub_fixture_clean'), false);
});

test('no raw payload returned', async () => {
  const result = await invoke({ data: { PendingSubscriptionCheckout: [pendingCheckout({ hub_payload: { unsafe: 'raw_hub_payload' } })] } });
  assertNoUnsafePayload(result.json);
});

test('no subscription mutation', async () => {
  const result = await invoke();
  assert.equal(result.json.subscription_mutation_performed, false);
  assert.equal(result.writes.length, 0);
});

test('no occurrence creation/update', async () => {
  const result = await invoke();
  assert.equal(result.json.occurrence_mutation_performed, false);
  assert.equal(result.json.occurrence_creation_ready, false);
  assert.equal(result.writes.length, 0);
});

test('no Stripe/Shopify/Hub calls', async () => {
  const result = await invoke();
  assert.equal(result.json.stripe_calls, false);
  assert.equal(result.json.shopify_calls, false);
  assert.equal(result.json.hub_calls, false);
  assert.equal(result.json.provider_call_impact, false);
});

test('no notifications', async () => {
  const result = await invoke();
  assert.equal(result.json.notifications_sent, false);
  assert.equal(result.json.notification_expansion_ready, false);
});

test('no logs/queues created', async () => {
  const result = await invoke();
  assert.equal(result.json.command_log_created, false);
  assert.equal(result.writes.length, 0);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
    process.exitCode = 1;
    break;
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`\nG46B customer subscription parent/occurrence parity harness passed (${passed}/${tests.length}).`);
