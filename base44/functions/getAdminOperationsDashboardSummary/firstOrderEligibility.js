// First-order policy is opt-in. Existing next-purchase offers are unchanged.
// Identical local copies keep each Base44 deployment package self-contained.
// Run run-first-order-offer-tests.mjs to enforce cross-package parity.
export function firstOrderOfferIsConfigured(discount) {
  if (discount?.first_order_only !== true) return true;
  const end = String(discount.ends_at ?? '').trim();
  // First-order eligibility does not require a seasonal deadline. An optional
  // deadline must still be valid; omission means ongoing, never unlimited uses.
  return discount.once_per_customer === true &&
    (!end || Number.isFinite(Date.parse(end)));
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function testPurchase(row) {
  return row?.is_test_order === true || row?.is_test === true || row?.test === true ||
    row?.is_sandbox === true ||
    /^(?:NV-SBX-|G\d+-TEST-)/i.test(String(row?.order_number || row?.shopify_order_number || row?.created_order_number || ''));
}

export function hasPaidPurchaseEvidence(row) {
  if (!row || testPurchase(row)) return false;
  // Refunded purchases still count as a previous purchase, as with one-use codes.
  // Unpaid/cancelled attempts and un-captured authorization holds do not count.
  const states = [row.payment_status, row.financial_status, row.refund_status]
    .map(value => String(value || '').trim().toLowerCase());
  return row.payment_captured === true ||
    states.some(value => ['paid', 'captured', 'partially_refunded', 'fully_refunded', 'refunded'].includes(value)) ||
    String(row.status || '').toLowerCase() === 'captured' ||
    String(row.stripe_authorization_status || '').toLowerCase() === 'succeeded';
}

async function priorPurchaseForEmail(entity, email) {
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const query = { customer_email: { $regex: `^\\s*${escaped}\\s*$`, $options: 'i' } };
  const pageSize = 200;
  const seen = new Set();
  for (let skip = 0; skip < 10000; skip += pageSize) {
    const rows = await entity.filter(query, '-created_date', pageSize, skip);
    if (!Array.isArray(rows)) throw new Error('invalid_purchase_history_response');
    for (const row of rows) {
      // Do not trust a malformed or overly broad provider response.
      if (normalizedEmail(row?.customer_email) !== email) throw new Error('purchase_history_identity_mismatch');
      if (hasPaidPurchaseEvidence(row)) return true;
      if (row?.id) {
        if (seen.has(row.id)) throw new Error('purchase_history_pagination_repeated');
        seen.add(row.id);
      }
    }
    if (rows.length < pageSize) return false;
  }
  throw new Error('purchase_history_limit_reached');
}

export async function firstOrderEligibilityBlock(base44, promotion, customerEmail, accountEmail = null) {
  if (!promotion?.code || promotion.first_order_only !== true) return null;
  const email = normalizedEmail(customerEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ ok: false, error_code: 'CUSTOMER_EMAIL_REQUIRED',
      error: 'Enter a valid email before applying this offer.' }, { status: 400 });
  }
  // A signed-in buyer cannot bypass their account history by changing receipt email.
  const emails = [...new Set([email, normalizedEmail(accountEmail)].filter(Boolean))];
  try {
    for (const identity of emails) {
      for (const name of ['Order', 'ShopifyOrder', 'DeliveryApprovalRequest']) {
        if (await priorPurchaseForEmail(base44.asServiceRole.entities[name], identity)) {
          return Response.json({ ok: false, error_code: 'FIRST_ORDER_OFFER_NOT_ELIGIBLE',
            error: 'This first-order offer is not available for this checkout. Remove it to continue.' }, { status: 409 });
        }
      }
    }
    return null;
  } catch {
    // Do not log customer history, email, or upstream error payloads.
    return Response.json({ ok: false, error_code: 'FIRST_ORDER_CHECK_UNAVAILABLE',
      error: 'We could not verify this offer right now. Try again or remove the code to continue.' }, { status: 503 });
  }
}

export function firstOrderStackingBlock(promotion, discounts = [], checkout = {}) {
  if (promotion?.first_order_only !== true) return null;
  const selectedReward = Boolean(checkout.active_reward) || Number(checkout.points_used || 0) > 0 ||
    (Array.isArray(checkout.items) && checkout.items.some(item =>
      item?.isFreeReward === true || String(item?.product_id || item?.id || '').startsWith('__free_reward_')));
  if (!selectedReward && !discounts.some(value => Number(value || 0) > 0)) return null;
  return Response.json({ ok: false, error_code: 'FIRST_ORDER_OFFER_NOT_COMBINABLE',
    error: 'Use this first-order offer without other discounts or rewards.' }, { status: 400 });
}
