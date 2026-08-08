import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';

const HUB_API_URL = Deno.env.get('HUB_API_URL') || '';
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || '';
const PAGE_SIZE = 50;
const MAX_ROWS = 5000;
const APPLY_CONFIRMATION = 'CREATE CLAIMABLE POS CUSTOMERS';
const SHOPIFY_API_VERSION = '2026-07';

function normalizeRows(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function text(value: unknown, max = 180) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function email(value: unknown) {
  return text(value, 180).toLowerCase();
}

function phoneKey(value: unknown) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? digits : '';
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function placeholderEmail(value: string) {
  const [local = '', domain = ''] = value.split('@');
  return domain === 'nuvira.local'
    || domain === 'example.test'
    || domain === 'example.com'
    || value.endsWith('@privaterelay.appleid.com')
    || /^(pos|walkin|walk-in|guest|customer|placeholder)([+._-]|$)/i.test(local);
}

function internalOrTest(emailValue: string, fullName: string) {
  const [local = '', domain = ''] = emailValue.split('@');
  return domain === 'nuvirajuice.com'
    || /^(test|demo|sample)([+._-]|$)/i.test(local)
    || /\b(test|demo|sample)\b/i.test(fullName);
}

function splitName(value: unknown) {
  const full = text(value, 160);
  const parts = full.split(' ').filter(Boolean);
  if (parts.length < 2 || /^(customer|guest|walk[- ]?in customer|pos customer)$/i.test(full)) {
    return { first_name: '', last_name: '', full_name: '' };
  }
  return { first_name: parts[0], last_name: parts.slice(1).join(' '), full_name: full };
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function lower(value: unknown) {
  return text(value, 120).toLowerCase();
}

function isPOSOrder(order: any) {
  const tags = Array.isArray(order?.tags) ? order.tags.map(lower) : [];
  return lower(order?.source_type).includes('pos')
    || lower(order?.source_channel) === 'pos'
    || lower(order?.order_type) === 'pos'
    || lower(order?.fulfillment_method) === 'pos'
    || tags.includes('pos_sale')
    || tags.includes('event_sale');
}

function isEligibleOrder(order: any) {
  return lower(order?.payment_status) === 'paid'
    && !['cancelled', 'canceled', 'refunded', 'voided'].includes(lower(order?.order_status))
    && !['cancelled', 'canceled'].includes(lower(order?.fulfillment_status))
    && number(order?.total_price ?? order?.subtotal) > 0;
}

function dateValue(value: unknown) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function consentStatus(value: unknown) {
  const state = lower(value);
  if (['subscribed', 'confirmed_opt_in'].includes(state)) return 'subscribed';
  if (['unsubscribed', 'not_subscribed', 'redacted', 'invalid'].includes(state)) return 'unsubscribed';
  return 'unknown';
}

function shopifyHost() {
  return text(Deno.env.get('SHOPIFY_STORE_URL'), 240)
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

async function shopifyAccessToken(host: string) {
  const clientId = text(Deno.env.get('SHOPIFY_CLIENT_ID'), 240);
  const clientSecret = text(
    Deno.env.get('SHOPIFY_API_SECRET')
      || Deno.env.get('SHOPIFY_API_SECRET_KEY')
      || Deno.env.get('SHOPIFY_APP_SECRET'),
    500,
  );
  if (clientId && clientSecret) {
    const response = await fetch(`https://${host}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
    });
    const payload: any = await response.json().catch(() => ({}));
    if (response.ok && payload?.access_token) return text(payload.access_token, 500);
  }
  return text(Deno.env.get('SHOPIFY_API_TOKEN'), 500);
}

async function fetchShopifyCustomerProfiles() {
  const host = shopifyHost();
  const token = host ? await shopifyAccessToken(host) : '';
  if (!host || !token) return { byEmail: new Map<string, any>(), count: 0, warning: 'shopify_customer_credentials_missing' };

  const byEmail = new Map<string, any>();
  let cursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const response: Response = await fetch(`https://${host}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({
        query: `query CustomerIdentityPage($cursor: String) {
          customers(first: 100, after: $cursor) {
            nodes {
              firstName
              lastName
              defaultEmailAddress { emailAddress marketingState }
              defaultPhoneNumber { phoneNumber marketingState }
              defaultAddress { phone }
              updatedAt
            }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        variables: { cursor },
      }),
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.data?.customers) {
      return { byEmail, count: byEmail.size, warning: `shopify_customers_${response.status}` };
    }
    for (const customer of payload.data.customers.nodes || []) {
      const customerEmail = email(customer?.defaultEmailAddress?.emailAddress);
      if (!customerEmail) continue;
      byEmail.set(customerEmail, {
        first_name: text(customer?.firstName, 80),
        last_name: text(customer?.lastName, 100),
        phone: text(customer?.defaultPhoneNumber?.phoneNumber || customer?.defaultAddress?.phone, 80),
        email_marketing_status: consentStatus(customer?.defaultEmailAddress?.marketingState),
        sms_marketing_status: consentStatus(customer?.defaultPhoneNumber?.marketingState),
        updated_at: customer?.updatedAt || null,
      });
    }
    const pageInfo: any = payload.data.customers.pageInfo || {};
    if (!pageInfo.hasNextPage || !pageInfo.endCursor) break;
    cursor = pageInfo.endCursor;
  }
  return { byEmail, count: byEmail.size, warning: null };
}

async function listAll(entity: any, fields: string[]) {
  const rows: any[] = [];
  for (let skip = 0; skip < MAX_ROWS; skip += PAGE_SIZE) {
    const page = normalizeRows(await entity.list('-created_date', PAGE_SIZE, skip, fields));
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function hubBaseUrl() {
  return HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
}

async function hubRequest(path: string, init: RequestInit = {}) {
  if (!HUB_API_URL || !SYNC_SECRET) throw new Error('operations_source_not_configured');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${hubBaseUrl()}/functions/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${SYNC_SECRET}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) throw new Error(payload?.error || `operations_${response.status}`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function requireUser(base44: any) {
  const user = await base44.auth.me().catch(() => null);
  return user || null;
}

async function loadImportModel(service: any) {
  const [sourceOrders, profiles, members, points, claims, shopifyCustomers] = await Promise.all([
    listAll(service.entities.ShopifyOrder, [
      'id', 'shopify_order_id', 'shopify_order_number', 'customer_email', 'customer_name',
      'customer_phone', 'customer_order_date', 'created_date', 'total_price', 'subtotal',
      'payment_status', 'order_status', 'fulfillment_status', 'source_type', 'source_channel',
      'order_type', 'fulfillment_method', 'tags'
    ]),
    listAll(service.entities.UserProfile, ['id', 'customer_email', 'contact_email', 'first_name', 'last_name', 'phone']),
    listAll(service.entities.LoyaltyMember, ['id', 'email', 'total_points']),
    listAll(service.entities.UserPoints, ['id', 'customer_email', 'total_points']),
    listAll(service.entities.POSCustomerClaim, [
      'id', 'customer_email', 'status', 'import_key', 'phone', 'source_order_ids',
      'source_order_numbers', 'eligible_order_count', 'eligible_spend', 'pending_points',
      'invitation_status', 'created_date', 'updated_date'
    ]),
    fetchShopifyCustomerProfiles().catch(() => ({ byEmail: new Map<string, any>(), count: 0, warning: 'shopify_customer_fetch_failed' })),
  ]);

  const profileEmails = new Set<string>();
  const profilePhones = new Map<string, Set<string>>();
  for (const profile of profiles) {
    const emails = [email(profile.customer_email), email(profile.contact_email)].filter(Boolean);
    for (const key of emails) profileEmails.add(key);
    const key = phoneKey(profile.phone);
    if (key) profilePhones.set(key, new Set([...(profilePhones.get(key) || []), ...emails]));
  }
  const memberEmails = new Set(members.map((row) => email(row.email)).filter(Boolean));
  const pointEmails = new Set(points.map((row) => email(row.customer_email)).filter(Boolean));
  const claimByEmail = new Map(claims.map((row) => [email(row.customer_email), row]));

  const groups = new Map<string, any[]>();
  const blockedOrders: any[] = [];
  const posOrders = sourceOrders.filter(isPOSOrder);
  for (const sourceOrder of posOrders) {
    if (!isEligibleOrder(sourceOrder)) continue;
    const order = {
      id: text(sourceOrder.id || sourceOrder.shopify_order_id, 100),
      order_number: text(sourceOrder.shopify_order_number || sourceOrder.id, 100),
      customer_email: email(sourceOrder.customer_email),
      customer_name: text(sourceOrder.customer_name, 160),
      customer_phone: text(sourceOrder.customer_phone, 80),
      order_date: sourceOrder.customer_order_date || sourceOrder.created_date || null,
      total: number(sourceOrder.total_price ?? sourceOrder.subtotal),
      eligible_for_points: true,
      expected_points: Math.floor(number(sourceOrder.total_price ?? sourceOrder.subtotal) * 10),
    };
    const customerEmail = email(order.customer_email);
    if (!customerEmail || !validEmail(customerEmail) || placeholderEmail(customerEmail)) {
      blockedOrders.push({
        order_number: text(order.order_number, 100),
        customer_name: text(order.customer_name, 160),
        reason: customerEmail.endsWith('@privaterelay.appleid.com') ? 'private_relay_email' : 'missing_or_invalid_email',
      });
      continue;
    }
    const rows = groups.get(customerEmail) || [];
    rows.push(order);
    groups.set(customerEmail, rows);
  }

  const candidates = [];
  for (const [customerEmail, orders] of groups) {
    orders.sort((a, b) => Date.parse(String(a.order_date || '')) - Date.parse(String(b.order_date || '')));
    const identityOrder = [...orders].reverse().find((order) => splitName(order.customer_name).full_name || phoneKey(order.customer_phone)) || orders[orders.length - 1];
    const shopifyProfile = shopifyCustomers.byEmail.get(customerEmail);
    const profileName = [shopifyProfile?.first_name, shopifyProfile?.last_name].filter(Boolean).join(' ');
    const orderName = splitName(identityOrder?.customer_name);
    const name = orderName.full_name ? orderName : splitName(profileName);
    const phone = text(identityOrder?.customer_phone || shopifyProfile?.phone, 80);
    const normalizedPhone = phoneKey(phone);
    const existingClaim = claimByEmail.get(customerEmail);
    const blocked: string[] = [];
    if (internalOrTest(customerEmail, name.full_name)) blocked.push('internal_or_test_identity');
    if (/^amar\s+kahlon$/i.test(name.full_name) && customerEmail !== 'info@nuvirajuice.com') {
      blocked.push('suppressed_amar_alias');
    }
    if (profileEmails.has(customerEmail) || memberEmails.has(customerEmail) || pointEmails.has(customerEmail)) {
      blocked.push('existing_registered_customer');
    }
    const phoneEmails = normalizedPhone ? [...(profilePhones.get(normalizedPhone) || [])] : [];
    if (phoneEmails.some((value) => value && value !== customerEmail)) blocked.push('phone_linked_to_other_profile');
    if (existingClaim?.status === 'claimed') blocked.push('already_claimed');
    if (existingClaim?.status === 'suppressed' || existingClaim?.status === 'invalid') blocked.push(`claim_${existingClaim.status}`);

    const sourceOrderIds = [...new Set(orders.map((order) => text(order.id, 100)).filter(Boolean))];
    const sourceOrderNumbers = [...new Set(orders.map((order) => text(order.order_number, 100)).filter(Boolean))];
    const eligibleSpend = Number(orders.reduce((sum, order) => sum + number(order.total), 0).toFixed(2));
    const pendingPoints = orders.reduce((sum, order) => sum + number(order.expected_points), 0);
    const action = blocked.length > 0
      ? 'blocked'
      : existingClaim?.status === 'unclaimed'
        ? 'update_unclaimed'
        : 'create';
    candidates.push({
      customer_email: customerEmail,
      first_name: name.first_name,
      last_name: name.last_name,
      full_name: name.full_name,
      phone,
      profile_completion_required: !name.first_name || !name.last_name || !normalizedPhone,
      source_order_ids: sourceOrderIds,
      source_order_numbers: sourceOrderNumbers,
      eligible_order_count: orders.length,
      eligible_spend: eligibleSpend,
      pending_points: pendingPoints,
      first_order_date: dateValue(orders[0]?.order_date),
      latest_order_date: dateValue(orders[orders.length - 1]?.order_date),
      email_marketing_status: shopifyProfile?.email_marketing_status || 'unknown',
      sms_marketing_status: shopifyProfile?.sms_marketing_status || 'unknown',
      existing_claim_id: existingClaim?.id || null,
      action,
      blockers: blocked,
    });
  }
  candidates.sort((a, b) => (a.full_name || a.customer_email).localeCompare(b.full_name || b.customer_email));
  const safeCandidates = candidates.filter((row) => ['create', 'update_unclaimed'].includes(row.action));
  return {
    success: true,
    read_only: true,
    generated_at: new Date().toISOString(),
    source_generated_at: new Date().toISOString(),
    source_truncated: sourceOrders.length >= MAX_ROWS,
    shopify_customer_profiles: shopifyCustomers.count,
    warnings: shopifyCustomers.warning ? [shopifyCustomers.warning] : [],
    summary: {
      source_pos_orders: posOrders.length,
      eligible_pos_orders: posOrders.filter(isEligibleOrder).length,
      safe_customers: safeCandidates.length,
      new_claims: safeCandidates.filter((row) => row.action === 'create').length,
      refreshed_unclaimed: safeCandidates.filter((row) => row.action === 'update_unclaimed').length,
      blocked_customers: candidates.filter((row) => row.action === 'blocked').length,
      blocked_orders: blockedOrders.length,
      pending_points: safeCandidates.reduce((sum, row) => sum + row.pending_points, 0),
      eligible_spend: Number(safeCandidates.reduce((sum, row) => sum + row.eligible_spend, 0).toFixed(2)),
      emails_sent: 0,
    },
    candidates,
    blocked_orders: blockedOrders.slice(0, 100),
  };
}

async function adminSummary(service: any) {
  const [claims, consents] = await Promise.all([
    listAll(service.entities.POSCustomerClaim, [
      'id', 'customer_email', 'first_name', 'last_name', 'phone', 'status', 'source_order_numbers',
      'eligible_order_count', 'eligible_spend', 'pending_points', 'profile_completion_required',
      'invitation_status', 'imported_at', 'updated_from_source_at', 'claimed_at'
    ]),
    listAll(service.entities.MarketingConsent, [
      'id', 'customer_email', 'email_status', 'sms_status', 'promotional_email_eligible',
      'promotional_sms_eligible', 'last_verified_at'
    ]),
  ]);
  const consentByEmail = new Map(consents.map((row) => [email(row.customer_email), row]));
  const rows = claims.map((claim) => ({
    ...claim,
    marketing: consentByEmail.get(email(claim.customer_email)) || {
      email_status: claim.email_marketing_status || 'unknown',
      sms_status: claim.sms_marketing_status || 'unknown',
      promotional_email_eligible: false,
      promotional_sms_eligible: false,
    },
  }));
  return {
    success: true,
    read_only: true,
    generated_at: new Date().toISOString(),
    summary: {
      total: rows.length,
      unclaimed: rows.filter((row) => row.status === 'unclaimed').length,
      claimed: rows.filter((row) => row.status === 'claimed').length,
      incomplete: rows.filter((row) => row.profile_completion_required === true && row.status === 'unclaimed').length,
      pending_points: rows.filter((row) => row.status === 'unclaimed').reduce((sum, row) => sum + number(row.pending_points), 0),
      email_marketing_eligible: consents.filter((row) => row.promotional_email_eligible === true && row.email_status === 'subscribed').length,
      sms_marketing_eligible: consents.filter((row) => row.promotional_sms_eligible === true && row.sms_status === 'subscribed').length,
      invitations_sent: rows.filter((row) => row.invitation_status === 'sent').length,
    },
    rows: rows.sort((a, b) => (a.first_name || a.customer_email).localeCompare(b.first_name || b.customer_email)),
  };
}

async function upsertClaimCandidate(service: any, row: any, now: string, description: string) {
  const payload = {
    customer_email: row.customer_email,
    first_name: row.first_name || null,
    last_name: row.last_name || null,
    phone: row.phone || null,
    status: 'unclaimed',
    source_order_ids: row.source_order_ids,
    source_order_numbers: row.source_order_numbers,
    eligible_order_count: row.eligible_order_count,
    eligible_spend: row.eligible_spend,
    pending_points: row.pending_points,
    first_order_date: row.first_order_date,
    latest_order_date: row.latest_order_date,
    import_key: `pos_customer:${row.customer_email}`,
    imported_at: row.action === 'create' ? now : undefined,
    updated_from_source_at: now,
    email_marketing_status: row.email_marketing_status,
    sms_marketing_status: row.sms_marketing_status,
    consent_source: row.email_marketing_status !== 'unknown' || row.sms_marketing_status !== 'unknown'
      ? 'shopify_customer_profile'
      : 'not_captured_in_pos_order_source',
    profile_completion_required: row.profile_completion_required,
    invitation_status: 'not_sent',
    description,
  };
  const record = row.existing_claim_id
    ? await service.entities.POSCustomerClaim.update(row.existing_claim_id, payload)
    : await service.entities.POSCustomerClaim.create(payload);
  const existingConsents = normalizeRows(await service.entities.MarketingConsent.filter({ customer_email: row.customer_email }));
  const consentPayload = {
    customer_email: row.customer_email,
    email_status: row.email_marketing_status,
    sms_status: row.sms_marketing_status,
    email_source: row.email_marketing_status === 'unknown' ? 'not_captured_in_pos_order_source' : 'shopify_customer_profile',
    sms_source: row.sms_marketing_status === 'unknown' ? 'not_captured_in_pos_order_source' : 'shopify_customer_profile',
    promotional_email_eligible: row.email_marketing_status === 'subscribed',
    promotional_sms_eligible: row.sms_marketing_status === 'subscribed',
    last_verified_at: now,
  };
  if (existingConsents[0]) await service.entities.MarketingConsent.update(existingConsents[0].id, consentPayload);
  else await service.entities.MarketingConsent.create(consentPayload);
  return record;
}

export async function handlePOSCustomerClaims(req: Request) {
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = text(body?.action, 60);
    const service = base44.asServiceRole;
    const isShopifyOrderAutomation = body?.event?.entity_name === 'ShopifyOrder'
      && ['create', 'update'].includes(lower(body?.event?.type || body?.event?.event_type));
    const user = await requireUser(base44);
    if (!user && !isShopifyOrderAutomation) return Response.json({ error: 'unauthorized' }, { status: 401 });

    if (isShopifyOrderAutomation) {
      let sourceOrder = body?.data || null;
      if (!sourceOrder?.customer_email && body?.event?.entity_id) {
        sourceOrder = await service.entities.ShopifyOrder.get(body.event.entity_id).catch(() => null);
      }
      const customerEmail = email(sourceOrder?.customer_email);
      if (!customerEmail) {
        return Response.json({ success: true, skipped: true, reason: 'pos_order_customer_email_missing', emails_sent: 0, notifications_sent: 0 });
      }
      const model = await loadImportModel(service);
      if (model.source_truncated) {
        return Response.json({ error: 'source_truncated_automatic_refresh_refused' }, { status: 409 });
      }
      const candidate = model.candidates.find((row) => row.customer_email === customerEmail);
      if (!candidate || !['create', 'update_unclaimed'].includes(candidate.action)) {
        return Response.json({
          success: true,
          skipped: true,
          reason: candidate?.blockers?.[0] || 'not_an_eligible_pos_claim',
          emails_sent: 0,
          notifications_sent: 0,
        });
      }
      const now = new Date().toISOString();
      const record = await upsertClaimCandidate(
        service,
        candidate,
        now,
        `Claimable POS customer refreshed automatically from synchronized order ${text(sourceOrder?.shopify_order_number || body?.event?.entity_id, 100)}. No email sent.`,
      );
      return Response.json({
        success: true,
        action: candidate.action,
        claim_id: record?.id || candidate.existing_claim_id,
        pending_points: candidate.pending_points,
        emails_sent: 0,
        notifications_sent: 0,
      });
    }

    if (['preview_import', 'apply_import', 'admin_summary'].includes(action) && user?.role !== 'admin') {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }

    if (action === 'preview_import') return Response.json(await loadImportModel(service));

    if (action === 'apply_import') {
      if (text(body?.confirmation, 80) !== APPLY_CONFIRMATION || !text(body?.request_id, 100)) {
        return Response.json({ error: 'exact_confirmation_and_request_id_required' }, { status: 400 });
      }
      const model = await loadImportModel(service);
      if (model.source_truncated) {
        return Response.json({ error: 'source_truncated_import_refused', preview: model }, { status: 409 });
      }
      const now = new Date().toISOString();
      const written = [];
      for (const row of model.candidates.filter((candidate) => ['create', 'update_unclaimed'].includes(candidate.action))) {
        const record = await upsertClaimCandidate(
          service,
          row,
          now,
          `Claimable POS customer imported by ${email(user?.email)}; request ${text(body.request_id, 100)}. No email sent.`,
        );
        written.push({ id: record?.id || row.existing_claim_id, customer_email: row.customer_email, action: row.action });
      }
      return Response.json({
        success: true,
        request_id: text(body.request_id, 100),
        created: written.filter((row) => row.action === 'create').length,
        updated: written.filter((row) => row.action === 'update_unclaimed').length,
        records: written,
        emails_sent: 0,
        notifications_sent: 0,
        generated_at: now,
      });
    }

    if (action === 'admin_summary') return Response.json(await adminSummary(service));

    const userEmail = email(user.email);
    if (!validEmail(userEmail) || userEmail.endsWith('@privaterelay.appleid.com')) {
      return Response.json({ error: 'direct_verified_email_required' }, { status: 400 });
    }
    const claims = normalizeRows(await service.entities.POSCustomerClaim.filter({ customer_email: userEmail }));
    const claim = claims.find((row) => row.status === 'unclaimed') || claims.find((row) => row.status === 'claimed') || null;

    if (action === 'preview_current_claim') {
      if (!claim) return Response.json({ success: true, claim: null });
      return Response.json({
        success: true,
        claim: {
          id: claim.id,
          customer_email: userEmail,
          first_name: claim.first_name || '',
          last_name: claim.last_name || '',
          phone: claim.phone || '',
          status: claim.status,
          eligible_order_count: number(claim.eligible_order_count),
          eligible_spend: number(claim.eligible_spend),
          pending_points: number(claim.pending_points),
          source_order_numbers: Array.isArray(claim.source_order_numbers) ? claim.source_order_numbers : [],
          profile_completion_required: claim.profile_completion_required === true,
          claimed_at: claim.claimed_at || null,
        },
      });
    }

    if (action === 'activate_claim') {
      if (!claim) return Response.json({ error: 'no_pos_claim_for_verified_email' }, { status: 404 });
      if (claim.status === 'claimed') {
        const pointsRows = normalizeRows(await service.entities.UserPoints.filter({ customer_email: userEmail }));
        return Response.json({ success: true, idempotent: true, available_points: number(pointsRows[0]?.total_points) });
      }
      const firstName = text(body?.first_name, 80);
      const lastName = text(body?.last_name, 100);
      const phone = text(body?.phone, 80);
      if (!firstName || !lastName || !phoneKey(phone)) {
        return Response.json({ error: 'complete_name_and_valid_phone_required' }, { status: 400 });
      }

      const operations = await hubRequest('receiveLoyaltySignup', {
        method: 'POST',
        body: JSON.stringify({
          email: userEmail,
          full_name: `${firstName} ${lastName}`,
          phone,
          signup_date: new Date().toISOString().slice(0, 10),
        }),
      });
      const now = new Date().toISOString();
      const profiles = normalizeRows(await service.entities.UserProfile.filter({ customer_email: userEmail }));
      const profilePayload = {
        customer_email: userEmail,
        contact_email: userEmail,
        first_name: firstName,
        last_name: lastName,
        phone,
        onboarding_complete: true,
        description: 'Verified POS rewards claim. Delivery address and birthday may be completed later.',
      };
      if (profiles[0]) await service.entities.UserProfile.update(profiles[0].id, profilePayload);
      else await service.entities.UserProfile.create(profilePayload);
      await base44.auth.updateMe({ first_name: firstName, last_name: lastName, phone_number: phone }).catch(() => {});

      const expectedTotal = number(operations.total_points);
      const expectedLifetime = number(operations.lifetime_points);
      const expectedRedeemed = number(operations.redeemed_points);
      const reconciliationKey = `pos_claim:${claim.id}:${text(operations.member_id || 'member', 100)}:${expectedTotal}:${expectedLifetime}:${expectedRedeemed}`;
      const loyaltyResponse = await service.functions.invoke('enrollNewCustomerInLoyalty', {
        action: 'reconcile',
        customer_email: userEmail,
        expected_total: expectedTotal,
        expected_lifetime: expectedLifetime,
        expected_redeemed: expectedRedeemed,
        idempotency_key: reconciliationKey,
        description: 'Verified POS purchase-history claim reconciliation',
        source_type: 'pos_customer_claim',
        source_id: claim.id,
        metadata: {
          operations_member_id: operations.member_id || '',
          eligible_order_count: number(claim.eligible_order_count),
          eligible_spend: number(claim.eligible_spend),
        },
        internal_secret: Deno.env.get('LOYALTY_LEDGER_SECRET') || SYNC_SECRET,
      });
      const loyaltyResult = loyaltyResponse?.data || loyaltyResponse;
      if (loyaltyResult?.success !== true) throw new Error(loyaltyResult?.error || 'pos_claim_loyalty_reconciliation_failed');

      const emailOptIn = body?.email_marketing_opt_in === true;
      const smsOptIn = body?.sms_marketing_opt_in === true;
      const consentPayload = {
        customer_email: userEmail,
        email_status: emailOptIn ? 'subscribed' : 'unsubscribed',
        sms_status: smsOptIn ? 'subscribed' : 'unsubscribed',
        email_consent_at: emailOptIn ? now : null,
        sms_consent_at: smsOptIn ? now : null,
        email_source: 'pos_claim_form',
        sms_source: 'pos_claim_form',
        promotional_email_eligible: emailOptIn,
        promotional_sms_eligible: smsOptIn,
        last_verified_at: now,
      };
      const consents = normalizeRows(await service.entities.MarketingConsent.filter({ customer_email: userEmail }));
      if (consents[0]) await service.entities.MarketingConsent.update(consents[0].id, consentPayload);
      else await service.entities.MarketingConsent.create(consentPayload);
      const preferences = normalizeRows(await service.entities.NotificationPreference.filter({ customer_email: userEmail }));
      const preferencePayload = { customer_email: userEmail, promotions: emailOptIn || smsOptIn };
      if (preferences[0]) await service.entities.NotificationPreference.update(preferences[0].id, preferencePayload);
      else await service.entities.NotificationPreference.create(preferencePayload);

      await service.entities.POSCustomerClaim.update(claim.id, {
        first_name: firstName,
        last_name: lastName,
        phone,
        status: 'claimed',
        claimed_at: now,
        claimed_by_email: userEmail,
        operations_member_id: operations.member_id,
        pending_points: 0,
        profile_completion_required: false,
        email_marketing_status: consentPayload.email_status,
        sms_marketing_status: consentPayload.sms_status,
        consent_source: 'pos_claim_form',
      });
      return Response.json({
        success: true,
        idempotent: Number(operations.backfilled_order_count || 0) === 0,
        available_points: loyaltyResult.available_points ?? expectedTotal,
        lifetime_points: loyaltyResult.lifetime_points ?? expectedLifetime,
        redeemed_points: loyaltyResult.redeemed_points ?? expectedRedeemed,
        eligible_order_count: number(claim.eligible_order_count),
        eligible_spend: number(claim.eligible_spend),
        emails_sent: 0,
        notifications_sent: 0,
      });
    }

    return Response.json({ error: 'unsupported_action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[MANAGE-POS-CLAIMS]', message);
    const status = message.startsWith('operations_') ? 502 : 500;
    return Response.json({ error: message.slice(0, 180) || 'pos_claim_management_failed' }, { status });
  }
}
