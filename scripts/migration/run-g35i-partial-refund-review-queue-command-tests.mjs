#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/createNativePartialRefundReviewQueueForCustomerApp/entry.ts');

const LOOKUP = {
  orderNumber: 'NV-MPZNKGNT',
  customerOrderId: '6a219a3f4adcda5856c3d579',
  nativeOrderId: '6a22ffda400eb806eb3ca945',
  taskId: '6a22ffdaf675ea79e30575aa',
};

const OWNER = { role: 'admin', email: 'owner@example.com' };
const OPEN_GATES = {
  ENABLE_NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE: 'true',
  NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE_KILL_SWITCH: 'false',
  NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE_ALLOWED_EMAILS: OWNER.email,
  NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE_ORDER_ALLOWLIST: LOOKUP.orderNumber,
  NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE_CUSTOMER_ORDER_ALLOWLIST: LOOKUP.customerOrderId,
  NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE_SHOPIFY_ORDER_ALLOWLIST: LOOKUP.nativeOrderId,
  NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE_POLICY: 'PARTIAL_REFUND_REVIEW_QUEUE_ONLY_NO_NOTIFICATION',
};

const DEFAULT_BODY = {
  order_number: LOOKUP.orderNumber,
  customer_app_order_id: LOOKUP.customerOrderId,
  native_shopify_order_id: LOOKUP.nativeOrderId,
  native_fulfillment_task_id: LOOKUP.taskId,
  refund_type: 'partial',
  refund_amount: 5,
  refund_currency: 'USD',
  event_source: 'admin_review',
  notification_policy: 'NO_NOTIFICATION',
  request_id: 'g35i_test_request',
  confirmation: 'create_native_partial_refund_review_queue_no_notification',
};

function makePreview(overrides = {}) {
  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    preview_mode: 'NATIVE_PARTIAL_REFUND_REVIEW_IMPACT',
    order_number: LOOKUP.orderNumber,
    refund_type: 'partial',
    refund_amount: 5,
    refund_currency: 'USD',
    order_found: true,
    customer_app_order_present: true,
    native_shopify_order_present: true,
    native_fulfillment_task_present: true,
    preview_data_stable: true,
    read_consistency: { stable: true, blocker_required: false, inconsistent_sections: [] },
    production_batch_count: 6,
    verified_logged_batch_count: 6,
    batch_compliance_log_count: 6,
    locked_compliance_log_count: 6,
    proposed_order_review_queue_impact: {
      draft_recommended_for_future_command: true,
      safe_queue_draft: {
        incident_type: 'partial_refund_review_required',
        review_reason: 'Partial refund requires manual review.',
        raw_payload_included: false,
        customer_pii_included: false,
      },
    },
    proposed_customer_app_order_impact: { status_mutation_proposed: false },
    proposed_native_shopify_order_impact: { status_mutation_proposed: false },
    proposed_fulfillment_task_impact: { would_cancel_task: false },
    production_batch_mutation_proposed: false,
    compliance_log_mutation_proposed: false,
    notification_impact: { notification_held: true, notification_would_send: false },
    provider_call_impact: false,
    safety: { provider_calls_performed: false, notifications_sent: false },
    blockers: [],
    warnings: ['notifications_held', 'hub_fallback_required'],
    ...overrides,
  };
}

