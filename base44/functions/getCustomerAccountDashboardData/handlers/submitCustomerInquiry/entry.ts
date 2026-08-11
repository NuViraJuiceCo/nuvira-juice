import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

type InquiryType = 'contact' | 'support' | 'event' | 'partnership' | 'merch_waitlist' | 'delivery_waitlist';
type AnyRecord = Record<string, any>;

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const SUPPORT_EMAIL = 'support@nuvirajuice.com';
const OPERATIONS_FROM = Deno.env.get('INTERNAL_EMAIL_FROM') || 'NuVira Juice Co <operations@nuvirajuice.com>';
const SUPPORT_FROM = 'NuVira Support <support@nuvirajuice.com>';
const MARKETING_FROM = Deno.env.get('MARKETING_EMAIL_FROM') || 'NuVira Juice Co <hello@nuvirajuice.com>';
const MAILING_ADDRESS = "NuVira Juice Company, 619 N. Main St., O'Fallon, MO 63366";
const TYPE_LABELS: Record<InquiryType, string> = {
  contact: 'General inquiry',
  support: 'Support request',
  event: 'Event inquiry',
  partnership: 'Partnership inquiry',
  merch_waitlist: 'Merch waitlist',
  delivery_waitlist: 'Delivery-area waitlist',
};

function singleLine(value: unknown, max = 300): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function multiLine(value: unknown, max = 4000): string {
  return String(value ?? '').trim().replace(/\r\n?/g, '\n').slice(0, max);
}

function email(value: unknown): string {
  return singleLine(value, 320).toLowerCase();
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function errorMessage(error: unknown): string {
  return singleLine(error instanceof Error ? error.message : String(error || 'unknown'), 900);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeMetadata(value: unknown): AnyRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = new Set([
    'business', 'business_type', 'event_type', 'event_date', 'guest_count', 'juice_type',
    'service_model', 'venue', 'postal_code', 'delivery_address', 'requested_area',
  ]);
  const output: AnyRecord = {};
  for (const [key, raw] of Object.entries(value as AnyRecord)) {
    if (!allowed.has(key)) continue;
    const cleaned = singleLine(raw, 500);
    if (cleaned) output[key] = cleaned;
  }
  return output;
}

function responseWindow(type: InquiryType): string {
  return ['event', 'partnership'].includes(type)
    ? 'within two business days'
    : 'within one business day';
}

function acknowledgmentCopy(type: InquiryType, firstName: string): { subject: string; heading: string; body: string } {
  if (type === 'merch_waitlist') {
    return {
      subject: 'You are on the NuVira merch list',
      heading: 'You are on the list',
      body: 'We will send one update when the next NuVira merch release is ready.',
    };
  }
  if (type === 'delivery_waitlist') {
    return {
      subject: 'Your NuVira delivery-area request is saved',
      heading: 'We saved your area request',
      body: 'We will let you know when NuVira delivery becomes available in your area.',
    };
  }
  return {
    subject: `We received your ${TYPE_LABELS[type].toLowerCase()}`,
    heading: 'Your message is with our team',
    body: `Thank you, ${firstName}. A member of the NuVira team will respond ${responseWindow(type)}.`,
  };
}

function customerEmailHtml(type: InquiryType, name: string): string {
  const firstName = singleLine(name, 120).split(/\s+/)[0] || 'there';
  const copy = acknowledgmentCopy(type, firstName);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f1ea;color:#26362d;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(copy.body)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:28px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(23,63,44,.08);">
<tr><td style="background:#173f2c;padding:28px 32px;text-align:center;color:#fff;"><div style="font-size:24px;font-weight:700;">NuVira Juice Co.</div><div style="margin-top:6px;color:#e1bd61;font-size:12px;letter-spacing:.16em;text-transform:uppercase;">Real. Living. Nutrition.</div></td></tr>
<tr><td style="padding:34px 32px 30px;"><p style="margin:0 0 16px;font-size:15px;color:#53655b;">Hi ${escapeHtml(firstName)},</p><h1 style="margin:0 0 14px;font-size:27px;line-height:1.2;color:#173f2c;">${escapeHtml(copy.heading)}</h1><p style="margin:0;font-size:16px;line-height:1.65;color:#405248;">${escapeHtml(copy.body)}</p><p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#6b7b72;">Need to add something? Reply to this email or contact <a href="mailto:${SUPPORT_EMAIL}" style="color:#236843;">${SUPPORT_EMAIL}</a>.</p><p style="margin:22px 0 0;font-size:14px;color:#405248;">The NuVira Team</p></td></tr>
<tr><td style="border-top:1px solid #edf1ee;padding:20px 32px;text-align:center;color:#7a8980;font-size:11px;line-height:1.5;">${MAILING_ADDRESS}</td></tr>
</table></td></tr></table></body></html>`;
}

function internalEmailHtml(inquiry: AnyRecord): string {
  const metadata = Object.entries(inquiry.metadata || {})
    .map(([key, value]) => `<tr><td style="padding:6px 10px;color:#66766d;">${escapeHtml(key.replace(/_/g, ' '))}</td><td style="padding:6px 10px;">${escapeHtml(value)}</td></tr>`)
    .join('');
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#26362d;"><h1 style="color:#173f2c;">${escapeHtml(TYPE_LABELS[inquiry.inquiry_type as InquiryType])}</h1><table style="border-collapse:collapse;"><tr><td style="padding:6px 10px;color:#66766d;">Name</td><td style="padding:6px 10px;">${escapeHtml(inquiry.customer_name || 'Not provided')}</td></tr><tr><td style="padding:6px 10px;color:#66766d;">Email</td><td style="padding:6px 10px;">${escapeHtml(inquiry.customer_email)}</td></tr><tr><td style="padding:6px 10px;color:#66766d;">Phone</td><td style="padding:6px 10px;">${escapeHtml(inquiry.customer_phone || 'Not provided')}</td></tr><tr><td style="padding:6px 10px;color:#66766d;">Subject</td><td style="padding:6px 10px;">${escapeHtml(inquiry.subject || TYPE_LABELS[inquiry.inquiry_type as InquiryType])}</td></tr>${metadata}</table><h2 style="font-size:16px;color:#173f2c;">Message</h2><p style="white-space:pre-wrap;line-height:1.6;">${escapeHtml(inquiry.message || 'No additional message.')}</p><p style="font-size:12px;color:#66766d;">Request ${escapeHtml(inquiry.request_id)} · Reply directly to reach the customer.</p></body></html>`;
}

async function sendEmail(payload: AnyRecord, idempotencyKey: string): Promise<string> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey.slice(0, 256),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data: AnyRecord = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!response.ok) throw new Error(`resend_${response.status}:${singleLine(data?.message || data?.error, 300)}`);
  return singleLine(data?.id, 180);
}

