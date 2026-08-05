const RESEND_API_BASE = 'https://api.resend.com';
const MARKETING_SEGMENT_NAME = 'NuVira Verified Marketing Customers';
const TEST_SEGMENT_NAME = 'NuVira Internal Marketing Proof';
const CAMPAIGN_RECORD_ID = '6a6ed28996d315756fa4403a';
const CAMPAIGN_KEY = 'customer_appreciation_2026_08';
const MARKETING_HOLD_COMMAND = 'marketing_order_hold';
const CUSTOMER_SYNC_CONFIRMATION = 'SYNC VERIFIED NUVIRA MARKETING CONTACTS';
const DRAFT_CONFIRMATION = 'CREATE NUVIRA MARKETING DRAFT';
const TEST_CONFIRMATION = 'SEND NUVIRA MARKETING PROOF';
const HOLD_CONFIRMATION = 'HOLD NUVIRA MARKETING ORDER';
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

function orderNumber(order: any): string {
  return text(order?.order_number || order?.shopify_order_number, 160);
}

function orderIsTerminal(order: any): boolean {
  const statuses = [order?.status, order?.fulfillment_status, order?.delivery_status, order?.shopify_fulfillment_status]
    .map((value) => text(value, 40).toLowerCase());
  return statuses.some((status) => ['delivered', 'picked_up', 'fulfilled'].includes(status));
}

