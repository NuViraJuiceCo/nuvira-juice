import {
  ORDER_COMMUNICATION_POLICY_VERSION,
  buildOrderCommunicationPlan,
  getOrderCommunicationPolicy,
  normalizeOrderEvent,
  orderCommunicationPolicySummary,
  validateOrderEvent,
} from './orderCommunicationPolicy.js';
import { buildOrderEmailHtml } from './orderEmailTemplate.js';

const APP_ORIGIN = 'https://www.nuvirajuice.com';
const TIME_ZONE = 'America/Chicago';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const TRANSACTIONAL_FROM = Deno.env.get('TRANSACTIONAL_EMAIL_FROM') || 'NuVira Juice Co <info@nuvirajuice.com>';
const TRANSACTIONAL_REPLY_TO = Deno.env.get('TRANSACTIONAL_EMAIL_REPLY_TO') || 'support@nuvirajuice.com';
const INTERNAL_TOKEN = Deno.env.get('TRANSACTIONAL_COMMUNICATIONS_INTERNAL_TOKEN') || '';
const TEST_RECIPIENT = 'info@nuvirajuice.com';
const MAX_SWEEP_ROWS = 100;

type AnyRecord = Record<string, any>;

function orderContainsProgram(order: AnyRecord): boolean {
  return (Array.isArray(order?.items) ? order.items : []).some((item: AnyRecord) => {
    const productId = text(item?.product_id || item?.id, 160).toLowerCase();
    const title = text(item?.title || item?.name, 240).toLowerCase();
    return /^program[_-](radiance|hydration|reset)(?:[_-](?:2|3)day)?$/.test(productId)
      || /(radiance|hydration|reset) program/.test(title);
  });
}

function text(value: unknown, max = 240): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function email(value: unknown): string {
  const normalized = text(value, 200).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
}

function flag(name: string): boolean {
  return Deno.env.get(name) === 'true';
}

function transactionalMode(): 'disabled' | 'test' | 'production' {
  const mode = text(Deno.env.get('TRANSACTIONAL_COMMUNICATIONS_MODE'), 20).toLowerCase();
  return mode === 'test' || mode === 'production' ? mode : 'disabled';
}

function liveMasterEnabled(): boolean {
  return flag('ENABLE_ELEVATED_TRANSACTIONAL_COMMUNICATIONS')
    && Deno.env.get('TRANSACTIONAL_COMMUNICATIONS_KILL_SWITCH') === 'false'
    && transactionalMode() !== 'disabled';
}

function emailChannelEnabled(): boolean {
  return liveMasterEnabled() && flag('ENABLE_ELEVATED_TRANSACTIONAL_EMAILS');
}

function pushChannelEnabled(): boolean {
  return liveMasterEnabled()
    && flag('ENABLE_ELEVATED_TRANSACTIONAL_PUSH')
    && flag('ENABLE_CUSTOMER_PUSH_NOTIFICATIONS');
}

function safeInternalRequest(body: AnyRecord): boolean {
  const supplied = text(body.internal_token, 500);
  if (!INTERNAL_TOKEN || !supplied || supplied.length !== INTERNAL_TOKEN.length) return false;
  let mismatch = 0;
  for (let index = 0; index < supplied.length; index += 1) {
    mismatch |= supplied.charCodeAt(index) ^ INTERNAL_TOKEN.charCodeAt(index);
  }
  return mismatch === 0;
}

function readiness() {
  const blockers = [];
  const mode = transactionalMode();
  if (!flag('ENABLE_ELEVATED_TRANSACTIONAL_COMMUNICATIONS')) blockers.push('master_enable_flag_closed');
  if (Deno.env.get('TRANSACTIONAL_COMMUNICATIONS_KILL_SWITCH') !== 'false') blockers.push('kill_switch_closed');
  if (mode === 'disabled') blockers.push('communication_mode_disabled');
  if (!INTERNAL_TOKEN) blockers.push('internal_token_missing');
  if (!flag('ENABLE_ELEVATED_TRANSACTIONAL_EMAILS')) blockers.push('email_channel_closed');
  if (!RESEND_API_KEY) blockers.push('resend_api_key_missing');
  if (!flag('ENABLE_ELEVATED_TRANSACTIONAL_PUSH')) blockers.push('push_channel_closed');
  if (!flag('ENABLE_CUSTOMER_PUSH_NOTIFICATIONS')) blockers.push('customer_push_master_closed');
  return {
    mode,
    production_sends_enabled: mode === 'production' && liveMasterEnabled() && (emailChannelEnabled() || pushChannelEnabled()),
    test_sends_enabled: mode === 'test' && liveMasterEnabled() && (emailChannelEnabled() || pushChannelEnabled()),
    test_recipient_only: mode === 'test' ? TEST_RECIPIENT : null,
    master_enabled: liveMasterEnabled(),
    email_enabled: emailChannelEnabled(),
    push_enabled: pushChannelEnabled(),
    blockers,
  };
}

