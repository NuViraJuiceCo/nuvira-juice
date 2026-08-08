// @ts-nocheck
const MAX_ROWS = 1000;

function text(value: unknown, max = 300): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function email(value: unknown): string {
  return text(value, 320).toLowerCase();
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function date(value: unknown): number {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizePhone(value: unknown): string {
  const raw = text(value, 80);
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return '';
}

function internalTestEmail(value: unknown): boolean {
  const normalized = email(value);
  const [local, domain] = normalized.split('@');
  return normalized.endsWith('@example.com')
    || /^test(?:$|[._-]|\d|customer|debug)/.test(local || '')
    || /^nuvira(?:demo|test)/.test(local || '')
    || (domain === 'nuvirajuice.com' && local !== 'info');
}

function orderPaid(row: any): boolean {
  const payment = text(row?.payment_status || row?.financial_status, 50).toLowerCase();
  const lifecycle = text(row?.status || row?.order_status || row?.production_status, 50).toLowerCase();
  return (row?.payment_captured === true || ['paid', 'succeeded', 'partially_refunded'].includes(payment))
    && !['refunded', 'fully_refunded', 'voided'].includes(payment)
    && !['refunded', 'cancelled', 'canceled', 'voided'].includes(lifecycle);
}

function profileFullName(profile: any): string {
  return text([profile?.first_name, profile?.last_name].map(part => text(part, 100)).filter(Boolean).join(' '), 180);
}

function normalizedNameKey(value: unknown): string {
  return text(value, 180)
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function orderName(order: any): string {
  return text(order?.customer_name, 180);
}

function orderPhone(order: any): string {
  return normalizePhone(order?.customer_phone || order?.contact_phone);
}

function orderReference(order: any): string {
  return text(order?.order_number || order?.shopify_order_number || order?.id, 180);
}

function orderIdentity(order: any): string {
  const providerId = text(
    order?.stripe_payment_intent_id
      || order?.stripe_checkout_session_id
      || order?.shopify_order_id
      || order?.stripe_invoice_id,
    180,
  );
  const reference = orderReference(order).replace(/^#/, '').toLowerCase();
  return providerId ? `provider:${providerId}` : reference ? `number:${reference}` : `record:${text(order?.id, 180)}`;
}

function netOrderTotal(order: any): number {
  const total = Math.max(0, number(order?.total ?? order?.total_price ?? order?.amount_paid));
  const refundStatus = text(order?.refund_status, 50).toLowerCase();
  const refundAmount = refundStatus === 'partially_refunded' ? Math.max(0, number(order?.refund_amount)) : 0;
  return Math.max(0, total - refundAmount);
}

function dedupePaidOrders(orders: any[]): any[] {
  const result = new Map<string, any>();
  for (const order of orders.filter(orderPaid).sort((a: any, b: any) => date(b.created_date || b.customer_order_date) - date(a.created_date || a.customer_order_date))) {
    const key = orderIdentity(order);
    const numberKey = orderReference(order).replace(/^#/, '').toLowerCase();
    const duplicate = result.has(key) || (numberKey && [...result.values()].some(row => orderReference(row).replace(/^#/, '').toLowerCase() === numberKey));
    if (!duplicate) result.set(key, order);
  }
  return [...result.values()];
}

async function listMembers(base44: any) {
  const [members, points, profiles, nativeOrders, shopifyOrders, transactions, posClaims] = await Promise.all([
    base44.asServiceRole.entities.LoyaltyMember.list('-created_date', MAX_ROWS),
    base44.asServiceRole.entities.UserPoints.list('-created_date', MAX_ROWS),
    base44.asServiceRole.entities.UserProfile.list('-created_date', MAX_ROWS),
    base44.asServiceRole.entities.Order.list('-created_date', MAX_ROWS),
    base44.asServiceRole.entities.ShopifyOrder.list('-created_date', MAX_ROWS),
    base44.asServiceRole.entities.LoyaltyTransaction.list('-created_date', MAX_ROWS),
    base44.asServiceRole.entities.POSCustomerClaim.list('-created_date', MAX_ROWS),
  ]);
  const membersByEmail = new Map((members || []).map((row: any) => [email(row.email), row]));
  const pointsByEmail = new Map((points || []).map((row: any) => [email(row.customer_email), row]));
  const profilesByEmail = new Map();
  for (const row of profiles || []) {
    for (const key of [email(row.customer_email), email(row.contact_email)].filter(Boolean)) {
      if (!profilesByEmail.has(key)) profilesByEmail.set(key, row);
    }
  }
  const ordersByEmail = new Map();
  for (const row of [...(nativeOrders || []), ...(shopifyOrders || [])]) {
    const key = email(row.customer_email);
    if (!key) continue;
    if (!ordersByEmail.has(key)) ordersByEmail.set(key, []);
    ordersByEmail.get(key).push(row);
  }
  const transactionsByEmail = new Map();
  for (const row of transactions || []) {
    const key = email(row.customer_email);
    if (!key) continue;
    if (!transactionsByEmail.has(key)) transactionsByEmail.set(key, []);
    transactionsByEmail.get(key).push(row);
  }
  const claimsByEmail = new Map();
  for (const row of posClaims || []) {
    const key = email(row.customer_email);
    if (key && !claimsByEmail.has(key)) claimsByEmail.set(key, row);
  }
  const emails = new Set([...membersByEmail.keys(), ...pointsByEmail.keys()]);
  const rows = [];
  for (const customerEmail of emails) {
    if (!customerEmail || internalTestEmail(customerEmail)) continue;
    const member = membersByEmail.get(customerEmail) || null;
    const point = pointsByEmail.get(customerEmail) || null;
    const profile = profilesByEmail.get(customerEmail) || null;
    const claim = claimsByEmail.get(customerEmail) || null;
    const customerOrders = dedupePaidOrders(ordersByEmail.get(customerEmail) || []);
    const latestOrder = customerOrders[0] || null;
    const ledgerRows = (transactionsByEmail.get(customerEmail) || []).sort((a: any, b: any) => date(b.occurred_at || b.created_date) - date(a.occurred_at || a.created_date));
    const total = number(point?.total_points ?? member?.total_points);
    const lifetime = number(point?.lifetime_points ?? member?.lifetime_points);
    const redeemed = number(point?.redeemed_points ?? member?.redeemed_points);
    const cacheMismatch = Boolean(member && point && (
      number(member.total_points) !== number(point.total_points)
      || number(member.lifetime_points) !== number(point.lifetime_points)
      || number(member.redeemed_points) !== number(point.redeemed_points)
    ));
    const authoritativeProfileName = profileFullName(profile);
    const candidateNames = [
      authoritativeProfileName,
      ...customerOrders.slice(0, 5).map(orderName),
      profileFullName(claim),
      text(member?.full_name, 180),
    ].filter(Boolean);
    const distinctNameKeys = new Set(candidateNames.map(normalizedNameKey).filter(Boolean));
    // A complete customer-managed profile is the canonical current identity.
    // Historical order labels may contain reversed names or checkout typos and
    // should not leave an otherwise complete member in a permanent review state.
    const nameConflict = !authoritativeProfileName && distinctNameKeys.size > 1;
    const fullName = authoritativeProfileName || candidateNames[0] || '';
    const phone = normalizePhone(profile?.phone || profile?.phone_number) || orderPhone(latestOrder) || normalizePhone(claim?.phone) || normalizePhone(member?.phone);
    const missingName = !fullName;
    const phoneNotProvided = !phone;
    rows.push({
      id: point?.id || member?.id,
      customer_email: customerEmail,
      full_name: fullName || 'Name not provided',
      first_name: text(profile?.first_name || claim?.first_name, 100),
      last_name: text(profile?.last_name || claim?.last_name, 100),
      phone,
      profile_id: profile?.id || null,
      member_id: member?.id || null,
      points_account_id: point?.id || null,
      total_points: total,
      lifetime_points: lifetime,
      redeemed_points: redeemed,
      joined_at: member?.created_date || member?.signup_date || point?.created_date || null,
      order_count: customerOrders.length,
      lifetime_spend: Number(customerOrders.reduce((sum: number, row: any) => sum + netOrderTotal(row), 0).toFixed(2)),
      last_order_at: latestOrder?.created_date || latestOrder?.customer_order_date || null,
      last_order_number: latestOrder ? orderReference(latestOrder) : null,
      reconciliation_status: cacheMismatch
        ? 'cache_mismatch'
        : nameConflict || missingName
          ? 'identity_review'
          : phoneNotProvided
            ? 'phone_not_provided'
            : 'current',
      anomalies: [
        cacheMismatch ? 'cache_mismatch' : '',
        missingName ? 'missing_name' : '',
        nameConflict ? 'name_conflict' : '',
        phoneNotProvided ? 'phone_not_provided' : '',
      ].filter(Boolean),
      recent_transactions: ledgerRows.slice(0, 12).map((row: any) => ({
        id: row.id,
        amount: number(row.amount),
        transaction_type: text(row.transaction_type, 40),
        description: text(row.description, 300),
        occurred_at: row.occurred_at || row.created_date,
        order_number: text(row.order_number, 120) || null,
        idempotency_key: text(row.idempotency_key, 300),
      })),
    });
  }
  rows.sort((a, b) => date(b.last_order_at || b.joined_at) - date(a.last_order_at || a.joined_at));
  return {
    success: true,
    rows,
    summary: {
      member_count: rows.length,
      profile_incomplete_count: rows.filter(row => row.anomalies.includes('missing_name') || row.anomalies.includes('name_conflict')).length,
      contact_pending_count: rows.filter(row => row.anomalies.includes('missing_name') || row.anomalies.includes('name_conflict')).length,
      phone_not_provided_count: rows.filter(row => row.anomalies.includes('phone_not_provided')).length,
      cache_mismatch_count: rows.filter(row => row.anomalies.includes('cache_mismatch')).length,
      balance_issue_count: rows.filter(row => row.anomalies.includes('cache_mismatch')).length,
      total_outstanding_points: rows.reduce((sum, row) => sum + row.total_points, 0),
    },
  };
}

export async function handleLoyaltyAdminAction(base44: any, user: any, body: any) {
  try {
    const action = text(body?.action || 'list', 60).toLowerCase();
    if (action === 'list') return Response.json(await listMembers(base44));

    const customerEmail = email(body?.customer_email);
    if (!customerEmail || !customerEmail.includes('@')) return Response.json({ error: 'valid_customer_email_required' }, { status: 400 });
    if (action === 'adjust_points') {
      const amount = Math.trunc(number(body?.amount));
      const reason = text(body?.reason, 500);
      const requestId = text(body?.request_id, 180);
      if (!amount) return Response.json({ error: 'nonzero_integer_amount_required' }, { status: 400 });
      if (reason.length < 8) return Response.json({ error: 'meaningful_adjustment_reason_required' }, { status: 400 });
      if (!requestId) return Response.json({ error: 'request_id_required' }, { status: 400 });
      if (text(body?.confirmation, 400) !== `ADJUST ${customerEmail} ${amount}`) {
        return Response.json({ error: 'confirmation_required', confirmation_phrase: `ADJUST ${customerEmail} ${amount}` }, { status: 400 });
      }
      const response = await base44.asServiceRole.functions.invoke('enrollNewCustomerInLoyalty', {
        action: 'post',
        customer_email: customerEmail,
        amount,
        transaction_type: 'adjustment',
        idempotency_key: `admin_adjustment:${requestId}`,
        description: reason,
        source_type: 'admin_adjustment',
        source_id: requestId,
        metadata: { admin_email: user.email },
        internal_secret: Deno.env.get('LOYALTY_LEDGER_SECRET') || Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || '',
      });
      const result = response?.data || response;
      return Response.json(result, { status: result?.success === true ? 200 : 409 });
    }

    if (action === 'update_profile') {
      const firstName = text(body?.first_name, 100);
      const lastName = text(body?.last_name, 100);
      const phone = normalizePhone(body?.phone);
      const phoneInputPresent = text(body?.phone, 80).length > 0;
      if ((firstName && !lastName) || (!firstName && lastName)) {
        return Response.json({ error: 'first_and_last_name_must_be_saved_together' }, { status: 400 });
      }
      if (phoneInputPresent && !phone) return Response.json({ error: 'valid_phone_required_when_phone_is_provided' }, { status: 400 });
      if ((!firstName || !lastName) && !phone) return Response.json({ error: 'verified_name_or_phone_required' }, { status: 400 });
      const [customerProfiles, contactProfiles] = await Promise.all([
        base44.asServiceRole.entities.UserProfile.filter({ customer_email: customerEmail }, '-updated_date', 5),
        base44.asServiceRole.entities.UserProfile.filter({ contact_email: customerEmail }, '-updated_date', 5),
      ]);
      const profiles = [...customerProfiles, ...contactProfiles].filter((row, index, all) => all.findIndex(candidate => candidate.id === row.id) === index);
      const payload = {
        customer_email: profiles[0]?.customer_email || customerEmail,
        contact_email: customerEmail,
        ...(firstName && lastName ? { first_name: firstName, last_name: lastName } : {}),
        ...(phone ? { phone } : {}),
      };
      const profile = profiles[0]
        ? await base44.asServiceRole.entities.UserProfile.update(profiles[0].id, payload)
        : await base44.asServiceRole.entities.UserProfile.create(payload);
      return Response.json({ success: true, profile_id: profile.id, customer_email: customerEmail });
    }
    return Response.json({ error: 'unsupported_action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'loyalty_management_failed');
    console.error('[loyaltyAdmin]', message);
    return Response.json({ error: text(message, 500) || 'loyalty_management_failed' }, { status: 500 });
  }
}
