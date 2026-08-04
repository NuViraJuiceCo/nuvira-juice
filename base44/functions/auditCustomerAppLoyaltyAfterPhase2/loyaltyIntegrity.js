const PRIVATE_RELAY_DOMAIN = '@privaterelay.appleid.com';

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasUsableEmail(value) {
  const email = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isTestEmail(value) {
  const email = normalizeEmail(value);
  const [local = '', domain = ''] = email.split('@');
  return domain === 'example.com'
    || local === 'test'
    || local.startsWith('test');
}

function text(value) {
  return String(value || '').trim();
}

function fullName(row) {
  return text(row?.full_name) || [text(row?.first_name), text(row?.last_name)].filter(Boolean).join(' ');
}

function groupByEmail(rows, field) {
  const grouped = new Map();
  for (const row of rows || []) {
    const email = normalizeEmail(row?.[field]);
    if (!grouped.has(email)) grouped.set(email, []);
    grouped.get(email).push(row);
  }
  return grouped;
}

function summarizeDuplicates(grouped) {
  return Array.from(grouped.entries())
    .filter(([email, rows]) => email && rows.length > 1)
    .map(([email, rows]) => ({ email, count: rows.length, record_ids: rows.map((row) => row?.id).filter(Boolean) }));
}

function newestByEmail(rows, emailFields) {
  const result = new Map();
  for (const row of rows || []) {
    for (const field of emailFields) {
      const email = normalizeEmail(row?.[field]);
      if (!email) continue;
      const current = result.get(email);
      const rowDate = Date.parse(row?.updated_date || row?.created_date || '') || 0;
      const currentDate = Date.parse(current?.updated_date || current?.created_date || '') || 0;
      if (!current || rowDate >= currentDate) result.set(email, row);
    }
  }
  return result;
}

function analyzeHistory(row) {
  const history = Array.isArray(row?.points_history) ? row.points_history : [];
  let malformed = 0;
  let sum = 0;
  let positiveSum = 0;
  let earnedWithoutPurchaseReference = 0;
  const idempotencyKeys = new Set();
  const duplicateIdempotencyKeys = new Set();
  const signatures = new Set();
  const duplicateSignatures = new Set();

  for (const entry of history) {
    const amount = finiteNumber(entry?.amount);
    if (amount === null) {
      malformed += 1;
      continue;
    }
    sum += amount;
    if (amount > 0) positiveSum += amount;

    const idempotencyKey = text(entry?.idempotency_key);
    if (idempotencyKey) {
      if (idempotencyKeys.has(idempotencyKey)) duplicateIdempotencyKeys.add(idempotencyKey);
      idempotencyKeys.add(idempotencyKey);
    }

    const signature = [amount, text(entry?.type), text(entry?.description), text(entry?.timestamp)].join('|');
    if (signatures.has(signature)) duplicateSignatures.add(signature);
    signatures.add(signature);

    if (entry?.type === 'earned') {
      const traceText = `${text(entry?.description)} ${text(entry?.event_key)} ${idempotencyKey}`.toLowerCase();
      const hasPurchaseReference = /(?:order|invoice|payment|subscription|stripe|shopify|nv-)/.test(traceText);
      if (!hasPurchaseReference) earnedWithoutPurchaseReference += 1;
    }
  }

  const total = finiteNumber(row?.total_points);
  const lifetime = finiteNumber(row?.lifetime_points);
  const redeemed = finiteNumber(row?.redeemed_points);

  return {
    entry_count: history.length,
    malformed_entry_count: malformed,
    reconstructed_balance: Math.round(sum * 100) / 100,
    reconstructed_positive_points: Math.round(positiveSum * 100) / 100,
    balance_matches_history: total !== null && malformed === 0 && Math.abs(total - sum) < 0.01,
    lifetime_matches_positive_history: lifetime !== null && malformed === 0 && Math.abs(lifetime - positiveSum) < 0.01,
    earned_without_purchase_reference_count: earnedWithoutPurchaseReference,
    duplicate_idempotency_key_count: duplicateIdempotencyKeys.size,
    duplicate_exact_entry_count: duplicateSignatures.size,
    total,
    lifetime,
    redeemed,
  };
}

function memberContact(member, profilesByEmail, ordersByEmail, shopifyOrdersByEmail) {
  const email = normalizeEmail(member?.email);
  const profile = profilesByEmail.get(email);
  const order = ordersByEmail.get(email);
  const shopifyOrder = shopifyOrdersByEmail.get(email);
  const name = fullName(profile) || text(order?.customer_name) || text(shopifyOrder?.customer_name) || fullName(member);
  const phone = text(profile?.phone) || text(order?.contact_phone) || text(shopifyOrder?.customer_phone) || text(member?.phone);
  return { name, phone };
}

export function buildLoyaltyIntegrityReport({
  members = [],
  pointsAccounts = [],
  profiles = [],
  orders = [],
  shopifyOrders = [],
  readErrors = [],
} = {}) {
  const membersByEmail = groupByEmail(members, 'email');
  const pointsByEmail = groupByEmail(pointsAccounts, 'customer_email');
  const profilesByEmail = newestByEmail(profiles, ['customer_email', 'contact_email']);
  const ordersByEmail = newestByEmail(orders, ['customer_email']);
  const shopifyOrdersByEmail = newestByEmail(shopifyOrders, ['customer_email']);

  const duplicateMembers = summarizeDuplicates(membersByEmail);
  const duplicatePointsAccounts = summarizeDuplicates(pointsByEmail);
  const invalidMemberEmails = (members || []).filter((row) => !hasUsableEmail(row?.email)).map((row) => row?.id).filter(Boolean);
  const invalidPointsEmails = (pointsAccounts || []).filter((row) => !hasUsableEmail(row?.customer_email)).map((row) => row?.id).filter(Boolean);
  const memberEmails = new Set(Array.from(membersByEmail.keys()).filter(Boolean));
  const pointsEmails = new Set(Array.from(pointsByEmail.keys()).filter(Boolean));
  const membersMissingPoints = Array.from(memberEmails).filter((email) => !pointsEmails.has(email));
  const allPointsMissingMembers = Array.from(pointsEmails).filter((email) => !memberEmails.has(email));
  const testPointsWithoutMembers = allPointsMissingMembers.filter(isTestEmail);
  const pointsMissingMembers = allPointsMissingMembers.filter((email) => !isTestEmail(email));
  const privateRelayMembers = Array.from(memberEmails).filter((email) => email.endsWith(PRIVATE_RELAY_DOMAIN));

  const balanceExceptions = [];
  const historyExceptions = [];
  for (const [email, rows] of pointsByEmail.entries()) {
    if (!email || rows.length !== 1) continue;
    const row = rows[0];
    const analysis = analyzeHistory(row);
    const impossibleBalance = analysis.total === null
      || analysis.lifetime === null
      || analysis.redeemed === null
      || analysis.total < 0
      || analysis.lifetime < 0
      || analysis.redeemed < 0
      || analysis.total > analysis.lifetime;
    if (impossibleBalance) {
      balanceExceptions.push({ email, record_id: row?.id, total_points: analysis.total, lifetime_points: analysis.lifetime, redeemed_points: analysis.redeemed });
    }
    if (analysis.malformed_entry_count > 0
      || !analysis.balance_matches_history
      || analysis.duplicate_idempotency_key_count > 0
      || analysis.duplicate_exact_entry_count > 0) {
      historyExceptions.push({ email, record_id: row?.id, ...analysis });
    }
  }

  const cacheMismatches = [];
  for (const email of memberEmails) {
    const memberRows = membersByEmail.get(email) || [];
    const pointsRows = pointsByEmail.get(email) || [];
    if (memberRows.length !== 1 || pointsRows.length !== 1) continue;
    const member = memberRows[0];
    const points = pointsRows[0];
    const memberTotal = finiteNumber(member?.total_points) ?? 0;
    const pointsTotal = finiteNumber(points?.total_points) ?? 0;
    const memberLifetime = finiteNumber(member?.lifetime_points) ?? 0;
    const pointsLifetime = finiteNumber(points?.lifetime_points) ?? 0;
    const memberRedeemed = finiteNumber(member?.redeemed_points) ?? 0;
    const pointsRedeemed = finiteNumber(points?.redeemed_points) ?? 0;
    if (memberTotal !== pointsTotal || memberLifetime !== pointsLifetime || memberRedeemed !== pointsRedeemed) {
      cacheMismatches.push({
        email,
        loyalty_member_id: member?.id,
        user_points_id: points?.id,
        loyalty_member: { total_points: memberTotal, lifetime_points: memberLifetime, redeemed_points: memberRedeemed },
        user_points: { total_points: pointsTotal, lifetime_points: pointsLifetime, redeemed_points: pointsRedeemed },
      });
    }
  }

  const incompleteProfiles = [];
  for (const rows of membersByEmail.values()) {
    if (rows.length !== 1) continue;
    const member = rows[0];
    const email = normalizeEmail(member?.email);
    if (!email) continue;
    const contact = memberContact(member, profilesByEmail, ordersByEmail, shopifyOrdersByEmail);
    if (!contact.name || !contact.phone) {
      incompleteProfiles.push({ email, loyalty_member_id: member?.id, missing_name: !contact.name, missing_phone: !contact.phone });
    }
  }

  const paidOrderEmails = new Set();
  for (const order of orders || []) {
    const paid = order?.payment_captured === true || ['paid', 'succeeded'].includes(String(order?.payment_status || order?.financial_status || '').toLowerCase());
    const refunded = ['refunded', 'fully_refunded'].includes(String(order?.payment_status || order?.financial_status || order?.refund_status || '').toLowerCase());
    const email = normalizeEmail(order?.customer_email);
    if (paid && !refunded && email) paidOrderEmails.add(email);
  }
  for (const order of shopifyOrders || []) {
    const status = String(order?.financial_status || order?.payment_status || '').toLowerCase();
    const email = normalizeEmail(order?.customer_email);
    if (['paid', 'partially_paid'].includes(status) && email) paidOrderEmails.add(email);
  }
  const paidCustomersWithoutPoints = Array.from(paidOrderEmails).filter((email) => !pointsEmails.has(email));

  const criticalCounts = {
    read_errors: readErrors.length,
    invalid_member_emails: invalidMemberEmails.length,
    invalid_points_emails: invalidPointsEmails.length,
    duplicate_members: duplicateMembers.length,
    duplicate_points_accounts: duplicatePointsAccounts.length,
    members_missing_points: membersMissingPoints.length,
    points_missing_members: pointsMissingMembers.length,
    private_relay_members: privateRelayMembers.length,
    impossible_balances: balanceExceptions.length,
    history_integrity_exceptions: historyExceptions.length,
  };
  const warningCounts = {
    legacy_loyalty_member_cache_mismatches: cacheMismatches.length,
    incomplete_profiles: incompleteProfiles.length,
  };
  const informationalCounts = {
    paid_customers_not_enrolled_in_loyalty: paidCustomersWithoutPoints.length,
    test_points_accounts_without_member: testPointsWithoutMembers.length,
  };
  const criticalExceptionCount = Object.values(criticalCounts).reduce((sum, count) => sum + count, 0);
  const warningCount = Object.values(warningCounts).reduce((sum, count) => sum + count, 0);

  return {
    healthy: criticalExceptionCount === 0,
    read_only: true,
    writes_performed: false,
    summary: {
      loyalty_member_count: members.length,
      user_points_account_count: pointsAccounts.length,
      profile_count: profiles.length,
      order_count: orders.length,
      shopify_order_count: shopifyOrders.length,
      paid_customer_count: paidOrderEmails.size,
      critical_exception_count: criticalExceptionCount,
      warning_count: warningCount,
      critical_counts: criticalCounts,
      warning_counts: warningCounts,
      informational_counts: informationalCounts,
      profile_data_complete: incompleteProfiles.length === 0,
    },
    exceptions: {
      duplicate_members: duplicateMembers,
      duplicate_points_accounts: duplicatePointsAccounts,
      invalid_member_record_ids: invalidMemberEmails,
      invalid_points_record_ids: invalidPointsEmails,
      members_missing_points: membersMissingPoints,
      points_missing_members: pointsMissingMembers,
      test_points_accounts_without_member: testPointsWithoutMembers,
      private_relay_members: privateRelayMembers,
      impossible_balances: balanceExceptions,
      history_integrity: historyExceptions,
      cache_mismatches: cacheMismatches,
      incomplete_profiles: incompleteProfiles,
      paid_customers_without_points: paidCustomersWithoutPoints,
    },
    read_errors: readErrors,
  };
}
