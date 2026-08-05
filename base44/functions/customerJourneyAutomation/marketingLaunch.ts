const RESEND_API_BASE = 'https://api.resend.com';
const MARKETING_SEGMENT_NAME = 'NuVira Verified Marketing Customers';
const TEST_SEGMENT_NAME = 'NuVira Internal Marketing Proof';
const CAMPAIGN_RECORD_ID = '6a6ed28996d315756fa4403a';
const CUSTOMER_SYNC_CONFIRMATION = 'SYNC VERIFIED NUVIRA MARKETING CONTACTS';
const DRAFT_CONFIRMATION = 'CREATE NUVIRA MARKETING DRAFT';
const TEST_CONFIRMATION = 'SEND NUVIRA MARKETING PROOF';
const APP_URL = 'https://www.nuvirajuice.com';
const FALLBACK_REVIEW_URL = 'https://g.page/nuvirajuiceco/review';
const MAILING_ADDRESS = "NuVira Juice Company, 619 N. Main St., O'Fallon, MO 63366";

type ContactRow = {
  email: string;
  first_name: string;
  last_name: string;
};

type ResendContact = {
  id: string;
  email: string;
  unsubscribed?: boolean;
};

function text(value: unknown, max = 500): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function email(value: unknown): string {
  return text(value, 320).toLowerCase();
}

function safeName(value: unknown): string {
  const normalized = text(value, 100);
  const lowered = normalized.toLowerCase();
  if (!normalized || ['unknown', 'profile incomplete', 'customer', 'guest', 'n/a', 'na', 'null', 'undefined'].includes(lowered)) return '';
  return normalized;
}

function splitName(value: unknown): { first_name: string; last_name: string } {
  const parts = safeName(value).split(' ').filter(Boolean);
  return {
    first_name: parts[0] || '',
    last_name: parts.slice(1).join(' '),
  };
}

function internalOrPrivateEmail(value: string): boolean {
  return value.endsWith('@nuvirajuice.com')
    || value.endsWith('@privaterelay.appleid.com')
    || value.endsWith('@example.com')
    || /(^|[._+-])(test|demo|sandbox|internal)([._+-]|@)/i.test(value);
}

async function listAll(entity: any, max = 2000): Promise<any[]> {
  const rows = [];
  for (let skip = 0; skip < max; skip += 200) {
    const page = await entity.list('-created_date', 200, skip);
    const normalized = Array.isArray(page) ? page : [];
    rows.push(...normalized);
    if (normalized.length < 200) break;
  }
  return rows;
}

async function marketingAudience(base44: any) {
  const [consents, profiles, claims, orders] = await Promise.all([
    listAll(base44.asServiceRole.entities.MarketingConsent, 1000),
    listAll(base44.asServiceRole.entities.UserProfile, 1000),
    listAll(base44.asServiceRole.entities.POSCustomerClaim, 1000),
    listAll(base44.asServiceRole.entities.ShopifyOrder, 2000),
  ]);

  const consentByEmail = new Map<string, any>();
  for (const row of consents) {
    const key = email(row?.customer_email);
    if (key && !consentByEmail.has(key)) consentByEmail.set(key, row);
  }
  const profileByEmail = new Map<string, any>();
  for (const row of profiles) {
    for (const key of [email(row?.customer_email), email(row?.contact_email)]) {
      if (key && !profileByEmail.has(key)) profileByEmail.set(key, row);
    }
  }
  const claimByEmail = new Map<string, any>();
  for (const row of claims) {
    const key = email(row?.customer_email);
    if (key && !claimByEmail.has(key)) claimByEmail.set(key, row);
  }
  const orderByEmail = new Map<string, any>();
  for (const row of orders) {
    const key = email(row?.customer_email);
    if (key && !orderByEmail.has(key)) orderByEmail.set(key, row);
  }

  const contacts: ContactRow[] = [];
  let consentExcluded = 0;
  let internalExcluded = 0;
  let missingName = 0;
  let profileNames = 0;
  let claimNames = 0;
  let orderNames = 0;

  for (const [customerEmail, consent] of consentByEmail.entries()) {
    if (consent?.email_status !== 'subscribed' || consent?.promotional_email_eligible !== true) {
      consentExcluded += 1;
      continue;
    }
    if (internalOrPrivateEmail(customerEmail)) {
      internalExcluded += 1;
      continue;
    }

    const profile = profileByEmail.get(customerEmail);
    const claim = claimByEmail.get(customerEmail);
    const order = orderByEmail.get(customerEmail);
    let firstName = safeName(profile?.first_name);
    let lastName = safeName(profile?.last_name);
    if (firstName && lastName) profileNames += 1;
    else {
      firstName = safeName(claim?.first_name);
      lastName = safeName(claim?.last_name);
      if (firstName && lastName) claimNames += 1;
      else {
        const split = splitName(order?.customer_name);
        firstName ||= split.first_name;
        lastName ||= split.last_name;
        if (firstName && lastName) orderNames += 1;
      }
    }
    if (!firstName || !lastName) {
      missingName += 1;
      continue;
    }
    contacts.push({ email: customerEmail, first_name: firstName, last_name: lastName });
  }

  return {
    contacts,
    summary: {
      eligible_count: contacts.length,
      complete_name_count: contacts.length,
      profile_name_count: profileNames,
      pos_claim_name_count: claimNames,
      shopify_order_name_count: orderNames,
      missing_name_count: missingName,
      consent_excluded_count: consentExcluded,
      internal_or_private_excluded_count: internalExcluded,
    },
  };
}