function loadHarness({ env = {}, user = OWNER, preview = makePreview(), existingReviews = [], commandLogs = [] } = {}) {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });

  const store = {
    writes: [],
    reviewRows: structuredClone(existingReviews),
    commandLogs: structuredClone(commandLogs),
    previewCalls: [],
  };
  const match = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const readRows = name => {
    if (name === 'OrderReviewQueue') return store.reviewRows;
    if (name === 'CommandLog') return store.commandLogs;
    return [];
  };
  const api = name => ({
    list: async () => readRows(name),
    filter: async filter => readRows(name).filter(row => match(row, filter)),
    get: async id => readRows(name).find(row => row?.id === id) || null,
    create: async payload => {
      store.writes.push({ op: 'create', name, payload });
      if (name === 'OrderReviewQueue') {
        const row = { id: `orq_${store.reviewRows.length + 1}`, created_date: new Date().toISOString(), ...payload };
        store.reviewRows.push(row);
        return row;
      }
      if (name === 'CommandLog') {
        const row = { id: `cmd_${store.commandLogs.length + 1}`, created_date: new Date().toISOString(), ...payload };
        store.commandLogs.push(row);
        return row;
      }
      throw new Error(`unexpected create ${name}`);
    },
    update: async (id, patch) => { store.writes.push({ op: 'update', name, id, patch }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { store.writes.push({ op: 'delete', name, id }); throw new Error(`unexpected delete ${name}`); },
  });
  const base44 = {
    auth: { me: async () => { if (user instanceof Error) throw user; return user; } },
    functions: { invoke: async (name, payload) => {
      assert.equal(name, 'previewNativeOrderCutoverReadiness');
      store.previewCalls.push(payload);
      return { data: typeof preview === 'function' ? preview(payload) : preview };
    } },
    asServiceRole: { entities: {
      Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'), ProductionBatch: api('ProductionBatch'), BatchComplianceLog: api('BatchComplianceLog'),
      OrderReviewQueue: api('OrderReviewQueue'), OrderSyncLog: api('OrderSyncLog'), CommandLog: api('CommandLog'), SafeSyncParityLog: api('SafeSyncParityLog'), Notification: api('Notification'), CustomerMessageDeliveryLog: api('CustomerMessageDeliveryLog'), InventoryItem: api('InventoryItem'), PurchaseOrder: api('PurchaseOrder'),
    } },
  };
  return { handler: context.globalThis.__handler, store, base44, source };
}

function req(base44, body = DEFAULT_BODY, method = 'POST') {
  return { method, __base44: base44, headers: { get: () => '' }, text: async () => JSON.stringify(body) };
}
async function json(res) { return res.json(); }
async function call(options = {}, body = DEFAULT_BODY, method = 'POST') {
  const scenario = loadHarness({ env: OPEN_GATES, ...options });
  const response = await scenario.handler(req(scenario.base44, body, method));
  return { response, data: await json(response), ...scenario };
}

let result = await call({ env: { ...OPEN_GATES, ENABLE_NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE: 'false' } });
assert.equal(result.response.status, 409);
assert.equal(result.data.error_code, 'native_partial_refund_review_queue_create_disabled');
assert.equal(result.data.writes_performed, false);
assert.equal(result.store.writes.length, 0);

result = await call({ user: new Error('missing auth') });
assert.equal(result.response.status, 401);
assert.equal(result.data.error_code, 'unauthorized');
assert.equal(result.data.writes_performed, false);
assert.equal(result.store.writes.length, 0);

result = await call({ user: { role: 'user', email: OWNER.email } });
assert.equal(result.response.status, 403);
assert.equal(result.data.error_code, 'forbidden');
assert.equal(result.store.writes.length, 0);

result = await call({}, { ...DEFAULT_BODY, refund_amount: '' });
assert.equal(result.response.status, 400);
assert.equal(result.data.error_code, 'invalid_partial_refund_review_queue_request');
assert.ok(result.data.blockers.includes('refund_amount_required'));
assert.equal(result.store.writes.length, 0);

result = await call({}, { ...DEFAULT_BODY, refund_currency: '' });
assert.equal(result.response.status, 400);
assert.ok(result.data.blockers.includes('refund_currency_required'));
assert.equal(result.store.writes.length, 0);

result = await call({ preview: makePreview({ read_consistency: { stable: false, blocker_required: true, inconsistent_sections: ['production_batches'] } }) });
assert.equal(result.response.status, 409);
assert.equal(result.data.error_code, 'partial_refund_review_preview_not_write_ready');
assert.ok(result.data.blockers.includes('read_consistency_unstable'));
assert.equal(result.store.writes.length, 0);

result = await call({ preview: makePreview({ preview_data_stable: false }) });
assert.equal(result.response.status, 409);
assert.ok(result.data.blockers.includes('preview_data_unstable'));
assert.equal(result.store.writes.length, 0);

result = await call({ preview: makePreview({ proposed_order_review_queue_impact: { draft_recommended_for_future_command: false, safe_queue_draft: null } }) });
assert.equal(result.response.status, 409);
assert.ok(result.data.blockers.includes('partial_refund_review_queue_draft_missing'));
assert.equal(result.store.writes.length, 0);

result = await call();
assert.equal(result.response.status, 200);
assert.equal(result.data.success, true);
assert.equal(result.data.writes_performed, true);
assert.equal(result.data.order_review_queue_created, true);
assert.equal(result.data.command_log_created, true);
assert.equal(result.store.writes.length, 2);
assert.deepEqual(result.store.writes.map(write => `${write.op}:${write.name}`), ['create:OrderReviewQueue', 'create:CommandLog']);
const queuePayload = result.store.writes[0].payload;
assert.equal(queuePayload.incident_type, 'partial_refund_review_required');
assert.equal(queuePayload.status, 'pending');
assert.equal(queuePayload.existing_order_number, LOOKUP.orderNumber);
assert.equal(queuePayload.existing_order_id, LOOKUP.customerOrderId);
assert.equal(queuePayload.incoming_source, 'native_refund_impact_preview');
assert.equal(queuePayload.incoming_payload.refund_amount, 5);
assert.equal(queuePayload.incoming_payload.refund_currency, 'USD');
assert.equal(queuePayload.incoming_payload.customer_app_order_id, LOOKUP.customerOrderId);
assert.equal(queuePayload.incoming_payload.native_shopify_order_id, LOOKUP.nativeOrderId);
assert.equal(queuePayload.incoming_payload.native_fulfillment_task_id, LOOKUP.taskId);
assert.equal(queuePayload.incoming_payload.production_batch_count, 6);
assert.equal(queuePayload.incoming_payload.batch_compliance_log_count, 6);
assert.equal(queuePayload.incoming_payload.raw_payload_included, false);
assert.equal(queuePayload.incoming_payload.customer_pii_included, false);
assert.equal(queuePayload.incoming_payload.provider_payload_included, false);
assert.equal(queuePayload.incoming_payload.provider_call_impact, false);
assert.equal(result.data.safety.provider_calls_performed, false);
assert.equal(result.data.safety.notifications_sent, false);
assert.equal(result.data.safety.customer_app_order_updated, false);
assert.equal(result.data.safety.native_shopify_order_updated, false);
assert.equal(result.data.safety.native_fulfillment_task_updated, false);
assert.equal(result.data.safety.production_batch_updated, false);
assert.equal(result.data.safety.compliance_log_updated, false);
assert.equal(result.data.safety.inventory_reversal, false);
assert.equal(result.data.safety.purchase_order_reversal, false);
assert.equal(result.data.safety.hub_records_updated, false);
assert.equal(result.store.previewCalls[0].preview_mode, 'NATIVE_PARTIAL_REFUND_REVIEW_IMPACT');
assert.equal(result.store.previewCalls[0].customer_app_order_id, LOOKUP.customerOrderId);
assert.equal(result.store.previewCalls[0].native_shopify_order_id, LOOKUP.nativeOrderId);

result = await call({}, { ...DEFAULT_BODY, request_id: 'g35i_provider_id_preserve', stripe_event_id: 'evt_g35i_provider12345', stripe_refund_id: 're_g35i_provider12345' });
assert.equal(result.response.status, 200);
assert.equal(result.store.writes[0].payload.incoming_payload.stripe_event_id, 'evt_g35i_provider12345');
assert.equal(result.store.writes[0].payload.incoming_payload.stripe_refund_id, 're_g35i_provider12345');
assert.equal(result.store.writes[0].payload.incoming_payload.raw_payload_included, false);
assert.equal(result.store.writes[0].payload.incoming_payload.provider_payload_included, false);

const existingSuccessLog = {
  id: 'cmd_existing_success',
  status: 'success',
  error_code: null,
  idempotency_key: `native_partial_refund_review_queue_create:${LOOKUP.orderNumber}:${LOOKUP.customerOrderId}:${LOOKUP.nativeOrderId}:${DEFAULT_BODY.request_id}`,
};
result = await call({ commandLogs: [existingSuccessLog] });
assert.equal(result.response.status, 200);
assert.equal(result.data.skipped, true);
assert.equal(result.data.idempotent, true);
assert.equal(result.data.writes_performed, false);
assert.equal(result.store.writes.length, 0);

const duplicateReview = {
  id: 'orq_existing',
  incident_type: 'partial_refund_review_required',
  status: 'pending',
  existing_order_id: LOOKUP.customerOrderId,
  existing_order_number: LOOKUP.orderNumber,
  idempotency_key: 'different_request',
  incoming_payload: { stripe_event_id: 'evt_g35i_duplicate', stripe_refund_id: 're_g35i_duplicate' },
};
result = await call({ existingReviews: [duplicateReview] }, { ...DEFAULT_BODY, request_id: 'g35i_dupe_event', stripe_event_id: 'evt_g35i_duplicate' });
assert.equal(result.response.status, 200);
assert.equal(result.data.duplicate_review_detected, true);
assert.equal(result.data.writes_performed, false);
assert.equal(result.store.writes.length, 0);

result = await call({ existingReviews: [duplicateReview] }, { ...DEFAULT_BODY, request_id: 'g35i_dupe_refund', stripe_refund_id: 're_g35i_duplicate' });
assert.equal(result.response.status, 200);
assert.equal(result.data.duplicate_review_detected, true);
assert.equal(result.store.writes.length, 0);

result = await call({}, { ...DEFAULT_BODY, raw_stripe_payload: { id: 'evt_bad' } });
assert.equal(result.response.status, 400);
assert.equal(result.data.error_code, 'unsupported_or_forbidden_input');
assert.equal(result.store.writes.length, 0);

result = await call({}, DEFAULT_BODY, 'GET');
assert.equal(result.response.status, 405);
assert.equal(result.data.writes_performed, false);
assert.equal(result.store.writes.length, 0);

const totalCases = 15;
console.log(JSON.stringify({ success: true, harness: 'G35I partial refund review queue command', total_cases: totalCases, writes_limited_to_in_memory_queue_and_command_log: true, live_records_mutated: false }, null, 2));
