#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/getAdminCalendarEventsSummary/entry.ts');
const DATE = '2026-06-20';
const STALE_DATE = '2026-06-19';

function loadHandler({ env = {}, hubData = emptyHubCalendar(), hubStatus = 200, fetchError = null } = {}) {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');

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
    Intl,
    createClientFromRequest: req => req.__base44,
    fetch: async () => {
      if (fetchError) throw fetchError;
      return new Response(JSON.stringify(hubData), { status: hubStatus });
    },
    Deno: {
      env: { get: key => env[key] || '' },
      serve: handler => {
        context.globalThis.__handler = handler;
      },
    },
    globalThis: {},
  });

  vm.runInContext(source, context, { filename: functionPath });
  return context.globalThis.__handler;
}

function nativeEvent(overrides = {}) {
  return {
    id: overrides.id || 'event_native',
    title: overrides.title || 'Native Event',
    event_type: overrides.event_type ?? 'community_event',
    status: overrides.status || 'active',
    start_datetime: overrides.start_datetime ?? `${DATE}T15:00:00Z`,
    end_datetime: overrides.end_datetime || `${DATE}T16:00:00Z`,
    location: overrides.location || 'Synthetic Admin Location',
    description: overrides.description || 'Synthetic native event summary',
    customer_email: 'do-not-return@example.test',
    customer_phone: '+15555550123',
    raw_payload: { should_not_return: true },
    provider_payload: { should_not_return: true },
    payment_payload: { should_not_return: true },
    ...overrides,
  };
}

function nativeBatch(overrides = {}) {
  return {
    id: overrides.id || 'batch_native',
    production_date: overrides.production_date || DATE,
    product_name: overrides.product_name || 'Pineapple Juice',
    planned_units: overrides.planned_units ?? 1,
    status: overrides.status || 'planned',
    raw_payload: { should_not_return: true },
    ...overrides,
  };
}

function nativeTask(overrides = {}) {
  return {
    id: overrides.id || 'task_native',
    order_number: overrides.order_number || 'NV-G39H-NATIVE',
    delivery_date: overrides.delivery_date || DATE,
    scheduled_date: overrides.scheduled_date || overrides.delivery_date || DATE,
    assigned_delivery_date: overrides.assigned_delivery_date || overrides.delivery_date || DATE,
    status: overrides.status || 'pending',
    delivery_status: overrides.delivery_status || 'pending',
    source_type: overrides.source_type || 'customer_app_native_task',
    customer_email: 'do-not-return@example.test',
    customer_phone: '+15555550123',
    raw_payload: { should_not_return: true },
    proof_payload: { should_not_return: true },
    ...overrides,
  };
}

function complianceLog(overrides = {}) {
  return {
    id: overrides.id || 'compliance_native',
    compliance_date: overrides.compliance_date || DATE,
    status: overrides.status || 'verified',
    raw_payload: { should_not_return: true },
    ...overrides,
  };
}

function hubEvent(overrides = {}) {
  return {
    type: 'event',
    id: overrides.id || 'event_hub',
    title: overrides.title || 'Hub Event',
    event_type: overrides.event_type ?? 'community_event',
    status: overrides.status || 'active',
    start_datetime: overrides.start_datetime ?? `${DATE}T15:00:00Z`,
    end_datetime: overrides.end_datetime || `${DATE}T16:00:00Z`,
    location: overrides.location || 'Synthetic Hub Location',
    summary: overrides.summary || 'Synthetic Hub event summary',
    customer_email: 'do-not-return@example.test',
    customer_phone: '+15555550123',
    raw_payload: { should_not_return: true },
    provider_payload: { should_not_return: true },
    payment_payload: { should_not_return: true },
    ...overrides,
  };
}

function hubProduction(overrides = {}) {
  return {
    type: 'production',
    production_date: overrides.production_date || DATE,
    batch_count: overrides.batch_count ?? 1,
    product_count: overrides.product_count ?? 1,
    planned_units: overrides.planned_units ?? 1,
    status_counts: overrides.status_counts || { planned: 1 },
    raw_payload: { should_not_return: true },
    ...overrides,
  };
}

function dateGroup(date = DATE, items = []) {
  return {
    date,
    counts: {
      events: items.filter(item => item.type === 'event').length,
      production: items.filter(item => item.type === 'production').length,
      delivery: items.filter(item => item.type === 'delivery').length,
      compliance: items.filter(item => item.type === 'compliance').length,
    },
    items,
  };
}

function emptyHubCalendar(overrides = {}) {
  const dates = overrides.dates || [];
  return {
    success: true,
    date_from: overrides.date_from || STALE_DATE,
    date_to: overrides.date_to || DATE,
    generated_at: overrides.generated_at || '2026-06-16T12:00:00Z',
    summary: overrides.summary || {
      total_items: dates.reduce((sum, group) => sum + group.items.length, 0),
      events: dates.reduce((sum, group) => sum + Number(group.counts?.events || 0), 0),
      production_days: dates.filter(group => Number(group.counts?.production || 0) > 0).length,
      delivery_days: dates.filter(group => Number(group.counts?.delivery || 0) > 0).length,
      compliance_items: dates.reduce((sum, group) => sum + Number(group.counts?.compliance || 0), 0),
    },
    dates,
    truncated: overrides.truncated === true,
  };
}

