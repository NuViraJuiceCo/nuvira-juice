import { readCurrentRewardHandoffOrder } from './rewardCustomerHandoff.js';

const check = (value, code) => { if (!value) throw new Error(code); };
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
const phone = value => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 10 ? `+1${digits}` : digits.length >= 8 && digits.length <= 15 ? `+${digits}` : '';
};
export const REWARD_SMS_HANDOFF_REVISION = '2026-09-08.reward-sms-handoff-v1';

export function createRewardSmsHandoffAdapter({ base44, fetchStatus, apiKey, apiSecret, senderPhone }) {
  const entities = base44.asServiceRole.entities;
  const current = (snapshot, key, claim = false) => readCurrentRewardHandoffOrder(entities, snapshot, 'sms', key, claim);
  async function eligibility(order) {
    if (!String(order.contact_phone || '').trim()) return {
      outcome: 'skipped', reason: 'no_phone', evidence_id: `sms_no_phone:${order.id}`,
    };
    check(phone(order.contact_phone), 'reward_sms_phone_invalid');
    const rows = await entities.UserProfile.filter({ customer_email: order.customer_email }, undefined, 2);
    check(Array.isArray(rows) && rows.length < 2, 'reward_sms_profile_not_unique');
    const profile = rows[0];
    if (profile) check(opaque(profile.id) && profile.customer_email === order.customer_email, 'reward_sms_profile_mismatch');
    if (!profile || profile.sms_consent !== true || phone(profile.phone) !== phone(order.contact_phone)
      || !Number.isFinite(Date.parse(profile.sms_consent_date || '')) || Date.parse(profile.sms_consent_date) > Date.now()) {
      return { outcome: 'skipped', reason: 'preference_opt_out', evidence_id: `sms_preference:${profile?.id || order.id}` };
    }
    return null;
  }
  function payload(order) {
    check(opaque(order.order_number) && Array.isArray(order.items) && order.items.length > 0 && order.items.length <= 50
      && order.items.every(item => typeof item.title === 'string' && item.title.trim() && item.title.length <= 160
        && Number.isSafeInteger(item.quantity) && item.quantity > 0)
      && /^\d{4}-\d{2}-\d{2}$/.test(order.assigned_delivery_date || '')
      && Number.isFinite(Date.parse(`${order.assigned_delivery_date}T12:00:00Z`))
      && new Date(`${order.assigned_delivery_date}T12:00:00Z`).toISOString().slice(0, 10) === order.assigned_delivery_date
      && typeof order.delivery_window_label === 'string' && order.delivery_window_label.trim(), 'reward_sms_details_incomplete');
    check(!/\b(?:undefined|null|NaN)\b|\[object Object\]/i.test([order.order_number, order.delivery_window_label,
      ...order.items.map(item => item.title)].join('\n')), 'reward_sms_placeholder_detected');
    return { order_id: order.id, phone_number: phone(order.contact_phone), order_number: order.order_number,
      items: order.items, total: 0, assigned_delivery_date: order.assigned_delivery_date,
      delivery_window_label: order.delivery_window_label, reward_checkout_session_id: order.stripe_checkout_session_id };
  }
  async function proof(order) {
    const rows = await entities.CustomerMessageDeliveryLog.filter({ idempotency_key: `order_confirmation_sms_${order.id}` }, '-created_date', 20);
    check(Array.isArray(rows) && rows.length < 20, 'reward_sms_log_read_incomplete');
    if (!rows.length) return null;
    const data = payload(order);
    check(data.phone_number && rows.every(row => row.channel === 'sms' && row.provider === 'sendblue'
      && row.message_type === 'order_confirmation' && row.order_id === order.id && row.order_number === order.order_number
      && row.customer_phone === data.phone_number && ['sent', 'delivered'].includes(row.status)
      && opaque(row.provider_message_id) && row.metadata?.reward_checkout_session_id === order.stripe_checkout_session_id
      && row.metadata?.delivery_date === order.assigned_delivery_date
      && row.metadata?.delivery_window_label === order.delivery_window_label), 'reward_sms_log_invalid');
    const ids = new Set(rows.map(row => row.provider_message_id));
    check(ids.size === 1, 'reward_sms_multiple_provider_messages');
    check(typeof fetchStatus === 'function' && apiKey && apiSecret && phone(senderPhone), 'reward_sms_readback_unavailable');
    const handle = [...ids][0];
    // Official read-only status endpoint uses message_handle, not a guessed
    // message_id. Neither a queued response nor a missing log permits resend.
    const response = await fetchStatus(`https://api.sendblue.co/api/status?handle=${encodeURIComponent(handle)}`, {
      method: 'GET', headers: { 'sb-api-key-id': apiKey, 'sb-api-secret-key': apiSecret }, signal: AbortSignal.timeout(10000),
    });
    check(response.ok, 'reward_sms_provider_read_failed');
    const message = await response.json();
    check(message?.message_handle === handle && message.number === data.phone_number && message.from_number === phone(senderPhone)
      && message.is_outbound === true && ['SENT', 'DELIVERED', 'READ'].includes(message.status)
      && Number(message.error_code || 0) === 0, 'reward_sms_provider_identity_or_status_mismatch');
    const date = new Date(`${data.assigned_delivery_date}T12:00:00Z`).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Chicago',
    });
    const items = data.items.map(item => `• ${item.title} x${item.quantity}`).join('\n');
    const expected = `🌿 NuVira Order Confirmed!\n\nOrder #${data.order_number}\n\n${items}\nTotal: $0.00\n📅 Delivery: ${date}, ${data.delivery_window_label}\n\nWe'll keep you updated as your juice is freshly pressed. Questions? Reply here or email support@nuvirajuice.com 💚`;
    check(message.content === expected, 'reward_sms_content_mismatch');
    return { outcome: 'completed', evidence_id: `sendblue:${handle}` };
  }
  return {
    reconcile: async ({ order: snapshot, idempotencyKey }) => {
      const order = await current(snapshot, idempotencyKey);
      const result = await proof(order) || await eligibility(order);
      await current(snapshot, idempotencyKey);
      return result;
    },
    perform: async ({ order: snapshot, idempotencyKey }) => {
      const order = await current(snapshot, idempotencyKey, true);
      const existing = await proof(order) || await eligibility(order);
      if (existing) { await current(snapshot, idempotencyKey, true); return existing; }
      const data = payload(order);
      check(typeof fetchStatus === 'function' && apiKey && apiSecret && phone(senderPhone), 'reward_sms_readback_unavailable');
      await current(snapshot, idempotencyKey, true);
      await base44.asServiceRole.functions.invoke('getAdminOperationsDashboardSummary', {
        gateway_action: 'sendOrderSms', payload: data,
      });
      const result = await proof(order) || await eligibility(order);
      check(result, 'reward_sms_send_unconfirmed');
      await current(snapshot, idempotencyKey, true);
      return result;
    },
  };
}