async function adminUser(base44: any) {
  const user = await base44.auth.me().catch(() => null);
  return user?.role === 'admin' ? user : null;
}

async function orderById(base44: any, orderId: string): Promise<AnyRecord | null> {
  const rows = await base44.asServiceRole.entities.Order.filter({ id: orderId }, null, 1);
  return rows[0] || null;
}

function orderContext(order: AnyRecord, body: AnyRecord): AnyRecord {
  return {
    order_id: order.id,
    order_number: order.order_number || order.id,
    delivery_date_label: text(body.delivery_date_label || order.assigned_delivery_date || order.estimated_delivery_date, 120),
    delivery_window_label: text(body.delivery_window_label || order.delivery_window_label, 120),
    refund_amount: Number(body.refund_amount || 0),
    order_created_at: order.created_date || order.created_at || null,
  };
}

function safeEventId(body: AnyRecord, order: AnyRecord, event: string): string {
  if (event === 'refunded') {
    const canonicalRefundMarker = text(
      order.stripe_refund_id || order.refund_event_id || order.refunded_at,
      180,
    ).replace(/[^a-zA-Z0-9:_./-]/g, '_');
    if (canonicalRefundMarker) return canonicalRefundMarker;
  }
  const supplied = text(body.event_id || body.idempotency_key, 180).replace(/[^a-zA-Z0-9:_./-]/g, '_');
  if (supplied) return supplied;
  const statusMarker = text(order.updated_date || order.delivered_at || order.created_date || order.id, 120)
    .replace(/[^a-zA-Z0-9:_./-]/g, '_');
  return `${event}:${statusMarker}`;
}

function deliveryKey(orderId: string, event: string, channel: string, eventId: string): string {
  return `txn:${orderId}:${event}:${channel}:${eventId}`.slice(0, 240);
}

async function deliveryLog(base44: any, idempotencyKey: string): Promise<AnyRecord | null> {
  const rows = await base44.asServiceRole.entities.CustomerMessageDeliveryLog.filter({
    idempotency_key: idempotencyKey,
  }, '-created_date', 1);
  return rows[0] || null;
}

async function createOrUpdateLog(base44: any, existing: AnyRecord | null, payload: AnyRecord): Promise<AnyRecord> {
  return existing?.id
    ? await base44.asServiceRole.entities.CustomerMessageDeliveryLog.update(existing.id, payload)
    : await base44.asServiceRole.entities.CustomerMessageDeliveryLog.create(payload);
}

async function closeScheduledPushesForTerminalOrder(
  base44: any,
  orderId: string,
  event: string,
  excludeLogId: string | null = null,
): Promise<number> {
  if (!['cancelled', 'refunded'].includes(event)) return 0;
  const rows = await base44.asServiceRole.entities.CustomerMessageDeliveryLog.filter({
    order_id: orderId,
    message_type: 'transactional_order',
    channel: 'push',
    status: 'scheduled',
  }, 'created_date', MAX_SWEEP_ROWS);
  let closed = 0;
  for (const row of rows) {
    if (!row?.id || row.id === excludeLogId) continue;
    await base44.asServiceRole.entities.CustomerMessageDeliveryLog.update(row.id, {
      status: 'skipped',
      error_message: `superseded_by_${event}`,
      metadata: {
        ...(row.metadata || {}),
        cancelled_at: new Date().toISOString(),
        cancellation_reason: `order_${event}`,
      },
    });
    closed += 1;
  }
  return closed;
}

