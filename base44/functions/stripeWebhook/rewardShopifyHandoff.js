import { readCurrentRewardHandoffOrder } from './rewardCustomerHandoff.js';
import { nativeItemSnapshot } from '../syncOrderToHub/nativeItemSnapshot.js';
import { verifiedNoPaymentPointsSnapshot, verifiedNoPaymentTierPointsSnapshot } from '../../shared/noPaymentPoints.js';
import { verifiedNoPaymentCreditSnapshot } from '../../shared/noPaymentCredit.js';
import { noPaymentBirthdayMetadata } from '../../shared/noPaymentBirthday.js';

export const REWARD_SHOPIFY_REVISION = '2026-09-08.reward-shopify-mirror-v1';
const check = (ok, code) => { if (!ok) throw new Error(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const moneyIsZero = money => money?.currencyCode === 'USD' && /^0(?:\.0+)?$/.test(String(money.amount));
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(value);
const attributes = values => Object.entries(values).map(([key, value]) => ({ key, value: String(value) }));
const orderFields = `id email sourceIdentifier tags cancelledAt test displayFinancialStatus displayFulfillmentStatus
  currencyCode totalPriceSet { shopMoney { amount currencyCode } }
  totalTaxSet { shopMoney { amount currencyCode } } totalShippingPriceSet { shopMoney { amount currencyCode } }
  customAttributes { key value }
  shippingAddress { address1 address2 city provinceCode zip countryCodeV2 }
  lineItems(first: 51) { pageInfo { hasNextPage } nodes { title quantity requiresShipping
    originalUnitPriceSet { shopMoney { amount currencyCode } }
    variant { id } customAttributes { key value } } }`;
const searchQuery = `query RewardMirror($query: String!) { orders(first: 2, query: $query) {
  pageInfo { hasNextPage } nodes { ${orderFields} } } }`;
const readQuery = `query RewardMirrorById($id: ID!) { order(id: $id) { ${orderFields} } }`;
const createMutation = `mutation RewardMirrorCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) { userErrors { field message } order { id } } }`;

// This covers the settled zero-merchandise/zero-fee reward contract, not
// unreserved credits. Only the signed reward-checkout runtime composes it.
// A durable runner dispatch claim is required. A lost response is reconciled
// through provider reads; an unknown outcome never triggers a second creation.
export function createRewardShopifyHandoffAdapter({ base44, fetchShopify, shopifyStoreUrl, shopifyApiToken }) {
  const entities = base44.asServiceRole.entities;
  async function current(snapshot, key, claim = false) {
    const order = await readCurrentRewardHandoffOrder(entities, snapshot, 'shopify_mirror', key, claim);
    check(opaque(order.id) && ['assigned_production_day', 'address_line1', 'address_line2', 'address_city',
      'address_state', 'address_postal_code'].every(field => same(order[field], snapshot[field])), 'reward_shopify_order_changed');
    check(order.reward_handoff?.steps?.native_operations?.state === 'complete', 'reward_shopify_native_handoff_required');
    const contexts = await entities.CheckoutSession.filter({ stripe_session_id: order.stripe_checkout_session_id }, undefined, 2);
    const context = contexts?.length === 1 ? contexts[0] : null;
    const data = context?.checkout_data;
    check(data && context.customer_email === order.customer_email && context.order_number === order.order_number
      && data.checkout_context_hash === order.reward_settlement.context_hash
      && data.reward_reservation_id === order.reward_settlement.reservation_id
      && data.total === 0 && same(data.items, order.items), 'reward_shopify_checkout_context_mismatch');
    const directOnly = /^points:[a-f0-9]{64}$/.test(order.reward_settlement.reservation_id);
    const creditCovered = order.reward_settlement.revision === '2026-09-09.credit-settlement-v2';
    const mixedPoints = !directOnly && data.points_used > 0;
    if (directOnly || mixedPoints || creditCovered) {
      // The signed-settlement receipt binds the consumed points to this private
      // snapshot. Retain original item values in attributes; the provider mirror
      // records net-zero lines, never a fabricated card transaction or sale.
      const verify = creditCovered ? verifiedNoPaymentCreditSnapshot : directOnly ? verifiedNoPaymentPointsSnapshot : verifiedNoPaymentTierPointsSnapshot;
      const redeemed = verify(data, { checkout_version: '4.0_reward_no_payment', checkout_mode: 'account',
        customer_email: order.customer_email, order_number: order.order_number,
        checkout_context_hash: order.reward_settlement.context_hash,
        reward_reservation_id: order.reward_settlement.reservation_id,
        ...(data.birthday_reservation_id ? { birthday_reservation_id: data.birthday_reservation_id,
          no_payment_birthday: noPaymentBirthdayMetadata(data) } : {}),
        ...(directOnly ? { no_payment_points: String(data.points_used) } : {}),
        ...(creditCovered ? { credit_reservation_id: order.reward_settlement.credit_reservation_id,
          credit_reservation_cents: String(order.reward_settlement.credit_redeemed_cents) } : {}) });
      check((creditCovered ? redeemed.points : redeemed) === order.reward_settlement.points_redeemed
        && (!creditCovered || redeemed.credit_cents === order.reward_settlement.credit_redeemed_cents)
        && order.subtotal === data.subtotal && order.total_discounts === data.total_discounts,
        'reward_shopify_checkout_context_mismatch');
    }
    check(['delivery_fee', 'tax', 'tax_amount', 'promotion_discount_amount',
      ...(!creditCovered ? ['credits_discount'] : []), ...(!directOnly && !mixedPoints && !creditCovered ? ['points_discount'] : [])]
      .every(field => Number(data[field] || 0) === 0 && Number(order[field] || 0) === 0), 'reward_shopify_nonzero_adjustment_unhandled');
    check(Array.isArray(order.items) && order.items.length > 0 && order.items.length <= 50
      && (directOnly || mixedPoints || creditCovered || order.items.every(item => item.price === 0)), 'reward_shopify_net_zero_lines_required');
    for (const item of order.items) nativeItemSnapshot(item, true);
    check(['address_line1', 'address_city', 'address_state', 'address_postal_code', 'assigned_delivery_date',
      'delivery_window_label'].every(field => typeof order[field] === 'string' && order[field].trim()),
    'reward_shopify_delivery_details_required');
    return order;
  }
  function endpoint() {
    check(typeof fetchShopify === 'function' && typeof shopifyApiToken === 'string' && shopifyApiToken,
      'reward_shopify_credentials_unavailable');
    const host = String(shopifyStoreUrl || '').replace(/^https:\/\//, '').replace(/\/$/, '');
    check(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host), 'reward_shopify_host_invalid');
    return `https://${host}/admin/api/2026-07/graphql.json`;
  }
  async function graphql(query, variables) {
    const response = await fetchShopify(endpoint(), { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Shopify-Access-Token': shopifyApiToken,
    }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30000), redirect: 'error' });
    check(response.ok, 'reward_shopify_http_unconfirmed');
    const body = await response.json();
    check(body && !body.errors?.length && body.data, 'reward_shopify_graphql_unconfirmed');
    return body.data;
  }
  const tag = order => `nuvira-reward-${order.id}`;
  const orderAttributes = order => ({ nuvira_mirror_revision: REWARD_SHOPIFY_REVISION,
    base44_order_id: order.id, nuvira_order_number: order.order_number,
    nuvira_checkout_session: order.stripe_checkout_session_id,
    nuvira_checkout_context: order.reward_settlement.context_hash,
    nuvira_reward_reservation: order.reward_settlement.reservation_id,
    nuvira_production_date: order.assigned_production_day,
    nuvira_delivery_date: order.assigned_delivery_date, nuvira_delivery_window: order.delivery_window_label,
    nuvira_payment_method: 'earned_reward_no_payment_required' });
  const lineAttributes = (item, index) => ({ nuvira_line_index: String(index),
    nuvira_product_id: item.product_id, nuvira_title: item.title, nuvira_size: item.size,
    nuvira_checkout_item: JSON.stringify({ ...nativeItemSnapshot(item, true), title: item.title,
      quantity: item.quantity, price: item.price }) });
  function verifyAttributes(actual, expected) {
    check(Array.isArray(actual) && actual.length === Object.keys(expected).length
      && new Set(actual.map(row => row.key)).size === actual.length
      && actual.every(row => expected[row.key] !== undefined && row.value === String(expected[row.key])),
    'reward_shopify_attributes_mismatch');
  }
  function proof(order, remote, initial = false) {
    if (!remote) return null;
    check(/^gid:\/\/shopify\/Order\/[0-9]+$/.test(remote.id || '') && remote.email === order.customer_email
      && remote.sourceIdentifier === order.id && remote.test === false && !remote.cancelledAt
      && remote.displayFinancialStatus === 'PAID' && remote.currencyCode === 'USD'
      && Array.isArray(remote.tags) && remote.tags.includes('base44-app') && remote.tags.includes(tag(order)),
    'reward_shopify_identity_or_status_mismatch');
    if (initial) check(remote.displayFulfillmentStatus === 'UNFULFILLED', 'reward_shopify_unexpected_fulfillment');
    check([remote.totalPriceSet, remote.totalTaxSet, remote.totalShippingPriceSet]
      .every(value => moneyIsZero(value?.shopMoney)), 'reward_shopify_total_mismatch');
    verifyAttributes(remote.customAttributes, orderAttributes(order));
    const address = remote.shippingAddress;
    check(address?.address1 === order.address_line1 && (address.address2 || '') === (order.address_line2 || '')
      && address.city === order.address_city && address.provinceCode === order.address_state
      && address.zip === order.address_postal_code && address.countryCodeV2 === 'US', 'reward_shopify_address_mismatch');
    const connection = remote.lineItems;
    check(connection?.pageInfo?.hasNextPage === false && Array.isArray(connection.nodes)
      && connection.nodes.length === order.items.length, 'reward_shopify_line_read_incomplete');
    const seen = new Set();
    for (const line of connection.nodes) {
      const index = line.customAttributes?.find(row => row.key === 'nuvira_line_index')?.value;
      check(/^(0|[1-9][0-9]?)$/.test(index || '') && !seen.has(index), 'reward_shopify_line_identity_invalid');
      seen.add(index); const item = order.items[Number(index)]; check(item, 'reward_shopify_extra_line');
      verifyAttributes(line.customAttributes, lineAttributes(item, Number(index)));
      check(line.title === item.title && line.quantity === item.quantity && line.requiresShipping === true
        && moneyIsZero(line.originalUnitPriceSet?.shopMoney), 'reward_shopify_line_amount_mismatch');
      const variant = item.shopify_variant_id;
      check(variant ? String(variant).match(/^[0-9]+$/) && line.variant?.id === `gid://shopify/ProductVariant/${variant}`
        : !line.variant, 'reward_shopify_variant_mismatch');
    }
    return { outcome: 'completed', evidence_id: `shopify_order:${remote.id.split('/').at(-1)}` };
  }
  async function search(order) {
    const data = await graphql(searchQuery, { query: `tag:${tag(order)}` });
    const result = data.orders;
    check(result?.pageInfo?.hasNextPage === false && Array.isArray(result.nodes) && result.nodes.length <= 1,
      'reward_shopify_mirror_not_unique');
    return result.nodes[0] || null;
  }
  return { shopify_mirror: {
    preflight: async ({ order: snapshot, idempotencyKey }) => {
      await current(snapshot, idempotencyKey); endpoint();
    },
    reconcile: async ({ order: snapshot, idempotencyKey }) => {
      const order = await current(snapshot, idempotencyKey);
      const result = proof(order, await search(order));
      await current(snapshot, idempotencyKey); return result;
    },
    perform: async ({ order: snapshot, idempotencyKey }) => {
      const order = await current(snapshot, idempotencyKey, true);
      const existing = proof(order, await search(order));
      if (existing) { await current(snapshot, idempotencyKey, true); return existing; }
      check(order.status === 'scheduled_for_juicing', 'reward_shopify_lifecycle_advanced');
      const lineItems = order.items.map((item, index) => {
        if (item.shopify_variant_id) check(/^[0-9]+$/.test(String(item.shopify_variant_id)), 'reward_shopify_variant_invalid');
        const properties = Object.entries(lineAttributes(item, index)).map(([name, value]) => ({ name, value }));
        check(properties.every(row => row.value.length <= 4000), 'reward_shopify_line_metadata_too_large');
        return { title: item.title, quantity: item.quantity, requiresShipping: true,
          priceSet: { shopMoney: { amount: '0.00', currencyCode: 'USD' } }, properties,
          ...(item.shopify_variant_id ? { variantId: `gid://shopify/ProductVariant/${item.shopify_variant_id}` } : {}) };
      });
      await current(snapshot, idempotencyKey, true);
      const result = await graphql(createMutation, { order: {
        email: order.customer_email, currency: 'USD', sourceIdentifier: order.id,
        tags: ['base44-app', tag(order)], note: `Base44 Order #${order.order_number}; earned reward, no payment required.`,
        customAttributes: attributes(orderAttributes(order)), financialStatus: 'PAID',
        lineItems, shippingAddress: { address1: order.address_line1, address2: order.address_line2 || '',
          city: order.address_city, provinceCode: order.address_state, zip: order.address_postal_code, countryCode: 'US' },
        // No transaction, customer upsert, marketing consent, discount replay,
        // fulfillment or shipping fee is fabricated for this zero-cash mirror.
      }, options: { inventoryBehaviour: 'BYPASS', sendReceipt: false, sendFulfillmentReceipt: false } });
      check(result.orderCreate && Array.isArray(result.orderCreate.userErrors)
        && result.orderCreate.userErrors.length === 0
        && /^gid:\/\/shopify\/Order\/[0-9]+$/.test(result.orderCreate.order?.id || ''), 'reward_shopify_creation_unconfirmed');
      await current(snapshot, idempotencyKey, true);
      const remoteId = result.orderCreate.order.id;
      const readback = await graphql(readQuery, { id: remoteId });
      check(readback.order?.id === remoteId, 'reward_shopify_readback_missing');
      const receipt = proof(order, readback.order, true);
      const unique = await search(order);
      check(unique?.id === remoteId, 'reward_shopify_search_not_settled');
      proof(order, unique, true);
      await current(snapshot, idempotencyKey, true); return receipt;
    },
  } };
}
