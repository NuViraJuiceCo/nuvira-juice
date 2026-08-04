import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { Webhook } from 'npm:svix@1.99.1';

type AnyRecord = Record<string, any>;

const SUPPORTED_EVENTS = new Set([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.failed',
  'email.suppressed',
  'email.complained',
  'email.opened',
  'email.clicked',
]);

const FAILURE_EVENTS = new Set([
  'email.bounced',
  'email.failed',
  'email.suppressed',
  'email.complained',
]);

function text(value: unknown, max = 240): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function timestamp(value: unknown): string {
  const candidate = text(value, 100);
  return candidate && !Number.isNaN(Date.parse(candidate))
    ? new Date(candidate).toISOString()
    : new Date().toISOString();
}

function recordMetadata(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : {};
}

function nextDeliveryStatus(current: unknown, eventType: string): string {
  const status = text(current, 40) || 'sent';
  const terminal = new Set(['bounced', 'failed', 'suppressed', 'complained']);
  if (eventType === 'email.bounced') return 'bounced';
  if (eventType === 'email.failed') return 'failed';
  if (eventType === 'email.suppressed') return 'suppressed';
  if (eventType === 'email.complained') return 'complained';
  if (eventType === 'email.delivered') return terminal.has(status) ? status : 'delivered';
  if (eventType === 'email.delivery_delayed') {
    return terminal.has(status) || status === 'delivered' ? status : 'delivery_delayed';
  }
  if (eventType === 'email.sent') {
    return ['prepared', 'scheduled', 'sent'].includes(status) ? 'sent' : status;
  }
  return status;
}

function eventTimestampPatch(eventType: string, eventAt: string): AnyRecord {
  if (eventType === 'email.delivered') return { delivered_at: eventAt };
  if (eventType === 'email.delivery_delayed') return { delivery_delayed_at: eventAt };
  if (eventType === 'email.bounced') return { bounced_at: eventAt };
  if (eventType === 'email.failed') return { failed_at: eventAt };
  if (eventType === 'email.suppressed') return { suppressed_at: eventAt };
  if (eventType === 'email.complained') return { complained_at: eventAt };
  if (eventType === 'email.opened') return { opened_at: eventAt };
  if (eventType === 'email.clicked') return { clicked_at: eventAt };
  return {};
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  }

  const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET') || '';
  if (!webhookSecret) {
    return Response.json({ error: 'webhook_not_configured' }, { status: 503 });
  }

  const svixId = text(req.headers.get('svix-id'), 180);
  const svixTimestamp = text(req.headers.get('svix-timestamp'), 80);
  const svixSignature = text(req.headers.get('svix-signature'), 1000);
  if (!svixId || !svixTimestamp || !svixSignature) {
    return Response.json({ error: 'missing_webhook_signature' }, { status: 400 });
  }

  const rawBody = await req.text();
  let event: AnyRecord;
  try {
    event = new Webhook(webhookSecret).verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as AnyRecord;
  } catch {
    return Response.json({ error: 'invalid_webhook_signature' }, { status: 400 });
  }

  const eventType = text(event?.type, 80).toLowerCase();
  if (!SUPPORTED_EVENTS.has(eventType)) {
    return Response.json({ success: true, ignored: true, reason: 'unsupported_event' });
  }

  const providerMessageId = text(event?.data?.email_id, 180);
  if (!providerMessageId) {
    return Response.json({ error: 'email_id_required' }, { status: 400 });
  }

  const base44 = createClientFromRequest(req);
  const deliveryLogs = await base44.asServiceRole.entities.CustomerMessageDeliveryLog.filter({
    provider: 'resend',
    provider_message_id: providerMessageId,
  }, '-created_date', 20);

  if (deliveryLogs.length === 0) {
    const category = text(event?.data?.tags?.category, 80).toLowerCase();
    if (category === 'transactional_order') {
      return Response.json({ error: 'transactional_delivery_log_not_ready' }, { status: 503 });
    }
    return Response.json({ success: true, ignored: true, reason: 'delivery_log_not_managed' });
  }

  const eventAt = timestamp(event?.created_at || event?.data?.created_at);
  let updated = 0;
  let duplicates = 0;

  for (const deliveryLog of deliveryLogs) {
    const metadata = recordMetadata(deliveryLog.metadata);
    const priorIds = Array.isArray(metadata.resend_webhook_event_ids)
      ? metadata.resend_webhook_event_ids.map((value: unknown) => text(value, 180)).filter(Boolean)
      : [];
    if (priorIds.includes(svixId)) {
      duplicates += 1;
      continue;
    }

    const eventTimes = recordMetadata(metadata.resend_event_timestamps);
    const patch: AnyRecord = {
      status: nextDeliveryStatus(deliveryLog.status, eventType),
      last_provider_event: eventType,
      last_provider_event_at: eventAt,
      last_webhook_id: svixId,
      metadata: {
        ...metadata,
        resend_last_event: eventType,
        resend_last_event_at: eventAt,
        resend_webhook_event_ids: [...priorIds, svixId].slice(-50),
        resend_event_timestamps: { ...eventTimes, [eventType]: eventAt },
      },
      ...eventTimestampPatch(eventType, eventAt),
    };
    if (FAILURE_EVENTS.has(eventType)) {
      patch.error_message = `resend_${eventType.replace('email.', '')}`;
    } else if (eventType === 'email.delivered') {
      patch.error_message = null;
    }

    await base44.asServiceRole.entities.CustomerMessageDeliveryLog.update(deliveryLog.id, patch);
    updated += 1;
  }

  return Response.json({
    success: true,
    event: eventType,
    matched: deliveryLogs.length,
    updated,
    duplicates,
  });
});