async function recordPushResult(base44: any, {
  order,
  event,
  eventId,
  plan,
  result,
  existingLog = null,
}: AnyRecord): Promise<AnyRecord> {
  const idempotencyKey = deliveryKey(order.id, event, 'push', eventId);
  const currentLog = existingLog || await deliveryLog(base44, idempotencyKey);
  const pushSent = result?.push_sent === true;
  const skippedReason = text(result?.push_skipped_reason || result?.reason, 300);
  return await createOrUpdateLog(base44, currentLog, {
    idempotency_key: idempotencyKey,
    channel: 'push',
    message_type: 'transactional_order',
    order_id: order.id,
    order_number: order.order_number || order.id,
    customer_email: email(order.customer_email),
    provider: 'internal',
    status: pushSent ? 'sent' : 'skipped',
    sent_at: pushSent ? new Date().toISOString() : null,
    error_message: pushSent ? null : skippedReason || 'push_not_sent',
    metadata: {
      policy_version: ORDER_COMMUNICATION_POLICY_VERSION,
      event,
      event_id: eventId,
      notification_subtype: plan.policy.notification_subtype,
      token_count: Number(result?.push_token_count || result?.token_count || 0),
      notification_id: result?.notification_id || null,
      priority: plan.policy.priority,
    },
  });
}

async function sendPushAndInApp(base44: any, order: AnyRecord, event: string, eventId: string, plan: AnyRecord, existingLog: AnyRecord | null = null) {
  const notificationKey = event === 'order_confirmed'
    ? `order_confirmation_${order.id}`
    : `elevated_order:${order.id}:${event}:${eventId}`;
  let data: AnyRecord;
  try {
    const payload = {
      customer_email: email(order.customer_email),
      type: 'order_update',
      notification_subtype: plan.policy.notification_subtype,
      title: plan.copy.title,
      message: plan.copy.message,
      order_id: order.id,
      deep_link: event === 'delivered' && orderContainsProgram(order)
        ? '/account/programs'
        : `/order-tracker/${encodeURIComponent(order.order_number || order.id)}`,
      idempotency_key: notificationKey,
      delivery_key: notificationKey,
      source: 'elevated_transactional',
      notification_source: 'elevated_transactional',
      notification_origin: 'elevated_transactional',
      internal_token: INTERNAL_TOKEN,
      transactional_proof: INTERNAL_TOKEN,
      push_priority: plan.policy.priority,
      suppress_push: plan.channels.push !== 'send',
    };
    const result = await base44.asServiceRole.functions.invoke('sendCustomerNotification', payload);
    data = result?.data || result || {};
  } catch (error) {
    const nested = (error as AnyRecord)?.response?.data || {};
    data = {
      success: false,
      push_attempted: false,
      push_sent: false,
      push_skipped_reason: text(nested?.reason || nested?.error || 'customer_notification_invoke_failed', 240),
      diagnostic: transactionalMode() === 'test' ? text(error instanceof Error ? error.message : error, 300) : undefined,
      nested_transactional_mode: transactionalMode() === 'test' ? text(nested?.transactional_mode, 40) || null : undefined,
      nested_elevated_enabled: transactionalMode() === 'test' ? nested?.elevated_transactional_enabled === true : undefined,
      nested_source_present: transactionalMode() === 'test'
        ? Boolean(nested?.requested_source_present || nested?.notification_source_present)
        : undefined,
      nested_internal_token_present: transactionalMode() === 'test' ? nested?.internal_token_present === true : undefined,
      nested_internal_token_valid: transactionalMode() === 'test' ? nested?.internal_token_valid === true : undefined,
    };
  }

  let log: AnyRecord | null = null;
  if (plan.policy.push !== 'never') {
    try {
      log = await recordPushResult(base44, { order, event, eventId, plan, result: data, existingLog });
    } catch (error) {
      data.delivery_log_error = transactionalMode() === 'test'
        ? text(error instanceof Error ? error.message : error, 300)
        : 'push_delivery_log_unavailable';
    }
  }
  return { ...data, delivery_log_id: log?.id || null };
}

async function schedulePush(base44: any, order: AnyRecord, event: string, eventId: string, plan: AnyRecord) {
  const idempotencyKey = deliveryKey(order.id, event, 'push', eventId);
  const existing = await deliveryLog(base44, idempotencyKey);
  if (existing && ['scheduled', 'sent', 'delivered'].includes(existing.status)) {
    return { scheduled: existing.status === 'scheduled', skipped: true, reason: 'duplicate_idempotency_key', delivery_log_id: existing.id };
  }
  const log = await createOrUpdateLog(base44, existing, {
    idempotency_key: idempotencyKey,
    channel: 'push',
    message_type: 'transactional_order',
    order_id: order.id,
    order_number: order.order_number || order.id,
    customer_email: email(order.customer_email),
    provider: 'internal',
    status: 'scheduled',
    error_message: null,
    metadata: {
      policy_version: ORDER_COMMUNICATION_POLICY_VERSION,
      event,
      event_id: eventId,
      release_at: plan.push_release_at,
      notification_subtype: plan.policy.notification_subtype,
      priority: plan.policy.priority,
    },
  });
  return { scheduled: true, release_at: plan.push_release_at, delivery_log_id: log.id };
}

