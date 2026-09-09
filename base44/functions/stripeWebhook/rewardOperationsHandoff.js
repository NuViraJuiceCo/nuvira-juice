import { readCurrentRewardHandoffOrder } from './rewardCustomerHandoff.js';

export const REWARD_OPERATIONS_HANDOFF_REVISION = '2026-09-08.reward-operations-handoff-v1';
const check = (value, code) => { if (!value) throw new Error(code); };
const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const escape = value => clean(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const recipient = 'operations@nuvirajuice.com';

// Composed with native operations and provider mirror evidence by the signed
// reward-checkout runtime; this module never activates itself.
export function createRewardOperationsHandoffAdapters({ base44, fetchEmail, resendApiKey }) {
  const entities = base44.asServiceRole.entities;
  const current = (snapshot, key, claim = false) =>
    readCurrentRewardHandoffOrder(entities, snapshot, 'operations_email', key, claim);
  function payload(order) {
    check(/^[A-Za-z0-9._:-]{1,120}$/.test(order.order_number)
      && typeof order.delivery_address === 'string' && clean(order.delivery_address)
      && /^\d{4}-\d{2}-\d{2}$/.test(order.assigned_delivery_date || '')
      && Number.isFinite(Date.parse(`${order.assigned_delivery_date}T12:00:00Z`))
      && new Date(`${order.assigned_delivery_date}T12:00:00Z`).toISOString().slice(0, 10) === order.assigned_delivery_date
      && typeof order.delivery_window_label === 'string' && clean(order.delivery_window_label)
      && Array.isArray(order.items) && order.items.length > 0 && order.items.length <= 50
      && order.items.every(item => typeof item.title === 'string' && clean(item.title)
        && item.title.length <= 160 && Number.isSafeInteger(item.quantity) && item.quantity > 0
        && Number.isFinite(item.price) && item.price >= 0), 'reward_operations_details_incomplete');
    check(!/\b(?:undefined|null|NaN)\b|\[object Object\]/i.test([order.order_number, order.customer_email,
      order.delivery_address, order.delivery_window_label, ...order.items.map(item => item.title)].join('\n')),
    'reward_operations_placeholder_detected');
    return { order_id: order.id, order_number: order.order_number, customer_email: order.customer_email,
      items: order.items, total: 0, delivery_address: order.delivery_address,
      reward_checkout_session_id: order.stripe_checkout_session_id, suppress_push: true };
  }
  async function proof(order) {
    payload(order);
    const rows = await entities.CustomerMessageDeliveryLog.filter({
      idempotency_key: `internal_order_processed_${order.id}`,
    }, '-created_date', 20);
    check(Array.isArray(rows) && rows.length < 20, 'reward_operations_email_log_incomplete');
    if (!rows.length) return null;
    check(rows.every(row => row.channel === 'email' && row.provider === 'resend'
      && row.message_type === 'transactional_order' && row.order_id === order.id
      && row.order_number === order.order_number && row.customer_email === recipient
      && row.metadata?.recipient_scope === 'internal_operations'
      && ['sent', 'delivered'].includes(row.status) && /^[a-f0-9-]{36}$/i.test(row.provider_message_id || '')),
    'reward_operations_email_log_invalid');
    const ids = new Set(rows.map(row => row.provider_message_id));
    check(ids.size === 1, 'reward_operations_email_duplicate_provider_messages');
    check(typeof fetchEmail === 'function' && typeof resendApiKey === 'string' && resendApiKey,
      'reward_operations_email_readback_unavailable');
    const providerId = [...ids][0];
    const response = await fetchEmail(`https://api.resend.com/emails/${providerId}`, {
      method: 'GET', headers: { Authorization: `Bearer ${resendApiKey}` }, signal: AbortSignal.timeout(10000),
    });
    check(response.ok, 'reward_operations_email_provider_read_failed');
    const message = await response.json();
    check(message?.id === providerId && Array.isArray(message.to) && message.to.length === 1
      && message.to[0] === recipient && Array.isArray(message.cc) && message.cc.length === 0
      && Array.isArray(message.bcc) && message.bcc.length === 0 && !message.scheduled_at
      && ['sent', 'delivered', 'opened', 'clicked'].includes(message.last_event)
      && message.subject === `Order #${order.order_number} Processed`, 'reward_operations_email_provider_mismatch');
    const html = message.html;
    check(typeof html === 'string' && !/\b(?:undefined|null|NaN)\b|\[object Object\]|Payment received|app\.base44\.com/i.test(html)
      && html.includes(`Order #${escape(order.order_number)} Processed`)
      && html.includes(escape(order.customer_email)) && html.includes(escape(order.delivery_address))
      && html.includes(`${escape(order.assigned_delivery_date)} · ${escape(order.delivery_window_label)} Central Time`)
      && html.includes('Reward redeemed — no payment required; scheduled for juicing')
      && html.includes(`https://nuvirajuice.com/admin/orders?order=${encodeURIComponent(order.order_number)}`)
      && /Total:\s*\$0\.00\b/.test(html), 'reward_operations_email_content_mismatch');
    const expected = order.items.map(item => `<tr><td style="padding: 8px;">${escape(item.title)}</td><td style="padding: 8px;">x${item.quantity}</td><td style="padding: 8px;">$${(item.price * item.quantity).toFixed(2)}</td></tr>`).join('');
    const tables = [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)];
    check(tables.length === 1 && tables[0][1].trim() === expected, 'reward_operations_email_items_mismatch');
    return { outcome: 'completed', evidence_id: `resend:${providerId}` };
  }
  const operations_email = {
    preflight: async ({ order: snapshot, idempotencyKey }) => {
      const order = await current(snapshot, idempotencyKey); payload(order);
      check(typeof fetchEmail === 'function' && typeof resendApiKey === 'string' && resendApiKey,
        'reward_operations_email_readback_unavailable');
    },
    reconcile: async ({ order: snapshot, idempotencyKey }) => {
      const order = await current(snapshot, idempotencyKey);
      const result = await proof(order);
      await current(snapshot, idempotencyKey);
      return result;
    },
    perform: async ({ order: snapshot, idempotencyKey }) => {
      const order = await current(snapshot, idempotencyKey, true);
      check(typeof fetchEmail === 'function' && typeof resendApiKey === 'string' && resendApiKey,
        'reward_operations_email_readback_unavailable');
      let result = await proof(order);
      if (!result) {
        await current(snapshot, idempotencyKey, true);
        await base44.asServiceRole.functions.invoke('getAdminOperationsDashboardSummary', {
          gateway_action: 'notifyOrderProcessed', payload: payload(order),
        });
        await current(snapshot, idempotencyKey, true);
        result = await proof(order);
      }
      check(result, 'reward_operations_email_unconfirmed');
      await current(snapshot, idempotencyKey, true);
      return result;
    },
  };

  const pushRevision = '2026-09-08.reward-operations-push-v1';
  const currentPush = (snapshot, key, claim = false) =>
    readCurrentRewardHandoffOrder(entities, snapshot, 'operations_push', key, claim);
  async function checkRecipients(order, receipts) {
    check(Array.isArray(receipts) && receipts.length > 0 && receipts.length <= 250
      && new Set(receipts.map(row => row.notification_id)).size === receipts.length,
    'reward_operations_push_recipients_incomplete');
    let accepted = 0;
    for (const receipt of receipts) {
      check(/^[A-Za-z0-9._:-]{1,120}$/.test(receipt.notification_id || ''), 'reward_operations_notification_id_invalid');
      const rows = await entities.Notification.filter({ id: receipt.notification_id }, undefined, 2);
      const notification = rows?.length === 1 ? rows[0] : null;
      check(notification && notification.idempotency_key === `admin_order_processed_${order.id}_${notification.customer_email}`
        && notification.order_id === order.id && notification.title === 'New NuVira Order'
        && notification.message === `Reward order #${order.order_number} is confirmed and ready for operations. No payment required.`
        && notification.deep_link === '/admin/orders' && notification.type === 'order_update'
        && notification.notification_subtype === 'admin_order_processed', 'reward_operations_notification_mismatch');
      if (receipt.reason === 'no_eligible_device') {
        check(receipt.token_count === 0 && receipt.sent_count === 0, 'reward_operations_skip_invalid');
      } else {
        check(!receipt.reason && Number.isSafeInteger(receipt.token_count) && receipt.token_count > 0
          && receipt.sent_count === receipt.token_count, 'reward_operations_push_acceptance_incomplete');
        accepted += receipt.sent_count;
      }
    }
    return accepted;
  }
  async function pushProof(order, key) {
    const rows = await entities.CustomerMessageDeliveryLog.filter({ idempotency_key: key }, undefined, 2);
    check(Array.isArray(rows) && rows.length < 2, 'reward_operations_push_receipt_not_unique');
    if (!rows.length) return null;
    const row = rows[0]; const data = row.metadata;
    check(/^[A-Za-z0-9._:-]{1,120}$/.test(row.id || '') && row.channel === 'push' && row.provider === 'internal'
      && row.message_type === 'internal_operations' && row.order_id === order.id
      && row.order_number === order.order_number && data?.revision === pushRevision
      && data.checkout_session_id === order.stripe_checkout_session_id
      && data.context_hash === order.reward_settlement.context_hash, 'reward_operations_push_receipt_mismatch');
    if (data.reason === 'channel_disabled') {
      check(row.status === 'skipped' && Array.isArray(data.recipients) && data.recipients.length === 0,
        'reward_operations_push_disabled_receipt_invalid');
      return { outcome: 'skipped', reason: 'channel_disabled', evidence_id: `operations_push_skip:${row.id}` };
    }
    const accepted = await checkRecipients(order, data.recipients);
    check(accepted > 0 ? row.status === 'sent' && !data.reason
      : row.status === 'skipped' && data.reason === 'no_eligible_device', 'reward_operations_push_status_mismatch');
    return accepted > 0 ? { outcome: 'completed', evidence_id: `operations_push_acceptance:${row.id}` }
      : { outcome: 'skipped', reason: 'no_eligible_device', evidence_id: `operations_push_skip:${row.id}` };
  }
  const operations_push = {
    reconcile: async ({ order: snapshot, idempotencyKey }) => {
      const order = await currentPush(snapshot, idempotencyKey);
      const result = await pushProof(order, idempotencyKey);
      await currentPush(snapshot, idempotencyKey);
      return result;
    },
    perform: async ({ order: snapshot, idempotencyKey }) => {
      const order = await currentPush(snapshot, idempotencyKey, true);
      payload(order);
      const previous = await pushProof(order, idempotencyKey);
      if (previous) { await currentPush(snapshot, idempotencyKey, true); return previous; }
      await currentPush(snapshot, idempotencyKey, true);
      const result = await base44.asServiceRole.functions.invoke('sendAdminOrderProcessedNotification', {
        order_id: order.id, order_number: order.order_number, customer_email: order.customer_email,
        reward_checkout_session_id: order.stripe_checkout_session_id, require_complete_readback: true,
      });
      const data = result?.data || result;
      check(data?.success === true && data.complete_readback === true, 'reward_operations_push_runtime_unconfirmed');
      let reason; let receipts = [];
      if (data.reason === 'admin_order_processed_push_disabled' && data.push_attempted === false
        && data.push_sent === false && data.push_token_count === 0) reason = 'channel_disabled';
      else {
        check(data.order_id === order.id && data.order_number === order.order_number
          && Array.isArray(data.recipient_results) && data.recipient_results.length === data.recipient_count
          && data.duplicate_count === 0 && data.notification_created_count === data.recipient_count,
        'reward_operations_push_recipients_unconfirmed');
        receipts = data.recipient_results.map(item => {
          check(item.complete_readback === true && item.failed_count === 0 && item.revoked_count === 0,
            'reward_operations_recipient_push_unconfirmed');
          const noDevice = item.push_attempted === false && item.push_sent === false && item.token_count === 0
            && item.sent_count === 0 && item.push_skipped_reason === 'no_active_push_subscription';
          check(noDevice || (item.push_attempted === true && item.push_sent === true && !item.push_skipped_reason
            && Number.isSafeInteger(item.token_count) && item.token_count > 0 && item.sent_count === item.token_count),
          'reward_operations_recipient_push_incomplete');
          return { notification_id: item.notification_id, token_count: item.token_count, sent_count: item.sent_count,
            ...(noDevice ? { reason: 'no_eligible_device' } : {}) };
        });
        if ((await checkRecipients(order, receipts)) === 0) reason = 'no_eligible_device';
      }
      await currentPush(snapshot, idempotencyKey, true);
      await entities.CustomerMessageDeliveryLog.create({ idempotency_key: idempotencyKey,
        channel: 'push', message_type: 'internal_operations', provider: 'internal',
        order_id: order.id, order_number: order.order_number, status: reason ? 'skipped' : 'sent',
        sent_at: new Date().toISOString(), metadata: { revision: pushRevision,
          checkout_session_id: order.stripe_checkout_session_id, context_hash: order.reward_settlement.context_hash,
          recipients: receipts, ...(reason ? { reason } : {}) } });
      const saved = await pushProof(order, idempotencyKey);
      check(saved, 'reward_operations_push_receipt_not_saved');
      await currentPush(snapshot, idempotencyKey, true);
      return saved;
    },
  };
  return { operations_email, operations_push };
}
