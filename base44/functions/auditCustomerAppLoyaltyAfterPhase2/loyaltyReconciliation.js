function text(value, max = 300) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function email(value) {
  return text(value, 320).toLowerCase();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function orderNumber(row) {
  return text(row?.order_number || row?.shopify_order_number || row?.name, 180).replace(/^#/, '').toLowerCase();
}

function providerKey(row) {
  const providerId = text(
    row?.stripe_payment_intent_id
      || row?.stripe_checkout_session_id
      || row?.shopify_order_id
      || row?.stripe_invoice_id,
    180,
  );
  return providerId || orderNumber(row) || text(row?.id, 180);
}

function paidOrder(row) {
  const payment = text(row?.payment_status || row?.financial_status, 50).toLowerCase();
  const lifecycle = text(row?.status || row?.order_status || row?.production_status, 50).toLowerCase();
  const refund = text(row?.refund_status, 50).toLowerCase();
  if (['refunded', 'fully_refunded', 'voided'].includes(payment) || ['refunded', 'cancelled', 'canceled', 'voided'].includes(lifecycle)) return false;
  if (refund === 'fully_refunded') return false;
  return row?.payment_captured === true || ['paid', 'succeeded', 'partially_refunded'].includes(payment);
}

function netOrderTotal(row) {
  const total = Math.max(0, number(row?.total ?? row?.total_price ?? row?.amount_paid));
  const refundStatus = text(row?.refund_status, 50).toLowerCase();
  const refundAmount = refundStatus === 'partially_refunded' ? Math.max(0, number(row?.refund_amount)) : 0;
  return Math.max(0, total - refundAmount);
}

function profileName(row) {
  return text([row?.first_name, row?.last_name].map(part => text(part, 100)).filter(Boolean).join(' '), 180);
}

function completeProfileName(row) {
  return text(row?.first_name, 100) && text(row?.last_name, 100) ? profileName(row) : '';
}

function splitName(value) {
  const parts = text(value, 180).split(' ').filter(Boolean);
  if (parts.length < 2 || /^(guest|customer|unknown|profile incomplete)$/i.test(parts.join(' '))) return { first_name: '', last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

function usablePhone(value) {
  const raw = text(value, 80);
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? raw : '';
}

function bestContact(customerEmail, profiles, orders) {
  const matchingProfiles = profiles.filter(row => [email(row?.customer_email), email(row?.contact_email)].includes(customerEmail));
  const matchingOrders = orders.filter(row => email(row?.customer_email) === customerEmail);
  const profile = matchingProfiles[0] || null;
  const order = matchingOrders.find(row => profileName(row) || text(row?.customer_name, 180) || usablePhone(row?.customer_phone || row?.contact_phone || row?.phone)) || matchingOrders[0] || null;
  const name = completeProfileName(profile) || completeProfileName(order) || text(order?.customer_name, 180) || profileName(profile) || profileName(order);
  const phone = usablePhone(profile?.phone || profile?.phone_number) || usablePhone(order?.customer_phone || order?.contact_phone || order?.phone);
  const split = splitName(name);
  const recoveredName = Boolean((!text(profile?.first_name) || !text(profile?.last_name)) && split.first_name && split.last_name);
  const recoveredPhone = Boolean(!usablePhone(profile?.phone || profile?.phone_number) && phone);
  return {
    profile_id: profile?.id || null,
    profile_customer_email: email(profile?.customer_email),
    first_name: text(profile?.first_name, 100) || split.first_name,
    last_name: text(profile?.last_name, 100) || split.last_name,
    phone: usablePhone(profile?.phone || profile?.phone_number) || phone,
    needs_profile_update: recoveredName || recoveredPhone,
  };
}

function uniqueBonusPoints(pointsRow) {
  const history = Array.isArray(pointsRow?.points_history) ? pointsRow.points_history : [];
  const seen = new Set();
  let signup = 0;
  let other = 0;
  for (const entry of history) {
    const amount = Math.max(0, Math.trunc(number(entry?.amount)));
    if (amount <= 0 || text(entry?.type, 40).toLowerCase() !== 'bonus') continue;
    const key = text(entry?.idempotency_key || entry?.event_key, 300)
      || `${text(entry?.description, 300).toLowerCase()}:${text(entry?.timestamp, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (/signup|welcome|join/.test(text(entry?.description, 300).toLowerCase())) signup = Math.max(signup, amount);
    else other += amount;
  }
  return { signup, other };
}

function redeemedPoints(pointsRow) {
  const explicit = Math.max(0, Math.trunc(number(pointsRow?.redeemed_points)));
  const history = Array.isArray(pointsRow?.points_history) ? pointsRow.points_history : [];
  const fromHistory = history.reduce((sum, entry) => {
    const type = text(entry?.type, 40).toLowerCase();
    const amount = number(entry?.amount);
    return type === 'redeemed' && amount < 0 ? sum + Math.abs(Math.trunc(amount)) : sum;
  }, 0);
  return Math.max(explicit, fromHistory);
}

function earnedHistoryPoints(pointsRow) {
  const history = Array.isArray(pointsRow?.points_history) ? pointsRow.points_history : [];
  const seen = new Set();
  return history.reduce((sum, entry) => {
    const amount = Math.max(0, Math.trunc(number(entry?.amount)));
    if (amount <= 0 || text(entry?.type, 40).toLowerCase() !== 'earned') return sum;
    const key = text(entry?.idempotency_key || entry?.event_key, 300)
      || `${text(entry?.description, 300).toLowerCase()}:${text(entry?.timestamp, 80)}`;
    if (seen.has(key)) return sum;
    seen.add(key);
    return sum + amount;
  }, 0);
}

function internalTestEmail(value) {
  const normalized = email(value);
  const [local, domain] = normalized.split('@');
  return normalized.endsWith('@example.com')
    || /^test(?:$|[._-]|\d|customer|debug)/.test(local || '')
    || /^nuvira(?:demo|test)/.test(local || '')
    || (domain === 'nuvirajuice.com' && local !== 'info');
}

export function buildAuthoritativeLoyaltyReconciliation({ members = [], pointsAccounts = [], profiles = [], orders = [], shopifyOrders = [], posClaims = [] } = {}) {
  const membersByEmail = new Map();
  const pointsByEmail = new Map();
  for (const row of members) {
    const key = email(row?.email);
    if (!key) continue;
    if (!membersByEmail.has(key)) membersByEmail.set(key, []);
    membersByEmail.get(key).push(row);
  }
  for (const row of pointsAccounts) {
    const key = email(row?.customer_email);
    if (!key) continue;
    if (!pointsByEmail.has(key)) pointsByEmail.set(key, []);
    pointsByEmail.get(key).push(row);
  }
  const enrolledEmails = new Set([...membersByEmail.keys(), ...pointsByEmail.keys()]);
  const allOrders = [...orders, ...shopifyOrders];
  const qualifyingByEmail = new Map();
  const seenOrderKeys = new Set();
  for (const row of allOrders) {
    const customerEmail = email(row?.customer_email);
    if (!enrolledEmails.has(customerEmail) || !paidOrder(row)) continue;
    const key = `${customerEmail}:${providerKey(row)}`;
    const numberKey = orderNumber(row) ? `${customerEmail}:number:${orderNumber(row)}` : '';
    if (seenOrderKeys.has(key) || numberKey && seenOrderKeys.has(numberKey)) continue;
    seenOrderKeys.add(key);
    if (numberKey) seenOrderKeys.add(numberKey);
    if (!qualifyingByEmail.has(customerEmail)) qualifyingByEmail.set(customerEmail, []);
    qualifyingByEmail.get(customerEmail).push(row);
  }

  const rows = [];
  for (const customerEmail of [...enrolledEmails].sort()) {
    if (internalTestEmail(customerEmail)) continue;
    const memberRows = membersByEmail.get(customerEmail) || [];
    const pointRows = pointsByEmail.get(customerEmail) || [];
    if (memberRows.length > 1 || pointRows.length > 1) {
      rows.push({ customer_email: customerEmail, blocked: true, blocker: 'duplicate_loyalty_projection_records' });
      continue;
    }
    const points = pointRows[0] || null;
    const member = memberRows[0] || null;
    const qualifyingOrders = qualifyingByEmail.get(customerEmail) || [];
    const orderPurchasePoints = qualifyingOrders.reduce((sum, row) => sum + Math.floor(netOrderTotal(row) * 10), 0);
    const historyPurchasePoints = earnedHistoryPoints(points || member);
    const matchingClaims = posClaims.filter(row => email(row?.customer_email) === customerEmail);
    const claimPurchasePoints = matchingClaims.reduce((maximum, row) => Math.max(maximum, Math.max(0, Math.trunc(number(row?.pending_points)))), 0);
    const purchasePoints = Math.max(orderPurchasePoints, historyPurchasePoints, claimPurchasePoints);
    const bonuses = uniqueBonusPoints(points || member);
    const signupPoints = bonuses.signup || (member ? 250 : 0);
    const otherBonusPoints = bonuses.other;
    const expectedRedeemed = redeemedPoints(points || member);
    const expectedLifetime = purchasePoints + signupPoints + otherBonusPoints;
    const expectedTotal = Math.max(0, expectedLifetime - expectedRedeemed);
    const currentTotal = Math.trunc(number(points?.total_points ?? member?.total_points));
    const currentLifetime = Math.trunc(number(points?.lifetime_points ?? member?.lifetime_points));
    const currentRedeemed = Math.trunc(number(points?.redeemed_points ?? member?.redeemed_points));
    const contact = bestContact(customerEmail, profiles, [...allOrders, ...matchingClaims]);
    const cacheMismatch = Boolean(points && member && (
      Math.trunc(number(points.total_points)) !== Math.trunc(number(member.total_points))
      || Math.trunc(number(points.lifetime_points)) !== Math.trunc(number(member.lifetime_points))
      || Math.trunc(number(points.redeemed_points)) !== Math.trunc(number(member.redeemed_points))
    ));
    rows.push({
      customer_email: customerEmail,
      blocked: false,
      current: { total_points: currentTotal, lifetime_points: currentLifetime, redeemed_points: currentRedeemed },
      expected: { total_points: expectedTotal, lifetime_points: expectedLifetime, redeemed_points: expectedRedeemed },
      difference: { total_points: expectedTotal - currentTotal, lifetime_points: expectedLifetime - currentLifetime, redeemed_points: expectedRedeemed - currentRedeemed },
      components: {
        qualifying_order_count: qualifyingOrders.length,
        qualifying_spend: Number(qualifyingOrders.reduce((sum, row) => sum + netOrderTotal(row), 0).toFixed(2)),
        purchase_points: purchasePoints,
        order_purchase_points: orderPurchasePoints,
        history_purchase_points: historyPurchasePoints,
        pos_claim_purchase_points: claimPurchasePoints,
        signup_points: signupPoints,
        other_bonus_points: otherBonusPoints,
        redeemed_points: expectedRedeemed,
      },
      order_references: qualifyingOrders.map(row => orderNumber(row) || providerKey(row)).slice(0, 100),
      contact,
      cache_mismatch: cacheMismatch,
      needs_balance_reconciliation: currentTotal !== expectedTotal || currentLifetime !== expectedLifetime || currentRedeemed !== expectedRedeemed,
    });
  }
  const actionable = rows.filter(row => !row.blocked && (row.needs_balance_reconciliation || row.cache_mismatch || row.contact?.needs_profile_update));
  return {
    policy_version: 'loyalty-order-ledger-v1-2026-08-04',
    points_per_dollar: 10,
    signup_bonus_points: 250,
    enrolled_customer_count: rows.length,
    blocked_customer_count: rows.filter(row => row.blocked).length,
    balance_mismatch_count: rows.filter(row => row.needs_balance_reconciliation || row.cache_mismatch).length,
    projection_mismatch_count: rows.filter(row => row.cache_mismatch).length,
    profile_enrichment_count: rows.filter(row => row.contact?.needs_profile_update).length,
    actionable,
    rows,
  };
}