async function logDelivery(base44: any, payload: AnyRecord) {
  try {
    await base44.asServiceRole.entities.CustomerMessageDeliveryLog.create(payload);
  } catch (error) {
    console.warn(`[submitCustomerInquiry] delivery log failed: ${errorMessage(error)}`);
  }
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  if (!RESEND_API_KEY) return Response.json({ error: 'communications_not_configured' }, { status: 503 });

  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const inquiryType = singleLine(body?.inquiry_type, 40) as InquiryType;
  const requestId = singleLine(body?.request_id, 160);
  const customerEmail = email(body?.customer_email);
  if (!Object.prototype.hasOwnProperty.call(TYPE_LABELS, inquiryType)) {
    return Response.json({ error: 'unsupported_inquiry_type' }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9:_-]{12,160}$/.test(requestId)) return Response.json({ error: 'invalid_request_id' }, { status: 400 });
  if (!validEmail(customerEmail)) return Response.json({ error: 'invalid_customer_email' }, { status: 400 });

  const prior = await base44.asServiceRole.entities.CustomerInquiry.filter({ request_id: requestId }, '-created_date', 3);
  const priorInquiry = prior[0];
  if (priorInquiry?.status === 'acknowledged') {
    return Response.json({ success: true, duplicate: true, request_id: requestId, acknowledged: true });
  }

  const recent = await base44.asServiceRole.entities.CustomerInquiry.filter({ customer_email: customerEmail }, '-created_date', 10);
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  if (!priorInquiry && recent.filter((row: AnyRecord) => new Date(row?.created_date || 0).getTime() >= dayAgo).length >= 5) {
    return Response.json({ error: 'inquiry_rate_limited' }, { status: 429 });
  }

  const inquiry: AnyRecord = {
    request_id: requestId,
    inquiry_type: inquiryType,
    customer_name: singleLine(body?.customer_name, 180),
    customer_email: customerEmail,
    customer_phone: singleLine(body?.customer_phone, 80),
    subject: singleLine(body?.subject, 240) || TYPE_LABELS[inquiryType],
    message: multiLine(body?.message, 4000),
    source: singleLine(body?.source, 120) || 'customer_app',
    status: 'new',
    metadata: safeMetadata(body?.metadata),
  };
  const retryWindow = Date.now() - 15 * 60 * 1000;
  const repeated = !priorInquiry && recent.find((row: AnyRecord) => (
    row?.inquiry_type === inquiryType
    && singleLine(row?.subject, 240) === inquiry.subject
    && multiLine(row?.message, 4000) === inquiry.message
    && new Date(row?.created_date || 0).getTime() >= retryWindow
  ));
  if (repeated?.status === 'acknowledged') {
    return Response.json({
      success: true,
      duplicate: true,
      request_id: repeated.request_id || requestId,
      acknowledged: true,
    });
  }
  const created = priorInquiry || repeated || await base44.asServiceRole.entities.CustomerInquiry.create(inquiry);
  const effectiveRequestId = singleLine(created?.request_id, 160) || requestId;

  try {
    const internalKey = `customer_inquiry:${effectiveRequestId}:internal`;
    const acknowledgmentKey = `customer_inquiry:${effectiveRequestId}:ack`;
    const [internalMessageId, acknowledgmentMessageId] = await Promise.all([
      sendEmail({
        from: OPERATIONS_FROM,
        to: [SUPPORT_EMAIL],
        reply_to: customerEmail,
        subject: `[${TYPE_LABELS[inquiryType]}] ${inquiry.subject}`,
        html: internalEmailHtml(inquiry),
        tags: [{ name: 'category', value: 'internal_inquiry' }, { name: 'inquiry_type', value: inquiryType }],
      }, internalKey),
      sendEmail({
        from: ['merch_waitlist', 'delivery_waitlist'].includes(inquiryType) ? MARKETING_FROM : SUPPORT_FROM,
        to: [customerEmail],
        reply_to: SUPPORT_EMAIL,
        subject: acknowledgmentCopy(inquiryType, inquiry.customer_name).subject,
        html: customerEmailHtml(inquiryType, inquiry.customer_name),
        tags: [{ name: 'category', value: 'customer_inquiry' }, { name: 'inquiry_type', value: inquiryType }],
      }, acknowledgmentKey),
    ]);
    const sentAt = new Date().toISOString();
    await Promise.all([
      logDelivery(base44, { idempotency_key: internalKey, channel: 'email', message_type: 'internal_operations', customer_email: SUPPORT_EMAIL, provider: 'resend', provider_message_id: internalMessageId, status: 'sent', sent_at: sentAt, metadata: { inquiry_id: created.id, inquiry_type: inquiryType, direction: 'internal' } }),
      logDelivery(base44, { idempotency_key: acknowledgmentKey, channel: 'email', message_type: 'customer_inquiry', customer_email: customerEmail, provider: 'resend', provider_message_id: acknowledgmentMessageId, status: 'sent', sent_at: sentAt, metadata: { inquiry_id: created.id, inquiry_type: inquiryType, direction: 'customer_acknowledgment' } }),
      base44.asServiceRole.entities.CustomerInquiry.update(created.id, { status: 'acknowledged', internal_message_id: internalMessageId, acknowledgment_message_id: acknowledgmentMessageId, acknowledged_at: sentAt, last_error: null }),
    ]);
    return Response.json({ success: true, request_id: effectiveRequestId, acknowledged: true });
  } catch (error) {
    const message = errorMessage(error);
    await base44.asServiceRole.entities.CustomerInquiry.update(created.id, { last_error: message }).catch(() => {});
    return Response.json({ error: 'inquiry_delivery_failed', request_id: effectiveRequestId }, { status: 502 });
  }
}
