import { readCurrentRewardHandoffOrder } from './rewardCustomerHandoff.js';
import { nativeItemSnapshot } from '../syncOrderToHub/nativeItemSnapshot.js';
import { REWARD_NATIVE_REVISION, readRewardNativeOrder } from '../syncOrderToHub/rewardNativeGuard.js';

const check = (value, code) => { if (!value) throw new Error(code); };
const keyOf = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const id = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(value);
const itemProof = item => ({ ...nativeItemSnapshot(item, true), title: item.title, quantity: item.quantity, price: item.price });
const sameItems = (left, right) => Array.isArray(left) && left.length === right.length
  && JSON.stringify(left.map(itemProof)) === JSON.stringify(right.map(itemProof));

// Joined only by the signed reward-checkout runtime, after settlement proof.
export function createRewardNativeHandoffAdapter({ base44, internalSecret }) {
  const entities = base44.asServiceRole.entities;
  const current = async (snapshot, key, claim = false) => {
    const order = await readCurrentRewardHandoffOrder(entities, snapshot, 'native_operations', key, claim);
    check(['assigned_production_day', 'address_line1', 'address_line2', 'address_city', 'address_state', 'address_postal_code']
      .every(field => JSON.stringify(order[field]) === JSON.stringify(snapshot[field])), 'reward_native_address_or_schedule_changed');
    return order;
  };
  const claimFor = (order, key) => ({ revision: REWARD_NATIVE_REVISION, idempotency_key: key,
    checkout_session_id: order.stripe_checkout_session_id, context_hash: order.reward_settlement.context_hash,
    attempt_id: order.reward_handoff?.steps?.native_operations?.attempt_id });
  async function uniqueAcross(entity, filters, code) {
    const found = new Map();
    for (const filter of filters) {
      const rows = await entity.filter(filter, undefined, 3);
      check(Array.isArray(rows) && rows.length < 3, `${code}_read_incomplete`);
      for (const row of rows) { check(id(row.id), `${code}_id_invalid`); found.set(row.id, row); }
    }
    check(found.size <= 1, `${code}_not_unique`);
    return [...found.values()][0] || null;
  }
  async function proof(order) {
    check(Array.isArray(order.items) && order.items.length > 0 && order.items.length <= 50,
      'reward_native_items_invalid');
    const mirror = await uniqueAcross(entities.ShopifyOrder, [{ base44_order_id: order.id },
      { shopify_order_number: order.order_number }, { shopify_order_id: `customer_app:${order.id}` }], 'reward_native_mirror');
    const task = await uniqueAcross(entities.FulfillmentTask, [{ base44_order_id: order.id },
      { order_number: order.order_number }, { shopify_order_number: order.order_number },
      ...(mirror ? [{ order_id: mirror.id }] : [])], 'reward_native_task');
    // Read by date including archived/conflicting rows: an incomplete page is
    // never interpreted as absence. This step neither deducts stock nor logs QC.
    const batches = await entities.ProductionBatch.filter({ production_date: order.assigned_production_day }, undefined, 501);
    check(Array.isArray(batches) && batches.length < 501, 'reward_native_batch_read_incomplete');
    const expected = new Map();
    for (const item of order.items) {
      itemProof(item);
      const parts = item.category === 'bundle' ? item.bundle_composition : null;
      if (item.category === 'bundle') check(Array.isArray(parts) && parts.length > 0
        && parts.reduce((sum, part) => sum + part.quantity, 0) === item.bottles_per_unit,
      'reward_native_bundle_snapshot_incomplete');
      const rows = parts || (['juice', 'shot'].includes(item.category)
        ? [{ product_name: item.title, quantity: 1 }] : []);
      for (const part of rows) {
        const key = `${keyOf(part.product_name)}:${keyOf(item.title)}`;
        expected.set(key, (expected.get(key) || 0) + item.quantity * part.quantity);
      }
    }
    check(expected.size > 0, 'reward_native_production_demand_missing');
    const actual = new Map(); const batchIds = new Set();
    for (const batch of batches) {
      const sources = Array.isArray(batch.order_sources) ? batch.order_sources : [];
      const matched = sources.filter(source => source.order_number === order.order_number
        || source.order_id === order.id || source.customer_app_order_id === order.id
        || (mirror && source.order_id === mirror.id));
      if (!matched.length) continue;
      check(id(batch.id) && !batchIds.has(batch.id) && batch.is_test_batch !== true
        && ['customer_app_native', 'customer_app_native_mixed_demand'].includes(batch.source_system)
        && ['native_owned_order_demand', 'native_owned_mixed_demand'].includes(batch.native_owner_status)
        && !['archived', 'cancelled', 'canceled'].includes(batch.status), 'reward_native_batch_invalid');
      batchIds.add(batch.id);
      check(Number.isSafeInteger(batch.planned_units) && batch.planned_units > 0
        && sources.every(source => Number.isSafeInteger(source.quantity) && source.quantity > 0)
        && sources.reduce((sum, source) => sum + source.quantity, 0) === batch.planned_units,
      'reward_native_batch_source_totals_mismatch');
      for (const source of matched) {
        check(source.order_number === order.order_number && source.customer_email === order.customer_email
          && [order.id, mirror?.id].includes(source.order_id)
          && ['direct', 'bundle'].includes(source.source_type), 'reward_native_batch_source_mismatch');
        const key = `${keyOf(batch.product_name)}:${keyOf(source.source_item)}`;
        actual.set(key, (actual.get(key) || 0) + source.quantity);
      }
    }
    if (!mirror && !task && actual.size === 0) return null;
    // A partial prior dispatch cannot be replayed as a fresh order creation.
    check(mirror && task && actual.size === expected.size
      && [...expected].every(([key, quantity]) => actual.get(key) === quantity), 'reward_native_projection_partial');
    const commonFields = { customer_email: order.customer_email, customer_name: order.customer_name,
      assigned_delivery_date: order.assigned_delivery_date, production_date: order.assigned_production_day,
      address_line1: order.address_line1, address_city: order.address_city, address_state: order.address_state,
      address_postal_code: order.address_postal_code, delivery_window_label: order.delivery_window_label };
    check(Object.entries(commonFields).every(([key, value]) => mirror[key] === value && task[key] === value)
      && (mirror.address_line2 || '') === (order.address_line2 || '') && (task.address_line2 || '') === (order.address_line2 || ''),
    'reward_native_contact_or_schedule_mismatch');
    check(mirror.base44_order_id === order.id && mirror.shopify_order_number === order.order_number
      && mirror.stripe_checkout_session_id === order.stripe_checkout_session_id
      && mirror.total_price === 0 && mirror.payment_status === 'paid' && mirror.fulfillment_method === 'delivery'
      && mirror.source_type === 'customer_app_one_time' && sameItems(mirror.line_items, order.items),
    'reward_native_mirror_mismatch');
    check(task.base44_order_id === order.id && task.order_id === mirror.id && task.native_shopify_order_id === mirror.id
      && task.shopify_order_id === mirror.id && task.order_number === order.order_number
      && task.shopify_order_number === order.order_number && task.fulfillment_number === 1
      && task.fulfillment_type === 'delivery' && task.total_price === 0 && task.payment_status === 'paid'
      && task.delivery_date === order.assigned_delivery_date && task.scheduled_date === order.assigned_delivery_date
      && task.task_source === 'syncOrderToHub' && task.created_from_native_ops === true
      && task.address === order.delivery_address && sameItems(task.items, order.items), 'reward_native_task_mismatch');
    return { outcome: 'completed', evidence_id: `native_order:${mirror.id}:task:${task.id}` };
  }
  return { native_operations: {
    preflight: async ({ order: snapshot, idempotencyKey }) => {
      await current(snapshot, idempotencyKey);
      check(typeof internalSecret === 'string' && internalSecret && typeof base44.asServiceRole.functions.fetch === 'function',
        'reward_native_transport_unavailable');
    },
    reconcile: async ({ order: snapshot, idempotencyKey }) => {
      const order = await current(snapshot, idempotencyKey);
      const result = await proof(order);
      await current(snapshot, idempotencyKey);
      return result;
    },
    perform: async ({ order: snapshot, idempotencyKey }) => {
      const order = await current(snapshot, idempotencyKey, true);
      const body = { order_id: order.id, data: order, native_only: true, native_source: 'customer_app_one_time',
        event_type: 'order.created', idempotency_key: idempotencyKey, request_id: idempotencyKey,
        reward_native_handoff: claimFor(order, idempotencyKey) };
      await readRewardNativeOrder(entities, body);
      const previous = await proof(order);
      if (previous) { await current(snapshot, idempotencyKey, true); return previous; }
      check(typeof internalSecret === 'string' && internalSecret && typeof base44.asServiceRole.functions.fetch === 'function',
        'reward_native_transport_unavailable');
      await current(snapshot, idempotencyKey, true);
      const response = await base44.asServiceRole.functions.fetch('/syncOrderToHub', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': internalSecret },
        body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
      });
      check(response.ok, 'reward_native_runtime_unconfirmed');
      const data = await response.json();
      check(data?.success === true && data.native_only === true && data.hub_sync_skipped === true
        && data.production_batch_materialization?.success === true
        && data.production_batch_materialization.skipped === false, 'reward_native_runtime_incomplete');
      await current(snapshot, idempotencyKey, true);
      const result = await proof(order);
      check(result, 'reward_native_persisted_projection_missing');
      await current(snapshot, idempotencyKey, true);
      return result;
    },
  } };
}