function orderIsPaid(order: any): boolean {
  return order?.payment_captured === true
    || ['paid', 'captured'].includes(text(order?.payment_status || order?.financial_status, 40).toLowerCase());
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
  const [consents, profiles, claims, shopifyOrders, orders, holdCommands] = await Promise.all([
    listAll(base44.asServiceRole.entities.MarketingConsent, 1000),
    listAll(base44.asServiceRole.entities.UserProfile, 1000),
    listAll(base44.asServiceRole.entities.POSCustomerClaim, 1000),
    listAll(base44.asServiceRole.entities.ShopifyOrder, 2000),
    listAll(base44.asServiceRole.entities.Order, 2000),
    base44.asServiceRole.entities.CommandLog.filter({
      command_type: MARKETING_HOLD_COMMAND,
      command_source: CAMPAIGN_KEY,
      status: 'running',
    }, '-created_date', 200),
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
  for (const row of shopifyOrders) {
    const key = email(row?.customer_email);
    if (key && !orderByEmail.has(key)) orderByEmail.set(key, row);
  }

  const ordersByNumber = new Map<string, any>();
  for (const row of orders) {
    const key = orderNumber(row);
    if (key && !ordersByNumber.has(key)) ordersByNumber.set(key, row);
  }
  const holdCommandByOrder = new Map<string, any>();
  for (const command of Array.isArray(holdCommands) ? holdCommands : []) {
    const key = text(command?.related_order_number || command?.target_display_id, 160);
    if (key && !holdCommandByOrder.has(key)) holdCommandByOrder.set(key, command);
  }
  const configuredHoldNumbers = [...holdCommandByOrder.keys()];
  const activeHoldContacts: Array<{ email: string; order_number: string }> = [];
  const activeHoldEmails = new Set<string>();
  const releaseCandidateCommands: Array<{ id: string; order_number: string }> = [];
  const unresolvedOrderNumbers: string[] = [];
  let unresolvedHoldCount = 0;
  for (const heldOrderNumber of configuredHoldNumbers) {
    const order = ordersByNumber.get(heldOrderNumber);
    if (!order) {
      unresolvedHoldCount += 1;
      unresolvedOrderNumbers.push(heldOrderNumber);
      continue;
    }
    if (orderIsTerminal(order)) {
      const commandId = text(holdCommandByOrder.get(heldOrderNumber)?.id, 160);
      if (commandId) releaseCandidateCommands.push({ id: commandId, order_number: heldOrderNumber });
      continue;
    }
    const customerEmail = email(order?.customer_email);
    if (!customerEmail) {
      unresolvedHoldCount += 1;
      unresolvedOrderNumbers.push(heldOrderNumber);
      continue;
    }
    activeHoldEmails.add(customerEmail);
    activeHoldContacts.push({ email: customerEmail, order_number: heldOrderNumber });
  }

  const contacts: ContactRow[] = [];
  let consentExcluded = 0;
  let internalExcluded = 0;
  let missingName = 0;
  let profileNames = 0;
  let claimNames = 0;
  let orderNames = 0;
  let orderHoldExcluded = 0;

  for (const [customerEmail, consent] of consentByEmail.entries()) {
    if (consent?.email_status !== 'subscribed' || consent?.promotional_email_eligible !== true) {
      consentExcluded += 1;
      continue;
    }
    if (internalOrPrivateEmail(customerEmail)) {
      internalExcluded += 1;
      continue;
    }
    if (activeHoldEmails.has(customerEmail)) {
      orderHoldExcluded += 1;
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
      active_order_hold_count: activeHoldContacts.length,
      order_hold_excluded_count: orderHoldExcluded,
      unresolved_order_hold_count: unresolvedHoldCount,
    },
    holds: {
      configured_order_numbers: configuredHoldNumbers,
      active_contacts: activeHoldContacts,
      active_order_numbers: activeHoldContacts.map((row) => row.order_number),
      release_candidate_commands: releaseCandidateCommands,
      unresolved_order_numbers: unresolvedOrderNumbers,
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

async function removeContactFromSegment(contactId: string, segmentId: string): Promise<void> {
  try {
    await resendRequest(`/contacts/${encodeURIComponent(contactId)}/segments/${encodeURIComponent(segmentId)}`, {
      method: 'DELETE',
    });
  } catch (error: any) {
    if (![404, 409].includes(error?.status)) throw error;
  }
}

async function updateCampaignAudienceCounts(base44: any, audience: any): Promise<void> {
  const orderHoldExcluded = Number(audience?.summary?.order_hold_excluded_count) || 0;
  await base44.asServiceRole.entities.NotificationCampaign.update(CAMPAIGN_RECORD_ID, {
    recipients_total: Number(audience?.summary?.eligible_count || 0) + orderHoldExcluded,
    eligible_count: Number(audience?.summary?.eligible_count || 0),
    skipped_count: orderHoldExcluded,
    skipped_reasons: orderHoldExcluded > 0 ? { active_order_hold: orderHoldExcluded } : {},
  });
}

async function reconcileReleasedHolds(base44: any, audience: any): Promise<void> {
  const releaseCandidates = Array.isArray(audience?.holds?.release_candidate_commands)
    ? audience.holds.release_candidate_commands
    : [];
  if (releaseCandidates.length === 0) return;
  const completedAt = new Date().toISOString();
  await Promise.all(releaseCandidates.map((command: any) => base44.asServiceRole.entities.CommandLog.update(command.id, {
    status: 'success',
    completed_at: completedAt,
    result: {
      release_reason: 'released_during_audience_sync',
      order_terminal: true,
      customer_emails_sent: 0,
    },
  })));
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
  let removedForOrderHold = 0;

  for (const held of audience.holds.active_contacts) {
    const providerContact = existingByEmail.get(held.email);
    if (!providerContact?.id) continue;
    await removeContactFromSegment(providerContact.id, segment.id);
    removedForOrderHold += 1;
  }

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

  await reconcileReleasedHolds(base44, audience);
  const segmentContacts = await listContacts(segment.id);
  await updateCampaignAudienceCounts(base44, audience);
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
      removed_for_active_order_hold_count: removedForOrderHold,
      failed_count: failed,
      failure_codes: failureCodes,
      segment_contact_count: segmentContacts.length,
    },
  }, { status: failed === 0 ? 200 : 502 });
}

async function setOrderHold(base44: any, body: any): Promise<Response> {
  if (text(body?.confirmation, 100) !== HOLD_CONFIRMATION) {
    return Response.json({ error: 'confirmation_required', confirmation_phrase: HOLD_CONFIRMATION }, { status: 400 });
  }
  const heldOrderNumber = text(body?.order_number, 160);
  if (!heldOrderNumber) return Response.json({ error: 'order_number_required' }, { status: 400 });

  const orders = await base44.asServiceRole.entities.Order.filter({ order_number: heldOrderNumber }, '-created_date', 5);
  if (!Array.isArray(orders) || orders.length !== 1) {
    return Response.json({ error: orders?.length > 1 ? 'authoritative_order_ambiguous' : 'authoritative_order_not_found' }, { status: 409 });
  }
  const order = orders[0];
  if (!orderIsPaid(order)) return Response.json({ error: 'order_not_paid' }, { status: 409 });
  if (orderIsTerminal(order)) return Response.json({ error: 'order_already_terminal' }, { status: 409 });
  const customerEmail = email(order?.customer_email);
  if (!customerEmail) return Response.json({ error: 'order_customer_identity_missing' }, { status: 409 });

  const audienceBefore = await marketingAudience(base44);
  const currentlyEligible = audienceBefore.contacts.some((row) => row.email === customerEmail);

  const holdKey = `${MARKETING_HOLD_COMMAND}:${CAMPAIGN_KEY}:${heldOrderNumber}`;
  const [campaign, existingHolds, segments, contacts] = await Promise.all([
    base44.asServiceRole.entities.NotificationCampaign.get(CAMPAIGN_RECORD_ID),
    base44.asServiceRole.entities.CommandLog.filter({ idempotency_key: holdKey }, '-created_date', 5),
    listSegments(),
    listContacts(),
  ]);
  if (!campaign?.id || text(campaign?.status, 40) !== 'draft') {
    return Response.json({ error: 'marketing_campaign_not_draft' }, { status: 409 });
  }
  const segment = segments.find((row) => text(row?.name, 200) === MARKETING_SEGMENT_NAME);
  if (!segment?.id) return Response.json({ error: 'marketing_segment_missing' }, { status: 409 });
  const providerContact = contacts.find((row) => email(row?.email) === customerEmail);

  const now = new Date().toISOString();
  const activeHold = (Array.isArray(existingHolds) ? existingHolds : []).find((row) => row?.status === 'running');
  if (!activeHold) {
    await base44.asServiceRole.entities.CommandLog.create({
      command_id: holdKey,
      command_type: MARKETING_HOLD_COMMAND,
      command_source: CAMPAIGN_KEY,
      status: 'running',
      target_entity: 'Order',
      target_id: text(order?.id, 160),
      target_display_id: heldOrderNumber,
      payload: {
        campaign_key: CAMPAIGN_KEY,
        release_on_order_terminal: true,
        global_contact_unsubscribe: false,
      },
      idempotency_key: holdKey,
      submitted_at: now,
      started_at: now,
      function_name: 'customerJourneyAutomation',
      related_order_id: text(order?.id, 160),
      related_order_number: heldOrderNumber,
      notes: 'Campaign-only hold; automatically released when the authoritative order becomes terminal.',
    });
  }
  if (providerContact?.id) await removeContactFromSegment(providerContact.id, segment.id);

  const audienceAfter = await marketingAudience(base44);
  const segmentContacts = await listContacts(segment.id);
  await updateCampaignAudienceCounts(base44, audienceAfter);
  const heldContactStillInSegment = segmentContacts.some((row) => email(row?.email) === customerEmail);
  if (heldContactStillInSegment) {
    return Response.json({
      success: false,
      error: 'provider_order_hold_verification_failed',
      order_number: heldOrderNumber,
      hold_recorded: true,
      customer_emails_sent: 0,
    }, { status: 502 });
  }
  return Response.json({
    success: true,
    order_number: heldOrderNumber,
    hold_status: 'active_until_order_terminal',
    global_contact_unsubscribed: false,
    customer_emails_sent: 0,
    marketing_eligible_before_hold: currentlyEligible,
    provider_contact_present: Boolean(providerContact?.id),
    active_order_hold_count: audienceAfter.summary.active_order_hold_count,
    eligible_recipient_count: audienceAfter.summary.eligible_count,
    segment_contact_count: segmentContacts.length,
  });
}

export async function releaseCompletedMarketingHold(base44: any, order: any): Promise<Record<string, any>> {
  const completedOrderNumber = orderNumber(order);
  if (!completedOrderNumber || !orderIsTerminal(order)) return { released: false, reason: 'order_not_terminal' };
  const holdCommands = await base44.asServiceRole.entities.CommandLog.filter({
    command_type: MARKETING_HOLD_COMMAND,
    command_source: CAMPAIGN_KEY,
    status: 'running',
    related_order_number: completedOrderNumber,
  }, '-created_date', 20);
  const activeHolds = Array.isArray(holdCommands) ? holdCommands : [];
  if (activeHolds.length === 0) return { released: false, reason: 'order_not_held' };

  const customerEmail = email(order?.customer_email);
  let rejoinedSegment = false;
  let releaseReason = 'released';
  if (customerEmail && !internalOrPrivateEmail(customerEmail)) {
    const [consents, segments, contacts] = await Promise.all([
      base44.asServiceRole.entities.MarketingConsent.filter({ customer_email: customerEmail }, '-created_date', 5),
      listSegments(),
      listContacts(),
    ]);
    const consent = consents[0];
    const providerContact = contacts.find((row) => email(row?.email) === customerEmail);
    const segment = segments.find((row) => text(row?.name, 200) === MARKETING_SEGMENT_NAME);
    if (consent?.email_status === 'subscribed' && consent?.promotional_email_eligible === true && providerContact?.id && segment?.id) {
      if (providerContact.unsubscribed === true) releaseReason = 'provider_suppressed';
      else {
        await addContactToSegment(providerContact.id, segment.id);
        rejoinedSegment = true;
      }
    } else {
      releaseReason = 'not_marketing_eligible';
    }
  } else {
    releaseReason = 'customer_identity_unavailable';
  }

  const completedAt = new Date().toISOString();
  await Promise.all(activeHolds.map((command) => base44.asServiceRole.entities.CommandLog.update(command.id, {
    status: 'success',
    completed_at: completedAt,
    result: {
      release_reason: releaseReason,
      order_terminal: true,
      rejoined_segment: rejoinedSegment,
      customer_emails_sent: 0,
    },
  })));
  const refreshedAudience = await marketingAudience(base44);
  const segment = (await listSegments()).find((row) => text(row?.name, 200) === MARKETING_SEGMENT_NAME);
  const segmentContacts = segment?.id ? await listContacts(segment.id) : [];
  await updateCampaignAudienceCounts(base44, refreshedAudience);
  return {
    released: true,
    order_number: completedOrderNumber,
    release_reason: releaseReason,
    rejoined_segment: rejoinedSegment,
    customer_emails_sent: 0,
  };
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
  if (action === 'marketing_launch_set_order_hold') return await setOrderHold(base44, body);
  return null;
}