function resendKey(): string {
  return text(Deno.env.get('RESEND_AUTOMATION_API_KEY'), 1000);
}

async function resendRequest(path: string, init: RequestInit = {}, idempotencyKey = ''): Promise<any> {
  const key = resendKey();
  if (!key) throw new Error('resend_api_key_missing');
  const response = await fetch(`${RESEND_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'User-Agent': 'NuViraMarketingLaunch/1.0',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = text(body?.message || body?.error || body?.name || 'provider_error', 240);
    const error: any = new Error(`resend_provider_error:${response.status}:${detail}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function contactIdempotencyKey(customerEmail: string): Promise<string> {
  const bytes = new TextEncoder().encode(customerEmail);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const suffix = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('').slice(0, 32);
  return `marketing-contact:${suffix}`;
}

async function listSegments(): Promise<any[]> {
  const result = await resendRequest('/segments?limit=100');
  return Array.isArray(result?.data) ? result.data : [];
}

async function listContacts(segmentId = ''): Promise<ResendContact[]> {
  const rows: ResendContact[] = [];
  let after = '';
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ limit: '100' });
    if (after) params.set('after', after);
    const path = segmentId
      ? `/segments/${encodeURIComponent(segmentId)}/contacts?${params.toString()}`
      : `/contacts?${params.toString()}`;
    const result = await resendRequest(path);
    const data = Array.isArray(result?.data) ? result.data : [];
    rows.push(...data);
    if (!result?.has_more || data.length === 0) break;
    after = text(data[data.length - 1]?.id, 120);
  }
  return rows;
}