async function sendTransactionalEmail(base44: any, order: AnyRecord, event: string, eventId: string, plan: AnyRecord) {
  const idempotencyKey = deliveryKey(order.id, event, 'email', eventId);
  const existing = await deliveryLog(base44, idempotencyKey);
  if (existing && ['sent', 'delivered'].includes(existing.status)) {
    return { sent: false, skipped: true, reason: 'duplicate_idempotency_key', delivery_log_id: existing.id };
  }
  if (!RESEND_API_KEY) return { sent: false, skipped: true, reason: 'resend_api_key_missing' };

  const prepared = await createOrUpdateLog(base44, existing, {
    idempotency_key: idempotencyKey,
    channel: 'email',
    message_type: 'transactional_order',
    order_id: order.id,
    order_number: order.order_number || order.id,
    customer_email: email(order.customer_email),
    provider: 'resend',
    status: 'prepared',
    error_message: null,
    metadata: {
      policy_version: ORDER_COMMUNICATION_POLICY_VERSION,
      event,
      event_id: eventId,
      subject: plan.copy.subject,
      transactional: true,
    },
  });
  const orderNumber = order.order_number || order.id;
  const returnTo = `/order-tracker/${encodeURIComponent(orderNumber)}`;
  const actionUrl = `${APP_ORIGIN}/native-login?return_to=${encodeURIComponent(returnTo)}`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      from: TRANSACTIONAL_FROM,
      to: [email(order.customer_email)],
      reply_to: TRANSACTIONAL_REPLY_TO,
      subject: plan.copy.subject,
      html: buildOrderEmailHtml({ copy: plan.copy, order, actionUrl, supportEmail: TRANSACTIONAL_REPLY_TO }),
      tags: [
        { name: 'category', value: 'transactional_order' },
        { name: 'event', value: event.slice(0, 50) },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) {
    await createOrUpdateLog(base44, prepared, {
      status: 'failed',
      error_message: `resend_${response.status}_${text(payload?.message || 'send_failed', 400)}`,
      metadata: { ...prepared.metadata, provider_status: response.status },
    });
    return { sent: false, skipped: false, reason: 'resend_send_failed', provider_status: response.status };
  }
  const sent = await createOrUpdateLog(base44, prepared, {
    status: 'sent',
    provider_message_id: payload.id,
    sent_at: new Date().toISOString(),
    error_message: null,
    metadata: { ...prepared.metadata, provider_status: response.status },
  });
  return { sent: true, provider_message_id: payload.id, delivery_log_id: sent.id };
}

