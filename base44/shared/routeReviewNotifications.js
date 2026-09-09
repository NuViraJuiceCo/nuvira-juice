const check = value => { if (!value) throw new Error('route_review_notification_unconfirmed'); };
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

// Transactional only. Prepared logs + provider idempotency protect retries;
// unknown outcomes beyond the provider window require review, not blind resend.
export async function notifyRouteReview({ base44, proof, stage, env, fetchImpl = fetch, now = Date.now() }) {
  const { dar, order, noPayment } = proof;
  const token = env.get('TRANSACTIONAL_COMMUNICATIONS_INTERNAL_TOKEN');
  check(token && env.get('ENABLE_ELEVATED_TRANSACTIONAL_COMMUNICATIONS') === 'true'
    && env.get('TRANSACTIONAL_COMMUNICATIONS_KILL_SWITCH') === 'false'
    && env.get('TRANSACTIONAL_COMMUNICATIONS_MODE') === 'production');
  check(['submitted', 'denied', 'expired'].includes(stage) && dar.id && dar.customer_email === order.customer_email);
  check(stage === 'submitted' ? dar.status === 'pending_review' && dar.provider_confirmation?.provider_id === proof.provider.id
    : dar.status === stage && dar.review_decision?.complete === true && order.payment_captured === false);
  const title = stage === 'submitted' ? 'Your delivery request is in review' : stage === 'denied' ? 'An update on your delivery request' : 'Your delivery request has expired';
  const message = stage === 'submitted'
    ? `Request ${dar.request_number} is with our team. We aim to respond within 24–48 hours. ${noPayment ? 'Your selected rewards and credits remain reserved until approval. No card payment is required.' : 'Your card is authorized only; it will be charged if the route is approved. Selected benefits remain reserved until then.'}`
    : `Request ${dar.request_number} ${stage === 'denied' ? 'could not be approved' : 'expired'}. No card payment was captured. Any selected rewards or credits have been released. ${noPayment ? '' : 'We have canceled the card authorization; your bank controls when the pending hold disappears.'} Contact support@nuvirajuice.com if you need help.`;
  const targets = stage === 'submitted' ? [
    { email: dar.customer_email, title, message, link: '/account/orders' },
    ...['info@nuvirajuice.com', 'operations@nuvirajuice.com'].map(email => ({ email,
      title: 'Delivery route review needs a decision', message: `Request ${dar.request_number} is ready to review. Check the delivery date and decide before the authorization expires.`, link: '/admin/orders' })),
  ] : [{ email: dar.customer_email, title, message, link: '/account/orders' }];
  for (const target of targets) {
    const key = `route_review:${dar.id}:${stage}:${target.email === dar.customer_email ? 'customer' : target.email.split('@')[0]}`;
    const entities = base44.asServiceRole.entities;
    let logs = await entities.CustomerMessageDeliveryLog.filter({ idempotency_key: key }, undefined, 2);
    check(Array.isArray(logs) && logs.length <= 1);
    if (!logs.length) {
      check(env.get('RESEND_API_KEY'));
      await entities.CustomerMessageDeliveryLog.create({ idempotency_key: key, channel: 'email',
        message_type: 'transactional_order', provider: 'resend', status: 'prepared',
        customer_email: target.email, order_id: order.id, order_number: order.order_number,
        metadata: { prepared_at: new Date(now).toISOString(), route_review_id: dar.id, stage } });
      logs = await entities.CustomerMessageDeliveryLog.filter({ idempotency_key: key }, undefined, 2);
    }
    check(logs.length === 1 && logs[0].id && logs[0].customer_email === target.email
      && logs[0].order_id === order.id && logs[0].provider === 'resend');
    const log = logs[0];
    if (!(['sent', 'delivered'].includes(log.status) && log.provider_message_id)) {
      check(log.status === 'prepared' && Number.isFinite(Date.parse(log.metadata?.prepared_at))
        && now - Date.parse(log.metadata.prepared_at) < 23 * 60 * 60 * 1000 && env.get('RESEND_API_KEY'));
      const response = await fetchImpl('https://api.resend.com/emails', { method: 'POST',
        headers: { Authorization: `Bearer ${env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ from: env.get('TRANSACTIONAL_EMAIL_FROM') || 'NuVira Juice Co <orders@nuvirajuice.com>',
          reply_to: env.get('TRANSACTIONAL_EMAIL_REPLY_TO') || 'support@nuvirajuice.com', to: [target.email],
          subject: target.title, text: `${target.message}\nhttps://nuvirajuice.com${target.link}`,
          html: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f5f6f0;color:#153f32;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:32px 24px"><p style="font-weight:700;letter-spacing:3px">NuVira</p><div style="background:white;border-radius:20px;padding:28px"><h2>${escape(target.title)}</h2><p style="line-height:1.65">${escape(target.message)}</p><p><a style="display:inline-block;background:#14563f;color:white;padding:14px 22px;border-radius:10px;text-decoration:none" href="https://nuvirajuice.com${target.link}">View request</a></p></div><p style="font-size:12px;color:#5b7168;line-height:1.6">NuVira Juice Company<br>619 N. Main St., O'Fallon, MO 63366<br>Questions? support@nuvirajuice.com</p></div></body></html>` }) });
      const accepted = await response.json();
      check(response.ok && typeof accepted.id === 'string' && accepted.id.length > 0);
      await entities.CustomerMessageDeliveryLog.update(log.id, { status: 'sent', provider_message_id: accepted.id,
        sent_at: new Date(now).toISOString() });
      const confirmed = await entities.CustomerMessageDeliveryLog.filter({ id: log.id }, undefined, 2);
      check(confirmed.length === 1 && ['sent', 'delivered'].includes(confirmed[0].status)
        && confirmed[0].provider_message_id === accepted.id);
    }
    const notification = await base44.asServiceRole.functions.invoke('sendCustomerNotification', {
      customer_email: target.email, type: 'general', notification_subtype: 'route_review',
      source: 'elevated_transactional', internal_token: token,
      title: target.title, message: target.message, order_id: order.id,
      deep_link: target.link, idempotency_key: `${key}:in_app` });
    const delivered = notification?.data || notification;
    check(delivered?.success === true && typeof delivered.notification_id === 'string'
      && (!delivered.skipped || delivered.reason === 'duplicate_idempotency_key')
      && (delivered.push_sent === true || delivered.push_skipped_reason === 'no_active_push_subscription'));
  }
  return { success: true };
}
