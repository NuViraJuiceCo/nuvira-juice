import { isVerifiedNoPaymentOrder } from './rewardSettlement.js';

export const REWARD_CUSTOMER_HANDOFF_REVISION = '2026-09-08.reward-customer-handoff-v1';
const email = value => String(value || '').trim().toLowerCase();
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(value);
const requireProof = (condition, code) => { if (!condition) throw new Error(code); };
const completed = evidence => ({ outcome: 'completed', evidence_id: evidence });
const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 4000);
const escaped = value => clean(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

// These are two real adapters, not a complete handoff factory. The webhook must
// remain unactivated until every required stage has an independently tested
// adapter. Ordinary paid-order delivery behavior is intentionally untouched.
export function createRewardCustomerHandoffAdapters({ base44, fetchEmail, resendApiKey }) {
  const entities = base44.asServiceRole.entities;
  async function currentOrder(snapshot, stage, idempotencyKey, requireClaim = false) {
    requireProof(opaque(snapshot?.id) && idempotencyKey === `reward_handoff:${snapshot.id}:${stage}`,
      'reward_customer_handoff_identity_invalid');
    const rows = await entities.Order.filter({ id: snapshot.id }, undefined, 2);
    requireProof(Array.isArray(rows) && rows.length === 1, 'reward_customer_order_not_unique');
    const order = rows[0];
    requireProof(isVerifiedNoPaymentOrder(order) && isVerifiedNoPaymentOrder(snapshot)
      && order.stripe_checkout_session_id === snapshot.stripe_checkout_session_id
      && order.reward_settlement.context_hash === snapshot.reward_settlement.context_hash
      && email(order.customer_email) === email(snapshot.customer_email)
      && order.order_number === snapshot.order_number
      && ['items', 'customer_name', 'delivery_address', 'assigned_delivery_date',
        'delivery_window_label', 'bag_return_request_id'].every(key =>
        JSON.stringify(order[key]) === JSON.stringify(snapshot[key])), 'reward_customer_order_changed');
    if (requireClaim) {
      const claim = snapshot.reward_handoff?.steps?.[stage];
      const actual = order.reward_handoff?.steps?.[stage];
      requireProof(claim?.state === 'dispatching' && typeof claim.attempt_id === 'string'
        && actual?.state === 'dispatching' && actual.attempt_id === claim.attempt_id,
      'reward_customer_dispatch_claim_required');
    }
    return order;
  }

  async function bagProof(order) {
    if (!order.bag_return_request_id) return {
      outcome: 'skipped', reason: 'not_requested', evidence_id: `order:${order.id}:no_bag_return`,
    };
    requireProof(opaque(order.bag_return_request_id), 'reward_bag_id_invalid');
    const rows = await entities.BagReturn.filter({ id: order.bag_return_request_id }, undefined, 2);
    requireProof(Array.isArray(rows) && rows.length === 1 && rows[0]?.id === order.bag_return_request_id,
      'reward_bag_record_not_unique');
    const bag = rows[0];
    requireProof(email(bag.customer_email) === email(order.customer_email), 'reward_bag_owner_mismatch');
    if (bag.order_id === order.id) return completed(`bag_return:${bag.id}`);
    requireProof(bag.order_id === 'pending' && bag.verification_status === 'requested',
      'reward_bag_already_assigned_or_verified');
    return null;
  }
  const bag_return = {
    reconcile: async ({ order: snapshot, idempotencyKey }) => {
      const order = await currentOrder(snapshot, 'bag_return', idempotencyKey);
      const proof = await bagProof(order); // Read only: a pending record is not completion.
      await currentOrder(snapshot, 'bag_return', idempotencyKey);
      return proof;
    },
    perform: async ({ order: snapshot, idempotencyKey }) => {
      let order = await currentOrder(snapshot, 'bag_return', idempotencyKey, true);
      const existing = await bagProof(order);
      if (existing) {
        await currentOrder(snapshot, 'bag_return', idempotencyKey, true);
        return existing;
      }
      requireProof(typeof entities.BagReturn.updateMany === 'function', 'reward_bag_conditional_updates_required');
      order = await currentOrder(snapshot, 'bag_return', idempotencyKey, true);
      const bags = await entities.BagReturn.filter({ id: order.bag_return_request_id }, undefined, 2);
      requireProof(Array.isArray(bags) && bags.length === 1
        && email(bags[0].customer_email) === email(order.customer_email), 'reward_bag_record_changed');
      const bag = bags[0];
      const result = await entities.BagReturn.updateMany({ id: order.bag_return_request_id,
        customer_email: bag.customer_email, order_id: 'pending', verification_status: 'requested',
        ...(bag.updated_date ? { updated_date: bag.updated_date } : {}),
      }, { $set: { order_id: order.id } });
      requireProof(result?.success === true && result.has_more === false && [0, 1].includes(result.updated),
        'reward_bag_write_unconfirmed');
      await currentOrder(snapshot, 'bag_return', idempotencyKey, true);
      const proof = await bagProof(order);
      requireProof(proof?.outcome === 'completed', 'reward_bag_link_unconfirmed');
      await currentOrder(snapshot, 'bag_return', idempotencyKey, true);
      return proof;
    },
  };

  function emailPayload(order) {
    requireProof(opaque(order.order_number) && email(order.customer_email).includes('@')
      && typeof order.customer_name === 'string' && clean(order.customer_name).length > 0
      && order.customer_name.length <= 160
      && typeof order.delivery_address === 'string' && clean(order.delivery_address).length > 0
      && /^\d{4}-\d{2}-\d{2}$/.test(order.assigned_delivery_date || '')
      && Number.isFinite(Date.parse(`${order.assigned_delivery_date}T12:00:00Z`))
      && new Date(`${order.assigned_delivery_date}T12:00:00Z`).toISOString().slice(0, 10) === order.assigned_delivery_date
      && typeof order.delivery_window_label === 'string' && clean(order.delivery_window_label).length > 0
      && order.delivery_window_label.length <= 120,
    'reward_email_details_incomplete');
    requireProof(Array.isArray(order.items) && order.items.length > 0 && order.items.length <= 50
      && order.items.every(item => opaque(item?.product_id) && typeof item.title === 'string'
        && clean(item.title).length > 0 && item.title.length <= 160
        && Number.isSafeInteger(item.quantity) && item.quantity > 0
        && Number.isFinite(item.price) && item.price >= 0), 'reward_email_items_invalid');
    const payload = { order_id: order.id, customer_email: order.customer_email,
      customer_name: order.customer_name, order_number: order.order_number, items: order.items,
      total: order.total, delivery_address: order.delivery_address,
      assigned_delivery_date: order.assigned_delivery_date, delivery_window_label: order.delivery_window_label,
      guest_checkout: false };
    // Nullable non-displayed product metadata is legitimate; only screen/email
    // text is checked for placeholders, not JSON's literal null values.
    const displayedText = [order.customer_name, order.order_number, order.delivery_address,
      order.delivery_window_label, ...order.items.map(item => item.title)].join('\n');
    requireProof(!/\b(?:undefined|null|NaN)\b|\[object Object\]/i.test(displayedText),
      'reward_email_placeholder_detected');
    return payload;
  }
  async function emailRows(order) {
    // A failed read must not be treated as an empty log and trigger a resend.
    const rows = await entities.CustomerMessageDeliveryLog.filter({
      idempotency_key: `order_confirmation_email_${order.id}`,
    }, '-created_date', 20);
    requireProof(Array.isArray(rows) && rows.length < 20, 'reward_email_log_read_unconfirmed');
    return rows;
  }
  async function emailProof(order, rows) {
    const payload = emailPayload(order);
    if (rows.length === 0) return null;
    requireProof(rows.every(row => row.channel === 'email' && row.provider === 'resend'
      && row.message_type === 'order_confirmation' && row.order_id === order.id
      && row.order_number === order.order_number && email(row.customer_email) === email(order.customer_email)
      && ['sent', 'delivered'].includes(row.status)
      && /^[a-f0-9-]{36}$/i.test(row.provider_message_id || '')), 'reward_email_log_evidence_invalid');
    const ids = new Set(rows.map(row => row.provider_message_id));
    requireProof(ids.size === 1, 'reward_email_multiple_provider_messages');
    requireProof(typeof resendApiKey === 'string' && resendApiKey.length > 0
      && typeof fetchEmail === 'function', 'reward_email_readback_unavailable');
    const providerId = [...ids][0];
    // GET only. A lost send response is reconciled from a durable provider ID;
    // a 24-hour provider idempotency window is not a permanent retry guarantee.
    const response = await fetchEmail(`https://api.resend.com/emails/${providerId}`, {
      method: 'GET', headers: { Authorization: `Bearer ${resendApiKey}` }, signal: AbortSignal.timeout(10000),
    });
    requireProof(response.ok, 'reward_email_provider_read_failed');
    const message = await response.json();
    requireProof(message?.id === providerId && Array.isArray(message.to) && message.to.length === 1
      && email(message.to[0]) === email(order.customer_email)
      && Array.isArray(message.cc) && message.cc.length === 0
      && Array.isArray(message.bcc) && message.bcc.length === 0
      && ['sent', 'delivered', 'opened', 'clicked'].includes(message.last_event)
      && !message.scheduled_at && message.subject === `Your Order #${order.order_number} is Confirmed!`,
    'reward_email_provider_identity_or_status_mismatch');
    const html = message.html;
    requireProof(typeof html === 'string' && html.length > 0
      && !/\b(?:undefined|null|NaN)\b|\[object Object\]/i.test(html), 'reward_email_provider_content_invalid');
    const expectedDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago',
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    }).format(new Date(`${payload.assigned_delivery_date}T12:00:00Z`));
    const windowLabel = clean(payload.delivery_window_label).replace(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+/i, '');
    const tracking = `https://www.nuvirajuice.com/native-login?return_to=${encodeURIComponent(`/order-tracker/${encodeURIComponent(order.order_number)}`)}`;
    requireProof(html.includes(`Order #${escaped(order.order_number)}`)
      && html.includes(`${expectedDate}, ${windowLabel} Central Time`)
      && html.includes(escaped(payload.delivery_address)) && html.includes(escaped(tracking))
      && html.includes(`Hi ${escaped(clean(order.customer_name).split(/\s+/)[0])},`)
      && /Total:\s*\$0\.00\b/.test(html), 'reward_email_order_content_mismatch');
    const expectedRows = payload.items.map(item => `<tr><td style="padding: 8px;">${escaped(item.title)}</td><td style="padding: 8px;">x${item.quantity}</td><td style="padding: 8px;">$${(item.price * item.quantity).toFixed(2)}</td></tr>`).join('');
    const tables = [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)];
    requireProof(tables.length === 1 && tables[0][1].trim() === expectedRows, 'reward_email_item_content_mismatch');
    return completed(`resend:${providerId}`);
  }
  const confirmation_email = {
    reconcile: async ({ order: snapshot, idempotencyKey }) => {
      const order = await currentOrder(snapshot, 'confirmation_email', idempotencyKey);
      const proof = await emailProof(order, await emailRows(order));
      await currentOrder(snapshot, 'confirmation_email', idempotencyKey);
      return proof;
    },
    perform: async ({ order: snapshot, idempotencyKey }) => {
      let order = await currentOrder(snapshot, 'confirmation_email', idempotencyKey, true);
      const payload = emailPayload(order);
      requireProof(typeof resendApiKey === 'string' && resendApiKey.length > 0
        && typeof fetchEmail === 'function', 'reward_email_readback_unavailable');
      const existing = await emailProof(order, await emailRows(order));
      if (existing) {
        await currentOrder(snapshot, 'confirmation_email', idempotencyKey, true);
        return existing;
      }
      order = await currentOrder(snapshot, 'confirmation_email', idempotencyKey, true);
      // Existing audited template and existing canonical delivery key. Do not
      // call push, cash-point earning or any advertising Purchase path here.
      await base44.asServiceRole.functions.invoke('sendOrderReceivedNotification', payload);
      await currentOrder(snapshot, 'confirmation_email', idempotencyKey, true);
      const proof = await emailProof(order, await emailRows(order));
      requireProof(proof, 'reward_email_delivery_unconfirmed');
      await currentOrder(snapshot, 'confirmation_email', idempotencyKey, true);
      return proof;
    },
  };
  return { bag_return, confirmation_email };
}
