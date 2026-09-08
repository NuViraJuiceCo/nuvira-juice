import { nativeItemSnapshot } from './nativeItemSnapshot.js';

export const REWARD_NATIVE_REVISION = '2026-09-08.reward-native-handoff-v1';
const check = (value, code) => { if (!value) throw new Error(code); };
const day = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '')
  && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
  && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;

// The private handoff call may only project its fresh, persisted, settled Order.
// Never use a caller-supplied Order snapshot as the authority for reward writes.
export async function readRewardNativeOrder(entities, body) {
  const claim = body?.reward_native_handoff;
  const id = body?.order_id || body?.order?.id || body?.data?.id;
  check(typeof id === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(id)
    && claim?.revision === REWARD_NATIVE_REVISION
    && claim.idempotency_key === `reward_handoff:${id}:native_operations`
    && typeof claim.attempt_id === 'string' && claim.attempt_id.length > 0,
  'reward_native_claim_invalid');
  const rows = await entities.Order.filter({ id }, undefined, 2);
  check(Array.isArray(rows) && rows.length === 1, 'reward_native_order_not_unique');
  const order = rows[0]; const receipt = order.reward_settlement;
  check(order.total === 0 && order.payment_captured === false
    && order.payment_status === 'paid' && order.financial_status === 'paid'
    && order.status === 'scheduled_for_juicing' && !order.stripe_payment_intent_id
    && order.is_test_order !== true && order.is_abandoned_checkout !== true && order.do_not_recover !== true
    && !(Number(order.amount_refunded || 0) > 0)
    && receipt?.revision === '2026-09-08.reward-settlement-v1'
    && /^cs_[A-Za-z0-9_]+$/.test(order.stripe_checkout_session_id || '')
    && receipt.checkout_session_id === order.stripe_checkout_session_id
    && claim.checkout_session_id === order.stripe_checkout_session_id
    && /^[a-f0-9]{64}$/.test(receipt.context_hash || '')
    && claim.context_hash === receipt.context_hash && receipt.reservation_id
    && Number.isSafeInteger(receipt.points_redeemed) && receipt.points_redeemed > 0
    && /^evt_[A-Za-z0-9_]+$/.test(receipt.provider_event_id || '')
    && Number.isFinite(Date.parse(receipt.settled_at || '')), 'reward_native_order_unsettled');
  const progress = order.reward_handoff; const step = progress?.steps?.native_operations;
  check(progress?.revision === '2026-09-08.reward-handoff-v1'
    && progress.checkout_session_id === order.stripe_checkout_session_id
    && progress.context_hash === receipt.context_hash && step?.state === 'dispatching'
    && step.attempt_id === claim.attempt_id, 'reward_native_claim_not_current');
  check(typeof order.customer_email === 'string' && order.customer_email.trim()
    && typeof order.customer_name === 'string' && order.customer_name.trim()
    && typeof order.order_number === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(order.order_number)
    && day(order.assigned_production_day) && day(order.assigned_delivery_date)
    && order.assigned_production_day <= order.assigned_delivery_date
    && typeof order.delivery_window_label === 'string' && order.delivery_window_label.trim()
    && ['address_line1', 'address_city', 'address_state', 'address_postal_code', 'delivery_address']
      .every(key => typeof order[key] === 'string' && order[key].trim())
    && !['subscription', 'pos'].includes(order.order_type) && !order.stripe_subscription_id
    && (!order.fulfillment_method || order.fulfillment_method === 'delivery')
    && Array.isArray(order.items) && order.items.length > 0 && order.items.length <= 50,
  'reward_native_order_details_incomplete');
  order.items.forEach(item => nativeItemSnapshot(item, true));
  const contexts = await entities.CheckoutSession.filter({ stripe_session_id: order.stripe_checkout_session_id }, undefined, 2);
  const context = Array.isArray(contexts) && contexts.length === 1 ? contexts[0] : null;
  const data = context?.checkout_data;
  check(context?.customer_email === order.customer_email && context?.order_number === order.order_number
    && data?.checkout_context_hash === receipt.context_hash && data?.reward_reservation_id === receipt.reservation_id
    && data?.total === 0 && JSON.stringify(data?.items) === JSON.stringify(order.items),
  'reward_native_checkout_snapshot_changed');
  const supplied = body.order || body.data;
  if (supplied) check(supplied.id === order.id && JSON.stringify(supplied.items) === JSON.stringify(order.items)
    && supplied.order_number === order.order_number && supplied.customer_email === order.customer_email
    && supplied.assigned_delivery_date === order.assigned_delivery_date
    && supplied.assigned_production_day === order.assigned_production_day
    && ['address_line1', 'address_line2', 'address_city', 'address_state', 'address_postal_code',
      'delivery_address', 'delivery_window_label', 'customer_name', 'contact_phone']
      .every(key => JSON.stringify(supplied[key]) === JSON.stringify(order[key])),
  'reward_native_supplied_order_changed');
  return order;
}