function makeBase44({ events = [], batches = [], tasks = [], compliance = [] } = {}) {
  const writes = [];
  const rowsByName = {
    Event: events,
    ProductionBatch: batches,
    FulfillmentTask: tasks,
    SanitationLog: compliance,
    TemperatureLog: [],
    DailyChecklist: [],
    CorrectiveActionLog: [],
    BatchComplianceLog: [],
    CCPLog: [],
    pHLog: [],
  };
  const api = name => ({
    list: async (_sort, limit = 500) => (rowsByName[name] || []).slice(0, limit),
    filter: async () => { throw new Error(`unexpected filter ${name}`); },
    create: async payload => { writes.push({ entity: name, action: 'create', payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, payload) => { writes.push({ entity: name, action: 'update', id, payload }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { writes.push({ entity: name, action: 'delete', id }); throw new Error(`unexpected delete ${name}`); },
    upsert: async payload => { writes.push({ entity: name, action: 'upsert', payload }); throw new Error(`unexpected upsert ${name}`); },
  });
  return {
    writes,
    base44: {
      auth: { me: async () => ({ id: 'synthetic_admin', role: 'admin' }) },
      asServiceRole: { entities: Object.fromEntries(Object.keys(rowsByName).map(name => [name, api(name)])) },
    },
  };
}

async function invoke({ store = {}, hubData = emptyHubCalendar(), hubEnv = true, body = {}, hubStatus = 200 } = {}) {
  const { base44, writes } = makeBase44(store);
  const handler = loadHandler({
    env: hubEnv ? { HUB_API_URL: 'https://hub.example.test/functions/getCalendarEventsSummaryForCustomerApp', CUSTOMER_APP_SYNC_SECRET: 'synthetic-secret' } : {},
    hubData,
    hubStatus,
  });
  const req = {
    method: 'POST',
    __base44: base44,
    json: async () => ({ preset: 'custom', date_from: STALE_DATE, date_to: DATE, limit: 200, ...body }),
  };
  const response = await handler(req);
  const payload = await response.json();
  return { status: response.status, payload, writes };
}

function allItems(payload) {
  return (payload.dates || []).flatMap(group => group.items || []);
}

function findItem(payload, predicate) {
  return allItems(payload).find(predicate);
}

function assertNoForbiddenPayloads(payload) {
  const serialized = JSON.stringify(payload);
  for (const forbidden of [
    'do-not-return@example.test', '+15555550123', 'raw_payload', 'provider_payload', 'payment_payload', 'proof_payload', 'should_not_return',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked`);
  }
}

function assertSafety(payload, writes) {
  assert.equal(payload.writes_performed, false);
  assert.equal(payload.provider_call_impact, false);
  assert.equal(payload.notifications_sent, false);
  assert.equal(payload.hub_mutation_performed, false);
  assert.equal(payload.live_command_candidate, false);
  assert.equal(writes.length, 0, 'no fixture writes expected');
}

const results = [];

{
  const { status, payload, writes } = await invoke({
    store: { events: [nativeEvent({ id: 'native_only_event' })] },
    hubData: emptyHubCalendar(),
  });
  assert.equal(status, 200);
  const item = findItem(payload, row => row.id === 'native_only_event');
  assert.ok(item);
  assert.equal(item.data_source, 'customer_app_native');
  assert.equal(item.native_primary, true);
  assert.equal(item.hub_fallback_used, false);
  assert.equal(payload.native_first_enabled, true);
  assert.equal(payload.calendar_events_source, 'customer_app_native_first_with_hub_fallback');
  assert.equal(payload.native_event_count, 1);
  assertSafety(payload, writes);
  results.push('native_calendar_event_present_native_primary');
  results.push('hub_event_absent_native_still_returned');
  results.push('native_first_fallback_metadata_returned');
}

{
  const { payload, writes } = await invoke({
    store: {},
    hubData: emptyHubCalendar({ dates: [dateGroup(DATE, [hubEvent({ id: 'hub_only_event' })])] }),
  });
  const item = findItem(payload, row => row.id === 'hub_only_event');
  assert.ok(item);
  assert.equal(item.data_source, 'hub_fallback');
  assert.equal(item.native_primary, false);
  assert.equal(item.hub_fallback_used, true);
  assert.equal(item.fallback_reason, 'native_calendar_event_missing');
  assert.equal(payload.hub_fallback_event_count, 1);
  assert.equal(payload.fallback_required, true);
  assertSafety(payload, writes);
  results.push('native_event_missing_hub_fallback_used');
  results.push('hub_only_active_event_retained');
}

{
  const { payload, writes } = await invoke({
    store: { events: [nativeEvent({ id: 'shared_incomplete_event', event_type: '', title: 'Shared Incomplete Event' })] },
    hubData: emptyHubCalendar({ dates: [dateGroup(DATE, [hubEvent({ id: 'shared_incomplete_event', title: 'Shared Incomplete Event', event_type: 'community_event' })])] }),
  });
  const item = findItem(payload, row => row.id === 'shared_incomplete_event');
  assert.ok(item);
  assert.equal(item.data_source, 'native_with_hub_fallback_context');
  assert.equal(item.native_primary, true);
  assert.equal(item.hub_fallback_used, true);
  assert.equal(item.fallback_reason, 'native_data_incomplete_for_calendar_event');
  assert.equal(payload.hub_fallback_event_count, 1);
  assertSafety(payload, writes);
  results.push('native_event_incomplete_uses_hub_fallback_context');
}

{
  const { payload, writes } = await invoke({
    store: { batches: [nativeBatch()] },
    hubData: emptyHubCalendar({ dates: [dateGroup(DATE, [hubProduction()])] }),
  });
  const productionItems = allItems(payload).filter(row => row.type === 'production');
  assert.equal(productionItems.length, 1);
  assert.equal(productionItems[0].data_source, 'customer_app_native');
  assert.equal(payload.suppressed_hub_event_count, 1);
  assert.ok(payload.fallback_reasons.includes('duplicate_native_hub_event_deduped'));
  assertSafety(payload, writes);
  results.push('duplicate_native_hub_event_deduped');
}

{
  const { payload, writes } = await invoke({
    store: {},
    hubData: emptyHubCalendar({ dates: [dateGroup(DATE, [hubEvent({ id: 'subscription_event', event_type: 'subscription_occurrence' })])] }),
  });
  const item = findItem(payload, row => row.id === 'subscription_event');
  assert.ok(item);
  assert.equal(item.fallback_reason, 'subscription_calendar_event_hub_source_of_truth');
  assert.ok(payload.fallback_reasons.includes('subscription_calendar_event_hub_source_of_truth'));
  assertSafety(payload, writes);
  results.push('subscription_multi_delivery_hub_source_of_truth');
}

{
  const { payload, writes } = await invoke({
    store: {},
    hubData: emptyHubCalendar({ dates: [dateGroup(DATE, [hubEvent({ id: 'historical_event', event_type: 'historical_late_mirror' })])] }),
  });
  const item = findItem(payload, row => row.id === 'historical_event');
  assert.ok(item);
  assert.equal(item.fallback_reason, 'historical_hub_event_retained');
  assert.equal(payload.live_command_candidate, false);
  assertSafety(payload, writes);
  results.push('historical_late_mirror_not_command_candidate');
  results.push('live_command_candidate_false');
}

{
  const { payload, writes } = await invoke({
    store: { events: [nativeEvent({ id: 'stale_shared_event', start_datetime: `${DATE}T15:00:00Z` })] },
    hubData: emptyHubCalendar({ dates: [dateGroup(STALE_DATE, [hubEvent({ id: 'stale_shared_event', start_datetime: `${STALE_DATE}T15:00:00Z` })])] }),
  });
  assert.equal(findItem(payload, row => row.id === 'stale_shared_event')?.data_source, 'customer_app_native');
  assert.equal(payload.suppressed_hub_event_count, 1);
  assert.equal(payload.mismatch_count, 1);
  assert.ok(payload.fallback_reasons.includes('stale_hub_event_suppressed'));
  assertSafety(payload, writes);
  results.push('stale_hub_event_suppressed_when_corrected_native_date_exists');
}

{
  const { payload, writes } = await invoke({ store: {}, hubData: emptyHubCalendar() });
  assert.equal(payload.summary.total_items, 0);
  assert.deepEqual(payload.dates, []);
  assert.ok(payload.fallback_reasons.includes('no_calendar_events_found'));
  assertSafety(payload, writes);
  results.push('no_events_empty_safe_response');
}

{
  const { payload, writes } = await invoke({
    store: {
      events: [nativeEvent({ id: 'shape_event' })],
      batches: [nativeBatch()],
      tasks: [nativeTask()],
      compliance: [complianceLog()],
    },
    hubData: emptyHubCalendar(),
  });
  assert.ok(payload.success);
  assert.ok(payload.summary);
  assert.ok(Array.isArray(payload.dates));
  assert.ok(Object.hasOwn(payload.summary, 'total_items'));
  assert.ok(Object.hasOwn(payload.summary, 'events'));
  assert.ok(Object.hasOwn(payload.summary, 'production_days'));
  assert.ok(Object.hasOwn(payload.summary, 'delivery_days'));
  assert.ok(Object.hasOwn(payload.summary, 'compliance_items'));
  assertNoForbiddenPayloads(payload);
  assertSafety(payload, writes);
  results.push('existing_response_shape_backward_compatible');
  results.push('no_customer_email_phone_returned');
  results.push('no_raw_hub_provider_payment_payload_returned');
  results.push('writes_performed_false');
  results.push('provider_call_impact_false');
  results.push('notifications_sent_false');
  results.push('hub_mutation_performed_false');
  results.push('no_logs_queues_created');
}

console.log(JSON.stringify({
  suite: 'G39H admin calendar events native-first simulation',
  total_test_cases: results.length,
  passed: results.length,
  failed: 0,
  results,
}, null, 2));
