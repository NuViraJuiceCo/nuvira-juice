import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRewardShopifyHandoffAdapter } from '../../base44/functions/stripeWebhook/rewardShopifyHandoff.js';

// Provider and entities are simulated; no network, order, stock or notification writes.
globalThis.fetch = async () => { throw new Error('External network forbidden'); };
const copy = value => structuredClone(value);
const tests = []; const test = (name, fn) => tests.push([name, fn]);
const money = { shopMoney: { amount: '0.00', currencyCode: 'USD' } };
function fixture() {
  const order = { id: 'synthetic_reward', order_number: 'NV-SYNTHETIC-SHOPIFY', customer_email: 'synthetic@example.test',
    customer_name: 'Synthetic Tester', total: 0, subtotal: 0, payment_captured: false, payment_status: 'paid',
    financial_status: 'paid', status: 'scheduled_for_juicing', stripe_checkout_session_id: 'cs_live_SYNTHETIC',
    assigned_production_day: '2026-09-11', assigned_delivery_date: '2026-09-12', delivery_window_label: 'Saturday 12 PM – 3 PM',
    address_line1: '1 Synthetic Street', address_line2: '', address_city: 'Testville', address_state: 'MO', address_postal_code: '00000',
    items: ['OASIS', 'AURA', 'RE-NU'].map((title, index) => ({ product_id: `synthetic_product_${index}`,
      title, quantity: 2, price: 0, size: '12 oz', category: 'juice', shopify_variant_id: String(1000 + index),
      isFreeReward: true, reward_id: 'synthetic_vip', reward_type: 'vip_box', catalog_unit_price: 13,
      reward_discount_amount: 26, cart_line_key: `reward:synthetic_vip:synthetic_product_${index}` })),
    reward_settlement: { revision: '2026-09-08.reward-settlement-v1', checkout_session_id: 'cs_live_SYNTHETIC',
      context_hash: 'a'.repeat(64), reservation_id: 'synthetic_reservation', points_redeemed: 2000,
      provider_event_id: 'evt_SYNTHETIC', settled_at: '2026-09-08T08:00:00Z' },
    reward_handoff: { steps: { native_operations: { state: 'complete' },
      shopify_mirror: { state: 'dispatching', attempt_id: 'synthetic_attempt' } } } };
  const context = { customer_email: order.customer_email, order_number: order.order_number, checkout_data: {
    checkout_context_hash: 'a'.repeat(64), reward_reservation_id: 'synthetic_reservation', total: 0, items: copy(order.items) } };
  const state = { remote: [], queries: [], creates: [], faults: {}, reads: 0 };
  const entities = { Order: { filter: async () => {
    state.reads++; if (state.faults.orderRead) throw new Error('Synthetic read error'); return [copy(order)];
  } }, CheckoutSession: { filter: async () => [copy(context)] } };
  const config = { base44: { asServiceRole: { entities } }, shopifyStoreUrl: 'https://synthetic-only.myshopify.com/',
    shopifyApiToken: 'synthetic-not-a-token', fetchShopify: async (url, options) => {
      assert.equal(url, 'https://synthetic-only.myshopify.com/admin/api/2026-07/graphql.json');
      assert.equal(options.redirect, 'error'); assert.equal(options.method, 'POST');
      const { query, variables } = JSON.parse(options.body); state.queries.push(query);
      if (state.faults.http) return new Response('{}', { status: 500 });
      if (state.faults.graphql) return Response.json({ errors: [{ message: 'Synthetic denied' }] });
      if (query.startsWith('mutation')) {
        state.creates.push(variables);
        if (state.faults.userError) return Response.json({ data: { orderCreate: {
          order: null, userErrors: [{ field: ['lineItems'], message: 'Synthetic invalid' }] } } });
        const input = variables.order;
        assert.deepEqual(variables.options, { inventoryBehaviour: 'BYPASS', sendReceipt: false, sendFulfillmentReceipt: false });
        for (const forbidden of ['transactions', 'fulfillment', 'fulfillmentStatus', 'customer', 'customerId',
          'buyerAcceptsMarketing', 'discountCode', 'shippingLines']) assert.equal(input[forbidden], undefined, forbidden);
        const row = { id: `gid://shopify/Order/${9000 + state.remote.length}`, email: input.email,
          sourceIdentifier: input.sourceIdentifier, tags: input.tags, customAttributes: input.customAttributes,
          cancelledAt: null, test: false, currencyCode: 'USD', displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED',
          totalPriceSet: copy(money), totalTaxSet: copy(money), totalShippingPriceSet: copy(money),
          shippingAddress: { ...input.shippingAddress, countryCodeV2: input.shippingAddress.countryCode },
          lineItems: { pageInfo: { hasNextPage: false }, nodes: input.lineItems.map(item => ({ title: item.title,
            quantity: item.quantity, requiresShipping: item.requiresShipping, originalUnitPriceSet: copy(item.priceSet),
            variant: item.variantId ? { id: item.variantId } : null,
            customAttributes: item.properties.map(({ name, value }) => ({ key: name, value })) })) } };
        state.remote.push(row);
        if (state.faults.afterCreate) state.faults.afterCreate(row);
        if (state.faults.lostCreate) throw new Error('Synthetic lost provider response');
        return Response.json({ data: { orderCreate: { order: { id: row.id }, userErrors: [] } } });
      }
      if (query.includes('order(id:')) {
        if (state.faults.readback) return Response.json({ data: { order: null } });
        return Response.json({ data: { order: state.remote.find(row => row.id === variables.id) || null } });
      }
      assert.equal(variables.query, 'tag:nuvira-reward-synthetic_reward');
      if (state.faults.afterSearch) state.faults.afterSearch();
      return Response.json({ data: { orders: { nodes: state.remote, pageInfo: { hasNextPage: Boolean(state.faults.more) } } } });
    } };
  const adapter = () => createRewardShopifyHandoffAdapter(config).shopify_mirror;
  const input = () => ({ order: copy(order), idempotencyKey: `reward_handoff:${order.id}:shopify_mirror` });
  return { order, context, state, config, perform: () => adapter().perform(input()), reconcile: () => adapter().reconcile(input()) };
}
test('records six earned bottles once without cash, inventory or a second confirmation', async () => {
  const f = fixture(); const before = copy(f.order); const receipt = await f.perform();
  assert.equal(receipt.evidence_id, 'shopify_order:9000'); assert.deepEqual(f.order, before);
  assert.equal(f.state.creates.length, 1); assert.equal(f.state.remote[0].lineItems.nodes.reduce((sum, item) => sum + item.quantity, 0), 6);
  assert.equal((await f.perform()).outcome, 'completed'); assert.equal((await f.reconcile()).outcome, 'completed');
  assert.equal(f.state.creates.length, 1);
});
test('loss after provider creation recovers only by reading, not another mutation', async () => {
  const f = fixture(); f.state.faults.lostCreate = true; await assert.rejects(f.perform);
  assert.equal((await f.reconcile()).outcome, 'completed'); assert.equal(f.state.creates.length, 1);
});
test('a known custom product retains its real identity without inventing a Shopify variant', async () => {
  const f = fixture(); f.order.items.forEach(item => { delete item.shopify_variant_id; });
  f.context.checkout_data.items = copy(f.order.items); assert.equal((await f.perform()).outcome, 'completed');
});
test('fulfilled provider evidence can reconcile without resetting fulfillment', async () => {
  const f = fixture(); await f.perform(); f.order.status = 'delivered';
  f.state.remote[0].displayFulfillmentStatus = 'FULFILLED'; assert.equal((await f.reconcile()).outcome, 'completed');
  assert.equal(f.state.creates.length, 1);
});
for (const fault of ['http', 'graphql', 'more', 'orderRead']) test(`${fault} is not interpreted as an absent order`, async () => {
  const f = fixture(); f.state.faults[fault] = true; await assert.rejects(f.perform); assert.equal(f.state.creates.length, 0);
});
for (const fault of ['userError', 'readback']) test(`${fault} cannot report successful handoff`, async () => {
  const f = fixture(); f.state.faults[fault] = true; await assert.rejects(f.perform); assert.equal(f.state.creates.length, 1);
});
for (const [name, mutate] of Object.entries({
  wrong_email: row => { row.email = 'wrong@example.test'; }, wrong_origin: row => { row.sourceIdentifier = 'wrong'; },
  missing_mirror_tag: row => { row.tags = []; }, cancelled: row => { row.cancelledAt = '2026-09-08T09:00:00Z'; },
  test_order: row => { row.test = true; }, pending: row => { row.displayFinancialStatus = 'PENDING'; },
  charged: row => { row.totalPriceSet.shopMoney.amount = '1.00'; },
  extra_shipping: row => { row.totalShippingPriceSet.shopMoney.amount = '1.00'; },
  extra_tax: row => { row.totalTaxSet.shopMoney.amount = '1.00'; },
  wrong_context: row => { row.customAttributes.find(item => item.key === 'nuvira_checkout_context').value = 'wrong'; },
  wrong_address: row => { row.shippingAddress.address1 = 'Wrong'; },
  incomplete_items: row => { row.lineItems.pageInfo.hasNextPage = true; },
  extra_line: row => { row.lineItems.nodes.push(copy(row.lineItems.nodes[0])); },
  wrong_variant: row => { row.lineItems.nodes[0].variant.id = 'gid://shopify/ProductVariant/1'; },
  wrong_quantity: row => { row.lineItems.nodes[0].quantity = 10; },
  wrong_title: row => { row.lineItems.nodes[0].title = 'Wrong'; },
  wrong_price: row => { row.lineItems.nodes[0].originalUnitPriceSet.shopMoney.amount = '13'; },
  wrong_product: row => { row.lineItems.nodes[0].customAttributes.find(item => item.key === 'nuvira_product_id').value = 'wrong'; },
})) test(`${name} is rejected by independent provider readback`, async () => {
  const f = fixture(); await f.perform(); mutate(f.state.remote[0]); await assert.rejects(f.reconcile);
  assert.equal(f.state.creates.length, 1);
});
test('two matching provider orders do not become a successful unique mirror', async () => {
  const f = fixture(); await f.perform(); f.state.remote.push({ ...copy(f.state.remote[0]), id: 'gid://shopify/Order/9999' });
  await assert.rejects(f.reconcile);
});
for (const [name, mutate] of Object.entries({
  missing_claim: f => { delete f.order.reward_handoff.steps.shopify_mirror; },
  missing_native: f => { delete f.order.reward_handoff.steps.native_operations; },
  changed_context: f => { f.context.checkout_data.items[0].quantity = 8; },
  nonzero_fee: f => { f.order.delivery_fee = 5; },
  unreserved_credit: f => { f.context.checkout_data.credits_discount = 5; },
  missing_token: f => { f.config.shopifyApiToken = ''; },
  unknown_host: f => { f.config.shopifyStoreUrl = 'https://unrelated.example'; },
  malformed_variant: f => { f.order.items[0].shopify_variant_id = 'invalid'; f.context.checkout_data.items = copy(f.order.items); },
})) test(`${name} cannot create a provider order`, async () => {
  const f = fixture(); mutate(f); await assert.rejects(f.perform); assert.equal(f.state.creates.length, 0);
});
test('a cancellation between the absence lookup and create prevents provider mutation', async () => {
  const f = fixture(); f.state.faults.afterSearch = () => { f.order.status = 'cancelled'; };
  await assert.rejects(f.perform); assert.equal(f.state.creates.length, 0);
});
test('existing webhook mirror suppression is preserved and adapter remains unactivated', () => {
  const receiver = fs.readFileSync('base44/functions/shopifyWebhookReceiver/entry.ts', 'utf8');
  assert.match(receiver, /hasTag\(order, 'base44-app'\)/);
  assert.match(receiver, /topic\.startsWith\('orders\/'\) && isAppOriginatedShopifyMirror\(payload\)/);
  const webhook = fs.readFileSync('base44/functions/stripeWebhook/entry.ts', 'utf8');
  assert.match(webhook, /runHandoff: null/); assert.doesNotMatch(webhook, /createRewardShopifyHandoffAdapter/);
});
export { fixture as createShopifyFixture };
if (process.argv[1]?.endsWith('run-reward-shopify-handoff-tests.mjs')) {
  for (const [name, fn] of tests) { try { await fn(); } catch (error) { throw new Error(name, { cause: error }); } }
  console.log(`Reward Shopify handoff: ${tests.length}/${tests.length}; simulated provider and entities, no live writes.`);
}
