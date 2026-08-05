import assert from 'node:assert/strict';
import {
  buildCustomerOrderAdjustmentCommunications,
  CUSTOMER_ORDER_ADJUSTMENT_CHOICES,
  handleCustomerOrderAdjustmentRequest,
} from '../../base44/functions/processManualRefund/customerOrderAdjustment.ts';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function entityStore(initial = []) {
  const rows = initial.map(clone);
  let sequence = rows.length;
  return {
    rows,
    async filter(filter = {}, _sort, limit = 100) {
      return rows.filter((row) => Object.entries(filter).every(([key, value]) => row[key] === value)).slice(0, limit).map(clone);
    },
    async create(payload) {
      const row = { id: payload.id || `row_${++sequence}`, created_date: new Date().toISOString(), ...clone(payload) };
      rows.push(row);
      return clone(row);
    },
    async update(id, payload) {
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) throw new Error(`missing row ${id}`);
      rows[index] = { ...rows[index], ...clone(payload), updated_date: new Date().toISOString() };
      return clone(rows[index]);
    },
    async get(id) {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) throw new Error(`missing row ${id}`);
      return clone(row);
    },
  };
}

function fixture() {
  const stores = {
    Order: entityStore([{
      id: 'order_lee',
      order_number: 'NV-TEST-LEE',
      customer_name: 'Lee Burton',
      customer_email: 'lee@example.test',
      payment_status: 'paid',
      status: 'scheduled_for_juicing',
      assigned_delivery_date: '2026-08-05',
      production_date: '2026-08-04',
      items: [
        { title: 'The NuVira Trio', quantity: 1, price: 36 },
        { title: 'Radiance Shot', quantity: 1, price: 6 },
      ],
    }]),
    ShopifyOrder: entityStore([{
      id: 'shopify_lee',
      order_number: 'NV-TEST-LEE',
      shopify_order_number: 'NV-TEST-LEE',
      assigned_delivery_date: '2026-08-05',
      selected_delivery_date: '2026-08-05',
      requested_delivery_date: '2026-08-05',
      production_date: '2026-08-04',
      payment_status: 'paid',
    }]),
    FulfillmentTask: entityStore([{
      id: 'task_lee',
      order_id: 'order_lee',
      base44_order_id: 'order_lee',
      shopify_order_id: 'shopify_lee',
      order_number: 'NV-TEST-LEE',
      status: 'pending',
      audit_trail: [],
    }]),
    Bundle: entityStore([{
      id: 'bundle_trio',
      bundle_name: 'The NuVira Trio',
      components: [
        { product_name: 'Re-Nu', quantity: 1 },
        { product_name: 'Aura', quantity: 1 },
        { product_name: 'Oasis', quantity: 1 },
      ],
    }]),
    OrderReviewQueue: entityStore(),
    CustomerMessageDeliveryLog: entityStore(),
  };
  const invocations = [];
  const base44 = {
    asServiceRole: { entities: stores },
    functions: {
      async invoke(name, payload) {
        invocations.push({ name, payload: clone(payload) });
        assert.equal(name, 'sendCustomerNotification');
        return { success: true, notification_id: 'notification_1', push_attempted: true, push_sent: true, push_token_count: 1 };
      },
    },
  };
  return { base44, stores, invocations };
}

const NOW = new Date('2026-08-04T22:30:00.000Z');
const EXPIRES = '2026-08-07T17:00:00.000Z';
const ENV = {
  RESEND_API_KEY: 'synthetic_resend_key',
  TRANSACTIONAL_COMMUNICATIONS_INTERNAL_TOKEN: 'synthetic_internal_token',
};

async function responseJson(response) {
  return { status: response.status, body: await response.json() };
}

function prepareBody() {
  return {
    action: 'prepare_customer_order_adjustment',
    order_number: 'NV-TEST-LEE',
    request_id: 'lee-oasis-label-20260804',
    target_delivery_date: '2026-08-08',
    target_production_date: '2026-08-07',
    expires_at: EXPIRES,
  };
}

function testFetch(calls, response = { ok: true, status: 200, json: async () => ({ id: 'synthetic_email_1' }) }) {
  return async (url, init) => {
    assert.equal(url, 'https://api.resend.com/emails', 'unexpected external URL');
    calls.push({ url, init });
    return response;
  };
}

function tokenFromEmail(calls) {
  const request = JSON.parse(calls[0].init.body);
  const match = request.html.match(/order-options\?token=([A-Za-z0-9_-]+)/);
  assert.ok(match, 'choice token missing from email');
  return match[1];
}