async function deliverEvent(base44: any, body: AnyRecord, scheduledLog: AnyRecord | null = null) {
  if (!liveMasterEnabled()) {
    return { success: true, skipped: true, reason: 'transactional_communications_locked', provider_calls_performed: false };
  }
  if (!safeInternalRequest(body)) {
    return { success: false, error: 'invalid_internal_token', provider_calls_performed: false };
  }

  const orderId = text(body.order_id || scheduledLog?.order_id, 180);
  const event = normalizeOrderEvent(body.event || scheduledLog?.metadata?.event);
  if (!orderId || !getOrderCommunicationPolicy(event)) {
    return { success: false, error: 'order_id_and_supported_event_required', provider_calls_performed: false };
  }
  const order = await orderById(base44, orderId);
  if (!order) return { success: false, error: 'order_not_found', provider_calls_performed: false };
  if (transactionalMode() === 'test' && email(order.customer_email) !== TEST_RECIPIENT) {
    return {
      success: true,
      skipped: true,
      reason: 'transactional_test_recipient_only',
      test_recipient_only: TEST_RECIPIENT,
      provider_calls_performed: false,
    };
  }
  const blockers = validateOrderEvent(event, order);
  if (blockers.length > 0 && body.allow_status_exception !== true) {
    if (scheduledLog?.id) {
      await base44.asServiceRole.entities.CustomerMessageDeliveryLog.update(scheduledLog.id, {
        status: 'skipped',
        error_message: `authoritative_order_validation_failed:${blockers.join(',')}`,
        metadata: {
          ...(scheduledLog.metadata || {}),
          cancelled_at: new Date().toISOString(),
          cancellation_reason: 'order_no_longer_eligible',
        },
      });
      return { success: true, skipped: true, reason: 'order_no_longer_eligible', blockers, provider_calls_performed: false };
    }
    return { success: false, error: 'authoritative_order_validation_failed', blockers, provider_calls_performed: false };
  }

  const scheduledPushesCancelled = await closeScheduledPushesForTerminalOrder(
    base44,
    orderId,
    event,
    scheduledLog?.id || null,
  );
  const eventId = scheduledLog?.metadata?.event_id || safeEventId(body, order, event);
  const context = orderContext(order, body);
  const plan: AnyRecord = buildOrderCommunicationPlan(event, context, {
    now: scheduledLog ? new Date() : new Date(body.occurred_at || Date.now()),
    timeZone: TIME_ZONE,
    pushAvailable: pushChannelEnabled(),
  });
  const output: AnyRecord = {
    success: true,
    event,
    event_id: eventId,
    policy_version: ORDER_COMMUNICATION_POLICY_VERSION,
    channels: plan.channels,
    email: { sent: false, skipped: true, reason: 'not_requested' },
    push: { push_sent: false, skipped: true, reason: 'not_requested' },
    provider_calls_performed: false,
    scheduled_pushes_cancelled: scheduledPushesCancelled,
  };

  if (plan.policy.push !== 'never' && pushChannelEnabled()) {
    if (!scheduledLog && plan.channels.push === 'scheduled') {
      output.push = await schedulePush(base44, order, event, eventId, plan);
    } else {
      output.push = await sendPushAndInApp(base44, order, event, eventId, {
        ...plan,
        channels: { ...plan.channels, push: 'send' },
      }, scheduledLog);
      output.provider_calls_performed = Boolean(output.push.push_attempted);
    }
  } else if (plan.policy.in_app) {
    output.push = await sendPushAndInApp(base44, order, event, eventId, {
      ...plan,
      channels: { ...plan.channels, push: 'not_requested' },
    });
  }

  const pushUnavailable = plan.policy.push !== 'never'
    && (!pushChannelEnabled() || output.push?.push_sent !== true)
    && output.push?.scheduled !== true;
  const shouldEmail = emailChannelEnabled()
    && (plan.policy.email === 'always' || (plan.policy.email === 'fallback' && pushUnavailable));
  if (shouldEmail) {
    output.email = await sendTransactionalEmail(base44, order, event, eventId, plan);
    output.provider_calls_performed = output.provider_calls_performed || output.email.sent === true || output.email.reason === 'resend_send_failed';
  } else if (plan.policy.email === 'fallback' && output.push?.scheduled === true) {
    output.email = { sent: false, skipped: true, reason: 'push_scheduled_no_fallback_needed' };
  } else if (!emailChannelEnabled() && plan.policy.email !== 'never') {
    output.email = { sent: false, skipped: true, reason: 'transactional_email_channel_locked' };
  }

  return output;
}

function sandboxMatrix() {
  const synthetic = {
    order_id: 'sandbox-order-id',
    order_number: 'NV-SANDBOX-1001',
    delivery_date_label: 'Friday, August 7',
    delivery_window_label: '5–8 PM CT',
    refund_amount: 42.5,
  };
  const daytime = new Date('2026-08-03T16:00:00.000Z');
  const quiet = new Date('2026-08-03T04:00:00.000Z');
  return orderCommunicationPolicySummary().map((row) => ({
    event: row.event,
    daytime: buildOrderCommunicationPlan(row.event, synthetic, { now: daytime, timeZone: TIME_ZONE, pushAvailable: true }),
    quiet_hours: buildOrderCommunicationPlan(row.event, synthetic, { now: quiet, timeZone: TIME_ZONE, pushAvailable: true }),
    no_push_device: buildOrderCommunicationPlan(row.event, synthetic, { now: daytime, timeZone: TIME_ZONE, pushAvailable: false }),
  }));
}

