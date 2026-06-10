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
  STRIPE_SECRET_KEY: 'synthetic_stripe_secret_unused',
  STRIPE_WEBHOOK_SECRET: 'synthetic_webhook_secret_unused',
  ENABLE_STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW: 'true',
  STRIPE_REFUND_WEBHOOK_SHADOW_KILL_SWITCH: 'false',
  STRIPE_REFUND_WEBHOOK_SHADOW_ALLOWED_EVENT_TYPES: 'charge.refunded,refund.created,refund.updated,charge.refund.updated',
  STRIPE_REFUND_WEBHOOK_SHADOW_LOGGING_MODE: 'none',
  STRIPE_REFUND_WEBHOOK_SHADOW_ORDER_ALLOWLIST: '',
  STRIPE_REFUND_WEBHOOK_SHADOW_EVENT_ALLOWLIST: '',
  STRIPE_REFUND_WEBHOOK_SHADOW_SAMPLE_RATE: '0',
  STRIPE_REFUND_WEBHOOK_SHADOW_POLICY: 'READ_ONLY_NO_MUTATION_NO_PROVIDER_CALLS',
  NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview_secret_synthetic',
};

function event(type = 'charge.refunded', overrides = {}) {
  return {
    id: overrides.id || 'evt_g35n_shadow_allowed',
    type,
    data: {
      object: {
        id: type === 'charge.refunded' ? 'ch_g35n' : 're_g35n',
        payment_intent: 'pi_g35n',
        charge: 'ch_g35n',
        amount_refunded: 500,
        amount: 1000,
        currency: 'usd',
        metadata: {},
        ...overrides.object,
      },
    },
  };
}

