#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/stripeWebhook/entry.ts');

const BASE_ENV = {
  STRIPE_SECRET_KEY: 'synthetic_stripe_secret',
  STRIPE_WEBHOOK_SECRET: 'synthetic_webhook_secret',
  ENABLE_STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW: 'false',
  NUVIRA_STAGING_SAFE_MODE: 'false',
  HUB_SYNC_SECRET: 'synthetic_internal_secret',
};

const clone = (value) => JSON.parse(JSON.stringify(value));

function baseOrder(overrides = {}) {
  return {
    id: 'order_synthetic_lee',
    order_number: 'NV-TEST-LEE',
    stripe_payment_intent_id: 'pi_synthetic_lee',
    stripe_charge_id: 'ch_synthetic_lee',
    customer_email: 'customer@example.test',
    customer_name: 'Synthetic Customer',
    status: 'scheduled_for_juicing',
    payment_status: 'paid',
    financial_status: 'paid',
    payment_captured: true,
    total: 47.99,
    items: [
      { name: 'The NuVira Trio', quantity: 1, price: 36 },
      { name: 'Radiance Shot', quantity: 1, price: 6 },
    ],
    status_history: [],
    ...clone(overrides),
  };
}

function chargeRefundedEvent({
  id = 'evt_synthetic_partial',
  amountRefunded = 1200,
  amount = 4799,
  refundId = 're_synthetic_oasis',
  operation = 'customer_order_adjustment_oasis_refund',
} = {}) {
  return {
    id,
    type: 'charge.refunded',
    data: {
      object: {
        id: 'ch_synthetic_lee',
        payment_intent: 'pi_synthetic_lee',
        amount_refunded: amountRefunded,
        amount,
        currency: 'usd',
        refunds: {
          data: [{
            id: refundId,
            amount: amountRefunded,
            status: 'succeeded',
            metadata: operation ? { operation } : {},
          }],
        },
      },
    },
  };
}

function refundUpdatedEvent({
  id = 'evt_synthetic_refund_updated',
  amount = 1200,
  refundId = 're_synthetic_oasis',
  operation = 'customer_order_adjustment_oasis_refund',
} = {}) {
  return {
    id,
    type: 'refund.updated',
    data: {
      object: {
        id: refundId,
        payment_intent: 'pi_synthetic_lee',
        amount,
        currency: 'usd',
        status: 'succeeded',
        metadata: operation ? { operation } : {},
      },
    },
  };
}

function makeEntityStore(name, rows, writes) {
  const match = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  return {
    async filter(filter = {}) {
      return rows.filter((row) => match(row, filter)).map(clone);
    },
    async list() {
      return rows.map(clone);
    },
    async get(id) {
      return clone(rows.find((row) => row.id === id) || null);
    },
    async create(payload) {
      const row = { id: payload.id || `${name.toLowerCase()}_${rows.length + 1}`, ...clone(payload) };
      rows.push(row);
      writes.push({ op: 'create', entity: name, id: row.id, payload: clone(payload) });
      return clone(row);
    },
    async update(id, patch) {
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) throw new Error(`missing ${name} ${id}`);
      rows[index] = { ...rows[index], ...clone(patch) };
      writes.push({ op: 'update', entity: name, id, patch: clone(patch) });
      return clone(rows[index]);
    },
    async delete(id) {
      throw new Error(`unexpected delete ${name} ${id}`);
    },
  };
}

function makeState(orderOverrides = {}) {
  const rows = {
    Order: [baseOrder(orderOverrides)],
    Subscription: [],
    OrderSyncLog: [],
    UserPoints: [],
  };
  const writes = [];
  const calls = [];
  const providerCalls = [];
  const entities = new Proxy({}, {
    get(_target, name) {
      if (!rows[name]) rows[name] = [];
      return makeEntityStore(String(name), rows[name], writes);
    },
  });
  const allowedFunctions = new Set(['syncRefundToHub', 'sendOrderReceivedNotification']);
  const base44 = {
    asServiceRole: {
      entities,
      functions: {
        async invoke(name, payload, options) {
          if (!allowedFunctions.has(name)) throw new Error(`unexpected function invocation: ${name}`);
          calls.push({ name, payload: clone(payload), options: options ? clone(options) : null });
          return name === 'syncRefundToHub' ? { success: true } : { success: true, mocked: true };
        },
      },
      integrations: { Core: {} },
    },
  };
  return { rows, writes, calls, providerCalls, base44 };
}

function loadHandler(state, env = BASE_ENV) {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  const capturedLogs = [];
  const safeConsole = {};
  for (const method of ['log', 'warn', 'error', 'info']) {
    safeConsole[method] = (...args) => capturedLogs.push({ method, args: clone(args.map((arg) => arg instanceof Error ? arg.message : arg)) });
  }
  const context = vm.createContext({
    console: safeConsole,
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
    Request,
    Headers,
    Promise,
    setTimeout,
    clearTimeout,
    createClientFromRequest: () => state.base44,
    Stripe: class Stripe {
      constructor() {
        this.webhooks = { constructEventAsync: async (body) => JSON.parse(body) };
        this.paymentIntents = {
          retrieve: async (id) => {
            state.providerCalls.push({ service: 'stripe.paymentIntents.retrieve', id });
            return { id, invoice: null };
          },
        };
        this.invoices = {
          retrieve: async (id) => {
            state.providerCalls.push({ service: 'stripe.invoices.retrieve', id });
            return { id, subscription: null };
          },
        };
      }
    },
    Deno: {
      env: { get: (key) => env[key] },
      serve: (handler) => { context.__handler = handler; },
    },
  });
  vm.runInContext(source, context, { filename: functionPath });
  assert.equal(typeof context.__handler, 'function');
  return { handler: context.__handler, source, capturedLogs };
}