async function scheduledSweep(base44: any, body: AnyRecord) {
  if (!liveMasterEnabled() || !pushChannelEnabled()) {
    return { success: true, skipped: true, reason: 'transactional_push_locked', processed: 0, provider_calls_performed: false };
  }
  if (!safeInternalRequest(body)) {
    return { success: false, error: 'invalid_internal_token', processed: 0, provider_calls_performed: false };
  }

  const now = new Date().toISOString();
  const rows = await base44.asServiceRole.entities.CustomerMessageDeliveryLog.filter({
    message_type: 'transactional_order',
    channel: 'push',
    status: 'scheduled',
    provider: 'internal',
  }, 'created_date', MAX_SWEEP_ROWS);
  const due = rows.filter((row: AnyRecord) => text(row?.metadata?.release_at, 100) <= now);
  const results = [];
  for (const row of due) {
    const result = await deliverEvent(base44, {
      internal_token: INTERNAL_TOKEN,
      order_id: row.order_id,
      event: row.metadata?.event,
      event_id: row.metadata?.event_id,
    }, row);
    results.push({
      delivery_log_id: row.id,
      success: result.success,
      push_sent: result.push?.push_sent === true,
      provider_calls_performed: result.provider_calls_performed === true,
      reason: result.push?.reason || result.error || null,
    });
  }
  return {
    success: true,
    processed: results.length,
    results,
    provider_calls_performed: results.some((row) => row.provider_calls_performed),
  };
}

export async function handleElevatedTransactionalAction(base44: any, body: AnyRecord): Promise<Response | null> {
  const action = text(body.action, 80);
  if (!action.startsWith('elevated_')) return null;
  try {
    if (action === 'elevated_scheduled_sweep') return Response.json(await scheduledSweep(base44, body));
    if (action === 'elevated_deliver_event') {
      const result = await deliverEvent(base44, body);
      return Response.json(result, { status: result.success === false ? 409 : 200 });
    }

    const user = await adminUser(base44);
    if (!user) return Response.json({ error: 'admin_only' }, { status: 403 });

    if (action === 'elevated_sandbox_matrix') {
      return Response.json({
        success: true,
        sandbox: true,
        writes_performed: false,
        provider_calls_performed: false,
        customer_emails_sent: 0,
        customer_pushes_sent: 0,
        policy_version: ORDER_COMMUNICATION_POLICY_VERSION,
        matrix: sandboxMatrix(),
      });
    }

    if (action !== 'elevated_preview') return Response.json({ error: 'unsupported_action' }, { status: 400 });
    const deliveryLogs = await base44.asServiceRole.entities.CustomerMessageDeliveryLog.filter({
      message_type: 'transactional_order',
    }, '-created_date', 500).catch(() => []);
    const deliverySummary = deliveryLogs.reduce((summary: AnyRecord, row: AnyRecord) => {
      const channel = text(row.channel, 40) || 'unknown';
      const status = text(row.status, 40) || 'unknown';
      summary.total += 1;
      summary.by_channel[channel] = (summary.by_channel[channel] || 0) + 1;
      summary.by_status[status] = (summary.by_status[status] || 0) + 1;
      const event = text(row?.metadata?.event, 80) || 'unknown';
      summary.by_event[event] = (summary.by_event[event] || 0) + 1;
      return summary;
    }, { total: 0, by_channel: {}, by_status: {}, by_event: {} });
    return Response.json({
      success: true,
      preview: true,
      writes_performed: false,
      provider_calls_performed: false,
      customer_emails_sent: 0,
      customer_pushes_sent: 0,
      policy_version: ORDER_COMMUNICATION_POLICY_VERSION,
      readiness: readiness(),
      policy: orderCommunicationPolicySummary(),
      delivery_summary: deliverySummary,
      safeguards: {
        authoritative_order_required: true,
        recipient_override_allowed: false,
        internal_token_required: true,
        database_idempotency: true,
        resend_idempotency_header: true,
        push_device_tag_deduplication: true,
        quiet_hours: '8 PM–9 AM America/Chicago for non-urgent production pushes',
        transactional_marketing_separation: true,
        email_unsubscribe_required: false,
        staged_cutover: true,
        test_mode_recipient_allowlist: TEST_RECIPIENT,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown');
    console.error(`[sendOrderStatusNotification:elevated] ${message}`);
    return Response.json({
      error: 'transactional_communications_failed',
      diagnostic: transactionalMode() === 'test' ? text(message, 500) : undefined,
    }, { status: 500 });
  }
}