async function ensureSegment(name: string): Promise<any> {
  const segments = await listSegments();
  const existing = segments.find((row) => text(row?.name, 200) === name);
  if (existing) return { ...existing, created: false };
  const created = await resendRequest('/segments', {
    method: 'POST',
    body: JSON.stringify({ name }),
  }, `segment:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  return { ...created, created: true };
}

async function addContactToSegment(contactId: string, segmentId: string): Promise<void> {
  try {
    await resendRequest(`/contacts/${encodeURIComponent(contactId)}/segments/${encodeURIComponent(segmentId)}`, {
      method: 'POST',
      body: '{}',
    });
  } catch (error: any) {
    if (error?.status !== 409) throw error;
  }
}

async function syncContacts(base44: any, body: any): Promise<Response> {
  const audience = await marketingAudience(base44);
  if (text(body?.confirmation, 100) !== CUSTOMER_SYNC_CONFIRMATION) {
    return Response.json({ error: 'confirmation_required', confirmation_phrase: CUSTOMER_SYNC_CONFIRMATION }, { status: 400 });
  }
  if (Number(body?.expected_count) !== audience.contacts.length) {
    return Response.json({
      error: 'audience_count_changed',
      expected_count: Number(body?.expected_count) || null,
      current_count: audience.contacts.length,
    }, { status: 409 });
  }

  const segment = await ensureSegment(MARKETING_SEGMENT_NAME);
  const existingContacts = await listContacts();
  const existingByEmail = new Map(existingContacts.map((row) => [email(row?.email), row]));
  let created = 0;
  let existing = 0;
  let providerSuppressed = 0;
  let failed = 0;
  const failureCodes: Record<string, number> = {};

  for (const contact of audience.contacts) {
    try {
      const providerContact = existingByEmail.get(contact.email);
      if (providerContact?.unsubscribed === true) {
        providerSuppressed += 1;
        continue;
      }
      if (providerContact?.id) {
        await addContactToSegment(providerContact.id, segment.id);
        existing += 1;
      } else {
        await resendRequest('/contacts', {
          method: 'POST',
          body: JSON.stringify({
            email: contact.email,
            first_name: contact.first_name,
            last_name: contact.last_name,
            unsubscribed: false,
            segments: [{ id: segment.id }],
          }),
        }, await contactIdempotencyKey(contact.email));
        created += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 225));
    } catch (error) {
      failed += 1;
      const code = text(error instanceof Error ? error.message : error, 120).split(':').slice(0, 2).join(':') || 'unknown';
      failureCodes[code] = (failureCodes[code] || 0) + 1;
    }
  }

  const segmentContacts = await listContacts(segment.id);
  return Response.json({
    success: failed === 0,
    writes_performed: true,
    customer_emails_sent: 0,
    segment: { id: segment.id, name: MARKETING_SEGMENT_NAME, created: segment.created === true },
    audience: audience.summary,
    sync: {
      created_count: created,
      existing_count: existing,
      provider_suppressed_count: providerSuppressed,
      failed_count: failed,
      failure_codes: failureCodes,
      segment_contact_count: segmentContacts.length,
    },
  }, { status: failed === 0 ? 200 : 502 });
}

function marketingHtml(): string {
  const reviewUrl = text(Deno.env.get('NUVIRA_GOOGLE_REVIEW_URL'), 1000) || FALLBACK_REVIEW_URL;
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f1e8;color:#173c32;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">A thank-you gift from NuVira Juice Company.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1e8;"><tr><td align="center" style="padding:28px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border:1px solid #dfe8df;border-radius:22px;overflow:hidden;">
<tr><td style="padding:30px;background:#163d32;color:#fff;text-align:center;"><div style="font-size:13px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#e1bd61;">NuVira Juice Company</div><div style="margin-top:8px;font-size:28px;line-height:1.15;font-weight:800;">Real. Living. Nutrition.</div></td></tr>
<tr><td style="padding:32px 28px;"><p style="margin:0 0 12px;font-size:16px;">Hi {{{contact.first_name|there}}},</p>
<h1 style="margin:0 0 14px;font-size:28px;line-height:1.2;color:#173c32;">Thank you for being part of NuVira.</h1>
<p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#38584f;">We are grateful that you have supported NuVira Juice Company. We would love to welcome you into NuVira Rewards, where eligible purchases can earn points toward future rewards.</p>
<div style="margin:22px 0;padding:22px;border-radius:16px;background:#f6edd3;text-align:center;"><div style="font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#6b5421;">One-time 10% off your next purchase</div><div style="margin-top:8px;font-size:28px;font-weight:800;color:#173c32;">NuViraSummer</div></div>
<p style="margin:22px 0;text-align:center;"><a href="${APP_URL}/rewards" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#173c32;color:#fff;text-decoration:none;font-weight:800;">Join or View NuVira Rewards</a></p>
<p style="margin:22px 0 0;font-size:16px;line-height:1.65;color:#38584f;">If NuVira has been part of your wellness journey, an honest Google review would mean a great deal to our small business.</p>
<p style="margin:16px 0 24px;text-align:center;"><a href="${reviewUrl}" style="color:#173c32;font-weight:800;">Leave a Google Review</a></p>
<p style="margin:0;font-size:13px;line-height:1.55;color:#718078;text-align:center;">Promotional message from NuVira Juice Company.<br>${MAILING_ADDRESS}<br><a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#526a61;">Unsubscribe from promotional emails</a></p>
</td></tr></table></td></tr></table></body></html>`;
}

async function createCustomerDraft(base44: any, body: any): Promise<Response> {
  const audience = await marketingAudience(base44);
  if (text(body?.confirmation, 100) !== DRAFT_CONFIRMATION) {
    return Response.json({ error: 'confirmation_required', confirmation_phrase: DRAFT_CONFIRMATION }, { status: 400 });
  }
  if (Number(body?.expected_count) !== audience.contacts.length) {
    return Response.json({ error: 'audience_count_changed', current_count: audience.contacts.length }, { status: 409 });
  }
  const segment = (await listSegments()).find((row) => text(row?.name, 200) === MARKETING_SEGMENT_NAME);
  if (!segment?.id) return Response.json({ error: 'marketing_segment_missing' }, { status: 409 });
  const segmentContacts = await listContacts(segment.id);
  if (segmentContacts.length !== audience.contacts.length) {
    return Response.json({
      error: 'segment_count_mismatch',
      audience_count: audience.contacts.length,
      segment_contact_count: segmentContacts.length,
    }, { status: 409 });
  }
  const broadcast = await resendRequest('/broadcasts', {
    method: 'POST',
    body: JSON.stringify({
      segment_id: segment.id,
      name: 'NuVira Customer Appreciation and Rewards Launch — August 2026',
      from: 'NuVira Juice Co <info@nuvirajuice.com>',
      subject: 'Thank You for Being Part of NuVira — Enjoy 10% Off',
      html: marketingHtml(),
      send: false,
    }),
  }, 'nuvira-customer-appreciation-2026-08-v1');

  await base44.asServiceRole.entities.NotificationCampaign.update(CAMPAIGN_RECORD_ID, {
    title: 'Thank You for Being Part of NuVira — Enjoy 10% Off',
    message: 'Customer appreciation, rewards invitation, Google review request, and one-time 10% offer.',
    deep_link: '/rewards',
    audience: 'pos_rewards_email',
    notification_type: 'promotion',
    status: 'draft',
    recipients_total: audience.contacts.length,
    eligible_count: audience.contacts.length,
    sent_count: 0,
    failed_count: 0,
    skipped_count: 0,
    skipped_reasons: {},
    provider_broadcast_id: broadcast.id,
    provider_segment_id: segment.id,
  });

  return Response.json({
    success: true,
    draft_created: true,
    customer_emails_sent: 0,
    provider_broadcast_id: broadcast.id,
    segment_id: segment.id,
    recipient_count: audience.contacts.length,
    compliance: {
      physical_postal_address: true,
      unsubscribe_link: true,
      promotional_identification: true,
      google_review_link: true,
      discount_code: 'NuViraSummer',
      no_undefined_placeholders: true,
    },
  });
}

async function sendInternalProof(body: any): Promise<Response> {
  if (text(body?.confirmation, 100) !== TEST_CONFIRMATION) {
    return Response.json({ error: 'confirmation_required', confirmation_phrase: TEST_CONFIRMATION }, { status: 400 });
  }
  const recipient = email(body?.email);
  if (recipient !== 'info@nuvirajuice.com') return Response.json({ error: 'test_recipient_not_allowed' }, { status: 409 });
  const segment = await ensureSegment(TEST_SEGMENT_NAME);
  const contacts = await listContacts();
  const existing = contacts.find((row) => email(row?.email) === recipient);
  let contactId = existing?.id;
  if (!contactId) {
    const created = await resendRequest('/contacts', {
      method: 'POST',
      body: JSON.stringify({ email: recipient, first_name: 'NuVira', last_name: 'Team', unsubscribed: false, segments: [{ id: segment.id }] }),
    }, 'nuvira-internal-proof-contact');
    contactId = created.id;
  } else {
    if (existing?.unsubscribed === true) return Response.json({ error: 'internal_test_contact_unsubscribed' }, { status: 409 });
    await addContactToSegment(contactId, segment.id);
  }
  const broadcast = await resendRequest('/broadcasts', {
    method: 'POST',
    body: JSON.stringify({
      segment_id: segment.id,
      name: 'NuVira Customer Appreciation Launch Proof',
      from: 'NuVira Juice Co <info@nuvirajuice.com>',
      subject: '[TEST] Thank You for Being Part of NuVira — Enjoy 10% Off',
      html: marketingHtml(),
      send: true,
    }),
  }, 'nuvira-customer-appreciation-proof-2026-08-v1');
  return Response.json({ success: true, test_email_sent: true, recipient: 'info@nuvirajuice.com', provider_broadcast_id: broadcast.id });
}

async function launchPreview(base44: any): Promise<Response> {
  const audience = await marketingAudience(base44);
  const [segments, contacts] = await Promise.all([listSegments(), listContacts()]);
  const marketingSegment = segments.find((row) => text(row?.name, 200) === MARKETING_SEGMENT_NAME);
  const segmentContacts = marketingSegment?.id ? await listContacts(marketingSegment.id) : [];
  return Response.json({
    success: true,
    preview: true,
    writes_performed: false,
    customer_emails_sent: 0,
    audience: audience.summary,
    provider: {
      global_contact_count: contacts.length,
      segment_exists: Boolean(marketingSegment?.id),
      segment_contact_count: segmentContacts.length,
    },
    safeguards: {
      internal_and_private_relay_excluded: true,
      provider_unsubscribe_preserved: true,
      customer_broadcast_send_false: true,
      explicit_apply_confirmations: true,
    },
  });
}

export async function handleMarketingLaunchAction(base44: any, body: any): Promise<Response | null> {
  const action = text(body?.action, 80);
  if (action === 'marketing_launch_preview') return await launchPreview(base44);
  if (action === 'marketing_launch_sync_contacts') return await syncContacts(base44, body);
  if (action === 'marketing_launch_create_draft') return await createCustomerDraft(base44, body);
  if (action === 'marketing_launch_send_test') return await sendInternalProof(body);
  return null;
}
