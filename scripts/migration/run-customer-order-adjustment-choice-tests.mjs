import assert from 'node:assert/strict';
import {
  buildCustomerOrderAdjustmentCommunications,
  CUSTOMER_ORDER_ADJUSTMENT_CHOICES,
  handleCustomerOrderAdjustmentRequest,
} from '../../base44/functions/processManualRefund/customerOrderAdjustment.ts';
import { readFile } from 'node:fs/promises';

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
      financial_status: 'paid',
      payment_captured: true,
      status: 'scheduled_for_juicing',
      assigned_delivery_date: '2026-08-05',
      production_date: '2026-08-04',
      assigned_production_day: '2026-08-04',
      stripe_payment_intent_id: 'pi_synthetic_lee',
      total: 47.99,
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
      production_status: 'awaiting_production',
      fulfillment_mode: 'single_delivery',
      line_items: [
        { title: 'The NuVira Trio', quantity: 1, price: 36 },
        { title: 'Radiance Shot', quantity: 1, price: 6 },
      ],
    }]),
    FulfillmentTask: entityStore([{
      id: 'task_lee',
      order_id: 'order_lee',
      base44_order_id: 'order_lee',
      shopify_order_id: 'shopify_lee',
      order_number: 'NV-TEST-LEE',
      customer_name: 'Lee Burton',
      customer_email: 'lee@example.test',
      fulfillment_number: 1,
      delivery_date: '2026-08-05',
      scheduled_date: '2026-08-05',
      assigned_delivery_date: '2026-08-05',
      production_date: '2026-08-04',
      items: [
        { title: 'The NuVira Trio', quantity: 1 },
        { title: 'Radiance Shot', quantity: 1 },
      ],
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
    ProductionBatch: entityStore(),
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
  STRIPE_SECRET_KEY: 'sk_test_synthetic_only',
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

function workflowFetch(emailCalls, options = {}) {
  return async (url, init) => {
    if (url === 'https://api.resend.com/emails') {
      emailCalls.push({ url, init });
      return options.emailResponse || { ok: true, status: 200, json: async () => ({ id: 'synthetic_email_1' }) };
    }
    throw new Error(`unexpected external URL: ${url}`);
  };
}

function stripeMock(options = {}) {
  const calls = [];
  return {
    calls,
    client: {
      refunds: {
        async create(payload, requestOptions) {
          calls.push({ payload: clone(payload), requestOptions: clone(requestOptions) });
          if (options.error) throw new Error('synthetic provider failure');
          return options.result || { id: 're_synthetic_oasis', status: 'succeeded' };
        },
      },
    },
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
  assert.equal(state.invocations[0].payload.title, 'A quick update for your NuVira order');
  assert.equal(state.invocations[0].payload.message, 'Please choose what works best. For the freshest delivery, we recommend receiving your full order Saturday.');
  assert.doesNotMatch(JSON.parse(emailCalls[0].init.body).html, /label delay|labels will arrive/i);
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
  assertions += 25;

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
    const stripe = stripeMock();
    const fetchImpl = workflowFetch(calls);
    await handleCustomerOrderAdjustmentRequest({
      base44: choiceState.base44,
      body: { ...prepareBody(), request_id: `choice-${choice}-20260804` },
      caller: { role: 'admin' },
      fetchImpl,
      envGet: (name) => ENV[name] || '',
      now: NOW,
    });
    const choiceToken = tokenFromEmail(calls);
    const response = await responseJson(await handleCustomerOrderAdjustmentRequest({
      base44: choiceState.base44,
      body: { action: 'submit_customer_order_adjustment', token: choiceToken, choice },
      fetchImpl,
      envGet: (name) => ENV[name] || '',
      stripeClient: stripe.client,
      now: NOW,
    }));
    assert.equal(response.status, 200);
    assert.equal(response.body.request.selected_choice, choice);
    assert.equal(response.body.request.request_state, 'completed');
    assert.equal(choiceState.stores.OrderReviewQueue.rows[0].status, 'resolved');
    assert.equal(calls.length, 1, 'submit must not contact an external Hub or resend email');

    if (choice === 'full_order_saturday') {
      assert.equal(choiceState.stores.Order.rows[0].production_date, '2026-08-07');
      assert.equal(choiceState.stores.Order.rows[0].assigned_delivery_date, '2026-08-08');
      assert.equal(choiceState.stores.ShopifyOrder.rows[0].fulfillments.length, 1);
      assert.deepEqual(choiceState.stores.ShopifyOrder.rows[0].fulfillments[0].items.map((item) => item.title), ['Re-Nu', 'Aura', 'Oasis', 'Radiance Shot']);
      assert.equal(choiceState.stores.FulfillmentTask.rows.length, 1);
      assert.equal(stripe.calls.length, 0);
    } else if (choice === 'oasis_saturday') {
      assert.equal(choiceState.stores.Order.rows[0].production_date, '2026-08-04');
      assert.equal(choiceState.stores.ShopifyOrder.rows[0].fulfillment_mode, 'multi_delivery');
      assert.equal(choiceState.stores.ShopifyOrder.rows[0].fulfillments.length, 2);
      assert.deepEqual(choiceState.stores.ShopifyOrder.rows[0].fulfillments[1].items.map((item) => item.title), ['Oasis']);
      assert.equal(choiceState.stores.FulfillmentTask.rows.length, 2);
      assert.deepEqual(choiceState.stores.FulfillmentTask.rows[1].items.map((item) => item.title), ['Oasis']);
      assert.equal(stripe.calls.length, 0);
    } else {
      assert.equal(stripe.calls.length, 1);
      assert.equal(stripe.calls[0].payload.amount, 1200);
      assert.equal(stripe.calls[0].payload.payment_intent, 'pi_synthetic_lee');
      assert.match(stripe.calls[0].requestOptions.idempotencyKey, /oasis-refund$/);
      assert.equal(choiceState.stores.Order.rows[0].status, 'scheduled_for_juicing');
      assert.equal(choiceState.stores.Order.rows[0].payment_status, 'paid');
      assert.equal(choiceState.stores.Order.rows[0].refund_status, 'partially_refunded');
      assert.equal(choiceState.stores.ShopifyOrder.rows[0].payment_status, 'paid');
      assert.equal(choiceState.stores.ShopifyOrder.rows[0].refund_status, 'partially_refunded');
      assert.equal(choiceState.stores.FulfillmentTask.rows.length, 1);
      assert.equal(choiceState.stores.FulfillmentTask.rows[0].items.some((item) => item.title === 'Oasis'), false);
    }

    const replay = await responseJson(await handleCustomerOrderAdjustmentRequest({
      base44: choiceState.base44,
      body: { action: 'submit_customer_order_adjustment', token: choiceToken, choice },
      fetchImpl,
      envGet: (name) => ENV[name] || '',
      stripeClient: stripe.client,
      now: NOW,
    }));
    assert.equal(replay.status, 200);
    assert.equal(replay.body.skipped, true);
    assert.equal(calls.length, 1, 'completed replay must not contact an external Hub or resend email');
    if (choice === 'oasis_refund') assert.equal(stripe.calls.length, 1, 'completed replay must not repeat Stripe refund');
    assertions += choice === 'full_order_saturday' ? 12 : (choice === 'oasis_saturday' ? 13 : 18);
  }

  const stateStripe = stripeMock();
  const selected = await responseJson(await handleCustomerOrderAdjustmentRequest({
    base44: state.base44,
    body: { action: 'submit_customer_order_adjustment', token, choice: 'full_order_saturday' },
    fetchImpl: workflowFetch(emailCalls),
    envGet: (name) => ENV[name] || '',
    stripeClient: stateStripe.client,
    now: NOW,
  }));
  assert.equal(selected.status, 200);
  assert.equal(selected.body.request.selected_choice, 'full_order_saturday');
  assert.equal(state.stores.OrderReviewQueue.rows[0].status, 'resolved');
  assert.equal(state.stores.FulfillmentTask.rows[0].review_status, 'resolved');
  assert.equal(state.stores.Order.rows[0].assigned_delivery_date, '2026-08-08');
  assertions += 5;

  const replay = await responseJson(await handleCustomerOrderAdjustmentRequest({
    base44: state.base44,
    body: { action: 'submit_customer_order_adjustment', token, choice: 'full_order_saturday' },
    fetchImpl: workflowFetch(emailCalls),
    envGet: (name) => ENV[name] || '',
    stripeClient: stateStripe.client,
    now: NOW,
  }));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.skipped, true);
  assert.equal(state.stores.FulfillmentTask.rows[0].audit_trail.length, 2, 'replay must not duplicate task audit events');
  assertions += 3;

  const conflicting = await responseJson(await handleCustomerOrderAdjustmentRequest({
    base44: state.base44,
    body: { action: 'submit_customer_order_adjustment', token, choice: 'oasis_refund' },
    fetchImpl: workflowFetch(emailCalls),
    envGet: (name) => ENV[name] || '',
    stripeClient: stateStripe.client,
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

  {
    const failedRefundState = fixture();
    const emails = [];
    const failedStripe = stripeMock({ error: true });
    const fetchImpl = workflowFetch(emails);
    await handleCustomerOrderAdjustmentRequest({
      base44: failedRefundState.base44,
      body: { ...prepareBody(), request_id: 'refund-provider-failure-20260804' },
      caller: { role: 'admin' },
      fetchImpl,
      envGet: (name) => ENV[name] || '',
      now: NOW,
    });
    const failedToken = tokenFromEmail(emails);
    const failed = await responseJson(await handleCustomerOrderAdjustmentRequest({
      base44: failedRefundState.base44,
      body: { action: 'submit_customer_order_adjustment', token: failedToken, choice: 'oasis_refund' },
      fetchImpl,
      envGet: (name) => ENV[name] || '',
      stripeClient: failedStripe.client,
      now: NOW,
    }));
    assert.equal(failed.status, 502);
    assert.equal(failed.body.retryable, true);
    assert.equal(failedRefundState.stores.Order.rows[0].refund_status, undefined);
    assert.equal(failedRefundState.stores.Order.rows[0].payment_status, 'paid');
    assert.equal(emails.length, 1, 'failed refund must not contact any system beyond the initial email and mocked Stripe boundary');
    assertions += 5;
  }

  {
    const unavailableState = fixture();
    const emails = [];
    await handleCustomerOrderAdjustmentRequest({
      base44: unavailableState.base44,
      body: { ...prepareBody(), request_id: 'native-preflight-unavailable-20260804' },
      caller: { role: 'admin' },
      fetchImpl: workflowFetch(emails),
      envGet: (name) => ENV[name] || '',
      now: NOW,
    });
    const token = tokenFromEmail(emails);
    delete unavailableState.base44.asServiceRole.entities.ProductionBatch;
    const blocked = await responseJson(await handleCustomerOrderAdjustmentRequest({
      base44: unavailableState.base44,
      body: { action: 'submit_customer_order_adjustment', token, choice: 'full_order_saturday' },
      fetchImpl: workflowFetch(emails),
      envGet: (name) => ENV[name] || '',
      now: NOW,
    }));
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.error, 'order_adjustment_preflight_unavailable');
    assert.equal(unavailableState.stores.Order.rows[0].assigned_delivery_date, '2026-08-05');
    assertions += 3;
  }

  {
    const lockedState = fixture();
    const emails = [];
    const stripe = stripeMock();
    lockedState.stores.ProductionBatch.rows.push({
      id: 'batch_locked',
      batch_id: 'BATCH-TEST-OASIS',
      product_name: 'Oasis',
      production_date: '2026-08-04',
      status: 'in_production',
      is_locked: true,
      related_orders: ['shopify_lee'],
      order_sources: [{ order_id: 'order_lee', order_number: 'NV-TEST-LEE', quantity: 1 }],
    });
    const fetchImpl = workflowFetch(emails);
    await handleCustomerOrderAdjustmentRequest({
      base44: lockedState.base44,
      body: { ...prepareBody(), request_id: 'locked-hub-preflight-20260804' },
      caller: { role: 'admin' },
      fetchImpl,
      envGet: (name) => ENV[name] || '',
      now: NOW,
    });
    const token = tokenFromEmail(emails);
    const before = clone({
      order: lockedState.stores.Order.rows[0],
      operational: lockedState.stores.ShopifyOrder.rows[0],
    });
    const blocked = await responseJson(await handleCustomerOrderAdjustmentRequest({
      base44: lockedState.base44,
      body: { action: 'submit_customer_order_adjustment', token, choice: 'oasis_refund' },
      fetchImpl,
      envGet: (name) => ENV[name] || '',
      stripeClient: stripe.client,
      now: NOW,
    }));
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error, 'order_adjustment_no_longer_available');
    assert.equal(stripe.calls.length, 0);
    assert.equal(emails.length, 1, 'native lock preflight must not call an external Hub');
    assert.deepEqual(lockedState.stores.Order.rows[0], before.order);
    assert.deepEqual(lockedState.stores.ShopifyOrder.rows[0], before.operational);
    assert.equal(lockedState.stores.OrderReviewQueue.rows[0].incoming_payload.selected_choice, null);
    assertions += 7;
  }

  assert.deepEqual(Object.keys(CUSTOMER_ORDER_ADJUSTMENT_CHOICES), [
    'full_order_saturday',
    'oasis_saturday',
    'oasis_refund',
  ]);
  const orderOptionsSource = await readFile(new URL('../../src/pages/OrderOptions.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(orderOptionsSource, /label delay|labels will arrive/i);
  assert.match(orderOptionsSource, /submitError\?\.response\?\.data\?\.request/);
  assert.match(orderOptionsSource, /failureRequest\?\.selected_choice/);
  assertions += 4;

  console.log(`customer order adjustment tests: ${assertions} assertions passed`);
  console.log('external network requests: 0 (all approved provider calls mocked)');
}

await run();