async function run() {
  let assertions = 0;

  {
    const { base44 } = fixture();
    const response = await responseJson(await handleCustomerOrderAdjustmentRequest({
      base44,
      body: prepareBody(),
      caller: null,
      fetchImpl: async () => { throw new Error('network must not run'); },
      envGet: (name) => ENV[name] || '',
      now: NOW,
    }));
    assert.equal(response.status, 403);
    assertions += 1;
  }

  {
    const { base44 } = fixture();
    const response = await responseJson(await handleCustomerOrderAdjustmentRequest({
      base44,
      body: prepareBody(),
      caller: { role: 'admin' },
      fetchImpl: async () => { throw new Error('network must not run'); },
      envGet: () => '',
      now: NOW,
    }));
    assert.equal(response.status, 503);
    assertions += 1;
  }

  const state = fixture();
  const emailCalls = [];
  const prepared = await responseJson(await handleCustomerOrderAdjustmentRequest({
    base44: state.base44,
    body: prepareBody(),
    caller: { role: 'admin', email: 'operator@example.test' },
    fetchImpl: testFetch(emailCalls),
    envGet: (name) => ENV[name] || '',
    now: NOW,
  }));
  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.success, true);
  assert.equal(prepared.body.oasis_refund_amount, 12);
  assert.equal(prepared.body.email_sent, true);
  assert.equal(prepared.body.push_sent, true);
  assert.equal(prepared.body.paused_task_count, 1);
  assert.equal(emailCalls.length, 1);
  assert.match(JSON.parse(emailCalls[0].init.body).html, /freshness-first recommendation/i);
  assert.equal((JSON.parse(emailCalls[0].init.body).html.match(/order-options\?token=/g) || []).length, 3);
  assert.equal(state.invocations.length, 1);
  assert.equal(state.invocations[0].payload.notification_subtype, 'order_delayed');
  assert.equal(state.invocations[0].payload.push_priority, 'high');
  assert.equal(state.invocations[0].payload.title, 'Choose an update for order NV-TEST-LEE');
  assert.match(state.invocations[0].payload.message, /full Friday production for one Saturday delivery/);
  assert.equal(state.stores.FulfillmentTask.rows[0].status, 'needs_review');
  assert.equal(state.stores.FulfillmentTask.rows[0].review_status, 'customer_choice_pending');
  assert.equal(state.stores.Order.rows[0].status, 'scheduled_for_juicing', 'prepare must not mutate order lifecycle');
  assert.equal(state.stores.ShopifyOrder.rows[0].assigned_delivery_date, '2026-08-05', 'prepare must not mutate schedule');
  const token = tokenFromEmail(emailCalls);
  const serializedReview = JSON.stringify(state.stores.OrderReviewQueue.rows[0]);
  assert.equal(serializedReview.includes(token), false, 'raw token must not be stored');
  const preparedReplay = await responseJson(await handleCustomerOrderAdjustmentRequest({
    base44: state.base44,
    body: prepareBody(),
    caller: { role: 'admin', email: 'operator@example.test' },
    fetchImpl: testFetch(emailCalls),
    envGet: (name) => ENV[name] || '',
    now: NOW,
  }));
  assert.equal(preparedReplay.status, 200);
  assert.equal(state.stores.OrderReviewQueue.rows.length, 1, 'prepare retry must reuse the request');
  assert.equal(emailCalls.length, 1, 'prepare retry must not resend email');
  assert.equal(state.stores.FulfillmentTask.rows[0].audit_trail.length, 1, 'prepare retry must not duplicate task audit events');
  assertions += 24;

  const exactPreview = buildCustomerOrderAdjustmentCommunications({
    orderNumber: 'NV-TEST-LEE',
    firstName: 'Lee',
    token,
    currentDate: '2026-08-05',
    targetDate: '2026-08-08',
    refundAmount: 12,
  });
  assert.equal(exactPreview.email.subject, JSON.parse(emailCalls[0].init.body).subject);
  assert.equal(exactPreview.email.html, JSON.parse(emailCalls[0].init.body).html);
  assert.equal(Object.keys(exactPreview.email.links).length, 3);
  for (const [choice, url] of Object.entries(exactPreview.email.links)) {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/order-options');
    assert.equal(parsed.searchParams.get('token'), token);
    assert.equal(parsed.searchParams.get('choice'), choice);
  }
  assert.equal(exactPreview.push.title, state.invocations[0].payload.title);
  assert.equal(exactPreview.push.message, state.invocations[0].payload.message);
  assert.equal(exactPreview.push.deep_link, state.invocations[0].payload.deep_link);
  assertions += 12;

  {
    const invalid = await responseJson(await handleCustomerOrderAdjustmentRequest({
      base44: state.base44,
      body: { action: 'get_customer_order_adjustment', token: 'x'.repeat(43) },
      envGet: () => '',
      now: NOW,
    }));
    assert.equal(invalid.status, 404);
    assertions += 1;
  }

  const loaded = await responseJson(await handleCustomerOrderAdjustmentRequest({
    base44: state.base44,
    body: { action: 'get_customer_order_adjustment', token },
    envGet: () => '',
    now: NOW,
  }));
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.request.customer_first_name, 'Lee');
  assert.equal(loaded.body.request.choices.length, 3);
  assert.equal(loaded.body.request.choices.find((choice) => choice.id === 'full_order_saturday').recommended, true);
  assert.equal(loaded.body.request.choices.find((choice) => choice.id === 'oasis_refund').description.includes('$12.00'), true);
  assertions += 5;

  for (const choice of Object.keys(CUSTOMER_ORDER_ADJUSTMENT_CHOICES)) {
    const choiceState = fixture();
    const calls = [];
    await handleCustomerOrderAdjustmentRequest({
      base44: choiceState.base44,
      body: { ...prepareBody(), request_id: `choice-${choice}-20260804` },
      caller: { role: 'admin' },
      fetchImpl: testFetch(calls),
      envGet: (name) => ENV[name] || '',
      now: NOW,
    });
    const choiceToken = tokenFromEmail(calls);
    const response = await responseJson(await handleCustomerOrderAdjustmentRequest({
      base44: choiceState.base44,
      body: { action: 'submit_customer_order_adjustment', token: choiceToken, choice },
      envGet: () => '',
      now: NOW,
    }));
    assert.equal(response.status, 200);
    assert.equal(response.body.request.selected_choice, choice);
    assert.match(choiceState.stores.FulfillmentTask.rows[0].review_reason, /Customer/);
    assertions += 3;
  }

  const selected = await responseJson(await handleCustomerOrderAdjustmentRequest({
    base44: state.base44,
    body: { action: 'submit_customer_order_adjustment', token, choice: 'full_order_saturday' },
    envGet: () => '',
    now: NOW,
  }));
  assert.equal(selected.status, 200);
  assert.equal(selected.body.request.selected_choice, 'full_order_saturday');
  assert.equal(state.stores.OrderReviewQueue.rows[0].status, 'reviewing');
  assert.equal(state.stores.FulfillmentTask.rows[0].review_status, 'customer_choice_received');
  assert.equal(state.stores.Order.rows[0].assigned_delivery_date, '2026-08-05', 'customer selection must not bypass operator schedule confirmation');
  assertions += 5;

  const replay = await responseJson(await handleCustomerOrderAdjustmentRequest({
    base44: state.base44,
    body: { action: 'submit_customer_order_adjustment', token, choice: 'full_order_saturday' },
    envGet: () => '',
    now: NOW,
  }));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.skipped, true);
  assert.equal(state.stores.FulfillmentTask.rows[0].audit_trail.length, 2, 'replay must not duplicate task audit events');
  assertions += 3;

  const conflicting = await responseJson(await handleCustomerOrderAdjustmentRequest({
    base44: state.base44,
    body: { action: 'submit_customer_order_adjustment', token, choice: 'oasis_refund' },
    envGet: () => '',
    now: NOW,
  }));
  assert.equal(conflicting.status, 409);
  assert.equal(state.stores.OrderReviewQueue.rows[0].incoming_payload.selected_choice, 'full_order_saturday');
  assertions += 2;

  {
    const expiredState = fixture();
    const calls = [];
    await handleCustomerOrderAdjustmentRequest({
      base44: expiredState.base44,
      body: { ...prepareBody(), expires_at: '2026-08-04T23:00:00.000Z' },
      caller: { role: 'admin' },
      fetchImpl: testFetch(calls),
      envGet: (name) => ENV[name] || '',
      now: NOW,
    });
    const expiredToken = tokenFromEmail(calls);
    const response = await responseJson(await handleCustomerOrderAdjustmentRequest({
      base44: expiredState.base44,
      body: { action: 'get_customer_order_adjustment', token: expiredToken },
      envGet: () => '',
      now: new Date('2026-08-05T00:00:00.000Z'),
    }));
    assert.equal(response.status, 404);
    assertions += 1;
  }

  {
    const failedState = fixture();
    const calls = [];
    const response = await responseJson(await handleCustomerOrderAdjustmentRequest({
      base44: failedState.base44,
      body: prepareBody(),
      caller: { role: 'admin' },
      fetchImpl: testFetch(calls, { ok: false, status: 503, json: async () => ({ error: 'synthetic' }) }),
      envGet: (name) => ENV[name] || '',
      now: NOW,
    }));
    assert.equal(response.status, 502);
    assert.equal(response.body.email_sent, false);
    assert.equal(failedState.stores.CustomerMessageDeliveryLog.rows[0].status, 'failed');
    assert.equal(JSON.stringify(response.body).includes(ENV.RESEND_API_KEY), false);
    assertions += 4;
  }

  assert.deepEqual(Object.keys(CUSTOMER_ORDER_ADJUSTMENT_CHOICES), [
    'full_order_saturday',
    'oasis_saturday',
    'oasis_refund',
  ]);
  assertions += 1;

  console.log(`customer order adjustment tests: ${assertions} assertions passed`);
  console.log('external network requests: 0 (all approved provider calls mocked)');
}

await run();