async function invoke(state, event) {
  const harness = loadHandler(state);
  const req = {
    url: 'https://example.test/api/functions/stripeWebhook',
    headers: { get: (name) => name.toLowerCase() === 'stripe-signature' ? 'synthetic_valid_signature' : null },
    text: async () => JSON.stringify(event),
  };
  const response = await harness.handler(req);
  return { status: response.status, body: await response.json(), ...harness };
}

let assertions = 0;

// Approved OASIS adjustment: preserve the paid order lifecycle and record provider truth.
{
  const state = makeState();
  const first = await invoke(state, chargeRefundedEvent());
  assert.equal(first.status, 200);
  assert.equal(first.body.action, 'customer_adjustment_partial_refund_recorded');
  assert.equal(first.body.refund_amount, 12);
  const order = state.rows.Order[0];
  assert.equal(order.status, 'scheduled_for_juicing');
  assert.equal(order.payment_status, 'paid');
  assert.equal(order.financial_status, 'paid');
  assert.equal(order.payment_captured, true);
  assert.equal(order.refund_status, 'partially_refunded');
  assert.equal(order.refund_type, 'partial');
  assert.equal(order.refund_amount, 12);
  assert.equal(order.refund_review_required, false);
  assert.equal(order.refund_review_status, 'resolved');
  assert.equal(state.calls.length, 0);
  assert.equal(state.providerCalls.length, 1);
  assert.equal(state.providerCalls[0].service, 'stripe.paymentIntents.retrieve');
  assertions += 14;

  const writesAfterFirst = state.writes.length;
  const replay = await invoke(state, chargeRefundedEvent());
  assert.equal(replay.status, 200);
  assert.equal(replay.body.action, 'partial_refund_already_recorded');
  assert.equal(state.writes.length, writesAfterFirst);
  assert.equal(state.calls.length, 0);
  assert.equal(state.rows.Order[0].status, 'scheduled_for_juicing');
  assert.equal(state.rows.Order[0].payment_status, 'paid');
  assertions += 6;
}

// A generic partial Stripe refund also stays non-terminal but requires operator review.
{
  const state = makeState();
  const result = await invoke(state, chargeRefundedEvent({
    id: 'evt_synthetic_generic_partial',
    refundId: 're_synthetic_generic_partial',
    operation: null,
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.action, 'partial_refund_review_required');
  assert.equal(state.rows.Order[0].status, 'scheduled_for_juicing');
  assert.equal(state.rows.Order[0].payment_status, 'paid');
  assert.equal(state.rows.Order[0].refund_review_required, true);
  assert.equal(state.rows.Order[0].refund_review_status, 'pending');
  assert.equal(state.calls.length, 0);
  assertions += 7;
}

// refund.updated must not later repair a known partial refund into a full terminal refund.
{
  const state = makeState({
    refund_status: 'partially_refunded',
    refund_type: 'partial',
    refund_amount: 12,
    is_partial_refund: true,
  });
  const result = await invoke(state, refundUpdatedEvent());
  assert.equal(result.status, 200);
  assert.equal(result.body.action, 'partial_refund_status_recorded');
  assert.equal(state.rows.Order[0].status, 'scheduled_for_juicing');
  assert.equal(state.rows.Order[0].payment_status, 'paid');
  assert.equal(state.rows.Order[0].financial_status, 'paid');
  assert.equal(state.rows.Order[0].refund_status, 'partially_refunded');
  assert.equal(state.calls.length, 0);
  assert.equal(state.providerCalls.length, 0);
  assertions += 8;
}

// Existing full-refund behavior remains terminal and invokes only its approved mocked helpers.
{
  const state = makeState();
  const result = await invoke(state, chargeRefundedEvent({
    id: 'evt_synthetic_full_refund',
    amountRefunded: 4799,
    amount: 4799,
    refundId: 're_synthetic_full_refund',
    operation: null,
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.action, 'full_refund_processed');
  assert.equal(state.rows.Order[0].status, 'refunded');
  assert.equal(state.rows.Order[0].payment_status, 'refunded');
  assert.equal(state.rows.Order[0].financial_status, 'refunded');
  assert.equal(state.rows.Order[0].payment_captured, false);
  assert.deepEqual(state.calls.map((call) => call.name), ['syncRefundToHub', 'sendOrderReceivedNotification']);
  assert.equal(state.providerCalls.length, 1);
  assertions += 8;
}

const source = fs.readFileSync(functionPath, 'utf8');
assert.match(source, /if \(!isFullRefund\)/);
assert.match(source, /customer_order_adjustment_oasis_refund/);
assert.match(source, /partial_refund_already_recorded/);
assert.match(source, /partial_refund_status_recorded/);
assert.doesNotMatch(
  source.slice(source.indexOf('if (!isFullRefund)'), source.indexOf('// Determine refund type and action')),
  /syncRefundToHub|sendOrderReceivedNotification/,
);
assertions += 5;

console.log(`customer order adjustment Stripe refund tests: ${assertions} assertions passed`);
console.log('external network requests: 0 (all Stripe and Base44 boundaries mocked)');