function makeStore({ previewResponse, invokeError = null, invokeNeverResolves = false } = {}) {
  const store = {
    writes: [],
    providerCalls: [],
    previewCalls: [],
    orders: [{ id: 'order_g35n', order_number: 'NV-G35N', stripe_payment_intent_id: 'pi_g35n', stripe_charge_id: 'ch_g35n' }],
    nativeOrders: [{ id: 'native_g35n', base44_order_id: 'order_g35n', shopify_order_number: 'NV-G35N' }],
    tasks: [{ id: 'task_g35n', base44_order_id: 'order_g35n', native_shopify_order_id: 'native_g35n', order_number: 'NV-G35N' }],
  };
  const match = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const rowsFor = name => ({ Order: store.orders, ShopifyOrder: store.nativeOrders, FulfillmentTask: store.tasks }[name] || []);
  const api = name => ({
    filter: async filter => rowsFor(name).filter(row => match(row, filter)),
    get: async id => rowsFor(name).find(row => row.id === id) || null,
    create: async payload => { store.writes.push({ op: 'create', name, payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, patch) => { store.writes.push({ op: 'update', name, id, patch }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { store.writes.push({ op: 'delete', name, id }); throw new Error(`unexpected delete ${name}`); },
  });
  const base44 = {
    asServiceRole: {
      entities: {
        Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'),
        OrderSyncLog: api('OrderSyncLog'), OrderReviewQueue: api('OrderReviewQueue'), CommandLog: api('CommandLog'), Notification: api('Notification'), CustomerMessageDeliveryLog: api('CustomerMessageDeliveryLog'),
        Subscription: api('Subscription'), UserPoints: api('UserPoints'),
      },
      functions: {
        invoke: async (name, payload, options = {}) => {
          store.previewCalls.push({ name, payload, options });
          if (invokeNeverResolves) return new Promise(() => {});
          if (invokeError) throw invokeError;
          return { data: previewResponse || { preview_mode: 'STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW', next_action: 'shadow_preview_full_refund_manual_review_required', refund_impact_preview: { preview_mode: 'NATIVE_REFUND_IMPACT', preview_data_stable: true, read_consistency: { stable: true } } } };
        },
      },
    },
  };
  return { store, base44 };
}

function loadHarness({ env = BASE_ENV } = {}) {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { G35N_REFUND_WEBHOOK_SHADOW_MARKER, g35nGateState, g35nNormalizeStripeRefundEvent, g35nPreviewPayload, runStripeRefundWebhookShadowPreview };\n`;
  const context = vm.createContext({
    console,
    URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    setTimeout,
    createClientFromRequest: req => req.__base44,
    Stripe: class Stripe {
      constructor() {
        this.webhooks = { constructEventAsync: async body => JSON.parse(body) };
        this.paymentIntents = { retrieve: async id => { context.globalThis.__providerCalls.push({ service: 'stripe.paymentIntents.retrieve', id }); return { id, invoice: null }; } };
        this.invoices = { retrieve: async id => { context.globalThis.__providerCalls.push({ service: 'stripe.invoices.retrieve', id }); return { id, subscription: null }; } };
      }
    },
    Deno: {
      env: { get: key => (Object.prototype.hasOwnProperty.call(env, key) ? env[key] : undefined) },
      serve: handler => { context.globalThis.__handler = handler; },
    },
    globalThis: { __providerCalls: [] },
  });
  vm.runInContext(source, context, { filename: functionPath });
  return { exports: context.globalThis.__exports, handler: context.globalThis.__handler, providerCalls: context.globalThis.__providerCalls, source };
}

async function shadow({ env = BASE_ENV, eventObject = event(), storeOptions = {}, timeoutMs } = {}) {
  const harness = loadHarness({ env });
  const { store, base44 } = makeStore(storeOptions);
  const result = await harness.exports.runStripeRefundWebhookShadowPreview({ base44, event: eventObject, timeoutMs });
  return { ...harness, store, base44, result };
}

function withEnv(patch) {
  return { ...BASE_ENV, ...patch };
}

let h = loadHarness();
assert.equal(h.exports.G35N_REFUND_WEBHOOK_SHADOW_MARKER, 'g35n_default_off_stripe_refund_webhook_shadow');
assert.equal(h.exports.g35nNormalizeStripeRefundEvent(event()).refund_amount, 5);
assert.equal(h.exports.g35nNormalizeStripeRefundEvent(event()).amount_conversion, 'stripe_minor_units_to_decimal');
assert.equal(h.exports.g35nPreviewPayload(h.exports.g35nNormalizeStripeRefundEvent(event())).raw_payload_included, undefined);

let run = await shadow({ env: { ...BASE_ENV, ENABLE_STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW: 'false' } });
assert.equal(run.result.shadow_skipped, true);
assert.equal(run.result.skip_reason, 'stripe_refund_webhook_shadow_disabled');
assert.equal(run.store.previewCalls.length, 0);

run = await shadow({ env: { ...BASE_ENV, STRIPE_REFUND_WEBHOOK_SHADOW_KILL_SWITCH: 'true' } });
assert.equal(run.result.skip_reason, 'stripe_refund_webhook_shadow_kill_switch_active');
assert.equal(run.store.previewCalls.length, 0);

run = await shadow({ eventObject: event('payment_intent.succeeded') });
assert.equal(run.result.skip_reason, 'not_refund_shadow_event_type');
assert.equal(run.store.previewCalls.length, 0);

run = await shadow({ env: withEnv({ STRIPE_REFUND_WEBHOOK_SHADOW_ALLOWED_EVENT_TYPES: 'refund.created', STRIPE_REFUND_WEBHOOK_SHADOW_EVENT_ALLOWLIST: 'evt_g35n_shadow_allowed' }) });
assert.equal(run.result.skip_reason, 'refund_shadow_event_type_not_allowed');
assert.equal(run.store.previewCalls.length, 0);

run = await shadow({ env: withEnv({ STRIPE_REFUND_WEBHOOK_SHADOW_ORDER_ALLOWLIST: 'NV-OTHER' }) });
assert.equal(run.result.skip_reason, 'stripe_refund_webhook_shadow_exact_allowlist_required');
assert.equal(run.store.previewCalls.length, 0);

run = await shadow({ env: withEnv({ STRIPE_REFUND_WEBHOOK_SHADOW_EVENT_ALLOWLIST: '', STRIPE_REFUND_WEBHOOK_SHADOW_ORDER_ALLOWLIST: '', STRIPE_REFUND_WEBHOOK_SHADOW_SAMPLE_RATE: '0' }) });
assert.equal(run.result.skip_reason, 'stripe_refund_webhook_shadow_exact_allowlist_required');
assert.equal(run.store.previewCalls.length, 0);

run = await shadow({ env: withEnv({ STRIPE_REFUND_WEBHOOK_SHADOW_EVENT_ALLOWLIST: '', STRIPE_REFUND_WEBHOOK_SHADOW_ORDER_ALLOWLIST: '', STRIPE_REFUND_WEBHOOK_SHADOW_SAMPLE_RATE: '10' }) });
assert.equal(run.result.skip_reason, 'stripe_refund_webhook_shadow_broad_sampling_blocked');
assert.equal(run.store.previewCalls.length, 0);

run = await shadow({
  env: withEnv({ STRIPE_REFUND_WEBHOOK_SHADOW_EVENT_ALLOWLIST: 'evt_g35n_shadow_allowed' }),
  eventObject: event('charge.refunded', { object: { amount_refunded: 1000, amount: 1000 } }),
});
assert.equal(run.result.shadow_attempted, true);
assert.equal(run.result.routed_preview_mode, 'NATIVE_REFUND_IMPACT');
assert.equal(run.store.previewCalls[0].name, 'previewNativeOrderCutoverReadiness');
assert.equal(run.store.previewCalls[0].payload.preview_mode, 'STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW');
assert.equal(run.store.previewCalls[0].payload.refund_type, 'full');
assert.equal(run.store.previewCalls[0].payload.order_number, 'NV-G35N');
assert.equal(run.store.previewCalls[0].payload.raw_payload, undefined);
assert.equal(run.store.previewCalls[0].payload.webhook_signature, undefined);
assert.equal(run.store.previewCalls[0].payload.auth_headers, undefined);
assert.equal(run.store.writes.length, 0);
assert.equal(run.providerCalls.length, 0);

run = await shadow({
  env: withEnv({ STRIPE_REFUND_WEBHOOK_SHADOW_ORDER_ALLOWLIST: 'NV-G35N' }),
  eventObject: event('refund.created', { object: { id: 're_partial_g35n', amount: 500, currency: 'usd', metadata: { refund_type: 'partial' } } }),
  storeOptions: { previewResponse: { preview_mode: 'STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW', next_action: 'shadow_preview_partial_refund_review_required', refund_impact_preview: { preview_mode: 'NATIVE_PARTIAL_REFUND_REVIEW_IMPACT', preview_data_stable: true, read_consistency: { stable: true } } } },
});
assert.equal(run.result.routed_preview_mode, 'NATIVE_PARTIAL_REFUND_REVIEW_IMPACT');
assert.equal(run.store.previewCalls[0].payload.refund_type, 'partial');
assert.equal(run.store.previewCalls[0].payload.refund_amount, 5);
assert.equal(run.store.previewCalls[0].payload.refund_currency, 'USD');

run = await shadow({
  env: withEnv({ STRIPE_REFUND_WEBHOOK_SHADOW_EVENT_ALLOWLIST: 'evt_g35n_shadow_allowed' }),
  eventObject: event('refund.created', { object: { id: 're_missing_amount', amount: undefined, currency: 'usd', metadata: { refund_type: 'partial' } } }),
});
assert.equal(run.result.skip_reason, 'missing_refund_amount_for_partial_preview');
assert.equal(run.store.previewCalls.length, 0);

run = await shadow({
  env: withEnv({ STRIPE_REFUND_WEBHOOK_SHADOW_EVENT_ALLOWLIST: 'evt_g35n_shadow_allowed' }),
  eventObject: event('refund.updated', { object: { id: 're_unknown', amount: 500, payment_intent: 'pi_unknown', metadata: { refund_type: 'full' } } }),
  storeOptions: { previewResponse: { preview_mode: 'STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW', next_action: 'unknown_order_refund_review_required', refund_impact_preview: { preview_mode: 'NATIVE_REFUND_IMPACT' } } },
});
assert.equal(run.result.preview_next_action, 'unknown_order_refund_review_required');
assert.equal(run.store.writes.length, 0);

run = await shadow({
  env: withEnv({ STRIPE_REFUND_WEBHOOK_SHADOW_EVENT_ALLOWLIST: 'evt_g35n_shadow_allowed' }),
  storeOptions: { previewResponse: { preview_mode: 'STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW', next_action: 'duplicate_refund_event_detected', refund_impact_preview: { preview_mode: 'NATIVE_REFUND_IMPACT' } } },
});
assert.equal(run.result.preview_next_action, 'duplicate_refund_event_detected');

run = await shadow({
  env: withEnv({ STRIPE_REFUND_WEBHOOK_SHADOW_EVENT_ALLOWLIST: 'evt_g35n_shadow_allowed' }),
  storeOptions: { invokeError: new Error('synthetic preview failure') },
});
assert.equal(run.result.shadow_attempted, true);
assert.equal(run.result.preview_error_code, 'shadow_preview_error');
assert.equal(run.store.writes.length, 0);

run = await shadow({
  env: withEnv({ STRIPE_REFUND_WEBHOOK_SHADOW_EVENT_ALLOWLIST: 'evt_g35n_shadow_allowed' }),
  storeOptions: { invokeNeverResolves: true },
  timeoutMs: 1,
});
assert.equal(run.result.skip_reason, 'shadow_preview_timeout');
assert.equal(run.store.writes.length, 0);

run = await shadow({ env: withEnv({ STRIPE_REFUND_WEBHOOK_SHADOW_LOGGING_MODE: 'safe_redacted' }) });
assert.equal(run.result.skip_reason, 'stripe_refund_webhook_shadow_logging_mode_not_none');
assert.equal(run.store.previewCalls.length, 0);

// Handler boundary: gates disabled and a charge.refunded event with no payment_intent keeps the existing safe received:true behavior.
h = loadHarness({ env: { ...BASE_ENV, ENABLE_STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW: 'false' } });
let boundaryStore = makeStore();
const req = {
  method: 'POST',
  __base44: boundaryStore.base44,
  headers: { get: () => 'synthetic_signature_not_stored' },
  text: async () => JSON.stringify(event('charge.refunded', { object: { id: 'ch_no_pi', payment_intent: null, amount_refunded: 500, amount: 1000 } })),
};
const response = await h.handler(req);
const data = await response.json();
assert.equal(response.status, 200);
assert.deepEqual(data, { received: true });
assert.equal(boundaryStore.store.previewCalls.length, 0);
assert.equal(boundaryStore.store.writes.length, 0);
assert.equal(h.providerCalls.length, 0);

assert.ok(!/RefundWebhookShadowLog\.create/.test(h.source), 'G35N must not persist shadow logs');
assert.ok(!/OrderReviewQueue\.create\([^)]*shadow/i.test(h.source), 'G35N must not create review queue rows');
assert.ok(!/CommandLog\.create\([^)]*shadow/i.test(h.source), 'G35N must not create command logs');
assert.ok(!/raw_payload_included:\s*true/.test(h.source), 'G35N must not include raw payloads');

console.log(JSON.stringify({ success: true, test_count: 20, writes_performed: false, provider_call_impact: false, notifications_sent: false }, null, 2));
